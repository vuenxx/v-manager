'use strict';

/**
 * moduleManager.js — Manifest Tabanlı Modül Yöneticisi
 *
 * Sorumlulukları:
 * - modules/ altındaki manifest dosyalarını keşfetme ve yükleme
 * - Manifest doğrulama
 * - Genel module-* IPC handler'larını kaydetme
 * - Modül bilgilerini sorgulama
 * - Özel (custom) manifest kaydetme / silme
 *
 * ipc.js'e tek bir noktadan bağlanır — yeni mod eklendiğinde
 * ipc.js'e yeni satır eklemeye gerek kalmaz.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const manifestValidator = require('./manifestValidator');
const moduleEngine = require('./moduleEngine');
const config = require('../../config');
const configEditor = require('./configEditor');
const moduleWizardEngine = require('./moduleWizardEngine');

const TAG = '[MODULE_MANAGER]';

// ── Yüklü modüller ────────────────────────────────────────────────────────────
const loadedModules = new Map();  // moduleId -> { manifest, dir, type }

// ── Modül keşif dizinleri ─────────────────────────────────────────────────────
function _getModuleRoots() {
    const roots = [];

    // 1. Resmi modüller: src/main/modules/official/ (En yüksek öncelik)
    const officialDir = path.join(__dirname, '..', 'official');
    if (fs.existsSync(officialDir)) {
        roots.push({ path: officialDir, type: 'official' });
    }

    // 2. Topluluk modülleri: src/main/modules/community/
    const communityDir = path.join(__dirname, '..', 'community');
    if (fs.existsSync(communityDir)) {
        roots.push({ path: communityDir, type: 'community' });
    }

    // 3. Özel / Kullanıcı modülleri: %AppData%/userData/modules/
    // DİKKAT: AppData kökü EN SON eklenir ki resmi/topluluk modüllerini asla gölgelemesin (shadowing engeli)
    try {
        const customDir = path.join(app.getPath('userData'), 'modules');
        if (fs.existsSync(customDir)) {
            roots.push({ path: customDir, type: 'custom' });
        }
    } catch (e) {
        console.warn(`${TAG} AppData custom modül dizini alınamadı:`, e.message);
    }

    return roots;
}

// ─────────────────────────────────────────────────────────────────────────────
// init — Modül sistemini başlat, manifest'leri keşfet ve yükle
// ─────────────────────────────────────────────────────────────────────────────
function init() {
    console.log(`${TAG} Modül sistemi başlatılıyor...`);
    loadedModules.clear();

    const roots = _getModuleRoots();
    let totalLoaded = 0;
    let totalErrors = 0;

    for (const root of roots) {
        console.log(`${TAG} Taranıyor: ${root.path} (${root.type})`);

        if (!fs.existsSync(root.path)) {
            console.log(`${TAG} Dizin bulunamadı, atlanıyor: ${root.path}`);
            continue;
        }

        const entries = fs.readdirSync(root.path, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const manifestPath = path.join(root.path, entry.name, 'manifest.json');
            if (!fs.existsSync(manifestPath)) {
                console.log(`${TAG} manifest.json bulunamadı, atlanıyor: ${entry.name}`);
                continue;
            }

            try {
                const raw = fs.readFileSync(manifestPath, 'utf-8');
                const manifest = JSON.parse(raw);

                // Doğrulama
                const validation = manifestValidator.validate(manifest);
                if (!validation.valid) {
                    console.error(`${TAG} Geçersiz manifest (${entry.name}):`, validation.errors);
                    totalErrors++;
                    continue;
                }

                if (validation.warnings.length > 0) {
                    console.warn(`${TAG} Manifest uyarıları (${manifest.id}):`, validation.warnings);
                }

                // Çakışma kontrolü — İlk taranan (official/community) önceliklidir
                if (loadedModules.has(manifest.id)) {
                    console.warn(`${TAG} Aynı id ile modül zaten yüklü, atlanıyor: ${manifest.id} (${entry.name})`);
                    continue;
                }

                loadedModules.set(manifest.id, {
                    manifest,
                    dir: path.join(root.path, entry.name),
                    type: root.type
                });

                totalLoaded++;
                console.log(`${TAG} Modül yüklendi: ${manifest.id} (${manifest.name}) [${root.type}]`);

            } catch (e) {
                console.error(`${TAG} Manifest yükleme hatası (${entry.name}):`, e.message);
                totalErrors++;
            }
        }
    }

    console.log(`${TAG} Modül sistemi hazır. Yüklenen: ${totalLoaded}, Hata: ${totalErrors}`);
}

/**
 * Modüller henüz yüklenmediyse yükler.
 * Tarama (scanner) mod tespiti için manifest'lere ihtiyaç duyuyor ve
 * `init()` çağrısından önce tetiklenebilir; bu yüzden güvence katmanı.
 */
