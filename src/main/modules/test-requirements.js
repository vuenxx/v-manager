/**
 * test-requirements.js — Manifest ön koşul (`requires`) sistemi ve MFG Unlock manifesti
 *
 * Electron dışında çalışır (`electron` mock'lanır). Ağ gerektiren tek test
 * başarısız olursa atlanır, paketi kırmaz.
 *
 * Çalıştırma: node src/main/modules/test-requirements.js
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const projectRoot = path.join(__dirname, '..', '..', '..');
const mockUserData = path.join(os.tmpdir(), 'vmanager-req-test-' + Date.now());
fs.mkdirSync(mockUserData, { recursive: true });

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
        shell: { openPath: async () => '' },
        dialog: {},
        ipcMain: { handle: () => {}, on: () => {} },
        BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] }
    }
};

const validator = require('./core/manifestValidator');
const moduleManager = require('./core/moduleManager');
const moduleDetector = require('./core/moduleDetector');
const requirementChecker = require('./core/requirementChecker');
const sourceResolver = require('./core/sourceResolver');
const config = require('../config');

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

/** games.json'u test senaryosuna göre yeniden yazar ve belleğe yükler. */
function setGames(list) {
    fs.writeFileSync(path.join(mockUserData, 'games.json'), JSON.stringify(list, null, 2), 'utf-8');
    config.loadExistingGames();
}

