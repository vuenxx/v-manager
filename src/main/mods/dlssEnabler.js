const fs = require('fs');
const path = require('path');
const { dialog, BrowserWindow, app } = require('electron');
const extract = require('extract-zip');
const { execFile } = require('child_process');
const { path7za } = require('7zip-bin');

const config = require('../config');
const utils = require('../utils');
const scanner = require('../scanner');

let releasesCache = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function extractArchive(archivePath, targetDir) {
    const lower = archivePath.toLowerCase();
    if (lower.endsWith('.7z')) {
        return new Promise((resolve, reject) => {
            execFile(path7za, ['x', archivePath, `-o${targetDir}`, '-y'], (err, stdout, stderr) => {
                if (err) {
                    console.error('7za extract error:', err, stderr);
                    return reject(new Error(`7z extraction failed: ${err.message || stderr}`));
                }
                resolve();
            });
        });
    } else {
        await extract(archivePath, { dir: targetDir });
    }
}

function isSameGame(existingGame, newExePath) {
    if (!existingGame.exePath || !newExePath) return false;
    const existingPathNorm = path.resolve(existingGame.exePath).toLowerCase().replace(/\\/g, '/');
    const newPathNorm = path.resolve(newExePath).toLowerCase().replace(/\\/g, '/');

    // 1. Exact path match
    if (existingPathNorm === newPathNorm) return true;

    // 2. If existing path is a directory, check if new path is inside it
    try {
        const stats = fs.statSync(existingGame.exePath);
        if (stats.isDirectory()) {
            if (newPathNorm.startsWith(existingPathNorm)) {
                return true;
            }
        }
    } catch(e) {}

    // 3. Directory-level match (same parent folder)
    try {
        const existingDir = fs.statSync(existingGame.exePath).isFile() ? path.dirname(existingGame.exePath) : existingGame.exePath;
        const newDir = path.dirname(newExePath);

        const existingDirNorm = path.resolve(existingDir).toLowerCase().replace(/\\/g, '/');
        const newDirNorm = path.resolve(newDir).toLowerCase().replace(/\\/g, '/');

        if (existingDirNorm === newDirNorm) return true;
        // FIX 2a: Removed the "startsWith" sub-folder check here — it caused false positives
        // when two different games shared a parent folder (e.g. D:\Games\GameA vs D:\Games\GameA_DLC)
    } catch(e) {}

    // FIX 2a: Name-only match removed entirely.
    // It matched games with short names (length > 2) to unrelated EXEs with similar filenames.
    // Path-based matching above is sufficient and safe.

    return false;
}

