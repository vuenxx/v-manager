const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { exec } = require('child_process');

const config = require('../config');
const scanner = require('../scanner');
const utils = require('../utils');
const dlssEnabler = require('./dlssEnabler');
const iniEditor = require('./iniEditor');
const launcher = require('./launcher');

// Desteklenen DLL isimleri sırası
const DLL_ORDER = ['version.dll', 'dxgi.dll', 'winmm.dll', 'dbghelp.dll', 'psapi.dll', 'winhttp.dll'];
const INI_WAIT_SECONDS = 10;

const MESSAGES = {
    tr: {
        start: '=== DLSS Enabler Sihirbazı Başlatıldı ===',
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
        dbUpdate: 'games.json geçici olarak güncellendi.',
        launching: 'Oyun başlatılıyor...',
        errLaunchFailed: 'Oyun başlatılamadı: {err}',
        launchOk: 'Oyun başlatıldı.',
        checkingGameRunning: 'Oyunun gorev yoneticisinde calisip calismadigi kontrol ediliyor...',
        gameRunningOk: 'Oyun gorev yoneticisinde calisiyor.',
        gameNotRunningErr: 'Oyun gorev yoneticisinde calisir durumda gorunmedi.',
        gameRunningCheckErr: 'Görev yöneticisi kontrolünde hata oluştu (erişim engellendi veya sorgulanamadı): {err}. Yine de .ini kontrolüne devam ediliyor.',
        watchingIni: 'dlss-enabler.ini oluşumu izreniyor (maks. 10 saniye)...',
        iniFound: '[{sec}s] dlss-enabler.ini dosyası başarıyla oluşturuldu!',
        terminating: 'Oyun sonlandırılıyor...',
        terminateOk: 'Oyun başarıyla kapatıldı.',
        terminateWarn: 'Oyun kapatılamadı veya zaten kapalıydı.',
        presetApplying: 'Ön ayar uygulanıyor...',
        presetOk: 'Geliştirici ön ayarı başarıyla uygulandı.',
        presetErr: 'Ön ayar uygulanamadı: {err}',
        userGamesOk: 'EXE yolu kullanıcı oyunlarına kaydedildi.',
        userGamesErr: 'Oyun yolu user-games.json dosyasına kaydedilemedi: {err}',
        iniNotFoundErr: '{dll} ile 10 saniye sonunda dlss-enabler.ini oluşmadı.',
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
        start: '=== DLSS Enabler Wizard Started ===',
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
        dbUpdate: 'games.json updated temporarily.',
        launching: 'Launching game...',
        errLaunchFailed: 'Could not launch game: {err}',
        launchOk: 'Game launched.',
        checkingGameRunning: 'Checking whether the game is running in Task Manager...',
        gameRunningOk: 'Game is running in Task Manager.',
        gameNotRunningErr: 'The game does not appear to be running in Task Manager.',
        gameRunningCheckErr: 'An error occurred during Task Manager check (access denied or query failed): {err}. Continuing with .ini check regardless.',
        watchingIni: 'Watching for dlss-enabler.ini generation (max 10 seconds)...',
        iniFound: '[{sec}s] dlss-enabler.ini file created successfully!',
        terminating: 'Terminating game...',
        terminateOk: 'Game closed successfully.',
        terminateWarn: 'Could not close game or it was already closed.',
        applyingPreset: 'Applying preset...',
        presetOk: 'Developer preset applied successfully.',
        presetErr: 'Could not apply preset: {err}',
        userGamesOk: 'EXE path saved to User Games.',
        userGamesErr: 'Could not save game path to user-games.json: {err}',
        iniNotFoundErr: 'dlss-enabler.ini was not created with {dll} after 10 seconds.',
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
        console.error('[DLSS WIZARD] Log dosyasına yazılamadı:', e);
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

function cleanupCopiedDlssFiles(targetExeDir, currentDll, otherFiles) {
    const filesToRemove = new Set([currentDll, ...otherFiles, 'dlss-enabler.ini', 'dlss-enabler.log']);
    for (const file of filesToRemove) {
        const targetFile = path.join(targetExeDir, file);
        if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
    }
}

async function rollbackDlssAttempt(event, logPath, t, originalGamesState, targetExeDir, currentDll, otherFiles) {
    logMsg(event, logPath, 'info', t('rollback'));
    try {
        cleanupCopiedDlssFiles(targetExeDir, currentDll, otherFiles);
        logMsg(event, logPath, 'info', t('rollbackCleaned'));
    } catch (cleanupErr) {
        logMsg(event, logPath, 'warn', t('rollbackCleanErr', { err: cleanupErr.message }));
    }

    config.setExistingGamesState(JSON.parse(JSON.stringify(originalGamesState)));
    config.saveGamesState();
    logMsg(event, logPath, 'info', t('rollbackDb'));
}

async function runDlssWizard(event, { game, version, dllName, downloadUrl, developerPreset, exePath, lang }, shouldAbort) {
    const activeLang = lang === 'en' ? 'en' : 'tr';
    
    const t = (key, params = {}) => {
        const locale = MESSAGES[activeLang] || MESSAGES['tr'];
        let str = locale[key] || MESSAGES['tr'][key] || key;
        for (const [k, v] of Object.entries(params)) {
            str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
        }
        return str;
    };

    const gameObj = (typeof game === 'object' && game !== null) ? game : { name: (typeof game === 'string' ? game : 'Game') };
    const gameName = gameObj.name || '';
    version = version || gameObj.dlssEnablerVersion || 'latest';
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

    // 1. Log Dosyası Hazırlığı
    const logsDir = path.join(app.getPath('userData'), 'logs', 'dlss-enabler-wizard');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    const date = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
    const logPath = path.join(logsDir, `dlss-wizard-${timestamp}.log`);

    logMsg(event, logPath, 'info', t('start'));
    logMsg(event, logPath, 'info', t('game', { name: gameName || 'Game' }));
    logMsg(event, logPath, 'info', t('exe', { path: exePath || 'None' }));
    logMsg(event, logPath, 'info', t('platform', { platform: gameObj.source || 'Unknown' }));
    logMsg(event, logPath, 'info', t('version', { version }));

    if (!exePath || !fs.existsSync(exePath) || fs.statSync(exePath).isDirectory()) {
        logMsg(event, logPath, 'err', t('errExeNotFound'), '[ERR_001]');
        return { success: false, error: 'EXE_NOT_FOUND', code: 'ERR_001' };
    }

    const targetExeDir = path.dirname(exePath);
    const versionDir = path.join(config.modsPath, 'dlssenabler', version);

    // Sürümün indirilip indirilmediğini kontrol et
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
        logMsg(event, logPath, 'info', t('downloading', { version }));
        if (!downloadUrl) {
            logMsg(event, logPath, 'err', t('errDlMissing'), '[ERR_002]');
            return { success: false, error: 'DOWNLOAD_URL_MISSING', code: 'ERR_002' };
        }
        const dlResult = await dlssEnabler.downloadDlssEnablerRelease(event, { name: version, downloadUrl });
        if (!dlResult.success) {
            logMsg(event, logPath, 'err', t('errDlFailed', { err: dlResult.error || 'Bilinmeyen hata' }), '[ERR_002]');
            return { success: false, error: 'DOWNLOAD_FAILED', code: 'ERR_002' };
        }
        logMsg(event, logPath, 'ok', t('dlOk'));
    }

    // 2. games.json Snapshot Al (Rollback için)
    const originalGamesState = JSON.parse(JSON.stringify(config.getExistingGamesState()));
    logMsg(event, logPath, 'info', t('snapshot'));

    // DLL listesini sırala (kullanıcının seçtiği DLL en başta olacak şekilde)
    const initialDll = dllName || 'version.dll';
    const dllsToTry = [initialDll, ...DLL_ORDER.filter(d => d !== initialDll)];
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

        // Konflikt (çakışma) kontrolü yapalım
        const conflictCheck = await dlssEnabler.checkConflicts(targetExeDir);
        if (conflictCheck.conflict) {
            logMsg(event, logPath, 'warn', t('conflictDetect', { file: conflictCheck.file }));
        }

        // Kopyalanacak dosyaları listele
        let otherFiles = [];
        try {
            otherFiles = fs.readdirSync(versionDir).filter(f => f.toLowerCase() !== 'version.dll');
        } catch (e) {
            logMsg(event, logPath, 'err', t('errListFolder', { err: e.message }), '[ERR_002]');
            event.sender.send('wizard-log', {
                type: 'dll-attempt',
                data: { attemptIndex: attemptNum, totalAttempts, dllName: currentDll, status: 'failed' }
            });
            continue;
        }

        // Dosyaları kopyala
        const copyResult = await dlssEnabler.copyDlssFiles(versionDir, targetExeDir, currentDll);
        if (!copyResult.success) {
            logMsg(event, logPath, 'err', t('errCopyFailed', { err: copyResult.error }), '[ERR_002]');
            event.sender.send('wizard-log', {
                type: 'dll-attempt',
                data: { attemptIndex: attemptNum, totalAttempts, dllName: currentDll, status: 'failed' }
            });
            continue;
        }
        logMsg(event, logPath, 'ok', t('copyOk'));

        if (shouldAbort && shouldAbort()) {
            logMsg(event, logPath, 'warn', 'Kurulum kullanici tarafindan iptal edildi.');
            await rollbackDlssAttempt(event, logPath, t, originalGamesState, targetExeDir, currentDll, otherFiles);
            return { success: false, error: 'ABORTED', logPath };
        }

        // games.json güncellemesi (geçici - bu DLL için)
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
            dbGame.hasDlssEnabler = true;
            dbGame.dlssEnablerVersion = version;
            dbGame.dlssEnablerPath = targetExeDir;
            if (!dbGame.upscalers) dbGame.upscalers = { dlss: false, xess: false, fsr: false, dlssEnabler: true };
            else dbGame.upscalers.dlssEnabler = true;
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
                dbGame.hasDlssEnabler = true;
                dbGame.dlssEnablerVersion = version;
                dbGame.dlssEnablerPath = targetExeDir;
                if (!dbGame.upscalers) dbGame.upscalers = { dlss: false, xess: false, fsr: false, dlssEnabler: true };
                else dbGame.upscalers.dlssEnabler = true;
            }
        }
        config.saveGamesState();
        logMsg(event, logPath, 'ok', t('dbUpdate'));

        if (shouldAbort && shouldAbort()) {
            logMsg(event, logPath, 'warn', 'Kurulum kullanici tarafindan iptal edildi.');
            await rollbackDlssAttempt(event, logPath, t, originalGamesState, targetExeDir, currentDll, otherFiles);
            return { success: false, error: 'ABORTED', logPath };
        }

        // Oyunu Başlat
        logMsg(event, logPath, 'info', t('launching'));
        const launchResult = await launcher.launchGame(dbGame);
        if (!launchResult.success) {
            logMsg(event, logPath, 'err', t('errLaunchFailed', { err: launchResult.error || 'Bilinmeyen hata' }), '[ERR_005]');
            
            // Rollback files and restore games.json
            await rollbackDlssAttempt(event, logPath, t, originalGamesState, targetExeDir, currentDll, otherFiles);

            event.sender.send('wizard-log', {
                type: 'dll-attempt',
                data: { attemptIndex: attemptNum, totalAttempts, dllName: currentDll, status: 'failed' }
            });
            continue;
        }
        logMsg(event, logPath, 'ok', t('launchOk'));

        logMsg(event, logPath, 'info', t('checkingGameRunning'));
        let runStatus = await utils.checkGameRunningDetailed(exePath);
        if (runStatus.status === 'not_running') {
            await new Promise(r => setTimeout(r, 1000));
            runStatus = await utils.checkGameRunningDetailed(exePath);
        }

        if (runStatus.status === 'not_running') {
            logMsg(event, logPath, 'err', t('gameNotRunningErr'), '[ERR_005]');
            await terminateProcess(exePath);
            await rollbackDlssAttempt(event, logPath, t, originalGamesState, targetExeDir, currentDll, otherFiles);
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

        // dlss-enabler.ini Kontrol Loopu (10 saniye, her 2 saniyede bir)
        let iniFound = false;
        const iniPath = path.join(targetExeDir, 'dlss-enabler.ini');
        logMsg(event, logPath, 'info', t('watchingIni'));

        const startTime = Date.now();

        for (let sec = 2; sec <= INI_WAIT_SECONDS; sec += 2) {
            if (shouldAbort && shouldAbort()) {
                logMsg(event, logPath, 'warn', 'Sihirbaz zorla kapatılıyor... Değişiklikler geri alınıyor...');
                await terminateProcess(exePath);
                await rollbackDlssAttempt(event, logPath, t, originalGamesState, targetExeDir, currentDll, otherFiles);
                return { success: false, error: 'ABORTED', logPath };
            }

            // 2 saniye bekle
            await new Promise(r => setTimeout(r, 2000));
            const remaining = INI_WAIT_SECONDS - sec;
            event.sender.send('wizard-log', { type: 'waiting', msg: remaining });

            if (fs.existsSync(iniPath)) {
                logMsg(event, logPath, 'ok', t('iniFound', { sec }));
                iniFound = true;
                break;
            }
        }

        const durationMs = Date.now() - startTime;

        // Her durumda oyunu kapat
        logMsg(event, logPath, 'info', t('terminating'));
        const termResult = await terminateProcess(exePath);
        if (termResult.success) {
            logMsg(event, logPath, 'ok', t('terminateOk'));
        } else {
            logMsg(event, logPath, 'warn', t('terminateWarn'), '[ERR_006]');
        }

        if (iniFound) {
            // Preset Uygula
            logMsg(event, logPath, 'info', t('applyingPreset'));
            let presetValues = {};
            if (developerPreset === 'dev-best') {
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

            // user-games.json'a kaydet (eğer daha önce yoksa)
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
            logMsg(event, logPath, 'err', t('iniNotFoundErr', { dll: currentDll }), '[ERR_003]');
            event.sender.send('wizard-log', {
                type: 'dll-attempt',
                data: { attemptIndex: attemptNum, totalAttempts, dllName: currentDll, status: 'failed', durationMs }
            });

            // Bu DLL denemesi basarisiz oldu, dosyalari sil ve games.json'u geri yukle
            await rollbackDlssAttempt(event, logPath, t, originalGamesState, targetExeDir, currentDll, otherFiles);
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
    const parentDir = path.join(app.getPath('userData'), 'logs');
    const dlssLogsDir = path.join(parentDir, 'dlss-enabler-wizard');
    const optiLogsDir = path.join(parentDir, 'optiscaler-wizard');
    let count = 0;
    let sizeBytes = 0;

    const scanDir = async (dir, prefix) => {
        try {
            if (fs.existsSync(dir)) {
                const files = await fs.promises.readdir(dir);
                for (const file of files) {
                    if (file.startsWith(prefix) && file.endsWith('.log')) {
                        const stats = await fs.promises.stat(path.join(dir, file));
                        count++;
                        sizeBytes += stats.size;
                    }
                }
            }
        } catch (e) {
            console.error(`[DLSS WIZARD] Error scanning dir ${dir}:`, e);
        }
    };

    await scanDir(dlssLogsDir, 'dlss-wizard-');
    await scanDir(optiLogsDir, 'opti-wizard-');
    return { count, sizeBytes };
}

async function clearWizardLogs() {
    const parentDir = path.join(app.getPath('userData'), 'logs');
    const dlssLogsDir = path.join(parentDir, 'dlss-enabler-wizard');
    const optiLogsDir = path.join(parentDir, 'optiscaler-wizard');

    const clearDir = async (dir, prefix) => {
        if (fs.existsSync(dir)) {
            const files = await fs.promises.readdir(dir);
            for (const file of files) {
                if (file.startsWith(prefix) && file.endsWith('.log')) {
                    await fs.promises.unlink(path.join(dir, file));
                }
            }
        }
    };

    try {
        await clearDir(dlssLogsDir, 'dlss-wizard-');
        await clearDir(optiLogsDir, 'opti-wizard-');
        return { success: true };
    } catch (e) {
        console.error('[DLSS WIZARD] Loglar temizlenirken hata:', e);
        return { success: false, error: e.message };
    }
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
        console.error('[DLSS WIZARD] Log klasörü açılırken hata:', e);
        return { success: false, error: e.message };
    }
}

module.exports = {
    runDlssWizard,
    getWizardLogsInfo,
    clearWizardLogs,
    openWizardLogsDir
};