async function run() {
    console.log('\n=== Ön koşul (requires) testleri ===\n');

    moduleManager.init();

    const mfg = require('./official/mfg-unlock/manifest.json');
    const reshade = require('./official/reshade/manifest.json');

    // ── Manifest doğrulama ───────────────────────────────────────────────
    console.log('--- Manifest dogrulama ---');
    const v = validator.validate(mfg);
    check('mfg-unlock manifesti gecerli', v.valid === true, v.errors);
    check('bilinmeyen anahtar uyarisi yok (requires taniniyor)',
        !(v.warnings || []).some(w => w.includes("'requires'")), v.warnings);

    const clone = () => JSON.parse(JSON.stringify(mfg));

    let bad = clone();
    bad.requires = 'reshade';
    check('requires dizi degilse reddedilir', validator.validate(bad).valid === false);

    bad = clone();
    bad.requires = [{ severity: 'block' }];
    check('moduleId olmadan reddedilir', validator.validate(bad).valid === false);

    bad = clone();
    bad.requires = [{ moduleId: 'mfg-unlock' }];
    check('kendine bagimlilik reddedilir', validator.validate(bad).valid === false);

    bad = clone();
    bad.requires = [{ moduleId: 'reshade', severity: 'belki' }];
    check('gecersiz severity reddedilir', validator.validate(bad).valid === false);

    bad = clone();
    bad.addons = [{ moduleId: 'reshade', label: 'ReShade' }];
    check('ayni modul hem requires hem addons ise reddedilir', validator.validate(bad).valid === false);

    bad = clone();
    bad.requires = [{ moduleId: 'reshade', severity: 'warn' }];
    check('severity warn kabul edilir', validator.validate(bad).valid === true, validator.validate(bad).errors);

    check('mevcut reshade manifesti hala gecerli', validator.validate(reshade).valid === true);

    // ── Manifest içeriği ─────────────────────────────────────────────────
    console.log('\n--- MFG Unlock manifest icerigi ---');
    check('reshade on kosul olarak tanimli',
        mfg.requires.some(r => r.moduleId === 'reshade' && r.severity === 'block'));
    check('github kaynagi dogru repoya bagli', mfg.source.repo === 'mavismmg/MFGAdaUnlock-RenoDx');
    check('asset filtresi .addon64', JSON.stringify(mfg.source.asset).includes('*.addon64'));
    check('hedef oyun exe klasoru', mfg.install.destination === 'game_exe');
    check('tespit dosya adiyla yapiliyor',
        mfg.detect.match.anyFileName.includes('renodx-mfgunlock.addon64'));
    check('detect onceligi reshade altinda', mfg.detect.priority < reshade.detect.priority);
    check('state bayragi benzersiz', mfg.state.flag === 'hasMfgUnlock');
    check('ayarlar ReShade.ini icine yaziliyor', mfg.config[0].file === 'ReShade.ini');
    check('[RenoDX.MFGUnlock] bolumu semada var', !!mfg.config[0].schema['RenoDX.MFGUnlock']);
    check('17 ayar tanimli', Object.keys(mfg.config[0].schema['RenoDX.MFGUnlock']).length === 17,
        Object.keys(mfg.config[0].schema['RenoDX.MFGUnlock']).length);
    check('kurulumda sadece Enabled yaziliyor',
        Object.keys(mfg.config[0].set).length === 1 && mfg.config[0].set['RenoDX.MFGUnlock.Enabled'] === '1');

    // ReShade.ini 0/1 bekliyor — 'toggle' tipi true/false yazdigi icin
    // her boolean ayar dropdown olmali.
    const boolKeys = Object.entries(mfg.config[0].schema['RenoDX.MFGUnlock'])
        .filter(([, d]) => d.type === 'toggle');
    check('boolean ayarlar toggle degil dropdown (0/1 yazilmali)', boolKeys.length === 0,
        boolKeys.map(([k]) => k));

    check('kaldirma addon dosyasini siliyor',
        mfg.uninstall.files.includes('renodx-mfgunlock.addon64'));
    check('telifli dll notta belirtilmis', /nvngx_dlssg/.test(mfg.metadata.notes));

    // ── moduleDetector.isModuleInstalledIn ───────────────────────────────
    console.log('\n--- Disk uzerinde modul tespiti ---');
    const emptyDir = path.join(mockUserData, 'BosOyun');
    fs.mkdirSync(emptyDir, { recursive: true });

    const noHit = await moduleDetector.isModuleInstalledIn('reshade', emptyDir);
    check('bos klasorde reshade bulunmaz', noHit.installed === false);

    const missingDir = await moduleDetector.isModuleInstalledIn('reshade', path.join(mockUserData, 'yok'));
    check('olmayan klasor hata firlatmaz', missingDir.installed === false && missingDir.reason === 'no-dir');

    const noDetector = await moduleDetector.isModuleInstalledIn('boyle-bir-modul-yok', emptyDir);
    check('tespit kurali olmayan modul', noDetector.installed === false && noDetector.reason === 'no-detector');

    // MFG addon dosyasi ad eslesmesiyle bulunur (FileDescription gerekmez)
    const mfgDir = path.join(mockUserData, 'MfgKurulu');
    fs.mkdirSync(mfgDir, { recursive: true });
    fs.writeFileSync(path.join(mfgDir, 'renodx-mfgunlock.addon64'), Buffer.alloc(16));
    const mfgHit = await moduleDetector.isModuleInstalledIn('mfg-unlock', mfgDir);
    check('addon dosyasi diskte bulunur', mfgHit.installed === true && mfgHit.via === 'disk', mfgHit);

    // ── requirementChecker ───────────────────────────────────────────────
    console.log('\n--- On kosul cozumleyici ---');

    // 1) Ne diskte ne kayitta → engellenir
    setGames([{ name: 'TestOyun', exePath: path.join(emptyDir, 'TestOyun.exe') }]);
    let res = await requirementChecker.checkRequirements(mfg, { gameName: 'TestOyun', gameDir: emptyDir });
    check('reshade yokken saglanmaz', res.satisfied === false);
    check('failures dolu ve conditionChecker sekliyle uyumlu',
        res.failures.length === 1 && res.failures[0].type === 'requires' && !!res.failures[0].message, res.failures);
    check('sonuc satirinda modul adi cozulmus', res.results[0].name === 'ReShade', res.results[0]);
    check('reshade yuklu oldugu icin installable', res.results[0].installable === true);

    // 2) Diskte yok ama games.json'da hasReshade → state uzerinden saglanir
    setGames([{ name: 'TestOyun', exePath: path.join(emptyDir, 'TestOyun.exe'), hasReshade: true, reshadeVersion: '6.8.0' }]);
    res = await requirementChecker.checkRequirements(mfg, { gameName: 'TestOyun', gameDir: emptyDir });
    check('games.json bayragi yedek olarak calisir', res.satisfied === true && res.results[0].via === 'state', res.results[0]);
    check('state uzerinden surum de okunur', res.results[0].version === '6.8.0');

    // 3) installedMods kaydi da yeterli
    setGames([{ name: 'TestOyun', exePath: path.join(emptyDir, 'TestOyun.exe'), installedMods: { reshade: { installed: true } } }]);
    res = await requirementChecker.checkRequirements(mfg, { gameName: 'TestOyun', gameDir: emptyDir });
    check('installedMods kaydi da yeterli', res.satisfied === true, res.results[0]);

    // 4) severity warn → engellemez
    setGames([{ name: 'TestOyun', exePath: path.join(emptyDir, 'TestOyun.exe') }]);
    const warnManifest = clone();
    warnManifest.requires = [{ moduleId: 'reshade', severity: 'warn' }];
    res = await requirementChecker.checkRequirements(warnManifest, { gameName: 'TestOyun', gameDir: emptyDir });
    check('warn seviyesi kurulumu engellemez', res.satisfied === true && res.results[0].satisfied === false);

    // 5) enabled:false → tamamen atlanir
    const offManifest = clone();
    offManifest.requires = [{ moduleId: 'reshade', enabled: false }];
    res = await requirementChecker.checkRequirements(offManifest, { gameName: 'TestOyun', gameDir: emptyDir });
    check('enabled:false on kosulu atlanir', res.satisfied === true && res.results.length === 0);

    // 6) requires yoksa hep gecer
    res = await requirementChecker.checkRequirements(reshade, { gameName: 'TestOyun', gameDir: emptyDir });
    check('requires tanimsizsa saglanmis sayilir', res.satisfied === true && res.results.length === 0);

    // 7) Yuklu olmayan bir modul referansi → installable false
    const ghostManifest = clone();
    ghostManifest.requires = [{ moduleId: 'olmayan-modul' }];
    res = await requirementChecker.checkRequirements(ghostManifest, { gameName: 'TestOyun', gameDir: emptyDir });
    check('yuklu olmayan modul icin installable false',
        res.satisfied === false && res.results[0].installable === false);

    // ── Motor kapisi: indirme baslamadan durmali ─────────────────────────
    console.log('\n--- Motor kapisi (adim 5c) ---');
    const moduleEngine = require('./core/moduleEngine');
    const gameDir = path.join(mockUserData, 'MotorOyun');
    fs.mkdirSync(gameDir, { recursive: true });
    const fakeExe = path.join(gameDir, 'MotorOyun.exe');
    fs.writeFileSync(fakeExe, Buffer.alloc(64));
    setGames([{ name: 'MotorOyun', exePath: fakeExe, gameRoot: gameDir, source: 'manual', upscalers: {} }]);

    const steps = [];
    const installResult = await moduleEngine.install(
        mfg, 'MotorOyun', fakeExe, 'latest', {},
        (p) => steps.push(p.message)
    );
    check('reshade yokken kurulum basarisiz', installResult.success === false, installResult.message);
    check('hata yapisal failures tasiyor',
        Array.isArray(installResult.failures) && installResult.failures[0]?.type === 'requires',
        installResult.failures);
    check('indirme hic baslamadi', !steps.some(m => /indiril|İndiril/i.test(m || '')), steps);

    // ── Noktalı INI bölüm adı ────────────────────────────────────────────
    // ReShade addon'ları "[RenoDX.MFGUnlock]" gibi nokta içeren bölüm adları
    // kullanıyor. configEditor eskiden İLK noktadan bölüyordu ve bu ayarları
    // "[RenoDX]" altına "MFGUnlock.Enabled" olarak yazıyordu.
    console.log('\n--- Noktali INI bolum adi ---');
    const configEditor = require('./core/configEditor');
    const iniEditor = require('../mods/iniEditor');
    const iniPath = path.join(mockUserData, 'ReShade.ini');
    fs.writeFileSync(iniPath, '[GENERAL]\nPerformanceMode=0\n', 'utf-8');

    await configEditor.applyChanges(iniPath, 'ini', {
        'RenoDX.MFGUnlock.Enabled': '1',
        'RenoDX.MFGUnlock.MaxCount': '4',
        'GENERAL.TutorialProgress': '4'
    }, {});

    const iniRead = iniEditor.readIni(iniPath);
    const iniData = iniRead.data || iniRead;
    check('noktali bolum adi korunur', !!iniData['RenoDX.MFGUnlock'], Object.keys(iniData));
    check('yanlis [RenoDX] bolumu olusmaz', !iniData['RenoDX']);
    check('anahtar bolum adindan ayriklanmis', iniData['RenoDX.MFGUnlock']?.Enabled === '1');
    check('ikinci anahtar da dogru', iniData['RenoDX.MFGUnlock']?.MaxCount === '4');
    check('tek noktali anahtarlar bozulmadi',
        iniData['GENERAL']?.TutorialProgress === '4' && iniData['GENERAL']?.PerformanceMode === '0', iniData['GENERAL']);

    // ── Ağ testi (opsiyonel) ─────────────────────────────────────────────
    console.log('\n--- Canli surum kesfi (ag) ---');
    try {
        const rel = await sourceResolver.fetchReleases(mfg, { forceRefresh: true });
        if (rel.error) {
            console.log(`  … ag hatasi, atlandi (${rel.error})`);
        } else {
            const latest = rel.releases[0];
            check('release bulundu', !!latest && !!latest.tag, latest);
            check('asset adi .addon64', /\.addon64$/i.test(latest.assetName || ''), latest.assetName);
        }
    } catch (e) {
        console.log(`  … ag testi atlandi (${e.message})`);
    }

    try { fs.rmSync(mockUserData, { recursive: true, force: true }); } catch (e) { /* yoksay */ }

    console.log('\n=======================================');
    console.log(`  Sonuc: ${passed} gecti, ${failed} basarisiz`);
    console.log('=======================================\n');
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
