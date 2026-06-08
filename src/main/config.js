const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const STEAMGRID_API_KEY = 'b89ed9f1ab39a34c3b8ea71d756403ce';

// Note that config.js is inside src/main, so __dirname is projectRoot/src/main.
// In packaged builds, extraResources are placed under process.resourcesPath.
const projectRoot = app.isPackaged 
    ? process.resourcesPath
    : path.resolve(__dirname, '..', '..');

// Helper to lazily evaluate paths after app is ready
function getGamesFile() { return path.join(app.getPath('userData'), 'games.json'); }
function getBlacklistFile() { return path.join(app.getPath('userData'), 'blacklist.json'); }
function getCoversDir() {
    const dir = path.join(app.getPath('userData'), 'covers');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function getModsPath() {
    const dir = path.join(app.getPath('userData'), 'mods');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function getStreamlineModsPath() {
    const dir = path.join(getModsPath(), 'streamline');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function getUserGamesFile() { return path.join(app.getPath('userData'), 'user-games.json'); }
function getCustomFoldersFile() { return path.join(app.getPath('userData'), 'custom-folders.json'); }
function getCustomSubfoldersStateFile() { return path.join(app.getPath('userData'), 'custom-subfolders-state.json'); }
function getModPresetsFile() { return path.join(app.getPath('userData'), 'mod-presets.json'); }

const DEVELOPER_GAMES_FILE = path.join(projectRoot, 'developer-games.json');

// Clean up old program-directory mods folder if it exists (run on app ready)
function cleanOldModsFolder() {
    const oldModsPath = path.join(projectRoot, 'mods');
    if (fs.existsSync(oldModsPath)) {
        try {
            fs.rmSync(oldModsPath, { recursive: true, force: true });
            console.log('[CONFIG] Old program mods folder cleaned up successfully.');
        } catch (e) {
            console.warn('[CONFIG] Failed to clean up old mods folder:', e.message);
        }
    }
}

/**
 * M-16: Atomic write — writes to a temp file then renames.
 * Prevents data loss if the process crashes during a write.
 */
function atomicWriteFile(filePath, content) {
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
}


// Global state
let existingGamesState = [];
let blacklistState = [];
let favoriteNames = []; // Persistent list of favorited game names
// FIX 5b: Dirty flag to avoid running deduplicateState on every save
let needsDedup = false;

// --- Dual-layer game path system ---

/**
 * Normalizes a game name to a kebab-case key for JSON lookup.
 * "Cyberpunk 2077"         → "cyberpunk-2077"
 * "The Witcher 3: Wild Hunt" → "the-witcher-3-wild-hunt"
 * For manual folder adds, pass the folder basename.
 */
function normalizeGameKey(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')   // strip special chars (colons, apostrophes, etc.)
        .trim()
        .replace(/\s+/g, '-');          // spaces → hyphens
}

/** Load developer-games.json (read-only, cached in memory after first read). */
let _devGamesCache = null;
function getDeveloperGames() {
    if (_devGamesCache !== null) return _devGamesCache;
    try {
        if (fs.existsSync(DEVELOPER_GAMES_FILE)) {
            _devGamesCache = JSON.parse(fs.readFileSync(DEVELOPER_GAMES_FILE, 'utf-8'));
        } else {
            _devGamesCache = {};
        }
    } catch (e) {
        console.error('[CONFIG] Could not read developer-games.json:', e.message);
        _devGamesCache = {};
    }
    return _devGamesCache;
}

/** Load user-games.json (always read from disk — user may have changed it). */
function getUserGames() {
    try {
        const file = getUserGamesFile();
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf-8'));
        }
    } catch (e) {
        console.error('[CONFIG] Could not read user-games.json:', e.message);
    }
    return {};
}

/** Persist user-games.json to disk. */
function saveUserGames(data) {
    try {
        const file = getUserGamesFile();
        // M-16: Atomic write to prevent data loss on crash
        atomicWriteFile(file, JSON.stringify(data, null, 2));
        console.log('[CONFIG] user-games.json saved.');
    } catch (e) {
        console.error('[CONFIG] Could not write user-games.json:', e.message);
        throw e;
    }
}

/**
 * Central path resolver — the single source of truth for all mod installers.
 *
 * Priority:
 *  1. user-games.json  → exact exe_path + game_root  (source: 'user')
 *  2. scan result + developer-games.json               (source: 'scan+dev')
 *  3. scan result only                                 (source: 'scan')
 *  4. null — nothing found
 *
 * @param {string} gameName   - Display name from scanner / game card (e.g. "Cyberpunk 2077")
 * @param {string} gameExePath - exePath stored in games.json (may be dir or .exe)
 * @returns {{ game_root: string, exe_path: string, source: string } | null}
 */
function getGamePaths(gameName, gameExePath) {
    const normKey = normalizeGameKey(gameName || '');

    // --- Priority 1: user-games.json ---
    const userGames = getUserGames();
    if (userGames[normKey] && userGames[normKey].game_root) {
        const u = userGames[normKey];
        console.log(`[CONFIG] getGamePaths("${gameName}"): source=user, game_root=${u.game_root}`);
        return {
            game_root: u.game_root,
            exe_path: u.exe_path || u.game_root,
            source: 'user'
        };
    }

    // --- Priority 2 & 3: Derive game_root from scanned exePath ---
    if (!gameExePath) {
        console.log(`[CONFIG] getGamePaths("${gameName}"): no exePath, returning null`);
        return null;
    }

    let game_root;
    try {
        const stats = fs.existsSync(gameExePath) ? fs.statSync(gameExePath) : null;
        game_root = (stats && stats.isDirectory()) ? gameExePath : path.dirname(gameExePath);
    } catch (e) {
        game_root = path.dirname(gameExePath);
    }

    // Priority 2: scan + developer-games.json
    const devGames = getDeveloperGames();
    if (devGames[normKey] && devGames[normKey].exe_relative_path) {
        const relPath = devGames[normKey].exe_relative_path.replace(/\//g, path.sep);
        const exe_path = path.join(game_root, relPath);
        console.log(`[CONFIG] getGamePaths("${gameName}"): source=scan+dev, exe_path=${exe_path}`);
        return { game_root, exe_path, source: 'scan+dev' };
    }

    // Priority 3: scan only — use whatever the scanner found
    console.log(`[CONFIG] getGamePaths("${gameName}"): source=scan, exe_path=${gameExePath}`);
    return { game_root, exe_path: gameExePath, source: 'scan' };
}

/**
 * Smart heuristic game_root resolver that prevents storing binaries subfolders (like Binaries/Win64)
 * as the game_root for scanned or manually added games when choosing a mod exe.
 */
function resolveActualGameRoot(gameName, chosenExePath) {
    if (!chosenExePath) return null;
    const normKey = normalizeGameKey(gameName || '');
    const normTargetName = gameName ? gameName.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    const dbGame = existingGamesState.find(g => {
        if (normTargetName && g.name && g.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normTargetName) {
            return true;
        }
        return false;
    });

    // 1. If dbGame has a gameRoot property (which we populate during scanning), use it!
    if (dbGame && dbGame.gameRoot && fs.existsSync(dbGame.gameRoot)) {
        return dbGame.gameRoot;
    }

    // 2. Steam Library Folder Heuristic: Matches ".../steamapps/common/Nuclear Nightmare/..."
    const normPath = chosenExePath.replace(/\\/g, '/');
    const steamMatch = normPath.match(/(.*\/steamapps\/common\/[^\/]+)/i);
    if (steamMatch) {
        return path.resolve(steamMatch[1]);
    }

    // 3. Epic Manifest Heuristic
    if (dbGame && dbGame.source === 'epic') {
        const epicPath = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
        if (fs.existsSync(epicPath)) {
            try {
                const files = fs.readdirSync(epicPath).filter(f => f.endsWith('.item'));
                for (const file of files) {
                    const content = fs.readFileSync(path.join(epicPath, file), 'utf-8');
                    const data = JSON.parse(content);
                    if (data.DisplayName && data.DisplayName.toLowerCase() === gameName.toLowerCase() && data.InstallLocation) {
                        if (fs.existsSync(data.InstallLocation)) {
                            return data.InstallLocation;
                        }
                    }
                }
            } catch(e) {}
        }
    }

    // 4. Developer-games mapping heuristic: e.g. control is registered with relative path
    const devGames = getDeveloperGames();
    if (devGames[normKey] && devGames[normKey].exe_relative_path) {
        const relPath = devGames[normKey].exe_relative_path.toLowerCase().replace(/\\/g, '/');
        const fullPathNorm = chosenExePath.toLowerCase().replace(/\\/g, '/');
        if (fullPathNorm.endsWith(relPath)) {
            const index = fullPathNorm.lastIndexOf(relPath);
            let root = chosenExePath.substring(0, index);
            if (root.endsWith('/') || root.endsWith('\\')) {
                root = root.slice(0, -1);
            }
            return root;
        }
    }

    // 5. Existing userGame fallback (only if not obviously wrong/deeply nested in binaries)
    const userGames = getUserGames();
    if (userGames[normKey] && userGames[normKey].game_root) {
        const rootLow = userGames[normKey].game_root.toLowerCase().replace(/\\/g, '/');
        const isSuspiciousBin = rootLow.endsWith('/binaries/win64') ||
                                rootLow.endsWith('/bin/x64') ||
                                rootLow.endsWith('/bin/x64_dx12') ||
                                rootLow.endsWith('/binaries/win32') ||
                                rootLow.endsWith('/win64');
        if (!isSuspiciousBin) {
            return userGames[normKey].game_root;
        }
    }

    // 6. Heuristic to strip common game binaries directories from the chosen EXE path
    const directoriesToStrip = [
        /([^\/]+)\/Binaries\/Win64/i,
        /([^\/]+)\/Binaries\/Win32/i,
        /([^\/]+)\/bin\/x64/i,
        /([^\/]+)\/bin\/x64_dx12/i,
        /([^\/]+)\/bin\/win64/i,
        /([^\/]+)\/bin\/win32/i,
        /([^\/]+)\/bin\/x86/i
    ];
    for (const regex of directoriesToStrip) {
        const match = normPath.match(regex);
        if (match) {
            const idx = normPath.indexOf(match[0]);
            let root = chosenExePath.substring(0, idx + match[1].length);
            if (root.endsWith('/') || root.endsWith('\\')) {
                root = root.slice(0, -1);
            }
            return root;
        }
    }

    // 7. General fallback: if dbGame.exePath before update was a directory and exists, use it
    if (dbGame && dbGame.exePath) {
        try {
            const stats = fs.statSync(dbGame.exePath);
            if (stats.isDirectory()) {
                return dbGame.exePath;
            }
        } catch(e) {}
    }

    // 8. Absolute fallback
    return path.dirname(chosenExePath);
}

// --- Existing game state management (unchanged) ---

function loadExistingGames() {
    const file = getGamesFile();
    if (fs.existsSync(file)) {
        try {
            // M-17: Handle corrupt JSON gracefully — backup and reset instead of crash
            const rawData = fs.readFileSync(file, 'utf-8');
            const rawGames = JSON.parse(rawData);
            if (Array.isArray(rawGames)) {
                existingGamesState = rawGames;
                // Re-populate favoriteNames from loaded games
                favoriteNames = existingGamesState.filter(g => g.isFavorite).map(g => g.name);
                needsDedup = true; // Mark as needing dedup after load
                deduplicateState();
                saveGamesState(); // Save the cleaned state back
            } else {
                existingGamesState = [];
            }
        } catch (e) {
            // M-17: JSON parse failure — back up corrupt file and start fresh
            console.error('[CONFIG] games.json is corrupt, backing up and resetting:', e.message);
            try {
                const backupFile = file + '.corrupt.' + Date.now() + '.bak';
                fs.copyFileSync(file, backupFile);
                console.warn('[CONFIG] Corrupt games.json backed up to:', backupFile);
            } catch (backupErr) {
                console.warn('[CONFIG] Could not backup corrupt file:', backupErr.message);
            }
            existingGamesState = [];
        }
    }
}

function loadBlacklist() {
    const file = getBlacklistFile();
    if (fs.existsSync(file)) {
        try {
            blacklistState = JSON.parse(fs.readFileSync(file, 'utf-8'));
        } catch (e) {
            blacklistState = [];
        }
    }
}

function deduplicateState() {
    const unique = [];
    const seenNames = new Set();
    
    // Sort so that steam/epic versions or versions with mod info are preferred when merging
    const sorted = [...existingGamesState].sort((a, b) => {
        const scoreA = (a.hasDlssEnabler ? 5 : 0) + (a.hasOptiscaler ? 5 : 0) + (a.hasStreamline ? 5 : 0) + (a.cover ? 3 : 0) + (a.source !== 'manual' ? 2 : 0);
        const scoreB = (b.hasDlssEnabler ? 5 : 0) + (b.hasOptiscaler ? 5 : 0) + (b.hasStreamline ? 5 : 0) + (b.cover ? 3 : 0) + (b.source !== 'manual' ? 2 : 0);
        return scoreB - scoreA;
    });

    for (const game of sorted) {
        if (!game || !game.name) continue;
        const normName = game.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!seenNames.has(normName)) {
            seenNames.add(normName);
            unique.push(game);
        } else {
            const existing = unique.find(g => g.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normName);
            if (existing) {
                if (game.hasDlssEnabler) {
                    existing.hasDlssEnabler = true;
                    if (game.dlssEnablerVersion) existing.dlssEnablerVersion = game.dlssEnablerVersion;
                    if (game.dlssEnablerPath) existing.dlssEnablerPath = game.dlssEnablerPath;
                }
                if (game.hasOptiscaler) {
                    existing.hasOptiscaler = true;
                    if (game.optiscalerVersion) existing.optiscalerVersion = game.optiscalerVersion;
                    if (game.optiscalerInjection) existing.optiscalerInjection = game.optiscalerInjection;
                    if (game.optiscalerPath) existing.optiscalerPath = game.optiscalerPath;
                }
                if (game.hasStreamline) {
                    existing.hasStreamline = true;
                    if (game.streamlineVersion) existing.streamlineVersion = game.streamlineVersion;
                    if (game.streamlinePath) existing.streamlinePath = game.streamlinePath;
                    if (game.streamlineModVersion) existing.streamlineModVersion = game.streamlineModVersion;
                    if (game.streamlineHashes) {
                        existing.streamlineHashes = { ...existing.streamlineHashes, ...game.streamlineHashes };
                    }
                }
                if (game.upscalers) {
                    existing.upscalers = { ...existing.upscalers, ...game.upscalers };
                }
                if (game.exePath && game.exePath.endsWith('.exe')) {
                    existing.exePath = game.exePath;
                }
                // Protect manual source and name over automatic scans
                if (existing.source !== 'manual' && game.source === 'manual') {
                    existing.source = 'manual';
                    if (game.name) {
                        existing.name = game.name;
                    }
                }
                // Merge cover if duplicate has it
                if (game.cover && !existing.cover) {
                    existing.cover = game.cover;
                }
            }
        }
    }
    
    existingGamesState = unique;
    // FIX 5b: Reset dirty flag after dedup completes
    needsDedup = false;
}

function saveGamesState() {
    console.log(`[CONFIG] Saving game state (${existingGamesState.length} games)...`);
    // Only run deduplicateState when the state has actually changed (dirty flag)
    if (needsDedup) {
        deduplicateState();
        needsDedup = false;
    }
    const file = getGamesFile();
    // M-16: Atomic write to prevent data loss on crash
    atomicWriteFile(file, JSON.stringify(existingGamesState, null, 2));
    console.log(`[CONFIG] Game state written to ${file}`);
}

function saveBlacklist() {
    console.log(`[CONFIG] Saving blacklist (${blacklistState.length} games)...`);
    const file = getBlacklistFile();
    // M-16: Atomic write
    atomicWriteFile(file, JSON.stringify(blacklistState, null, 2));
}

function getCustomFolders() {
    try {
        const file = getCustomFoldersFile();
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf-8'));
        }
    } catch (e) {
        console.error('[CONFIG] Could not read custom-folders.json:', e.message);
    }
    return [];
}

function saveCustomFolders(folders) {
    try {
        const file = getCustomFoldersFile();
        // M-16: Atomic write
        atomicWriteFile(file, JSON.stringify(folders, null, 2));
        console.log('[CONFIG] custom-folders.json saved.');
    } catch (e) {
        console.error('[CONFIG] Could not write custom-folders.json:', e.message);
        throw e;
    }
}

function getCustomSubfoldersState() {
    try {
        const file = getCustomSubfoldersStateFile();
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf-8'));
        }
    } catch (e) {
        console.error('[CONFIG] Could not read custom-subfolders-state.json:', e.message);
    }
    return {};
}

