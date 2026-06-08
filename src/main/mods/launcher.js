const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const fsPromises = fs.promises;

/**
 * Launches an executable directly as a completely detached and independent process.
 * Handles UAC (Admin) permission blocks by catching spawn errors.
 * 
 * @param {string} exePath - Absolute path to the game executable.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function launchExeDirectly(exePath) {
    if (!exePath) {
        return { success: false, error: 'Oyun yürütülebilir dosyası (EXE) yolu boş veya geçersiz.' };
    }
    try {
        const stats = await fsPromises.stat(exePath);
        if (stats.isDirectory()) {
            return { success: false, error: 'Belirtilen EXE yolu bir klasördür, doğrudan başlatılamaz.' };
        }
    } catch (e) {
        return { success: false, error: 'Oyun yürütülebilir dosyası (EXE) bulunamadı. Lütfen yolu kontrol edin.' };
    }

    const exeDir = path.dirname(exePath);
    console.log(`[LAUNCHER] Detached launch attempt for: "${exePath}" in CWD: "${exeDir}"`);

    return new Promise((resolve) => {
        try {
            const child = spawn(exePath, [], {
                cwd: exeDir,
                detached: true,
                stdio: 'ignore'
            });

            let resolved = false;

            // Bind error listener immediately to capture launch errors (like UAC EACCES)
            child.on('error', (err) => {
                console.error('[LAUNCHER] Error spawning child process:', err);
                resolved = true;
                if (err.code === 'EACCES') {
                    resolve({ 
                        success: false, 
                        error: 'Oyun yönetici yetkisi (UAC) gerektiriyor olabilir. Lütfen V-Manager\'ı yönetici olarak çalıştırmayı deneyin veya oyunu doğrudan kendi istemcisinden başlatın.' 
                    });
                } else {
                    resolve({ success: false, error: `Oyun başlatılamadı: ${err.message}` });
                }
            });

            // Wait a tiny bit to check if spawn failed immediately
            setTimeout(() => {
                if (!resolved) {
                    child.unref();
                    resolve({ success: true });
                }
            }, 100);

        } catch (e) {
            console.error('[LAUNCHER] Unexpected exception spawning game:', e);
            resolve({ success: false, error: `Beklenmeyen başlatma hatası: ${e.message}` });
        }
    });
}

/**
 * Asynchronously searches for the Steam AppID of a game by reading appmanifest acf files.
 */
