const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const extract = require('extract-zip');

const config = require('../config');
const utils = require('../utils');

const STREAMLINE_FILES = [
    'sl.reflex.dll',
    'sl.pcl.dll',
    'sl.nvperf.dll',
    'sl.nis.dll',
    'sl.interposer.dll',
    'sl.dlss.dll',
    'sl.directsr.dll',
    'sl.deepdvc.dll',
    'sl.common.dll'
];

function findStreamlineDir(rootDir) {
    console.log(`[STREAMLINE-SEARCH] Streamline arama başlatıldı. Kök Klasör: ${rootDir}`);
    const queue = [{ path: rootDir, depth: 0 }];
    const visited = new Set();
    const ignoreDirs = ['data', 'shader', 'resource', 'asset', 'sound', 'audio', 'video', 'movie', 'localization', '_redist'];

    const matches = [];

    while (queue.length > 0) {
        const current = queue.shift();
        const dir = current.path;
        const absDir = path.resolve(dir);
        if (visited.has(absDir)) {
            console.log(`[STREAMLINE-SEARCH] Ziyaret edilmiş klasör es geçiliyor: ${dir}`);
            continue;
        }
        visited.add(absDir);

        console.log(`[STREAMLINE-SEARCH] Taranıyor: ${dir}`);

        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            let hasStreamlineFile = false;
            for (const entry of entries) {
                // Skip symbolic links to prevent infinite loops
                if (entry.isSymbolicLink()) {
                    console.log(`[STREAMLINE-SEARCH] Sembolik link es geçiliyor: ${path.join(dir, entry.name)}`);
                    continue;
                }

                if (entry.isFile()) {
                    const fileLow = entry.name.toLowerCase();
                    if (STREAMLINE_FILES.includes(fileLow)) {
                        hasStreamlineFile = true;
                    }
                } else if (entry.isDirectory()) {
                    const nameLow = entry.name.toLowerCase();
                    if (!ignoreDirs.some(d => nameLow.includes(d))) {
                        queue.push({ path: path.join(dir, entry.name), depth: current.depth + 1 });
                    } else {
                        console.log(`[STREAMLINE-SEARCH] Klasör yoksayılıyor: ${entry.name}`);
                    }
                }
            }

            if (hasStreamlineFile) {
                console.log(`[STREAMLINE-SEARCH] Potansiyel Streamline klasörü bulundu: "${dir}" (Derinlik: ${current.depth})`);
                matches.push({ path: dir, depth: current.depth });
            }
        } catch (e) {
            console.error(`[STREAMLINE-SEARCH] Klasör okunurken hata (${dir}):`, e.message);
        }
    }


    if (matches.length > 0) {
        if (matches.length === 1) {
            console.log(`[STREAMLINE-SEARCH] Arama bitti. Tek Streamline klasörü bulundu: "${matches[0].path}"`);
            return matches[0].path;
        }
        // FIX 3b: When multiple Streamline directories exist (e.g. game + DLC), prefer the
        // SHALLOWEST one (lowest depth) — this is typically the main game binary directory.
        // Previously we selected the deepest, which caused mods to be installed in wrong sub-folders.
        matches.sort((a, b) => a.depth - b.depth);
        console.log(`[STREAMLINE-SEARCH] Arama bitti. ${matches.length} Streamline klasörü bulundu. En üst düzey seçildi: "${matches[0].path}" (Derinlik: ${matches[0].depth})`);
        if (matches.length > 1) {
            console.log(`[STREAMLINE-SEARCH] Diğer adaylar: ${matches.slice(1).map(m => `"${m.path}" (D:${m.depth})`).join(', ')}`);
        }
        return matches[0].path;
    }

    console.log(`[STREAMLINE-SEARCH] Arama tamamlandı, Streamline dizini bulunamadı.`);
    return null;
}

