/**
 * test-e2e-anrfg.js — ANR FG (anr-fg) uçtan uca kurulum/kaldırma testi (ağ gerektirmez)
 *
 * Sahte bir oyun klasörüne gerçek OptiBuilder 10.0.2 OptiScaler'ını (dxgi.dll + OptiScaler.ini)
 * koyar, ANR FG paketini yerel mod önbelleğine açar, sonra:
 *   - kurulum: dosyalar OptiScaler/custom/Apex Neural Rendering FG altına, paketin kök
 *     dosyaları (install.cmd, README.txt) DIŞARIDA; OptiScaler.ini (exe yanında) güncellenir
 *   - yeniden kurulum: ilk kurulumdan önceki ini değerleri korunur
 *   - Yönet ekranının config yolu exe klasöründen bulunur
 *   - kaldırma: klasör silinir, ini değerleri eski haline döner, OptiScaler'a dokunulmaz
 *
 * Kullanım: node src/main/modules/test-e2e-anrfg.js <anr-fg-addon.zip> <optibuilder-10.0.2-klasoru>
 */

'use strict';

const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');

const [, , ANR_ZIP, OPTI_DIR] = process.argv;
if (!ANR_ZIP || !OPTI_DIR) {
    console.error('Kullanım: node test-e2e-anrfg.js <anr-fg-addon.zip> <optibuilder-10.0.2-klasoru>');
    process.exit(2);
}

const testDataDir = path.join(__dirname, '..', '..', '..', 'test-data', 'anrfg');
fs.rmSync(testDataDir, { recursive: true, force: true });
const mockUserData = path.join(testDataDir, 'userData');
const mockGameDir = path.join(testDataDir, 'fake-game', 'bin');
fs.mkdirSync(mockUserData, { recursive: true });
fs.mkdirSync(mockGameDir, { recursive: true });

require.cache[require.resolve('electron')] = {
    id: 'electron', filename: 'electron', loaded: true,
    exports: {
        app: {
            getPath: (name) => (name === 'temp' ? path.join(mockUserData, 'temp') : mockUserData),
            getVersion: () => '0.7.6',
            getAppPath: () => path.join(__dirname, '..', '..', '..')
        }
    }
};

const moduleManager = require('./core/moduleManager');
const moduleEngine = require('./core/moduleEngine');
const configEditor = require('./core/configEditor');
const config = require('../config');

const TAG = 'FG-V.B19';
const ANR_DIR = path.join(mockGameDir, 'OptiScaler', 'custom', 'Apex Neural Rendering FG');
const INI = path.join(mockGameDir, 'OptiScaler.ini');

