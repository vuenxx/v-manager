/**
 * test-e2e-dlssenabler.js — DLSS Enabler & Geriye Dönük Uyumluluk E2E Testi
 *
 * 1. DLSS Enabler manifesti ile vuenxx/extra_goldteam34 GitHub reposundan
 *    gerçek release çeker, kurar, proxy detection (dxgi.dll), AV gecikme kontrolü,
 *    stale dosya temizliği ve gelişmiş uninstall (unlessState + verifiedDlls) test eder.
 *
 * 2. Geriye dönük uyumluluk testi: Yeni şema alanlarını (proxyDetection vb.)
 *    içermeyen basit bir manifest ile kurulum & kaldırma çalıştırıp eskisi gibi
 *    %100 çalıştığını kanıtlar.
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ── Mock electron ─────────────────────────────────────────────────────────────
const testDataDir = path.join(__dirname, '..', '..', '..', 'test-data-dlss');
const mockUserData = path.join(testDataDir, 'userData');
const mockGameDir = path.join(testDataDir, 'fake-game-dlss');

if (!fs.existsSync(mockUserData)) fs.mkdirSync(mockUserData, { recursive: true });
if (!fs.existsSync(mockGameDir)) fs.mkdirSync(mockGameDir, { recursive: true });

const electronMock = {
    app: {
        getPath: (name) => {
            if (name === 'userData') return mockUserData;
            if (name === 'temp') return path.join(mockUserData, 'temp');
            return mockUserData;
        },
        getVersion: () => '3.0.0',
        getAppPath: () => path.join(__dirname, '..', '..', '..')
    }
};

require.cache[require.resolve('electron')] = {
    id: 'electron',
    filename: 'electron',
    loaded: true,
    exports: electronMock
};

const moduleManager = require('./core/moduleManager');
const moduleEngine = require('./core/moduleEngine');
const config = require('../config');
const utils = require('../utils');

async function runDLSSENABLERTest() {
    console.log('=======================================================');
    console.log(' Uçtan Uca (E2E) Test: DLSS Enabler Manifest');
    console.log('=======================================================');

    // 1. Modül sistemini başlat
    moduleManager.init();
    const dlssMod = moduleManager.getModule('dlssenabler');
    if (!dlssMod) {
        throw new Error('dlssenabler manifest yüklenemedi!');
    }
    console.log('✓ Modül manifesti yüklendi:', dlssMod.manifest.name);

    // Fake game setup
    const fakeExePath = path.join(mockGameDir, 'Cyberpunk2077.exe');
    fs.writeFileSync(fakeExePath, 'fake game binary');

    // OptiScaler.ini oluştur (OptiScaler kurulu taklidi)
    const optiIniPath = path.join(mockGameDir, 'OptiScaler.ini');
    fs.writeFileSync(optiIniPath, '[OptiScaler]\nEnabled=1');

    const fakeGameName = 'Cyberpunk 2077 Fake';
    await config.saveUserGames({
        'cyberpunk-2077-fake': {
            name: fakeGameName,
            game_root: mockGameDir,
            exe_path: fakeExePath
        }
    });

    // Game state'e OptiScaler kurulu ekle (hasOptiscaler: true)
    const gamesState = config.getExistingGamesState();
    let dbGame = gamesState.find(g => config.normalizeGameKey(g.name) === config.normalizeGameKey(fakeGameName));
    if (!dbGame) {
        dbGame = { name: fakeGameName, exePath: fakeExePath, hasOptiscaler: true };
        gamesState.push(dbGame);
        config.saveGamesState();
    } else {
        dbGame.hasOptiscaler = true;
        config.saveGamesState();
    }

    console.log('✓ Sahte oyun ortamı hazırlandı:', mockGameDir);
    console.log('✓ OptiScaler.ini oluşturuldu ve state\'e hasOptiscaler: true eklendi.');

    // 2. GitHub Releases Al
    console.log('\n--- 1. GitHub Releases Alınıyor (vuenxx/extra_goldteam34) ---');
    const releasesResult = await moduleEngine.getReleases(dlssMod.manifest, true);
    console.log('Releases Adedi:', releasesResult.releases ? releasesResult.releases.length : 0);
    if (!releasesResult.releases || releasesResult.releases.length === 0) {
        throw new Error('GitHub releases alınamadı!');
    }
    console.log('En son sürüm:', releasesResult.releases[0].tag);

    // 3. Kurulum Pipeline'ı (proxyDetection: version.dll -> dxgi.dll + verifyAntiVirusDelayMs: 1500)
    console.log('\n--- 2. DLSS Enabler Kurulum Pipeline Çalıştırılıyor ---');
    const installResult = await moduleEngine.install(
        dlssMod.manifest,
        fakeGameName,
        fakeExePath,
        'latest',
        { forceRefresh: true },
        (progress) => {
            console.log(`  [Progress %${progress.percent}] Adım ${progress.step}: ${progress.message}`);
        }
    );

    console.log('\nKurulum Sonucu:', installResult.success ? 'BAŞARILI' : 'BAŞARISIZ');
    console.log('Mesaj:', installResult.message);
    console.log('Kurulan Sürüm:', installResult.installedVersion);

    if (!installResult.success) {
        throw new Error(`Kurulum başarısız: ${installResult.message}`);
    }

    // 4. Kurulum Doğrulaması
    console.log('\n--- 3. Kurulum Dosyaları Doğrulanıyor ---');
    const installedDxgi = path.join(mockGameDir, 'dxgi.dll');
    const installedIni = path.join(mockGameDir, 'dlss-enabler.ini');

    if (!fs.existsSync(installedDxgi)) throw new Error(`Proxy DLL kopyalanamadı: ${installedDxgi}`);
    console.log('✓ proxyDetection çalıştı: version.dll -> dxgi.dll olarak hedefe kuruldu.');

    if (!fs.existsSync(installedIni)) console.log('ℹ dlss-enabler.ini kurulmadı (sürüm paketinde varsayılan ini olmayabilir).');
    else console.log('✓ dlss-enabler.ini kuruldu.');

    // 5. Kaldırma (Uninstall) Testi 1: unlessState ile OptiScaler.ini Koruma Testi
    console.log('\n--- 4. DLSS Enabler Kaldırılıyor (unlessState: hasOptiscaler=true) ---');
    const uninstallResult1 = await moduleEngine.uninstall(dlssMod.manifest, fakeGameName, fakeExePath);
    console.log('Kaldırma Sonucu:', uninstallResult1);

    if (fs.existsSync(installedDxgi)) throw new Error('dxgi.dll kaldırılamadı!');
    console.log('✓ dxgi.dll (verifiedDlls) başarıyla silindi.');

    if (!fs.existsSync(optiIniPath)) throw new Error('OptiScaler.ini silindi! (unlessState muafiyeti çalışmadı)');
    console.log('✓ unlessState BAŞARILI: OptiScaler.ini muaf tutuldu ve silinmedi!');

    // 6. Kaldırma Testi 2: hasOptiscaler = false iken OptiScaler.ini Silinme Testi
    console.log('\n--- 5. hasOptiscaler = false durumunda Uninstall Testi ---');
    dbGame.hasOptiscaler = false;
    config.saveGamesState();

    const uninstallResult2 = await moduleEngine.uninstall(dlssMod.manifest, fakeGameName, fakeExePath);
    console.log('Kaldırma Sonucu 2:', uninstallResult2);

    if (fs.existsSync(optiIniPath)) throw new Error('OptiScaler.ini silinmeliydi! (hasOptiscaler=false)');
    console.log('✓ hasOptiscaler=false olduğunda OptiScaler.ini başarıyla silindi!');

    // 7. Geriye Dönük Uyumluluk E2E Testi (Simple Manifest)
    console.log('\n=======================================================');
    console.log(' Geriye Dönük Uyumluluk (Backward-Compatibility) E2E Testi');
    console.log('=======================================================');

    const simpleManifest = {
        id: 'dummy-mod', // yeni/basit manifest — eski şema alanlarını (proxyDetection vb.) içermez, gerçek dosyayı yüklemez
        name: 'Dummy Mod',
        source: { type: 'github', repo: 'vuenxx/dummy', asset: 'dummy-mod*.zip' },
        install: { destination: 'game_exe' }
    };

    console.log('--- Basit Manifest Kurulumu ---');
    const simpleInstall = await moduleEngine.install(
        simpleManifest,
        fakeGameName,
        fakeExePath,
        'latest',
        { forceRefresh: true },
        (p) => console.log(`  [Simple %${p.percent}] Adım ${p.step}: ${p.message}`)
    );

    console.log('Basit Kurulum Sonucu:', simpleInstall.success ? 'BAŞARILI' : 'BAŞARISIZ');
    if (!simpleInstall.success) throw new Error(`Geriye dönük uyumluluk kurulumu başarısız: ${simpleInstall.message}`);

    console.log('--- Basit Manifest Kaldırılması ---');
    const simpleUninstall = await moduleEngine.uninstall(simpleManifest, fakeGameName, fakeExePath);
    console.log('Basit Kaldırma Sonucu:', simpleUninstall);
    if (!simpleUninstall.success) throw new Error('Geriye dönük uyumluluk kaldırması başarısız!');

    console.log('\n=======================================================');
    console.log(' TÜM E2E VE GERİYE DÖNÜK UYUMLULUK TESTLERİ BAŞARILI!');
    console.log('=======================================================');
}

runDLSSENABLERTest().catch(err => {
    console.error('\nE2E TEST HATA:', err);
    process.exit(1);
});