async function restoreStreamline(gameName) {
    const normGameName = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const existingGamesState = config.getExistingGamesState();
    const game = existingGamesState.find(g => g.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normGameName); 

    if (!game) {
        return { success: false, error: 'Oyun kütüphanede bulunamadı.' };
    }

    let targetDir = game.streamlinePath;
    if (!targetDir || !fs.existsSync(targetDir)) {
        // If path is missing, try to re-detect before giving up
        const scanner = require('../scanner');
        const gamePaths = config.getGamePaths(game.name, game.exePath);
        const scanPath = (gamePaths && gamePaths.game_root) || game.gameRoot || game.exePath;
        const detection = await scanner.detectUpscalers(scanPath);
        game.hasStreamline = detection.streamline;
        game.streamlineVersion = detection.streamlineVersion;
        game.streamlinePath = detection.streamlinePath;
        game.upscalers = detection;
        config.saveGamesState();
        
        targetDir = game.streamlinePath;
        if (!targetDir || !fs.existsSync(targetDir)) {
            return { success: false, error: 'Yedek dosyalar bulunamadı!' };
        }
    }

    try {
        const streamlineHashes = game.streamlineHashes || {};
        const files = fs.readdirSync(targetDir);
        const backupFiles = files.filter(f => f.toLowerCase().endsWith('.backup'));

        if (backupFiles.length === 0) {
            return { success: false, error: 'Yedek dosyalar bulunamadı!' };
        }

        // 1. Check if the game has been updated (strictly compare hashes of active files vs backups/mods)
        let gameUpdated = false;
        for (const file of backupFiles) {
            const originalName = file.substring(0, file.length - 7); // Remove .backup
            const originalPath = path.join(targetDir, originalName);

            if (fs.existsSync(originalPath)) {
                const currentHash = await utils.getFileHash(originalPath);
                const originalHash = streamlineHashes[originalName];
                
                // Fetch the hash of the mod file that was installed
                let modHash = null;
                let modDirName = game.streamlineModVersion;

                // Fallback: search downloaded mods asynchronously if modDirName is not set or not found
                if (!modDirName || !fs.existsSync(path.join(config.streamlineModsPath, modDirName))) {
                    try {
                        const modsPathExists = await fs.promises.access(config.streamlineModsPath)
                            .then(() => true)
                            .catch(() => false);
                        
                        if (modsPathExists) {
                            const entries = await fs.promises.readdir(config.streamlineModsPath, { withFileTypes: true });
                            const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);

                            for (const dir of dirs) {
                                const candidatePath = path.join(config.streamlineModsPath, dir, originalName);
                                const candidateExists = await fs.promises.access(candidatePath)
                                    .then(() => true)
                                    .catch(() => false);

                                if (candidateExists) {
                                    const ver = await utils.getFileVersion(candidatePath);
                                    if (ver && utils.compareVersions(ver, game.streamlineVersion) === 0) {
                                        modDirName = dir;
                                        break;
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.error('[STREAMLINE] Error scanning mod folders for version fallback:', e);
                    }
                }

                if (modDirName) {
                    const modPath = path.join(config.streamlineModsPath, modDirName, originalName);
                    const modPathExists = await fs.promises.access(modPath)
                        .then(() => true)
                        .catch(() => false);

                    if (modPathExists) {
                        modHash = await utils.getFileHash(modPath);
                    }
                }

                // If active file hash is different from the backup AND different from the installed mod,
                // the game has been updated (e.g. Steam update overwrote the mod file with a new version).
                if (originalHash && modHash && currentHash !== originalHash && currentHash !== modHash) {
                    gameUpdated = true;
                    console.log(`[STREAMLINE] Oyun güncellemesi saptandı: ${originalName} (Mevcut: ${currentHash}, Orijinal: ${originalHash}, Mod: ${modHash})`);
                    break;
                }
            }
        }

        if (gameUpdated) {
            console.log(`[STREAMLINE] Oyun güncellemesi saptandığından backup dosyaları siliniyor.`);
            // Delete all backup files
            for (const file of backupFiles) {
                const backupPath = path.join(targetDir, file);
                try {
                    if (fs.existsSync(backupPath)) {
                        fs.unlinkSync(backupPath);
                    }
                } catch (e) {
                    console.error(`[STREAMLINE] Backup dosyası silinirken hata: ${backupPath}`, e);
                }
            }

            // FIX 3c: Also clear mod state so the game card no longer shows Streamline as installed.
            // Previously, hasStreamline remained true even after backups were deleted.
            game.hasStreamline = false;
            game.streamlineVersion = null;
            game.streamlinePath = null;
            // Clean up hashes from database
            delete game.streamlineHashes;
            delete game.streamlineModVersion;
            if (game.upscalers) game.upscalers.streamline = false;
            config.saveGamesState();

            return { success: false, error: 'Oyun dosyaları güncellenmiş, eski yedek geri yüklenemez', games: config.getExistingGamesState() };
        }

        // 2. Perform restoration under try-catch (UAC & Lock protection)
        try {
            console.log(`[STREAMLINE] ${backupFiles.length} adet yedek geri yükleniyor...`);

            // Safe Mod-Only File Deletion:
            // Delete active files that exist but do NOT have a .backup file AND are NOT in game.streamlineHashes,
            // AND are verified to exist in the mod package (meaning they were added by the mod installer).
            let modFilesList = [];
            if (game.streamlineVersion) {
                const modSourceDir = path.join(config.streamlineModsPath, game.streamlineVersion);
                if (fs.existsSync(modSourceDir)) {
                    modFilesList = fs.readdirSync(modSourceDir).map(f => f.toLowerCase());
                }
            }

            for (const file of STREAMLINE_FILES) {
                const filePath = path.join(targetDir, file);
                const backupPath = filePath + '.backup';
                const fileLow = file.toLowerCase();

                if (fs.existsSync(filePath) && !fs.existsSync(backupPath)) {
                    const isOriginal = streamlineHashes && streamlineHashes[file];
                    const isModFile = modFilesList.includes(fileLow);

                    if (!isOriginal && isModFile) {
                        console.log(`[STREAMLINE] Mod dosyası güvenli bir şekilde siliniyor: "${filePath}"`);
                        fs.unlinkSync(filePath);
                    }
                }
            }

            // Restore backups: delete original and rename backup to original
            for (const file of backupFiles) {
                const originalName = file.substring(0, file.length - 7); // Remove .backup
                const backupPath = path.join(targetDir, file);
                const originalPath = path.join(targetDir, originalName);

                if (fs.existsSync(originalPath)) {
                    console.log(`[STREAMLINE-RESTORE] Mevcut mod dosyası siliniyor: "${originalPath}"`);
                    fs.unlinkSync(originalPath);
                }
                console.log(`[STREAMLINE-RESTORE] Yedek dosya geri yükleniyor: "${backupPath}" -> "${originalPath}"`);
                fs.renameSync(backupPath, originalPath);
            }
        } catch (e) {
            console.error('[STREAMLINE] Restorasyon dosya işlemleri sırasında hata:', e);
            if (e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'EBUSY') {
                return { success: false, error: 'Erişim engellendi veya dosya kilitli (EPERM)' };
            }
            return { success: false, error: 'Dosya işlemleri sırasında hata: ' + e.message };
        }

        // 3. Fresh scan "sanki oyun tarar gibi"
        const scanner = require('../scanner');
        const gamePaths = config.getGamePaths(game.name, game.exePath);
        const scanPath = (gamePaths && gamePaths.game_root) || game.gameRoot || game.exePath;
        const detection = await scanner.detectUpscalers(scanPath);

        // Update game state with detection results
        game.hasStreamline = detection.streamline;
        game.streamlineVersion = detection.streamlineVersion;
        game.streamlinePath = detection.streamlinePath;
        game.upscalers = detection;
        delete game.streamlineHashes;
        delete game.streamlineModVersion;

        config.saveGamesState();
        return { success: true, games: config.getExistingGamesState() };
    } catch(e) {
        return { success: false, error: 'Restorasyon sırasında hata: ' + e.message };
    }
}

async function getStreamlineVersions() {
    try {
        const entries = await fs.promises.readdir(config.streamlineModsPath, { withFileTypes: true });
        return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch (e) {
        return [];
    }
}

async function findGameExecutableDir(basePath) {
    // 1. Try to find if DLSS Enabler or OptiScaler is already installed in some directory
    // We scan recursively for version.dll, dxgi.dll, or OptiScaler.dll that is our mod
    const queue = [basePath];
    const visited = new Set();
    const ignoreDirs = ['data', 'shader', 'resource', 'asset', 'sound', 'audio', 'video', 'movie', 'localization', '_redist'];

    while (queue.length > 0) {
        const dir = queue.shift();
        const absDir = path.resolve(dir);
        if (visited.has(absDir)) continue;
        visited.add(absDir);

        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isSymbolicLink()) continue;

                if (entry.isFile()) {
                    const nameLow = entry.name.toLowerCase();
                    if (nameLow === 'version.dll' || nameLow === 'dxgi.dll' || nameLow === 'optiscaler.dll' || nameLow === 'dlss-enabler.dll') {
                        const filePath = path.join(dir, entry.name);
                        const desc = await utils.getFileDescription(filePath);
                        const descLow = desc.toLowerCase();
                        if (descLow.includes('dlss enabler') || descLow.includes('optiscaler')) {
                            console.log(`[STREAMLINE-SEARCH] Active mod directory found: "${dir}"`);
                            return dir;
                        }
                    }
                } else if (entry.isDirectory()) {
                    const nameLow = entry.name.toLowerCase();
                    if (!ignoreDirs.some(d => nameLow.includes(d))) {
                        queue.push(path.join(dir, entry.name));
                    }
                }
            }
        } catch (e) {}
    }

    // 2. Scan all .exe files in the directory recursively and find the largest one
    let largestExeSize = 0;
    let largestExeDir = null;

    queue.push(basePath);
    visited.clear();

    while (queue.length > 0) {
        const dir = queue.shift();
        const absDir = path.resolve(dir);
        if (visited.has(absDir)) continue;
        visited.add(absDir);

        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isSymbolicLink()) continue;

                if (entry.isFile()) {
                    const nameLow = entry.name.toLowerCase();
                    if (nameLow.endsWith('.exe')) {
                        // Exclude launchers, crash reporters, web helpers, setup, uninstallers
                        if (!nameLow.includes('launcher') && 
                            !nameLow.includes('crashreport') && 
                            !nameLow.includes('webhelper') && 
                            !nameLow.includes('setup') && 
                            !nameLow.includes('unins')) {
                            
                            const filePath = path.join(dir, entry.name);
                            const stats = fs.statSync(filePath);
                            // Require size to be at least 2MB to filter out basic launchers
                            if (stats.size > 2 * 1024 * 1024 && stats.size > largestExeSize) {
                                largestExeSize = stats.size;
                                largestExeDir = dir;
                            }
                        }
                    }
                } else if (entry.isDirectory()) {
                    const nameLow = entry.name.toLowerCase();
                    if (!ignoreDirs.some(d => nameLow.includes(d))) {
                        queue.push(path.join(dir, entry.name));
                    }
                }
            }
        } catch (e) {}
    }

    if (largestExeDir) {
        console.log(`[STREAMLINE-SEARCH] Largest game executable directory found: "${largestExeDir}" (Size: ${(largestExeSize / 1024 / 1024).toFixed(2)} MB)`);
        return largestExeDir;
    }

    return null;
}