async function getDlssVersions() {
    const versionsPath = path.join(config.modsPath, 'dlssenabler');
    try {
        const entries = await fs.promises.readdir(versionsPath, { withFileTypes: true });
        return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch (e) {
        return [];
    }
}

async function selectExe(event) {
    const window = BrowserWindow.fromWebContents(event.sender);

    // Rule 2: Launcher Warning
    const { response } = await dialog.showMessageBox(window, {
        type: 'info',
        title: 'Önemli Uyarı',
        message: 'Lütfen oyunun başlatıcısını (launcher) değil, asıl çalıştırıcı .exe dosyasını seçtiğinizden emin olun.',
        detail: 'Örn: Unreal Engine oyunları için genellikle Binaries\\Win64 klasörü içindedir. Yanlış dosya seçimi modun çalışmamasına sebep olur.',
        buttons: ['Anladım, Dosya Seç', 'İptal']
    });

    if (response === 1) return null;

    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        title: 'Oyun Seç (.exe)',
        filters: [{ name: 'Executables', extensions: ['exe'] }],
        properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
}

// Desteklenen tüm DLSS Enabler DLL isimleri
const DLSS_ENABLER_DLL_NAMES = ['version.dll', 'dxgi.dll', 'winmm.dll', 'dbghelp.dll', 'psapi.dll', 'winhttp.dll'];

/**
 * Belirtilen klasörde description'ında "dlss enabler" yazan DLL'i bulur.
 * Birden fazla bulunursa hepsini döndürür (çakışma uyarısı için).
 * @returns {{ found: string|null, conflicts: string[] }}
 */
async function findExistingDlssEnablerDll(targetDir) {
    const found = [];
    for (const name of DLSS_ENABLER_DLL_NAMES) {
        const dllPath = path.join(targetDir, name);
        if (fs.existsSync(dllPath)) {
            try {
                const desc = await utils.getFileDescription(dllPath);
                if (desc && desc.toLowerCase().includes('dlss enabler')) {
                    found.push(name);
                }
            } catch (e) { /* ignore */ }
        }
    }
    if (found.length === 0) return { found: null, conflicts: [] };
    if (found.length === 1) return { found: found[0], conflicts: [] };
    return { found: found[0], conflicts: found };
}

async function checkConflicts(targetDir) {
    // Rule 1: Comprehensive Conflict Check
    const injectionDllNames = ['dxgi.dll', 'winmm.dll', 'd3d12.dll', 'dbghelp.dll', 'version.dll', 'wininet.dll', 'winhttp.dll', 'psapi.dll'];
    for (const dll of injectionDllNames) {
        const fullPath = path.join(targetDir, dll);
        if (fs.existsSync(fullPath)) {
            const desc = await utils.getFileDescription(fullPath);
            const descLow = desc.toLowerCase();
            const isOurMod = descLow.includes('dlss enabler');
            
            // Skip conflict warning for legitimate original Windows/DirectX system DLLs
            const isWindowsSystemDll = 
                descLow.includes('windows image helper') ||
                descLow.includes('debug help library') ||
                descLow.includes('directx graphics infrastructure') ||
                descLow.includes('direct3d 12 runtime') ||
                descLow.includes('microsoft windows control api') ||
                descLow.includes('internet extensions for win32') ||
                descLow.includes('windows http services') ||
                descLow.includes('version checking and file installation libraries') ||
                descLow.includes('process status helper');

            // DURUM C (Üçüncü parti mod çakışması uyarısı kaldırıldı)
            // if (!isOurMod && !isWindowsSystemDll) {
            //     return { conflict: true, file: dll };
            // }
        }
    }
    return { conflict: false };
}

/**
 * Kaynak sourceDir'deki version.dll'i effectiveDllName ile hedef klasöre kopyalar.
 * Diğer dosyaları (ini vb.) normal kopyalar.
 * @param {string} sourceDir
 * @param {string} targetDir
 * @param {string} effectiveDllName - Kullanılacak DLL adı (örn: 'dxgi.dll')
 * @returns {{ success: boolean, error?: string }}
 */
async function copyDlssFiles(sourceDir, targetDir, effectiveDllName) {
    const sourceDll = path.join(sourceDir, 'version.dll');
    const targetDll = path.join(targetDir, effectiveDllName);

    // version.dll'i seçilen isimle kopyala
    try {
        fs.copyFileSync(sourceDll, targetDll);
        console.log(`[DLSS ENABLER] version.dll → ${effectiveDllName} olarak kopyalandı.`);
    } catch (e) {
        if (['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) {
            return { success: false, error: `Erişim engellendi (${e.code}): Klasör izinlerini veya antivirüs ayarlarını kontrol edin.` };
        }
        return { success: false, error: `Dosya kopyalama hatası: ${e.message}` };
    }

    // Diğer dosyaları kopyala (version.dll hariç)
    try {
        const otherFiles = fs.readdirSync(sourceDir).filter(f => f.toLowerCase() !== 'version.dll');
        for (const file of otherFiles) {
            try {
                fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
            } catch (e) {
                console.warn(`[DLSS ENABLER] Ek dosya kopyalanamadı: ${file} — ${e.message}`);
            }
        }
    } catch (e) {
        console.warn(`[DLSS ENABLER] sourceDir listelenemedi: ${e.message}`);
    }

    // Antivirus kontrolü — 1.5sn bekle, kopyalanan DLL hâlâ var mı?
    console.log(`[DLSS ENABLER] Antivirus/Erişim kontrolü (1.5sn bekleme)...`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (!fs.existsSync(targetDll)) {
        return { success: false, error: `Erişim Engellendi veya Antivirüs Engeli: "${effectiveDllName}" kopyalandıktan sonra silindi. Antivirüs karantinasını veya klasör izinlerini kontrol edin.` };
    }

    return { success: true };
}

async function executeDlssInstall(event, game, exePath, version, dllName, downloadUrl) {
    const targetDir = path.dirname(exePath);
    const versionDir = path.join(config.modsPath, 'dlssenabler', version);

    console.log(`[DLSS ENABLER] Manuel kurulum başlatıldı. Oyun: ${game ? game.name : 'Bilinmiyor'}, Hedef: ${targetDir}, Sürüm: ${version}, İstenen DLL: ${dllName || 'version.dll'}`);

    let alreadyDownloaded = false;
    if (fs.existsSync(versionDir)) {
        try {
            const dirFiles = fs.readdirSync(versionDir).map(f => f.toLowerCase());
            if (dirFiles.includes('version.dll')) {
                alreadyDownloaded = true;
            }
        } catch (e) {}
    }

    if (!alreadyDownloaded) {
        if (!downloadUrl) {
            return { success: false, error: 'Bu sürüm henüz indirilmemiş ve indirme linki bulunamadı.' };
        }
        console.log(`[DLSS ENABLER] Sürüm henüz indirilmemiş, indiriliyor: ${version}`);
        const dlResult = await downloadDlssEnablerRelease(event, { name: version, downloadUrl });
        if (!dlResult.success) {
            return { success: false, error: dlResult.error || 'İndirme başarısız.' };
        }
    }

    const sourceDir = versionDir;

    // Mevcut DLSS Enabler DLL'ini canlı tara
    const { found: existingDll, conflicts } = await findExistingDlssEnablerDll(targetDir);
    if (conflicts.length > 1) {
        return { success: false, error: `Klasörde birden fazla DLSS Enabler dosyası bulundu: ${conflicts.join(', ')}.\nLütfen çakışan dosyaları temizleyin.` };
    }
    // Mevcut varsa adını koru, yoksa kullanıcının seçtiğini kullan
    const effectiveDllName = existingDll || dllName || 'version.dll';
    console.log(`[DLSS ENABLER] Kullanılacak DLL adı: ${effectiveDllName}${existingDll ? ' (mevcut tespit edildi)' : ' (kullanıcı seçimi)'}`);

    // Conflict Check (3. parti modlar vs)
    const conflictCheck = await checkConflicts(targetDir);
    if (conflictCheck.conflict) {
        console.warn(`[DLSS ENABLER] Çakışıyor: ${conflictCheck.file} zaten mevcut ve DLSS Enabler dosyası değil.`);
        return { success: false, error: `Çakışan mod tespit edildi: ${conflictCheck.file}. Lütfen mevcut modu kaldırıp tekrar deneyin.` };
    }

    // FIX 2e: Eski sürümün artık dosyalarını temizle
    const existingGamesStateCheck = config.getExistingGamesState();
    const existingGameEntry = existingGamesStateCheck.find(g => {
        try {
            const gDir = fs.statSync(g.exePath).isFile() ? path.dirname(g.exePath) : g.exePath;
            return path.resolve(gDir).toLowerCase() === path.resolve(targetDir).toLowerCase();
        } catch(e) { return false; }
    });
    if (existingGameEntry && existingGameEntry.hasDlssEnabler && existingGameEntry.dlssEnablerVersion && existingGameEntry.dlssEnablerVersion !== version) {
        const oldSourceDir = path.join(config.modsPath, 'dlssenabler', existingGameEntry.dlssEnablerVersion);
        if (fs.existsSync(oldSourceDir)) {
            console.log(`[DLSS ENABLER] Sürüm değiştiriliyor (${existingGameEntry.dlssEnablerVersion} → ${version}). Eski sürümün artık dosyaları temizleniyor...`);
            try {
                const oldFiles = fs.readdirSync(oldSourceDir);
                const newFiles = new Set(fs.readdirSync(sourceDir).map(f => f.toLowerCase()));
                for (const oldFile of oldFiles) {
                    // version.dll artık farklı bir isimle kurulmuş olabilir, onu atlıyoruz
                    if (oldFile.toLowerCase() === 'version.dll') continue;
                    if (!newFiles.has(oldFile.toLowerCase())) {
                        const staleFile = path.join(targetDir, oldFile);
                        if (fs.existsSync(staleFile)) {
                            console.log(`[DLSS ENABLER] Artık dosya siliniyor: ${staleFile}`);
                            fs.unlinkSync(staleFile);
                        }
                    }
                }
            } catch(e) {
                console.warn(`[DLSS ENABLER] Artık dosya temizleme başarısız (devam ediliyor):`, e.message);
            }
        }
    }

    // Dosyaları kopyala (version.dll → effectiveDllName olarak)
    const copyResult = await copyDlssFiles(sourceDir, targetDir, effectiveDllName);
    if (!copyResult.success) return copyResult;
    console.log(`[DLSS ENABLER] Kurulum başarıyla tamamlandı.`);

    const existingGamesState = config.getExistingGamesState();
    const normTargetName = game && game.name ? game.name.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    let dbGame = existingGamesState.find(g => {
        if (normTargetName && g.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normTargetName) {
            return true;
        }
        return isSameGame(g, exePath);
    });

    // Resolve the correct game_root before updating dbGame.exePath or saving to user-games.json
    const gameNameForLookup = game && game.name ? game.name : (dbGame ? dbGame.name : '');
    const resolvedGameRoot = config.resolveActualGameRoot(gameNameForLookup, exePath) || path.dirname(exePath);

    if (dbGame) {
        dbGame.hasDlssEnabler = true;
        dbGame.dlssEnablerVersion = version;
        dbGame.dlssEnablerPath = targetDir;
        if (!dbGame.upscalers) dbGame.upscalers = { dlss: false, xess: false, fsr: false, dlssEnabler: true };      
        else dbGame.upscalers.dlssEnabler = true;
        dbGame.exePath = exePath;
        config.saveGamesState();
    } else {
        const defaultName = (game && game.name) ? game.name : path.basename(path.dirname(exePath));
        dbGame = await scanner.processAndStreamGame({
            name: defaultName,
            exePath: exePath,
            source: 'manual',
            coverUrl: null
        }, null);
        if (dbGame) {
            dbGame.dlssEnablerVersion = version;
            dbGame.dlssEnablerPath = targetDir;
            config.saveGamesState();
        }
    }

    // After successful manual install — auto-save to user-games.json if not already there
    let savedToUserGames = false;
    if (exePath && exePath.toLowerCase().endsWith('.exe')) {
        try {
            // Priority 1: user-games.json'da bu exe'ye ait kayıt var mı?
            const userGames = config.getUserGames();
            const exePathNorm = path.resolve(exePath).toLowerCase();
            const existingUserKey = Object.keys(userGames).find(k => {
                const ep = userGames[k].exe_path;
                return ep && path.resolve(ep).toLowerCase() === exePathNorm;
            });

            if (existingUserKey) {
                // Already in user-games.json — nothing to do
                console.log(`[DLSS ENABLER] Oyun zaten user-games.json'da: key="${existingUserKey}"`);
            } else {
                // Priority 2: Use game name if provided, otherwise find in game state or fallback to parent directory
                let gameName = (game && game.name) ? game.name : null;
                if (!gameName) {
                    const allGames = config.getExistingGamesState();
                    const matchedGame = allGames.find(g => {
                        if (normTargetName && g.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normTargetName) {
                            return true;
                        }
                        return isSameGame(g, exePath);
                    });
                    gameName = matchedGame ? matchedGame.name : path.basename(path.dirname(exePath));
                }

                const normKey = config.normalizeGameKey(gameName);
                userGames[normKey] = {
                    game_root: resolvedGameRoot,
                    exe_path: exePath,
                    display_name: gameName
                };
                config.saveUserGames(userGames);
                savedToUserGames = true;
                console.log(`[DLSS ENABLER] Manuel kurulum sonrası user-games.json'a kaydedildi: key="${normKey}", name="${gameName}"`);
            }
        } catch (saveErr) {
            console.warn('[DLSS ENABLER] user-games.json kaydı başarısız (kurulum etkilenmez):', saveErr.message);
        }
    }

    return { success: true, savedToUserGames, games: config.getExistingGamesState() };
}
async function autoInstallDlss(event, game, version, dllName, downloadUrl) {
    console.log(`[DLSS ENABLER] Otomatik kurulum başlatıldı. Oyun: ${game.name}, Sürüm: ${version}, İstenen DLL: ${dllName || 'version.dll'}`);

    // --- Resolve target paths via the dual-layer system ---
    const paths = config.getGamePaths(game.name, game.exePath);

    if (!paths) {
        return {
            success: false,
            error: 'Bu oyun için yol bulunamadı. Lütfen Ayarlar → "Kullanıcı Oyun Yolları" bölümünden oyunun ana klasörünü ve EXE yolunu tanımlayın ya da Manuel Kur seçeneğini kullanın.'
        };
    }

    // For auto-install we require a concrete .exe path, not just a directory
    const exePathResolved = paths.exe_path;
    if (!exePathResolved || !exePathResolved.toLowerCase().endsWith('.exe') || !fs.existsSync(exePathResolved)) {
        return {
            success: false,
            error: `EXE dosyası bulunamadı: "${exePathResolved}".\n\nLütfen Ayarlar bölümünden oyunun tam EXE yolunu tanımlayın.`
        };
    }

    const targetExeDir = path.dirname(exePathResolved);
    console.log(`[DLSS ENABLER] Hedef EXE klasörü: ${targetExeDir} (kaynak: ${paths.source})`);

    const versionDir = path.join(config.modsPath, 'dlssenabler', version);
    let alreadyDownloaded = false;
    if (fs.existsSync(versionDir)) {
        try {
            const dirFiles = fs.readdirSync(versionDir).map(f => f.toLowerCase());
            if (dirFiles.includes('version.dll')) {
                alreadyDownloaded = true;
            }
        } catch (e) {}
    }

    if (!alreadyDownloaded) {
        if (!downloadUrl) {
            return { success: false, error: 'Bu sürüm henüz indirilmemiş ve indirme linki bulunamadı.' };
        }
        console.log(`[DLSS ENABLER] Sürüm henüz indirilmemiş, indiriliyor: ${version}`);
        const dlResult = await downloadDlssEnablerRelease(event, { name: version, downloadUrl });
        if (!dlResult.success) {
            return { success: false, error: dlResult.error || 'İndirme başarısız.' };
        }
    }

    const sourceDir = versionDir;

    // Mevcut DLSS Enabler DLL'ini canlı tara
    const { found: existingDll, conflicts } = await findExistingDlssEnablerDll(targetExeDir);
    if (conflicts.length > 1) {
        return { success: false, error: `Klasörde birden fazla DLSS Enabler dosyası bulundu: ${conflicts.join(', ')}.\nLütfen çakışan dosyaları temizleyin.` };
    }
    const effectiveDllName = existingDll || dllName || 'version.dll';
    console.log(`[DLSS ENABLER] Kullanılacak DLL adı: ${effectiveDllName}${existingDll ? ' (mevcut tespit edildi)' : ' (kullanıcı seçimi)'}`);

    // Conflict check for auto-install
    const conflictCheck = await checkConflicts(targetExeDir);
    if (conflictCheck.conflict) {
        console.warn(`[DLSS ENABLER] Otomatik kurulum çakışması: ${conflictCheck.file} zaten mevcut ve DLSS Enabler dosyası değil.`);
        return { success: false, error: `Çakışan mod tespit edildi: ${conflictCheck.file}. Lütfen mevcut modu kaldırıp tekrar deneyin.` };
    }

    // Dosyaları kopyala (version.dll → effectiveDllName olarak)
    const copyResult = await copyDlssFiles(sourceDir, targetExeDir, effectiveDllName);
    if (!copyResult.success) return copyResult;
    console.log(`[DLSS ENABLER] Otomatik kurulum başarıyla tamamlandı.`);

    // Update game state
    const normTargetName = game.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const existingGamesState = config.getExistingGamesState();
    let dbGame = existingGamesState.find(g => g.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normTargetName);
    if (dbGame) {
        dbGame.hasDlssEnabler = true;
        dbGame.dlssEnablerVersion = version;
        dbGame.dlssEnablerPath = targetExeDir;
        if (!dbGame.upscalers) dbGame.upscalers = { dlss: false, xess: false, fsr: false, dlssEnabler: true };
        else dbGame.upscalers.dlssEnabler = true;

        // Update exePath to the resolved .exe if it's more specific
        if (exePathResolved.endsWith('.exe')) {
            dbGame.exePath = exePathResolved;
        }

        config.saveGamesState();
    }

    return { success: true, games: config.getExistingGamesState() };
}


// ── DLSS Sürüm Yöneticisi ─────────────────────────────────────────────────────

const os = require('os');
const AdmZip = require('adm-zip');

/**
 * adm-zip senkron çıkartmasını setImmediate ile Promise'e sarer
 * (Revizyon 3: main process event loop'unu bloke etme)
 */
function extractEntryAsync(zip, entry, targetDir) {
    return new Promise((resolve, reject) => {
        setImmediate(() => {
            try {
                zip.extractEntryTo(entry.entryName, targetDir, false, true);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Sürüklenen ZIP dosyasını doğrular ve version.dll'den sürüm bilgisini okur.
 * (Revizyon 1: filePath string olarak gelir, buffer geçirilmez)
 * (Revizyon 2: çıkartmadan önce ZIP içeriği doğrulanır)
 * (Revizyon 4: PowerShell null dönerse version: null döndürülür)
 */
async function parseZipForDlss(filePath) {
    let tempDir = null;
    try {
        // Adım 1: ZIP'i diskten aç (belleğe almaz)
        const zip = new AdmZip(filePath);
        const entries = zip.getEntries();

        // Adım 2: version.dll var mı? (Revizyon 2 — erken doğrulama)
        const versionEntry = entries.find(e =>
            !e.isDirectory && e.entryName.toLowerCase().split('/').pop() === 'version.dll'
        );
        if (!versionEntry) {
            return { success: false, error: 'Geçersiz mod dosyası: ZIP içinde version.dll bulunamadı.' };
        }

        // Adım 3: Temp klasörü oluştur ve sadece version.dll'i çıkart
        tempDir = path.join(os.tmpdir(), `dlss-parse-${Date.now()}`);
        await fs.promises.mkdir(tempDir, { recursive: true });

        await extractEntryAsync(zip, versionEntry, tempDir);

        // Adım 4: PowerShell ile sürüm oku
        const tempDllPath = path.join(tempDir, 'version.dll');
        const version = await utils.getFileVersion(tempDllPath);

        // Revizyon 4: boş dönerse null (renderer'da manuel giriş açılır)
        return { success: true, version: version || null };
    } catch (e) {
        console.error('[DLSS-UPLOAD] parseZipForDlss hatası:', e.message);
        return { success: false, error: `ZIP okunurken hata: ${e.message}` };
    } finally {
        // Revizyon: force:true — salt okunur dosya olsa bile sil (her koşulda)
        if (tempDir) {
            fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    }
}

/**
 * Doğrulanmış ZIP dosyasından version.dll'i mods/dlssenabler/<version>/ klasörüne kurar.
 * (Revizyon 5: EPERM/EBUSY — kilitli dosya tespiti)
 */
async function installDlssFromZip(filePath, version) {
    const destDir = path.join(config.modsPath, 'dlssenabler', version);

    try {
        await fs.promises.mkdir(destDir, { recursive: true });

        const zip = new AdmZip(filePath);
        const entries = zip.getEntries();
        const versionEntry = entries.find(e =>
            !e.isDirectory && e.entryName.toLowerCase().split('/').pop() === 'version.dll'
        );

        if (!versionEntry) {
            return { success: false, error: 'Geçersiz mod dosyası: ZIP içinde version.dll bulunamadı.' };
        }

        // Promise sarmalı async çıkartma (Revizyon 3)
        await extractEntryAsync(zip, versionEntry, destDir);

        console.log(`[DLSS-UPLOAD] Başarıyla kuruldu: ${destDir}`);
        return { success: true };
    } catch (e) {
        console.error('[DLSS-UPLOAD] installDlssFromZip hatası:', e.message, e.code);
        // Revizyon 5: kilitli dosya hatası
        if (e.code === 'EPERM' || e.code === 'EBUSY') {
            return {
                success: false,
                error: 'Dosya kullanımda. Lütfen oyunu veya ilgili programı kapatıp tekrar deneyin.'
            };
        }
        return { success: false, error: `Kurulum hatası: ${e.message}` };
    }
}

async function getDlssEnablerReleases() {
    const now = Date.now();
    if (releasesCache && (now - cacheTime < CACHE_TTL)) {
        console.log("[DLSS ENABLER] Returning cached releases.");
        return releasesCache.map(r => {
            const targetDir = path.join(config.modsPath, 'dlssenabler', r.name);
            let installed = false;
            if (fs.existsSync(targetDir)) {
                try {
                    const files = fs.readdirSync(targetDir);
                    if (files.length > 0) {
                        installed = true;
                    }
                } catch (e) {}
            }
            return { ...r, installed };
        });
    }

    try {
        const response = await fetch('https://api.github.com/repos/vuenxx/extra_goldteam34/releases', {
            headers: { 'User-Agent': 'vuenxxFG' }
        });

        if (response.status === 403) {
            const rateLimitReset = response.headers.get('X-RateLimit-Reset');
            let errorMsg = "GitHub API limitine ulaşıldı. Lütfen daha sonra tekrar deneyin.";
            if (rateLimitReset) {
                const resetDate = new Date(parseInt(rateLimitReset) * 1000);
                errorMsg += ` (Sıfırlanma zamanı: ${resetDate.toLocaleTimeString()})`;
            }
            throw new Error(errorMsg);
        }

        if (!response.ok) throw new Error(`GitHub API HTTP error: ${response.status}`);
        const releases = await response.json();

        if (!Array.isArray(releases)) {
            throw new Error("Invalid response format from GitHub API.");
        }

        const mappedReleases = [];
        for (const r of releases) {
            const asset = r.assets && r.assets.find(a => {
                const nameLow = a.name.toLowerCase();
                return nameLow.endsWith('.zip') || nameLow.endsWith('.7z');
            });
            if (!asset) continue;

            const tag = r.tag_name;
            const name = r.name || r.tag_name;

            mappedReleases.push({
                name: name,
                tag: tag,
                downloadUrl: asset.browser_download_url
            });
        }

        releasesCache = mappedReleases;
        cacheTime = now;

        return mappedReleases.map(r => {
            const targetDir = path.join(config.modsPath, 'dlssenabler', r.name);
            let installed = false;
            if (fs.existsSync(targetDir)) {
                try {
                    const files = fs.readdirSync(targetDir);
                    if (files.length > 0) {
                        installed = true;
                    }
                } catch (e) {}
            }
            return { ...r, installed };
        });
    } catch (e) {
        console.error("Failed to fetch DLSS Enabler releases:", e);
        if (releasesCache) {
            console.log("[DLSS ENABLER] Fetch failed, returning stale cache as fallback.");
            return releasesCache.map(r => {
                const targetDir = path.join(config.modsPath, 'dlssenabler', r.name);
                let installed = false;
                if (fs.existsSync(targetDir)) {
                    try {
                        const files = fs.readdirSync(targetDir);
                        if (files.length > 0) {
                            installed = true;
                        }
                    } catch (err) {}
                }
                return { ...r, installed };
            });
        }
        return { error: e.message };
    }
}

async function downloadDlssEnablerRelease(event, { name, downloadUrl }) {
    if (!downloadUrl) throw new Error("İndirme linki bulunamadı.");

    const targetDir = path.join(config.modsPath, 'dlssenabler', name);

    const is7z = downloadUrl.toLowerCase().endsWith('.7z');
    const ext = is7z ? '.7z' : '.zip';
    const tempZipPath = path.join(app.getPath('temp'), `dlssenabler_${name.replace(/[^a-z0-9.-]/gi, '_')}${ext}`);

    try {
        const response = await fetch(downloadUrl);
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);

        const contentLength = +response.headers.get('Content-Length') || 0;
        const reader = response.body.getReader();
        let receivedLength = 0;
        let chunks = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;
            if (contentLength && event && event.sender && !event.sender.isDestroyed()) {
                const percent = Math.round((receivedLength / contentLength) * 100);
                event.sender.send('dlss-enabler-download-progress', { percent });
            }
        }

        const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
        fs.writeFileSync(tempZipPath, buffer);

        if (fs.existsSync(targetDir)) {
            try {
                fs.rmSync(targetDir, { recursive: true, force: true });
            } catch (e) {
                console.error("Failed to clean targetDir:", e);
            }
        }
        fs.mkdirSync(targetDir, { recursive: true });

        if (event && event.sender && !event.sender.isDestroyed()) {
            event.sender.send('dlss-enabler-download-progress', { percent: 100, stage: 'extracting' });
        }

        await extractArchive(tempZipPath, targetDir);

        try {
            fs.unlinkSync(tempZipPath);
        } catch (e) {
            console.error("Failed to clean up temp zip:", e);
        }

        return { success: true, targetDir };
    } catch (e) {
        console.error("DLSS Enabler download error:", e);
        try {
            if (fs.existsSync(tempZipPath)) {
                fs.unlinkSync(tempZipPath);
            }
        } catch (unlinkErr) {}
        try {
            if (fs.existsSync(targetDir)) {
                fs.rmSync(targetDir, { recursive: true, force: true });
            }
        } catch (rmErr) {}
        return { success: false, error: e.message };
    }
}

module.exports = {
    isSameGame,
    getDlssVersions,
    selectExe,
    findExistingDlssEnablerDll,
    executeDlssInstall,
    autoInstallDlss,
    parseZipForDlss,
    installDlssFromZip,
    getDlssEnablerReleases,
    downloadDlssEnablerRelease
};
