const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const config = require('./config');
const utils = require('./utils');

let currentScanFoundGames = null;

function getGameKeys(name, exePath) {
    const keys = [];
    if (name) {
        keys.push('name:' + name.toLowerCase().replace(/[^a-z0-9]/g, ''));
    }
    if (exePath) {
        try {
            keys.push('path:' + path.resolve(exePath).toLowerCase());
        } catch (e) {
            keys.push('path:' + exePath.toLowerCase());
        }
    }
    return keys;
}

// ── Launcher / Redistributable Blacklists ──────────────────────────────────
// Game names (lowercased substrings) to always ignore
const IGNORED_NAME_FRAGMENTS = [
    'steamworks common redistributables',
    'steam linux runtime',
    'proton',
    'directx',
    'visual c++',
    'vcredist',
    '.net framework',
    'physx',
    'openal',
    'dotnet',
    'xnafx',
    'battleye',
    'easyanticheat',
    'dxwebsetup',
    'visual studio',
    'microsoft edge',
    'webview',
    'microsoft office',
    'sql server',
    'development kit',
    'windows sdk',
    'software development kit',
];

// Exact game names (lowercased) to always ignore (to prevent substring false-positives)
const IGNORED_EXACT_NAMES = [
    'steam',
    'epic games launcher',
    'epic games',
    'xbox app',
    'ea app',
    'ea desktop',
    'ubisoft connect',
    'rockstar games launcher',
    'rockstar games',
    'battle.net',
    'gog galaxy',
    'playnite',
    'heroic games launcher',
    'lutris',
    'pegasus',
    'itch.io app',
    'itch.io',
    'amazon games app',
    'amazon games',
    'legacy games launcher',
    'prism launcher',
    'modrinth app',
    'curseforge app',
    'tlauncher',
    'lunar client',
    'badlion client',
    'retroarch',
    'wallpaper engine',
    'soundpad',
    'redlauncher'
];

// Executable basenames (lowercased) to always ignore
const IGNORED_EXE_NAMES = [
    'steam.exe',
    'epicgameslauncher.exe',
    'eadesktop.exe',
    'upc.exe',
    'ubisoft connect.exe',
    'gamingservices.exe',
    'galaxyclient.exe',
    'gog galaxy.exe',
    'gameservices.exe',
    'rockstargameslauncher.exe',
    'battle.net.exe',
    'battle.net launcher.exe',
    'playnite.exe',
    'heroic.exe',
    'lutris.exe',
    'pegasus.exe',
    'itch.exe',
    'prismlauncher.exe',
    'modrinthapp.exe',
    'curseforge.exe',
    'tlauncher.exe',
    'lunar client.exe',
    'badlion client.exe'
];

// Path fragments (uppercased) to detect launcher install dirs
const IGNORED_PATH_FRAGMENTS = [
    'STEAM LINUX RUNTIME',
    'STEAMWORKS COMMON REDISTRIBUTABLES',
    'PROTON EXPERIMENTAL',
];

/**
 * Returns true if the game should be ignored (launcher, redist, etc.)
 */
function isIgnoredGame(game) {
    const nameLow = (game.name || '').toLowerCase().trim();
    const exeNameLow = path.basename(game.exePath || '').toLowerCase();
    const exePathUp = (game.exePath || '').toUpperCase();

    if (IGNORED_EXACT_NAMES.includes(nameLow)) return true;
    if (IGNORED_NAME_FRAGMENTS.some(f => nameLow.includes(f))) return true;
    if (IGNORED_EXE_NAMES.includes(exeNameLow)) return true;
    if (IGNORED_PATH_FRAGMENTS.some(f => exePathUp.includes(f))) return true;
    return false;
}