function saveCustomSubfoldersState(state) {
    try {
        const file = getCustomSubfoldersStateFile();
        // M-16: Atomic write
        atomicWriteFile(file, JSON.stringify(state, null, 2));
        console.log('[CONFIG] custom-subfolders-state.json saved.');
    } catch (e) {
        console.error('[CONFIG] Could not write custom-subfolders-state.json:', e.message);
        throw e;
    }
}

/** Read user-saved mod presets for a given mod ('dlss-enabler' | 'optiscaler'). */
function getModPresets(mod) {
    try {
        const file = getModPresetsFile();
        if (fs.existsSync(file)) {
            const all = JSON.parse(fs.readFileSync(file, 'utf-8'));
            return Array.isArray(all[mod]) ? all[mod] : [];
        }
    } catch (e) {
        console.error('[CONFIG] Could not read mod-presets.json:', e.message);
    }
    return [];
}

/** Save user presets for a given mod into mod-presets.json. */
function saveModPresets(mod, presets) {
    try {
        const file = getModPresetsFile();
        let all = {};
        if (fs.existsSync(file)) {
            try { all = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch(_) {}
        }
        all[mod] = presets;
        atomicWriteFile(file, JSON.stringify(all, null, 2));
        console.log(`[CONFIG] mod-presets.json saved for mod="${mod}".`);
    } catch (e) {
        console.error('[CONFIG] Could not write mod-presets.json:', e.message);
        throw e;
    }
}

module.exports = {
    STEAMGRID_API_KEY,
    get GAMES_FILE() { return getGamesFile(); },
    get BLACKLIST_FILE() { return getBlacklistFile(); },
    get COVERS_DIR() { return getCoversDir(); },
    get modsPath() { return getModsPath(); },
    get streamlineModsPath() { return getStreamlineModsPath(); },
    DEVELOPER_GAMES_FILE,
    get USER_GAMES_FILE() { return getUserGamesFile(); },
    cleanOldModsFolder,
    
    // Dual-layer path system
    normalizeGameKey,
    getDeveloperGames,
    getUserGames,
    saveUserGames,
    getGamePaths,
    resolveActualGameRoot,
    
    getExistingGamesState: () => existingGamesState,
    setExistingGamesState: (newState) => { existingGamesState = newState; needsDedup = true; }, // FIX 5b
    markNeedsDedup: () => { needsDedup = true; }, // FIX 5b: Allow external modules to trigger dedup
    getBlacklistState: () => blacklistState,
    setBlacklistState: (newState) => { blacklistState = newState; },
    
    loadExistingGames,
    loadBlacklist,
    saveGamesState,
    saveBlacklist,
    deduplicateState,
    getFavoriteNames: () => favoriteNames,
    toggleFavorite: (gameName) => {
        const game = existingGamesState.find(g => g.name === gameName);
        if (game) {
            game.isFavorite = !game.isFavorite;
            if (game.isFavorite) {
                if (!favoriteNames.includes(gameName)) favoriteNames.push(gameName);
            } else {
                favoriteNames = favoriteNames.filter(n => n !== gameName);
            }
            saveGamesState();
        }
        return existingGamesState;
    },

    // Custom scan folders helper methods
    getCustomFolders,
    saveCustomFolders,
    getCustomSubfoldersState,
    saveCustomSubfoldersState,

    // Mod presets
    getModPresets,
    saveModPresets
};
