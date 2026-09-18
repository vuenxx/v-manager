'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const config = require('../../config');

const TAG = '[BACKUP]';

function getBackupRoot() {
    return path.join(app.getPath('userData'), 'module-backups');
}

function hashFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', err => reject(err));
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

async function createBackup(gameName, moduleId, files, gameDir, manifestVersion) {
    try {
        const normGameName = config.normalizeGameKey(gameName);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');
        const backupDir = path.join(getBackupRoot(), normGameName, moduleId, timestamp);

        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const meta = {
            moduleId,
            gameName: normGameName,
            createdAt: new Date().toISOString(),
            manifestVersion,
            files: []
        };

        let backedUpFiles = 0;

        for (const file of (files || [])) {
            const originalPath = path.join(gameDir, file);
            if (fs.existsSync(originalPath)) {
                const fileName = path.basename(file);
                const backupPath = path.join(backupDir, fileName);
                
                fs.copyFileSync(originalPath, backupPath);
                const hash = await hashFile(backupPath);
                
                meta.files.push({
                    name: fileName,
                    originalPath: originalPath,
                    hash
                });
                
                backedUpFiles++;
            }
        }

        fs.writeFileSync(path.join(backupDir, 'backup-meta.json'), JSON.stringify(meta, null, 4));
        console.log(`${TAG} Backup created at ${backupDir} with ${backedUpFiles} files`);

        return { success: true, backupPath: backupDir, backedUpFiles };
    } catch (error) {
        console.error(`${TAG} Failed to create backup:`, error);
        return { success: false, backupPath: null, backedUpFiles: 0, error: error.message };
    }
}

async function restoreBackup(gameName, moduleId, gameDir, backupId = null) {
    try {
        const normGameName = config.normalizeGameKey(gameName);
        const moduleBackupDir = path.join(getBackupRoot(), normGameName, moduleId);

        if (!fs.existsSync(moduleBackupDir)) {
            console.log(`${TAG} No backups found for ${moduleId}`);
            return { success: false, restoredFiles: 0, error: 'No backups found' };
        }

        let targetBackupDir;
        if (backupId) {
            targetBackupDir = path.join(moduleBackupDir, backupId);
        } else {
            const backups = fs.readdirSync(moduleBackupDir).filter(f => {
                const p = path.join(moduleBackupDir, f);
                return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'backup-meta.json'));
            }).sort().reverse();
            
            if (backups.length === 0) {
                return { success: false, restoredFiles: 0, error: 'No valid backups found' };
            }
            targetBackupDir = path.join(moduleBackupDir, backups[0]);
        }

        if (!fs.existsSync(targetBackupDir)) {
            return { success: false, restoredFiles: 0, error: `Backup ${backupId} not found` };
        }

        const metaPath = path.join(targetBackupDir, 'backup-meta.json');
        if (!fs.existsSync(metaPath)) {
            return { success: false, restoredFiles: 0, error: 'backup-meta.json missing' };
        }

        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        let restoredFiles = 0;

        for (const fileMeta of meta.files) {
            const backupFilePath = path.join(targetBackupDir, fileMeta.name);
            if (fs.existsSync(backupFilePath)) {
                const targetDir = path.dirname(fileMeta.originalPath);
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }
                fs.copyFileSync(backupFilePath, fileMeta.originalPath);
                restoredFiles++;
            }
        }

        console.log(`${TAG} Restored ${restoredFiles} files from ${targetBackupDir}`);
        return { success: true, restoredFiles };
    } catch (error) {
        console.error(`${TAG} Failed to restore backup:`, error);
        return { success: false, restoredFiles: 0, error: error.message };
    }
}

async function listBackups(gameName, moduleId) {
    try {
        const normGameName = config.normalizeGameKey(gameName);
        const moduleBackupDir = path.join(getBackupRoot(), normGameName, moduleId);

        if (!fs.existsSync(moduleBackupDir)) {
            return [];
        }

        const backups = fs.readdirSync(moduleBackupDir)
            .filter(f => fs.statSync(path.join(moduleBackupDir, f)).isDirectory())
            .map(folder => {
                const metaPath = path.join(moduleBackupDir, folder, 'backup-meta.json');
                if (fs.existsSync(metaPath)) {
                    try {
                        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                        return {
                            id: folder,
                            createdAt: meta.createdAt,
                            files: meta.files.length
                        };
                    } catch (e) {
                        return null;
                    }
                }
                return null;
            })
            .filter(b => b !== null)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return backups;
    } catch (error) {
        console.error(`${TAG} Failed to list backups:`, error);
        return [];
    }
}

async function cleanOldBackups(gameName, moduleId, keepCount = 3) {
    try {
        const normGameName = config.normalizeGameKey(gameName);
        const moduleBackupDir = path.join(getBackupRoot(), normGameName, moduleId);

        if (!fs.existsSync(moduleBackupDir)) {
            return { deleted: 0 };
        }

        const backups = await listBackups(gameName, moduleId);
        if (backups.length <= keepCount) {
            return { deleted: 0 };
        }

        const toDelete = backups.slice(keepCount);
        let deleted = 0;

        for (const backup of toDelete) {
            const backupPath = path.join(moduleBackupDir, backup.id);
            fs.rmSync(backupPath, { recursive: true, force: true });
            deleted++;
        }

        console.log(`${TAG} Cleaned up ${deleted} old backups for ${moduleId}`);
        return { deleted };
    } catch (error) {
        console.error(`${TAG} Failed to clean old backups:`, error);
        return { deleted: 0, error: error.message };
    }
}

module.exports = {
    createBackup,
    restoreBackup,
    listBackups,
    cleanOldBackups
};