async function detectUpscalers(gamePath) {
    const result = {
        dlss: false, xess: false, fsr: false,
        dlssEnabler: false, optiscaler: false, streamline: false,
        dlssEnablerVersion: null, optiscalerVersion: null, streamlineVersion: null,
        dlssEnablerPath: null, optiscalerPath: null,
        streamlinePath: null, streamlineDepth: -1
    };
    if (!fs.existsSync(gamePath)) return result;

    let rootPath = gamePath;
    try {
        const stats = await fs.promises.stat(gamePath);
        if (stats.isFile()) {
            rootPath = path.dirname(gamePath);
        }
    } catch (e) { return result; }

    const dlssFiles = ['nvngx_dlss.dll', 'nvngx_dlssg.dll', 'nvngx_dlssd.dll'];
    const xessFiles = ['libxess.dll', 'xefx.dll'];
    const fsrFiles = [
        'amd_fidelityfx_dx12.dll', 'amd_fidelityfx_framegeneration_dx12.dll',
        'amd_fidelityfx_upscaler_dx12.dll', 'amd_fidelityfx_vk.dll',
        'ffx_fsr2_api_x64.dll', 'ffx_fsr2_api_dx12_x64.dll', 'ffx_fsr2_api_vk_x64.dll',
        'ffx_fsr3_api_x64.dll', 'ffx_fsr3_api_dx12_x64.dll', 'ffx_fsr3_api_vk_x64.dll'
    ];
    const injectionDllNames = ['dxgi.dll', 'winmm.dll', 'd3d12.dll', 'dbghelp.dll', 'version.dll', 'wininet.dll', 'winhttp.dll', 'psapi.dll'];

    const ignoreFolders = ['data', 'shader', 'resource', 'asset', 'sound', 'audio', 'video', 'movie', 'ui', 'localization', 'language', '_redist', '__commonredist', 'docs'];
    const priorityFolders = ['bin', 'binaries', 'x64', 'win64', 'dx12', 'plugins'];

    const queue = [{ path: rootPath, depth: 0 }];
    const visited = new Set();

    while (queue.length > 0) {
        const current = queue.shift();
        const absPath = path.resolve(current.path);
        if (visited.has(absPath)) continue;
        visited.add(absPath);

        try {
            const files = await fs.promises.readdir(current.path, { withFileTypes: true });

            const subDirs = [];
            for (const file of files) {
                const nameLow = file.name.toLowerCase();

                // Skip symbolic links (Reparse Points) to avoid infinite loops and follow user request
                if (file.isSymbolicLink()) continue;

                if (file.isFile()) {
                    if (!result.dlss && dlssFiles.includes(nameLow)) result.dlss = true;
                    if (!result.xess && xessFiles.includes(nameLow)) result.xess = true;
                    if (!result.fsr && fsrFiles.includes(nameLow)) result.fsr = true;

                    if (nameLow === 'dlss-enabler.ini') {
                        result.dlssEnabler = true;
                        result.dlssEnablerPath = current.path;
                    } else if (nameLow.startsWith('sl.') && nameLow.endsWith('.dll')) {
                        result.streamline = true;
                        if (!result.streamlinePath || current.depth > result.streamlineDepth) {
                            result.streamlinePath = current.path;
                            result.streamlineDepth = current.depth;
                            // Reset version so we read it from the deepest directory's file
                            result.streamlineVersion = null;
                        }
                        if (!result.streamlineVersion) {
                            const ver = await utils.getFileVersion(path.join(current.path, file.name));
                            if (ver) result.streamlineVersion = ver;
                        }
                    } else if (injectionDllNames.includes(nameLow)) {
                        const filePath = path.join(current.path, file.name);
                        const desc = await utils.getFileDescription(filePath);
                        const descLow = desc.toLowerCase();
                        if (descLow.includes('optiscaler')) {
                            result.optiscaler = true;
                            result.optiscalerPath = current.path;
                            if (!result.optiscalerVersion) {
                                const ver = await utils.getFileVersion(filePath);
                                if (ver) result.optiscalerVersion = ver;
                            }
                        } else if (descLow.includes('dlss enabler for dx12 gpus') || descLow.includes('dlss enabler')) {
                            result.dlssEnabler = true;
                            result.dlssEnablerPath = current.path;
                            if (!result.dlssEnablerVersion) {
                                const ver = await utils.getFileVersion(filePath);
                                if (ver) result.dlssEnablerVersion = ver;
                            }
                        }
                    } else if (nameLow === 'dlss-enabler.dll') {
                        result.dlssEnabler = true;
                        result.dlssEnablerPath = current.path;
                        if (!result.dlssEnablerVersion) {
                            const ver = await utils.getFileVersion(path.join(current.path, file.name));
                            if (ver) result.dlssEnablerVersion = ver;
                        }
                    }
                } else if (file.isDirectory()) {
                    // We still keep a small ignore list for obviously irrelevant folders to maintain performance,
                    // but depth limit is removed.
                    const shouldIgnore = ignoreFolders.some(f => nameLow === f);
                    if (!shouldIgnore) {
                        subDirs.push({ path: path.join(current.path, file.name), depth: current.depth + 1, priority: priorityFolders.includes(nameLow) });
                    }
                }
            }

            subDirs.sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0));
            queue.push(...subDirs);

            // Optimization: if we found everything, we can stop
            if (result.dlss && result.xess && result.fsr && result.dlssEnabler && result.optiscaler && result.streamline && result.dlssEnablerVersion && result.optiscalerVersion && result.streamlineVersion) return result;
        } catch (e) { }

        if (queue.length % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }

    return result;
}

