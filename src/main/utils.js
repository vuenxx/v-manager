const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');

const crypto = require('crypto');

function getFileHash(filePath) {
    return new Promise((resolve) => {
        if (!fs.existsSync(filePath)) return resolve(null);
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', data => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', () => resolve(null));
    });
}
function downloadImage(url, destPath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? require('https') : require('http');
        const tempPath = destPath + '.tmp';
        const file = fs.createWriteStream(tempPath);
        let finished = false;

        const req = protocol.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                file.close();
                fs.unlink(tempPath, () => {});
                return downloadImage(response.headers.location, destPath).then(resolve).catch(reject);
            }
            if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => {
                    finished = true;
                    file.close(() => {
                        if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 1024) {
                            fs.rename(tempPath, destPath, (err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        } else {
                            fs.unlink(tempPath, () => {});
                            reject(new Error('Downloaded file is empty or too small'));
                        }
                    });
                });
            } else {
                file.close();
                fs.unlink(tempPath, () => {});
                reject(new Error(`Server responded with ${response.statusCode}`));
            }
        }).on('error', (err) => {
            if (!finished) {
                file.close();
                fs.unlink(tempPath, () => {});
                reject(err);
            }
        });

        req.setTimeout(15000, () => {
            req.destroy();
            if (!finished) {
                file.close();
                fs.unlink(tempPath, () => {});
                reject(new Error('Download timeout'));
            }
        });
    });
}

// C-07: Use spawn+shell:false to prevent command injection via user-controlled paths
function isGameRunning(exePath) {
    return new Promise((resolve) => {
        const exeName = path.basename(exePath);
        // tasklist accepts /FI as a separate argument — safe from injection
        const proc = spawn('tasklist.exe', ['/FI', `IMAGENAME eq ${exeName}`, '/NH'], {
            shell: false
        });
        let stdout = '';
        proc.stdout.on('data', d => stdout += d.toString());
        proc.on('error', () => resolve(false));
        proc.on('close', () => resolve(stdout.toLowerCase().includes(exeName.toLowerCase())));
    });
}

function checkGameRunningDetailed(exePath) {
    return new Promise((resolve) => {
        const exeName = path.basename(exePath);
        const proc = spawn('tasklist.exe', ['/FI', `IMAGENAME eq ${exeName}`, '/NH'], {
            shell: false
        });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => stdout += d.toString());
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('error', (err) => resolve({ status: 'error', error: err }));
        proc.on('close', (code) => {
            if (code !== 0) {
                resolve({ status: 'error', error: new Error(`tasklist exited with code ${code}: ${stderr.trim()}`) });
            } else {
                const lowerStdout = stdout.toLowerCase();
                if (lowerStdout.includes('error:') || lowerStdout.includes('hata:')) {
                    resolve({ status: 'error', error: new Error(stdout.trim()) });
                    return;
                }
                const lowerExe = exeName.toLowerCase();
                if (lowerStdout.includes(lowerExe)) {
                    resolve({ status: 'running' });
                } else {
                    resolve({ status: 'not_running' });
                }
            }
        });
    });
}

// C-07: Use spawn with array args to avoid path-based command injection
function getFileDescription(filePath) {
    return new Promise((resolve) => {
        const script = `(Get-ItemProperty '${filePath.replace(/'/g, "''")}').VersionInfo.FileDescription`;
        const proc = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
            shell: false,
            timeout: 5000
        });
        let stdout = '';
        proc.stdout.on('data', d => stdout += d.toString());
        proc.on('error', () => resolve(''));
        proc.on('close', () => resolve(stdout.trim()));
    });
}

function compareVersions(v1, v2) {
    const normalize = (v) => (v || '0.0.0.0').replace(/,/g, '.').replace(/[^0-9.]/g, '').split('.').map(Number);
    const parts1 = normalize(v1);
    const parts2 = normalize(v2);
    
    for (let i = 0; i < 4; i++) {
        const a = parts1[i] || 0;
        const b = parts2[i] || 0;
        if (a < b) return -1;
        if (a > b) return 1;
    }
    return 0;
}

