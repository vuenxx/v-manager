const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const config = require('../config');
const scanner = require('../scanner');
const utils = require('../utils');
const optiScaler = require('./optiScaler');
const optiPatcher = require('./optiPatcher');
const fsr4Files = require('./fsr4Files');

const MESSAGES = {
    tr: {
        start: '=== OptiScaler Sihirbazı Başlatıldı ===',
        game: 'Oyun: {name}',
        exe: 'Seçilen EXE: {path}',
        version: 'OptiScaler Sürümü: {version}',
        injection: 'Enjeksiyon Tipi: {type}',
        patcher: 'OptiPatcher Kurulsun mu: {opt}',
        fsr4: 'FSR4 INT8 Kurulsun mu: {opt}',
        yes: 'Evet',
        no: 'Hayır',
        errPaths: 'Oyun yolları çözülemedi.',
        errExeNotFound: 'Oyun EXE dosyası bulunamadı: "{path}"',
        targetDir: 'Hedef dizin: {dir}',
        dx12Analyze: 'DirectX 12 desteği analiz ediliyor...',
        dx12NoSupport: 'DirectX 12 desteği tespit edilemedi for "{path}".',
        dx12Ok: 'DirectX 12 desteği doğrulandı.',
        dx12Bypass: 'DirectX 12 kontrolü kullanıcı tarafından bypass edildi.',
        errGameRunning: 'Oyun şu an açık. Kurulum yapılamaz.',
        snapshot: 'Geri yükleme noktası oluşturuldu.',
        cached: 'OptiScaler sürümü yerel depolamada zaten mevcut, tekrar indirilmeyecek.',
        downloading: 'OptiScaler {version} indiriliyor...',
        errDlMissing: 'OptiScaler indirme linki bulunamadı.',
        errDlFailed: 'OptiScaler indirilemedi: {err}',
        dlOk: 'OptiScaler başarıyla indirildi.',
        copying: 'OptiScaler dosyaları kopyalanıyor...',
        errCopyFailed: 'OptiScaler dosyaları kopyalanamadı: {err}',
        copyOk: 'OptiScaler dosyaları başarıyla kopyalandı.',
        dllRename: 'Enjeksiyon DLL ismi değiştiriliyor: OptiScaler.dll -> {injection}',
        dllRenameOk: 'Enjeksiyon DLL\'i ayarlandı: {injection}',
        errDllRenameFailed: 'DLL ismi değiştirilirken hata: {err}',
        installPatcher: 'OptiPatcher {version} kuruluyor...',
        patcherDownloading: 'OptiPatcher indiriliyor...',
        patcherOk: 'OptiPatcher.asi plugins klasörüne kopyalandı.',
        patcherIniOk: 'OptiScaler.ini LoadAsiPlugins=true olarak güncellendi.',
        patcherErr: 'OptiPatcher kurulamadı (Kurulumu engellemez): {err}',
        installFsr4: 'FSR4 INT8 {version} kuruluyor...',
        fsr4Downloading: 'FSR4 INT8 indiriliyor...',
        fsr4Ok: 'FSR4 INT8 dosyaları başarıyla kopyalandı.',
        fsr4Err: 'FSR4 INT8 kurulamadı (Kurulumu engellemez): {err}',
        updatingGames: 'games.json güncelleniyor...',
        updatingGamesOk: 'games.json başarıyla güncellendi.',
        userGamesOk: 'Oyun yolu kullanıcı oyun yollarına (user-games.json) kaydedildi.',
        userGamesErr: 'user-games.json güncellenemedi: {err}',
        presetApplying: 'OptiScaler için geliştirici ön ayarı (dev-opti-fg) uygulanıyor...',
        presetOk: 'Geliştirici ön ayarı başarıyla uygulandı.',
        presetAppliedLog: 'Ön ayar uygulandı.',
        presetErr: 'Geliştirici ön ayarı uygulanamadı: {err}',
        errCritical: 'Kurulum sırasında kritik hata oluştu: {err}',
        rollback: 'Kurulum geri alınıyor...',
        rollbackFiles: 'Kopyalanan dosyalar silindi.',
        rollbackFilesErr: 'Dosyalar temizlenirken hata oluştu: {err}',
        rollbackDb: 'games.json eski haline getirildi.',
        rollbackDbErr: 'games.json eski haline getirilemedi: {err}',
        successHeader: '=== KURULUM BAŞARILI ===',
        successFooter: 'Kurulum başarılı.',
        logSaved: 'Log dosyası kaydedildi: {path}'
    },
    en: {
        start: '=== OptiScaler Wizard Started ===',
        game: 'Game: {name}',
        exe: 'Selected EXE: {path}',
        version: 'OptiScaler Version: {version}',
        injection: 'Injection Type: {type}',
        patcher: 'Install OptiPatcher: {opt}',
        fsr4: 'Install FSR4 INT8: {opt}',
        yes: 'Yes',
        no: 'No',
        errPaths: 'Could not resolve game paths.',
        errExeNotFound: 'Game EXE file not found: "{path}"',
        targetDir: 'Target directory: {dir}',
        dx12Analyze: 'Analyzing DirectX 12 support...',
        dx12NoSupport: 'DirectX 12 support was not detected for "{path}".',
        dx12Ok: 'DirectX 12 support verified.',
        dx12Bypass: 'DirectX 12 check was bypassed by the user.',
        errGameRunning: 'Game is currently running. Installation cannot proceed.',
        snapshot: 'Restore point created.',
        cached: 'OptiScaler version already exists in local storage, will not re-download.',
        downloading: 'Downloading OptiScaler {version}...',
        errDlMissing: 'OptiScaler download link not found.',
        errDlFailed: 'Could not download OptiScaler: {err}',
        dlOk: 'OptiScaler downloaded successfully.',
        copying: 'Copying OptiScaler files...',
        errCopyFailed: 'Could not copy OptiScaler files: {err}',
        copyOk: 'OptiScaler files copied successfully.',
        dllRename: 'Renaming injection DLL: OptiScaler.dll -> {injection}',
        dllRenameOk: 'Injection DLL configured: {injection}',
        errDllRenameFailed: 'Error renaming DLL: {err}',
        installPatcher: 'Installing OptiPatcher {version}...',
        patcherDownloading: 'Downloading OptiPatcher...',
        patcherOk: 'OptiPatcher.asi copied to plugins directory.',
        patcherIniOk: 'OptiScaler.ini updated with LoadAsiPlugins=true.',
        patcherErr: 'Could not install OptiPatcher (Does not prevent installation): {err}',
        installFsr4: 'Installing FSR4 INT8 {version}...',
        fsr4Downloading: 'Downloading FSR4 INT8...',
        fsr4Ok: 'FSR4 INT8 files copied successfully.',
        fsr4Err: 'Could not install FSR4 INT8 (Does not prevent installation): {err}',
        updatingGames: 'Updating games.json...',
        updatingGamesOk: 'games.json updated successfully.',
        userGamesOk: 'Game path saved to User Game Paths (user-games.json).',
        userGamesErr: 'Could not update user-games.json: {err}',
        presetApplying: 'Applying developer preset (dev-opti-fg) for OptiScaler...',
        presetOk: 'Developer preset applied successfully.',
        presetAppliedLog: 'Preset applied.',
        presetErr: 'Could not apply developer preset: {err}',
        errCritical: 'A critical error occurred during installation: {err}',
        rollback: 'Rolling back installation...',
        rollbackFiles: 'Copied files deleted.',
        rollbackFilesErr: 'Error cleaning up files: {err}',
        rollbackDb: 'games.json reverted to previous state.',
        rollbackDbErr: 'Could not revert games.json: {err}',
        successHeader: '=== INSTALLATION SUCCESSFUL ===',
        successFooter: 'Installation successful.',
        logSaved: 'Log file saved: {path}'
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
        console.error('[OPTI WIZARD] Log dosyasına yazılamadı:', e);
    }

    if (event && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('opti-wizard-log', { type, msg, code });
    }
}