async function fetchSteamGridCover(gameName) {
    if (!gameName) return null;
    const https = require('https');
    return new Promise((resolve) => {
        const searchOptions = {
            hostname: 'www.steamgriddb.com',
            path: `/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`,
            headers: { 'Authorization': `Bearer ${config.STEAMGRID_API_KEY}` },
            timeout: 10000
        };

        const req = https.get(searchOptions, (res) => {
            if (res.statusCode !== 200) return resolve(null);
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.success && result.data && result.data.length > 0) {
                        const gameId = result.data[0].id;
                        const gridOptions = {
                            hostname: 'www.steamgriddb.com',
                            path: `/api/v2/grids/game/${gameId}?dimensions=600x900`,
                            headers: { 'Authorization': `Bearer ${config.STEAMGRID_API_KEY}` },
                            timeout: 10000
                        };
                        const req2 = https.get(gridOptions, (res2) => {
                            if (res2.statusCode !== 200) return resolve(null);
                            let data2 = '';
                            res2.on('data', chunk => data2 += chunk);
                            res2.on('end', () => {
                                try {
                                    const gridResult = JSON.parse(data2);
                                    if (gridResult.success && gridResult.data && gridResult.data.length > 0) {
                                        resolve(gridResult.data[0].url);
                                    } else {
                                        resolve(null);
                                    }
                                } catch (e) { resolve(null); }
                            });
                        }).on('error', () => resolve(null));
                        req2.on('timeout', () => { req2.destroy(); resolve(null); });
                    } else {
                        resolve(null);
                    }
                } catch (e) { resolve(null); }
            });
        }).on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

