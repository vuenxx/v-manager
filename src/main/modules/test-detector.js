/**
 * test-detector.js — moduleDetector (manifest tabanlı mod tespiti) birim testleri
 *
 * Gerçek dosya okuması yapmaz; FileDescription/FileVersion okuyucuları sahte (mock)
 * verilir, böylece test Windows sürüm kaynağı olmadan da çalışır.
 */

'use strict';

const path = require('path');
const fs = require('fs');

const testDataDir = path.join(__dirname, '..', '..', '..', 'test-data');
const mockUserData = path.join(testDataDir, 'userData');
if (!fs.existsSync(mockUserData)) fs.mkdirSync(mockUserData, { recursive: true });

require.cache[require.resolve('electron')] = {
    id: 'electron',
    filename: 'electron',
    loaded: true,
    exports: {
        app: {
            getPath: (n) => (n === 'temp' ? path.join(mockUserData, 'temp') : mockUserData),
            getVersion: () => '3.0.0',
            getAppPath: () => path.join(__dirname, '..', '..', '..')
        }
    }
};

const moduleManager = require('./core/moduleManager');
const moduleDetector = require('./core/moduleDetector');

let passed = 0;
let failed = 0;

function check(name, cond, extra) {
    if (cond) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        console.log(`  ✗ ${name}${extra ? ' → ' + JSON.stringify(extra) : ''}`);
    }
}

/** Tek bir sahte klasörü tarayıp detections üretir (scanner'in yaptiginin kucuk hali) */
async function scanFakeDir(files, detectors) {
    const plan = moduleDetector.buildMatchPlan(detectors);
    const names = new Set(Object.keys(files).map(f => f.toLowerCase()));
    const detections = {};

    for (const [fileName, meta] of Object.entries(files)) {
        const nameLow = fileName.toLowerCase();
        if (!plan.isCandidate(nameLow)) continue;

        const hit = await moduleDetector.matchFile(detectors, {
            fileNameLow: nameLow,
            hasSibling: (n) => names.has(String(n).toLowerCase()),
            readDescription: async () => (meta && meta.desc) || '',
            readVersion: async () => (meta && meta.version) || null
        });

        if (hit && !detections[hit.moduleId]) {
            detections[hit.moduleId] = {
                dir: 'C:\\fake',
                injection: hit.viaProxy ? fileName : null,
                version: hit.version,
                depth: 0
            };
        }
    }

    moduleDetector.resolveExclusives(detections, detectors);
    return detections;
}

