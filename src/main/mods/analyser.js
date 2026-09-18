const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Folder Analyser (CompactGUI Native Port)
 * Strictly follows CompactGUI's C# implementation for Long Paths and Safe Enumeration.
 */
class Analyser {
    async analyze(folderPath) {
        console.log(`[Analyser] Deep analysis for: ${folderPath}`);
        
        return new Promise((resolve) => {
            const psScript = `
# 1. API Definitions (Directly from CompactGUI)
try { Add-Type -AssemblyName "System.Runtime.InteropServices" } catch {}
$signature = @"
using System;
using System.Runtime.InteropServices;

public class Win32 {
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern uint GetCompressedFileSize(string lpFileName, out uint lpFileSizeHigh);

    [DllImport("wofutil.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern int WofIsExternalFile(string filePath, out int isExternalFile, out uint provider, IntPtr externalFileInfo, ref uint bufferLength);
}
"@
try { Add-Type -TypeDefinition $signature } catch {}

$target = $env:TARGET_PATH.TrimEnd('\\')

$script:totalLogical = [long]0
$script:totalPhysical = [long]0
$script:fileCount = 0
$script:compressedCount = 0

# Allocate 8 bytes for WOF info (Algorithm + Flags)
$wofBuffer = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(8)

# Keep track of algorithms found
$script:algorithms = @{}

function Safe-Scan($currentPath) {
    try {
        # Use Get-ChildItem for better compatibility with various path types
        $items = Get-ChildItem -LiteralPath $currentPath -Force -ErrorAction SilentlyContinue

        foreach ($item in $items) {
            if ($item.PSIsContainer) {
                # Recurse into subdirectories
                Safe-Scan $item.FullName
            } else {
                # Process File
                try {
                    $f = $item.FullName

                    # Skip reparse points (same as CompactGUI)
                    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { continue }      

                    $uSize = $item.Length
                    $pSize = $uSize
                    $isComp = $false
                    $algoName = "None"

                    # Tier 3: Attributes (NTFS Standard Compression)
                    if (($item.Attributes -band [System.IO.FileAttributes]::Compressed) -ne 0) { 
                        $isComp = $true 
                        $algoName = "NTFS"
                    } 


                    # For Win32 APIs, add prefix if path is long
                    $win32Path = $f
                    if ($win32Path.Length -ge 255 -and -not $win32Path.StartsWith("\\\\?\\")) {
                        $win32Path = "\\\\?\\" + $win32Path
                    }

                    # Tier 1: GetCompressedFileSize (NTFS Sparse/Compressed)
                    $high = [uint32]0
                    $low = [Win32]::GetCompressedFileSize($win32Path, [ref]$high)
                    if ($low -ne 0xffffffff -or [System.Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 0) {
                        $realSize = ([long]$high -shl 32) -bor $low
                        if ($realSize -lt $uSize) { 
                            $pSize = $realSize
                            $isComp = $true 
                            if ($algoName -eq "None") { $algoName = "NTFS" }
                        }
                    }

                    # Tier 2: WofIsExternalFile (LXP/XPRESS/LZX)
                    # Even if already marked as NTFS, check for WOF as it's more specific
                    $isExt = 0; $prov = [uint32]0; $bufLen = [uint32]8
                    $res = [Win32]::WofIsExternalFile($win32Path, [ref]$isExt, [ref]$prov, $wofBuffer, [ref]$bufLen)
                    if ($res -eq 0 -and $isExt -ne 0) {
                        $isComp = $true
                        # Extract algorithm ID from buffer
                        $algoId = [System.Runtime.InteropServices.Marshal]::ReadInt32($wofBuffer, 0)
                        
                        # 0: XPRESS4K, 1: LZX, 2: XPRESS8K, 3: XPRESS16K (Based on WofApi.h / CompactGUI logic)
                        switch ($algoId) {
                            0 { $algoName = "XPRESS4K" }
                            1 { $algoName = "LZX" }
                            2 { $algoName = "XPRESS8K" }
                            3 { $algoName = "XPRESS16K" }
                            default { $algoName = "WOF ($algoId)" }
                        }

                        # Heuristic based on logical size
                        if ($pSize -eq $uSize) {
                            $pSize = [Math]::Floor($uSize * 0.7)
                        }
                    }

                    $script:totalLogical += $uSize
                    $script:totalPhysical += $pSize
                    $script:fileCount++
                    if ($isComp) { 
                        $script:compressedCount++ 
                        if (-not $script:algorithms.ContainsKey($algoName)) {
                            $script:algorithms[$algoName] = 1
                        } else {
                            $script:algorithms[$algoName]++
                        }
                    }
                } catch {}
            }
        }
    } catch {}
}

if (Test-Path -LiteralPath $target) {
    Safe-Scan $target
}
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($wofBuffer)

# Determine the most used algorithm
$mainAlgo = "None"
$maxCount = -1
foreach ($key in $script:algorithms.Keys) {
    if ($script:algorithms[$key] -gt $maxCount) {
        $maxCount = $script:algorithms[$key]
        $mainAlgo = $key
    }
}


$ratio = 1.0
if ($script:totalPhysical -gt 0 -and $script:totalPhysical -lt $script:totalLogical) {
    $ratio = [Math]::Round($script:totalLogical / $script:totalPhysical, 2)
}

@{
    isCompressed = $script:compressedCount -gt 0
    ratio = $ratio.ToString("F1")
    uncompressedBytes = $script:totalLogical
    compressedBytes = $script:totalPhysical
    fileCount = $script:fileCount
    compressedCount = $script:compressedCount
    algorithm = $mainAlgo
} | ConvertTo-Json -Compress
`;

            const tempFile = path.join(os.tmpdir(), `v_enabler_deep_${Date.now()}.ps1`);
            
            try {
                // IMPORTANT: UTF-8 BOM for Turkish char support in PowerShell
                fs.writeFileSync(tempFile, '\ufeff' + psScript, 'utf8');
                
                exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${tempFile}"`, {
                    maxBuffer: 25 * 1024 * 1024,
                    env: { ...process.env, TARGET_PATH: folderPath }
                }, (error, stdout, stderr) => {
                    try { fs.unlinkSync(tempFile); } catch(e) {}

                    if (stdout) {
                        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            // M-21: Wrap JSON.parse in try/catch to prevent uncaught exceptions
                            try {
                                const data = JSON.parse(jsonMatch[0]);
                                console.log(`[Analyser] Found ${data.fileCount} files. Compressed: ${data.compressedCount}`);
                                resolve(data);
                                return;
                            } catch (parseErr) {
                                console.error('[Analyser] JSON parse failed:', parseErr.message);
                            }
                        }
                    }
                    console.error('[Analyser] Empty or invalid output:', stdout, stderr);
                    resolve(this._getDefaultState());
                });
            } catch (e) {
                console.error('[Analyser] Error:', e);
                resolve(this._getDefaultState());
            }
        });
    }

    _getDefaultState() {
        // M-22: Include all fields that the UI/compressor.js might reference
        return {
            isCompressed: false,
            ratio: '1.0',
            uncompressedBytes: 0,
            compressedBytes: 0,
            fileCount: 0,
            compressedCount: 0,
            algorithm: 'None'
        };
    }
}

module.exports = new Analyser();