async function processAndStreamGame(game, event, scanSettings) {
    console.log(`[SCANNER] Processing: ${game.name} (Source: ${game.source})`);

    // KURAL 3: Launcher & Redist Blacklist (name + exePath kontrolü)
    if (isIgnoredGame(game)) {
        console.log(`[SCANNER] Skipping launcher/redist: ${game.name}`);
        return null;
    }

    // KURAL 4: Sürücü Filtresi
    if (game.source !== 'manual' && scanSettings?.drives && scanSettings.drives.length > 0) {
        const exePathUp = (game.exePath || '').toUpperCase();
        const matchesDrive = scanSettings.drives.some(d => exePathUp.startsWith(d.toUpperCase()));
        if (!matchesDrive) {
            console.log(`[SCANNER] Skipping (drive filter): ${game.name} @ ${game.exePath}`);
            return null;
        }
    }

    const blacklistState = config.getBlacklistState();

    // If it's a manual add, we remove it from blacklist if it's there
    if (game.source === 'manual' && blacklistState.includes(game.name)) {
        console.log(`[SCANNER] Removing ${game.name} from blacklist (Manual add)`);
        const newBlacklist = blacklistState.filter(name => name !== game.name);
        config.setBlacklistState(newBlacklist);
        config.saveBlacklist();
    } else if (blacklistState.includes(game.name)) {
        console.log(`[SCANNER] Skipping ${game.name} (Blacklisted)`);
        return null;
    }

    const normName = game.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const existingGamesState = config.getExistingGamesState();

    // 2. Eşleştirme (Upsert) Mantığı: Check if game exists in current games.json state
    let existingGame = existingGamesState.find(g =>
        (g.name && g.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normName) ||
        (g.exePath && game.exePath && path.resolve(g.exePath).toLowerCase() === path.resolve(game.exePath).toLowerCase())
    );

    // Track original name to check for name changes later
    const originalName = existingGame ? existingGame.name : null;
    let finalizedName = game.name;
    let finalizedSource = game.source;

    if (existingGame) {
        // Apply manual game name and source protection/updates
        if (game.source === 'manual') {
            console.log(`[SCANNER] Updating name and source to manual -> name="${game.name}"`);
            existingGame.name = game.name;
            existingGame.source = 'manual';
        } else if (existingGame.source === 'manual') {
            console.log(`[SCANNER] Protecting existing manual game info for "${existingGame.name}" against automatic source "${game.source}"`);
            // Protect manual name and source
        } else {
            if (game.name) {
                existingGame.name = game.name;
            }
            if (game.source) {
                existingGame.source = game.source;
            }
        }
        finalizedName = existingGame.name;
        finalizedSource = existingGame.source;
    }

    // Now determine if the game name is changing
    let isNameChanging = false;
    if (existingGame && originalName && finalizedName && originalName !== finalizedName) {
        if (finalizedSource === 'manual' || existingGame.source !== 'manual') {
            isNameChanging = true;
            console.log(`[SCANNER] Name changing for game at ${game.exePath} ("${originalName}" -> "${finalizedName}"). Resetting cover to allow re-query.`);
        }
    }

    // Determine initial cached cover path safely (using empty string instead of null)
    let localCoverPath = (existingGame && !isNameChanging) ? (existingGame.cover || '') : '';
    let coverUrl = game.coverUrl;

    const tryDownload = async (url, name) => {
        if (!url) return '';
        try {
            const urlObj = new URL(url);
            const ext = path.extname(urlObj.pathname) || '.jpg';
            const fileName = `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}${ext}`;
            const destPath = path.join(config.COVERS_DIR, fileName);

            // Re-download if file is missing or suspiciously small (< 5KB)
            if (fs.existsSync(destPath) && fs.statSync(destPath).size > 5120) {
                return `file://${destPath.replace(/\\/g, '/')}`;
            }

            await utils.downloadImage(url, destPath);
            return `file://${destPath.replace(/\\/g, '/')}`;
        } catch (e) {
            return '';
        }
    };

    // Download/fetch cover only if it is not already cached or if it's empty
    if (!localCoverPath || localCoverPath === '') {
        if (coverUrl) {
            localCoverPath = await tryDownload(coverUrl, finalizedName);
        }
        if (!localCoverPath || localCoverPath === '') {
            const sgdbUrl = await fetchSteamGridCover(finalizedName);
            if (sgdbUrl) {
                localCoverPath = await tryDownload(sgdbUrl, finalizedName);
            }
        }
    }

    const detectedUpscalers = await detectUpscalers(game.exePath);
    const favoriteNames = config.getFavoriteNames();
    const isFavorite = favoriteNames.includes(finalizedName) || (existingGame && existingGame.isFavorite) || false;

    if (existingGame) {
        console.log(`[SCANNER] Existing game entry found for ${finalizedName}. Merging mod states...`);

        // 3. Mod Durumlarını Aktar (Merge statuses and version fields, prioritizing positive flags)
        existingGame.hasDlssEnabler = detectedUpscalers.dlssEnabler || existingGame.hasDlssEnabler || false;
        existingGame.dlssEnablerVersion = detectedUpscalers.dlssEnablerVersion || existingGame.dlssEnablerVersion || null;
        existingGame.dlssEnablerPath = detectedUpscalers.dlssEnablerPath || existingGame.dlssEnablerPath || null;

        existingGame.hasStreamline = detectedUpscalers.streamline || existingGame.hasStreamline || false;
        existingGame.streamlineVersion = detectedUpscalers.streamlineVersion || existingGame.streamlineVersion || null;
        existingGame.streamlinePath = detectedUpscalers.streamlinePath || existingGame.streamlinePath || null;
        existingGame.streamlineHashes = existingGame.streamlineHashes || {};

        existingGame.hasOptiscaler = detectedUpscalers.optiscaler || existingGame.hasOptiscaler || false;
        existingGame.optiscalerVersion = detectedUpscalers.optiscalerVersion || existingGame.optiscalerVersion || null;
        existingGame.optiscalerPath = detectedUpscalers.optiscalerPath || existingGame.optiscalerPath || null;
        if (detectedUpscalers.optiscalerInjection || existingGame.optiscalerInjection) {
            existingGame.optiscalerInjection = detectedUpscalers.optiscalerInjection || existingGame.optiscalerInjection || null;
        }

        // Merge upscalers object fields safely
        existingGame.upscalers = {
            dlss: detectedUpscalers.dlss || (existingGame.upscalers && existingGame.upscalers.dlss) || false,
            xess: detectedUpscalers.xess || (existingGame.upscalers && existingGame.upscalers.xess) || false,
            fsr: detectedUpscalers.fsr || (existingGame.upscalers && existingGame.upscalers.fsr) || false,
            dlssEnabler: existingGame.hasDlssEnabler,
            optiscaler: existingGame.hasOptiscaler,
            streamline: existingGame.hasStreamline
        };

        // Update basic non-mod info
        if (game.exePath && game.exePath !== existingGame.exePath) {
            existingGame.exePath = game.exePath;
        }
        const derivedRoot = game.gameRoot || (game.exePath && fs.existsSync(game.exePath) && fs.statSync(game.exePath).isDirectory() ? game.exePath : path.dirname(game.exePath));
        if (derivedRoot) {
            existingGame.gameRoot = derivedRoot;
        }
        if (isNameChanging || localCoverPath) {
            existingGame.cover = localCoverPath || null;
        }
        existingGame.isFavorite = isFavorite;

        config.saveGamesState();

        if (currentScanFoundGames) {
            getGameKeys(finalizedName, existingGame.exePath).forEach(k => currentScanFoundGames.add(k));
        }

        console.log(`[SCANNER] ${finalizedName} updated and merged with existing mod metadata.`);
        if (event) {
            event.sender.send('game-found', existingGame);
        }
        return existingGame;
    } else {
        // 4. Sadece Eksikleri Ekle: Complete creation for a brand new game
        console.log(`[SCANNER] New game detected. Creating entry for ${finalizedName}...`);
        const derivedRoot = game.gameRoot || (game.exePath && fs.existsSync(game.exePath) && fs.statSync(game.exePath).isDirectory() ? game.exePath : path.dirname(game.exePath));
        const finalGame = {
            name: finalizedName,
            exePath: game.exePath,
            gameRoot: derivedRoot,
            cover: localCoverPath || null,
            source: finalizedSource,
            hasDlssEnabler: detectedUpscalers.dlssEnabler,
            hasOptiscaler: detectedUpscalers.optiscaler || false,
            hasStreamline: detectedUpscalers.streamline || false,
            dlssEnablerVersion: detectedUpscalers.dlssEnablerVersion,
            dlssEnablerPath: detectedUpscalers.dlssEnablerPath || null,
            optiscalerVersion: detectedUpscalers.optiscalerVersion,
            optiscalerPath: detectedUpscalers.optiscalerPath || null,
            streamlineVersion: detectedUpscalers.streamlineVersion,
            streamlinePath: detectedUpscalers.streamlinePath,
            streamlineHashes: {},
            upscalers: detectedUpscalers,
            isFavorite: isFavorite
        };

        existingGamesState.push(finalGame);
        config.markNeedsDedup(); // FIX 5b: Signal that dedup is needed before next save
        config.saveGamesState();

        if (currentScanFoundGames) {
            getGameKeys(finalizedName, finalGame.exePath).forEach(k => currentScanFoundGames.add(k));
        }

        console.log(`[SCANNER] ${game.name} saved and streaming to UI`);

        if (event) {
            event.sender.send('game-found', finalGame);
        }
        return finalGame;
    }
}

