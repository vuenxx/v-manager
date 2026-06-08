Get-AppxPackage | Where-Object { $_.InstallLocation -ne $null -and $_.SignatureKind -eq "Store" } | ForEach-Object {
    $manifestPath = Join-Path $_.InstallLocation "AppxManifest.xml"
    if (Test-Path $manifestPath) {
        try {
            [xml]$manifest = Get-Content $manifestPath -ErrorAction SilentlyContinue
            $appNode = $manifest.Package.Applications.Application
            if ($appNode -ne $null) {
                # 1. Has MicrosoftGame.config (GDK Game)
                $hasConfig = Test-Path (Join-Path $_.InstallLocation "MicrosoftGame.config")
                
                # 2. Category windows.game
                $hasGameCategory = $false
                if ($appNode.Extensions.Extension.Category -eq "windows.game") {
                    $hasGameCategory = $true
                }
                
                # 3. Xbox Live protocol
                $hasXboxProtocol = $false
                $protocols = @()
                if ($appNode.Extensions.Extension.Protocol) {
                    $protocols = $appNode.Extensions.Extension.Protocol
                }
                foreach ($p in $protocols) {
                    if ($p.Name -like "ms-xbl-*") {
                        $hasXboxProtocol = $true
                    }
                }

                if ($hasConfig -or $hasGameCategory -or $hasXboxProtocol) {
                    # Skip the Xbox App itself
                    if ($_.Name -eq "Microsoft.GamingApp") {
                        return
                    }
                    $firstApp = if ($appNode -is [array]) { $appNode[0] } else { $appNode }
                    [PSCustomObject]@{
                        Name = $_.Name
                        Path = $_.InstallLocation
                        PFN = $_.PackageFamilyName
                        Executable = $firstApp.Executable
                        AppId = $firstApp.Id
                    }
                }
            }
        } catch {}
    }
} | ConvertTo-Json -Compress