async function checkStreamlineBackup(game, isAuto, manualExePath, window) {
    console.log(`[STREAMLINE-BACKUP-CHECK] checkStreamlineBackup başlatıldı. Oyun: ${game.name}, isAuto: ${isAuto}`);
    let targetDir = '';

    // Determine the base game folder to start searching in
    // Öncelik sırası: user-games.json game_root → game.gameRoot → exePath'ten türet
    let basePath = '';

    try {
        const gamePaths = config.getGamePaths(game.name, game.exePath);
        if (gamePaths && gamePaths.game_root && fs.existsSync(gamePaths.game_root)) {
            basePath = gamePaths.game_root;
            console.log(`[STREAMLINE-BACKUP-CHECK] basePath user-games.json game_root'tan okundu: ${basePath}`);
        }
    } catch (e) {
        console.warn(`[STREAMLINE-BACKUP-CHECK] config.getGamePaths hatası: ${e.message}`);
    }

    if (!basePath && game.gameRoot && fs.existsSync(game.gameRoot)) {
        basePath = game.gameRoot;
        console.log(`[STREAMLINE-BACKUP-CHECK] basePath game.gameRoot'tan okundu: ${basePath}`);
    }

    if (!basePath) {
        // Son çare: exePath'ten türet (mevcut davranış)
        const exePath = manualExePath || game.exePath;
        if (exePath) {
            try {
                const stats = fs.existsSync(exePath) ? fs.statSync(exePath) : null;
                basePath = stats && stats.isFile() ? path.dirname(exePath) : exePath;
            } catch (e) {
                basePath = path.dirname(exePath);
            }
            console.log(`[STREAMLINE-BACKUP-CHECK] basePath exePath'ten türetildi: ${basePath}`);
        }
    }

    console.log(`[STREAMLINE-BACKUP-CHECK] Belirlenen arama kök dizini (basePath): ${basePath}`);

    if (!basePath) {
        console.warn(`[STREAMLINE-BACKUP-CHECK] Hata: basePath bulunamadı!`);
        return { success: false, error: 'Oyun klasörü tespit edilemedi.' };
    }

    // Try to find the streamline files directory within the game folder tree
    let resolved = findStreamlineDir(basePath);
    if (!resolved) {
        console.log(`[STREAMLINE-BACKUP-CHECK] Streamline dosyası bulunamadı. Game executable directory aranıyor...`);
        resolved = await findGameExecutableDir(basePath);
    }

    if (resolved) {
        targetDir = resolved;
        console.log(`[STREAMLINE-BACKUP-CHECK] Otomatik arama başarılı. Bulunan Streamline Klasörü: ${targetDir}`);
    } else {
        console.log(`[STREAMLINE-BACKUP-CHECK] Otomatik arama başarısız oldu. Manuel klasör seçici devreye giriyor...`);
        // If the scanner/findStreamlineDir fails to find any Streamline files,
        // present a native warning dialog to allow the user to select the Streamline directory manually.
        if (window) {
            const { dialog } = require('electron');
            dialog.showMessageBoxSync(window, {
                type: 'warning',
                title: 'Streamline Bulunamadı',
                message: 'Otomatik tarama başarısız oldu. Lütfen Streamline dosyalarının bulunduğu klasörü seçin.',
                buttons: ['Tamam']
            });

            const { canceled, filePaths } = await dialog.showOpenDialog(window, {
                title: 'Streamline Klasörünü Seçin',
                properties: ['openDirectory']
            });

            if (canceled || filePaths.length === 0) {
                console.log(`[STREAMLINE-BACKUP-CHECK] Manuel klasör seçimi iptal edildi.`);
                return { success: false, error: 'Oyun dizininde Streamline altyapısı bulunamadı.' };
            }

            targetDir = filePaths[0];
            console.log(`[STREAMLINE-BACKUP-CHECK] Kullanıcı tarafından seçilen klasör: ${targetDir}`);
        } else {
            console.warn(`[STREAMLINE-BACKUP-CHECK] Hata: pencere (window) referansı yok ve Streamline bulunamadı.`);
            return { success: false, error: 'Oyun dizininde Streamline altyapısı bulunamadı.' };
        }
    }

    let backupExists = false;
    let currentVersion = '0.0.0.0';
    let backupVersion = '0.0.0.0';

    try {
        const files = fs.readdirSync(targetDir);
        backupExists = files.some(f => f.toLowerCase().endsWith('.backup') && STREAMLINE_FILES.includes(f.toLowerCase().substring(0, f.length - 7)));

        // FIX 3d: Try multiple sl.*.dll files for version detection, not just sl.common.dll
        // sl.common.dll might be absent if antivirus removed it or install was partial.
        const versionCandidates = ['sl.common.dll', 'sl.interposer.dll', 'sl.dlss.dll', 'sl.reflex.dll'];
        for (const candidate of versionCandidates) {
            const candidatePath = path.join(targetDir, candidate);
            if (fs.existsSync(candidatePath)) {
                const ver = await utils.getFileVersion(candidatePath);
                if (ver && ver !== '0.0.0.0') {
                    currentVersion = ver;
                    console.log(`[STREAMLINE] Versiyon ${candidate} dosyasından okundu: ${currentVersion}`);
                    break;
                }
            }
        }

        // FIX 3d: Same for backup version
        for (const candidate of versionCandidates) {
            const backupCandidatePath = path.join(targetDir, candidate + '.backup');
            if (fs.existsSync(backupCandidatePath)) {
                const ver = await utils.getFileVersion(backupCandidatePath);
                if (ver && ver !== '0.0.0.0') {
                    backupVersion = ver;
                    console.log(`[STREAMLINE] Backup versiyon ${candidate}.backup dosyasından okundu: ${backupVersion}`);
                    break;
                }
            }
        }
    } catch(e) {}

    return { success: true, targetDir, backupExists, currentVersion, backupVersion };
}