async function scanSteamGames(event, progressTracker, scanSettings) {
    // FIX 5a: Detect Steam install path from Windows Registry first, then fall back to default.
    let steamInstallPath = 'C:\\Program Files (x86)\\Steam';
    try {
        const { execSync } = require('child_process');
        const regOutput = execSync(
            'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath 2>nul || reg query "HKLM\\SOFTWARE\\Valve\\Steam" /v InstallPath 2>nul',
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const match = regOutput.match(/InstallPath\s+REG_SZ\s+(.+)/i);
        if (match && match[1].trim()) {
            steamInstallPath = match[1].trim();
            console.log(`[STEAM-SCAN] Steam kurulum yolu Registry'den okundu: ${steamInstallPath}`);
        }
    } catch (e) {
        console.log(`[STEAM-SCAN] Registry okunamadı, varsayılan yol kullanılıyor: ${steamInstallPath}`);
    }

    const vdfPath = path.join(steamInstallPath, 'steamapps', 'libraryfolders.vdf');
    const libraryPaths = [steamInstallPath];

    if (fs.existsSync(vdfPath)) {
        try {
            const vdfContent = fs.readFileSync(vdfPath, 'utf-8');
            const pathRegex = /"path"\s+"([^"]+)"/g;
            let match;
            while ((match = pathRegex.exec(vdfContent)) !== null) {
                const libPath = match[1].replace(/\\\\/g, '\\');
                if (!libraryPaths.includes(libPath)) {
                    libraryPaths.push(libPath);
                }
            }
        } catch (e) {
            console.error("Error parsing libraryfolders.vdf", e);
        }
    }

    const apps = [];
    for (const libPath of libraryPaths) {
        const steamAppsPath = path.join(libPath, 'steamapps');
        if (fs.existsSync(steamAppsPath)) {
            const files = fs.readdirSync(steamAppsPath);
            for (const file of files) {
                if (file.endsWith('.acf')) {
                    apps.push({ libPath, file });
                }
            }
        }
    }

    if (progressTracker) progressTracker.total += apps.length;

    for (const app of apps) {
        try {
            const steamAppsPath = path.join(app.libPath, 'steamapps');
            const content = fs.readFileSync(path.join(steamAppsPath, app.file), 'utf-8');
            const nameMatch = content.match(/"name"\s+"([^"]+)"/i);
            const appidMatch = content.match(/"appid"\s+"([^"]+)"/i);
            const installDirMatch = content.match(/"installdir"\s+"([^"]+)"/i);

            if (nameMatch && appidMatch && installDirMatch) {
                if (nameMatch[1].toLowerCase().includes('redistributable')) {
                    if (progressTracker) progressTracker.current++;
                    continue;
                }

                await processAndStreamGame({
                    name: nameMatch[1],
                    id: appidMatch[1],
                    exePath: path.join(steamAppsPath, 'common', installDirMatch[1]),
                    source: 'steam',
                    coverUrl: `https://steamcdn-a.akamaihd.net/steam/apps/${appidMatch[1]}/library_600x900.jpg`
                }, event, scanSettings);
            }
        } catch (err) { }
        if (progressTracker) {
            progressTracker.current++;
            const percent = Math.round((progressTracker.current / progressTracker.total) * 100);
            if (event) event.sender.send('scan-progress', percent);
        }
    }
}

