/**
 * test-dlssg-sm86.js — `github_files` kaynağı, enjeksiyon eşlemesi ve
 * yabancı dosya çakışması testleri
 *
 * Electron dışında çalışır (`electron` mock'lanır). Ağ gerektiren testler
 * başarısız olursa atlanır, paketi kırmaz.
 *
 * Çalıştırma: node src/main/modules/test-dlssg-sm86.js
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const projectRoot = path.join(__dirname, '..', '..', '..');
const mockUserData = path.join(os.tmpdir(), 'vmanager-dlssg-test-' + Date.now());
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

const sourceResolver = require('./core/sourceResolver');
const validator = require('./core/manifestValidator');
const conflictChecker = require('./core/conflictChecker');
const moduleManager = require('./core/moduleManager');
const moduleEngine = require('./core/moduleEngine');

// Sahiplik testleri detect bloklarina dayanir; uygulamada init() acilista
// cagriliyor, testte elle yapilmali.
moduleManager.ensureInit();

const MANIFEST_PATH = path.join(__dirname, 'official', 'dlssg-for-sm86', 'manifest.json');

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
    console.log('\n=== dlssg_for_sm86 / github_files testleri ===\n');

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));

    // ── Manifest ─────────────────────────────────────────────────────────────
    console.log('--- Manifest ---');
    const v = validator.validate(manifest);
    check('manifest gecerli', v.valid, v.errors);
    check('kaynak tipi github_files', manifest.source.type === 'github_files');
    check('sabit dosya listesi ini icerir', manifest.source.files.includes('dlssg_sm86.ini'));

    const pd = manifest.install.proxyDetection;
    check('6 enjeksiyon adayi var', pd.candidates.length === 6, pd.candidates);
    check('her adayin kendi kaynak yolu var',
        pd.candidates.every(c => typeof pd.sourceByTarget[c] === 'string'));
    check('kaynak yolun son parcasi hedef adla ayni (yeniden adlandirma yok)',
        pd.candidates.every(c => path.basename(pd.sourceByTarget[c]) === c));
    check('varsayilan hedef kok dizindeki version.dll',
        pd.defaultTarget === 'version.dll' && pd.sourceByTarget['version.dll'] === 'version.dll');
    check('descriptionMatch yok (DLL\'de surum kaynagi bulunmuyor)', pd.descriptionMatch === undefined);
    check('kaldirma hash dogrulamali', manifest.uninstall.verifiedDlls[0].matchModFileHash === true);

    // Bozuk varyantlar reddediliyor mu?
    const missingMap = JSON.parse(JSON.stringify(manifest));
    delete missingMap.install.proxyDetection.sourceByTarget['dxgi.dll'];
    check('eksik sourceByTarget girdisi reddedilir', validator.validate(missingMap).valid === false);

    const noFiles = JSON.parse(JSON.stringify(manifest));
    delete noFiles.source.files;
    delete noFiles.install.proxyDetection.sourceByTarget;
    check('indirilecek dosya tanimsizsa reddedilir', validator.validate(noFiles).valid === false);

    // ── raw URL uretimi ──────────────────────────────────────────────────────
    console.log('\n--- raw.githubusercontent URL uretimi ---');
    const url = sourceResolver.rawFileUrl(manifest.source.repo, '0.3.3', 'alternatives/dxgi.dll');
    check('URL dogru kuruluyor',
        url === 'https://raw.githubusercontent.com/sdli1995/dlssg_for_sm86/0.3.3/alternatives/dxgi.dll', url);
    check('ters bolu duz bolue cevrilir',
        sourceResolver.rawFileUrl('a/b', '1.0', 'alt\\x.dll').endsWith('/alt/x.dll'));

    // ── Yabanci dosya cakismasi ──────────────────────────────────────────────
    console.log('\n--- Yabanci dosya cakismasi ---');
    const msg = conflictChecker.injectionConflictMessage('dxgi.dll');
    check('mesaj enjeksiyon adini icerir', msg.includes('dxgi.dll'), msg);
    check('mesaj baska tip denemeyi soyler', msg.includes('farklı bir enjeksiyon tipi'), msg);

    const gameDir = path.join(mockUserData, 'game');
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'dxgi.dll'), 'oyunun kendi dosyasi');

    const noDetect = JSON.parse(JSON.stringify(manifest));
    delete noDetect.detect;
    const skipped = await conflictChecker.findForeignTargetConflict(noDetect, gameDir, ['dxgi.dll']);
    check('detect tanimlamayan manifest icin kontrol atlanir', skipped === null, skipped);

    const absent = await conflictChecker.findForeignTargetConflict(manifest, gameDir, ['winmm.dll']);
    check('hedefte dosya yoksa cakisma yok', absent === null, absent);

    // Sahibi bilinmeyen (oyunun kendi) dosyasi → kurulum durmali
    const foreign = await conflictChecker.findForeignTargetConflict(manifest, gameDir, ['dxgi.dll']);
    check('oyuna ait dosya cakisma olarak bildirilir', foreign === 'dxgi.dll', foreign);

    // Ayni dosya BIZE aitse (yaninda dlssg_sm86.ini var) cakisma sayilmamali —
    // guncelleme / yeniden kurulum bu yoldan gecer.
    fs.writeFileSync(path.join(gameDir, 'dlssg_sm86.ini'), '[General]\nEnabled=1\n');
    const ours = await conflictChecker.findForeignTargetConflict(manifest, gameDir, ['dxgi.dll']);
    check('kendi kurulumumuz cakisma sayilmaz', ours === null, ours);

    // ── Onbellek yerlesimi (depo yapisi korunur) ─────────────────────────────
    console.log('\n--- Onbellek yerlesimi ---');
    {
        const cacheDir = path.join(mockUserData, 'cache-layout');
        fs.mkdirSync(path.join(cacheDir, 'alternatives'), { recursive: true });
        fs.writeFileSync(path.join(cacheDir, 'version.dll'), 'ROOT');
        fs.writeFileSync(path.join(cacheDir, 'alternatives', 'd3d12.dll'), 'ALT');

        // Alt klasordeki dosya TAM yoluyla bulunur — kokteki version.dll ile
        // karismaz; ikisi ayri binary.
        const resolvedAlt = moduleEngine.resolveRepoPathIn(cacheDir, 'alternatives/d3d12.dll');
        check('alt klasordeki proxy tam yoluyla bulunur',
            resolvedAlt === path.join(cacheDir, 'alternatives', 'd3d12.dll'), resolvedAlt);

        const resolvedRoot = moduleEngine.resolveRepoPathIn(cacheDir, 'version.dll');
        check('kok dizindeki proxy bulunur',
            resolvedRoot === path.join(cacheDir, 'version.dll'), resolvedRoot);

        check('indirilmemis dosya null doner',
            moduleEngine.resolveRepoPathIn(cacheDir, 'alternatives/winmm.dll') === null);
    }

    // Eski (duzlestirilmis) onbellek depo yapisina TASINIR, yeniden indirilmez.
    {
        const legacyDir = path.join(mockUserData, 'cache-legacy');
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, 'version.dll'), 'ROOT');
        fs.writeFileSync(path.join(legacyDir, 'dxgi.dll'), 'ALT-DXGI');

        moduleEngine.migrateFlatRepoFiles(legacyDir, manifest);

        const moved = path.join(legacyDir, 'alternatives', 'dxgi.dll');
        check('duz indirilmis proxy alt klasore tasinir',
            fs.existsSync(moved) && fs.readFileSync(moved, 'utf-8') === 'ALT-DXGI');
        check('tasindiktan sonra kok dizinde kopya kalmaz',
            !fs.existsSync(path.join(legacyDir, 'dxgi.dll')));
        check('kok dizin dosyasina dokunulmaz',
            fs.existsSync(path.join(legacyDir, 'version.dll')));
        check('tasinan dosya yeniden indirme gerektirmez',
            moduleEngine.resolveRepoPathIn(legacyDir, 'alternatives/dxgi.dll') === moved);
    }

    // ── Ag: surum listesi ────────────────────────────────────────────────────
    console.log('\n--- Ag testleri (internet yoksa atlanir) ---');
    try {
        const result = await sourceResolver.fetchReleases(manifest, { forceRefresh: true });
        if (result.error) {
            console.log(`  … surum listesi alinamadi, atlandi (${result.error})`);
        } else {
            check('surum listesi doner', result.releases.length > 0, result.error);
            check('kayitlar dosya modunda (asset yok)',
                result.releases.every(r => r.fileMode === true && !r.downloadUrl));
            const latest = sourceResolver.findRelease(result.releases, 'latest');
            check('latest secimi calisir', !!latest && !!latest.tag, latest);

            if (latest) {
                const destDir = path.join(mockUserData, 'download');
                const written = await sourceResolver.downloadFiles(
                    manifest.source.repo, latest.tag, ['dlssg_sm86.ini'], destDir
                );
                const iniPath = path.join(destDir, 'dlssg_sm86.ini');
                check('kok dizin dosyasi kok dizine iner', written.length === 1 && fs.existsSync(iniPath));
                if (fs.existsSync(iniPath)) {
                    const body = fs.readFileSync(iniPath, 'utf-8');
                    check('ini beklenen bolumleri icerir',
                        body.includes('[FrameGeneration]') && body.includes('MaxGeneratedFrames'));

                    // Manifest semasindaki her anahtar gercekten ini'de var mi?
                    const schema = manifest.config[0].schema;
                    const missingKeys = [];
                    for (const section of Object.keys(schema)) {
                        for (const key of Object.keys(schema[section])) {
                            if (!new RegExp(`^\\s*${key}\\s*=`, 'mi').test(body)) {
                                missingKeys.push(`${section}.${key}`);
                            }
                        }
                    }
                    check('sema anahtarlari ini ile ortusur', missingKeys.length === 0, missingKeys);
                }
            }
        }
    } catch (e) {
        console.log(`  … ag testi atlandi (${e.message})`);
    }

    console.log(`\n=== Sonuc: ${passed} basarili, ${failed} basarisiz ===\n`);

    try { fs.rmSync(mockUserData, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
    console.error('Test hatasi:', err);
    process.exit(1);
});