let failed = 0;
function check(name, ok, extra) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || extra === undefined ? '' : ' → ' + JSON.stringify(extra)}`);
    if (!ok) failed++;
}
async function iniVal(section, key) {
    const r = await configEditor.readConfig(INI, 'ini');
    const v = r.data?.[section]?.[key];
    return v === undefined ? undefined : String(v);
}

async function main() {
    // ── Sahte oyun: OptiBuilder 10.0.2 kurulu
    const exe = path.join(mockGameDir, 'game.exe');
    fs.writeFileSync(exe, 'fake exe');
    fs.copyFileSync(path.join(OPTI_DIR, 'OptiScaler.dll'), path.join(mockGameDir, 'dxgi.dll'));
    fs.mkdirSync(path.join(mockGameDir, 'OptiScaler'), { recursive: true });
    fs.copyFileSync(path.join(OPTI_DIR, 'OptiScaler', 'OptiBuilder.version'), path.join(mockGameDir, 'OptiScaler', 'OptiBuilder.version'));
    // Kullanıcının önceden seçtiği değerler (kaldırmada bunlara dönülmeli)
    const iniText = fs.readFileSync(path.join(OPTI_DIR, 'OptiScaler.ini'), 'utf8')
        .replace(/^FGInput=.*$/m, 'FGInput=dlssg')
        .replace(/^FGNvngxReplacement=.*$/m, 'FGNvngxReplacement=Nukems');
    fs.writeFileSync(INI, iniText);

    const gameName = 'ANR Test Game';
    await config.saveUserGames({ 'anr-test-game': { name: gameName, game_root: path.dirname(mockGameDir), exe_path: exe } });
    config.getExistingGamesState().push({ name: gameName, exePath: exe, hasOptiBuilder: true, optiBuilderVersion: '10.0.2', installedMods: {} });

    // ── ANR paketini yerel mod önbelleğine aç (indirme yerine)
    const cacheDir = path.join(mockUserData, 'mods', 'anr-fg', TAG);
    fs.mkdirSync(cacheDir, { recursive: true });
    new AdmZip(ANR_ZIP).extractAllTo(cacheDir, true);

    moduleManager.init();
    const mod = moduleManager.getModule('anr-fg');
    check('anr-fg manifesti yüklendi', !!mod);
    if (!mod) return;

    console.log('\n--- Kurulum ---');
    const r1 = await moduleEngine.install(mod.manifest, gameName, exe, TAG, {}, () => {});
    check('kurulum başarılı', r1.success, r1.message || r1.error);
    if (!r1.success) { console.log(JSON.stringify(r1.log, null, 1).slice(0, 4000)); return; }
    check('nvngx_dlssg.dll custom klasöründe', fs.existsSync(path.join(ANR_DIR, 'dlssg', 'nvngx_dlssg.dll')));
    check('alt klasörler korunmuş (programs/*/pack.nrx)', fs.existsSync(path.join(ANR_DIR, 'dlssg', 'programs', 'fg-lite-any-dp4a-srgb8', 'pack.nrx')));
    check('paket kök dosyaları kopyalanmadı', !fs.existsSync(path.join(mockGameDir, 'OptiScaler', 'custom', 'install.cmd')) && !fs.existsSync(path.join(mockGameDir, 'install.cmd')) && !fs.existsSync(path.join(mockGameDir, 'OptiScaler', 'custom', 'README.txt')));
    check('FGInput=nvngxfg', await iniVal('FrameGen', 'FGInput') === 'nvngxfg', await iniVal('FrameGen', 'FGInput'));
    check('FGNvngxReplacement=Apex Neural Rendering FG', await iniVal('FrameGen', 'FGNvngxReplacement') === 'Apex Neural Rendering FG');
    check('DisableHudless=false', await iniVal('FrameGen', 'DisableHudless') === 'false', await iniVal('FrameGen', 'DisableHudless'));
    const g = () => config.getExistingGamesState().find(x => x.name === gameName);
    const rec = g().installedMods['anr-fg'];
    check('eski değerler kaydedildi', rec?.configRestore?.[0]?.values?.['FrameGen.FGInput'] === 'dlssg', rec);
    check('state: hasAnrFg + sürüm', g().hasAnrFg === true && g().anrFgVersion === TAG, { has: g().hasAnrFg, v: g().anrFgVersion });

    console.log('\n--- Yeniden kurulum (güncelleme) ---');
    const nrIni = path.join(ANR_DIR, 'dlssg', 'nr_fg.ini');
    fs.writeFileSync(nrIni, fs.readFileSync(nrIni, 'utf8').replace(/^max_generated = .*$/m, 'max_generated = 2'));
    const r2 = await moduleEngine.install(mod.manifest, gameName, exe, TAG, {}, () => {});
    check('yeniden kurulum başarılı', r2.success, r2.message || r2.error);
    const rec2 = g().installedMods['anr-fg'];
    check('ilk kurulum öncesi değer korunuyor (dlssg, nvngxfg değil)', rec2?.configRestore?.[0]?.values?.['FrameGen.FGInput'] === 'dlssg', rec2?.configRestore);
    check('kullanıcının nr_fg.ini ayarı güncellemede korundu', /^max_generated = 2$/m.test(fs.readFileSync(nrIni, 'utf8')));

    console.log('\n--- Yönet ekranı config yolu ---');
    const entry = mod.manifest.config[0];
    const base = moduleEngine.resolveConfigSearchDir(mod.manifest, entry, gameName, exe);
    const found = configEditor.findConfigFile(base, entry.search);
    check('OptiScaler.ini exe klasöründen bulunuyor', found && path.resolve(found) === path.resolve(INI), found);

    console.log('\n--- Kaldırma ---');
    const u = await moduleEngine.uninstall(mod.manifest, gameName, exe);
    check('kaldırma başarılı', u.success, u.message);
    check('ANR klasörü silindi', !fs.existsSync(ANR_DIR));
    check('FGInput eski haline döndü (dlssg)', await iniVal('FrameGen', 'FGInput') === 'dlssg', await iniVal('FrameGen', 'FGInput'));
    check('FGNvngxReplacement eski haline döndü (Nukems)', await iniVal('FrameGen', 'FGNvngxReplacement') === 'Nukems', await iniVal('FrameGen', 'FGNvngxReplacement'));
    check('DisableHudless eski haline döndü (auto)', await iniVal('FrameGen', 'DisableHudless') === 'auto', await iniVal('FrameGen', 'DisableHudless'));
    check('OptiScaler dokunulmadı (dxgi.dll + OptiScaler.ini)', fs.existsSync(path.join(mockGameDir, 'dxgi.dll')) && fs.existsSync(INI));
    check('state temizlendi', !g().installedMods['anr-fg'] && g().hasAnrFg === false);

    console.log('\n--- OptiBuilder kaldırılınca ANR kaydı ---');
    const r3 = await moduleEngine.install(mod.manifest, gameName, exe, TAG, {}, () => {});
    check('ANR yeniden kuruldu', r3.success && !!g().installedMods['anr-fg']?.installed, r3.message);
    const opti = moduleManager.getModule('optibuilder');
    const u2 = await moduleEngine.uninstall(opti.manifest, gameName, exe);
    check('OptiBuilder kaldırıldı', u2.success, u2.message);
    check('ANR klasörü OptiScaler ile gitti', !fs.existsSync(ANR_DIR));
    check('ANR kaydı da temizlendi (kurulu görünmüyor)', !g().installedMods['anr-fg'] && g().hasAnrFg === false, { mods: g().installedMods, has: g().hasAnrFg });
}

main()
    .then(() => {
        console.log(`\nSonuç: ${failed === 0 ? 'TÜMÜ GEÇTİ' : failed + ' BAŞARISIZ'}`);
        process.exit(failed === 0 ? 0 : 1);
    })
    .catch(e => { console.error('TEST HATASI:', e); process.exit(1); });