async function scanEpicGames(event, progressTracker, scanSettings) {
    const epicPath = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
    if (fs.existsSync(epicPath)) {
        const files = fs.readdirSync(epicPath).filter(f => f.endsWith('.item'));
        if (progressTracker) progressTracker.total += files.length;

        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(epicPath, file), 'utf-8');
                const data = JSON.parse(content);
                if (data.DisplayName && data.InstallLocation) {
                    await processAndStreamGame({
                        name: data.DisplayName,
                        id: data.AppName,
                        exePath: data.InstallLocation,
                        source: 'epic',
                        coverUrl: null
                    }, event, scanSettings);
                }
            } catch (err) { }
            if (progressTracker) {
                progressTracker.current++;
                const percent = Math.round((progressTracker.current / progressTracker.total) * 100);
                if (event) event.sender.send('scan-progress', percent);
            }
        }
    }
}

async function scanRegistryGames(event, progressTracker, scanSettings) {
    // Build allowed publishers based on selected sources
    const selectedSources = scanSettings?.sources || ['GOG', 'EA', 'Ubisoft', 'Xbox'];
    const publisherMap = [
        { src: 'GOG', pub: 'gog.com' },
        { src: 'EA', pub: 'electronic arts' },
        { src: 'Ubisoft', pub: 'ubisoft' },
        { src: 'Xbox', pub: 'xbox' },
        { src: 'Xbox', pub: 'microsoft studios' },
        { src: 'Xbox', pub: 'xbox game studios' },
        { src: 'Xbox', pub: 'microsoft game studios' },
    ];
    const allowedPublishers = publisherMap
        .filter(pm => selectedSources.includes(pm.src))
        .map(pm => pm.pub);

    // Always include rockstar and cd projekt red (they match no user-selectable source, just 'registry')
    allowedPublishers.push('rockstar games', 'cd projekt red');

    if (allowedPublishers.length === 0) return;

    const psCommand = `Get-ItemProperty HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and $_.InstallLocation -and $_.Publisher } | Select-Object DisplayName, InstallLocation, Publisher | ConvertTo-Json -Compress`;

    return new Promise((resolve) => {
        exec(`powershell -NoProfile -Command "${psCommand}"`, { maxBuffer: 1024 * 1024 * 10 }, async (error, stdout) => {
            if (error || !stdout) {
                resolve();
                return;
            }
            try {
                let parsed = JSON.parse(stdout);
                if (!Array.isArray(parsed)) parsed = [parsed];

                if (progressTracker) progressTracker.total += parsed.length;

                for (const app of parsed) {
                    if (app.Publisher && app.DisplayName && app.InstallLocation) {
                        const pub = app.Publisher.toLowerCase();
                        const isGamePub = allowedPublishers.some(p => pub.includes(p));
                        if (isGamePub) {
                            let source = 'registry';
                            if (pub.includes('gog.com')) source = 'gog';
                            else if (pub.includes('electronic arts')) source = 'ea';
                            else if (pub.includes('ubisoft')) source = 'ubisoft';
                            else if (pub.includes('rockstar games')) source = 'rockstar';
                            else if (pub.includes('xbox') || pub.includes('microsoft')) source = 'xbox';

                            await processAndStreamGame({
                                name: app.DisplayName,
                                id: app.DisplayName,
                                exePath: app.InstallLocation,
                                source: source,
                                coverUrl: null
                            }, event, scanSettings);
                        }
                    }
                    if (progressTracker) {
                        progressTracker.current++;
                        const percent = Math.round((progressTracker.current / progressTracker.total) * 100);
                        if (event) event.sender.send('scan-progress', percent);
                    }
                }
            } catch (e) {
                console.error("Registry parse error", e);
            }
            resolve();
        });
    });
}