function ensureInit() {
    if (loadedModules.size === 0) {
        init();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Modül sorgulama
// ─────────────────────────────────────────────────────────────────────────────
function getModules() {
    const modules = [];
    for (const [id, mod] of loadedModules) {
        modules.push({
            id,
            name: mod.manifest.name,
            description: mod.manifest.description || '',
            author: mod.manifest.author || '',
            version: mod.manifest.version || '',
            type: mod.type,
            // 'addon' olanlar başka bir modun eklentisidir; mod seçim listesinde gösterilmez.
            role: mod.manifest.role || 'mod',
            dir: mod.dir,
            manifest: mod.manifest,
            source: {
                type: mod.manifest.source.type,
                repo: mod.manifest.source.repo
            },
            permissions: mod.manifest.permissions || [],
            metadata: mod.manifest.metadata || {}
        });
    }
    return modules;
}

function getModule(moduleId) {
    let mod = loadedModules.get(moduleId);

    // Takma ad (alias) araması — eski kayıtlar farklı id kullanmış olabilir
    // (ör. 'dlss-enabler'). Eşleme kodda sabit değil; her modül kendi
    // eski id'lerini manifest'te `aliases` ile bildirir.
    if (!mod && moduleId) {
        const wanted = String(moduleId).toLowerCase();
        for (const [, candidate] of loadedModules) {
            const aliases = candidate.manifest?.aliases;
            if (Array.isArray(aliases) && aliases.some(a => String(a).toLowerCase() === wanted)) {
                mod = candidate;
                break;
            }
        }
    }

    if (!mod) return null;
    return {
        id: mod.manifest?.id || moduleId,
        manifest: mod.manifest,
        dir: mod.dir,
        type: mod.type
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// registerIpcHandlers — Genel module-* IPC handler'larını kaydet
// ─────────────────────────────────────────────────────────────────────────────
function registerIpcHandlers(ipcMain) {
    console.log(`${TAG} IPC handler'lar kaydediliyor...`);

    // ── module-list: Yüklü modül listesi ──────────────────────────────────
    ipcMain.handle('module-list', async () => {
        return getModules();
    });

    // ── module-get-info: Tek modül bilgisi ────────────────────────────────
    ipcMain.handle('module-get-info', async (_event, { moduleId }) => {
        const mod = getModule(moduleId);
        if (!mod) {
            return { success: false, error: `Modül bulunamadı: ${moduleId}` };
        }
        return { success: true, module: { id: mod.id, manifest: mod.manifest, type: mod.type } };
    });

    // ── module-validate-manifest: Canlı manifest doğrulama ────────────────
    ipcMain.handle('module-validate-manifest', async (_event, manifest) => {
        return manifestValidator.validate(manifest);
    });

    // ── module-save-manifest: Özel manifest kaydetme ─────────────────────
    ipcMain.handle('module-save-manifest', async (_event, manifest) => {
        try {
            if (!manifest || typeof manifest !== 'object') {
                return { success: false, error: 'Geçersiz manifest verisi.' };
            }

            // 1. Proaktif ID Çakışma Kontrolü (Resmi / Topluluk modüllerini ezme koruması)
            if (manifest.id) {
                const existingMod = getModule(manifest.id);
                if (existingMod && (existingMod.type === 'official' || existingMod.type === 'community')) {
                    return {
                        success: false,
                        error: `Bu ID resmi veya topluluk modülü tarafından kullanılmaktadır: '${manifest.id}'. Lütfen farklı bir ID seçin.`
                    };
                }
            }

            // 2. Validasyon
            const validation = manifestValidator.validate(manifest);
            if (!validation.valid) {
                return { success: false, error: `Manifest geçersiz: ${validation.errors.join('; ')}` };
            }

            // 3. Hedef dizini garanti altına al (%AppData%/userData/modules/<id>/)
            const customModulesDir = path.join(app.getPath('userData'), 'modules');
            const targetDir = path.join(customModulesDir, manifest.id);
            fs.mkdirSync(targetDir, { recursive: true });

            const targetFile = path.join(targetDir, 'manifest.json');
            fs.writeFileSync(targetFile, JSON.stringify(manifest, null, 2), 'utf-8');

            console.log(`${TAG} Özel manifest kaydedildi: ${targetFile}`);

            // 4. Modül sistemini anında yeniden tara
            init();

            return {
                success: true,
                message: `'${manifest.name}' manifesti başarıyla kaydedildi.`,
                path: targetFile,
                moduleId: manifest.id
            };
        } catch (e) {
            console.error(`${TAG} module-save-manifest hatası:`, e);
            return { success: false, error: `Kaydetme hatası: ${e.message}` };
        }
    });

    // ── module-delete-custom-manifest: Özel manifest silme ────────────────
    ipcMain.handle('module-delete-custom-manifest', async (_event, { moduleId }) => {
        try {
            const mod = getModule(moduleId);
            if (!mod) {
                return { success: false, error: `Modül bulunamadı: ${moduleId}` };
            }

            // Güvenlik: Sadece custom (AppData) modülleri silinebilir
            if (mod.type !== 'custom') {
                return { success: false, error: `Sadece özel (custom) modüller silinebilir. '${mod.id}' bir ${mod.type} modüldür.` };
            }

            if (fs.existsSync(mod.dir)) {
                fs.rmSync(mod.dir, { recursive: true, force: true });
                console.log(`${TAG} Özel modül klasörü silindi: ${mod.dir}`);
            }

            // Yeniden tara
            init();

            return { success: true, message: `Modül başarıyla silindi: ${moduleId}` };
        } catch (e) {
            console.error(`${TAG} module-delete-custom-manifest hatası:`, e);
            return { success: false, error: e.message };
        }
    });

    // ── module-get-releases: GitHub release listesi ───────────────────────
    ipcMain.handle('module-get-releases', async (_event, payload, ...rest) => {
        let moduleId, forceRefresh;
        if (payload && typeof payload === 'object') {
            moduleId = payload.moduleId;
            forceRefresh = payload.forceRefresh || false;
        } else {
            moduleId = payload;
            forceRefresh = rest[0] || false;
        }

        const mod = getModule(moduleId);
        if (!mod) {
            console.error(`${TAG} [GET_RELEASES] Modül bulunamadı: "${moduleId}".`);
            return { success: false, error: `Modül bulunamadı: ${moduleId}`, message: `Modül bulunamadı: ${moduleId}` };
        }
        try {
            const result = await moduleEngine.getReleases(mod.manifest, forceRefresh);
            return { success: true, ...result };
        } catch (e) {
            console.error(`${TAG} module-get-releases hatası (${moduleId}):`, e);
            return { success: false, error: e.message, message: e.message };
        }
    });

    let actionLock = Promise.resolve();

    // ── module-install: Modül kurulumu ─────────────────────────────────────
    ipcMain.handle('module-install', async (event, data, ...rest) => {
        const unlock = actionLock;
        let resolveLock;
        actionLock = new Promise(r => resolveLock = r);
        await unlock;

        try {
            const ipc = require('../../ipc');
            if (ipc.isScanRunning && ipc.isScanRunning()) {
                return { success: false, error: 'scan_in_progress', message: 'Tarama devam ediyor, lütfen bekleyin.' };
            }

            let moduleId, gameName, exePath, tag, options;
            if (data && typeof data === 'object') {
                moduleId = data.moduleId;
                gameName = data.gameName;
                exePath = data.exePath || data.exe_path;
                tag = data.tag;
                options = data.options;
            } else {
                moduleId = data;
                gameName = rest[0];
                exePath = rest[1];
                tag = rest[2];
                options = rest[3];
            }

            console.log(`${TAG} [INSTALL_REQUEST] moduleId="${moduleId}", gameName="${gameName}", exePath="${exePath}", tag="${tag}"`);

            const mod = getModule(moduleId);
            if (!mod) {
                const loaded = Array.from(loadedModules.keys()).join(', ');
                console.error(`${TAG} [INSTALL_ERROR] Modül bulunamadı: "${moduleId}". Yüklü modüller: [${loaded}]`);
                return { 
                    success: false, 
                    error: `Modül bulunamadı: "${moduleId}" (Yüklü modüller: ${loaded})`,
                    message: `Modül bulunamadı: "${moduleId}"`
                };
            }

            const result = await moduleEngine.install(
                mod.manifest,
                gameName,
                exePath,
                tag,
                options || {},
                (progress) => {
                    if (event.sender && !event.sender.isDestroyed()) {
                        event.sender.send('module-progress', {
                            moduleId,
                            ...progress
                        });
                    }
                }
            );
            if (!result.success) {
                console.error(`${TAG} [INSTALL_FAILED] ${result.message || result.error}`);
            } else {
                // Manifest zorunluluğu / varsayılan olarak oyun yenilemesini yap
                const shouldRefresh = mod.manifest.install?.refreshGameOnComplete !== false;
                if (shouldRefresh) {
                    try {
                        const scanner = require('../../scanner');

                        // Mevcut kaydı bul — source/launcherId/cover KORUNMALI.
                        // (Daha önce burada source: 'manual' sabitti; Steam/Epic oyunları
                        //  her mod kurulumunda "manuel" durumuna düşüyordu.)
                        const normKey = config.normalizeGameKey(gameName || '');
                        const existing = config.getExistingGamesState().find(g =>
                            g.name && config.normalizeGameKey(g.name) === normKey
                        );

                        const resolvedRoot =
                            existing?.gameRoot ||
                            config.resolveActualGameRoot(gameName, exePath) ||
                            path.dirname(exePath || '');

                        if (resolvedRoot && fs.existsSync(resolvedRoot)) {
                            console.log(`${TAG} [INSTALL_REFRESH] Mod kurulumu tamamlandı, oyun yenileniyor: "${gameName}"`);
                            await scanner.processAndStreamGame({
                                name: existing?.name || gameName,
                                exePath: exePath || existing?.exePath,
                                gameRoot: resolvedRoot,
                                source: existing?.source || 'manual',
                                launcherId: existing?.launcherId || null,
                                cover: existing?.cover || null,
                                coverUrl: null
                            }, event);
                        }
                    } catch (refErr) {
                        console.error(`${TAG} [INSTALL_REFRESH_ERR]`, refErr);
                    }
                }
            }
            return {
                ...result,
                error: result.error || (result.success ? null : result.message),
                message: result.message || result.error
            };
        } catch (e) {
            console.error(`${TAG} [INSTALL_EXCEPTION] (${moduleId}):`, e);
            return { 
                success: false, 
                error: e.message || 'Bilinmeyen kurulum hatası', 
                message: e.message || 'Bilinmeyen kurulum hatası',
                stack: e.stack
            };
        } finally {
            resolveLock();
        }
    });

    // ── module-uninstall: Modül kaldırma ──────────────────────────────────
    ipcMain.handle('module-uninstall', async (_event, data, ...rest) => {
        const unlock = actionLock;
        let resolveLock;
        actionLock = new Promise(r => resolveLock = r);
        await unlock;

        try {
            const ipc = require('../../ipc');
            if (ipc.isScanRunning && ipc.isScanRunning()) {
                return { success: false, error: 'scan_in_progress', message: 'Tarama devam ediyor, lütfen bekleyin.' };
            }

            let moduleId, gameName, exePath;
            if (data && typeof data === 'object') {
                moduleId = data.moduleId;
                gameName = data.gameName;
                exePath = data.exePath || data.exe_path;
            } else {
                moduleId = data;
                gameName = rest[0];
                exePath = rest[1];
            }

            console.log(`${TAG} [UNINSTALL_REQUEST] moduleId="${moduleId}", gameName="${gameName}", exePath="${exePath}"`);

            const mod = getModule(moduleId);
            if (!mod) {
                return { success: false, error: `Modül bulunamadı: ${moduleId}`, message: `Modül bulunamadı: ${moduleId}` };
            }

            const result = await moduleEngine.uninstall(mod.manifest, gameName, exePath);
            if (result.success) {
                try {
                    const scanner = require('../../scanner');
                    const gameRoot = path.dirname(exePath || '');
                    if (gameRoot && fs.existsSync(gameRoot)) {
                        console.log(`${TAG} [UNINSTALL_REFRESH] Mod kaldırıldı, oyun yenileniyor: "${gameName}"`);
                        // Kaynak/kapak DB'den taşınır: sabit `source: 'manual'`
                        // geçilirse processAndStreamGame oyunun gerçek kaynağını
                        // (Steam/Epic/...) "manual"a çevirip kart etiketini bozuyor.
                        const dbGames = config.getExistingGamesState() || [];
                        const dbGame = dbGames.find(g =>
                            g && g.name && config.normalizeGameKey(g.name) === config.normalizeGameKey(gameName));
                        await scanner.processAndStreamGame({
                            name: gameName,
                            exePath: exePath,
                            gameRoot: (dbGame && dbGame.gameRoot) || gameRoot,
                            source: (dbGame && dbGame.source) || 'manual',
                            launcherId: (dbGame && dbGame.launcherId) || null,
                            cover: (dbGame && dbGame.cover) || null,
                            coverUrl: null
                        }, _event);
                    }
                } catch (refErr) {
                    console.error(`${TAG} [UNINSTALL_REFRESH_ERR]`, refErr);
                }
            }
            return {
                ...result,
                error: result.error || (result.success ? null : result.message),
                message: result.message || result.error
            };
        } catch (e) {
            console.error(`${TAG} module-uninstall hatası (${moduleId}):`, e);
            return { success: false, error: e.message, message: e.message, stack: e.stack };
        } finally {
            resolveLock();
        }
    });

    // ── module-check-conditions: Koşul kontrolü ──────────────────────────
    ipcMain.handle('module-check-conditions', async (_event, { moduleId, gameName, exePath }) => {
        const mod = getModule(moduleId);
        if (!mod) {
            return { success: false, error: `Modül bulunamadı: ${moduleId}` };
        }

        if (!mod.manifest.conditions || mod.manifest.conditions.length === 0) {
            return { success: true, passed: true, failures: [] };
        }

        try {
            const conditionChecker = require('./conditionChecker');
            const result = await conditionChecker.checkConditions(
                mod.manifest.conditions,
                { gameName, exePath }
            );
            return { success: true, ...result };
        } catch (e) {
            console.error(`${TAG} module-check-conditions hatası (${moduleId}):`, e);
            return { success: false, error: e.message };
        }
    });

    // ── module-download-release: Sürüm indirme ──────────────────────────
    ipcMain.handle('module-download-release', async (event, { moduleId, tag, downloadUrl }) => {
        const mod = getModule(moduleId);
        if (!mod) {
            return { success: false, error: `Modül bulunamadı: ${moduleId}` };
        }

        try {
            return await moduleEngine.downloadRelease(mod.manifest, tag, downloadUrl, event);
        } catch (e) {
            console.error(`${TAG} module-download-release hatası (${moduleId}):`, e);
            return { success: false, error: e.message };
        }
    });

    // ── module-list-backups: Backup listesi ───────────────────────────────
    ipcMain.handle('module-list-backups', async (_event, { moduleId, gameName }) => {
        try {
            const backupModule = require('./backup');
            return await backupModule.listBackups(gameName, moduleId);
        } catch (e) {
            console.error(`${TAG} module-list-backups hatası:`, e);
            return [];
        }
    });

    // ── module-get-active-for-game: Oyun için aktif modülleri listele ────
    ipcMain.handle('module-get-active-for-game', async (_event, game) => {
        try {
            // Renderer'dan gelen `game` nesnesi bayat olabilir (or. mod kaldirildiktan
            // hemen sonra elde kalan eski kopya). Kurulu mod listesi her zaman
            // games.json'daki guncel kayittan surulur; DB'de bulunamazsa gelen
            // nesneye geri dusulur.
            try {
                const dbGames = config.getExistingGamesState();
                if (game && Array.isArray(dbGames)) {
                    const dbGame = dbGames.find(g =>
                        (g && g.name && game.name &&
                            config.normalizeGameKey(g.name) === config.normalizeGameKey(game.name)) ||
                        (g && g.exePath && game.exePath &&
                            path.resolve(g.exePath).toLowerCase() === path.resolve(game.exePath).toLowerCase())
                    );
                    if (dbGame) game = dbGame;
                }
            } catch (dbErr) {
                console.warn(`${TAG} module-get-active-for-game DB eslestirmesi basarisiz:`, dbErr.message);
            }

            const activeMods = [];
            for (const [id, mod] of loadedModules) {
                const manifest = mod.manifest;
                if (!manifest) continue;

                let isActive = false;
                // 1. manifest.state.flag kontrolü
                if (manifest.state?.flag && game && game[manifest.state.flag] === true) {
                    isActive = true;
                }
                // 2. game.installedMods kontrolü
                else if (game && game.installedMods && game.installedMods[id]?.installed) {
                    isActive = true;
                }

                // Tüm aktif modları üstverileriyle döndür
                if (isActive) {
                    let installedVersion = null;
                    if (manifest.state?.versionField && game && game[manifest.state.versionField]) {
                        installedVersion = game[manifest.state.versionField];
                    } else if (game && game.installedMods && game.installedMods[id]?.version) {
                        installedVersion = game.installedMods[id].version;
                    }

                    activeMods.push({
                        id: id,
                        name: manifest.name || id,
                        description: manifest.description || '',
                        type: mod.type,
                        installedVersion: installedVersion || 'Mevcut',
                        hasConfig: Array.isArray(manifest.config) && manifest.config.length > 0,
                        hasReleases: Boolean(manifest.source && manifest.source.type === 'github'),
                        manifest: manifest
                    });
                }
            }
            return { success: true, activeMods };
        } catch (err) {
            console.error(`${TAG} module-get-active-for-game hatası:`, err);
            return { success: false, error: err.message, activeMods: [] };
        }
    });

    // ── module-detect-api: Oyun exe'sinin grafik API'si ve bit genisligi ────
    // Kurulum modali, apiTargeting kullanan modullerde (or. ReShade) hedef API'yi
    // on secili gostermek icin bunu cagirir.
    // `options` (statik API listesi) tespitten bagimsizdir: exe bulunamasa da
    // kullanici API'yi elle secebilmeli. Bu yuzden hata dallarinda da gonderilir.
    ipcMain.handle('module-detect-api', async (_event, { gameName, exePath } = {}) => {
        const exeApiDetector = require('./exeApiDetector');
        let options = [];
        try {
            options = exeApiDetector.getApiOptions();
        } catch (err) {
            console.error(`${TAG} getApiOptions hatasi:`, err);
        }

        try {
            let targetExe = exePath;

            if (!targetExe && gameName) {
                const paths = config.getGamePaths(gameName, null);
                targetExe = paths && paths.exe_path ? paths.exe_path : null;
            }
            if (!targetExe) {
                return { success: false, error: 'Oyun exe yolu bulunamadi.', options };
            }

            const detection = await exeApiDetector.detectApi(targetExe);
            return {
                success: detection.success,
                error: detection.error || null,
                detection,
                options
            };
        } catch (err) {
            console.error(`${TAG} module-detect-api hatasi:`, err);
            return { success: false, error: err.message, options };
        }
    });

    // ── module-check-requirements: Modülün ön koşulları sağlanıyor mu ──────
    // Kurulum modalı, indirme başlamadan önce "ReShade kurulu mu?" gibi
    // bağımlılıkları sormak için bunu çağırır. Motorun 5c adımıyla aynı
    // dizine bakması şart — bu yüzden hedef klasör resolveDestinationDir ile
    // birebir aynı şekilde çözülür.
    ipcMain.handle('module-check-requirements', async (_event, { moduleId, gameName, exePath } = {}) => {
        try {
            const mod = getModule(moduleId);
            if (!mod) {
                return { success: false, error: `Modül bulunamadı: ${moduleId}` };
            }

            const manifest = mod.manifest;
            if (!Array.isArray(manifest.requires) || manifest.requires.length === 0) {
                return { success: true, satisfied: true, results: [], failures: [] };
            }

            const gameDir = moduleEngine.resolveDestinationDir(manifest, gameName, exePath);
            const requirementChecker = require('./requirementChecker');
            const result = await requirementChecker.checkRequirements(manifest, {
                gameName, exePath, gameDir
            });

            return { success: true, ...result };
        } catch (err) {
            console.error(`${TAG} module-check-requirements hatası:`, err);
            // Kontrol edilemedi ≠ ön koşul eksik. UI bu durumda kurulumu
            // engellemez, yalnızca "kontrol edilemedi" uyarısı gösterir.
            return { success: false, error: err.message };
        }
    });

    // ── module-check-conflicts: Bu modülle çakışan bir modül kurulu mu ─────
    // Kurulum modalı, indirme başlamadan önce "OptiScaler zaten kurulu" gibi
    // bildirilmiş çakışmaları göstermek için bunu çağırır. Motorun 5d adımı
    // aynı sonucu okur; `failures` şekli requires/conditions ile birebir aynı.
    ipcMain.handle('module-check-conflicts', async (_event, { moduleId, gameName, exePath } = {}) => {
        try {
            const mod = getModule(moduleId);
            if (!mod) {
                return { success: false, error: `Modül bulunamadı: ${moduleId}` };
            }

            const manifest = mod.manifest;
            const conflictChecker = require('./conflictChecker');
            const entries = conflictChecker.normalizeConflictEntries(manifest);
            if (entries.length === 0) {
                return { success: true, clear: true, results: [], failures: [] };
            }

            const gameDir = moduleEngine.resolveDestinationDir(manifest, gameName, exePath);
            const result = await conflictChecker.checkDeclaredConflicts(manifest, {
                gameName, exePath, gameDir
            });

            return { success: true, ...result };
        } catch (err) {
            console.error(`${TAG} module-check-conflicts hatası:`, err);
            // Kontrol edilemedi ≠ çakışma var. UI bu durumda kurulumu engellemez.
            return { success: false, error: err.message };
        }
    });

    // ── module-read-config: Generic konfigürasyon dosyası okuma ─────────────
    ipcMain.handle('module-read-config', async (_event, { moduleId, gameName, exePath, configIndex = 0 }) => {
        try {
            const mod = getModule(moduleId);
            if (!mod) {
                return { success: false, error: `Modül bulunamadı: ${moduleId}` };
            }
            const manifest = mod.manifest;
            const configList = Array.isArray(manifest.config) ? manifest.config : [];
            const configEntry = configList[configIndex] || configList.find(c => c.format === 'ini') || configList[0];

            if (!configEntry) {
                return { success: false, error: `Modül için config tanımı bulunamadı: ${moduleId}` };
            }

            const searchBaseDir = moduleEngine.resolveDestinationDir(manifest, gameName, exePath);
            if (!searchBaseDir) {
                return { success: false, error: `Oyun dizini çözümlenemedi: ${gameName}` };
            }

            const searchNames = configEntry.search || [configEntry.file];
            const configPath = configEditor.findConfigFile(searchBaseDir, searchNames);

            if (!configPath) {
                return { success: true, exists: false, data: {}, filePath: null };
            }

            const readResult = await configEditor.readConfig(configPath, configEntry.format || 'ini');
            return {
                success: true,
                exists: readResult.exists !== false,
                data: readResult.data || {},
                filePath: configPath
            };
        } catch (err) {
            console.error(`${TAG} module-read-config hatası:`, err);
            return { success: false, error: err.message };
        }
    });

    // ── module-apply-config-changes: Generic ayar değişikliği / preset uygulama ──
    ipcMain.handle('module-apply-config-changes', async (_event, { moduleId, gameName, exePath, changes, configIndex = 0 }) => {
        try {
            const mod = getModule(moduleId);
            if (!mod) {
                return { success: false, error: `Modül bulunamadı: ${moduleId}` };
            }
            const manifest = mod.manifest;
            const configList = Array.isArray(manifest.config) ? manifest.config : [];
            const configEntry = configList[configIndex] || configList.find(c => c.format === 'ini') || configList[0];

            if (!configEntry) {
                return { success: false, error: `Modül için config tanımı bulunamadı: ${moduleId}` };
            }

            const searchBaseDir = moduleEngine.resolveDestinationDir(manifest, gameName, exePath);
            if (!searchBaseDir) {
                return { success: false, error: `Oyun dizini çözümlenemedi: ${gameName}` };
            }

            const searchNames = configEntry.search || [configEntry.file];
            let configPath = configEditor.findConfigFile(searchBaseDir, searchNames);

            if (!configPath) {
                if (configEntry.createIfMissing) {
                    configPath = path.join(searchBaseDir, configEntry.file);
                } else {
                    return { success: false, error: `Konfigürasyon dosyası bulunamadı: ${configEntry.file}` };
                }
            }

            const applied = await configEditor.applyChanges(configPath, configEntry.format || 'ini', changes, {
                createIfMissing: configEntry.createIfMissing
            });

            return { success: applied, filePath: configPath };
        } catch (err) {
            console.error(`${TAG} module-apply-config-changes hatası:`, err);
            return { success: false, error: err.message };
        }
    });

    // ── module-wizard-run: Manifest tabanlı sihirbazı çalıştır ──────────
    let isWizardAborted = false;
    ipcMain.handle('module-wizard-run', async (event, data = {}) => {
        try {
            isWizardAborted = false;
            const moduleId = data.moduleId;
            const mod = getModule(moduleId);
            if (!mod) {
                return { success: false, error: `Modül bulunamadı: ${moduleId}` };
            }
            const manifest = mod.manifest;
            if (!manifest.wizard) {
                return { success: false, error: `Bu modül için sihirbaz tanımlanmamış: ${moduleId}` };
            }

            const game = data.game || (data.gameName ? { name: data.gameName, exePath: data.exePath } : { name: 'Game' });
            const exePath = data.exePath || game.exePath || game.exe_path;
            const developerPreset = data.developerPreset || data.options?.preset;

            return await moduleWizardEngine.runModuleWizard(event, {
                manifest,
                game,
                version: data.version,
                dllName: data.dllName,
                downloadUrl: data.downloadUrl,
                developerPreset,
                exePath,
                lang: data.lang
            }, () => isWizardAborted);
        } catch (err) {
            console.error(`${TAG} module-wizard-run hatası:`, err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('module-wizard-abort', async () => {
        isWizardAborted = true;
        return { success: true };
    });

    // ── module-reload: Modülleri yeniden yükle ───────────────────────────
    ipcMain.handle('module-reload', async () => {
        try {
            init();
            return { success: true, modules: getModules() };
        } catch (e) {
            console.error(`${TAG} module-reload hatası:`, e);
            return { success: false, error: e.message };
        }
    });

    console.log(`${TAG} IPC handler'lar kaydedildi`);
}

module.exports = {
    init,
    ensureInit,
    getModules,
    getModule,
    registerIpcHandlers
};
