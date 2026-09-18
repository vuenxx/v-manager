const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const extract = require('extract-zip');
const { execFile } = require('child_process');
const { path7za } = require('7zip-bin');

const config = require('../config');
const releaseCache = require('./releaseCache');

const MOD_NAME = 'optibuilder';

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
const utils = require('../utils');
const scanner = require('../scanner');

async function getOptiBuilderReleases(forceRefresh = false) {
    if (forceRefresh) {
        releaseCache.clearCache(MOD_NAME);
    }
    // --- Disk cache kontrolü ---
    if (!forceRefresh && releaseCache.isCacheValid(MOD_NAME)) {
        console.log('[OPTIBUILDER] Disk cache geçerli, döndürülüyor.');
        const cached = releaseCache.readCache(MOD_NAME);
        return {
            fetchedAt: cached.fetchedAt,
            releases: cached.releases.map(r => {
                const targetDir = path.join(config.modsPath, 'optibuilder', r.tag);
                let installed = false;
                if (fs.existsSync(targetDir)) {
                    try { installed = fs.readdirSync(targetDir).length > 0; } catch (e) {}
                }
                return { ...r, installed };
            })
        };
    }

    try {
        const response = await fetch('https://api.github.com/repos/vuenxx/extra_newrepo/releases', {
            headers: { 'User-Agent': 'vuenxxFG' }
        });

        if (response.status === 403) {
            const rateLimitReset = response.headers.get('X-RateLimit-Reset');
            let errorMsg = 'GitHub API limitine ulaşıldı. Lütfen daha sonra tekrar deneyin.';
            if (rateLimitReset) {
                const resetDate = new Date(parseInt(rateLimitReset) * 1000);
                errorMsg += ` (Sıfırlanma zamanı: ${resetDate.toLocaleTimeString()})`;
            }
            throw new Error(errorMsg);
        }

        if (!response.ok) throw new Error(`GitHub API HTTP error: ${response.status}`);
        const releases = await response.json();

        const mappedReleases = [];
        for (const r of releases.slice(0, 10)) {
            const asset = r.assets && r.assets.find(a => {
                const nameLow = a.name.toLowerCase();
                return nameLow.endsWith('.zip') || nameLow.endsWith('.7z');
            });
            if (!asset) continue;
            mappedReleases.push({
                name: r.name || r.tag_name,
                tag:  r.tag_name,
                downloadUrl: asset.browser_download_url,
                size: asset.size,
                publishedAt: r.published_at
            });
        }

        releaseCache.writeCache(MOD_NAME, mappedReleases);
        const fetchedAt = Date.now();

        return {
            fetchedAt,
            releases: mappedReleases.map(r => {
                const targetDir = path.join(config.modsPath, 'optibuilder', r.tag);
                let installed = false;
                if (fs.existsSync(targetDir)) {
                    try { installed = fs.readdirSync(targetDir).length > 0; } catch (e) {}
                }
                return { ...r, installed };
            })
        };
    } catch (e) {
        console.error('[OPTIBUILDER] Fetch hatası:', e.message);
        // Stale cache fallback
        const stale = releaseCache.readCache(MOD_NAME);
        if (stale) {
            console.log('[OPTIBUILDER] Stale cache fallback kullanılıyor.');
            return {
                fetchedAt: stale.fetchedAt,
                fromStaleCache: true,
                releases: stale.releases.map(r => {
                    const targetDir = path.join(config.modsPath, 'optibuilder', r.tag);
                    let installed = false;
                    if (fs.existsSync(targetDir)) {
                        try { installed = fs.readdirSync(targetDir).length > 0; } catch (err) {}
                    }
                    return { ...r, installed };
                })
            };
        }
        return { error: e.message };
    }
}

