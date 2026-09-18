const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { exec } = require('child_process');

const config = require('../../config');
const scanner = require('../../scanner');
const utils = require('../../utils');
const launcher = require('../../mods/launcher');
const iniEditor = require('../../mods/iniEditor');
const dlssEnabler = require('../../mods/dlssEnabler');
const conditionChecker = require('./conditionChecker');

const INI_WAIT_SECONDS = 10;

const MESSAGES = {
    tr: {
        start: '=== {title} Başlatıldı ===',
        game: 'Oyun: {name}',
        exe: 'EXE Konumu: {path}',
        platform: 'Platform: {platform}',
        version: 'Sürüm: {version}',
        errExeNotFound: 'Oyun EXE dosyası bulunamadı veya geçersiz.',
        downloading: 'Mod dosyaları indiriliyor: {version}...',
        errDlMissing: 'Bu sürüm için indirme linki bulunamadı.',
        errDlFailed: 'İndirme hatası: {err}',
        dlOk: 'Dosyalar başarıyla indirildi.',
        snapshot: 'Geri yükleme noktası oluşturuldu (games.json snapshot).',
        dllOrder: 'Enjeksiyon DLL sırası: {order}',
        tryingDll: '[{n}/{total}] {dll} deneniyor...',
        conflictDetect: 'Çakışan mod dosyası tespit edildi: {file}. Kurulum devam ediyor ancak sorun yaşanabilir.',
        errListFolder: 'Mod klasörü listelenemedi: {err}',
        errCopyFailed: 'Kopyalama hatası: {err}',
        copyOk: 'Dosyalar kopyalandı.',
        copiedFile: 'Kopyalandı: {file}',
        backedUpFile: 'Mevcut dosya yedeklendi: {file}',
        skippedFile: 'Atlandı (manifest kuralı): {file}',
        prereqOk: 'Ön koşullar sağlandı.',
        errPrereq: 'Ön koşullar sağlanamadı: {reasons}',
        dbUpdate: 'games.json geçici olarak güncellendi.',
        launching: 'Oyun başlatılıyor...',
        errLaunchFailed: 'Oyun başlatılamadı: {err}',
        launchOk: 'Oyun başlatıldı.',
        checkingGameRunning: 'Oyunun görev yöneticisinde çalışıp çalışmadığı kontrol ediliyor...',
        gameRunningOk: 'Oyun görev yöneticisinde çalışıyor.',
        gameNotRunningErr: 'Oyun görev yöneticisinde çalışır durumda görünmedi.',
        gameRunningCheckErr: 'Görev yöneticisi kontrolünde hata oluştu (erişim engellendi veya sorgulanamadı): {err}. Yine de .ini kontrolüne devam ediliyor.',
        watchingIni: '{file} oluşumu izleniyor (maks. {timeout} saniye)...',
        iniFound: '[{sec}s] {file} dosyası başarıyla oluşturuldu!',
        terminating: 'Oyun sonlandırılıyor...',
        terminateOk: 'Oyun başarıyla kapatıldı.',
        terminateWarn: 'Oyun kapatılamadı veya zaten kapalıydı.',
        applyingPreset: 'Ön ayar uygulanıyor...',
        presetOk: 'Geliştirici ön ayarı başarıyla uygulandı.',
        presetErr: 'Ön ayar uygulanamadı: {err}',
        userGamesOk: 'EXE yolu kullanıcı oyunlarına kaydedildi.',
        userGamesErr: 'Oyun yolu user-games.json dosyasına kaydedilemedi: {err}',
        iniNotFoundErr: '{file} dosyası {dll} ile {timeout} saniye sonunda oluşmadı.',
        rollback: 'Kurulum geri alınıyor...',
        rollbackCleaned: 'Kopyalanan dosyalar temizlendi.',
        rollbackCleanErr: 'Dosya temizleme hatası: {err}',
        rollbackDb: 'games.json eski haline getirildi.',
        successHeader: '=== KURULUM BAŞARILI ===',
        successFooter: 'Kurulum başarılı.',
        successDll: 'Çalışan DLL: {dll}',
        logSaved: 'Log dosyası kaydedildi: {path}',
        errAllFailed: 'Tüm enjeksiyon tipleri denendi, hiçbiri çalışmadı. Kurulum başarısız oldu.'
    },
    en: {
        start: '=== {title} Started ===',
        game: 'Game: {name}',
        exe: 'EXE Location: {path}',
        platform: 'Platform: {platform}',
        version: 'Version: {version}',
        errExeNotFound: 'Game EXE file not found or invalid.',
        downloading: 'Downloading mod files: {version}...',
        errDlMissing: 'Download link not found for this version.',
        errDlFailed: 'Download error: {err}',
        dlOk: 'Files downloaded successfully.',
        snapshot: 'Restore point created (games.json snapshot).',
        dllOrder: 'Injection DLL order: {order}',
        tryingDll: '[{n}/{total}] Trying {dll}...',
        conflictDetect: 'Conflicting mod file detected: {file}. Installation proceeds but issues may occur.',
        errListFolder: 'Could not list mod directory: {err}',
        errCopyFailed: 'Copy error: {err}',
        copyOk: 'Files copied.',
        copiedFile: 'Copied: {file}',
        backedUpFile: 'Existing file backed up: {file}',
        skippedFile: 'Skipped (manifest rule): {file}',
        prereqOk: 'Prerequisites satisfied.',
        errPrereq: 'Prerequisites not satisfied: {reasons}',
        dbUpdate: 'games.json updated temporarily.',
        launching: 'Launching game...',
        errLaunchFailed: 'Could not launch game: {err}',
        launchOk: 'Game launched.',
        checkingGameRunning: 'Checking whether the game is running in Task Manager...',
        gameRunningOk: 'Game is running in Task Manager.',
        gameNotRunningErr: 'The game does not appear to be running in Task Manager.',
        gameRunningCheckErr: 'An error occurred during Task Manager check (access denied or query failed): {err}. Continuing with .ini check regardless.',
        watchingIni: 'Watching for {file} generation (max {timeout} seconds)...',
        iniFound: '[{sec}s] {file} file created successfully!',
        terminating: 'Terminating game...',
        terminateOk: 'Game closed successfully.',
        terminateWarn: 'Could not close game or it was already closed.',
        applyingPreset: 'Applying preset...',
        presetOk: 'Developer preset applied successfully.',
        presetErr: 'Could not apply preset: {err}',
        userGamesOk: 'EXE path saved to User Games.',
        userGamesErr: 'Could not save game path to user-games.json: {err}',
        iniNotFoundErr: '{file} was not created with {dll} after {timeout} seconds.',
        rollback: 'Rolling back installation...',
        rollbackCleaned: 'Copied files cleaned up.',
        rollbackCleanErr: 'Error cleaning up files: {err}',
        rollbackDb: 'games.json reverted to previous state.',
        successHeader: '=== INSTALLATION SUCCESSFUL ===',
        successFooter: 'Installation successful.',
        successDll: 'Working DLL: {dll}',
        logSaved: 'Log file saved: {path}',
        errAllFailed: 'All injection types tried, none worked. Installation failed.'
    }
};

