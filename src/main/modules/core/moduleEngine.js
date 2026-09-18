'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const config = require('../../config');
const utils = require('../../utils');
const archive = require('./archive');
const githubFetcher = require('./githubFetcher');
// Kaynak cozucu: manifest GitHub'a bagli olmak zorunda degil (source.type: 'url')
const sourceResolver = require('./sourceResolver');
// Oyun exe'sinin grafik API'si + bit genisligi (apiTargeting icin)
const exeApiDetector = require('./exeApiDetector');
const configEditor = require('./configEditor');
const conditionChecker = require('./conditionChecker');
// Ön koşullar: bu mod kurulmadan önce kurulu olması gereken diğer modüller
const requirementChecker = require('./requirementChecker');
// Çakışmalar: manifest'te bildirilen (`conflicts`) + dosya sahipliğinden doğan dahili çakışma
const conflictChecker = require('./conflictChecker');
const backup = require('./backup');
const { createLogger, getLogFilePath } = require('./moduleLogger');
const manifestValidator = require('./manifestValidator');

const TAG = '[MODULE_ENGINE]';

function matchGlob(str, pattern) {
    if (!pattern) return true;
    const escapeRegex = (s) => s.replace(/([.*+?^=!:${}()|[\]\/\\])/g, '\\$1');
    const regexRule = pattern.split('*').map(escapeRegex).join('.*');
    return new RegExp('^' + regexRule + '$', 'i').test(str);
}

/**
 * Motor seviyesi derinlemesine dosya arama (uninstaller.js ile aynı)
 */
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
                const nameMatches = entry.name.toLowerCase() === targetName.toLowerCase();

                if (entry.isFile() && nameMatches) {
                    found.push(path.join(dir, entry.name));
                } else if (entry.isDirectory()) {
                    // Adı hedefle eşleşen KLASÖR de sonuçtur — manifest uninstall.files
                    // girdileri klasör adı olabilir (ör. "dummy-folder"). Eşleşen klasörün
                    // içine inmeye gerek yok, tamamı silinecek.
                    if (nameMatches) {
                        found.push(path.join(dir, entry.name));
                        continue;
                    }
                    if (depth < maxDepth) {
                        const nameLow = entry.name.toLowerCase();
                        if (!ignoreDirs.some(d => nameLow.includes(d))) {
                            queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
                        }
                    }
                }
            }
        } catch (e) {}
    }
    return found;
}

/**
 * Eklenti (addon) kurulumu.
 *
 * Addon'lar manifest'te KENDİ repo bilgilerini tekrarlamaz; var olan bir modülün
 * id'sini referans alır (ör. optiscaler → optipatcher, fsr4). Böylece repo/asset
 * bilgisi tek yerde (ilgili modülün kendi manifest'inde) kalır.
 *
 * Eski optiScaler.js davranışı korunur: bir addon başarısız olursa ANA kurulum
 * bozulmaz, yalnızca uyarı olarak raporlanır.
 *
 * @param {object} parentManifest  Ana modülün manifest'i (addons tanımını içerir)
 * @param {object} options         install() options — options.addons: { <id>: true | {tag, downloadUrl} }
 * @param {string} destDir         Ana modülün kurulum dizini
 * @param {object} logger
 * @returns {Promise<{installed: string[], warnings: string[], configChanges: object}>}
 */
async function installAddons(parentManifest, options, destDir, logger) {
    const installed = [];
    const warnings = [];
    const configChanges = {};
    const installedPaths = [];

    const requested = options?.addons;
    if (!Array.isArray(parentManifest.addons) || !requested) {
        return { installed, warnings, configChanges, installedPaths };
    }

    // Döngüsel require: moduleManager zaten moduleEngine'i yüklüyor, bu yüzden
    // burada çağrı anında (lazy) alınır.
    const moduleManager = require('./moduleManager');

    for (const addon of parentManifest.addons) {
        const sel = requested[addon.moduleId];
        if (!sel) continue; // kullanıcı bu eklentiyi seçmemiş

        const addonLabel = addon.label || addon.moduleId;

        try {
            const refMod = moduleManager.getModule(addon.moduleId);
            if (!refMod) {
                throw new Error(`Referans modül bulunamadı: ${addon.moduleId}`);
            }
            const addonManifest = refMod.manifest;

            // ── Sürüm / indirme linki ────────────────────────────────────
            let tag = (typeof sel === 'object' && sel.tag) ? sel.tag : null;
            let downloadUrl = (typeof sel === 'object' && sel.downloadUrl) ? sel.downloadUrl : null;

            if (!tag || !downloadUrl) {
                const fetched = await sourceResolver.fetchReleases(addonManifest, {});
                const rel = (fetched && fetched.releases && fetched.releases.length > 0)
                    ? (tag ? sourceResolver.findRelease(fetched.releases, tag) : fetched.releases[0])
                    : null;
                if (!rel) throw new Error('Sürüm bilgisi alınamadı.');
                tag = tag || rel.tag || rel.name;
                downloadUrl = downloadUrl || rel.downloadUrl;
            }

            // ── Yerel dosya var mı, yoksa indir ──────────────────────────
            let srcDir = findExistingLocalModDir(addonManifest, tag);
            if (!srcDir) {
                // install() 'event' degil onProgress callback'i alir; addon indirme
                // ilerlemesi icin event yok -> null gecilir (downloadRelease bunu tolere eder).
                const dl = await downloadRelease(addonManifest, tag, downloadUrl, null);
                if (!dl.success) throw new Error(dl.error || 'İndirme başarısız.');
                srcDir = dl.targetDir;
            }
            if (!srcDir || !fs.existsSync(srcDir)) {
                throw new Error('Eklenti dosyaları bulunamadı.');
            }

            // ── Hedef dizin: "game_exe" = ana kurulum dizini, aksi hâlde alt klasör
            const destSpec = addon.install?.destination || 'game_exe';
            const addonDest = (destSpec === 'game_exe' || destSpec === 'parent')
                ? destDir
                : path.join(destDir, destSpec);
            if (!fs.existsSync(addonDest)) fs.mkdirSync(addonDest, { recursive: true });

            // ── Dosyaları kopyala (include glob + opsiyonel tek isme rename)
            const includes = addon.install?.files?.include || null;
            const renameTo = addon.install?.renameTo || null;

            const files = fs.readdirSync(srcDir, { withFileTypes: true })
                .filter(e => e.isFile())
                .map(e => e.name)
                .filter(n => !includes || includes.some(p => matchGlob(n, p)));

            if (files.length === 0) {
                throw new Error(`Eşleşen dosya bulunamadı (filtre: ${includes ? includes.join(', ') : 'yok'}).`);
            }

            let copied = 0;
            for (const name of files) {
                const target = path.join(addonDest, (renameTo && files.length === 1) ? renameTo : name);
                fs.copyFileSync(path.join(srcDir, name), target);
                installedPaths.push(target);
                copied++;
            }

            // ── Ana modülün config dosyasına uygulanacak değişiklikler ───
            if (addon.configChanges && typeof addon.configChanges === 'object') {
                Object.assign(configChanges, addon.configChanges);
            }

            installed.push(addon.moduleId);
            logger.step({ tr: `Eklenti kuruldu: ${addonLabel} (${tag}) — ${copied} dosya → ${path.basename(addonDest)}`, en: `Add-on installed: ${addonLabel} (${tag}) — ${copied} file(s) → ${path.basename(addonDest)}` });

        } catch (e) {
            // Eski davranış: eklenti hatası ana kurulumu bozmaz
            const msg = `${addonLabel} kurulamadı: ${e.message}`;
            warnings.push(msg);
            logger.warn(msg);
        }
    }

    return { installed, warnings, configChanges, installedPaths };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mod Klasör ve Yerel Dosya Yardımcıları
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Bir modülün mods/ altında kullanabileceği klasör adları.
 *
 * Eski (hardcoded) kurucular bazı modüller için farklı klasör adları
 * kullanıyordu (ör. fsr4 -> "fsr4files"). Bu eşleme artık kodda sabit
 * değil; manifest'teki `source.legacyFolders` alanından okunur.
 *
 * @param {string|object} moduleIdOrManifest  Modül id'si veya manifest nesnesi
 */
function getModFolderCandidates(moduleIdOrManifest) {
    const manifest = (moduleIdOrManifest && typeof moduleIdOrManifest === 'object')
        ? moduleIdOrManifest
        : null;
    const moduleId = manifest ? manifest.id : moduleIdOrManifest;
    if (!moduleId) return [];

    const candidates = [moduleId];

    // Manifest kendi eski klasör adlarını bildirir
    const legacy = manifest?.source?.legacyFolders;
    if (Array.isArray(legacy)) {
        for (const f of legacy) {
            if (f && !candidates.includes(f)) candidates.push(f);
        }
    }

    return candidates;
}

function isDirWithValidFiles(dirPath) {
    if (!dirPath || !fs.existsSync(dirPath)) return false;
    try {
        const stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) return false;
        const files = fs.readdirSync(dirPath).filter(f => !f.startsWith('download_') && !f.startsWith('extract_'));
        return files.length > 0;
    } catch (e) {
        return false;
    }
}

/**
 * `github_files` kaynagi icin indirilecek depo ici yollarin listesi.
 * Sabit dosyalar (`source.files`) + secilen enjeksiyon DLL'inin yolu.
 * Her proxy adi ayri bir binary oldugu icin (ornegin `alternatives/dxgi.dll`),
 * indirilecek dosya kullanicinin enjeksiyon secimine baglidir.
 */
function getRequiredRepoPaths(manifest, proxySourcePath) {
    const list = [];
    const files = manifest.source?.files;
    if (Array.isArray(files)) {
        for (const f of files) {
            if (typeof f === 'string' && f && !list.includes(f)) list.push(f);
        }
    }
    if (proxySourcePath && !list.includes(proxySourcePath)) list.push(proxySourcePath);
    return list;
}

/** Depo yollarinin duz (flat) karsiliklari klasorde var mi? */
function repoPathsPresentIn(dir, repoPaths) {
    if (!dir || repoPaths.length === 0) return true;
    return repoPaths.every(p => {
        try {
            return fs.existsSync(path.join(dir, path.basename(String(p).replace(/\\/g, '/'))));
        } catch (e) {
            return false;
        }
    });
}