// C-07: Use spawn with array args for getFileVersion as well
function getFileVersion(filePath) {
    return new Promise((resolve) => {
        const script = `(Get-ItemProperty '${filePath.replace(/'/g, "''")}').VersionInfo.FileVersion`;
        const proc = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
            shell: false,
            timeout: 5000
        });
        let stdout = '';
        proc.stdout.on('data', d => stdout += d.toString());
        proc.on('error', () => resolve(''));
        proc.on('close', () => resolve(stdout.trim()));
    });
}

async function isOptiScalerFile(filePath) {
    try {
        const desc = await getFileDescription(filePath);
        return desc.toLowerCase().includes('optiscaler');
    } catch(e) {
        return false;
    }
}

async function copyDir(src, dest) {
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            await copyDir(srcPath, destPath);
        } else {
            console.log(`[FILE-COPY] Kopyalanıyor: "${srcPath}" -> "${destPath}"`);
            await fs.promises.copyFile(srcPath, destPath);
        }
    }
}

async function getFolderStats(dirPath) {
    let totalSize = 0;
    let fileCount = 0;

    async function processDirectory(currentPath) {
        const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });

        const tasks = entries.map(async (entry) => {
            const fullPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                await processDirectory(fullPath);
            } else if (entry.isFile()) {
                try {
                    const stats = await fs.promises.stat(fullPath);
                    totalSize += stats.size;
                    fileCount++;
                } catch (e) {
                    // Ignore files that might have been deleted or are inaccessible
                }
            }
        });

        await Promise.all(tasks);
    }

    try {
        await processDirectory(dirPath);
        return {
            size: totalSize,
            count: fileCount
        };
    } catch (e) {
        console.error('Error calculating folder stats:', e);
        return { size: 0, count: 0 };
    }
}

/**
 * Returns a list of logical drives on the system.
 * Tries PowerShell Get-PSDrive first (fast, modern), falls back to wmic.
 * @returns {Promise<Array<{letter: string, label: string}>>}
 */
function getSystemDrives() {
    return new Promise((resolve) => {
        // Attempt 1: PowerShell Get-PSDrive (fast, available on all modern Windows)
        const psCmd = `powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name,Description | ConvertTo-Json -Compress"`;
        exec(psCmd, { timeout: 8000 }, (err, stdout) => {
            if (!err && stdout && stdout.trim()) {
                try {
                    let parsed = JSON.parse(stdout.trim());
                    if (!Array.isArray(parsed)) parsed = [parsed];

                    // Determine system drive (where Windows is installed)
                    const sysDrive = (process.env.SystemDrive || 'C:').toUpperCase().replace(':', '');

                    const drives = parsed
                        .filter(d => d.Name && /^[A-Z]$/i.test(d.Name))
                        .map(d => {
                            const letter = d.Name.toUpperCase() + ':';
                            let label = d.Description ? d.Description.trim() : '';
                            if (d.Name.toUpperCase() === sysDrive) {
                                label = label ? `${label} (Sistem)` : 'Sistem';
                            }
                            if (!label) label = 'Yerel Disk';
                            return { letter, label };
                        });

                    if (drives.length > 0) return resolve(drives);
                } catch (parseErr) {
                    console.warn('[DRIVES] PowerShell parse error, falling back to wmic:', parseErr.message);
                }
            }

            // Attempt 2: wmic fallback (older systems / execution policy issues)
            exec('wmic logicaldisk get name,volumename /format:csv', { timeout: 10000 }, (err2, stdout2) => {
                if (err2 || !stdout2) {
                    console.error('[DRIVES] Both drive discovery methods failed:', err2?.message);
                    return resolve([{ letter: 'C:', label: 'Sistem' }]);
                }
                try {
                    const sysDrive = (process.env.SystemDrive || 'C:').toUpperCase();
                    const lines = stdout2.trim().split('\n').slice(1); // skip header
                    const drives = [];
                    for (const line of lines) {
                        const parts = line.split(',').map(p => p.trim());
                        // CSV columns: Node,Name,VolumeName  (wmic /format:csv)
                        const name = parts[1];
                        const volumeName = parts[2] || '';
                        if (!name || !/^[A-Z]:$/i.test(name)) continue;
                        const letter = name.toUpperCase();
                        let label = volumeName || 'Yerel Disk';
                        if (letter === sysDrive) {
                            label = label !== 'Yerel Disk' ? `${label} (Sistem)` : 'Sistem';
                        }
                        drives.push({ letter, label });
                    }
                    resolve(drives.length > 0 ? drives : [{ letter: 'C:', label: 'Sistem' }]);
                } catch (e) {
                    console.error('[DRIVES] wmic parse error:', e.message);
                    resolve([{ letter: 'C:', label: 'Sistem' }]);
                }
            });
        });
    });
}