async function downloadOptiBuilderVersion(event, tag, downloadUrl) {
    if (!downloadUrl) throw new Error("İndirme linki bulunamadı.");

    const targetDir = path.join(config.modsPath, 'optibuilder', tag);

    // Already downloaded? Check for critical file
    if (fs.existsSync(targetDir)) {
        try {
            const criticalFiles = ['OptiScaler.dll', 'OptiScaler.ini'];
            const dirFiles = fs.readdirSync(targetDir).map(f => f.toLowerCase());
            const hasCritical = criticalFiles.some(cf => dirFiles.includes(cf.toLowerCase()));
            if (hasCritical) return { success: true, targetDir, alreadyExists: true };
        } catch (e) { }
    }

    const is7z = downloadUrl.toLowerCase().endsWith('.7z');
    const ext = is7z ? '.7z' : '.zip';
    const tempZipPath = path.join(app.getPath('temp'), `optibuilder_${tag.replace(/[^a-z0-9.-]/gi, '_')}${ext}`);

    const zipResponse = await fetch(downloadUrl);
    if (!zipResponse.ok) throw new Error(`Download failed: ${zipResponse.status}`);

    const contentLength = +zipResponse.headers.get('Content-Length') || 0;
    const reader = zipResponse.body.getReader();
    let receivedLength = 0;
    let chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedLength += value.length;
        if (contentLength && event && event.sender && !event.sender.isDestroyed()) {
            const percent = Math.round((receivedLength / contentLength) * 100);
            event.sender.send('optibuilder-download-progress', { percent });
        }
    }
    const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
    fs.writeFileSync(tempZipPath, buffer);

    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    if (event && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('optibuilder-download-progress', { percent: 100, stage: 'extracting' });
    }
    await extractArchive(tempZipPath, targetDir);

    try { fs.unlinkSync(tempZipPath); } catch (e) { }

    return { success: true, targetDir };
}

async function downloadOptiBuilderRelease(event, { tag, downloadUrl }) {
    try {
        if (!downloadUrl) throw new Error("İndirme linki bulunamadı.");

        const targetDir = path.join(config.modsPath, 'optibuilder', tag);

        if (fs.existsSync(targetDir)) {
            try {
                const criticalFiles = ['OptiScaler.dll', 'OptiScaler.ini'];
                const dirFiles = fs.readdirSync(targetDir).map(f => f.toLowerCase());
                const hasCritical = criticalFiles.some(cf => dirFiles.includes(cf.toLowerCase()));
                if (hasCritical) return { success: true, alreadyExists: true, targetDir };
            } catch (e) { }
        }

        const is7z = downloadUrl.toLowerCase().endsWith('.7z');
        const ext = is7z ? '.7z' : '.zip';
        const tempZipPath = path.join(app.getPath('temp'), `optibuilder_${tag.replace(/[^a-z0-9.-]/gi, '_')}${ext}`);

        const zipResponse = await fetch(downloadUrl);
        if (!zipResponse.ok) throw new Error(`Download failed: ${zipResponse.status}`);

        const contentLength = +zipResponse.headers.get('Content-Length') || 0;
        const reader = zipResponse.body.getReader();
        let receivedLength = 0;
        let chunks = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;
            if (contentLength && event && event.sender && !event.sender.isDestroyed()) {
                const percent = Math.round((receivedLength / contentLength) * 100);
                event.sender.send('optibuilder-download-progress', { percent });
            }
        }

        const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
        fs.writeFileSync(tempZipPath, buffer);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        if (event && event.sender && !event.sender.isDestroyed()) {
            event.sender.send('optibuilder-download-progress', { percent: 100, stage: 'extracting' });
        }
        await extractArchive(tempZipPath, targetDir);

        try {
            fs.unlinkSync(tempZipPath);
        } catch (e) { }

        return { success: true, targetDir };
    } catch (e) {
        console.error("Download/Extract error:", e);
        return { success: false, error: e.message };
    }
}