async function scanUserRegisteredGames(event, progressTracker, scanSettings) {
    console.log('[SCANNER] Scanning user-registered games (user-games.json)...');
    try {
        const userGames = config.getUserGames();
        const entries = Object.entries(userGames);
        console.log(`[SCANNER] Found ${entries.length} user-registered entries`);

        if (progressTracker) progressTracker.total += entries.length;

        for (const [normKey, info] of entries) {
            // game_root must exist and be a real directory
            if (info.game_root && fs.existsSync(info.game_root)) {
                // Prefer the explicitly stored exe_path; fall back to game_root
                const exePath = (info.exe_path && fs.existsSync(info.exe_path))
                    ? info.exe_path
                    : info.game_root;

                // Derive a display name: prefer stored display_name, otherwise un-kebab the key
                const displayName = info.display_name
                    || normKey.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

                console.log(`[SCANNER] Processing user game: ${displayName} -> ${exePath}`);
                // Manual games always scanned; pass null drives/sources (rule 4 skips manual)
                await processAndStreamGame({
                    name: displayName,
                    exePath: exePath,
                    gameRoot: info.game_root,
                    source: 'manual',
                    coverUrl: null
                }, event, scanSettings);
            } else {
                console.warn(`[SCANNER] User game_root not found or missing: ${normKey} -> ${info.game_root}`);
            }

            if (progressTracker) {
                progressTracker.current++;
                const percent = Math.round((progressTracker.current / progressTracker.total) * 100);
                if (event) event.sender.send('scan-progress', percent);
            }
        }
    } catch (e) {
        console.error('[SCANNER] ERROR scanning user-registered games:', e);
    }
}

// ── KURAL 1: coversOnly Bypass ────────────────────────────────────────────────
/**
 * Scans existing games.json and fetches covers only for entries where cover is null/empty.
 * Never re-downloads existing covers to avoid SteamGridDB rate limits.
 */
async function refreshMissingCovers(event) {
    console.log('[SCANNER] coversOnly mode: refreshing missing covers...');
    const games = config.getExistingGamesState();
    const missing = games.filter(g => !g.cover || g.cover === '');
    console.log(`[SCANNER] ${missing.length} games need cover refresh (out of ${games.length} total)`);

    for (const game of missing) {
        try {
            const sgdbUrl = await fetchSteamGridCover(game.name);
            if (sgdbUrl) {
                const urlObj = new URL(sgdbUrl);
                const ext = path.extname(urlObj.pathname) || '.jpg';
                const fileName = `${game.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}${ext}`;
                const destPath = path.join(config.COVERS_DIR, fileName);

                if (!fs.existsSync(destPath) || fs.statSync(destPath).size <= 5120) {
                    await utils.downloadImage(sgdbUrl, destPath);
                }
                game.cover = `file://${destPath.replace(/\\/g, '/')}`;
                config.saveGamesState();

                if (event) event.sender.send('game-found', game);
                console.log(`[SCANNER] Cover downloaded for: ${game.name}`);
            }
        } catch (e) {
            console.warn(`[SCANNER] Cover fetch failed for ${game.name}: ${e.message}`);
        }
    }
}

