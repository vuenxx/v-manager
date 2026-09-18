/**
 * test-e2e-dummy.js — dummy-mod uçtan uca indirme & kurulum testi
 *
 * GitHub (vuenxx/dummy) repo'sundan release 0.1 paketini indirir,
 * geçici bir oyun klasörüne kurar, dummy-config.ini dosyasını günceller,
 * kurulumu ve dosyaları doğrular, sonra kaldırır.
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ── Mock electron ─────────────────────────────────────────────────────────────
const testDataDir = path.join(__dirname, '..', '..', '..', 'test-data');
const mockUserData = path.join(testDataDir, 'userData');
const mockGameDir = path.join(testDataDir, 'fake-game');

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

async function runE2ETest() {
    console.log('=======================================================');
    console.log(' Uçtan Uca (E2E) Manifest Kurulum Testi: dummy-mod');
    console.log('=======================================================');

    // 1. Modül sistemini başlat
    moduleManager.init();
    const dummyMod = moduleManager.getModule('dummy-mod');
    if (!dummyMod) {
        throw new Error('dummy-mod manifest yüklenemedi!');
    }
    console.log('✓ Modül manifesti yüklendi:', dummyMod.manifest.name);

    // Fake game setup
    const fakeExePath = path.join(mockGameDir, 'game.exe');
    fs.writeFileSync(fakeExePath, 'fake exe binary');
    
    // Save fake game to user-games.json state via config
    const fakeGameName = 'Fake Test Game';
    await config.saveUserGames({
        'fake-test-game': {
            name: fakeGameName,
            game_root: mockGameDir,
            exe_path: fakeExePath
        }
    });
    console.log('✓ Sahte oyun dizini hazırlandı:', mockGameDir);

    // 2. Fetch Releases
    console.log('\n--- 1. GitHub Releases Alınıyor ---');
    const releasesResult = await moduleEngine.getReleases(dummyMod.manifest, true);
    console.log('Releases:', JSON.stringify(releasesResult, null, 2));

    if (!releasesResult.releases || releasesResult.releases.length === 0) {
        throw new Error('Release bulunamadı!');
    }

    // 3. Kurulum Pipeline'ı Çalıştır
    console.log('\n--- 2. Kurulum Pipeline Çalıştırılıyor ---');
    const installResult = await moduleEngine.install(
        dummyMod.manifest,
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
    console.log('Loglar:', JSON.stringify(installResult.log, null, 2));

    if (!installResult.success) {
        throw new Error(`Kurulum başarısız: ${installResult.message}`);
    }

    // 4. Doğrulama
    console.log('\n--- 3. Kurulan Dosyaların Doğrulanması ---');
    const expectedFile1 = path.join(mockGameDir, 'dummy-mod-file.asi');
    const expectedFile2 = path.join(mockGameDir, 'dummy-config.ini');
    const expectedFolder = path.join(mockGameDir, 'dummy-folder');
    const expectedSubFile = path.join(expectedFolder, 'test.dummy');

    if (!fs.existsSync(expectedFile1)) throw new Error(`Eksik dosya: ${expectedFile1}`);
    console.log('✓ dummy-mod-file.asi yerinde.');

    if (!fs.existsSync(expectedFile2)) throw new Error(`Eksik dosya: ${expectedFile2}`);
    console.log('✓ dummy-config.ini yerinde.');

    if (!fs.existsSync(expectedSubFile)) throw new Error(`Eksik alt dosya: ${expectedSubFile}`);
    console.log('✓ dummy-folder/test.dummy yerinde.');

    // Config değişikliklerinin doğrulanması
    const iniContent = fs.readFileSync(expectedFile2, 'utf-8');
    console.log('\nConfig içeriği:\n', iniContent);
    if (!iniContent.includes('DummySection') || !iniContent.includes('TestSetting')) {
        throw new Error('dummy-config.ini içine yazılması gereken ayarlar bulunamadı!');
    }
    console.log('✓ dummy-config.ini başarıyla güncellendi (DummySection.TestSetting=enabled).');

    // 5. Modülu Kaldırma (Uninstall)
    console.log('\n--- 4. Modül Kaldırma (Uninstall) ---');
    const uninstallResult = await moduleEngine.uninstall(dummyMod.manifest, fakeGameName, fakeExePath);
    console.log('Kaldırma Sonucu:', uninstallResult);

    if (fs.existsSync(expectedFile1)) throw new Error('dummy-mod-file.asi kaldırılamadı!');
    if (fs.existsSync(expectedFile2)) throw new Error('dummy-config.ini kaldırılamadı!');
    if (fs.existsSync(expectedFolder)) throw new Error('dummy-folder kaldırılamadı!');

    console.log('✓ Tüm mod dosyaları temizlendi.');
    console.log('\n=======================================================');
    console.log(' UÇTAN UCA TEST BAŞARIYLA TAMAMLANDI!');
    console.log('=======================================================');
}

runE2ETest().catch(err => {
    console.error('\nE2E TEST HATA:', err);
    process.exit(1);
});