function checkDx12Support(exePath) {
    return new Promise((resolve) => {
        if (!fs.existsSync(exePath)) {
            resolve({ hasDx12: false });
            return;
        }

        const stream = fs.createReadStream(exePath, { highWaterMark: 4 * 1024 * 1024 }); // 4MB chunks
        let totalRead = 0;
        const maxBytesToScan = 250 * 1024 * 1024; // Scan up to 250MB
        let hasDx12 = false;
        let prevBuffer = Buffer.alloc(0);

        stream.on('data', (chunk) => {
            totalRead += chunk.length;
            
            // Concatenate with overlap from previous chunk to avoid split strings
            const combined = Buffer.concat([prevBuffer, chunk]);
            
            // Check ASCII/binary case-insensitively
            const asciiContent = combined.toString('binary').toLowerCase();
            if (asciiContent.includes('d3d12.dll')) {
                hasDx12 = true;
            }
            
            // Check UTF-16LE case-insensitively
            const utf16Length = combined.length - (combined.length % 2);
            const utf16Content = combined.subarray(0, utf16Length).toString('utf16le').toLowerCase();
            if (utf16Content.includes('d3d12.dll')) {
                hasDx12 = true;
            }

            // Save overlapping buffer for next chunk (64 bytes to cover split strings in both encodings)
            prevBuffer = chunk.subarray(Math.max(0, chunk.length - 64));

            // If we found it, or reached the scan limit, stop
            if (hasDx12 || totalRead >= maxBytesToScan) {
                stream.destroy();
            }
        });

        stream.on('close', () => {
            resolve({ hasDx12 });
        });

        stream.on('end', () => {
            resolve({ hasDx12 });
        });

        stream.on('error', (err) => {
            console.error('[UTILS] DX12 support check error:', err);
            resolve({ hasDx12: false });
        });
    });
}

function scanFolderForExes(folderPath) {
    const results = [];
    if (!folderPath || !fs.existsSync(folderPath)) return results;

    const visited = new Set();
    const queue = [{ dirPath: folderPath, depth: 0 }];

    const EXCLUDED_DIRS = new Set([
        '.git', 'node_modules', '_redist', 'redist', 'directx', 
        'engine', 'dotnet', 'crashreporter', 'cache', '_support'
    ]);

    const EXCLUDED_FILE_FRAGMENTS = [
        'uninstall', 'crashreporter', 'unitycrashhandler', 
        'vc_redist', 'setup', 'install', 'touchup', 'bugreport'
    ];

    while (queue.length > 0) {
        const { dirPath, depth } = queue.shift();

        let realPath;
        try {
            realPath = fs.realpathSync(dirPath);
        } catch (e) {
            console.error(`[UTILS] realpathSync failed for ${dirPath}:`, e.message);
            continue;
        }

        if (visited.has(realPath)) continue;
        visited.add(realPath);

        try {
            const entries = fs.readdirSync(realPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(realPath, entry.name);
                const nameLower = entry.name.toLowerCase();

                if (entry.isDirectory()) {
                    if (depth < 3 && !EXCLUDED_DIRS.has(nameLower)) {
                        queue.push({ dirPath: fullPath, depth: depth + 1 });
                    }
                } else if (entry.isFile() && nameLower.endsWith('.exe')) {
                    const shouldExclude = EXCLUDED_FILE_FRAGMENTS.some(fragment => nameLower.includes(fragment));
                    if (shouldExclude) {
                        console.log(`[SCANNER-FILTER] Filtered out executable: ${fullPath}`);
                    } else {
                        results.push(fullPath);
                    }
                }
            }
        } catch (err) {
            console.error(`[UTILS] Error reading directory ${realPath}:`, err.message);
        }
    }

    return results;
}

module.exports = {
    downloadImage,
    isGameRunning,
    checkGameRunningDetailed,
    getFileDescription,
    getFileVersion,
    isOptiScalerFile,
    copyDir,
    getFolderStats,
    getFileHash,
    compareVersions,
    getSystemDrives,
    checkDx12Support,
    scanFolderForExes
};
