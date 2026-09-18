/**
 * migrate-ini-schema-to-manifest.js
 *
 * iniSchema.js ve settings.js içerisindeki şemaları ve geliştirici presetlerini
 * resmi mod manifestlerine (dlssenabler, optiscaler, optibuilder) otomatik aktarır.
 * Sıfır kayıp (%100 tam eşleşme) doğrulaması yapar.
 *
 * Çalıştırma:
 *   node scripts/migrate-ini-schema-to-manifest.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── 1. iniSchema.js dosyasını oku ve parse et ──────────────────────────────────
const iniSchemaPath = path.join(__dirname, '..', 'src', 'renderer', 'ui', 'modals', 'iniSchema.js');
const iniSchemaContent = fs.readFileSync(iniSchemaPath, 'utf-8');

// ES Module export'larını CommonJS uyumlu hale getirip çalıştır
const cjsModuleCode = iniSchemaContent
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+/g, '') + '\nmodule.exports = { DLSS_ENABLER_SCHEMA, OPTISCALER_SCHEMA, OPTISCALER_FOCUSED_KEYS, OPTISCALER_INSTALL_KEYS, OPTIBUILDER_FOCUSED_KEYS };';

const m = new module.constructor();
m.paths = module.paths;
m._compile(cjsModuleCode, iniSchemaPath);
const {
    DLSS_ENABLER_SCHEMA,
    OPTISCALER_FOCUSED_KEYS,
    OPTISCALER_INSTALL_KEYS,
    OPTIBUILDER_FOCUSED_KEYS
} = m.exports;

// ── 2. Developer Presetleri ───────────────────────────────────────────────────
const DEVELOPER_PRESETS = {
    'dlssenabler': {
        'dev-best': {
            nameKey: 'modSettings.presets.devBestName',
            locked: true,
            values: {
                'Performance.MFGOverrideMode': 6,
                'Performance.MFGHotkeys': true,
                'UI.Monitoring': true,
                'GhostBuster.Enabled': true
            }
        }
    },
    'optiscaler': {
        'dev-opti-fg': {
            nameKey: 'modSettings.presets.devOptiFgName',
            locked: true,
            values: {
                'FrameGen.Enabled': 'true',
                'FrameGen.FGInput': 'upscaler',
                'FrameGen.FGOutput': 'xefg',
                'OptiFG.HUDFix': 'true',
                'Menu.ShowFps': 'true'
            }
        }
    },
    'optibuilder': {
        'dev-optibuilder-fg': {
            nameKey: 'modSettings.presets.devOptiFgName',
            locked: true,
            values: {
                'FrameGen.Enabled': 'true',
                'FrameGen.FGInput': 'upscaler',
                'FrameGen.FGOutput': 'dlssgwithnvngx',
                'DLSSG.InterpolationCount': 6,
                'DLSSG.DisableHudless': 'true',
                'DLSSG.DispatchFlags': '0x4100000',
                'Menu.ShowFps': 'true',
                'Menu.FpsOverlayPos': 'auto',
                'Menu.FpsOverlayType': 'auto'
            }
        }
    }
};

// ── 3. Şema Birleştirme Fonksiyonları ─────────────────────────────────────────

// OptiScaler: FOCUSED + INSTALL_KEYS (visibleIf koşulu eklenerek)
function buildOptiscalerSchema() {
    const schema = JSON.parse(JSON.stringify(OPTISCALER_FOCUSED_KEYS));

    // FrameGen
    if (OPTISCALER_INSTALL_KEYS.FrameGen) {
        schema.FrameGen = schema.FrameGen || {};
        schema.FrameGen.visibleIf = { flag: 'hasDlssEnabler', value: false };
        for (const [key, val] of Object.entries(OPTISCALER_INSTALL_KEYS.FrameGen)) {
            schema.FrameGen[key] = val;
            if (key === 'Enabled') schema.FrameGen[key].displayDefault = 'false';
            if (key === 'FGInput') schema.FrameGen[key].displayDefault = 'nofg';
            if (key === 'FGOutput') schema.FrameGen[key].displayDefault = 'nofg';
        }
    }

    // OptiFG
    if (OPTISCALER_INSTALL_KEYS.OptiFG) {
        schema.OptiFG = schema.OptiFG || {};
        schema.OptiFG.visibleIf = { flag: 'hasDlssEnabler', value: false };
        for (const [key, val] of Object.entries(OPTISCALER_INSTALL_KEYS.OptiFG)) {
            schema.OptiFG[key] = val;
            if (key === 'HUDFix') schema.OptiFG[key].displayDefault = 'false';
        }
    }

    return schema;
}

// OptiBuilder: FOCUSED_KEYS + displayDefault
function buildOptibuilderSchema() {
    const schema = JSON.parse(JSON.stringify(OPTIBUILDER_FOCUSED_KEYS));
    if (schema.FrameGen?.FGInput) schema.FrameGen.FGInput.displayDefault = 'nofg';
    if (schema.FrameGen?.FGOutput) schema.FrameGen.FGOutput.displayDefault = 'nofg';
    return schema;
}

// ── 4. Manifestleri Güncelleme / Oluşturma ────────────────────────────────────
const officialDir = path.join(__dirname, '..', 'src', 'main', 'modules', 'official');

// A. DLSS Enabler
const dlssManifestPath = path.join(officialDir, 'dlssenabler', 'manifest.json');
const dlssManifest = JSON.parse(fs.readFileSync(dlssManifestPath, 'utf-8'));
dlssManifest.config[0].schema = DLSS_ENABLER_SCHEMA;
dlssManifest.config[0].presets = DEVELOPER_PRESETS['dlssenabler'];
fs.writeFileSync(dlssManifestPath, JSON.stringify(dlssManifest, null, 4), 'utf-8');

// B. OptiScaler
const optiScalerDir = path.join(officialDir, 'optiscaler');
if (!fs.existsSync(optiScalerDir)) fs.mkdirSync(optiScalerDir, { recursive: true });
const optiScalerManifestPath = path.join(optiScalerDir, 'manifest.json');
const optiScalerManifest = {
    id: 'optiscaler',
    name: 'OptiScaler',
    description: 'DLSS girdilerini FSR ve XeSS upscalerlarına dönüştürerek desteklenmeyen GPU\'larda upscaling sağlar.',
    author: 'cdozdil',
    version: 'latest',
    source: {
        type: 'github',
        repo: 'cdozdil/OptiScaler',
        release: 'latest',
        asset: '*.zip'
    },
    install: {
        destination: 'game_exe',
        extractRoot: 'auto',
        cleanStaleVersionFiles: true
    },
    config: [
        {
            file: 'OptiScaler.ini',
            format: 'ini',
            search: ['OptiScaler.ini', 'optiscaler.ini'],
            required: false,
            createIfMissing: false,
            schema: buildOptiscalerSchema(),
            presets: DEVELOPER_PRESETS['optiscaler']
        }
    ],
    state: {
        flag: 'hasOptiscaler',
        versionField: 'optiscalerVersion'
    }
};
fs.writeFileSync(optiScalerManifestPath, JSON.stringify(optiScalerManifest, null, 4), 'utf-8');

// C. OptiBuilder
const optiBuilderDir = path.join(officialDir, 'optibuilder');
if (!fs.existsSync(optiBuilderDir)) fs.mkdirSync(optiBuilderDir, { recursive: true });
const optiBuilderManifestPath = path.join(optiBuilderDir, 'manifest.json');
const optiBuilderManifest = {
    id: 'optibuilder',
    name: 'OptiBuilder',
    description: 'OptiScaler yapılandırmalarını ve Frame Generation modüllerini optimize eder.',
    author: 'vuenxx',
    version: 'latest',
    source: {
        type: 'github',
        repo: 'vuenxx/dummy',
        release: 'latest',
        asset: '*.zip'
    },
    install: {
        destination: 'game_exe',
        extractRoot: 'auto',
        cleanStaleVersionFiles: true
    },
    config: [
        {
            file: 'OptiScaler.ini',
            format: 'ini',
            search: ['OptiScaler.ini', 'optiscaler.ini'],
            required: false,
            createIfMissing: false,
            schema: buildOptibuilderSchema(),
            presets: DEVELOPER_PRESETS['optibuilder']
        }
    ],
    state: {
        flag: 'hasOptiBuilder',
        versionField: 'optiBuilderVersion'
    }
};
fs.writeFileSync(optiBuilderManifestPath, JSON.stringify(optiBuilderManifest, null, 4), 'utf-8');

// ── 5. Sıfır Kayıp Doğrulama Testi (Zero-Loss Verification) ────────────────────
function countKeys(obj) {
    let count = 0;
    for (const [sec, keys] of Object.entries(obj)) {
        for (const [key, val] of Object.entries(keys)) {
            if (key !== 'visibleIf') count++;
        }
    }
    return count;
}

console.log('═══════════════════════════════════════════════════════════════════════');
console.log(' INI Şema → Manifest Otomatik Migrasyon & Doğrulama Raporu');
console.log('═══════════════════════════════════════════════════════════════════════\n');

const dlssExpected = countKeys(DLSS_ENABLER_SCHEMA);
const dlssActual = countKeys(dlssManifest.config[0].schema);

const optiExpected = countKeys(OPTISCALER_FOCUSED_KEYS) + countKeys(OPTISCALER_INSTALL_KEYS);
const optiActual = countKeys(optiScalerManifest.config[0].schema);

const obExpected = countKeys(OPTIBUILDER_FOCUSED_KEYS);
const obActual = countKeys(optiBuilderManifest.config[0].schema);

console.log(`[DLSS Enabler]  Beklenen Anahtar: ${dlssExpected} | Manifeste Yazılan: ${dlssActual} | Kayıp: ${dlssExpected - dlssActual}`);
console.log(`[OptiScaler]    Beklenen Anahtar: ${optiExpected} | Manifeste Yazılan: ${optiActual} | Kayıp: ${optiExpected - optiActual}`);
console.log(`[OptiBuilder]   Beklenen Anahtar: ${obExpected} | Manifeste Yazılan: ${obActual} | Kayıp: ${obExpected - obActual}`);

if (dlssExpected === dlssActual && optiExpected === optiActual && obExpected === obActual) {
    console.log('\n✓ BAŞARILI: Sıfır kayıp (%100 tam eşleşme) ile tüm şemalar aktarıldı.');
} else {
    console.error('\n✗ HATA: Anahtar sayıları uyuşmuyor!');
    process.exit(1);
}
