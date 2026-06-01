const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const extract = require('extract-zip');

const config = require('../config');
const utils = require('../utils');
const scanner = require('../scanner');
const optiPatcher = require('./optiPatcher');
const fsr4Files = require('./fsr4Files');

async function getOptiScalerReleases() {
    try {
        const response = await fetch('https://api.github.com/repos/optiscaler/OptiScaler/releases', {
            headers: { 'User-Agent': 'vuenxxFG' }
        });
        if (!response.ok) throw new Error(`GitHub API HTTP error: ${response.status}`);
        const releases = await response.json();

        return releases.slice(0, 5).map(r => {
            const tag = r.tag_name;
            const targetDir = path.join(config.modsPath, 'optiscaler', tag);
            let installed = false;
            if (fs.existsSync(targetDir)) {
                try {
                    const files = fs.readdirSync(targetDir);
                    if (files.length > 0) {
                        installed = true;
                    }
                } catch(e) {}
            }

            return {
                name: r.name || r.tag_name,
                tag: tag,
                downloadUrl: r.assets.find(a => a.name.toLowerCase().endsWith('.zip'))?.browser_download_url,
                installed: installed
            };
        });
    } catch (e) {
        console.error("Failed to fetch OptiScaler releases:", e);
        return { error: e.message };
    }
}

async function downloadOptiScalerVersion(event, tag, downloadUrl) {
    if (!downloadUrl) throw new Error("İndirme linki bulunamadı.");

    const targetDir = path.join(config.modsPath, 'optiscaler', tag);

    // Already downloaded? Check for critical file
    if (fs.existsSync(targetDir)) {
        try {
            const criticalFiles = ['OptiScaler.dll', 'OptiScaler.ini'];
            const dirFiles = fs.readdirSync(targetDir).map(f => f.toLowerCase());
            const hasCritical = criticalFiles.some(cf => dirFiles.includes(cf.toLowerCase()));
            if (hasCritical) return { success: true, targetDir, alreadyExists: true };
        } catch(e) {}
    }

    const tempZipPath = path.join(app.getPath('temp'), `optiscaler_${tag.replace(/[^a-z0-9.-]/gi, '_')}.zip`);

    const zipResponse = await fetch(downloadUrl);
    if (!zipResponse.ok) throw new Error(`Download failed: ${zipResponse.status}`);

    const contentLength = +zipResponse.headers.get('Content-Length') || 0;
    const reader = zipResponse.body.getReader();
    let receivedLength = 0;
    let chunks = [];
    while(true) {
        const {done, value} = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedLength += value.length;
        // FIX 4c: Guard against null/destroyed event.sender before sending progress
        if (contentLength && event && event.sender && !event.sender.isDestroyed()) {
            const percent = Math.round((receivedLength / contentLength) * 100);
            event.sender.send('optiscaler-download-progress', { percent });
        }
    }
    const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
    fs.writeFileSync(tempZipPath, buffer);

    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    // FIX 4c: Guard event.sender before extracting progress event
    if (event && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('optiscaler-download-progress', { percent: 100, stage: 'extracting' });
    }
    // Extract using extract-zip
    await extract(tempZipPath, { dir: targetDir });

    try { fs.unlinkSync(tempZipPath); } catch(e) {}

    return { success: true, targetDir };
}

async function downloadOptiScalerRelease(event, { tag, downloadUrl }) {
    try {
        if (!downloadUrl) throw new Error("İndirme linki bulunamadı.");

        const targetDir = path.join(config.modsPath, 'optiscaler', tag);

        if (fs.existsSync(targetDir)) {
            try {
                // FIX 4d: Same critical file check as in installOptiScaler
                const criticalFiles = ['OptiScaler.dll', 'OptiScaler.ini'];
                const dirFiles = fs.readdirSync(targetDir).map(f => f.toLowerCase());
                const hasCritical = criticalFiles.some(cf => dirFiles.includes(cf.toLowerCase()));
                if (hasCritical) return { success: true, alreadyExists: true, targetDir };
            } catch(e) {}
        }

        const tempZipPath = path.join(app.getPath('temp'), `optiscaler_${tag.replace(/[^a-z0-9.-]/gi, '_')}.zip`);

        const zipResponse = await fetch(downloadUrl);
        if (!zipResponse.ok) throw new Error(`Download failed: ${zipResponse.status}`);

        const contentLength = +zipResponse.headers.get('Content-Length') || 0;
        const reader = zipResponse.body.getReader();
        let receivedLength = 0;
        let chunks = [];

        while(true) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;
            // FIX 4c: Guard against null/destroyed event.sender
            if (contentLength && event && event.sender && !event.sender.isDestroyed()) {
                const percent = Math.round((receivedLength / contentLength) * 100);
                event.sender.send('optiscaler-download-progress', { percent });
            }
        }

        const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
        fs.writeFileSync(tempZipPath, buffer);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // FIX 4c: Guard event.sender before extracting progress event
        if (event && event.sender && !event.sender.isDestroyed()) {
            event.sender.send('optiscaler-download-progress', { percent: 100, stage: 'extracting' });
        }
        // Extract using extract-zip
        await extract(tempZipPath, { dir: targetDir });

        try {
            fs.unlinkSync(tempZipPath);
        } catch(e) {}

        return { success: true, targetDir };
    } catch (e) {
        console.error("Download/Extract error:", e);
        return { success: false, error: e.message };
    }
}