async function runOptiWizard(event, { game, version, tag, downloadUrl, injection, isAuto, installOptiPatcher, optiPatcherTag, optiPatcherUrl, installFsr4, fsr4Name, fsr4Url, exePath, bypassDx12Check, lang }, shouldAbort) {
    const activeLang = lang === 'en' ? 'en' : 'tr';
    
    const t = (key, params = {}) => {
        const locale = MESSAGES[activeLang] || MESSAGES['tr'];
        let str = locale[key] || MESSAGES['tr'][key] || key;
        for (const [k, v] of Object.entries(params)) {
            str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
        }
        return str;
    };

    // 1. Log Dosyası Hazırlığı
    const logsDir = path.join(app.getPath('userData'), 'logs', 'optiscaler-wizard');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    const date = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
    const logPath = path.join(logsDir, `opti-wizard-${timestamp}.log`);

    logMsg(event, logPath, 'info', t('start'));
    logMsg(event, logPath, 'info', t('game', { name: game.name }));
    logMsg(event, logPath, 'info', t('exe', { path: exePath || 'Kayıtlı Yol' }));
    logMsg(event, logPath, 'info', t('version', { version: tag }));
    logMsg(event, logPath, 'info', t('injection', { type: injection }));
    logMsg(event, logPath, 'info', t('patcher', { opt: installOptiPatcher ? `${t('yes')} (${optiPatcherTag})` : t('no') }));
    logMsg(event, logPath, 'info', t('fsr4', { opt: installFsr4 ? `${t('yes')} (${fsr4Name})` : t('no') }));

    // 2. Hedef Klasörlerin Çözülmesi
    let targetExePath = exePath;
    if (isAuto) {
        const paths = config.getGamePaths(game.name, game.exePath);
        if (!paths || !paths.exe_path) {
            logMsg(event, logPath, 'err', t('errPaths'), '[ERR_001]');
            return { success: false, error: t('errPaths'), code: 'ERR_001' };
        }
        targetExePath = paths.exe_path;
    }

    if (!targetExePath || !fs.existsSync(targetExePath)) {
        logMsg(event, logPath, 'err', t('errExeNotFound', { path: targetExePath }), '[ERR_001]');
        return { success: false, error: 'EXE_NOT_FOUND', code: 'ERR_001' };
    }

    const targetExeDir = path.dirname(targetExePath);
    logMsg(event, logPath, 'info', t('targetDir', { dir: targetExeDir }));

    let exeToCheck = targetExePath;
    try {
        const exes = fs.readdirSync(targetExeDir).filter(f => f.toLowerCase().endsWith('.exe'));
        if (exes.length > 0) exeToCheck = path.join(targetExeDir, exes[0]);
    } catch (e) { }

    // 3. DirectX 12 Kontrolü (Bypass edilmemişse)
    if (!bypassDx12Check) {
        logMsg(event, logPath, 'info', t('dx12Analyze'));
        const support = await utils.checkDx12Support(exeToCheck);
        if (!support.hasDx12) {
            logMsg(event, logPath, 'warn', t('dx12NoSupport', { path: exeToCheck }), '[WARN_DX12]');
            return { success: false, error: 'DX12_NOT_SUPPORTED', code: 'WARN_DX12' };
        }
        logMsg(event, logPath, 'ok', t('dx12Ok'));
    } else {
        logMsg(event, logPath, 'warn', t('dx12Bypass'));
    }

    // 4. Oyunun Çalışma Durumu Kontrolü
    const running = await utils.isGameRunning(exeToCheck);
    if (running) {
        logMsg(event, logPath, 'err', t('errGameRunning'), '[ERR_005]');
        return { success: false, error: 'GAME_RUNNING', code: 'ERR_005' };
    }

    // 5. games.json Snapshot Al (Rollback için)
    const originalGamesState = JSON.parse(JSON.stringify(config.getExistingGamesState()));
    logMsg(event, logPath, 'info', t('snapshot'));

    // Kopyalanacak dosyaları takip edeceğimiz liste (Hata durumunda rollback için)
    const copiedFilesList = [];
    const copiedDirsList = [];
    let optiPatcherInstalled = false;
    let fsr4Installed = false;

    try {
        if (shouldAbort && shouldAbort()) throw new Error('ABORTED');
        // 6. OptiScaler İndirme & Kopyalama
        const versionDir = path.join(config.modsPath, 'optiscaler', tag);
        let alreadyDownloaded = false;
        if (fs.existsSync(versionDir)) {
            try {
                const criticalFiles = ['OptiScaler.dll', 'OptiScaler.ini'];
                const dirFiles = fs.readdirSync(versionDir).map(f => f.toLowerCase());
                const hasCritical = criticalFiles.some(cf => dirFiles.includes(cf.toLowerCase()));
                if (hasCritical) alreadyDownloaded = true;
            } catch (e) { }
        }

        if (!alreadyDownloaded) {
            logMsg(event, logPath, 'info', t('downloading', { version: tag }));
            if (!downloadUrl) {
                logMsg(event, logPath, 'err', t('errDlMissing'), '[ERR_002]');
                throw new Error(t('errDlMissing'));
            }
            const dlResult = await optiScaler.downloadOptiScalerRelease(event, { tag, downloadUrl });
            if (!dlResult.success) {
                logMsg(event, logPath, 'err', t('errDlFailed', { err: dlResult.error }), '[ERR_002]');
                throw new Error(t('errDlFailed', { err: dlResult.error }));
            }
            logMsg(event, logPath, 'ok', t('dlOk'));
        } else {
            logMsg(event, logPath, 'info', t('cached'));
        }

        if (shouldAbort && shouldAbort()) throw new Error('ABORTED');

        // Dosyaları kopyala
        logMsg(event, logPath, 'info', t('copying'));
        try {
            function copyRecursiveSync(srcPath, destPath, isTopLevel = false) {
                const stats = fs.statSync(srcPath);
                if (stats.isDirectory()) {
                    const exists = fs.existsSync(destPath);
                    if (!exists) {
                        fs.mkdirSync(destPath, { recursive: true });
                        if (isTopLevel) {
                            copiedDirsList.push(destPath);
                        }
                    }
                    const files = fs.readdirSync(srcPath);
                    for (const file of files) {
                        copyRecursiveSync(path.join(srcPath, file), path.join(destPath, file), !exists && isTopLevel);
                    }
                } else {
                    fs.copyFileSync(srcPath, destPath);
                    copiedFilesList.push(destPath);
                }
            }

            const filesToCopy = fs.readdirSync(versionDir);
            for (const file of filesToCopy) {
                copyRecursiveSync(path.join(versionDir, file), path.join(targetExeDir, file), true);
            }
            logMsg(event, logPath, 'ok', t('copyOk'));
        } catch (e) {
            logMsg(event, logPath, 'err', t('errCopyFailed', { err: e.message }), '[ERR_002]');
            throw new Error(t('errCopyFailed', { err: e.message }));
        }

        // DLL Enjeksiyon ismini değiştirme (OptiScaler.dll -> [injection])
        const optiDllSrc = path.join(targetExeDir, 'OptiScaler.dll');
        if (fs.existsSync(optiDllSrc) && injection && injection !== 'OptiScaler.dll') {
            logMsg(event, logPath, 'info', t('dllRename', { injection }));
            const targetDllPath = path.join(targetExeDir, injection);
            try {
                if (fs.existsSync(targetDllPath)) {
                    fs.unlinkSync(targetDllPath);
                }
                try {
                    fs.renameSync(optiDllSrc, targetDllPath);
                } catch (renameErr) {
                    if (renameErr.code === 'EXDEV') {
                        fs.copyFileSync(optiDllSrc, targetDllPath);
                        fs.unlinkSync(optiDllSrc);
                    } else {
                        throw renameErr;
                    }
                }
                copiedFilesList.push(targetDllPath);
                logMsg(event, logPath, 'ok', t('dllRenameOk', { injection }));
            } catch (e) {
                logMsg(event, logPath, 'err', t('errDllRenameFailed', { err: e.message }), '[ERR_002]');
                throw new Error(t('errDllRenameFailed', { err: e.message }));
            }
        }

        if (shouldAbort && shouldAbort()) throw new Error('ABORTED');

        // 7. OptiPatcher (İsteğe bağlı)
        if (installOptiPatcher && optiPatcherTag) {
            logMsg(event, logPath, 'info', t('installPatcher', { version: optiPatcherTag }));
            try {
                const asiPath = path.join(config.modsPath, 'OptiPatcher', optiPatcherTag, 'OptiPatcher.asi');
                if (!fs.existsSync(asiPath)) {
                    if (!optiPatcherUrl) throw new Error(t('errDlMissing'));
                    logMsg(event, logPath, 'info', t('patcherDownloading'));
                    const dlResult = await optiPatcher.downloadOptiPatcherRelease(event, { tag: optiPatcherTag, downloadUrl: optiPatcherUrl });
                    if (!dlResult.success) throw new Error(dlResult.error || t('errDlFailed', { err: 'Error' }));
                }

                const pluginsDir = path.join(targetExeDir, 'plugins');
                fs.mkdirSync(pluginsDir, { recursive: true });
                const destAsi = path.join(pluginsDir, 'OptiPatcher.asi');
                fs.copyFileSync(asiPath, destAsi);
                copiedFilesList.push(destAsi);
                logMsg(event, logPath, 'ok', t('patcherOk'));

                // OptiScaler.ini LoadAsiPlugins=true güncellemesi
                const iniPath = path.join(targetExeDir, 'OptiScaler.ini');
                if (fs.existsSync(iniPath)) {
                    let iniContent = fs.readFileSync(iniPath, 'utf8');
                    const updated = iniContent.replace(
                        /(LoadAsiPlugins\s*=\s*)auto/i,
                        '$1true'
                    );
                    if (updated !== iniContent) {
                        fs.writeFileSync(iniPath, updated, 'utf8');
                        logMsg(event, logPath, 'ok', t('patcherIniOk'));
                    }
                }
                optiPatcherInstalled = true;
            } catch (e) {
                logMsg(event, logPath, 'warn', t('patcherErr', { err: e.message }));
            }
        }

        if (shouldAbort && shouldAbort()) throw new Error('ABORTED');

        // 8. FSR4 INT8 (İsteğe bağlı)
        if (installFsr4 && fsr4Name) {
            logMsg(event, logPath, 'info', t('installFsr4', { version: fsr4Name }));
            try {
                const fsr4Dir = path.join(config.modsPath, 'fsr4files', fsr4Name);
                const isDownloaded = fs.existsSync(fsr4Dir) && (() => {
                    try { return fs.readdirSync(fsr4Dir).length > 0; } catch (e) { return false; }
                })();

                if (!isDownloaded) {
                    if (!fsr4Url) throw new Error(t('errDlMissing'));
                    logMsg(event, logPath, 'info', t('fsr4Downloading'));
                    const dlResult = await fsr4Files.downloadFsr4Release(event, { name: fsr4Name, downloadUrl: fsr4Url });
                    if (!dlResult.success) throw new Error(dlResult.error || t('errDlFailed', { err: 'Error' }));
                }

                const dllFiles = fs.readdirSync(fsr4Dir).filter(f => f.toLowerCase().endsWith('.dll'));
                for (const dll of dllFiles) {
                    const src = path.join(fsr4Dir, dll);
                    const dest = path.join(targetExeDir, dll);
                    fs.copyFileSync(src, dest);
                    copiedFilesList.push(dest);
                }
                fsr4Installed = true;
                logMsg(event, logPath, 'ok', t('fsr4Ok'));
            } catch (e) {
                logMsg(event, logPath, 'warn', t('fsr4Err', { err: e.message }));
            }
        }

        if (shouldAbort && shouldAbort()) throw new Error('ABORTED');

        // 9. games.json ve user-games.json Güncellemeleri
        logMsg(event, logPath, 'info', t('updatingGames'));
        const existingGamesState = config.getExistingGamesState();
        const normTargetName = game.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        let dbGame = existingGamesState.find(g => g.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normTargetName);

        const resolvedGameRoot = config.resolveActualGameRoot(game.name, targetExePath) || targetExeDir;

        if (!dbGame && !isAuto) {
            dbGame = await scanner.processAndStreamGame({
                name: game.name,
                exePath: targetExePath,
                source: 'manual',
                coverUrl: null
            }, null);
        }

        if (dbGame) {
            dbGame.hasOptiscaler = true;
            dbGame.optiscalerVersion = tag;
            dbGame.optiscalerInjection = injection;
            dbGame.optiscalerPath = targetExeDir;

            // Clear/reset OptiBuilder fields
            dbGame.hasOptiBuilder = false;
            dbGame.optiBuilderVersion = null;
            dbGame.optiBuilderInjection = null;
            dbGame.optiBuilderPath = null;

            if (!dbGame.upscalers) dbGame.upscalers = {};
            dbGame.upscalers.optiscaler = true;
            dbGame.upscalers.optibuilder = false;

            if (!isAuto) dbGame.exePath = targetExePath;
            config.saveGamesState();
            logMsg(event, logPath, 'ok', t('updatingGamesOk'));
        }

        // Manuel kurulum sonrası user-games.json'a kaydet
        if (!isAuto && targetExePath && targetExePath.toLowerCase().endsWith('.exe')) {
            try {
                const userGames = config.getUserGames();
                const exePathNorm = path.resolve(targetExePath).toLowerCase();
                const existingKey = Object.keys(userGames).find(k => {
                    const ep = userGames[k].exe_path;
                    return ep && path.resolve(ep).toLowerCase() === exePathNorm;
                });

                if (!existingKey) {
                    const normKey = config.normalizeGameKey(game.name);
                    userGames[normKey] = {
                        game_root: resolvedGameRoot,
                        exe_path: targetExePath,
                        display_name: game.name
                    };
                    config.saveUserGames(userGames);
                    logMsg(event, logPath, 'ok', t('userGamesOk'));
                }
            } catch (e) {
                logMsg(event, logPath, 'warn', t('userGamesErr', { err: e.message }));
            }
        }

        if (shouldAbort && shouldAbort()) throw new Error('ABORTED');

        // Apply developer preset if OptiScaler.ini exists
        const iniPath = path.join(targetExeDir, 'OptiScaler.ini');
        if (fs.existsSync(iniPath)) {
            logMsg(event, logPath, 'info', t('presetApplying'));
            const presetValues = {
                FrameGen: {
                    FGInput: 'upscaler',
                    FGOutput: 'xefg',
                    Enabled: 'true'
                },
                OptiFG: {
                    HUDFix: 'true'
                },
                Menu: {
                    ShowFps: 'true'
                }
            };
            try {
                const iniEditor = require('./iniEditor');
                iniEditor.writeIni(iniPath, presetValues);
                logMsg(event, logPath, 'ok', t('presetOk'));
                logMsg(event, logPath, 'ok', t('presetAppliedLog'));
            } catch (iniErr) {
                logMsg(event, logPath, 'warn', t('presetErr', { err: iniErr.message }));
            }
        }
        if (shouldAbort && shouldAbort()) throw new Error('ABORTED');
    } catch (err) {
        logMsg(event, logPath, 'err', t('errCritical', { err: err.message }), '[ERR_004]');
        
        // Rollback kopyalanan dosyalar
        logMsg(event, logPath, 'info', t('rollback'));
        try {
            for (const f of copiedFilesList) {
                if (fs.existsSync(f)) {
                    fs.unlinkSync(f);
                }
            }
            for (const d of copiedDirsList) {
                if (fs.existsSync(d)) {
                    fs.rmSync(d, { recursive: true, force: true });
                }
            }
            logMsg(event, logPath, 'ok', t('rollbackFiles'));
        } catch (re) {
            logMsg(event, logPath, 'warn', t('rollbackFilesErr', { err: re.message }));
        }

        // Rollback games.json
        try {
            config.setExistingGamesState(originalGamesState);
            config.saveGamesState();
            logMsg(event, logPath, 'ok', t('rollbackDb'));
        } catch (ge) {
            logMsg(event, logPath, 'warn', t('rollbackDbErr', { err: ge.message }));
        }

        return { success: false, error: err.message, code: 'ERR_004' };
    }

    logMsg(event, logPath, 'ok', t('successHeader'));
    logMsg(event, logPath, 'ok', t('successFooter'));
    logMsg(event, logPath, 'info', t('logSaved', { path: logPath }));
    return { success: true, optiPatcherInstalled, fsr4Installed, logPath, games: config.getExistingGamesState() };
}

module.exports = {
    runOptiWizard
};