function formatLogTime() {
    const date = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function logMsg(event, logPath, type, msg, code = null) {
    const timeStr = formatLogTime();
    let fileLine = `[${timeStr}] [${type.toUpperCase()}] `;
    if (code) fileLine += `${code} `;
    fileLine += msg;

    try {
        fs.appendFileSync(logPath, fileLine + '\r\n', 'utf8');
    } catch (e) {
        console.error('[MODULE WIZARD] Log dosyasına yazılamadı:', e);
    }

    if (event && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('wizard-log', { type, msg, code });
    }
}

function terminateProcess(exePath) {
    const exeName = path.basename(exePath);
    return new Promise((resolve) => {
        exec(`taskkill /F /IM "${exeName}"`, (err, stdout, stderr) => {
            resolve({ success: !err, stdout, stderr });
        });
    });
}

/**
 * Arşivin kökünde sourceFile yoksa tek klasörlük sarmalayıcıya iner.
 * (manifest install.extractRoot: "auto" davranışının sihirbaz karşılığı)
 */
function resolveSourceRoot(versionDir, sourceFile) {
    try {
        if (!fs.existsSync(versionDir)) return versionDir;
        const entries = fs.readdirSync(versionDir, { withFileTypes: true });
        const hasSource = entries.some(e => e.isFile() && e.name.toLowerCase() === sourceFile.toLowerCase());
        if (hasSource) return versionDir;

        const dirs = entries.filter(e => e.isDirectory());
        for (const d of dirs) {
            const nested = path.join(versionDir, d.name);
            const found = resolveSourceRoot(nested, sourceFile);
            if (found !== nested || fs.readdirSync(nested).some(f => f.toLowerCase() === sourceFile.toLowerCase())) {
                return found;
            }
        }
    } catch (e) { /* ignore */ }
    return versionDir;
}

/**
 * Manifest `install.files.include` / `install.files.exclude` / `install.whitelistFiles`
 * kurallarını uygular. Sihirbaz eskiden kaynak klasördeki HER dosyayı kopyalıyordu;
 * normal kurulum (moduleEngine.install) ise bu filtreleri uyguluyor. Kurallar tek
 * yerden sürülsün diye sihirbaz da aynı manifest alanlarına uyar.
 *
 * @returns {{allowed: boolean, reason: string|null}}
 */
function isFileAllowedByManifest(manifest, fileName) {
    const inst = manifest && manifest.install ? manifest.install : {};

    if (Array.isArray(inst.whitelistFiles) && inst.whitelistFiles.length > 0) {
        const allow = inst.whitelistFiles.some(f => String(f).toLowerCase() === fileName.toLowerCase());
        if (!allow) return { allowed: false, reason: 'whitelistFiles' };
    }

    const matches = (patterns) => patterns.some(pat => {
        const rx = new RegExp('^' + String(pat)
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.') + '$', 'i');
        return rx.test(fileName);
    });

    if (Array.isArray(inst.files?.include) && inst.files.include.length > 0) {
        if (!matches(inst.files.include)) return { allowed: false, reason: 'install.files.include' };
    }
    if (Array.isArray(inst.files?.exclude) && inst.files.exclude.length > 0) {
        if (matches(inst.files.exclude)) return { allowed: false, reason: 'install.files.exclude' };
    }

    return { allowed: true, reason: null };
}

/**
 * Manifest sourceFile'ını seçilen proxy adıyla, kalan dosyaları olduğu gibi kopyalar.
 * dlssEnabler.copyDlssFiles'ın modülden bağımsız hâli (o fonksiyon 'version.dll' sabitliydi).
 *
 * Normal kurulumla aynı iki kuralı uygular:
 *  - Hedefte aynı adlı bir dosya varsa ÖNCE `<ad>.bak` olarak saklanır (oyunun
 *    kendi DLL'i üzerine geri dönüşsüz yazılmasın diye — moduleEngine adım 13).
 *  - Ek dosyalar manifest'in include/exclude/whitelist kurallarından geçirilir.
 *
 * @returns {{success:boolean, error?:string, copied?:string[], skipped?:string[], backedUp?:string[]}}
 */
async function copyModFiles(sourceDir, targetDir, sourceFile, effectiveDllName, verifyDelayMs = 1500, manifest = {}) {
    const sourcePath = path.join(sourceDir, sourceFile);
    const targetPath = path.join(targetDir, effectiveDllName);

    if (!fs.existsSync(sourcePath)) {
        return { success: false, error: `Kaynak dosya bulunamadı: ${sourceFile} (${sourceDir})` };
    }

    const copied = [];
    const skipped = [];
    const backedUp = [];

    // Hedefte aynı adlı dosya varsa üzerine yazmadan önce `.bak` olarak sakla.
    const backupExisting = (filePath) => {
        if (!fs.existsSync(filePath)) return;
        const bakPath = filePath + '.bak';
        try {
            // Zaten bir `.bak` varsa ilk (gerçek orijinal) yedek korunur.
            if (fs.existsSync(bakPath)) return;
            fs.renameSync(filePath, bakPath);
            backedUp.push(path.basename(bakPath));
            console.log(`[MODULE WIZARD] Mevcut dosya yedeklendi: ${path.basename(filePath)} -> ${path.basename(bakPath)}`);
        } catch (e) {
            console.warn(`[MODULE WIZARD] Mevcut dosya yedeklenemedi (${path.basename(filePath)}): ${e.message}`);
        }
    };

    backupExisting(targetPath);

    try {
        fs.copyFileSync(sourcePath, targetPath);
        copied.push(`${sourceFile} → ${effectiveDllName}`);
    } catch (e) {
        if (['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) {
            return { success: false, error: `Erişim engellendi (${e.code}): Klasör izinlerini veya antivirüs ayarlarını kontrol edin.` };
        }
        return { success: false, error: `Dosya kopyalama hatası: ${e.message}` };
    }

    try {
        const others = fs.readdirSync(sourceDir, { withFileTypes: true })
            .filter(e => e.isFile() && e.name.toLowerCase() !== sourceFile.toLowerCase());
        for (const entry of others) {
            const verdict = isFileAllowedByManifest(manifest, entry.name);
            if (!verdict.allowed) {
                skipped.push(`${entry.name} (${verdict.reason})`);
                continue;
            }
            try {
                const dest = path.join(targetDir, entry.name);
                backupExisting(dest);
                fs.copyFileSync(path.join(sourceDir, entry.name), dest);
                copied.push(entry.name);
            } catch (e) {
                console.warn(`[MODULE WIZARD] Ek dosya kopyalanamadı: ${entry.name} — ${e.message}`);
                skipped.push(`${entry.name} (hata: ${e.message})`);
            }
        }
    } catch (e) {
        console.warn(`[MODULE WIZARD] sourceDir listelenemedi: ${e.message}`);
    }

    // Antivirüs / erişim doğrulaması — kopyalanan dosya hâlâ duruyor mu?
    if (verifyDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, verifyDelayMs));
        if (!fs.existsSync(targetPath)) {
            return {
                success: false,
                error: `Erişim Engellendi veya Antivirüs Engeli: "${effectiveDllName}" kopyalandıktan sonra silindi. Antivirüs karantinasını veya klasör izinlerini kontrol edin.`,
                copied, skipped, backedUp
            };
        }
    }

    return { success: true, copied, skipped, backedUp };
}

function cleanupCopiedFiles(targetExeDir, currentDll, otherFiles, watchFile) {
    const filesToRemove = new Set([currentDll, ...otherFiles]);
    if (watchFile) filesToRemove.add(watchFile);
    if (watchFile && watchFile.endsWith('.ini')) {
        filesToRemove.add(watchFile.replace('.ini', '.log'));
    }
    for (const file of filesToRemove) {
        const targetFile = path.join(targetExeDir, file);
        if (fs.existsSync(targetFile)) {
            try {
                fs.unlinkSync(targetFile);
            } catch (e) { /* ignore */ }
        }

        // Kopyalama öncesinde `<ad>.bak` olarak saklanan ORİJİNAL dosya varsa
        // geri yükle. Aksi hâlde başarısız bir sihirbaz denemesi oyunun kendi
        // DLL'ini kalıcı olarak yok ediyordu (moduleEngine kaldırma adım 3b ile
        // aynı sıra: önce mod dosyası silinir, sonra `.bak` geri alınır).
        const bakFile = targetFile + '.bak';
        try {
            if (fs.existsSync(bakFile) && !fs.existsSync(targetFile)) {
                fs.renameSync(bakFile, targetFile);
                console.log(`[MODULE WIZARD] .bak geri yüklendi: ${path.basename(bakFile)} -> ${path.basename(targetFile)}`);
            }
        } catch (e) {
            console.warn(`[MODULE WIZARD] .bak geri yüklenemedi (${bakFile}): ${e.message}`);
        }
    }
}

async function rollbackAttempt(event, logPath, t, originalGamesState, targetExeDir, currentDll, otherFiles, watchFile) {
    logMsg(event, logPath, 'info', t('rollback'));
    try {
        cleanupCopiedFiles(targetExeDir, currentDll, otherFiles, watchFile);
        logMsg(event, logPath, 'info', t('rollbackCleaned'));
    } catch (cleanupErr) {
        logMsg(event, logPath, 'warn', t('rollbackCleanErr', { err: cleanupErr.message }));
    }

    config.setExistingGamesState(JSON.parse(JSON.stringify(originalGamesState)));
    config.saveGamesState();
    logMsg(event, logPath, 'info', t('rollbackDb'));
}

/**
 * Runs a declarative manifest-based wizard.
 */
async function runModuleWizard(event, { manifest, game, version, dllName, downloadUrl, developerPreset, exePath, lang }, shouldAbort) {
    if (!manifest || !manifest.wizard) {
        throw new Error('Belirtilen mod için sihirbaz (wizard) konfigürasyonu tanımlanmamış.');
    }

    const wizardConfig = manifest.wizard;
    const activeLang = lang === 'en' ? 'en' : 'tr';
    
    const t = (key, params = {}) => {
        const locale = MESSAGES[activeLang] || MESSAGES['tr'];
        let str = locale[key] || MESSAGES['tr'][key] || key;
        for (const [k, v] of Object.entries(params)) {
            str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
        }
        return str;
    };

    const modId = manifest.id || 'mod';
    const wizardTitle = wizardConfig.title || `${manifest.name || modId} Sihirbazı`;

    const gameObj = (typeof game === 'object' && game !== null) ? game : { name: (typeof game === 'string' ? game : 'Game') };
    const gameName = gameObj.name || '';
    version = version || 'latest';
    dllName = dllName || 'version.dll';

    // EXE resolution fallback if missing, not found, or is a directory
    if (!exePath || !fs.existsSync(exePath) || (fs.existsSync(exePath) && fs.statSync(exePath).isDirectory())) {
        const candidateInput = exePath || gameObj.exePath || gameObj.exe_path;
        const paths = config.getGamePaths(gameName, candidateInput);
        if (paths && paths.exe_path && fs.existsSync(paths.exe_path) && !fs.statSync(paths.exe_path).isDirectory()) {
            exePath = paths.exe_path;
        } else if (paths && paths.game_root && fs.existsSync(paths.game_root)) {
            const foundExes = utils.scanFolderForExes(paths.game_root);
            if (foundExes && foundExes.length > 0) {
                const normName = gameName.toLowerCase().replace(/[^a-z0-9]/g, '');
                const match = foundExes.find(e => path.basename(e, '.exe').toLowerCase().replace(/[^a-z0-9]/g, '') === normName) || foundExes[0];
                if (match) exePath = match;
            }
        }
    }

    if (exePath && fs.existsSync(exePath) && fs.statSync(exePath).isDirectory()) {
        const foundExes = utils.scanFolderForExes(exePath);
        if (foundExes && foundExes.length > 0) {
            exePath = foundExes[0];
        }
    }

    // 1. Log Dosyası Hazırlığı (Klasik yapı ile birebir uyumlu)
    const logFolderBase = wizardConfig.logFolder || modId;
    const logsDir = path.join(app.getPath('userData'), 'logs', `${logFolderBase}-wizard`);
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    const date = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
    const logPath = path.join(logsDir, `${logFolderBase}-wizard-${timestamp}.log`);

    logMsg(event, logPath, 'info', t('start', { title: wizardTitle }));
    logMsg(event, logPath, 'info', t('game', { name: gameName || 'Game' }));
    logMsg(event, logPath, 'info', t('exe', { path: exePath || 'None' }));
    logMsg(event, logPath, 'info', t('platform', { platform: gameObj.source || 'Unknown' }));
    logMsg(event, logPath, 'info', t('version', { version }));

    if (!exePath || !fs.existsSync(exePath) || fs.statSync(exePath).isDirectory()) {
        logMsg(event, logPath, 'err', t('errExeNotFound'), '[ERR_001]');
        return { success: false, error: 'EXE_NOT_FOUND', code: 'ERR_001' };
    }

    const targetExeDir = path.dirname(exePath);
    let versionDir = path.join(config.modsPath, modId, version);

    // Auto-test parametreleri
    const autoTest = wizardConfig.autoTest || {};
    const sourceFile = autoTest.sourceFile || 'version.dll';
    const candidates = autoTest.candidates || ['version.dll', 'dxgi.dll', 'winmm.dll', 'dbghelp.dll', 'psapi.dll', 'winhttp.dll'];
    const watchFile = autoTest.watchFile || 'dlss-enabler.ini';
    const timeoutSeconds = autoTest.timeoutSeconds || INI_WAIT_SECONDS;

    // Sürümün indirilip indirilmediğini kontrol et
    let alreadyDownloaded = false;
    const moduleEngine = require('./moduleEngine');
    const existingLocalDir = moduleEngine.findExistingLocalModDir ? moduleEngine.findExistingLocalModDir(manifest, version) : null;
    if (existingLocalDir) {
        versionDir = existingLocalDir;
        alreadyDownloaded = true;
    } else if (fs.existsSync(versionDir)) {
        try {
            const dirFiles = fs.readdirSync(versionDir).map(f => f.toLowerCase());
            if (dirFiles.includes(sourceFile.toLowerCase()) || dirFiles.length > 0) {
                alreadyDownloaded = true;
            }
        } catch (e) {}
    }

    // 1c. Ön koşullar (requires) — normal kurulum (moduleEngine adım 5c) bunu
    // indirmeden ÖNCE uyguluyor. Sihirbaz hiç kontrol etmiyordu; tek başına
    // çalışamayan modüller (ör. bir ReShade eklentisi) sessizce kuruluyordu.
    if (Array.isArray(manifest.requires) && manifest.requires.length > 0) {
        try {
            const requirementChecker = require('./requirementChecker');
            const reqResult = await requirementChecker.checkRequirements(manifest, {
                gameName, exePath, gameDir: targetExeDir
            });
            if (!reqResult.satisfied) {
                const reasons = reqResult.failures.map(f => f.message).join('; ');
                logMsg(event, logPath, 'err', t('errPrereq', { reasons }), '[ERR_006]');
                return { success: false, error: 'PREREQUISITES_NOT_MET', code: 'ERR_006', failures: reqResult.failures, logPath };
            }
            logMsg(event, logPath, 'ok', t('prereqOk'));
        } catch (reqErr) {
            logMsg(event, logPath, 'warn', `Ön koşul kontrolü çalıştırılamadı: ${reqErr.message}`);
        }
    }

    if (!alreadyDownloaded) {
        logMsg(event, logPath, 'info', t('downloading', { version }));
        if (!downloadUrl) {
            logMsg(event, logPath, 'err', t('errDlMissing'), '[ERR_002]');
            return { success: false, error: 'DOWNLOAD_URL_MISSING', code: 'ERR_002' };
        }
        // Manifest tabanlı indirme — her modül kendi mods/<id>/<tag>/ klasörüne iner.
        const dlResult = await moduleEngine.downloadRelease(manifest, version, downloadUrl, event);
        if (!dlResult.success) {
            logMsg(event, logPath, 'err', t('errDlFailed', { err: dlResult.error || 'Bilinmeyen hata' }), '[ERR_002]');
            return { success: false, error: 'DOWNLOAD_FAILED', code: 'ERR_002' };
        }
        if (dlResult.targetDir) {
            versionDir = dlResult.targetDir;
        }
        logMsg(event, logPath, 'ok', t('dlOk'));
    }

    // 2. games.json Snapshot Al (Rollback için)
    const originalGamesState = JSON.parse(JSON.stringify(config.getExistingGamesState()));
    logMsg(event, logPath, 'info', t('snapshot'));

    // DLL listesini sırala (kullanıcının seçtiği DLL en başta olacak şekilde)
    const initialDll = dllName || candidates[0] || 'version.dll';
    const dllsToTry = [initialDll, ...candidates.filter(d => d !== initialDll)];
    logMsg(event, logPath, 'info', t('dllOrder', { order: dllsToTry.join(', ') }));

    let success = false;
    let workingDll = null;

    for (let i = 0; i < dllsToTry.length; i++) {
        if (shouldAbort && shouldAbort()) {
            logMsg(event, logPath, 'warn', 'Kurulum kullanıcı tarafından iptal edildi.');
            return { success: false, error: 'ABORTED' };
        }

        const currentDll = dllsToTry[i];
        const attemptNum = i + 1;
        const totalAttempts = dllsToTry.length;

        logMsg(event, logPath, 'info', t('tryingDll', { n: attemptNum, total: totalAttempts, dll: currentDll }));
        event.sender.send('wizard-log', {
            type: 'dll-attempt',
            data: { attemptIndex: attemptNum, totalAttempts, dllName: currentDll, status: 'trying' }
        });

        // Çakışma kontrolü — manifest conditions üzerinden (enabled:false olanlar atlanır)
        if (Array.isArray(manifest.conditions) && manifest.conditions.length > 0) {
            try {
                const condResult = await conditionChecker.checkConditions(manifest.conditions, {
                    gameName,
                    exePath,
                    gameDir: targetExeDir
                });
                if (!condResult.passed) {
                    for (const f of condResult.failures) {
                        logMsg(event, logPath, 'warn', f.message || t('conflictDetect', { file: f.file || '?' }));
                    }
                }
            } catch (condErr) {
                logMsg(event, logPath, 'warn', `Koşul kontrolü atlandı: ${condErr.message}`);
            }
        }

        // Arşiv kökünü çöz (extractRoot: auto karşılığı) ve kopyalanacak diğer dosyaları listele
        const sourceRoot = resolveSourceRoot(versionDir, sourceFile);
        let otherFiles = [];
        try {
            otherFiles = fs.readdirSync(sourceRoot, { withFileTypes: true })
                .filter(e => e.isFile() && e.name.toLowerCase() !== sourceFile.toLowerCase())
                .map(e => e.name);
        } catch (e) {
            logMsg(event, logPath, 'err', t('errListFolder', { err: e.message }), '[ERR_002]');
            event.sender.send('wizard-log', {
                type: 'dll-attempt',
                data: { attemptIndex: attemptNum, totalAttempts, dllName: currentDll, status: 'failed' }
            });
            continue;
        }

        // Dosyaları kopyala (manifest sourceFile'ı seçilen proxy adına dönüştürülür)
        const copyResult = await copyModFiles(
            sourceRoot,
            targetExeDir,
            sourceFile,
            currentDll,
            manifest.install?.verifyAntiVirusDelayMs ?? 1500,
            manifest
        );
        if (!copyResult.success) {
            logMsg(event, logPath, 'err', t('errCopyFailed', { err: copyResult.error }), '[ERR_002]');
            event.sender.send('wizard-log', {
                type: 'dll-attempt',
                data: { attemptIndex: attemptNum, totalAttempts, dllName: currentDll, status: 'failed' }
            });
            continue;
        }
        logMsg(event, logPath, 'ok', t('copyOk'));

        // Ne kopyalandı / ne kopyalanmadı — normal kurulumdaki ayrıntı düzeyiyle aynı
        for (const line of (copyResult.copied || [])) {
            logMsg(event, logPath, 'ok', t('copiedFile', { file: line }));
        }
        for (const line of (copyResult.backedUp || [])) {
            logMsg(event, logPath, 'info', t('backedUpFile', { file: line }));
        }
        for (const line of (copyResult.skipped || [])) {
            logMsg(event, logPath, 'info', t('skippedFile', { file: line }));
        }

        if (shouldAbort && shouldAbort()) {
            logMsg(event, logPath, 'warn', 'Kurulum kullanıcı tarafından iptal edildi.');
            await rollbackAttempt(event, logPath, t, originalGamesState, targetExeDir, currentDll, otherFiles, watchFile);
            return { success: false, error: 'ABORTED', logPath };
        }

        // games.json geçici güncellemesi
        const targetExeName = game.name;
        const normTargetName = targetExeName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const currentGamesState = config.getExistingGamesState();
        let dbGame = currentGamesState.find(g => {
            if (normTargetName && g.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normTargetName) {
                return true;
            }
            return dlssEnabler.isSameGame(g, exePath);
        });

        const resolvedGameRoot = config.resolveActualGameRoot(targetExeName, exePath) || targetExeDir;

        if (dbGame) {
            if (manifest.state?.flag) dbGame[manifest.state.flag] = true;
            if (manifest.state?.versionField) dbGame[manifest.state.versionField] = version;
            // Manifest pathField tanımlıysa kurulum dizinini de kaydet (ör. streamlinePath)
            if (manifest.state?.pathField) dbGame[manifest.state.pathField] = targetExeDir;
            // upscalers.<alan> — manifest state.upscalerField ile bildirilir
            if (manifest.state?.upscalerField) {
                if (!dbGame.upscalers) dbGame.upscalers = {};
                dbGame.upscalers[manifest.state.upscalerField] = true;
            }
            // Normal kurulum (moduleEngine adım 15) bu kaydı da yazıyor; sihirbaz
            // yazmayınca "Modları Yönet" ekranı ve çakışma/ön koşul kontrolleri
            // modu kurulu saymıyordu.
            if (!dbGame.installedMods) dbGame.installedMods = {};
            dbGame.installedMods[manifest.id] = {
                installed: true,
                version: version,
                installedAt: new Date().toISOString()
            };
            dbGame.exePath = exePath;
        } else {
            const defaultName = game.name || path.basename(targetExeDir);
            dbGame = await scanner.processAndStreamGame({
                name: defaultName,
                exePath: exePath,
                source: game.source || 'manual',
                coverUrl: null
            }, null);
            if (dbGame) {
                if (manifest.state?.flag) dbGame[manifest.state.flag] = true;
                if (manifest.state?.versionField) dbGame[manifest.state.versionField] = version;
                if (manifest.state?.pathField) dbGame[manifest.state.pathField] = targetExeDir;
                if (manifest.state?.upscalerField) {
                    if (!dbGame.upscalers) dbGame.upscalers = {};
                    dbGame.upscalers[manifest.state.upscalerField] = true;
                }
                if (!dbGame.installedMods) dbGame.installedMods = {};
                dbGame.installedMods[manifest.id] = {
                    installed: true,
                    version: version,
                    installedAt: new Date().toISOString()
                };
            }
        }
        config.saveGamesState();
        logMsg(event, logPath, 'ok', t('dbUpdate'));

        if (shouldAbort && shouldAbort()) {
            logMsg(event, logPath, 'warn', 'Kurulum kullanıcı tarafından iptal edildi.');
            await rollbackAttempt(event, logPath, t, originalGamesState, targetExeDir, currentDll, otherFiles, watchFile);
            return { success: false, error: 'ABORTED', logPath };
        }

        // Oyunu Başlat
        logMsg(event, logPath, 'info', t('launching'));
        const launchResult = await launcher.launchGame(dbGame);
        if (!launchResult.success) {
            logMsg(event, logPath, 'err', t('errLaunchFailed', { err: launchResult.error || 'Bilinmeyen hata' }), '[ERR_005]');
            await rollbackAttempt(event, logPath, t, originalGamesState, targetExeDir, currentDll, otherFiles, watchFile);
            event.sender.send('wizard-log', {
                type: 'dll-attempt',
                data: { attemptIndex: attemptNum, totalAttempts, dllName: currentDll, status: 'failed' }
            });
            continue;
        }
        logMsg(event, logPath, 'ok', t('launchOk'));

        if (autoTest.checkProcessRunning !== false) {
            logMsg(event, logPath, 'info', t('checkingGameRunning'));
            let runStatus = await utils.checkGameRunningDetailed(exePath);
            if (runStatus.status === 'not_running') {
                await new Promise(r => setTimeout(r, 1000));
                runStatus = await utils.checkGameRunningDetailed(exePath);
            }

            if (runStatus.status === 'not_running') {
                logMsg(event, logPath, 'err', t('gameNotRunningErr'), '[ERR_005]');
                await terminateProcess(exePath);
                await rollbackAttempt(event, logPath, t, originalGamesState, targetExeDir, currentDll, otherFiles, watchFile);
                event.sender.send('wizard-log', {
                    type: 'dll-attempt',
                    data: { attemptIndex: attemptNum, totalAttempts, dllName: currentDll, status: 'failed' }
                });
                continue;
            }

            if (runStatus.status === 'error') {
                const errMsg = runStatus.error?.message || String(runStatus.error);
                logMsg(event, logPath, 'warn', t('gameRunningCheckErr', { err: errMsg }));
            } else {
                logMsg(event, logPath, 'ok', t('gameRunningOk'));
            }
        }

        // INI İzleme Döngüsü
        let iniFound = false;
        const iniPath = path.join(targetExeDir, watchFile);
        logMsg(event, logPath, 'info', t('watchingIni', { file: watchFile, timeout: timeoutSeconds }));

        const startTime = Date.now();

        for (let sec = 2; sec <= timeoutSeconds; sec += 2) {
            if (shouldAbort && shouldAbort()) {
                logMsg(event, logPath, 'warn', 'Sihirbaz zorla kapatılıyor... Değişiklikler geri alınıyor...');
                await terminateProcess(exePath);
                await rollbackAttempt(event, logPath, t, originalGamesState, targetExeDir, currentDll, otherFiles, watchFile);
                return { success: false, error: 'ABORTED', logPath };
            }

            await new Promise(r => setTimeout(r, 2000));
            const remaining = timeoutSeconds - sec;
            event.sender.send('wizard-log', { type: 'waiting', msg: remaining });

            if (fs.existsSync(iniPath)) {
                logMsg(event, logPath, 'ok', t('iniFound', { file: watchFile, sec }));
                iniFound = true;
                break;
            }
        }

        const durationMs = Date.now() - startTime;

        // Oyunu Kapat
        if (autoTest.autoTerminateGame !== false) {
            logMsg(event, logPath, 'info', t('terminating'));
            const termResult = await terminateProcess(exePath);
            if (termResult.success) {
                logMsg(event, logPath, 'ok', t('terminateOk'));
            } else {
                logMsg(event, logPath, 'warn', t('terminateWarn'), '[ERR_006]');
            }
        }

        if (iniFound) {
            // Preset Uygula
            const targetPreset = developerPreset || wizardConfig.applyPresetOnSuccess;
            if (targetPreset) {
                logMsg(event, logPath, 'info', t('applyingPreset'));
                let presetValues = {};

                // Manifest configs presets kontrolü
                if (manifest.config && Array.isArray(manifest.config)) {
                    for (const cfg of manifest.config) {
                        if (cfg.presets && cfg.presets[targetPreset]) {
                            const pData = cfg.presets[targetPreset];
                            if (pData.values) {
                                for (const [dotKey, val] of Object.entries(pData.values)) {
                                    const parts = dotKey.split('.');
                                    if (parts.length === 2) {
                                        const [sec, k] = parts;
                                        if (!presetValues[sec]) presetValues[sec] = {};
                                        presetValues[sec][k] = val;
                                    }
                                }
                            }
                        }
                    }
                }

                // Fallback default dev-best
                if (Object.keys(presetValues).length === 0 && targetPreset === 'dev-best') {
                    presetValues = {
                        Performance: { MFGOverrideMode: 6, MFGHotkeys: true },
                        UI: { Monitoring: true },
                        GhostBuster: { Enabled: true }
                    };
                }

                try {
                    iniEditor.writeIni(iniPath, presetValues);
                    logMsg(event, logPath, 'ok', t('presetOk'));
                } catch (iniErr) {
                    logMsg(event, logPath, 'err', t('presetErr', { err: iniErr.message }), '[ERR_003]');
                }
            }

            // user-games.json'a kaydet
            try {
                const userGames = config.getUserGames();
                const exePathNorm = path.resolve(exePath).toLowerCase();
                const existingUserKey = Object.keys(userGames).find(k => {
                    const ep = userGames[k].exe_path;
                    return ep && path.resolve(ep).toLowerCase() === exePathNorm;
                });

                if (!existingUserKey) {
                    const normKey = config.normalizeGameKey(dbGame.name);
                    userGames[normKey] = {
                        game_root: resolvedGameRoot,
                        exe_path: exePath,
                        display_name: dbGame.name
                    };
                    config.saveUserGames(userGames);
                    logMsg(event, logPath, 'ok', t('userGamesOk'));
                }
            } catch (userGamesErr) {
                logMsg(event, logPath, 'warn', t('userGamesErr', { err: userGamesErr.message }));
            }

            success = true;
            workingDll = currentDll;
            event.sender.send('wizard-log', {
                type: 'dll-attempt',
                data: { attemptIndex: attemptNum, totalAttempts, dllName: currentDll, status: 'ok', durationMs }
            });
            break;
        } else {
            logMsg(event, logPath, 'err', t('iniNotFoundErr', { file: watchFile, dll: currentDll, timeout: timeoutSeconds }), '[ERR_003]');
            event.sender.send('wizard-log', {
                type: 'dll-attempt',
                data: { attemptIndex: attemptNum, totalAttempts, dllName: currentDll, status: 'failed', durationMs }
            });

            await rollbackAttempt(event, logPath, t, originalGamesState, targetExeDir, currentDll, otherFiles, watchFile);
        }
    }

    if (success) {
        logMsg(event, logPath, 'ok', t('successHeader'));
        logMsg(event, logPath, 'info', t('successDll', { dll: workingDll }));
        logMsg(event, logPath, 'info', t('logSaved', { path: logPath }));
        return { success: true, workingDll, logPath, games: config.getExistingGamesState() };
    } else {
        logMsg(event, logPath, 'err', t('errAllFailed'), '[ERR_004]');
        logMsg(event, logPath, 'info', t('logSaved', { path: logPath }));
        return { success: false, error: 'ALL_DLLS_FAILED', code: 'ERR_004', logPath };
    }
}

async function getWizardLogsInfo() {
    return dlssEnabler.getWizardLogsInfo ? dlssEnabler.getWizardLogsInfo() : { count: 0, sizeBytes: 0 };
}

async function clearWizardLogs() {
    return dlssEnabler.clearWizardLogs ? dlssEnabler.clearWizardLogs() : { success: true };
}

async function openWizardLogsDir() {
    const parentDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }
    try {
        await shell.openPath(parentDir);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

module.exports = {
    runModuleWizard,
    getWizardLogsInfo,
    clearWizardLogs,
    openWizardLogsDir
};
