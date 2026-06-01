const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const STEAMGRID_API_KEY = 'b89ed9f1ab39a34c3b8ea71d756403ce';
const GAMES_FILE = path.join(app.getPath('userData'), 'games.json');
const BLACKLIST_FILE = path.join(app.getPath('userData'), 'blacklist.json');
const COVERS_DIR = path.join(app.getPath('userData'), 'covers');

// Note that config.js is inside src/main, so __dirname is projectRoot/src/main.
// In packaged builds, extraResources are placed under process.resourcesPath.
const projectRoot = app.isPackaged 
    ? process.resourcesPath
    : path.resolve(__dirname, '..', '..');

const modsPath = path.join(projectRoot, 'mods');
const streamlineModsPath = path.join(modsPath, 'streamline');

// New dual-layer path system
const DEVELOPER_GAMES_FILE = path.join(projectRoot, 'developer-games.json');
const USER_GAMES_FILE = path.join(app.getPath('userData'), 'user-games.json');
const CUSTOM_FOLDERS_FILE = path.join(app.getPath('userData'), 'custom-folders.json');
const CUSTOM_SUBFOLDERS_STATE_FILE = path.join(app.getPath('userData'), 'custom-subfolders-state.json');

// Ensure directories exist
if (!fs.existsSync(COVERS_DIR)) {
    fs.mkdirSync(COVERS_DIR, { recursive: true });
}
if (!fs.existsSync(streamlineModsPath)) {
    fs.mkdirSync(streamlineModsPath, { recursive: true });
}

console.log('--- FILE PATH CONFIGURATION ---');
console.log('GAMES_FILE:', GAMES_FILE);
console.log('BLACKLIST_FILE:', BLACKLIST_FILE);
console.log('COVERS_DIR:', COVERS_DIR);
console.log('DEVELOPER_GAMES_FILE:', DEVELOPER_GAMES_FILE);
console.log('USER_GAMES_FILE:', USER_GAMES_FILE);
console.log('CUSTOM_FOLDERS_FILE:', CUSTOM_FOLDERS_FILE);
console.log('CUSTOM_SUBFOLDERS_STATE_FILE:', CUSTOM_SUBFOLDERS_STATE_FILE);
console.log('-------------------------------');

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
        if (fs.existsSync(USER_GAMES_FILE)) {
            return JSON.parse(fs.readFileSync(USER_GAMES_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('[CONFIG] Could not read user-games.json:', e.message);
    }
    return {};
}

/** Persist user-games.json to disk. */
function saveUserGames(data) {
    try {
        fs.writeFileSync(USER_GAMES_FILE, JSON.stringify(data, null, 2), 'utf-8');
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
    if (fs.existsSync(GAMES_FILE)) {
        try {
            const rawGames = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf-8'));
            if (Array.isArray(rawGames)) {
                existingGamesState = rawGames;
                // Re-populate favoriteNames from loaded games
                favoriteNames = existingGamesState.filter(g => g.isFavorite).map(g => g.name);
                needsDedup = true; // FIX 5b: Mark as needing dedup after load
                deduplicateState();
                saveGamesState(); // Save the cleaned state back
            } else {
                existingGamesState = [];
            }
        } catch (e) {
            existingGamesState = [];
        }
    }
}

function loadBlacklist() {
    if (fs.existsSync(BLACKLIST_FILE)) {
        try {
            blacklistState = JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf-8'));
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
    // FIX 5b: Only run deduplicateState when the state has actually changed (dirty flag)
    if (needsDedup) {
        deduplicateState();
        needsDedup = false;
    }
    fs.writeFileSync(GAMES_FILE, JSON.stringify(existingGamesState, null, 2));
    console.log(`[CONFIG] Game state written to ${GAMES_FILE}`);
}

function saveBlacklist() {
    console.log(`[CONFIG] Saving blacklist (${blacklistState.length} games)...`);
    fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(blacklistState, null, 2));
}

function getCustomFolders() {
    try {
        if (fs.existsSync(CUSTOM_FOLDERS_FILE)) {
            return JSON.parse(fs.readFileSync(CUSTOM_FOLDERS_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('[CONFIG] Could not read custom-folders.json:', e.message);
    }
    return [];
}

function saveCustomFolders(folders) {
    try {
        fs.writeFileSync(CUSTOM_FOLDERS_FILE, JSON.stringify(folders, null, 2), 'utf-8');
        console.log('[CONFIG] custom-folders.json saved.');
    } catch (e) {
        console.error('[CONFIG] Could not write custom-folders.json:', e.message);
        throw e;
    }
}

function getCustomSubfoldersState() {
    try {
        if (fs.existsSync(CUSTOM_SUBFOLDERS_STATE_FILE)) {
            return JSON.parse(fs.readFileSync(CUSTOM_SUBFOLDERS_STATE_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('[CONFIG] Could not read custom-subfolders-state.json:', e.message);
    }
    return {};
}

function saveCustomSubfoldersState(state) {
    try {
        fs.writeFileSync(CUSTOM_SUBFOLDERS_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
        console.log('[CONFIG] custom-subfolders-state.json saved.');
    } catch (e) {
        console.error('[CONFIG] Could not write custom-subfolders-state.json:', e.message);
        throw e;
    }
}

module.exports = {
    STEAMGRID_API_KEY,
    GAMES_FILE,
    BLACKLIST_FILE,
    COVERS_DIR,
    modsPath,
    streamlineModsPath,
    DEVELOPER_GAMES_FILE,
    USER_GAMES_FILE,
    
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
    saveCustomSubfoldersState
};
