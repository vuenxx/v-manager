const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const config = require('../config');
const scanner = require('../scanner');
const utils = require('../utils');
const optiBuilder = require('./optiBuilder');

const MESSAGES = {
    tr: {
        start: '=== OptiBuilder Sihirbazı Başlatıldı ===',
        game: 'Oyun: {name}',
        exe: 'Seçilen EXE: {path}',
        version: 'OptiBuilder Sürümü: {version}',
        injection: 'Enjeksiyon Tipi: {type}',
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
        cached: 'OptiBuilder sürümü yerel depolamada zaten mevcut, tekrar indirilmeyecek.',
        downloading: 'OptiBuilder {version} indiriliyor...',
        errDlMissing: 'OptiBuilder indirme linki bulunamadı.',
        errDlFailed: 'OptiBuilder indirilemedi: {err}',
        dlOk: 'OptiBuilder başarıyla indirildi.',
        copying: 'OptiBuilder dosyaları kopyalanıyor...',
        errCopyFailed: 'OptiBuilder dosyaları kopyalanamadı: {err}',
        copyOk: 'OptiBuilder dosyaları başarıyla kopyalandı.',
        dllRename: 'Enjeksiyon DLL ismi değiştiriliyor: OptiScaler.dll -> {injection}',
        dllRenameOk: 'Enjeksiyon DLL\'i ayarlandı: {injection}',
        errDllRenameFailed: 'DLL ismi değiştirilirken hata: {err}',
        updatingGames: 'games.json güncelleniyor...',
        updatingGamesOk: 'games.json başarıyla güncellendi.',
        userGamesOk: 'Oyun yolu kullanıcı oyun yollarına (user-games.json) kaydedildi.',
        userGamesErr: 'user-games.json güncellenemedi: {err}',
        errCritical: 'Kurulum sırasında kritik hata oluştu: {err}',
        presetApplying: 'OptiBuilder için geliştirici ön ayarı (dev-optibuilder-fg) uygulanıyor...',
        presetOk: 'Geliştirici ön ayarı başarıyla uygulandı.',
        presetAppliedLog: 'Ön ayar uygulandı.',
        presetErr: 'Geliştirici ön ayarı uygulanamadı: {err}',
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
        start: '=== OptiBuilder Wizard Started ===',
        game: 'Game: {name}',
        exe: 'Selected EXE: {path}',
        version: 'OptiBuilder Version: {version}',
        injection: 'Injection Type: {type}',
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
        cached: 'OptiBuilder version already exists in local storage, will not re-download.',
        downloading: 'Downloading OptiBuilder {version}...',
        errDlMissing: 'OptiBuilder download link not found.',
        errDlFailed: 'Could not download OptiBuilder: {err}',
        dlOk: 'OptiBuilder downloaded successfully.',
        copying: 'Copying OptiBuilder files...',
        errCopyFailed: 'Could not copy OptiBuilder files: {err}',
        copyOk: 'OptiBuilder files copied successfully.',
        dllRename: 'Renaming injection DLL: OptiScaler.dll -> {injection}',
        dllRenameOk: 'Injection DLL configured: {injection}',
        errDllRenameFailed: 'Error renaming DLL: {err}',
        updatingGames: 'Updating games.json...',
        updatingGamesOk: 'games.json updated successfully.',
        userGamesOk: 'Game path saved to User Game Paths (user-games.json).',
        userGamesErr: 'Could not update user-games.json: {err}',
        errCritical: 'A critical error occurred during installation: {err}',
        presetApplying: 'Applying developer preset (dev-optibuilder-fg) for OptiBuilder...',
        presetOk: 'Developer preset applied successfully.',
        presetAppliedLog: 'Preset applied.',
        presetErr: 'Could not apply developer preset: {err}',
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
        console.error('[OPTI BUILDER WIZARD] Log dosyasına yazılamadı:', e);
    }

    if (event && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('optibuilder-wizard-log', { type, msg, code });
    }
}

async function runOptiBuilderWizard(event, { game, version, tag, downloadUrl, injection, isAuto, exePath, bypassDx12Check, lang }, shouldAbort) {
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
    const logsDir = path.join(app.getPath('userData'), 'logs', 'optibuilder-wizard');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    const date = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
    const logPath = path.join(logsDir, `optibuilder-wizard-${timestamp}.log`);

    logMsg(event, logPath, 'info', t('start'));
    logMsg(event, logPath, 'info', t('game', { name: game.name }));
    logMsg(event, logPath, 'info', t('exe', { path: exePath || 'Kayıtlı Yol' }));
    logMsg(event, logPath, 'info', t('version', { version: tag }));
    logMsg(event, logPath, 'info', t('injection', { type: injection }));

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

    const copiedFilesList = [];
    const copiedDirsList = [];

    try {
        if (shouldAbort && shouldAbort()) throw new Error('ABORTED');
        // 6. OptiBuilder İndirme & Kopyalama
        const versionDir = path.join(config.modsPath, 'optibuilder', tag);
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
            const dlResult = await optiBuilder.downloadOptiBuilderRelease(event, { tag, downloadUrl });
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
            dbGame.hasOptiBuilder = true;
            dbGame.optiBuilderVersion = tag;
            dbGame.optiBuilderInjection = injection;
            dbGame.optiBuilderPath = targetExeDir;

            // Clear/reset standard OptiScaler fields
            dbGame.hasOptiscaler = false;
            dbGame.optiscalerVersion = null;
            dbGame.optiscalerInjection = null;
            dbGame.optiscalerPath = null;

            if (!dbGame.upscalers) dbGame.upscalers = {};
            dbGame.upscalers.optibuilder = true;
            dbGame.upscalers.optiscaler = false;

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
                    Enabled: 'true',
                    FGInput: 'upscaler',
                    FGOutput: 'dlssgwithnvngx'
                },
                DLSSG: {
                    InterpolationCount: 6,
                    DisableHudless: 'true',
                    DispatchFlags: '0x4100000'
                },
                Menu: {
                    ShowFps: 'true',
                    FpsOverlayPos: 'auto',
                    FpsOverlayType: 'auto'
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
    return { success: true, logPath, games: config.getExistingGamesState() };
}

module.exports = {
    runOptiBuilderWizard
};