async function installOptiScaler(event, { game, version, tag, downloadUrl, injection, isAuto, installOptiPatcher, optiPatcherTag, optiPatcherUrl, installFsr4, fsr4Name, fsr4Url }) {
    console.log(`[OPTISCALER] Kurulum başlatıldı. Oyun: ${game.name}, Tag: ${tag}, Injection: ${injection}, Auto: ${isAuto}`);
    try {
        let targetExeDir = '';
        const normTargetName = game.name.toLowerCase().replace(/[^a-z0-9]/g, '');

        if (isAuto) {
            // --- Resolve target paths via the dual-layer system ---
            const paths = config.getGamePaths(game.name, game.exePath);
            if (!paths) {
                console.error(`[OPTISCALER] Hata: Yol bulunamadı.`);
                return { success: false, error: 'Bu oyun için yol bulunamadı. Lütfen Ayarlar → "Kullanıcı Oyun Yolları" bölümünden oyunun ana klasörünü ve EXE yolunu tanımlayın ya da Manuel Kur seçeneğini kullanın.' };
            }

            const exePathResolved = paths.exe_path;
            if (!exePathResolved || !exePathResolved.toLowerCase().endsWith('.exe') || !fs.existsSync(exePathResolved)) {
                return {
                    success: false,
                    error: `EXE dosyası bulunamadı: "${exePathResolved}".\n\nLütfen Ayarlar bölümünden oyunun tam EXE yolunu tanımlayın.`
                };
            }

            targetExeDir = path.dirname(exePathResolved);
            console.log(`[OPTISCALER] Hedef EXE klasörü: ${targetExeDir} (kaynak: ${paths.source})`);
        } else {
            targetExeDir = path.dirname(game.exePath);
        }

        if (!targetExeDir || !fs.existsSync(targetExeDir)) {
            return { success: false, error: `Hedef klasör bulunamadı: ${targetExeDir}` };
        }

        let exeToCheck = game.exePath;
        try {
            const exes = fs.readdirSync(targetExeDir).filter(f => f.toLowerCase().endsWith('.exe'));
            if (exes.length > 0) exeToCheck = path.join(targetExeDir, exes[0]);
        } catch(e) {}

        const running = await utils.isGameRunning(exeToCheck);
        if (running) {
            return { success: false, error: 'Oyun şu an açık. Lütfen oyunu kapatıp tekrar deneyin.' };     
        }

        const versionDir = path.join(config.modsPath, 'optiscaler', tag);
        let alreadyDownloaded = false;
        if (fs.existsSync(versionDir)) {
            try {
                // FIX 4d: Check for a critical file (OptiScaler.dll or OptiScaler.ini), not just
                // any files in the directory. A partial extract may leave behind some files.
                const criticalFiles = ['OptiScaler.dll', 'OptiScaler.ini'];
                const dirFiles = fs.readdirSync(versionDir).map(f => f.toLowerCase());
                const hasCritical = criticalFiles.some(cf => dirFiles.includes(cf.toLowerCase()));
                if (hasCritical) alreadyDownloaded = true;
                else console.log(`[OPTISCALER] Klasör mevcut ama kritik dosyalar eksik — yeniden indirilecek.`);
            } catch(e) {}
        }

        if (!alreadyDownloaded) {
            if (!downloadUrl) {
                return { success: false, error: 'Bu sürüm henüz indirilmemiş ve indirme linki bulunamadı.' };
            }
            const dlResult = await downloadOptiScalerVersion(event, tag, downloadUrl);
            if (!dlResult.success) {
                console.error(`[OPTISCALER] İndirme hatası:`, dlResult.error);
                throw new Error(dlResult.error || 'İndirme başarısız.');
            }
        }

        console.log(`[OPTISCALER] Dosyalar kopyalanıyor...`);
        await utils.copyDir(versionDir, targetExeDir);

        // FIX 4a: Conflict check — verify no other mod's DLLs were silently overwritten
        // (OptiScaler replaces injection DLLs like dxgi.dll; check they belong to OptiScaler)
        const injectionDllNames = ['dxgi.dll', 'winmm.dll', 'd3d12.dll', 'dbghelp.dll', 'version.dll', 'wininet.dll', 'winhttp.dll'];
        for (const dllName of injectionDllNames) {
            const dllPath = path.join(targetExeDir, dllName);
            if (fs.existsSync(dllPath)) {
                const desc = await utils.getFileDescription(dllPath);
                const descLow = desc.toLowerCase();
                if (!descLow.includes('optiscaler') && desc !== '') {
                    console.warn(`[OPTISCALER] Üyarı: ${dllName} dosyası OptiScaler'sız bir mod ile ezilebilmiş olabilir (Desc: ${desc})`);
                }
            }
        }

        const optiDllSrc = path.join(targetExeDir, 'OptiScaler.dll');
        if (fs.existsSync(optiDllSrc) && injection && injection !== 'OptiScaler.dll') {
            console.log(`[OPTISCALER] DLL ismi değiştiriliyor: OptiScaler.dll -> ${injection}`);
            const targetDllPath = path.join(targetExeDir, injection);
            if (fs.existsSync(targetDllPath)) {
                fs.unlinkSync(targetDllPath);
            }
            // FIX 4b: fs.renameSync fails across different drives. Use copy+delete as fallback.
            try {
                fs.renameSync(optiDllSrc, targetDllPath);
            } catch(renameErr) {
                if (renameErr.code === 'EXDEV') {
                    console.log(`[OPTISCALER] Cross-drive rename tespit edildi, kopyalama + silme yöntemi kullanılıyor.`);
                    fs.copyFileSync(optiDllSrc, targetDllPath);
                    fs.unlinkSync(optiDllSrc);
                } else {
                    throw renameErr;
                }
            }
        }

        console.log(`[OPTISCALER] Kurulum başarıyla tamamlandı.`);
        const existingGamesState = config.getExistingGamesState();
        let dbGame = existingGamesState.find(g => g.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normTargetName);

        // Resolve the correct game_root before updating dbGame.exePath or saving to user-games.json
        const resolvedGameRoot = config.resolveActualGameRoot(game.name, game.exePath) || path.dirname(game.exePath);

        if (!dbGame && !isAuto) {
            const defaultName = game.name;
            dbGame = await scanner.processAndStreamGame({
                name: defaultName,
                exePath: game.exePath,
                source: 'manual',
                coverUrl: null
            }, null);
        }
        if (dbGame) {
            dbGame.hasOptiscaler = true;
            dbGame.optiscalerVersion = tag;
            dbGame.optiscalerInjection = injection;
            dbGame.optiscalerPath = targetExeDir;
            if (!isAuto) dbGame.exePath = game.exePath;
            config.saveGamesState();
        }

        // After successful manual install — auto-save to user-games.json if not already there
        let savedToUserGames = false;
        if (!isAuto && game.exePath && game.exePath.toLowerCase().endsWith('.exe')) {
            try {
                const userGames = config.getUserGames();
                const exePathNorm = path.resolve(game.exePath).toLowerCase();

                const existingKey = Object.keys(userGames).find(k => {
                    const ep = userGames[k].exe_path;
                    return ep && path.resolve(ep).toLowerCase() === exePathNorm;
                });

                if (existingKey) {
                    console.log(`[OPTISCALER] Oyun zaten user-games.json'da: key="${existingKey}"`);
                } else {
                    const normKey = config.normalizeGameKey(game.name);
                    userGames[normKey] = {
                        game_root: resolvedGameRoot,
                        exe_path: game.exePath,
                        display_name: game.name
                    };
                    config.saveUserGames(userGames);
                    savedToUserGames = true;
                    console.log(`[OPTISCALER] Manuel kurulum sonrası user-games.json'a kaydedildi: key="${normKey}", name="${game.name}"`);
                }
            } catch (saveErr) {
                console.warn('[OPTISCALER] user-games.json kaydı başarısız (kurulum etkilenmez):', saveErr.message);
            }
        }

        // ── OptiPatcher isteğe bağlı kurulum ──────────────────────────────────
        let optiPatcherInstalled = false;
        if (installOptiPatcher && optiPatcherTag) {
            try {
                console.log(`[OPTISCALER] OptiPatcher kurulumu başlıyor: ${optiPatcherTag}`);

                // 1. İndirilmiş mi kontrol et
                const asiPath = path.join(config.modsPath, 'OptiPatcher', optiPatcherTag, 'OptiPatcher.asi');
                if (!fs.existsSync(asiPath)) {
                    if (!optiPatcherUrl) throw new Error('OptiPatcher indirme linki bulunamadı.');
                    console.log(`[OPTISCALER] OptiPatcher indiriliyor...`);
                    const dlResult = await optiPatcher.downloadOptiPatcherRelease(event, { tag: optiPatcherTag, downloadUrl: optiPatcherUrl });
                    if (!dlResult.success) throw new Error(dlResult.error || 'OptiPatcher indirilemedi.');
                }

                // 2. plugins klasörü oluştur ve .asi kopyala
                const pluginsDir = path.join(targetExeDir, 'plugins');
                fs.mkdirSync(pluginsDir, { recursive: true });
                const destAsi = path.join(pluginsDir, 'OptiPatcher.asi');
                fs.copyFileSync(asiPath, destAsi);
                console.log(`[OPTISCALER] OptiPatcher.asi kopyalandı: ${destAsi}`);

                // 3. OptiScaler.ini içinde LoadAsiPlugins=auto → true
                try {
                    const iniPath = path.join(targetExeDir, 'OptiScaler.ini');
                    if (fs.existsSync(iniPath)) {
                        let iniContent = fs.readFileSync(iniPath, 'utf8');
                        const updated = iniContent.replace(
                            /(LoadAsiPlugins\s*=\s*)auto/i,
                            '$1true'
                        );
                        if (updated !== iniContent) {
                            fs.writeFileSync(iniPath, updated, 'utf8');
                            console.log(`[OPTISCALER] OptiScaler.ini güncellendi: LoadAsiPlugins=true`);
                        } else {
                            console.log(`[OPTISCALER] OptiScaler.ini içinde LoadAsiPlugins=auto bulunamadı, değiştirme atlandı.`);
                        }
                    } else {
                        console.warn(`[OPTISCALER] OptiScaler.ini bulunamadı, LoadAsiPlugins güncellenemedi.`);
                    }
                } catch (iniErr) {
                    console.warn(`[OPTISCALER] OptiScaler.ini düzenlenirken hata (kurulumu bozmaz):`, iniErr.message);
                }

                optiPatcherInstalled = true;
                console.log(`[OPTISCALER] OptiPatcher kurulumu tamamlandı.`);
            } catch (patcherErr) {
                console.error(`[OPTISCALER] OptiPatcher kurulum hatası (OptiScaler kurulumunu bozmaz):`, patcherErr.message);
            }
        }

        // ── FSR4 isteğe bağlı kurulum ─────────────────────────────────────────
        let fsr4Installed = false;
        if (installFsr4 && fsr4Name) {
            try {
                console.log(`[OPTISCALER] FSR4 kurulumu başlıyor: ${fsr4Name}`);

                // 1. İndirilmiş mi kontrol et
                const fsr4Dir = path.join(config.modsPath, 'fsr4files', fsr4Name);
                const isDownloaded = fs.existsSync(fsr4Dir) && (() => {
                    try { return fs.readdirSync(fsr4Dir).length > 0; } catch(e) { return false; }
                })();

                if (!isDownloaded) {
                    if (!fsr4Url) throw new Error('FSR4 indirme linki bulunamadı.');
                    console.log(`[OPTISCALER] FSR4 indiriliyor...`);
                    const dlResult = await fsr4Files.downloadFsr4Release(event, { name: fsr4Name, downloadUrl: fsr4Url });
                    if (!dlResult.success) throw new Error(dlResult.error || 'FSR4 indirilemedi.');
                }

                // 2. .dll dosyalarını targetExeDir'e kopyala
                const dllFiles = fs.readdirSync(fsr4Dir).filter(f => f.toLowerCase().endsWith('.dll'));
                if (dllFiles.length === 0) throw new Error('FSR4 klasöründe .dll dosyası bulunamadı.');
                for (const dll of dllFiles) {
                    const src = path.join(fsr4Dir, dll);
                    const dest = path.join(targetExeDir, dll);
                    fs.copyFileSync(src, dest);
                    console.log(`[OPTISCALER] FSR4 .dll kopyalandı: ${dest}`);
                }

                fsr4Installed = true;
                console.log(`[OPTISCALER] FSR4 kurulumu tamamlandı.`);
            } catch (fsr4Err) {
                console.error(`[OPTISCALER] FSR4 kurulum hatası (OptiScaler kurulumunu bozmaz):`, fsr4Err.message);
            }
        }

        return { success: true, savedToUserGames, optiPatcherInstalled, fsr4Installed, games: config.getExistingGamesState() };
    } catch(e) {
        console.error('install-optiscaler error:', e);
        return { success: false, error: e.message };
    }
}

module.exports = {
    getOptiScalerReleases,
    downloadOptiScalerRelease,
    installOptiScaler
};