function getAllFiles(dir, baseDir = dir) {
    let results = [];
    const list = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of list) {
        const filePath = path.join(dir, file.name);
        if (file.isDirectory()) {
            results = results.concat(getAllFiles(filePath, baseDir));
        } else {
            results.push(path.relative(baseDir, filePath));
        }
    }
    return results;
}

// FIX 3e: Removed dead parameters `overwriteBackup` and `skipBackup` — they were never used.
async function installStreamline(game, version, targetDir) {
    const sourceDir = path.join(config.streamlineModsPath, version);
    console.log(`[STREAMLINE] Kurulum başlatıldı. Hedef: ${targetDir}, Sürüm: ${version}`);

    if (!fs.existsSync(sourceDir)) {
        console.error(`[STREAMLINE] Hata: Kaynak klasör bulunamadı: ${sourceDir}`);
        return { success: false, error: `Mod kaynak klasörü bulunamadı: ${version}` };
    }

    // FIX 3a: Rollback mechanism — if copyDir fails after backups are made, restore them.
    const backedUpFiles = []; // Track files we backed up so we can roll back

    try {
        const streamlineHashes = game.streamlineHashes || {};

        // Get only the whitelisted files that exist in the mod source directory
        const relativeFiles = STREAMLINE_FILES.filter(file => fs.existsSync(path.join(sourceDir, file)));
        
        console.log(`[STREAMLINE] Yedekleme döngüsü başlatılıyor. Taranan kaynak dosya sayısı: ${relativeFiles.length}`);

        // Perform backup loop: For every .dll or .ini file to be copied from the mod folder:
        for (const relFile of relativeFiles) {
            const relFileLow = relFile.toLowerCase();
            if (relFileLow.endsWith('.dll') || relFileLow.endsWith('.ini')) {
                const activePath = path.join(targetDir, relFile);
                const backupPath = activePath + '.backup';

                // Check if the original file exists in the game directory
                if (fs.existsSync(activePath)) {
                    // If it doesn't have a .backup file, calculate hash, record it, and copy to .backup
                    if (!fs.existsSync(backupPath)) {
                        console.log(`[STREAMLINE-BACKUP] Orijinal dosya yedekleniyor: "${activePath}" -> "${backupPath}"`);
                        const hash = await utils.getFileHash(activePath);
                        if (hash) {
                            streamlineHashes[relFile] = hash;
                        }
                        // Create subdirectory under targetDir if necessary (in case mod contains subdirs)
                        const activeDir = path.dirname(activePath);
                        if (!fs.existsSync(activeDir)) {
                            fs.mkdirSync(activeDir, { recursive: true });
                        }
                        fs.copyFileSync(activePath, backupPath);
                        backedUpFiles.push({ backupPath, activePath }); // Track for rollback
                    } else {
                        // If it does exist, skip backing up this file (preserving the original)
                        console.log(`[STREAMLINE-BACKUP] Dosya için zaten yedek mevcut, atlanıyor: "${backupPath}"`);
                    }
                }
            }
        }

        // Copy modded files immediately after the backup loop
        console.log(`[STREAMLINE] Mod dosyaları kopyalanıyor...`);
        try {
            for (const file of relativeFiles) {
                const srcPath = path.join(sourceDir, file);
                const destPath = path.join(targetDir, file);
                const destDir = path.dirname(destPath);
                if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true });
                }
                try {
                    fs.copyFileSync(srcPath, destPath);
                    console.log(`[STREAMLINE] Kopyalandı: "${srcPath}" -> "${destPath}"`);
                } catch(err) {
                    console.error(`[STREAMLINE] Dosya kopyalama hatası ("${file}"):`, err);
                    throw err; // throw to trigger outer catch block for rollback
                }
            }
        } catch(copyErr) {
            // FIX 3a: copyDir failed — roll back all backups we just made
            console.error(`[STREAMLINE] Dosya kopyalama başarısız, rollback başlatılıyor...`, copyErr);
            for (const { backupPath, activePath } of backedUpFiles) {
                try {
                    if (fs.existsSync(backupPath)) {
                        // Restore: delete whatever was partially written and put backup back
                        if (fs.existsSync(activePath)) fs.unlinkSync(activePath);
                        fs.renameSync(backupPath, activePath);
                        console.log(`[STREAMLINE-ROLLBACK] Geri yüklendi: ${activePath}`);
                    }
                } catch(rbErr) {
                    console.error(`[STREAMLINE-ROLLBACK] Rollback sırasında hata (${activePath}):`, rbErr.message);
                }
            }
            if (copyErr.code === 'EPERM' || copyErr.code === 'EACCES' || copyErr.code === 'EBUSY') {
                return { success: false, error: 'Erişim engellendi veya dosya kilitli (EPERM). Kurulum iptal edildi, orijinal dosyalar geri yüklendi.' };
            }
            return { success: false, error: 'Kopyalama hatası: ' + copyErr.message + ' \u2014 Orijinal dosyalar geri yüklendi.' };
        }

        // Fresh scan "sanki oyun tarar gibi"
        const scanner = require('../scanner');
        const gamePaths = config.getGamePaths(game.name, game.exePath);
        const scanPath = (gamePaths && gamePaths.game_root) || game.gameRoot || game.exePath;
        const detection = await scanner.detectUpscalers(scanPath);

        const normTargetName = game.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const existingGamesState = config.getExistingGamesState();
        let dbGame = existingGamesState.find(g => g.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normTargetName);
        if (dbGame) {
            dbGame.hasStreamline = detection.streamline;
            dbGame.streamlineVersion = detection.streamlineVersion;
            dbGame.streamlinePath = detection.streamlinePath;
            dbGame.upscalers = detection;
            dbGame.streamlineHashes = streamlineHashes;
            dbGame.streamlineModVersion = version;
            config.saveGamesState();
            console.log(`[STREAMLINE] Veritabanı ve durum başarıyla güncellendi: ${dbGame.name}`);
        } else {
            console.warn(`[STREAMLINE] Oyun veritabanında bulunamadı: ${game.name}`);
        }

        return { success: true, games: config.getExistingGamesState() };
    } catch(e) {
        console.error(`[STREAMLINE] Kurulum hatası:`, e);
        if (e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'EBUSY') {
            return { success: false, error: 'Erişim engellendi veya dosya kilitli (EPERM)' };
        }
        return { success: false, error: 'Kurulum hatası: ' + e.message };
    }
}