async function installOptiBuilder(event, { game, version, tag, downloadUrl, injection, isAuto }) {
    console.log(`[OPTIBUILDER] Kurulum başlatıldı. Oyun: ${game.name}, Tag: ${tag}, Injection: ${injection}, Auto: ${isAuto}`);
    try {
        let targetExeDir = '';
        const normTargetName = game.name.toLowerCase().replace(/[^a-z0-9]/g, '');

        if (isAuto) {
            const paths = config.getGamePaths(game.name, game.exePath);
            if (!paths) {
                console.error(`[OPTIBUILDER] Hata: Yol bulunamadı.`);
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
            console.log(`[OPTIBUILDER] Hedef EXE klasörü: ${targetExeDir} (kaynak: ${paths.source})`);
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
        } catch (e) { }

        const running = await utils.isGameRunning(exeToCheck);
        if (running) {
            return { success: false, error: 'Oyun şu an açık. Lütfen oyunu kapatıp tekrar deneyin.' };
        }

        const versionDir = path.join(config.modsPath, 'optibuilder', tag);
        let alreadyDownloaded = false;
        if (fs.existsSync(versionDir)) {
            try {
                const criticalFiles = ['OptiScaler.dll', 'OptiScaler.ini'];
                const dirFiles = fs.readdirSync(versionDir).map(f => f.toLowerCase());
                const hasCritical = criticalFiles.some(cf => dirFiles.includes(cf.toLowerCase()));
                if (hasCritical) alreadyDownloaded = true;
                else console.log(`[OPTIBUILDER] Klasör mevcut ama kritik dosyalar eksik — yeniden indirilecek.`);
            } catch (e) { }
        }

        if (!alreadyDownloaded) {
            if (!downloadUrl) {
                return { success: false, error: 'Bu sürüm henüz indirilmemiş ve indirme linki bulunamadı.' };
            }
            const dlResult = await downloadOptiBuilderVersion(event, tag, downloadUrl);
            if (!dlResult.success) {
                console.error(`[OPTIBUILDER] İndirme hatası:`, dlResult.error);
                throw new Error(dlResult.error || 'İndirme başarısız.');
            }
        }

        console.log(`[OPTIBUILDER] Dosyalar kopyalanıyor...`);
        await utils.copyDir(versionDir, targetExeDir);

        // Conflict check — verify no other mod's DLLs were silently overwritten
        const injectionDllNames = ['dxgi.dll', 'winmm.dll', 'd3d12.dll', 'dbghelp.dll', 'version.dll', 'wininet.dll', 'winhttp.dll'];
        for (const dllName of injectionDllNames) {
            const dllPath = path.join(targetExeDir, dllName);
            if (fs.existsSync(dllPath)) {
                const desc = await utils.getFileDescription(dllPath);
                const descLow = desc.toLowerCase();
                if (!descLow.includes('optiscaler') && desc !== '') {
                    console.warn(`[OPTIBUILDER] Uyarı: ${dllName} dosyası OptiScaler'sız bir mod ile ezilebilmiş olabilir (Desc: ${desc})`);
                }
            }
        }

        const optiDllSrc = path.join(targetExeDir, 'OptiScaler.dll');
        if (fs.existsSync(optiDllSrc) && injection && injection !== 'OptiScaler.dll') {
            console.log(`[OPTIBUILDER] DLL ismi değiştiriliyor: OptiScaler.dll -> ${injection}`);
            const targetDllPath = path.join(targetExeDir, injection);
            if (fs.existsSync(targetDllPath)) {
                fs.unlinkSync(targetDllPath);
            }
            try {
                fs.renameSync(optiDllSrc, targetDllPath);
            } catch (renameErr) {
                if (renameErr.code === 'EXDEV') {
                    console.log(`[OPTIBUILDER] Cross-drive rename tespit edildi, kopyalama + silme yöntemi kullanılıyor.`);
                    fs.copyFileSync(optiDllSrc, targetDllPath);
                    fs.unlinkSync(optiDllSrc);
                } else {
                    throw renameErr;
                }
            }
        }

        console.log(`[OPTIBUILDER] Kurulum başarıyla tamamlandı.`);
        const existingGamesState = config.getExistingGamesState();
        let dbGame = existingGamesState.find(g => g.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normTargetName);

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
                    console.log(`[OPTIBUILDER] Oyun zaten user-games.json'da: key="${existingKey}"`);
                } else {
                    const normKey = config.normalizeGameKey(game.name);
                    userGames[normKey] = {
                        game_root: resolvedGameRoot,
                        exe_path: game.exePath,
                        display_name: game.name
                    };
                    config.saveUserGames(userGames);
                    savedToUserGames = true;
                    console.log(`[OPTIBUILDER] Manuel kurulum sonrası user-games.json'a kaydedildi: key="${normKey}", name="${game.name}"`);
                }
            } catch (saveErr) {
                console.warn('[OPTIBUILDER] user-games.json kaydı başarısız (kurulum etkilenmez):', saveErr.message);
            }
        }

        return { success: true, savedToUserGames, games: config.getExistingGamesState() };
    } catch (e) {
        console.error('install-optibuilder error:', e);
        return { success: false, error: e.message };
    }
}

module.exports = {
    getOptiBuilderReleases,
    downloadOptiBuilderRelease,
    installOptiBuilder
};
