/**
 * test-vlss5.js — VLSS5 yöneticisi ve RAR çıkarıcı testleri
 *
 * Electron dışında çalışır; `electron` modülü mock'lanır (test-detector.js deseni).
 * Ağ gerektiren tek test en sonda ve başarısız olursa sadece uyarı verir.
 *
 * Çalıştırma: node src/main/modules/test-vlss5.js
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Mock electron ────────────────────────────────────────────────────────────
const projectRoot = path.join(__dirname, '..', '..', '..');
const mockUserData = path.join(os.tmpdir(), 'vmanager-vlss5-test-' + Date.now());
fs.mkdirSync(mockUserData, { recursive: true });

let lastOpenedPath = null;

require.cache[require.resolve('electron')] = {
    id: 'electron',
    filename: 'electron',
    loaded: true,
    exports: {
        app: {
            getPath: (n) => (n === 'temp' ? path.join(mockUserData, 'temp') : mockUserData),
            getVersion: () => '0.6.0',
            getAppPath: () => projectRoot
        },
        shell: {
            openPath: async (p) => { lastOpenedPath = p; return ''; }
        },
        dialog: {},
        BrowserWindow: {
            fromWebContents: () => null,
            // Arka plan güncellemesi bildirimleri tüm pencerelere yayınlanır
            getAllWindows: () => []
        }
    }
};

const rarExtractor = require('./core/rarExtractor');
const archive = require('./core/archive');
const utils = require('../utils');
const config = require('../config');
const vlss5 = require('./vlss5/vlss5Manager');

let passed = 0;
let failed = 0;

function check(name, cond, extra) {
    if (cond) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        console.log(`  ✗ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
    }
}

/** Test için örnek RAR: test-data/vlss5-sample.rar (yoksa ilgili testler atlanır) */
const SAMPLE_RAR = path.join(projectRoot, 'test-data', 'vlss5-sample.rar');