async function getStreamlineReleases() {
    try {
        const response = await fetch('https://api.github.com/repos/NVIDIA-RTX/Streamline/releases', {
            headers: { 'User-Agent': 'vuenxxFG' }
        });
        if (response.status === 403) {
            throw new Error("GitHub limitine takıldınız, lütfen daha sonra tekrar deneyin.");
        }
        if (!response.ok) throw new Error(`GitHub API HTTP error: ${response.status}`);
        const releases = await response.json();

        return releases.slice(0, 10).map(r => {
            const tag = r.tag_name;
            const targetDir = path.join(config.streamlineModsPath, tag);
            let installed = false;

            if (fs.existsSync(targetDir)) {
                try {
                    const files = fs.readdirSync(targetDir);
                    if (files.length > 0) {
                        installed = true;
                    }
                } catch (e) {}
            }

            return {
                name: r.name || r.tag_name,
                tag: tag,
                downloadUrl: r.assets.find(a => a.name.toLowerCase().endsWith('.zip'))?.browser_download_url,
                installed: installed
            };
        });
    } catch (e) {
        console.error("Failed to fetch Streamline releases:", e);
        return { error: e.message };
    }
}

async function downloadStreamlineRelease(event, { tag, downloadUrl }) {
    const tempZipPath = path.join(app.getPath('temp'), `streamline_${tag.replace(/[^a-z0-9.-]/gi, '_')}.zip`);
    const tempExtractDir = path.join(app.getPath('temp'), `streamline_extract_${tag.replace(/[^a-z0-9.-]/gi, '_')}`);
    const targetDir = path.join(config.streamlineModsPath, tag);

    const MAX_RETRIES = 3;
    const TIMEOUT_MS = 120000; // 2 dakika timeout

    try {
        if (!downloadUrl) throw new Error("İndirme linki bulunamadı.");

        let buffer = null;
        let lastError = null;

        // Retry loop
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                console.log(`[STREAMLINE-DOWNLOAD] İndirme denemesi ${attempt}/${MAX_RETRIES}: ${downloadUrl}`);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => {
                    controller.abort();
                    console.warn(`[STREAMLINE-DOWNLOAD] Timeout: ${TIMEOUT_MS}ms aşıldı (deneme ${attempt})`);
                }, TIMEOUT_MS);

                let response;
                try {
                    response = await fetch(downloadUrl, { signal: controller.signal });
                } finally {
                    clearTimeout(timeoutId);
                }

                if (!response.ok) throw new Error(`Download failed: ${response.status}`);

                const contentLength = +response.headers.get('Content-Length') || 0;
                const reader = response.body.getReader();
                let receivedLength = 0;
                const chunks = [];

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    receivedLength += value.length;
                    if (contentLength && event && event.sender && !event.sender.isDestroyed()) {
                        const percent = Math.round((receivedLength / contentLength) * 100);
                        event.sender.send('streamline-download-progress', { percent });
                    }
                }

                buffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
                lastError = null;
                break; // Başarılı, döngüden çık

            } catch (fetchErr) {
                lastError = fetchErr;
                const isAborted = fetchErr.name === 'AbortError';
                const errMsg = isAborted ? `Zaman aşımı (${TIMEOUT_MS / 1000}s)` : fetchErr.message;
                console.warn(`[STREAMLINE-DOWNLOAD] Deneme ${attempt} başarısız: ${errMsg}`);

                if (attempt < MAX_RETRIES) {
                    const waitMs = attempt * 2000; // 2s, 4s bekleme
                    console.log(`[STREAMLINE-DOWNLOAD] ${waitMs}ms sonra tekrar deneniyor...`);
                    // İlerleme çubuğuna retry mesajı gönder
                    if (event && event.sender && !event.sender.isDestroyed()) {
                        event.sender.send('streamline-download-progress', { percent: 0, stage: `retry${attempt}` });
                    }
                    await new Promise(r => setTimeout(r, waitMs));
                }
            }
        }

        if (!buffer) {
            throw lastError || new Error("İndirme başarısız oldu.");
        }

        fs.writeFileSync(tempZipPath, buffer);

        // Ensure temp extract directory is clean
        if (fs.existsSync(tempExtractDir)) {
            try {
                fs.rmSync(tempExtractDir, { recursive: true, force: true });
            } catch(e) {}
        }
        fs.mkdirSync(tempExtractDir, { recursive: true });

        if (event && event.sender && !event.sender.isDestroyed()) {
            event.sender.send('streamline-download-progress', { percent: 100, stage: 'extracting' });
        }

        // Extract using extract-zip to the temp folder
        await extract(tempZipPath, { dir: tempExtractDir });

        // Now, find the 'bin/x64' folder inside tempExtractDir recursively
        let binX64Path = null;
        function findBinX64(dir) {
            const list = fs.readdirSync(dir, { withFileTypes: true });
            for (const file of list) {
                if (file.isDirectory()) {
                    const fullPath = path.join(dir, file.name);
                    const nameLow = file.name.toLowerCase();
                    const parentNameLow = path.basename(dir).toLowerCase();
                    if (nameLow === 'x64' && parentNameLow === 'bin') {
                        binX64Path = fullPath;
                        return;
                    }
                    findBinX64(fullPath);
                    if (binX64Path) return;
                }
            }
        }
        findBinX64(tempExtractDir);

        if (!binX64Path) {
            throw new Error("SDK paketi içerisinde bin/x64 klasörü bulunamadı.");
        }

        // Ensure targetDir exists and is clean
        if (fs.existsSync(targetDir)) {
            fs.rmSync(targetDir, { recursive: true, force: true });
        }
        fs.mkdirSync(targetDir, { recursive: true });

        // Copy only whitelisted files inside binX64Path to targetDir with try-catch
        for (const file of STREAMLINE_FILES) {
            const srcPath = path.join(binX64Path, file);
            if (fs.existsSync(srcPath)) {
                const destPath = path.join(targetDir, file);
                try {
                    fs.copyFileSync(srcPath, destPath);
                    console.log(`[STREAMLINE-DOWNLOAD] Kopyalandı: "${srcPath}" -> "${destPath}"`);
                } catch(copyErr) {
                    console.error(`[STREAMLINE-DOWNLOAD] Dosya kopyalama hatası ("${file}"):`, copyErr);
                    throw copyErr;
                }
            }
        }

        // Clean up temporary files
        try {
            fs.unlinkSync(tempZipPath);
            fs.rmSync(tempExtractDir, { recursive: true, force: true });
        } catch (e) {
            console.error("Failed to clean up temp streamline files:", e);
        }

        return { success: true, targetDir };
    } catch (e) {
        console.error("Streamline download error:", e);

        // Clean up temp files on error
        try {
            if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);
            if (fs.existsSync(tempExtractDir)) fs.rmSync(tempExtractDir, { recursive: true, force: true });
        } catch (err) {}

        return { success: false, error: e.message };
    }
}




module.exports = {
    STREAMLINE_FILES,
    findStreamlineDir,
    restoreStreamline,
    getStreamlineVersions,
    checkStreamlineBackup,
    installStreamline,
    getStreamlineReleases,
    downloadStreamlineRelease
};