async function run() {
    console.log('\n=== moduleDetector testleri ===\n');
    moduleManager.init();
    const detectors = moduleDetector.getDetectors();

    console.log('--- Detector kesfi ---');
    const ids = detectors.map(d => d.moduleId);
    check('detect blogu olan moduller bulunmali', ids.length >= 5, ids);
    check('oncelik sirasi: dlssnr > optibuilder > optiscaler',
        ids.indexOf('optiscaler-dlssnr') < ids.indexOf('optibuilder') &&
        ids.indexOf('optibuilder') < ids.indexOf('optiscaler'), ids);
    check('addon moduller (fsr4/optipatcher) tespit listesinde olmamali',
        !ids.includes('fsr4') && !ids.includes('optipatcher'), ids);

    console.log('\n--- Dosya eslesme ---');

    let d = await scanFakeDir({
        'dxgi.dll': { desc: 'OptiScaler', version: '0.7.7.0' },
        'Game.exe': {}
    }, detectors);
    check('OptiScaler 0.7.x -> optiscaler', d.optiscaler && !d.optibuilder && !d['optiscaler-dlssnr'], d);
    check('proxy DLL adi injection olarak kaydedilmeli', d.optiscaler && d.optiscaler.injection === 'dxgi.dll', d);

    d = await scanFakeDir({ 'winmm.dll': { desc: 'OptiScaler', version: '0.10.2.0' } }, detectors);
    check('OptiScaler 0.10.x -> optibuilder', d.optibuilder && !d.optiscaler, d);

    d = await scanFakeDir({ 'dxgi.dll': { desc: 'OptiScaler', version: '10.0.0.1' } }, detectors);
    check('OptiScaler 10.x (marker yok) -> optibuilder', d.optibuilder && !d['optiscaler-dlssnr'], d);

    d = await scanFakeDir({
        'dxgi.dll': { desc: 'OptiScaler', version: '10.0.0.1' },
        'nvngx.dll_dlssnr.dll': {},
        'OptiScaler.ini': {}
    }, detectors);
    check('nvngx.dll_dlssnr.dll varsa -> optiscaler-dlssnr',
        d['optiscaler-dlssnr'] && !d.optibuilder && !d.optiscaler, d);

    d = await scanFakeDir({ 'dxgi.dll': { desc: 'OptiScaler', version: null } }, detectors);
    check('surum okunamazsa (allowUnknown) -> optiscaler', d.optiscaler, d);

    d = await scanFakeDir({ 'version.dll': { desc: 'DLSS Enabler for DX12 GPUs', version: '3.02.000.0' } }, detectors);
    check('DLSS Enabler proxy DLL -> dlssenabler', d.dlssenabler && d.dlssenabler.injection === 'version.dll', d);

    d = await scanFakeDir({ 'dlss-enabler.dll': { desc: '', version: '3.02.000.0' } }, detectors);
    check('dlss-enabler.dll dogrudan adiyla -> dlssenabler (injection yok)',
        d.dlssenabler && d.dlssenabler.injection === null, d);

    d = await scanFakeDir({ 'sl.interposer.dll': { version: '2.7.32.0' }, 'sl.common.dll': {} }, detectors);
    check('sl.*.dll deseni -> streamline', d.streamline && d.streamline.version === '2.7.32.0', d);

    d = await scanFakeDir({ 'dxgi.dll': { desc: 'DirectX Graphics Infrastructure', version: '10.0.0' } }, detectors);
    check('alakasiz sistem DLL hicbir module eslesmemeli', Object.keys(d).length === 0, d);

    console.log('\n--- state alanlarina yazma ---');

    const game = { name: 'Fake', hasOptiscaler: true, optiscalerVersion: '0.7.0', optiscalerPath: 'C:\\old', upscalers: { dlss: true } };
    moduleDetector.applyDetections(game, {
        'optiscaler-dlssnr': { dir: 'C:\\game', injection: 'dxgi.dll', version: '10.0.0.1', depth: 0 }
    }, detectors);
    check('yeni modulun state alanlari yazilmali',
        game.hasDlssNr === true && game.dlssNrVersion === '10.0.0.1' &&
        game.dlssNrPath === 'C:\\game' && game.dlssNrInjection === 'dxgi.dll', game);
    check('tespit edilmeyen modulun alanlari temizlenmeli',
        game.hasOptiscaler === false && game.optiscalerVersion === null && game.optiscalerPath === null, game);
    check('upscalers bayraklari guncellenmeli',
        game.upscalers.dlssnr === true && game.upscalers.optiscaler === false && game.upscalers.dlss === true, game.upscalers);

    const sticky = { hasStreamline: true, streamlineVersion: '2.7.0', streamlinePath: 'C:\\sl' };
    moduleDetector.applyDetections(sticky, {}, detectors);
    check('sticky modul (streamline) tespit edilmese de korunmali',
        sticky.hasStreamline === true && sticky.streamlineVersion === '2.7.0', sticky);

    console.log('\n--- Surum karsilastirma ---');
    check('0.7.7 < 0.10', moduleDetector.compareVersions('0.7.7', '0.10') < 0);
    check('0.10.5 >= 0.10', moduleDetector.compareVersions('0.10.5', '0.10') >= 0);
    check('10.0.0.1 > 0.10', moduleDetector.compareVersions('10.0.0.1', '0.10') > 0);
    check('v0.7.7-pre ayristirilabilmeli', moduleDetector.compareVersions('v0.7.7-pre', '0.7.7') === 0);

    console.log('\n=======================================');
    console.log(`  Sonuc: ${passed} gecti, ${failed} basarisiz`);
    console.log('=======================================\n');
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