function findExistingLocalModDir(manifest, releaseTarget, release = null) {
    if (!manifest || !manifest.id) return null;
    const folderCandidates = getModFolderCandidates(manifest);
    
    // Kontrol edilecek sürüm isim varyantları (v ön ekli / ön eksiz)
    const versionCandidates = new Set();
    
    if (releaseTarget && releaseTarget !== 'latest') {
        const clean = String(releaseTarget).trim();
        versionCandidates.add(clean);
        versionCandidates.add(clean.replace(/^v/i, ''));
        versionCandidates.add(`v${clean.replace(/^v/i, '')}`);
    }
    
    if (release) {
        if (release.tag) {
            const cleanTag = String(release.tag).trim();
            versionCandidates.add(cleanTag);
            versionCandidates.add(cleanTag.replace(/^v/i, ''));
            versionCandidates.add(`v${cleanTag.replace(/^v/i, '')}`);
        }
        if (release.name) {
            const cleanName = String(release.name).trim();
            versionCandidates.add(cleanName);
            versionCandidates.add(cleanName.replace(/^v/i, ''));
            versionCandidates.add(`v${cleanName.replace(/^v/i, '')}`);
        }
    }
    
    const basePaths = [config.modsPath];
    if (config.streamlineModsPath && !basePaths.includes(config.streamlineModsPath)) {
        basePaths.push(config.streamlineModsPath);
    }

    for (const basePath of basePaths) {
        if (!fs.existsSync(basePath)) continue;

        for (const folder of folderCandidates) {
            for (const ver of versionCandidates) {
                const checkDir = path.join(basePath, folder, ver);
                if (isDirWithValidFiles(checkDir)) {
                    return checkDir;
                }
            }

            // Doğrudan basePath altında sürüm klasörü kontrolü (örn. streamlineModsPath/v2.10.0)
            for (const ver of versionCandidates) {
                const checkDir = path.join(basePath, ver);
                if (isDirWithValidFiles(checkDir)) {
                    return checkDir;
                }
            }

            // Eğer releaseTarget 'latest' ise ve henüz spesifik versiyon bilinmiyorsa, mevcut en yeni klasörü bul
            if (versionCandidates.size === 0) {
                const parentDir = path.join(basePath, folder);
                if (fs.existsSync(parentDir)) {
                    try {
                        const subs = fs.readdirSync(parentDir, { withFileTypes: true })
                            .filter(d => d.isDirectory() && !d.name.startsWith('extract_') && !d.name.startsWith('download_'))
                            .map(d => d.name);
                        subs.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
                        for (const sub of subs) {
                            const checkDir = path.join(parentDir, sub);
                            if (isDirWithValidFiles(checkDir)) {
                                return checkDir;
                            }
                        }
                    } catch (e) {}
                }
            }
        }
    }

    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// install — Ana kurulum pipeline'ı
// ─────────────────────────────────────────────────────────────────────────────
async function install(manifest, gameName, exePath, tag, options, onProgress = () => { }) {
    const logger = createLogger(manifest.id, { scope: 'install', gameName });
    
    let destDir = null;
    let extractedDir = null;
    let backupCreated = null;
    const recordedHashes = {};
    const rollbackState = {
        installedPaths: [],
        renamedBaks: [],
        inPlaceBackups: []
    };
    const partialFailures = [];

    try {
        console.log(`${TAG} Kurulum başlatılıyor: ${manifest.id} (tag: ${tag})`);
        logger.info({
            tr: `Kurulum başlatıldı: ${manifest.name || manifest.id} (sürüm: ${tag || 'otomatik'}) — oyun: ${gameName}`,
            en: `Installation started: ${manifest.name || manifest.id} (version: ${tag || 'auto'}) — game: ${gameName}`
        });

        // ── 1. Validate Manifest ──────────────────────────────────────────
        onProgress({ step: 1, message: 'Manifest doğrulanıyor...', percent: 5 });
        const validation = manifestValidator.validate(manifest);
        if (!validation.valid) {
            throw new Error(`Manifest doğrulama hatası: ${validation.errors.join('; ')}`);
        }
        logger.step({ tr: 'Manifest doğrulandı', en: 'Manifest validated' });

        // ── 2. Check Conditions ───────────────────────────────────────────
        onProgress({ step: 2, message: 'Koşullar kontrol ediliyor...', percent: 10 });

        // Oyunun kayıtlı durumu — 'mod_installed' koşulu bunu bekliyor.
        // (Eskiden context'e hiç geçirilmiyordu, bu yüzden koşul sessizce geçiyordu.)
        const gameState = config.getExistingGamesState().find(g =>
            config.normalizeGameKey(g.name) === config.normalizeGameKey(gameName)
        ) || null;

        if (manifest.conditions && manifest.conditions.length > 0) {
            const preContext = { gameName, exePath, gameState };
            const conditionResult = await conditionChecker.checkConditions(manifest.conditions, preContext);
            if (!conditionResult.passed) {
                const reasons = conditionResult.failures.map(f => f.message).join('; ');
                throw new Error(`Koşullar sağlanamadı: ${reasons}`);
            }
            logger.step({
                tr: `Koşullar kontrol edildi (${manifest.conditions.length} kural, tümü sağlandı)`,
                en: `Conditions checked (${manifest.conditions.length} rule(s), all satisfied)`
            });
        } else {
            logger.skip({
                tr: 'Koşul kontrolü atlandı — manifest\'te conditions tanımlı değil',
                en: 'Condition check skipped — no conditions declared in the manifest'
            });
        }

        // ── 3. Check Game Running ─────────────────────────────────────────
        onProgress({ step: 3, message: 'Oyun durumu kontrol ediliyor...', percent: 15 });
        if (exePath && await utils.isGameRunning(exePath)) {
            throw new Error('Oyun çalışırken kurulum yapılamaz. Lütfen oyunu kapatın.');
        }
        logger.step({ tr: 'Oyun çalışmıyor (kuruluma uygun)', en: 'Game is not running (safe to install)' });

        // ── 4. Resolve Game Paths ─────────────────────────────────────────
        onProgress({ step: 4, message: 'Oyun dizini çözümleniyor...', percent: 20 });
        const gamePaths = config.getGamePaths(gameName, exePath);
        if (!gamePaths) {
            throw new Error('Oyun dizini bulunamadı. Lütfen oyun yolunu kontrol edin.');
        }
        const exeDir = gamePaths.exe_path ? path.dirname(gamePaths.exe_path) : null;
        const gameRoot = config.resolveActualGameRoot(gameName, exePath) || gamePaths.game_root || exeDir;
        logger.info({ tr: `Oyun dizini: ${gameRoot}`, en: `Game directory: ${gameRoot}` });

        // ── 5. Resolve Destination ────────────────────────────────────────
        onProgress({ step: 5, message: 'Hedef klasör belirleniyor...', percent: 25 });
        destDir = resolveDestinationDir(manifest, gameName, exePath);
        if (!destDir) {
            destDir = gameRoot;
        }

        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }
        logger.info({ tr: `Hedef klasör: ${destDir}`, en: `Target folder: ${destDir}` });

        // ── 5b. Re-check path-dependent conditions ────────────────────────
        if (manifest.conditions && manifest.conditions.length > 0) {
            const pathConditions = manifest.conditions.filter(c =>
                c.type === 'file_exists' || c.type === 'file_not_exists' || c.type === 'check_conflicts'
            );
            if (pathConditions.length > 0) {
                const fullContext = { gameName, exePath, gameDir: destDir, gameState };
                const pathCheck = await conditionChecker.checkConditions(pathConditions, fullContext);
                if (!pathCheck.passed) {
                    const reasons = pathCheck.failures.map(f => f.message).join('; ');
                    throw new Error(`Koşullar sağlanamadı: ${reasons}`);
                }
            }
        }

        // ── 5c. Ön koşullar (requires) ────────────────────────────────────
        // Bazı modüller tek başına çalışmaz (ör. MFG Unlock bir ReShade addon'u).
        // Kurulum modalı bunu zaten önceden gösteriyor; bu kapı UI atlandığında
        // (sihirbaz, doğrudan IPC) devreye girer. İndirme başlamadan önce durur.
        if (Array.isArray(manifest.requires) && manifest.requires.length > 0) {
            onProgress({ step: 5, message: 'Ön koşullar kontrol ediliyor...', percent: 27 });
            const reqResult = await requirementChecker.checkRequirements(manifest, {
                gameName, exePath, gameDir: destDir
            });
            if (!reqResult.satisfied) {
                const reasons = reqResult.failures.map(f => f.message).join('; ');
                const err = new Error(`Ön koşullar sağlanamadı: ${reasons}`);
                err.failures = reqResult.failures;
                throw err;
            }
            logger.step({
                tr: `Ön koşullar sağlandı (${manifest.requires.length} bağımlılık)`,
                en: `Prerequisites satisfied (${manifest.requires.length} dependency/dependencies)`
            });
        } else {
            logger.skip({
                tr: 'Ön koşul kontrolü atlandı — manifest\'te requires tanımlı değil',
                en: 'Prerequisite check skipped — no requires declared in the manifest'
            });
        }

        // ── 5d. Bildirilmiş çakışmalar (conflicts) ────────────────────────
        // Manifest "benimle X aynı anda duramaz" diyorsa indirme başlamadan dur.
        // Alan yoksa hiçbir şey çalışmaz — geriye dönük tamamen uyumlu.
        {
            const declared = await conflictChecker.checkDeclaredConflicts(manifest, {
                gameName, exePath, gameDir: destDir
            });
            if (!declared.clear) {
                const reasons = declared.failures.map(f => f.message).join('; ');
                const err = new Error(reasons);
                err.failures = declared.failures;
                throw err;
            }
        }

        // ── 5e. Enjeksiyon (proxy) DLL hedefi ────────────────────────
        // Eskiden 12a adimiydi (kopyalamadan hemen once). `github_files`
        // kaynaginda INDIRILECEK dosya secilen hedefe gore degistigi icin
        // (her proxy adi ayri bir binary) karar indirmeden ONCE verilmeli.
        // Girdileri yalnizca manifest + options + destDir; hepsi burada hazir.
        let effectiveProxyTarget = null;
        let proxySourceFile = null;
        let proxySourcePath = null;
        if (manifest.install?.proxyDetection) {
            const pd = manifest.install.proxyDetection;
            let existingFound = null;

            // Diskteki mevcut proxy'yi tanimak FileDescription'a dayanir.
            // Surum kaynagi tasimayan DLL'lerde (ornegin dlssg_for_sm86)
            // manifest `descriptionMatch` yazmaz; tarama tamamen atlanir.
            if (pd.descriptionMatch) {
                for (const candName of pd.candidates) {
                    const candPath = path.join(destDir, candName);
                    if (fs.existsSync(candPath)) {
                        try {
                            const desc = await utils.getFileDescription(candPath);
                            if (desc && desc.toLowerCase().includes(pd.descriptionMatch.toLowerCase())) {
                                existingFound = candName;
                                break;
                            }
                        } catch (e) { /* ignore */ }
                    }
                }
            } else if (manifest.state?.injectionField) {
                // descriptionMatch yoksa "mevcut kurulum" bilgisi games.json'daki
                // kayitli enjeksiyon adindan gelir (state.injectionField).
                const recorded = gameState && gameState[manifest.state.injectionField];
                if (recorded && pd.candidates.some(c => c.toLowerCase() === String(recorded).toLowerCase())) {
                    if (fs.existsSync(path.join(destDir, recorded))) existingFound = recorded;
                }
            }

            // Oncelik: kullanicinin modaldaki secimi > diskte tespit edilen mevcut proxy > manifest varsayilani
            const requestedTarget = options?.proxyTarget || options?.injection;
            const isRequestedValid = requestedTarget && pd.candidates.some(
                c => c.toLowerCase() === String(requestedTarget).toLowerCase()
            );

            if (isRequestedValid) {
                effectiveProxyTarget = pd.candidates.find(
                    c => c.toLowerCase() === String(requestedTarget).toLowerCase()
                );
                logger.step({ tr: `Proxy DLL hedeflendi: ${effectiveProxyTarget} (kullanıcı seçimi)`, en: `Proxy DLL target set: ${effectiveProxyTarget} (user choice)` });
            } else {
                effectiveProxyTarget = existingFound || pd.defaultTarget;
                logger.step({ tr: `Proxy DLL hedeflendi: ${effectiveProxyTarget}${existingFound ? ' (mevcut tespit edildi)' : ' (varsayılan)'}`, en: `Proxy DLL target set: ${effectiveProxyTarget}${existingFound ? ' (existing detected)' : ' (default)'}` });
            }

            // Kaynak dosya: klasik modda TEK dosya hedef ada kopyalanir
            // (`sourceFile` -> `effectiveProxyTarget`). `sourceByTarget` varsa
            // her hedefin kendi binary'si vardir, yeniden adlandirma yoktur.
            if (pd.sourceByTarget && pd.sourceByTarget[effectiveProxyTarget]) {
                proxySourcePath = pd.sourceByTarget[effectiveProxyTarget];
                proxySourceFile = path.basename(String(proxySourcePath).replace(/\\/g, '/'));
                logger.info({ tr: `Enjeksiyon kaynağı: ${proxySourcePath}`, en: `Injection source: ${proxySourcePath}` });
            } else {
                proxySourceFile = pd.sourceFile;
            }
        }

        // ── 5f. Enjeksiyon hedefi cakisma on-kontrolu ─────────────────
        // Hedef ad burada belli; cakisiyorsa 30 MB'lik indirmeyi hic baslatma.
        // Ayni kontrol 12e adiminda da var (apiTargeting hedefi orada cozuluyor).
        if (effectiveProxyTarget && manifest.install?.apiTargeting?.backupExisting !== true) {
            const foreignEarly = await conflictChecker.findForeignTargetConflict(
                manifest, destDir, [effectiveProxyTarget]
            );
            if (foreignEarly) {
                const message = conflictChecker.injectionConflictMessage(foreignEarly);
                const err = new Error(message);
                err.failures = [{ type: 'injection_conflict', fileName: foreignEarly, message }];
                logger.warn({ tr: `Enjeksiyon çakışması: ${foreignEarly} oyuna ait, indirme başlatılmadı.`, en: `Injection conflict: ${foreignEarly} belongs to the game; download was not started.` });
                throw err;
            }
        }

        // ── 6. Sürüm ve Yerel Dosya Kontrolü ──────────────────────────────
        onProgress({ step: 6, message: 'Sürüm bilgisi kontrol ediliyor...', percent: 30 });
        const releaseTarget = tag || manifest.source?.release || 'latest';
        
        let release = null;

        // `github_files` kaynaginda onbellekteki surum klasoru YETMEZ: kullanici
        // farkli bir enjeksiyon tipi sectiyse o DLL hic indirilmemis olabilir.
        const isFileSource = (manifest.source?.type === 'github_files');
        const requiredRepoPaths = isFileSource ? getRequiredRepoPaths(manifest, proxySourcePath) : [];
        const localDirUsable = (dir) => {
            if (!dir || !isFileSource) return Boolean(dir);
            if (repoPathsPresentIn(dir, requiredRepoPaths)) return true;
            console.log(`${TAG} Yerel klasorde eksik dosya var, indirme yapilacak: ${dir}`);
            return false;
        };

        let localModDir = findExistingLocalModDir(manifest, releaseTarget);
        if (!localDirUsable(localModDir)) localModDir = null;

        // Eğer yerel dosya bulunamadıysa veya zorunlu indirme istendiyse GitHub'dan sürüm bilgilerini al
        if (!localModDir || options?.forceRefresh) {
            try {
                const fetchResult = await sourceResolver.fetchReleases(manifest, {
                    forceRefresh: options?.forceRefresh
                });

                if (fetchResult && fetchResult.releases && fetchResult.releases.length > 0) {
                    release = sourceResolver.findRelease(fetchResult.releases, releaseTarget);
                }
            } catch (fetchErr) {
                console.warn(`${TAG} Release fetch uyarısı:`, fetchErr.message);
            }

            // Release bulunduktan sonra release.tag / release.name ile yerel kontrolü tekrar dene
            if (!localModDir && release) {
                localModDir = findExistingLocalModDir(manifest, releaseTarget, release);
                if (!localDirUsable(localModDir)) localModDir = null;
            }
        }

        const effectiveVersion = release?.tag || (releaseTarget !== 'latest' ? releaseTarget : (localModDir ? path.basename(localModDir) : 'latest'));
        logger.info({ tr: `Hedef sürüm: ${effectiveVersion}${localModDir ? ' (yerel mevcut)' : ''}`, en: `Target version: ${effectiveVersion}${localModDir ? ' (already available locally)' : ''}` });

        let sourceDir = null;

        if (localModDir && !options?.forceRefresh) {
            // ── 9. Zaten İndirilmiş Yerel Dosyaları Kullan ─────────────────────
            onProgress({ step: 9, message: 'Mevcut dosyalar kullanılıyor (indirme atlandı)...', percent: 60 });
            logger.skip({ tr: `İndirme atlandı — dosyalar zaten mevcut: ${localModDir}`, en: `Download skipped — files already present: ${localModDir}` });
            sourceDir = localModDir;
        } else {
            // ── 7-10. İndirme ve Kalıcı Önbelleğe Çıkarma ─────────────────────
            if (!release) {
                const fetchResult = await sourceResolver.fetchReleases(manifest, {
                    forceRefresh: options?.forceRefresh
                });

                if (fetchResult.error) {
                    throw new Error(`GitHub API hatası: ${fetchResult.error}`);
                }
                release = sourceResolver.findRelease(fetchResult.releases, releaseTarget);
                if (!release) {
                    throw new Error(
                        `GitHub üzerinde istenen release bulunamadı.\n` +
                        `Kaynak: ${manifest.source.repo || manifest.source.url}\n` +
                        `Aranan sürüm: ${releaseTarget}`
                    );
                }
            }

            // ── 7b. `github_files`: release asset'i yok, dosyalar tek tek cekilir ─
            // Bazi depolar release'e hic dosya eklemez ("Source code (zip)" disinda
            // asset yoktur). Tum kaynak arsivini indirmek yerine (bu depoda ~133 MB)
            // yalnizca gereken dosyalar raw.githubusercontent.com'dan indirilir.
            const folderCandidates = getModFolderCandidates(manifest);
            const primaryFolder = folderCandidates[0] || manifest.id;
            const versionDirName = release.tag || release.name || releaseTarget;
            const targetModDir = path.join(config.modsPath, primaryFolder, versionDirName);
            if (!fs.existsSync(targetModDir)) fs.mkdirSync(targetModDir, { recursive: true });

            if (isFileSource) {
                if (requiredRepoPaths.length === 0) {
                    throw new Error("'source.files' bos ve enjeksiyon dosyasi cozulemedi; indirilecek dosya yok.");
                }

                onProgress({ step: 9, message: 'Dosyalar indiriliyor...', percent: 50 });
                logger.info({ tr: `İndirilecek dosyalar: ${requiredRepoPaths.join(', ')}`, en: `Files to download: ${requiredRepoPaths.join(', ')}` });

                await sourceResolver.downloadFiles(
                    manifest.source.repo,
                    release.tag,
                    requiredRepoPaths,
                    targetModDir,
                    (info) => onProgress({
                        step: 9,
                        message: `Indiriliyor: ${info.fileName} (%${info.percent})`,
                        percent: 50 + Math.round(info.percent * 0.15)
                    })
                );
                logger.step({ tr: `${requiredRepoPaths.length} dosya indirildi → ${targetModDir}`, en: `${requiredRepoPaths.length} file(s) downloaded → ${targetModDir}` });

                sourceDir = targetModDir;
            } else {

            // ── 8. Asset URL ────────────────────────────────────
            onProgress({ step: 8, message: 'Asset kontrol ediliyor...', percent: 45 });
            const assetUrl = release.downloadUrl;
            const assetName = release.assetName || `${manifest.id}_${release.tag}`;
            if (!assetUrl) {
                throw new Error('Release icinde uygun asset bulunamadi.');
            }
            logger.info({ tr: `İndirilen paket: ${assetName}`, en: `Downloaded asset: ${assetName}` });

            // ── 9. Download & Persistent Cache ────────────────────────
            onProgress({ step: 9, message: 'Indiriliyor...', percent: 50 });

            const ext = path.extname(assetName) || (assetUrl.toLowerCase().endsWith('.7z') ? '.7z' : '.zip');
            const tempDir = app.getPath('temp');
            const tempFileName = `download_${manifest.id}_${Date.now()}${ext}`;
            const downloadedPath = path.join(tempDir, tempFileName);

            await githubFetcher.downloadAsset(assetUrl, path.dirname(downloadedPath), path.basename(downloadedPath), (percent, downloaded, total) => {
                onProgress({ step: 9, message: `Indiriliyor... %${percent}`, percent: 50 + Math.round(percent * 0.1) });
            });
            logger.step({ tr: 'İndirme tamamlandı', en: 'Download completed' });

            // ── 10. Extract Archive ──────────────────────────────
            onProgress({ step: 10, message: 'Arsiv cikariliyor...', percent: 65 });
            // Desteklenen tum arsiv bicimleri archive.js'ten sorulur
            // (.zip, .7z, .rar ve SFX kurulum .exe'leri)
            const urlExt = path.extname(assetUrl.toLowerCase().split('?')[0]);
            const canExtract = archive.supportsFormat(ext) || archive.supportsFormat(urlExt);
            
            const partialModDir = targetModDir + '.partial';
            if (fs.existsSync(partialModDir)) {
                try { fs.rmSync(partialModDir, { recursive: true, force: true }); } catch (e) {}
            }
            fs.mkdirSync(partialModDir, { recursive: true });

            try {
                if (canExtract) {
                    await archive.extractArchive(downloadedPath, partialModDir);
                } else {
                    const baseFileName = path.basename(assetUrl).split('?')[0] || assetName;
                    fs.copyFileSync(downloadedPath, path.join(partialModDir, baseFileName));
                }

                if (fs.existsSync(targetModDir)) {
                    try { fs.rmSync(targetModDir, { recursive: true, force: true }); } catch (e) {}
                }
                fs.renameSync(partialModDir, targetModDir);
            } catch (extErr) {
                try { fs.rmSync(partialModDir, { recursive: true, force: true }); } catch (e) {}
                throw extErr;
            }
            
            logger.step({ tr: `Arşiv kalıcı mod dizinine çıkarıldı: ${targetModDir}`, en: `Archive extracted into the persistent mod directory: ${targetModDir}` });

            try { if (fs.existsSync(downloadedPath)) fs.unlinkSync(downloadedPath); } catch (e) { /* ignore */ }

            sourceDir = targetModDir;
            }
        }

        // ── 11. Handle Extract Root ───────────────────────────────────────
        onProgress({ step: 11, message: 'Arşiv yapısı inceleniyor...', percent: 70 });
        let effectiveSourceDir = sourceDir;
        const extractRoot = manifest.install?.extractRoot || 'auto';
        if (extractRoot === 'auto') {
            const contents = fs.readdirSync(effectiveSourceDir);
            if (contents.length === 1) {
                const potentialRoot = path.join(effectiveSourceDir, contents[0]);
                try {
                    if (fs.statSync(potentialRoot).isDirectory()) {
                        console.log(`${TAG} Tek klasör tespit edildi, root olarak kullanılıyor: ${contents[0]}`);
                        effectiveSourceDir = potentialRoot;
                    }
                } catch (e) { /* ignore */ }
            }
        } else if (typeof extractRoot === 'string' && extractRoot !== 'none') {
            const targetSub = extractRoot.replace(/\\/g, '/').toLowerCase();
            const findSubDir = (dir) => {
                const list = fs.readdirSync(dir, { withFileTypes: true });
                for (const item of list) {
                    if (item.isDirectory()) {
                        const full = path.join(dir, item.name);
                        const rel = path.relative(sourceDir, full).replace(/\\/g, '/').toLowerCase();
                        if (rel === targetSub || rel.endsWith('/' + targetSub)) {
                            return full;
                        }
                        const rec = findSubDir(full);
                        if (rec) return rec;
                    }
                }
                return null;
            };
            const foundSub = findSubDir(effectiveSourceDir);
            if (foundSub) {
                effectiveSourceDir = foundSub;
                logger.info({ tr: `Arşiv kök klasörü bulundu: ${extractRoot}`, en: `Archive root folder resolved: ${extractRoot}` });
            }
        }
        sourceDir = effectiveSourceDir;
        logger.info({ tr: `Kaynak dizin: ${path.basename(sourceDir)}`, en: `Source directory: ${path.basename(sourceDir)}` });

        // ── 12. Backup Pipeline ───────────────────────────────────────────
        onProgress({ step: 12, message: 'Yedek oluşturuluyor...', percent: 75 });
        const isSuffixBackup = manifest.backup?.strategy === 'in_place_suffix' || manifest.backup?.strategy === 'suffix';
        const backupSuffix = manifest.backup?.suffix || '.backup';

        if (manifest.backup?.enabled && isSuffixBackup) {
            const filesToInstall = manifest.install.whitelistFiles || (fs.existsSync(sourceDir) ? fs.readdirSync(sourceDir) : []);
            for (const file of filesToInstall) {
                const activePath = path.join(destDir, file);
                const backupPath = activePath + backupSuffix;
                if (fs.existsSync(activePath) && !fs.existsSync(backupPath)) {
                    try {
                        const hash = await utils.getFileHash(activePath);
                        if (hash) recordedHashes[file] = hash;
                        const destFileDir = path.dirname(backupPath);
                        if (!fs.existsSync(destFileDir)) fs.mkdirSync(destFileDir, { recursive: true });
                        fs.copyFileSync(activePath, backupPath);
                        rollbackState.inPlaceBackups.push({ backupPath, activePath });
                        logger.step({ tr: `Yerinde yedek oluşturuldu: ${file} -> ${file}${backupSuffix}`, en: `In-place backup created: ${file} -> ${file}${backupSuffix}` });
                    } catch (e) {
                        logger.warn({ tr: `Yerinde yedek oluşturulamadı (${file}): ${e.message}`, en: `In-place backup could not be created (${file}): ${e.message}` });
                    }
                }
            }
        } else if (manifest.backup?.enabled && manifest.backup.files) {
            const backupRes = await backup.createBackup(
                gameName, manifest.id, manifest.backup.files, destDir, manifest.version
            );
            if (backupRes.success) {
                backupCreated = path.basename(backupRes.backupPath);
                logger.step({ tr: `Yedek oluşturuldu (${backupRes.backedUpFiles} dosya)`, en: `Backup created (${backupRes.backedUpFiles} file(s))` });
            } else {
                logger.warn({ tr: 'Yedek oluşturulamadı, kurulum devam ediyor', en: 'Backup could not be created; installation continues' });
            }
        } else {
            logger.skip({ tr: 'Yedekleme atlandı — manifest\'te backup tanımlı değil', en: 'Backup skipped — no backup declared in the manifest' });
        }

        // ── 12b [GENİŞLETME]: cleanStaleVersionFiles (FIX 2e) ─────────────
        if (manifest.install?.cleanStaleVersionFiles && manifest.state?.versionField) {
            const games = config.getExistingGamesState();
            const dbGame = games.find(g => config.normalizeGameKey(g.name) === config.normalizeGameKey(gameName));
            const oldVersion = dbGame ? dbGame[manifest.state.versionField] : null;

            if (oldVersion && oldVersion !== effectiveVersion) {
                const oldSourceDir = findExistingLocalModDir(manifest, oldVersion) || path.join(config.modsPath, manifest.id, oldVersion);
                if (fs.existsSync(oldSourceDir)) {
                    try {
                        const oldFiles = fs.readdirSync(oldSourceDir);
                        const newFiles = new Set(fs.readdirSync(sourceDir).map(f => f.toLowerCase()));
                        let cleanedCount = 0;

                        for (const oldFile of oldFiles) {
                            if (proxySourceFile && oldFile.toLowerCase() === proxySourceFile.toLowerCase()) continue;
                            if (!newFiles.has(oldFile.toLowerCase())) {
                                const staleFile = path.join(destDir, oldFile);
                                if (fs.existsSync(staleFile)) {
                                    fs.unlinkSync(staleFile);
                                    cleanedCount++;
                                }
                            }
                        }
                        if (cleanedCount > 0) {
                            logger.step({ tr: `Eski sürümden kalan ${cleanedCount} artık dosya temizlendi`, en: `${cleanedCount} leftover file(s) from the previous version removed` });
                        }
                    } catch (e) {
                        logger.warn({ tr: `Artık dosya temizleme hatası: ${e.message}`, en: `Leftover cleanup failed: ${e.message}` });
                    }
                }
            }
        }

        // ── 12d. apiTargeting — oyunun API'sine gore kaynak dosya ve hedef ad ──
        // ReShade gibi modlar 32/64 bit icin farkli dosya, API icin farkli isim ister.
        // Tespit exeApiDetector'dan gelir; kullanici secimi (options.targetApi) onceliklidir.
        let apiTarget = null;
        if (manifest.install?.apiTargeting) {
            const at = manifest.install.apiTargeting;
            const detection = await exeApiDetector.detectApi(exePath);

            if (!detection.success) {
                throw new Error(`Oyun exe'si analiz edilemedi: ${detection.error}`);
            }

            const arch = detection.is64Bit ? 'x64' : 'x86';
            const sourceFile = at.sourceByArch ? at.sourceByArch[arch] : null;
            if (!sourceFile) {
                throw new Error(`Bu mimari icin kaynak dosya tanimli degil: ${arch}`);
            }

            // API secimi: kullanici > manifest varsayilani > otomatik tespit
            let chosenApi = options?.targetApi
                || (at.defaultApi && at.defaultApi !== 'auto' ? at.defaultApi : null)
                || detection.recommendedApi;

            if (!chosenApi) {
                throw new Error('Oyunun grafik API\'si tespit edilemedi. Lutfen kurulum ekranindan elle secin.');
            }

            const targetName = (at.renameByApi && at.renameByApi[chosenApi])
                || exeApiDetector.getProxyDllForApi(chosenApi);

            if (!targetName) {
                throw new Error(`'${chosenApi}' API'si icin hedef dosya adi belirlenemedi.`);
            }

            apiTarget = { sourceFile, targetName, api: chosenApi, arch, detection };
            logger.step({ tr: `API hedefleme: ${arch} / ${chosenApi} → ${sourceFile}, kopyalanacak ad: ${targetName}`, en: `API targeting: ${arch} / ${chosenApi} → ${sourceFile}, will be copied as: ${targetName}` });
            if (detection.notes && detection.notes.length > 0) {
                logger.info({ tr: `Tespit ipuçları: ${detection.notes.join(', ')}`, en: `Detection hints: ${detection.notes.join(', ')}` });
            }
        }

        // ── 12e. Dahili çakışma: hedef dosya başka bir modüle mi ait? ─────
        // Hedefte aynı adlı bir DLL varsa ve bu DLL başka bir V-Manager moduna
        // aitse .bak ALINMAZ — yedeklenip üzerine yazılırsa diğer modun kurulumu
        // sessizce bozulur ve kaldırılınca geri gelmez. Kurulum burada durur.
        {
            const contestedNames = [];
            if (effectiveProxyTarget) contestedNames.push(effectiveProxyTarget);
            if (apiTarget && apiTarget.targetName) contestedNames.push(apiTarget.targetName);

            const owner = await conflictChecker.findFileOwnerConflict(manifest, destDir, contestedNames);
            if (owner) {
                const message = conflictChecker.conflictMessage(owner.moduleName);
                const err = new Error(message);
                err.failures = [{ type: 'conflicts', moduleId: owner.moduleId, message }];
                logger.warn({ tr: `Çakışma: ${owner.fileName} dosyası ${owner.moduleName} moduna ait.`, en: `Conflict: ${owner.fileName} belongs to the ${owner.moduleName} mod.` });
                throw err;
            }

            // Sahibi HİÇBİR modül olmayan dosya: oyunun kendi dosyası (ya da elle
            // kurulmuş bir mod). Üzerine yazmak/yedeklemek oyunu bozabileceği için
            // kurulum durur — kullanıcı başka bir enjeksiyon adı seçmeli.
            // `apiTargeting.backupExisting` açıkça ".bak alıp üzerine yaz" diyorsa
            // (ör. ReShade) o manifestin bildirdiği davranış korunur.
            const allowsBackupOverwrite = manifest.install?.apiTargeting?.backupExisting === true;
            if (!allowsBackupOverwrite) {
                const foreignFile = await conflictChecker.findForeignTargetConflict(manifest, destDir, contestedNames);
                if (foreignFile) {
                    const message = conflictChecker.injectionConflictMessage(foreignFile);
                    const err = new Error(message);
                    err.failures = [{ type: 'injection_conflict', fileName: foreignFile, message }];
                    logger.warn({ tr: `Enjeksiyon çakışması: ${foreignFile} oyuna ait, üzerine yazılmadı.`, en: `Injection conflict: ${foreignFile} belongs to the game; it was not overwritten.` });
                    throw err;
                }
            }
        }

        // ── 13. Install Files ─────────────────────────────────────────────
        onProgress({ step: 13, message: 'Dosyalar kuruluyor...', percent: 80 });
        let installedFileCount = 0;
        let lastInstalledDllPath = null;

        // `github_files` onbellek klasoru zamanla BIRDEN FAZLA proxy DLL biriktirebilir
        // (kullanici enjeksiyon tipini degistirdiginde eskisi klasorde kalir).
        // Kopyalama yalnizca bu kurulumun istedigi dosyalarla sinirlanir.
        const whitelistNames = manifest.install?.whitelistFiles
            || (isFileSource ? requiredRepoPaths.map(rp => path.basename(String(rp).replace(/\\/g, '/'))) : null);
        const whitelistSet = whitelistNames ? new Set(whitelistNames.map(f => f.toLowerCase())) : null;

        // Ayrintili gunluk: hangi dosya kopyalandi, hangisi hangi manifest
        // kuralindan oturu ATLANDI. Cok dosyali arsivlerde gunlugu bogmamak
        // icin atlananlar tek tek degil, sebep basina toplu yazilir.
        const copiedRelPaths = [];
        const skippedByRule = { whitelist: [], include: [], exclude: [] };

        const installFilesRecursive = (src, dest) => {
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            const entries = fs.readdirSync(src, { withFileTypes: true });

            for (const entry of entries) {
                const srcPath = path.join(src, entry.name);
                let destPath = path.join(dest, entry.name);

                const relPath = path.relative(sourceDir, srcPath).replace(/\\/g, '/');

                if (whitelistSet && !whitelistSet.has(entry.name.toLowerCase())) {
                    if (!entry.isDirectory()) { skippedByRule.whitelist.push(relPath); continue; }
                }

                if (manifest.install.files?.include) {
                    const matches = manifest.install.files.include.some(p => matchGlob(relPath, p) || matchGlob(entry.name, p));
                    if (!matches && !entry.isDirectory()) { skippedByRule.include.push(relPath); continue; }
                }

                if (manifest.install.files?.exclude) {
                    const excluded = manifest.install.files.exclude.some(p => matchGlob(relPath, p) || matchGlob(entry.name, p));
                    if (excluded) { skippedByRule.exclude.push(relPath); continue; }
                }

                if (entry.isDirectory()) {
                    installFilesRecursive(srcPath, destPath);
                } else {
                    // proxyDetection özel kopyalaması
                    if (proxySourceFile && entry.name.toLowerCase() === proxySourceFile.toLowerCase()) {
                        destPath = path.join(destDir, effectiveProxyTarget);
                        lastInstalledDllPath = destPath;
                    } else if (manifest.install.rename) {
                        for (const r of manifest.install.rename) {
                            if (matchGlob(relPath, r.from) || matchGlob(entry.name, r.from)) {
                                destPath = path.join(destDir, r.to);
                                const fDir = path.dirname(destPath);
                                if (!fs.existsSync(fDir)) fs.mkdirSync(fDir, { recursive: true });
                                break;
                            }
                        }
                    }

                    fs.copyFileSync(srcPath, destPath);
                    rollbackState.installedPaths.push(destPath);
                    installedFileCount++;
                    copiedRelPaths.push(`${relPath} → ${path.relative(destDir, destPath).replace(/\\/g, '/') || path.basename(destPath)}`);
                }
            }
        };

        if (apiTarget) {
                // Yalnizca secilen mimarinin dosyasi, API'ye uygun adla kopyalanir
                const srcMatches = findFileInDir(sourceDir, apiTarget.sourceFile, 3);
                const srcFile = srcMatches && srcMatches.length > 0 ? srcMatches[0] : null;
                if (!srcFile) {
                    throw new Error(`Arsivde bulunamadi: ${apiTarget.sourceFile}`);
                }
                const destFile = path.join(destDir, apiTarget.targetName);

                // Cakisma: ayni isimde bir DLL varsa uzerine yazmadan once yedekle
                if (fs.existsSync(destFile)) {
                    const backupPath = destFile + '.bak';
                    try {
                        const moduleDetector = require('./moduleDetector');
                        const owner = await moduleDetector.identifyFileOwner(destFile, {});
                        const isOwnFile = owner && owner.moduleId === manifest.id;

                        if (isOwnFile) {
                            // Bize ait eski sürüm, yedekleme yapma sadece sil
                            fs.rmSync(destFile, { force: true });
                        } else {
                            // Yabancı / oyunun dosyası
                            if (!fs.existsSync(backupPath)) {
                                fs.renameSync(destFile, backupPath);
                                rollbackState.renamedBaks.push({ original: destFile, backup: backupPath });
                                logger.warn({ tr: `Mevcut ${apiTarget.targetName} yedeklendi: ${path.basename(backupPath)}`, en: `Existing ${apiTarget.targetName} backed up: ${path.basename(backupPath)}` });
                            } else {
                                // .bak zaten var (muhtemelen oyunun orijinali), şu anki üzerine yazılacak olanı sadece sil
                                fs.rmSync(destFile, { force: true });
                            }
                        }
                    } catch (backupErr) {
                        logger.warn({ tr: `Mevcut dosya yedeklenemedi (${backupErr.message}), üzerine yazılıyor.`, en: `Existing file could not be backed up (${backupErr.message}); overwriting.` });
                    }
                }

                fs.copyFileSync(srcFile, destFile);
                rollbackState.installedPaths.push(destFile);
                installedFileCount = 1;
                lastInstalledDllPath = destFile;
                logger.step({ tr: `Kopyalandı: ${apiTarget.sourceFile} → ${apiTarget.targetName}`, en: `Copied: ${apiTarget.sourceFile} → ${apiTarget.targetName}` });
            } else {
                installFilesRecursive(sourceDir, destDir);

                // Ne kopyalandi — dosya dosya
                const MAX_LISTED = 40;
                for (const line of copiedRelPaths.slice(0, MAX_LISTED)) {
                    logger.step({ tr: `Kopyalandı: ${line}`, en: `Copied: ${line}` });
                }
                if (copiedRelPaths.length > MAX_LISTED) {
                    const rest = copiedRelPaths.length - MAX_LISTED;
                    logger.info({
                        tr: `... ve ${rest} dosya daha kopyalandı (tam liste günlük dosyasında)`,
                        en: `... and ${rest} more file(s) copied (full list in the log file)`
                    });
                }

                // Ne kopyalanmadi — manifest kuralina gore
                if (skippedByRule.whitelist.length > 0) {
                    logger.skip({
                        tr: `${skippedByRule.whitelist.length} dosya atlandı — manifest whitelistFiles listesinde yok: ${skippedByRule.whitelist.join(', ')}`,
                        en: `${skippedByRule.whitelist.length} file(s) skipped — not in the manifest whitelistFiles: ${skippedByRule.whitelist.join(', ')}`
                    });
                }
                if (skippedByRule.include.length > 0) {
                    logger.skip({
                        tr: `${skippedByRule.include.length} dosya atlandı — manifest install.files.include kuralına uymuyor: ${skippedByRule.include.join(', ')}`,
                        en: `${skippedByRule.include.length} file(s) skipped — did not match manifest install.files.include: ${skippedByRule.include.join(', ')}`
                    });
                }
                if (skippedByRule.exclude.length > 0) {
                    logger.skip({
                        tr: `${skippedByRule.exclude.length} dosya atlandı — manifest install.files.exclude kuralı gereği: ${skippedByRule.exclude.join(', ')}`,
                        en: `${skippedByRule.exclude.length} file(s) skipped — excluded by manifest install.files.exclude: ${skippedByRule.exclude.join(', ')}`
                    });
                }
            }
            logger.step({ tr: `Toplam ${installedFileCount} dosya kopyalandı`, en: `${installedFileCount} file(s) copied in total` });

            // ── 13a. Enjeksiyon tipi degistiyse eski proxy DLL'i kaldir ────
            // Aksi halde oyun klasorunde iki proxy birden kalir. Yalnizca
            // hash'i onbellekteki mod dosyasiyla BIREBIR ayni olan dosya silinir;
            // oyunun kendi DLL'ine hicbir kosulda dokunulmaz.
            if (effectiveProxyTarget && manifest.state?.injectionField) {
                const previousTarget = gameState && gameState[manifest.state.injectionField];
                if (previousTarget && String(previousTarget).toLowerCase() !== effectiveProxyTarget.toLowerCase()) {
                    const previousPath = path.join(destDir, previousTarget);
                    const cachedPrevious = path.join(sourceDir, previousTarget);
                    try {
                        if (fs.existsSync(previousPath) && fs.existsSync(cachedPrevious)) {
                            const [installedHash, cachedHash] = await Promise.all([
                                utils.getFileHash(previousPath),
                                utils.getFileHash(cachedPrevious)
                            ]);
                            if (installedHash && installedHash === cachedHash) {
                                fs.unlinkSync(previousPath);
                                logger.step({ tr: `Eski enjeksiyon dosyası kaldırıldı: ${previousTarget}`, en: `Previous injection file removed: ${previousTarget}` });
                            } else {
                                logger.warn({ tr: `Eski enjeksiyon dosyası bize ait değil, dokunulmadı: ${previousTarget}`, en: `Previous injection file is not ours; left untouched: ${previousTarget}` });
                            }
                        }
                    } catch (e) {
                        logger.warn({ tr: `Eski enjeksiyon dosyası kaldırılamadı (${previousTarget}): ${e.message}`, en: `Previous injection file could not be removed (${previousTarget}): ${e.message}` });
                    }
                }
            }

        // ── 13a [GENİŞLETME]: extraSources ────────────────────────────────
        // Ana arşivden bağımsız ek indirmeler (ör. ReShade shader/texture paketi).
        // Her kaynak indirilip açılır ve oyun klasöründe belirtilen alt klasöre yerleşir.
        if (!Array.isArray(manifest.install?.extraSources) || manifest.install.extraSources.length === 0) {
            logger.skip({
                tr: 'Ek kaynak indirmesi atlandı — manifest\'te install.extraSources tanımlı değil',
                en: 'Extra source download skipped — no install.extraSources declared in the manifest'
            });
        }
        if (Array.isArray(manifest.install?.extraSources) && manifest.install.extraSources.length > 0) {
            for (const extra of manifest.install.extraSources) {
                const extraLabel = extra.id || extra.url;
                try {
                    const targetSub = extra.extractTo ? path.join(destDir, extra.extractTo) : destDir;

                    // Zaten kuruluysa tekrar indirme (ör. shader klasörü duruyorsa)
                    if (extra.skipIfExists && fs.existsSync(path.join(destDir, extra.skipIfExists))) {
                        logger.skip({ tr: `Ek kaynak atlandı — zaten mevcut: ${extraLabel}`, en: `Extra source skipped — already present: ${extraLabel}` });
                        continue;
                    }

                    onProgress({ step: 13, message: `Ek dosyalar indiriliyor (${extraLabel})...`, percent: 82 });

                    const extraTmp = path.join(app.getPath('temp'), `vm-extra-${manifest.id}-${Date.now()}`);
                    fs.mkdirSync(extraTmp, { recursive: true });

                    try {
                        const fileName = extra.fileName || (extra.url.split('/').pop() || 'extra.zip');
                        const dl = await githubFetcher.downloadAsset(extra.url, extraTmp, fileName, () => {});

                        const extractedDir = path.join(extraTmp, 'extracted');
                        fs.mkdirSync(extractedDir, { recursive: true });
                        await archive.extractArchive(dl.path, extractedDir);

                        // Tek kök klasör varsa içine gir (GitHub branch zip'leri böyle gelir)
                        let rootDir = extractedDir;
                        if (extra.stripRoot !== false) {
                            const entries = fs.readdirSync(extractedDir, { withFileTypes: true });
                            if (entries.length === 1 && entries[0].isDirectory()) {
                                rootDir = path.join(extractedDir, entries[0].name);
                            }
                        }

                        if (!fs.existsSync(targetSub)) fs.mkdirSync(targetSub, { recursive: true });

                        // include verilmişse yalnızca o üst düzey klasör/dosyalar kopyalanır
                        const wanted = Array.isArray(extra.include) && extra.include.length > 0
                            ? extra.include
                            : fs.readdirSync(rootDir);

                        let extraCopied = 0;
                        for (const item of wanted) {
                            const src = path.join(rootDir, item);
                            if (!fs.existsSync(src)) {
                                logger.warn({ tr: `Ek kaynakta bulunamadı, atlandı: ${item}`, en: `Not found in the extra source; skipped: ${item}` });
                                continue;
                            }
                            const dst = path.join(targetSub, item);
                            fs.cpSync(src, dst, { recursive: true, force: true });
                            rollbackState.installedPaths.push(dst);
                            extraCopied++;
                        }

                        logger.step({ tr: `Ek kaynak kuruldu: ${extraLabel} → ${extra.extractTo || '.'} (${extraCopied} öğe)`, en: `Extra source installed: ${extraLabel} → ${extra.extractTo || '.'} (${extraCopied} item(s))` });
                    } finally {
                        try { fs.rmSync(extraTmp, { recursive: true, force: true }); } catch (e) { /* yoksay */ }
                    }
                } catch (extraErr) {
                    // Ek kaynak hatası ana kurulumu bozmaz
                    logger.warn({ tr: `Ek kaynak kurulamadı (${extraLabel}): ${extraErr.message}`, en: `Extra source could not be installed (${extraLabel}): ${extraErr.message}` });
                    partialFailures.push({
                        step: 'extraSources',
                        label: extraLabel,
                        error: extraErr.message
                    });
                }
            }
        }

        // ── 13b [GENİŞLETME]: verifyAntiVirusDelayMs ─────────────────────
        if (manifest.install?.verifyAntiVirusDelayMs && manifest.install.verifyAntiVirusDelayMs > 0) {
            onProgress({ step: 13, message: 'Antivirüs doğrulama bekleniyor...', percent: 83 });
            const delayMs = manifest.install.verifyAntiVirusDelayMs;
            await new Promise(resolve => setTimeout(resolve, delayMs));

            if (lastInstalledDllPath && !fs.existsSync(lastInstalledDllPath)) {
                throw new Error(
                    `Erişim Engellendi veya Antivirüs Engeli: "${path.basename(lastInstalledDllPath)}" kopyalandıktan sonra silindi.\n` +
                    `Antivirüs karantinasını veya klasör izinlerini kontrol edin.`
                );
            }
            logger.step({ tr: 'Antivirüs silinme kontrolü başarılı — dosyalar yerinde', en: 'Antivirus deletion check passed — files are in place' });
        }

        // ── 13c. Eklentiler (addons) ──────────────────────────────────────
        // Config yazımından ÖNCE çalışır: eklentilerin istediği config
        // değişiklikleri (ör. LoadAsiPlugins=true) aynı yazımda uygulanır.
        let addonResult = { installed: [], warnings: [], configChanges: {}, installedPaths: [] };
        if (Array.isArray(manifest.addons) && options?.addons) {
            onProgress({ step: 13, message: 'Eklentiler kuruluyor...', percent: 84 });
            addonResult = await installAddons(manifest, options, destDir, logger);
            if (addonResult.installedPaths) {
                rollbackState.installedPaths.push(...addonResult.installedPaths);
            }
        } else if (Array.isArray(manifest.addons) && manifest.addons.length > 0) {
            logger.skip({
                tr: 'Eklenti kurulumu atlandı — kullanıcı hiçbir eklenti seçmedi',
                en: 'Add-on installation skipped — the user selected none'
            });
        } else {
            logger.skip({
                tr: 'Eklenti kurulumu atlandı — manifest\'te addons tanımlı değil',
                en: 'Add-on installation skipped — no addons declared in the manifest'
            });
        }

        // ── 14. Apply Config Changes ──────────────────────────────────────
        onProgress({ step: 14, message: 'Konfigürasyon güncelleniyor...', percent: 85 });
        if (!manifest.config || manifest.config.length === 0) {
            logger.skip({
                tr: 'Konfigürasyon yazımı atlandı — manifest\'te config tanımlı değil',
                en: 'Config write skipped — no config declared in the manifest'
            });
        }
        if (manifest.config && manifest.config.length > 0) {
            for (const entry of manifest.config) {
                const searchNames = entry.search || [entry.file];
                let configPath = configEditor.findConfigFile(destDir, searchNames);

                if (!configPath) {
                    if (entry.createIfMissing) {
                        configPath = path.join(destDir, entry.file);
                        const configDir = path.dirname(configPath);
                        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
                        if (entry.format === 'json') {
                            fs.writeFileSync(configPath, '{}', 'utf-8');
                        } else {
                            fs.writeFileSync(configPath, '', 'utf-8');
                        }
                    } else if (entry.required !== false) {
                        throw new Error(`Konfigürasyon dosyası bulunamadı: ${entry.file}`);
                    } else {
                        logger.skip({ tr: `Opsiyonel config dosyası bulunamadı, atlandı: ${entry.file}`, en: `Optional config file not found; skipped: ${entry.file}` });
                        continue;
                    }
                }

                let targetPreset = null;
                if (options?.preset !== undefined) {
                    targetPreset = options.preset || null;
                } else if (manifest.install?.applyPresetOnInstall && typeof manifest.install.applyPresetOnInstall === 'string') {
                    targetPreset = manifest.install.applyPresetOnInstall;
                } else if (manifest.applyPresetOnInstall && typeof manifest.applyPresetOnInstall === 'string') {
                    targetPreset = manifest.applyPresetOnInstall;
                }

                let changesToApply = Object.assign({}, entry.set || {});
                if (targetPreset && entry.presets && entry.presets[targetPreset]) {
                    const presetData = entry.presets[targetPreset];
                    if (presetData.values) {
                        changesToApply = Object.assign({}, changesToApply, presetData.values);
                    }
                }
                // Kurulan eklentilerin talep ettiği değişiklikler en son uygulanır
                // (ör. OptiPatcher → Plugins.LoadAsiPlugins=true)
                if (Object.keys(addonResult.configChanges).length > 0) {
                    changesToApply = Object.assign({}, changesToApply, addonResult.configChanges);
                }

                await configEditor.applyChanges(configPath, entry.format, changesToApply, {
                    createIfMissing: !!entry.createIfMissing
                });
                logger.step({ tr: `Config güncellendi: ${path.basename(configPath)}${targetPreset ? ` (Ön ayar: ${targetPreset})` : ''}`, en: `Config updated: ${path.basename(configPath)}${targetPreset ? ` (Preset: ${targetPreset})` : ''}` });
            }
        }

        // ── 15. Update Game State ─────────────────────────────────────────
        onProgress({ step: 15, message: 'Oyun durumu güncelleniyor...', percent: 90 });
        if (manifest.state) {
            const games = config.getExistingGamesState();
            const dbGame = games.find(g => config.normalizeGameKey(g.name) === config.normalizeGameKey(gameName));
            if (dbGame) {
                if (!dbGame.installedMods) dbGame.installedMods = {};
                dbGame.installedMods[manifest.id] = {
                    installed: true,
                    version: effectiveVersion,
                    installedAt: new Date().toISOString()
                };
                if (manifest.state) {
                    if (manifest.state.flag) dbGame[manifest.state.flag] = true;
                    if (manifest.state.versionField) dbGame[manifest.state.versionField] = effectiveVersion;
                    if (manifest.state.pathField) dbGame[manifest.state.pathField] = destDir;
                    if (manifest.state.hashesField) {
                        const existingHashes = dbGame[manifest.state.hashesField] || {};
                        const mergedHashes = { ...existingHashes, ...recordedHashes };
                        if (Object.keys(mergedHashes).length > 0) {
                            dbGame[manifest.state.hashesField] = mergedHashes;
                        }
                    }
                    if (manifest.state.modVersionField) dbGame[manifest.state.modVersionField] = effectiveVersion;
                    // Enjeksiyon (proxy) DLL adını kaydet — ör. optiBuilderInjection
                    if (manifest.state.injectionField && effectiveProxyTarget) {
                        dbGame[manifest.state.injectionField] = effectiveProxyTarget;
                    }
                    // upscalers.<alan> bayrağı — ör. upscalers.optiscaler
                    if (manifest.state.upscalerField) {
                        if (!dbGame.upscalers) dbGame.upscalers = {};
                        dbGame.upscalers[manifest.state.upscalerField] = true;
                    }
                }
                config.saveGamesState();
                logger.step({ tr: 'Oyun durumu (games.json) güncellendi', en: 'Game state (games.json) updated' });
            } else {
                logger.skip({ tr: 'Oyun kaydı bulunamadı — durum güncellemesi atlandı', en: 'Game record not found — state update skipped' });
            }
        }

        // ── 16. Validate Installation ─────────────────────────────────────
        onProgress({ step: 16, message: 'Kurulum doğrulanıyor...', percent: 95 });
        logger.step({ tr: 'Kurulum doğrulandı', en: 'Installation verified' });

        // ── 17. Clean Up ──────────────────────────────────────────────────
        onProgress({ step: 17, message: 'Temizlik yapılıyor...', percent: 99 });
        if (extractedDir && fs.existsSync(extractedDir)) {
            try { fs.rmSync(extractedDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        }

        if (backupCreated) {
            await backup.cleanOldBackups(gameName, manifest.id, 3);
        }

        // ── 18. Done ──────────────────────────────────────────────────────
        logger.step({ tr: 'Kurulum başarıyla tamamlandı', en: 'Installation completed successfully' });
        onProgress({ step: 18, message: 'Kurulum tamamlandı', percent: 100 });

        const installSummary = logger.summary();
        logger.info({
            tr: `Özet: ${installSummary.step || 0} işlem yapıldı, ${installSummary.skip || 0} adım atlandı, ${installSummary.warn || 0} uyarı`,
            en: `Summary: ${installSummary.step || 0} action(s) performed, ${installSummary.skip || 0} step(s) skipped, ${installSummary.warn || 0} warning(s)`
        });

        const resultObj = {
            success: true,
            message: `${manifest.name} başarıyla kuruldu.`,
            log: logger.getLog(),
            logSummary: installSummary,
            logFile: getLogFilePath(),
            installedVersion: effectiveVersion,
            installedAddons: addonResult.installed,
            addonWarnings: addonResult.warnings
        };
        if (partialFailures.length > 0) {
            resultObj.partialFailures = partialFailures;
        }
        return resultObj;

    } catch (error) {
        console.error(`${TAG} Kurulum hatası (${manifest.id}):`, error);
        logger.error(error.message);

        // Kopyalanan yeni dosyaları sil
        for (const p of rollbackState.installedPaths) {
            try { if (fs.existsSync(p)) fs.rmSync(p, { force: true, recursive: true }); } catch (e) { }
        }

        // apiTarget .bak yedeklerini geri yükle
        for (const b of rollbackState.renamedBaks) {
            try {
                if (fs.existsSync(b.backup)) {
                    if (fs.existsSync(b.original)) fs.rmSync(b.original, { force: true });
                    fs.renameSync(b.backup, b.original);
                }
            } catch (e) { }
        }

        // in_place_suffix (.backup) geri yükle
        if (rollbackState.inPlaceBackups.length > 0 && manifest.backup?.rollbackOnFailure) {
            for (const { backupPath, activePath } of rollbackState.inPlaceBackups) {
                try {
                    if (fs.existsSync(activePath)) fs.unlinkSync(activePath);
                    if (fs.existsSync(backupPath)) fs.renameSync(backupPath, activePath);
                } catch (rbErr) {}
            }
        }

        if (backupCreated && destDir) {
            console.log(`${TAG} Rollback yapılıyor (backup: ${backupCreated})...`);
            try {
                await backup.restoreBackup(gameName, manifest.id, destDir, backupCreated);
                logger.step({ tr: 'Yedek geri yüklendi (geri alma)', en: 'Backup restored (rollback)' });
            } catch (rollbackErr) {
                logger.error({ tr: `Geri alma hatası: ${rollbackErr.message}`, en: `Rollback failed: ${rollbackErr.message}` });
            }
        }

        if (extractedDir && fs.existsSync(extractedDir)) {
            try { fs.rmSync(extractedDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        }

        return {
            success: false,
            message: error.message || 'Bilinmeyen kurulum hatası',
            log: logger.getLog(),
            logSummary: logger.summary(),
            logFile: getLogFilePath(),
            installedVersion: null,
            // Ön koşul / koşul hataları yapısal olarak da taşınır — kurulum
            // modalı bu diziyi satır satır gösterebiliyor.
            failures: error.failures || undefined
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// uninstall — Modül kaldırma
// ─────────────────────────────────────────────────────────────────────────────
async function uninstall(manifest, gameName, exePath) {
    // Kaldırma da kurulumla aynı günlüğe yazar: ne silindi, ne geri yüklendi,
    // hangi adım neden atlandı — iki dilli.
    const logger = createLogger(manifest.id, { scope: 'uninstall', gameName });
    try {
        console.log(`${TAG} Kaldırma başlatılıyor: ${manifest.id}`);
        logger.info({
            tr: `Kaldırma başlatıldı: ${manifest.name || manifest.id} — oyun: ${gameName}`,
            en: `Uninstall started: ${manifest.name || manifest.id} — game: ${gameName}`
        });

        const destDir = resolveDestinationDir(manifest, gameName, exePath);
        if (!destDir) {
            return { success: false, message: 'Hedef klasör bulunamadı.' };
        }

        // ── Motor-seviyesi ön-kontrol: Oyun çalışıyor mu? ───────────────────
        let exeToCheck = exePath;
        if (!exeToCheck && destDir) {
            try {
                const exes = fs.readdirSync(destDir).filter(f => f.toLowerCase().endsWith('.exe'));
                if (exes.length > 0) exeToCheck = path.join(destDir, exes[0]);
            } catch (e) {}
        }
        if (exeToCheck && await utils.isGameRunning(exeToCheck)) {
            logger.error({
                tr: 'Kaldırma iptal edildi — oyun şu an çalışıyor',
                en: 'Uninstall aborted — the game is currently running'
            });
            return {
                success: false,
                message: 'Oyun şu an açık. Lütfen oyunu kapatıp tekrar deneyin.',
                deletedFiles: 0,
                log: logger.getLog(),
                logFile: getLogFilePath()
            };
        }
        logger.info({ tr: `Hedef klasör: ${destDir}`, en: `Target folder: ${destDir}` });

        // Oyun state'ini al
        const gamesState = config.getExistingGamesState();
        const normName = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const dbGame = gamesState.find(g => g.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normName);

        let deletedFiles = 0;
        // Silinen dosyaların tam yolları — `.bak` geri yüklemesi (adım 3b) bunları kullanır
        const deletedPaths = [];

        // ── 1. Gelişmiş / Koşullu Dosya Silme (uninstall.files) ──────────────
        if (!manifest.uninstall?.files) {
            logger.skip({
                tr: 'Dosya silme atlandı — manifest\'te uninstall.files tanımlı değil',
                en: 'File deletion skipped — no uninstall.files declared in the manifest'
            });
        }
        if (manifest.uninstall?.files) {
            for (const item of manifest.uninstall.files) {
                let fileName = null;
                let skipDeletion = false;

                if (typeof item === 'string') {
                    fileName = item;
                } else if (typeof item === 'object' && item.file) {
                    fileName = item.file;
                    if (item.unlessState && dbGame) {
                        const { flag, value } = item.unlessState;
                        if (dbGame[flag] === value) {
                            console.log(`${TAG} Dosya silme atlandı (unlessState sağlandı): ${fileName} (${flag}=${value})`);
                            logger.skip({
                                tr: `Silme atlandı — manifest unlessState koşulu sağlandı: ${fileName} (${flag}=${value})`,
                                en: `Deletion skipped — manifest unlessState condition met: ${fileName} (${flag}=${value})`
                            });
                            skipDeletion = true;
                        }
                    }
                    if (item.unlessAnyState && dbGame && Array.isArray(item.unlessAnyState)) {
                        for (const { flag, value } of item.unlessAnyState) {
                            const matchVal = value !== undefined ? value : true;
                            if (dbGame[flag] === matchVal) {
                                skipDeletion = true;
                                logger.skip({
                                    tr: `Silme atlandı — manifest unlessAnyState koşulu sağlandı: ${fileName} (${flag}=${matchVal})`,
                                    en: `Deletion skipped — manifest unlessAnyState condition met: ${fileName} (${flag}=${matchVal})`
                                });
                                break;
                            }
                        }
                    }
                }

                if (!skipDeletion && fileName) {
                    const isGenericFolder = fileName.toLowerCase() === 'licenses';
                    const maxDepth = isGenericFolder ? 1 : 5;
                    // Derinlemesine arama (findFileInDir)
                    const matches = findFileInDir(destDir, fileName, maxDepth);
                    if (matches.length === 0) {
                        logger.skip({
                            tr: `Silinecek dosya bulunamadı, atlandı: ${fileName}`,
                            en: `File to delete was not found; skipped: ${fileName}`
                        });
                    }
                    for (const targetPath of matches) {
                        try {
                            const isDir = fs.statSync(targetPath).isDirectory();
                            if (isDir) {
                                fs.rmSync(targetPath, { recursive: true, force: true });
                            } else {
                                fs.unlinkSync(targetPath);
                                deletedPaths.push(targetPath);
                            }
                            deletedFiles++;
                            console.log(`${TAG} Silindi: ${targetPath}`);
                            logger.step({
                                tr: `${isDir ? 'Klasör' : 'Dosya'} silindi: ${targetPath}`,
                                en: `${isDir ? 'Folder' : 'File'} deleted: ${targetPath}`
                            });
                        } catch (e) {
                            console.warn(`${TAG} Silinemedi: ${targetPath} — ${e.message}`);
                            logger.warn({
                                tr: `Silinemedi: ${targetPath} — ${e.message}`,
                                en: `Could not delete: ${targetPath} — ${e.message}`
                            });
                        }
                    }
                }
            }
        }

        // ── 2. Description-Doğrulamalı DLL Silme (uninstall.verifiedDlls) ───
        if (manifest.uninstall?.verifiedDlls) {
            for (const vd of manifest.uninstall.verifiedDlls) {
                const candidates = vd.candidates || [];
                const matchString = (vd.descriptionMatch || '').toLowerCase();

                // `matchModFileHash`: bazı modların DLL'lerinde sürüm kaynağı
                // (FileDescription) hiç yoktur — sahiplik, indirilmiş mod
                // dosyasının hash'iyle kanıtlanır. Yalnızca birebir aynı dosya
                // silinir; oyunun kendi DLL'ine dokunulmaz.
                const useHash = vd.matchModFileHash === true;
                let modSourceDir = null;
                if (useHash) {
                    const installedVersion = (manifest.state?.versionField && dbGame)
                        ? dbGame[manifest.state.versionField]
                        : null;
                    modSourceDir = installedVersion
                        ? findExistingLocalModDir(manifest, installedVersion)
                        : null;
                    if (!modSourceDir) {
                        console.warn(`${TAG} Hash doğrulaması için yerel mod klasörü bulunamadı, DLL silme atlandı.`);
                        logger.skip({
                            tr: 'DLL silme atlandı — hash doğrulaması için yerel mod klasörü bulunamadı',
                            en: 'DLL deletion skipped — local mod folder for hash verification was not found'
                        });
                        continue;
                    }
                }

                for (const dllName of candidates) {
                    const matches = findFileInDir(destDir, dllName);
                    for (const dllPath of matches) {
                        try {
                            let inUseByOther = false;
                            if (dbGame) {
                                const relPath = path.relative(destDir, dllPath).replace(/\\/g, '/');
                                const moduleManager = require('./moduleManager');
                                for (const mod of moduleManager.getModules()) {
                                    if (mod.id === manifest.id) continue;
                                    const otherState = mod.manifest?.state;
                                    if (otherState) {
                                        const fieldsToCheck = [otherState.pathField, otherState.injectionField].filter(Boolean);
                                        for (const f of fieldsToCheck) {
                                            if (dbGame[f] && typeof dbGame[f] === 'string') {
                                                const normDB = dbGame[f].toLowerCase().replace(/\\/g, '/');
                                                const normRel = relPath.toLowerCase();
                                                const normName = path.basename(dllPath).toLowerCase();
                                                if (normDB === normRel || normDB === normName || dbGame[f].toLowerCase() === dllPath.toLowerCase()) {
                                                    inUseByOther = true;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                    if (inUseByOther) break;
                                }
                            }
                            if (inUseByOther) {
                                logger.skip({
                                    tr: `DLL silinmedi — başka bir modül tarafından kullanılıyor: ${dllPath}`,
                                    en: `DLL not deleted — in use by another module: ${dllPath}`
                                });
                                continue;
                            }

                            if (useHash) {
                                const sourcePath = path.join(modSourceDir, dllName);
                                if (!fs.existsSync(sourcePath)) continue;
                                const [installedHash, sourceHash] = await Promise.all([
                                    utils.getFileHash(dllPath),
                                    utils.getFileHash(sourcePath)
                                ]);
                                if (!installedHash || installedHash !== sourceHash) continue;
                                fs.unlinkSync(dllPath);
                                deletedPaths.push(dllPath);
                                deletedFiles++;
                                console.log(`${TAG} Hash doğrulamalı DLL silindi: ${dllPath}`);
                                logger.step({
                                    tr: `DLL silindi (hash doğrulandı): ${dllPath}`,
                                    en: `DLL deleted (hash verified): ${dllPath}`
                                });
                                continue;
                            }

                            const desc = await utils.getFileDescription(dllPath);
                            if (desc && desc.toLowerCase().includes(matchString)) {
                                fs.unlinkSync(dllPath);
                                deletedPaths.push(dllPath);
                                deletedFiles++;
                                console.log(`${TAG} Verified DLL silindi: ${dllPath} (Açıklama: "${desc}")`);
                                logger.step({
                                    tr: `DLL silindi (açıklama doğrulandı "${desc}"): ${dllPath}`,
                                    en: `DLL deleted (description verified "${desc}"): ${dllPath}`
                                });
                            } else {
                                logger.skip({
                                    tr: `DLL silinmedi — açıklama "${vd.descriptionMatch}" ile eşleşmiyor, oyuna ait olabilir: ${dllPath}`,
                                    en: `DLL not deleted — description does not match "${vd.descriptionMatch}"; it may belong to the game: ${dllPath}`
                                });
                            }
                        } catch (e) {
                            console.warn(`${TAG} Verified DLL silinemedi: ${dllPath} — ${e.message}`);
                            logger.warn({
                                tr: `DLL silinemedi: ${dllPath} — ${e.message}`,
                                en: `DLL could not be deleted: ${dllPath} — ${e.message}`
                            });
                        }
                    }
                }
            }
        }

        // ── 3. Yerinde Yedek (.backup) ve Klasör Yedeği Geri Yükleme ──────
        const isSuffixUninstall = manifest.uninstall?.strategy === 'in_place_suffix' || manifest.backup?.strategy === 'in_place_suffix';
        const unSuffix = manifest.uninstall?.suffix || manifest.backup?.suffix || '.backup';

        if (isSuffixUninstall && fs.existsSync(destDir)) {
            const files = fs.readdirSync(destDir);
            const backupFiles = files.filter(f => f.toLowerCase().endsWith(unSuffix.toLowerCase()));

            if (manifest.uninstall?.gameUpdatedCheck && backupFiles.length > 0 && dbGame) {
                const recordedHashes = (manifest.state?.hashesField && dbGame[manifest.state.hashesField]) || {};
                let gameUpdated = false;

                for (const file of backupFiles) {
                    const originalName = file.substring(0, file.length - unSuffix.length);
                    const originalPath = path.join(destDir, originalName);
                    if (fs.existsSync(originalPath)) {
                        const currentHash = await utils.getFileHash(originalPath);
                        const originalHash = recordedHashes[originalName];
                        if (originalHash && currentHash && currentHash !== originalHash) {
                            let modHash = null;
                            const modVer = (manifest.state?.modVersionField && dbGame[manifest.state.modVersionField]) || (manifest.state?.versionField && dbGame[manifest.state.versionField]);
                            if (modVer) {
                                const modFilePath = path.join(config.modsPath, manifest.id, modVer, originalName);
                                if (fs.existsSync(modFilePath)) {
                                    modHash = await utils.getFileHash(modFilePath);
                                }
                            }
                            if (modHash && currentHash !== modHash) {
                                gameUpdated = true;
                                console.log(`${TAG} Oyun güncellemesi saptandı: ${originalName}`);
                                break;
                            }
                        }
                    }
                }

                if (gameUpdated) {
                    console.log(`${TAG} Oyun güncellemesi nedeniyle backup dosyaları temizleniyor.`);
                    logger.warn({
                        tr: 'Oyun dosyaları güncellenmiş — eski yedekler geri yüklenemez, yedek dosyaları temizleniyor',
                        en: 'Game files have been updated — old backups cannot be restored; backup files are being removed'
                    });
                    for (const file of backupFiles) {
                        try { fs.unlinkSync(path.join(destDir, file)); } catch (e) {}
                    }
                    if (manifest.state?.flag) dbGame[manifest.state.flag] = false;
                    if (manifest.state?.versionField) dbGame[manifest.state.versionField] = null;
                    if (manifest.state?.pathField) dbGame[manifest.state.pathField] = null;
                    if (manifest.state?.hashesField) delete dbGame[manifest.state.hashesField];
                    if (manifest.state?.modVersionField) delete dbGame[manifest.state.modVersionField];
                    config.saveGamesState();
                    return {
                        success: false,
                        message: 'Oyun dosyaları güncellenmiş, eski yedek geri yüklenemez.',
                        deletedFiles: backupFiles.length,
                        log: logger.getLog(),
                        logSummary: logger.summary(),
                        logFile: getLogFilePath()
                    };
                }
            }

            // Safe clean of mod-only files if specified
            if (manifest.uninstall?.cleanModOnlyFiles && manifest.install?.whitelistFiles) {
                const recordedHashes = (manifest.state?.hashesField && dbGame?.[manifest.state.hashesField]) || {};
                for (const file of manifest.install.whitelistFiles) {
                    const activePath = path.join(destDir, file);
                    const backupPath = activePath + unSuffix;
                    if (fs.existsSync(activePath) && !fs.existsSync(backupPath) && !recordedHashes[file]) {
                        try {
                            fs.unlinkSync(activePath);
                            deletedFiles++;
                            console.log(`${TAG} Mod-özel dosyası silindi: ${file}`);
                        } catch (e) {}
                    }
                }
            }

            // Restore backups
            for (const file of backupFiles) {
                const originalName = file.substring(0, file.length - unSuffix.length);
                const originalPath = path.join(destDir, originalName);
                const backupPath = path.join(destDir, file);
                try {
                    if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath);
                    fs.renameSync(backupPath, originalPath);
                    deletedFiles++;
                    console.log(`${TAG} Yedek geri yüklendi: ${backupPath} -> ${originalPath}`);
                    logger.step({
                        tr: `Orijinal dosya yedekten geri yüklendi: ${file} → ${path.basename(originalPath)}`,
                        en: `Original file restored from backup: ${file} → ${path.basename(originalPath)}`
                    });
                } catch (e) {
                    console.warn(`${TAG} Yedek geri yükleme hatası (${file}): ${e.message}`);
                    logger.warn({
                        tr: `Yedek geri yüklenemedi (${file}): ${e.message}`,
                        en: `Backup could not be restored (${file}): ${e.message}`
                    });
                }
            }
        } else if (manifest.uninstall?.restoreBackup === true) {
            await backup.restoreBackup(gameName, manifest.id, destDir, null);
            logger.step({
                tr: 'Klasör yedeği geri yüklendi (manifest uninstall.restoreBackup: true)',
                en: 'Folder backup restored (manifest uninstall.restoreBackup: true)'
            });
        } else {
            console.log(`${TAG} Yedek geri yükleme atlandı (restoreBackup: false veya belirtilmemiş)`);
            logger.skip({
                tr: 'Yedek geri yükleme atlandı — manifest\'te uninstall.restoreBackup tanımlı değil ya da false',
                en: 'Backup restore skipped — uninstall.restoreBackup is false or not declared in the manifest'
            });
        }

        // ── 3b. `.bak` Geri Yükleme ───────────────────────────────────────────
        // apiTargeting kurulumu, hedefte aynı adlı bir DLL bulursa onu
        // `<ad>.bak` olarak saklar (bkz. install adım 13). Kaldırmada sıra
        // önemli: ÖNCE mod dosyası silinir, SONRA `.bak` uzantısı kaldırılarak
        // orijinal adıyla geri yüklenir — aksi hâlde ad çakışması olur.
        for (const deletedPath of deletedPaths) {
            const bakPath = deletedPath + '.bak';
            try {
                if (!fs.existsSync(bakPath)) continue;
                if (fs.existsSync(deletedPath)) {
                    // Mod dosyası hâlâ duruyorsa geri yükleme yapılmaz (üzerine yazmayalım)
                    console.warn(`${TAG} .bak geri yüklenmedi, hedef hâlâ mevcut: ${deletedPath}`);
                    continue;
                }
                fs.renameSync(bakPath, deletedPath);
                console.log(`${TAG} .bak geri yüklendi: ${path.basename(bakPath)} -> ${path.basename(deletedPath)}`);
                logger.step({
                    tr: `.bak geri yüklendi: ${path.basename(bakPath)} → ${path.basename(deletedPath)}`,
                    en: `.bak restored: ${path.basename(bakPath)} → ${path.basename(deletedPath)}`
                });
            } catch (e) {
                console.warn(`${TAG} .bak geri yükleme hatası (${bakPath}): ${e.message}`);
                logger.warn({
                    tr: `.bak geri yüklenemedi (${bakPath}): ${e.message}`,
                    en: `.bak could not be restored (${bakPath}): ${e.message}`
                });
            }
        }

        // ── 4. State Sıfırlama ────────────────────────────────────────────────
        if (dbGame) {
            if (dbGame.installedMods && dbGame.installedMods[manifest.id]) {
                delete dbGame.installedMods[manifest.id];
            }
            if (manifest.state) {
                if (manifest.state.flag) dbGame[manifest.state.flag] = false;
                if (manifest.state.versionField) dbGame[manifest.state.versionField] = null;
                if (manifest.state.pathField) dbGame[manifest.state.pathField] = null;
                if (manifest.state.hashesField) delete dbGame[manifest.state.hashesField];
                if (manifest.state.modVersionField) delete dbGame[manifest.state.modVersionField];
                // install adımı 15 bu iki alanı da yazıyor; temizlenmezse mod
                // kaldırıldıktan sonra da kartta/ayar ekranında iz bırakıyorlar.
                if (manifest.state.injectionField) dbGame[manifest.state.injectionField] = null;
                if (manifest.state.upscalerField && dbGame.upscalers) {
                    dbGame.upscalers[manifest.state.upscalerField] = false;
                }
            }
            config.saveGamesState();
            console.log(`${TAG} Oyun state sıfırlandı`);
            logger.step({
                tr: 'Oyun durumu (games.json) sıfırlandı — mod artık kurulu görünmüyor',
                en: 'Game state (games.json) reset — the mod no longer shows as installed'
            });
        } else {
            logger.skip({
                tr: 'Oyun kaydı bulunamadı — durum sıfırlaması atlandı',
                en: 'Game record not found — state reset skipped'
            });
        }

        console.log(`${TAG} Kaldırma tamamlandı: ${manifest.id} (${deletedFiles} dosya silindi)`);
        const uninstallSummary = logger.summary();
        logger.info({
            tr: `Özet: ${deletedFiles} öğe silindi, ${uninstallSummary.skip || 0} adım atlandı, ${uninstallSummary.warn || 0} uyarı`,
            en: `Summary: ${deletedFiles} item(s) deleted, ${uninstallSummary.skip || 0} step(s) skipped, ${uninstallSummary.warn || 0} warning(s)`
        });

        return {
            success: true,
            message: 'Mod başarıyla kaldırıldı.',
            deletedFiles,
            log: logger.getLog(),
            logSummary: uninstallSummary,
            logFile: getLogFilePath()
        };

    } catch (error) {
        console.error(`${TAG} Kaldırma hatası (${manifest.id}):`, error);
        logger.error({
            tr: `Kaldırma hatası: ${error.message}`,
            en: `Uninstall failed: ${error.message}`
        });
        return {
            success: false,
            message: error.message,
            deletedFiles: 0,
            log: logger.getLog(),
            logSummary: logger.summary(),
            logFile: getLogFilePath()
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// getReleases — Sürüm listesi
// ─────────────────────────────────────────────────────────────────────────────
async function getReleases(manifest, forceRefresh = false) {
    try {
        const result = await sourceResolver.fetchReleases(manifest, { forceRefresh });

        if (result && result.releases) {
            const folderCandidates = getModFolderCandidates(manifest);
            result.releases.forEach(r => {
                let installed = false;
                for (const folder of folderCandidates) {
                    const tagDir = path.join(config.modsPath, folder, r.tag || '');
                    const nameDir = path.join(config.modsPath, folder, r.name || '');
                    if (r.tag && fs.existsSync(tagDir)) {
                        try {
                            const stat = fs.statSync(tagDir);
                            if (stat.isDirectory() ? fs.readdirSync(tagDir).length > 0 : true) {
                                installed = true;
                                break;
                            }
                        } catch (e) {}
                    }
                    if (!installed && r.name && fs.existsSync(nameDir)) {
                        try {
                            const stat = fs.statSync(nameDir);
                            if (stat.isDirectory() ? fs.readdirSync(nameDir).length > 0 : true) {
                                installed = true;
                                break;
                            }
                        } catch (e) {}
                    }
                }
                r.installed = installed;
            });
        }

        return result;
    } catch (error) {
        console.error(`${TAG} getReleases hatası:`, error);
        return { error: error.message, releases: [] };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// downloadRelease — Sürüm indirme ve çıkarma
// ─────────────────────────────────────────────────────────────────────────────
async function downloadRelease(manifest, tag, downloadUrl, event) {
    if (!downloadUrl) return { success: false, error: 'İndirme bağlantısı bulunamadı.' };

    // Zaten indirilmiş mi kontrol et
    const existing = findExistingLocalModDir(manifest, tag);
    if (existing) {
        console.log(`${TAG} [DOWNLOAD_RELEASE] Sürüm zaten indirilmiş: ${existing}`);
        if (event && event.sender && !event.sender.isDestroyed()) {
            event.sender.send('module-download-progress', {
                moduleId: manifest.id,
                tag,
                percent: 100
            });
        }
        return { success: true, targetDir: existing, alreadyExists: true };
    }

    const folderCandidates = getModFolderCandidates(manifest);
    const primaryFolder = folderCandidates[0] || manifest.id;
    const versionDirName = tag || 'latest';
    const targetDir = path.join(config.modsPath, primaryFolder, versionDirName);

    const is7z = downloadUrl.toLowerCase().endsWith('.7z');
    const isZip = downloadUrl.toLowerCase().endsWith('.zip');
    const isArchive = is7z || isZip;
    const ext = path.extname(downloadUrl) || (is7z ? '.7z' : (isZip ? '.zip' : ''));
    
    const tempDir = app.getPath('temp');
    const tempFileName = `mod_${manifest.id}_${versionDirName.replace(/[^a-z0-9.-]/gi, '_')}_${Date.now()}${ext}`;
    const tempPath = path.join(tempDir, tempFileName);

    try {
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        await githubFetcher.downloadAsset(downloadUrl, tempDir, tempFileName, (percent, downloaded, total) => {
            if (event && event.sender && !event.sender.isDestroyed()) {
                event.sender.send('module-download-progress', {
                    moduleId: manifest.id,
                    tag,
                    percent
                });
            }
        });

        const partialTargetDir = targetDir + '.partial';
        if (fs.existsSync(partialTargetDir)) {
            try {
                fs.rmSync(partialTargetDir, { recursive: true, force: true });
            } catch (e) {
                console.error(`[MODULE_ENGINE] Eski partialTargetDir temizlenemedi:`, e);
            }
        }
        fs.mkdirSync(partialTargetDir, { recursive: true });

        if (isArchive) {
            if (event && event.sender && !event.sender.isDestroyed()) {
                event.sender.send('module-download-progress', {
                    moduleId: manifest.id,
                    tag,
                    percent: 100,
                    stage: 'extracting'
                });
            }
            await archive.extractArchive(tempPath, partialTargetDir);
        } else {
            // Tekil binary dosya (.asi, .dll vb.)
            const baseFileName = path.basename(downloadUrl).split('?')[0] || `mod_file${ext}`;
            fs.copyFileSync(tempPath, path.join(partialTargetDir, baseFileName));
        }

        if (fs.existsSync(targetDir)) {
            try {
                fs.rmSync(targetDir, { recursive: true, force: true });
            } catch (e) {
                console.error(`[MODULE_ENGINE] Eski targetDir temizlenemedi:`, e);
            }
        }
        fs.renameSync(partialTargetDir, targetDir);

        try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch (e) {}

        return { success: true, targetDir };
    } catch (error) {
        console.error(`${TAG} downloadRelease hatası:`, error);
        try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            const partialTargetDir = targetDir + '.partial';
            if (fs.existsSync(partialTargetDir)) fs.rmSync(partialTargetDir, { recursive: true, force: true });
        } catch (e) {}
        return { success: false, error: error.message };
    }
}

function findDynamicSearchDir(basePath, detection = {}) {
    if (!basePath || !fs.existsSync(basePath)) return null;

    const queue = [{ path: basePath, depth: 0 }];
    const visited = new Set();
    const ignoreDirs = ['data', 'shader', 'resource', 'asset', 'sound', 'audio', 'video', 'movie', 'localization', '_redist'];
    const targetFiles = (detection.files || []).map(f => f.toLowerCase());
    const matches = [];

    while (queue.length > 0) {
        const current = queue.shift();
        const dir = current.path;
        const absDir = path.resolve(dir);
        if (visited.has(absDir)) continue;
        visited.add(absDir);

        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            let hasMatch = false;
            for (const entry of entries) {
                if (entry.isSymbolicLink()) continue;
                if (entry.isFile()) {
                    if (targetFiles.includes(entry.name.toLowerCase())) {
                        hasMatch = true;
                    }
                } else if (entry.isDirectory()) {
                    const nameLow = entry.name.toLowerCase();
                    if (!ignoreDirs.some(d => nameLow.includes(d))) {
                        queue.push({ path: path.join(dir, entry.name), depth: current.depth + 1 });
                    }
                }
            }
            if (hasMatch) {
                matches.push({ path: dir, depth: current.depth });
            }
        } catch (e) {}
    }

    if (matches.length > 0) {
        const strategy = detection.strategy || 'shallowest_directory';
        if (strategy === 'deepest_directory') {
            matches.sort((a, b) => b.depth - a.depth);
        } else {
            matches.sort((a, b) => a.depth - b.depth);
        }
        return matches[0].path;
    }

    // Fallback: largest executable directory
    if (detection.fallback === 'largest_executable_directory') {
        const exeQueue = [basePath];
        const exeVisited = new Set();
        let largestSize = 0;
        let largestDir = null;

        while (exeQueue.length > 0) {
            const dir = exeQueue.shift();
            const absDir = path.resolve(dir);
            if (exeVisited.has(absDir)) continue;
            exeVisited.add(absDir);

            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isSymbolicLink()) continue;
                    if (entry.isFile()) {
                        const nameLow = entry.name.toLowerCase();
                        if (nameLow.endsWith('.exe') &&
                            !nameLow.includes('launcher') &&
                            !nameLow.includes('crashreport') &&
                            !nameLow.includes('webhelper') &&
                            !nameLow.includes('setup') &&
                            !nameLow.includes('unins')) {
                            const filePath = path.join(dir, entry.name);
                            const stats = fs.statSync(filePath);
                            if (stats.size > 2 * 1024 * 1024 && stats.size > largestSize) {
                                largestSize = stats.size;
                                largestDir = dir;
                            }
                        }
                    } else if (entry.isDirectory()) {
                        const nameLow = entry.name.toLowerCase();
                        if (!ignoreDirs.some(d => nameLow.includes(d))) {
                            exeQueue.push(path.join(dir, entry.name));
                        }
                    }
                }
            } catch (e) {}
        }
        if (largestDir) return largestDir;
    }

    return null;
}

function resolveDestinationDir(manifest, gameName, exePath) {
    const gamePaths = config.getGamePaths(gameName, exePath);
    if (!gamePaths && !exePath) return null;
    const exeDir = gamePaths?.exe_path ? path.dirname(gamePaths.exe_path) : (exePath ? path.dirname(exePath) : null);
    const gameRoot = config.resolveActualGameRoot(gameName, exePath) || gamePaths?.game_root || exeDir;
    const destType = manifest?.install?.destination || 'game_root';

    if (destType === 'game_root') {
        return gameRoot;
    } else if (destType === 'game_exe') {
        return exeDir || gameRoot;
    } else if (destType === 'dynamic_search') {
        const searchBase = manifest.install?.detection?.searchBase === 'game_exe' ? (exeDir || gameRoot) : gameRoot;
        const found = findDynamicSearchDir(searchBase, manifest.install?.detection);
        return found || exeDir || gameRoot;
    } else if (typeof destType === 'object' && destType.type === 'relative') {
        return path.join(gameRoot, destType.path);
    }
    return gameRoot;
}

module.exports = {
    install,
    uninstall,
    getReleases,
    downloadRelease,
    resolveDestinationDir,
    findDynamicSearchDir,
    getModFolderCandidates,
    findExistingLocalModDir
};