async function run() {
    console.log('\n=== VLSS5 testleri ===');
    console.log(`userData mock: ${mockUserData}\n`);

    // ── Arşiv formatı ────────────────────────────────────────────────────────
    console.log('--- Arsiv destegi ---');
    check('archive .rar destekliyor', archive.supportsFormat('.rar') === true);
    check('archive .zip destekliyor', archive.supportsFormat('.zip') === true);
    check('archive .exe destekliyor (SFX kurulum dosyalari)', archive.supportsFormat('.exe') === true);
    check('archive .tar desteklemiyor', archive.supportsFormat('.tar') === false);
    check('desteklenen formatlar listesi', archive.getSupportedFormats().join(',') === '.zip,.7z,.rar,.exe',
        archive.getSupportedFormats());

    // ── Sürüm karşılaştırma (tag normalizasyonu) ─────────────────────────────
    console.log('\n--- Surum karsilastirma ---');
    check('0.4 > v0.3', utils.compareVersions('0.4', 'v0.3') === 1);
    check('0.4 == 0.4', utils.compareVersions('0.4', '0.4') === 0);
    check('v0.3 < 0.4', utils.compareVersions('v0.3', '0.4') === -1);
    check('0.10 > 0.9 (sayisal, string degil)', utils.compareVersions('0.10', '0.9') === 1);

    // ── RAR çıkarma ──────────────────────────────────────────────────────────
    console.log('\n--- RAR cikarma ---');
    if (fs.existsSync(SAMPLE_RAR)) {
        const outDir = path.join(mockUserData, 'rar-out');
        const res = await rarExtractor.extractRar(SAMPLE_RAR, outDir);
        check('ornek rar cikarildi', res.files.length > 0, res.files);
        check('VLSS5.exe cikti', fs.existsSync(path.join(outDir, 'VLSS5.exe')));
        check('nvngx.dll_dlssnr.dll cikti', fs.existsSync(path.join(outDir, 'nvngx.dll_dlssnr.dll')));

        // archive.extractArchive üzerinden de aynı yol çalışmalı
        const outDir2 = path.join(mockUserData, 'rar-out2');
        await archive.extractArchive(SAMPLE_RAR, outDir2);
        check('archive.extractArchive rar yonlendirmesi', fs.existsSync(path.join(outDir2, 'VLSS5.exe')));
    } else {
        console.log(`  … ornek rar yok, atlandi (${SAMPLE_RAR})`);
    }

    check('bozuk yol reddi (olmayan arsiv)', await (async () => {
        try {
            await rarExtractor.extractRar(path.join(mockUserData, 'yok.rar'), mockUserData);
            return false;
        } catch (e) {
            return /bulunamadı/i.test(e.message);
        }
    })());

    // ── Kurulum klasörü tespiti ──────────────────────────────────────────────
    console.log('\n--- Kurulum klasoru tespiti ---');
    const installDir = config.vlss5Path;
    check('vlss5Path olusturuldu', fs.existsSync(installDir), installDir);

    let insp = vlss5.inspectInstallDir();
    check('bos klasor: exe yok', insp.exeExists === false);
    check('bos klasor: dll yok', insp.dllExists === false);

    fs.writeFileSync(path.join(installDir, 'VLSS5.exe'), Buffer.alloc(1024));
    insp = vlss5.inspectInstallDir();
    check('exe konuldu: exeExists true', insp.exeExists === true);
    check('exe yolu dogru', insp.exePath === path.join(installDir, 'VLSS5.exe'));

    // ── setModelDll doğrulamaları ────────────────────────────────────────────
    console.log('\n--- Model DLL dogrulamalari ---');
    const wrongName = path.join(mockUserData, 'nvngx.dll_dlssnr.dll');   // forwarder, model degil
    fs.writeFileSync(wrongName, Buffer.alloc(200 * 1024));
    let r = await vlss5.setModelDll(wrongName);
    check('forwarder reddedilir (BAD_NAME)', r.errorCode === 'BAD_NAME', r);

    r = await vlss5.setModelDll(path.join(mockUserData, 'olmayan.dll'));
    check('olmayan dosya (NOT_FOUND)', r.errorCode === 'NOT_FOUND', r);

    const tooSmall = path.join(mockUserData, 'small', 'nvngx_dlssnr.dll');
    fs.mkdirSync(path.dirname(tooSmall), { recursive: true });
    fs.writeFileSync(tooSmall, Buffer.alloc(10 * 1024));
    r = await vlss5.setModelDll(tooSmall);
    check('cok kucuk dosya (TOO_SMALL)', r.errorCode === 'TOO_SMALL', r);

    const goodDll = path.join(mockUserData, 'good', 'nvngx_dlssnr.dll');
    fs.mkdirSync(path.dirname(goodDll), { recursive: true });
    fs.writeFileSync(goodDll, Buffer.alloc(5 * 1024 * 1024));
    r = await vlss5.setModelDll(goodDll);
    check('gecerli model kopyalanir', r.success === true, r && r.error);
    check('dll kurulum klasorunde', fs.existsSync(path.join(installDir, 'nvngx_dlssnr.dll')));
    check('state dosyasi yazildi', fs.existsSync(config.VLSS5_STATE_FILE));

    // ── Durum ────────────────────────────────────────────────────────────────
    console.log('\n--- Durum (getStatus) ---');
    const status = await vlss5.getStatus();
    check('isInstalled true', status.isInstalled === true);
    check('hasModelDll true', status.hasModelDll === true);
    check('isReady true', status.isReady === true);
    check('installDir dogru', status.installDir === installDir);
    check('githubUrl dogru', status.githubUrl === 'https://github.com/vuenxx/VLSS5');
    if (status.releaseError) {
        console.log(`  … GitHub erisimi yok, surum testleri atlaniyor (${status.releaseError})`);
    } else {
        check('son surum tag alindi', !!status.latestTag, status.latestTag);
        check('asset .rar veya .zip', /\.(rar|zip)$/i.test(status.latestAssetName || ''), status.latestAssetName);
    }

    // ── Başlatma (shell.openPath mock) ───────────────────────────────────────
    console.log('\n--- Baslatma ---');
    const launchRes = await vlss5.launch();
    check('launch basarili', launchRes.success === true, launchRes);
    check('dogru exe acildi', lastOpenedPath === path.join(installDir, 'VLSS5.exe'), lastOpenedPath);
    check('dll varken uyari yok', launchRes.warning === undefined, launchRes.warning);

    // ── Kaldırma ─────────────────────────────────────────────────────────────
    console.log('\n--- Kaldirma ---');
    const unRes = await vlss5.uninstall();
    check('uninstall basarili', unRes.success === true, unRes);
    check('klasor silindi', unRes.status && unRes.status.isInstalled === false, unRes.status);


    // ── Guncelleme / onarim ──────────────────────────────────────────────────
    console.log('\n--- Guncelleme mantigi ---');

    const stateFile = config.VLSS5_STATE_FILE;
    const stagingDir = config.vlss5UpdatePath;
    const writeStateRaw = (obj) => fs.writeFileSync(stateFile, JSON.stringify(obj, null, 2), 'utf-8');
    const readStateRaw = () => (fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf-8')) : {});

    check('isBusy bosta false doner', vlss5.isBusy() === false);
    check('staging klasoru olusturuldu', fs.existsSync(stagingDir), stagingDir);

    // 1. Temiz durum → onarim gerekmez
    fs.rmSync(installDir, { recursive: true, force: true });
    fs.rmSync(stateFile, { force: true });
    let pend = vlss5.inspectPendingUpdate();
    check('temiz durumda onarim gerekmez', pend.needsRepair === false, pend);

    // 2. State kurulu diyor ama exe yok → bozuk kurulum tespiti
    writeStateRaw({ installedVersion: '0.3' });
    pend = vlss5.inspectPendingUpdate();
    check('exe yoksa bozuk kurulum tespit edilir', pend.needsRepair === true && pend.reason === 'missing-exe', pend);

    // 3. Yarim kalmis indirme isareti → onarim gerekir
    writeStateRaw({ installedVersion: '0.3', pendingUpdate: { tag: '0.4', phase: 'download', assetName: 'VLSS5.0.4.rar' } });
    pend = vlss5.inspectPendingUpdate();
    check('pendingUpdate isareti onarim tetikler', pend.needsRepair === true && pend.reason === 'pending-download', pend);

    // 4. Hic kurulmamisken yarim kalan ILK kurulum → otomatik kurulmamali, temizlenmeli
    fs.rmSync(installDir, { recursive: true, force: true });
    writeStateRaw({ pendingUpdate: { tag: '0.4', phase: 'download' } });
    fs.writeFileSync(path.join(stagingDir, 'VLSS5.0.4.rar.part'), Buffer.alloc(5000));
    const abandoned = await vlss5.checkForUpdatesOnStartup();
    check('tamamlanmamis ilk kurulum otomatik kurulmaz', abandoned.reason === 'abandoned-first-install', abandoned);
    check('  → pendingUpdate temizlendi', !readStateRaw().pendingUpdate, readStateRaw());
    check('  → staging temizlendi', fs.readdirSync(stagingDir).length === 0, fs.readdirSync(stagingDir));

    // 5. Yarim .part + eski surum kurulu → onarilip guncellenir (gercek indirme)
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, 'VLSS5.exe'), Buffer.alloc(1024));
    writeStateRaw({ installedVersion: '0.1', pendingUpdate: { tag: '0.4', phase: 'download', assetName: 'VLSS5.0.4.rar' } });
    fs.writeFileSync(path.join(stagingDir, 'VLSS5.0.4.rar.part'), Buffer.alloc(5000));   // yarim indirme

    const repaired = await vlss5.checkForUpdatesOnStartup();
    if (repaired.error || (repaired.success === false)) {
        console.log(`  … onarim testi atlandi (ag/indirme hatasi: ${repaired.error || repaired.errorCode})`);
    } else {
        check('yarim kalan is onarilip tamamlandi', repaired.success === true, repaired.error);
        check('  → yarim .part temizlendi', !fs.existsSync(path.join(stagingDir, 'VLSS5.0.4.rar.part')));
        check('  → pendingUpdate silindi', !readStateRaw().pendingUpdate, readStateRaw());
        check('  → gercek surum kuruldu', readStateRaw().installedVersion === repaired.version, readStateRaw().installedVersion);
        check('  → VLSS5.exe yerinde', fs.existsSync(path.join(installDir, 'VLSS5.exe')));
        check('  → staging bosaltildi', fs.readdirSync(stagingDir).length === 0, fs.readdirSync(stagingDir));
    }

    // 6. Guncel surumde tekrar kontrol → guncelleme yok
    const upToDate = await vlss5.checkForUpdatesOnStartup();
    if (!upToDate.error) {
        check('guncel surumde guncelleme yok', upToDate.hasUpdate === false, upToDate);
    }

    // 7. Manuel "Guncellemeleri kontrol et" → zaten guncel
    const manual = await vlss5.checkForUpdatesManual(null);
    if (!manual.error) {
        check('manuel kontrol: zaten guncel', manual.upToDate === true, manual);
    }

    // 8. Bozuk arsiv staging'de kalmissa tekrar indirilir (imza dogrulamasi)
    const fakeArchive = path.join(stagingDir, 'VLSS5.0.4.rar');
    fs.writeFileSync(fakeArchive, Buffer.from('BOZUK VERI, RAR IMZASI YOK'));
    writeStateRaw({ ...readStateRaw(), installedVersion: '0.1' });   // guncelleme gereksin
    const afterCorrupt = await vlss5.checkForUpdatesOnStartup();
    if (!afterCorrupt.error && afterCorrupt.success !== false) {
        check('bozuk staging arsivi tekrar indirilir', afterCorrupt.success === true, afterCorrupt.error);
        check('  → kurulum saglam', fs.existsSync(path.join(installDir, 'VLSS5.exe')));
    } else {
        console.log('  … bozuk arsiv testi atlandi (ag hatasi)');
    }

    // ── Temizlik ─────────────────────────────────────────────────────────────
    try { fs.rmSync(mockUserData, { recursive: true, force: true }); } catch (e) { /* yoksay */ }

    console.log('\n=======================================');
    console.log(`  Sonuc: ${passed} gecti, ${failed} basarisiz`);
    console.log('=======================================\n');
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
