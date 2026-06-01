const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

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

function isGameRunning(exePath) {
    return new Promise((resolve) => {
        const exeName = path.basename(exePath);
        exec(`tasklist /FI "IMAGENAME eq ${exeName}" /NH`, (err, stdout) => {
            if (err) return resolve(false);
            resolve(stdout.toLowerCase().includes(exeName.toLowerCase()));
        });
    });
}

function getFileDescription(filePath) {
    return new Promise((resolve) => {
        const escaped = filePath.replace(/'/g, "''");
        exec(
            `powershell -NoProfile -Command "(Get-ItemProperty '${escaped}').VersionInfo.FileDescription"`,     
            { timeout: 5000 },
            (err, stdout) => {
                if (err) return resolve('');
                resolve((stdout || '').trim());
            }
        );
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

function getFileVersion(filePath) {
    return new Promise((resolve) => {
        const escaped = filePath.replace(/'/g, "''");
        exec(
            `powershell -NoProfile -Command "(Get-ItemProperty '${escaped}').VersionInfo.FileVersion"`,
            { timeout: 5000 },
            (err, stdout) => {
                if (err) return resolve('');
                resolve((stdout || '').trim());
            }
        );
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

module.exports = {
    downloadImage,
    isGameRunning,
    getFileDescription,
    getFileVersion,
    isOptiScalerFile,
    copyDir,
    getFolderStats,
    getFileHash,
    compareVersions,
    getSystemDrives
};