// ── Ana Orkestratör ───────────────────────────────────────────────────────────
/**
 * Main scan entry point called from ipc.js.
 * scanSettings = { coversOnly: bool, drives: string[], sources: string[] }
 */
async function runScan(event, scanSettings) {
    console.log('[SCANNER] runScan called with settings:', JSON.stringify(scanSettings));

    // KURAL 1: coversOnly bypass — sadece eksik kapakları yenile
    if (scanSettings?.coversOnly) {
        await refreshMissingCovers(event);
        return;
    }

    currentScanFoundGames = new Set();

    const progressTracker = { total: 0, current: 0 };

    // Disk'ten mevcut veriyi belleğe yükle (veriyi koruma amaçlı)
    config.loadExistingGames();

    // KURAL 2: Kaynak Filtresi — sadece seçili platformları tara
    const sources = scanSettings?.sources || ['Steam', 'Epic', 'GOG', 'EA', 'Ubisoft', 'Xbox'];
    console.log(`[SCANNER] Scanning sources: ${sources.join(', ')}`);

    if (sources.includes('Steam')) {
        await scanSteamGames(event, progressTracker, scanSettings);
    }
    if (sources.includes('Epic')) {
        await scanEpicGames(event, progressTracker, scanSettings);
    }
    const registrySources = ['GOG', 'EA', 'Ubisoft', 'Xbox'];
    if (registrySources.some(s => sources.includes(s))) {
        await scanRegistryGames(event, progressTracker, scanSettings);
    }
    // Manuel oyunlar her zaman taranır
    await scanUserRegisteredGames(event, progressTracker, scanSettings);

    // KURAL 5: Akıllı Stale Cleanup
    // Sadece taranan disk+kaynak kapsamındaki oyunları temizle.
    // Kapsam dışındaki oyunlara kesinlikle dokunma.
    const scannedDrives = new Set((scanSettings?.drives || []).map(d => d.toUpperCase()));
    const scannedSources = new Set(sources);

    // games.json'daki source -> modal source adı eşleşme tablosu
    const sourceMap = {
        steam: 'Steam',
        epic: 'Epic',
        gog: 'GOG',
        ea: 'EA',
        ubisoft: 'Ubisoft',
        xbox: 'Xbox',
        rockstar: 'Xbox',  // Rockstar, Xbox altında registry'den gelir
        registry: null,    // Bilinmeyen registry kaynağı — güvende tut
    };

    const gamesState = config.getExistingGamesState();
    const cleanedGames = gamesState.filter(g => {
        // Manuel oyunlara dokunma
        if (g.source === 'manual') return true;

        // Bu oyun taranan kaynak kapsamında mı?
        const mappedSource = sourceMap[g.source] || null;
        const inScannedSource = mappedSource && scannedSources.has(mappedSource);

        // Bu oyun taranan disk kapsamında mı?
        const gameDriveLetter = (g.exePath || '').substring(0, 2).toUpperCase();
        const inScannedDrive = scannedDrives.size === 0 || scannedDrives.has(gameDriveLetter);

        // Her iki kapsam içindeyse ve bu taramada bulunamadıysa → sil
        if (inScannedSource && inScannedDrive) {
            const keys = getGameKeys(g.name, g.exePath);
            const wasFoundThisScan = keys.some(k => currentScanFoundGames.has(k));
            if (!wasFoundThisScan) {
                console.log(`[SCANNER] Stale game removed (not found in current scan scope): ${g.name}`);
                return false;
            }
            return true;
        }

        // Kapsam dışı → koru
        return true;
    });

    config.setExistingGamesState(cleanedGames);
    config.saveGamesState();
    currentScanFoundGames = null;
    console.log(`[SCANNER] runScan complete. ${cleanedGames.length} games in state.`);
}

module.exports = {
    isIgnoredGame,
    detectUpscalers,
    processAndStreamGame,
    scanSteamGames,
    scanEpicGames,
    scanRegistryGames,
    scanUserRegisteredGames,
    refreshMissingCovers,
    runScan
};
