/**
 * test-reshade.js — exe API tespiti, URL kaynak çözücü ve ReShade manifesti testleri
 *
 * Electron dışında çalışır (`electron` mock'lanır). Ağ gerektiren testler
 * başarısız olursa atlanır, paketi kırmaz.
 *
 * Çalıştırma: node src/main/modules/test-reshade.js
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const projectRoot = path.join(__dirname, '..', '..', '..');
const mockUserData = path.join(os.tmpdir(), 'vmanager-reshade-test-' + Date.now());
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
        BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] }
    }
};

const exeApiDetector = require('./core/exeApiDetector');
const sourceResolver = require('./core/sourceResolver');
const validator = require('./core/manifestValidator');
const archive = require('./core/archive');

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

async function run() {
    console.log('\n=== ReShade / API tespiti testleri ===\n');

    // ── PE ayrıştırma ────────────────────────────────────────────────────────
    console.log('--- PE ayristirma (bit genisligi) ---');

    // Windows'un kendi 64-bit exe'si her makinede var
    const sys64 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe');
    // SysWOW64 32-bit karsiligi
    const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64', 'notepad.exe');

    if (fs.existsSync(sys64)) {
        const r = await exeApiDetector.detectApi(sys64);
        check('64-bit exe dogru tespit edilir', r.success && r.arch === 'x64' && r.is64Bit === true, { arch: r.arch });
    } else {
        console.log('  … System32\\notepad.exe yok, atlandi');
    }

    if (fs.existsSync(sys32)) {
        const r = await exeApiDetector.detectApi(sys32);
        check('32-bit exe dogru tespit edilir', r.success && r.arch === 'x86' && r.is64Bit === false, { arch: r.arch });
    } else {
        console.log('  … SysWOW64\\notepad.exe yok, atlandi');
    }

    const missing = await exeApiDetector.detectApi(path.join(mockUserData, 'yok.exe'));
    check('olmayan dosya hata doner', missing.success === false && !!missing.error);

    const notPe = path.join(mockUserData, 'duz.txt');
    fs.writeFileSync(notPe, 'bu bir exe degil');
    const notPeResult = await exeApiDetector.detectApi(notPe);
    check('PE olmayan dosya reddedilir', notPeResult.success === false, notPeResult.error);

    // ── API → proxy DLL eslemesi ─────────────────────────────────────────────
    console.log('\n--- API -> proxy DLL eslemesi ---');
    check('d3d12 -> dxgi.dll', exeApiDetector.getProxyDllForApi('d3d12') === 'dxgi.dll');
    check('d3d11 -> dxgi.dll', exeApiDetector.getProxyDllForApi('d3d11') === 'dxgi.dll');
    check('d3d10 -> dxgi.dll', exeApiDetector.getProxyDllForApi('d3d10') === 'dxgi.dll');
    check('d3d9 -> d3d9.dll', exeApiDetector.getProxyDllForApi('d3d9') === 'd3d9.dll');
    check('opengl -> opengl32.dll (64-bit olsa da)', exeApiDetector.getProxyDllForApi('opengl') === 'opengl32.dll');
    check('vulkan -> null (katman olarak kurulur)', exeApiDetector.getProxyDllForApi('vulkan') === null);
    check('bilinmeyen api -> null', exeApiDetector.getProxyDllForApi('bilinmeyen') === null);
    check('API secenek listesi dolu', exeApiDetector.getApiOptions().length >= 8);

    // ── Gerçek oyun kütüphanesi üzerinde tespit (varsa) ───────────────────────
    console.log('\n--- Gercek oyunlar (varsa) ---');
    const gamesFile = path.join(process.env.APPDATA || mockUserData, 'v-manager', 'games.json');
    if (fs.existsSync(gamesFile)) {
        try {
            const games = JSON.parse(fs.readFileSync(gamesFile, 'utf-8'));
            const sample = games.filter(g => g.exePath && /\.exe$/i.test(g.exePath) && fs.existsSync(g.exePath)).slice(0, 3);
            let detectedCount = 0;
            for (const g of sample) {
                const r = await exeApiDetector.detectApi(g.exePath);
                if (r.success && r.recommendedProxyDll) detectedCount++;
            }
            if (sample.length > 0) {
                check(`gercek oyunlarda API bulunur (${detectedCount}/${sample.length})`, detectedCount > 0);
            } else {
                console.log('  … kurulu oyun bulunamadi, atlandi');
            }
        } catch (e) {
            console.log(`  … games.json okunamadi, atlandi (${e.message})`);
        }
    } else {
        console.log('  … games.json yok, atlandi');
    }

    // ── Arşiv: SFX .exe desteği ──────────────────────────────────────────────
    console.log('\n--- Arsiv destegi ---');
    check('.exe (SFX kurulum) destekleniyor', archive.supportsFormat('.exe') === true);
    check('.rar destekleniyor', archive.supportsFormat('.rar') === true);

    // ── sourceResolver: sablon ───────────────────────────────────────────────
    console.log('\n--- Kaynak cozucu ---');
    check('sablon {version} doldurulur',
        sourceResolver.applyTemplate('ReShade_Setup_{version}_Addon.exe', { version: '6.8.0' }) === 'ReShade_Setup_6.8.0_Addon.exe');
    check('bilinmeyen yer tutucu korunur',
        sourceResolver.applyTemplate('a_{yok}_b', { version: '1' }) === 'a_{yok}_b');

    const staticVersion = await sourceResolver.discoverVersion({ version: '1.2.3' });
    check('static surum dogrudan doner', staticVersion === '1.2.3', staticVersion);

    // ── ReShade manifesti ────────────────────────────────────────────────────
    console.log('\n--- ReShade manifesti ---');
    const reshade = require('./official/reshade/manifest.json');
    const v = validator.validate(reshade);
    check('manifest gecerli', v.valid === true, v.errors);
    check('role = both (hem kurulum hem eklenti)', reshade.role === 'both');
    check('kaynak tipi url', reshade.source.type === 'url');
    check('surum kontrolu tanimli', reshade.source.versionCheck?.type === 'html_scrape');
    check('x64 -> ReShade64.dll', reshade.install.apiTargeting.sourceByArch.x64 === 'ReShade64.dll');
    check('x86 -> ReShade32.dll', reshade.install.apiTargeting.sourceByArch.x86 === 'ReShade32.dll');
    check('dx11 -> dxgi.dll', reshade.install.apiTargeting.renameByApi.d3d11 === 'dxgi.dll');
    check('opengl -> opengl32.dll', reshade.install.apiTargeting.renameByApi.opengl === 'opengl32.dll');
    check('shader paketi ek kaynak olarak tanimli',
        reshade.install.extraSources.some(e => /reshade-shaders/.test(e.url)));
    check('ReShade.ini olusturulacak',
        reshade.config[0].file === 'ReShade.ini' && reshade.config[0].createIfMissing === true);
    check('ini icerigi tutorial adimini geciyor',
        reshade.config[0].set['GENERAL.TutorialProgress'] === '4');

    // ── Validator: yeni alanlar ──────────────────────────────────────────────
    console.log('\n--- Validator yeni alanlar ---');
    const baseManifest = () => JSON.parse(JSON.stringify(reshade));

    let bad = baseManifest();
    bad.role = 'gecersiz';
    check('gecersiz role reddedilir', validator.validate(bad).valid === false);

    bad = baseManifest();
    bad.source.url = 'ftp://ornek.com/x.exe';
    check('http(s) olmayan url reddedilir', validator.validate(bad).valid === false);

    bad = baseManifest();
    delete bad.source.versionCheck;
    check('{version} varken versionCheck yoksa reddedilir', validator.validate(bad).valid === false);

    bad = baseManifest();
    delete bad.install.apiTargeting.sourceByArch;
    check('sourceByArch olmadan apiTargeting reddedilir', validator.validate(bad).valid === false);

    bad = baseManifest();
    bad.install.extraSources[0].url = 'dosya-degil';
    check('gecersiz extraSource url reddedilir', validator.validate(bad).valid === false);

    // GitHub manifestleri bozulmamalı
    const github = require('./official/optiscaler/manifest.json');
    check('mevcut github manifesti hala gecerli', validator.validate(github).valid === true);

    // ── Ağ testi (opsiyonel) ─────────────────────────────────────────────────
    console.log('\n--- Canli surum kesfi (ag) ---');
    try {
        const res = await sourceResolver.fetchReleases(reshade, { forceRefresh: true });
        if (res.error) {
            console.log(`  … ag hatasi, atlandi (${res.error})`);
        } else {
            const rel = res.releases[0];
            check('reshade.me surumu bulundu', /^[0-9]+\.[0-9]+\.[0-9]+$/.test(rel.tag), rel.tag);
            check('indirme adresi olusturuldu', rel.downloadUrl.includes(rel.tag), rel.downloadUrl);
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
