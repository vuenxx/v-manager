const fs = require('fs');
const path = require('path');

const config = require('../config');
const utils = require('../utils');
const streamline = require('./streamline');

async function uninstallMod({ gameName, exePath, mod }) {
    if (mod === 'Streamline') {
        return await streamline.restoreStreamline(gameName);
    }

    let gameDir = exePath;
    try {
        if (fs.statSync(exePath).isFile()) gameDir = path.dirname(exePath);
    } catch(e) {}

    // Check if game is running to prevent EBUSY
    let exeToCheck = exePath;
    try {
        const exes = fs.readdirSync(gameDir).filter(f => f.toLowerCase().endsWith('.exe'));
        if (exes.length > 0) exeToCheck = path.join(gameDir, exes[0]);
    } catch(e) {}

    const running = await utils.isGameRunning(exeToCheck);
    if (running) {
        return { success: false, error: 'Oyun şu an açık. Lütfen oyunu kapatıp tekrar deneyin.' };
    }

    // Helper: find all occurrences of a filename recursively (up to MAX_DEPTH)
    function findFileInDir(rootDir, targetName, maxDepth = 5) {
        const found = [];
        const queue = [{ dir: rootDir, depth: 0 }];
        const visited = new Set();
        const ignoreDirs = ['data', 'shader', 'resource', 'asset', 'sound', 'audio', 'video', 'movie', 'localization', '_redist'];

        while (queue.length > 0) {
            const { dir, depth } = queue.shift();
            if (depth > maxDepth || visited.has(dir)) continue;
            visited.add(dir);

            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isFile() && entry.name.toLowerCase() === targetName.toLowerCase()) {
                        found.push(path.join(dir, entry.name));
                    } else if (entry.isDirectory() && depth < maxDepth) {
                        const nameLow = entry.name.toLowerCase();
                        if (!ignoreDirs.some(d => nameLow.includes(d))) {
                            queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
                        }
                    }
                }
            } catch (e) {}
        }
        return found;
    }

    const injectionDllNames = ['dxgi.dll', 'winmm.dll', 'd3d12.dll', 'dbghelp.dll', 'version.dll', 'wininet.dll', 'winhttp.dll', 'psapi.dll'];
    let deleted = 0;
    let skipped = 0;

    const normGameName = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const existingGamesState = config.getExistingGamesState();
    const dbGame = existingGamesState.find(g => g.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normGameName);

    // ── OptiScaler Uninstall ──────────────────────────────────────────────────
    if (mod === 'Optiscaler') {
        const OPTI_UNIQUE_FILES = [
            'OptiScaler.ini',
            'nvapi.dll',
            'nvapi64.dll',
            'OptiMX.log',
            'setup_linux.sh',
            'setup_windows.bat',
            'fakenvapi.dll',
            'fakenvapi.ini',
            'dlssg_to_fsr3_amd_is_better.dll',
            '!! README_EXTRACT ALL FILES TO GAME FOLDER !!.txt'
        ];

        for (const fileName of OPTI_UNIQUE_FILES) {
            const matches = findFileInDir(gameDir, fileName);
            for (const filePath of matches) {
                try { fs.unlinkSync(filePath); deleted++; } catch(e) { skipped++; }
            }
        }

        // FIX 4e: Removed 'Licences' from unique dirs — it's a generic name that can conflict
        // with game's own license directories (e.g. GOG games). Only D3D12_OptiScaler is safe.
        const OPTI_UNIQUE_DIRS = ['D3D12_OptiScaler'];
        for (const dirName of OPTI_UNIQUE_DIRS) {
            const dirPath = path.join(gameDir, dirName);
            if (fs.existsSync(dirPath)) {
                try {
                    fs.rmSync(dirPath, { recursive: true, force: true });
                    deleted++;
                } catch(e) {
                    skipped++;
                }
            }
        }

        // Remove OptiPatcher.asi from plugins folder if it exists
        try {
            const optiPatcherAsiPath = path.join(gameDir, 'plugins', 'OptiPatcher.asi');
            if (fs.existsSync(optiPatcherAsiPath)) {
                fs.unlinkSync(optiPatcherAsiPath);
                deleted++;
            }
        } catch (e) {
            skipped++;
        }

        for (const dllName of injectionDllNames) {
            const matches = findFileInDir(gameDir, dllName);
            for (const dllPath of matches) {
                const isOpti = await utils.isOptiScalerFile(dllPath);
                if (isOpti) {
                    try {
                        fs.unlinkSync(dllPath);
                        deleted++;
                    } catch(e) {
                        skipped++;
                    }
                }
            }
        }

        if (dbGame) {
            dbGame.hasOptiscaler = false;
            dbGame.optiscalerVersion = null;
            dbGame.optiscalerInjection = null;
            dbGame.optiscalerPath = null;
            dbGame.hasOptiBuilder = false;
            dbGame.optiBuilderVersion = null;
            dbGame.optiBuilderInjection = null;
            dbGame.optiBuilderPath = null;
            if (dbGame.upscalers) {
                dbGame.upscalers.optiscaler = false;
                dbGame.upscalers.optibuilder = false;
            }
            config.saveGamesState();
        }

        return { success: true, deleted, skipped, games: config.getExistingGamesState() };
    }

    // ── OptiBuilder Uninstall ──────────────────────────────────────────────────
    if (mod === 'OptiBuilder') {
        const OPTI_UNIQUE_FILES = [
            'OptiScaler.ini',
            'nvapi.dll',
            'nvapi64.dll',
            'OptiMX.log',
            'setup_linux.sh',
            'setup_windows.bat',
            'fakenvapi.dll',
            'fakenvapi.ini',
            'dlssg_to_fsr3_amd_is_better.dll',
            '!! README_EXTRACT ALL FILES TO GAME FOLDER !!.txt'
        ];

        for (const fileName of OPTI_UNIQUE_FILES) {
            const matches = findFileInDir(gameDir, fileName);
            for (const filePath of matches) {
                try { fs.unlinkSync(filePath); deleted++; } catch(e) { skipped++; }
            }
        }

        // Deletes both D3D12_OptiScaler and OptiScaler directories
        const OPTI_UNIQUE_DIRS = ['D3D12_OptiScaler', 'OptiScaler'];
        for (const dirName of OPTI_UNIQUE_DIRS) {
            const dirPath = path.join(gameDir, dirName);
            if (fs.existsSync(dirPath)) {
                try {
                    fs.rmSync(dirPath, { recursive: true, force: true });
                    deleted++;
                } catch(e) {
                    skipped++;
                }
            }
        }

        for (const dllName of injectionDllNames) {
            const matches = findFileInDir(gameDir, dllName);
            for (const dllPath of matches) {
                const isOpti = await utils.isOptiScalerFile(dllPath);
                if (isOpti) {
                    try {
                        fs.unlinkSync(dllPath);
                        deleted++;
                    } catch(e) {
                        skipped++;
                    }
                }
            }
        }

        if (dbGame) {
            dbGame.hasOptiBuilder = false;
            dbGame.optiBuilderVersion = null;
            dbGame.optiBuilderInjection = null;
            dbGame.optiBuilderPath = null;
            dbGame.hasOptiscaler = false;
            dbGame.optiscalerVersion = null;
            dbGame.optiscalerInjection = null;
            dbGame.optiscalerPath = null;
            if (dbGame.upscalers) {
                dbGame.upscalers.optibuilder = false;
                dbGame.upscalers.optiscaler = false;
            }
            config.saveGamesState();
        }

        return { success: true, deleted, skipped, games: config.getExistingGamesState() };
    }

    // ── DLSS Enabler Uninstall ────────────────────────────────────────────────
    if (mod === 'DLSS Enabler') {
        const DLSS_UNIQUE_FILES = [
            'dlss-enabler.ini',
            'dlss-enabler.log',
            'dlssg_to_fsr3_amd_is_better.dll',
            // FIX 2f: OptiScaler.ini is only deleted if OptiScaler is NOT already installed.
            // DLSS Enabler may ship with an OptiScaler.ini, but if user has OptiScaler
            // installed separately, deleting it would break OptiScaler.
            ...(dbGame && dbGame.hasOptiscaler ? [] : ['OptiScaler.ini'])
        ];

        const deletedFiles = [];

        for (const fileName of DLSS_UNIQUE_FILES) {
            const matches = findFileInDir(gameDir, fileName);
            for (const filePath of matches) {
                try { 
                    fs.unlinkSync(filePath); 
                    deletedFiles.push(fileName);
                } catch(e) { skipped++; }
            }
        }

        for (const dllName of injectionDllNames) {
            const matches = findFileInDir(gameDir, dllName);
            for (const dllPath of matches) {
                const desc = await utils.getFileDescription(dllPath);
                const descLow = desc.toLowerCase();
                if (descLow.includes('dlss enabler for dx12 gpus') || descLow.includes('dlss enabler')) {       
                    try {
                        fs.unlinkSync(dllPath);
                        deletedFiles.push(dllName);
                    } catch(e) {
                        skipped++;
                    }
                }
            }
        }

        if (dbGame) {
            dbGame.hasDlssEnabler = false;
            dbGame.dlssEnablerVersion = null;
            if (dbGame.upscalers) dbGame.upscalers.dlssEnabler = false;
            config.saveGamesState();
        }

        // Verify that deleted files indeed no longer exist in the directory
        const verifiedDeleted = [];
        for (const file of deletedFiles) {
            const matches = findFileInDir(gameDir, file);
            if (matches.length === 0) {
                verifiedDeleted.push(file);
            } else {
                skipped++;
            }
        }

        return { success: true, deleted: verifiedDeleted, skipped, notFound: 0, games: config.getExistingGamesState() };
    }

    return { success: false, error: 'Bilinmeyen mod tipi.' };
}

module.exports = {
    uninstallMod
};