async function resolveSteamId(game) {
    if (game.launcherId) return game.launcherId;
    
    try {
        const normPath = game.exePath.replace(/\\/g, '/');
        const steamMatch = normPath.match(/(.*\/steamapps)\/common\/([^\/]+)/i);
        if (steamMatch) {
            const steamAppsPath = path.resolve(steamMatch[1]);
            const gameDirName = steamMatch[2];
            
            const dirExists = await fsPromises.stat(steamAppsPath).then(s => s.isDirectory()).catch(() => false);
            if (dirExists) {
                const files = await fsPromises.readdir(steamAppsPath);
                for (const file of files) {
                    if (file.endsWith('.acf') && file.startsWith('appmanifest_')) {
                        const content = await fsPromises.readFile(path.join(steamAppsPath, file), 'utf-8');
                        const installDirMatch = content.match(/"installdir"\s+"([^"]+)"/i);
                        const appidMatch = content.match(/"appid"\s+"([^"]+)"/i);
                        if (installDirMatch && appidMatch && installDirMatch[1].toLowerCase() === gameDirName.toLowerCase()) {
                            return appidMatch[1];
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error('[LAUNCHER] Error resolving Steam ID asynchronously:', e);
    }
    return null;
}

/**
 * Asynchronously searches for the Epic Games AppName ID by reading manifest .item files.
 */
async function resolveEpicId(game) {
    if (game.launcherId) return game.launcherId;
    
    const epicPath = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
    try {
        const dirExists = await fsPromises.stat(epicPath).then(s => s.isDirectory()).catch(() => false);
        if (dirExists) {
            const files = (await fsPromises.readdir(epicPath)).filter(f => f.endsWith('.item'));
            const targetPath = path.resolve(game.gameRoot || path.dirname(game.exePath)).toLowerCase();
            for (const file of files) {
                const content = await fsPromises.readFile(path.join(epicPath, file), 'utf-8');
                const data = JSON.parse(content);
                if (data.InstallLocation && data.AppName) {
                    const installLoc = path.resolve(data.InstallLocation).toLowerCase();
                    if (installLoc === targetPath) {
                        return data.AppName;
                    }
                }
            }
        }
    } catch (e) {
        console.error('[LAUNCHER] Error resolving Epic ID asynchronously:', e);
    }
    return null;
}

/**
 * Launches an Xbox / UWP game by reading its AppxManifest and querying its Package Family Name via PowerShell.
 */
async function launchXboxGame(game) {
    let launcherId = game.launcherId;
    
    if (!launcherId) {
        // Fallback for games without launcherId (legacy scanned games)
        const gameRoot = game.gameRoot || path.dirname(game.exePath);
        const manifestPath = path.join(gameRoot, 'AppxManifest.xml');
        const manifestExists = await fsPromises.stat(manifestPath).then(s => s.isFile()).catch(() => false);
        if (manifestExists) {
            try {
                const content = await fsPromises.readFile(manifestPath, 'utf-8');
                const identityMatch = content.match(/<Identity\s+[^>]*Name="([^"]+)"/i);
                const appIdMatch = content.match(/<Application\s+[^>]*Id="([^"]+)"/i);
                if (identityMatch && appIdMatch) {
                    const name = identityMatch[1];
                    const appId = appIdMatch[1];
                    
                    const { exec } = require('child_process');
                    const pfn = await new Promise((resPfn) => {
                        exec(`powershell.exe -NoProfile -Command "Get-AppxPackage -Name \\"${name}\\" | Select-Object -ExpandProperty PackageFamilyName"`, (error, stdout) => {
                            resPfn(!error && stdout.trim() ? stdout.trim() : null);
                        });
                    });
                    
                    if (pfn) {
                        launcherId = `${pfn}!${appId}`;
                    }
                }
            } catch (e) {
                console.error('[LAUNCHER] Legacy UWP manifest resolution failed:', e);
            }
        }
    }
    
    if (!launcherId) {
        // Ultimate fallback to launching EXE directly
        return await launchExeDirectly(game.exePath);
    }
    
    console.log(`[LAUNCHER] Launching Xbox Game via explorer: shell:AppsFolder\\${launcherId}`);
    
    return new Promise((resolve) => {
        try {
            const child = spawn('explorer.exe', [`shell:AppsFolder\\${launcherId}`], {
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
            resolve({ success: true });
        } catch (e) {
            console.error('[LAUNCHER] Error spawning explorer.exe for Xbox game:', e);
            resolve({ success: false, error: `Xbox oyunu başlatılamadı: ${e.message}` });
        }
    });
}

/**
 * Main launch orchestrator.
 */
async function launchGame(game) {
    console.log(`[LAUNCHER] Launch game requested: "${game.name}" (Source: ${game.source})`);
    
    if (game.source === 'steam') {
        const steamId = await resolveSteamId(game);
        if (steamId) {
            const uri = `steam://rungameid/${steamId}`;
            console.log(`[LAUNCHER] Launching Steam game via URI: ${uri}`);
            try {
                const { shell } = require('electron');
                await shell.openExternal(uri);
                return { success: true };
            } catch (e) {
                console.error('[LAUNCHER] Steam URI launch failed, falling back to direct EXE launch:', e);
                return await launchExeDirectly(game.exePath);
            }
        } else {
            console.log('[LAUNCHER] Steam App ID not resolved, running EXE directly');
            return await launchExeDirectly(game.exePath);
        }
    }
    
    if (game.source === 'epic') {
        const epicId = await resolveEpicId(game);
        if (epicId) {
            const uri = `com.epicgames.launcher://apps/${epicId}?action=launch&silent=true`;
            console.log(`[LAUNCHER] Launching Epic game via URI: ${uri}`);
            try {
                const { shell } = require('electron');
                await shell.openExternal(uri);
                return { success: true };
            } catch (e) {
                console.error('[LAUNCHER] Epic URI launch failed, falling back to direct EXE launch:', e);
                return await launchExeDirectly(game.exePath);
            }
        } else {
            console.log('[LAUNCHER] Epic App Name not resolved, running EXE directly');
            return await launchExeDirectly(game.exePath);
        }
    }
    
    if (game.source === 'xbox') {
        return await launchXboxGame(game);
    }
    
    // For other platforms (EA, Ubisoft, GOG, Rockstar, Manual, Registry, etc.), launch EXE directly
    return await launchExeDirectly(game.exePath);
}

module.exports = {
    launchGame
};
