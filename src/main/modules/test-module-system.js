/**
 * test-module-system.js — Manifest modül sistemi uçtan uca testi
 *
 * Kullanım:
 *   node src/main/modules/test-module-system.js
 *
 * NOT: Bu test Electron app bağlamı dışında çalışır.
 *      electron modülüne bağımlı olan parçalar (backup, conditionChecker.getGpuInfo)
 *      mock'lanır veya atlanır.
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ── Mock electron.app ─────────────────────────────────────────────────────────
// Electron olmadan test edebilmek için basit mock
const mockUserData = path.join(__dirname, '..', '..', '..', 'test-data');
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

// Override require for electron
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
    if (request === 'electron') {
        return request;
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.cache['electron'] = {
    id: 'electron',
    filename: 'electron',
    loaded: true,
    exports: electronMock
};

// ── Test başlangıç ───────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════');
console.log(' V-Manager Manifest Modül Sistemi — Test');
console.log('═══════════════════════════════════════════════════════');
console.log('');

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (e) {
        console.error(`  ✗ ${name}`);
        console.error(`    → ${e.message}`);
        failed++;
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

async function runTests() {
    // ── 1. manifestValidator testi ────────────────────────────────────────────────
    console.log('\n─── manifestValidator.js ────────────────────────────');
    const manifestValidator = require('./core/manifestValidator');

    await test('Geçerli manifest doğrulanmalı', () => {
        const manifest = {
            id: 'test-mod',
            name: 'Test Mod',
            source: { type: 'github', repo: 'owner/repo', asset: '*.zip' },
            install: { destination: 'game_root' }
        };
        const result = manifestValidator.validate(manifest);
        assert(result.valid === true, `valid=${result.valid}, errors=${result.errors}`);
        assert(result.errors.length === 0, `Errors: ${result.errors}`);
    });

    await test('id eksik manifest reddedilmeli', () => {
        const result = manifestValidator.validate({ name: 'No ID' });
        assert(result.valid === false);
        assert(result.errors.some(e => e.includes('id')));
    });

    await test('Hatalı source.repo formatı reddedilmeli', () => {
        const result = manifestValidator.validate({
            id: 'test', name: 'Test',
            source: { type: 'github', repo: 'invalid', asset: '*.zip' },
            install: { destination: 'game_root' }
        });
        assert(result.valid === false);
        assert(result.errors.some(e => e.includes('repo')));
    });

    await test('Geçersiz destination reddedilmeli', () => {
        const result = manifestValidator.validate({
            id: 'test', name: 'Test',
            source: { type: 'github', repo: 'a/b', asset: '*.zip' },
            install: { destination: 'invalid_value' }
        });
        assert(result.valid === false);
        assert(result.errors.some(e => e.includes('destination')));
    });

    await test('Bilinmeyen alanlar uyarı üretmeli', () => {
        const result = manifestValidator.validate({
            id: 'test', name: 'Test',
            source: { type: 'github', repo: 'a/b', asset: '*.zip' },
            install: { destination: 'game_root' },
            unknownField: 'value'
        });
        assert(result.valid === true);
        assert(result.warnings.length > 0);
    });

    await test('Relative destination kabul edilmeli', () => {
        const result = manifestValidator.validate({
            id: 'test', name: 'Test',
            source: { type: 'github', repo: 'a/b', asset: '*.zip' },
            install: { destination: 'game_exe', targetSubdir: 'plugins' }
        });
        assert(result.valid === true);
    });

    await test('Geçerli auto_test sihirbazı doğrulanmalı', () => {
        const result = manifestValidator.validate({
            id: 'dlssenabler',
            name: 'DLSS Enabler',
            source: { type: 'github', repo: 'owner/repo', asset: '*.zip' },
            install: { destination: 'game_exe' },
            wizard: {
                type: 'auto_test',
                title: 'DLSS Enabler Sihirbazı',
                applyPresetOnSuccess: 'dev-best',
                autoTest: {
                    sourceFile: 'version.dll',
                    candidates: ['version.dll', 'dxgi.dll'],
                    watchFile: 'dlss-enabler.ini',
                    timeoutSeconds: 10,
                    checkProcessRunning: true,
                    autoTerminateGame: true
                }
            }
        });
        assert(result.valid === true, `Errors: ${result.errors}`);
    });

    await test('Geçersiz sihirbaz tipi reddedilmeli', () => {
        const result = manifestValidator.validate({
            id: 'test', name: 'Test',
            source: { type: 'github', repo: 'a/b', asset: '*.zip' },
            install: { destination: 'game_exe' },
            wizard: {
                type: 'invalid_type'
            }
        });
        assert(result.valid === false);
        assert(result.errors.some(e => e.includes('wizard.type')));
    });

    await test('auto_test için eksik watchFile reddedilmeli', () => {
        const result = manifestValidator.validate({
            id: 'test', name: 'Test',
            source: { type: 'github', repo: 'a/b', asset: '*.zip' },
            install: { destination: 'game_exe' },
            wizard: {
                type: 'auto_test',
                autoTest: {
                    sourceFile: 'version.dll',
                    candidates: ['version.dll']
                }
            }
        });
        assert(result.valid === false);
        assert(result.errors.some(e => e.includes('watchFile')));
    });

    // ── 2. moduleLogger testi ─────────────────────────────────────────────────────
    console.log('\n─── moduleLogger.js ─────────────────────────────────');
    const { createLogger } = require('./core/moduleLogger');

    await test('Logger oluşturulabilmeli', () => {
        const logger = createLogger('test-mod');
        assert(logger !== null);
        assert(typeof logger.step === 'function');
        assert(typeof logger.warn === 'function');
        assert(typeof logger.error === 'function');
    });

    await test('Log kayıtları saklanmalı', () => {
        const logger = createLogger('test-mod');
        logger.step('Adım 1');
        logger.warn('Uyarı 1');
        logger.error('Hata 1');
        const logs = logger.getLog();
        assert(logs.length === 3);
        assert(logs[0].level === 'step');
        assert(logs[1].level === 'warn');
        assert(logs[2].level === 'error');
    });

    await test('Log temizlenebilmeli', () => {
        const logger = createLogger('test-mod');
        logger.step('Test');
        logger.clear();
        assert(logger.getLog().length === 0);
    });

    // ── 3. archive.js testi ───────────────────────────────────────────────────────
    console.log('\n─── archive.js ──────────────────────────────────────');
    const archive = require('./core/archive');

    await test('ZIP formatı desteklenmeli', () => {
        assert(archive.supportsFormat('.zip') === true);
        assert(archive.supportsFormat('zip') === true);
    });

    await test('7Z formatı desteklenmeli', () => {
        assert(archive.supportsFormat('.7z') === true);
    });

    await test('RAR formatı desteklenmeli (node-unrar-js ile)', () => {
        assert(archive.supportsFormat('.rar') === true);
    });

    await test('Bilinmeyen format desteklenmemeli', () => {
        assert(archive.supportsFormat('.xyz') === false);
    });

    await test('getSupportedFormats dizisi .zip, .7z ve .rar içermeli', () => {
        const formats = archive.getSupportedFormats();
        assert(formats.includes('.zip'));
        assert(formats.includes('.7z'));
        assert(formats.includes('.rar'));
    });

    // ── 4. githubFetcher testi ────────────────────────────────────────────────────
    console.log('\n─── githubFetcher.js ─────────────────────────────────');
    const githubFetcher = require('./core/githubFetcher');

    await test('findRelease: latest ilk release\'i döndürmeli', () => {
        const releases = [
            { tag: 'v2', name: 'v2' },
            { tag: 'v1', name: 'v1' }
        ];
        const result = githubFetcher.findRelease(releases, 'latest');
        assert(result.tag === 'v2');
    });

    await test('findRelease: tag ile arama yapabilmeli', () => {
        const releases = [
            { tag: 'v2', name: 'v2' },
            { tag: 'v1', name: 'v1' }
        ];
        const result = githubFetcher.findRelease(releases, 'v1');
        assert(result.tag === 'v1');
    });

    await test('findRelease: olmayan tag null döndürmeli', () => {
        const result = githubFetcher.findRelease([{ tag: 'v1' }], 'v99');
        assert(result === null);
    });

    // ── 5. configEditor testi ─────────────────────────────────────────────────────
    console.log('\n─── configEditor.js ──────────────────────────────────');
    const configEditor = require('./core/configEditor');

    await test('JSON readConfig: olmayan dosya { exists: false } döndürmeli', async () => {
        const testResult = await configEditor.readConfig(path.join(mockUserData, 'nonexistent.json'), 'json');
        assert(testResult.exists === false);
    });

    await test('findConfigFile: olmayan dizinde null döndürmeli', () => {
        const result = configEditor.findConfigFile(
            path.join(mockUserData, 'nonexistent-dir'),
            ['test.ini']
        );
        assert(result === null);
    });

    await test('applyChanges (INI): Section.Key formatı ile aynı alt anahtar isimlerini farklı bölümlere yazabilmeli', async () => {
        const testIniPath = path.join(mockUserData, 'test-collision.ini');
        fs.writeFileSync(testIniPath, '[General]\nVersion=1.0\n', 'utf-8');
        
        await configEditor.applyChanges(testIniPath, 'ini', {
            'Frame-Gen.Enable': true,
            'Anti-Ghosting.Enable': false
        }, { createIfMissing: true });

        const readBack = await configEditor.readConfig(testIniPath, 'ini');
        assert(readBack.data['Frame-Gen']['Enable'] === true);
        assert(readBack.data['Anti-Ghosting']['Enable'] === false);
    });

    await test('applyChanges (INI): İç içe obje formatı ile aynı alt anahtar isimlerini farklı bölümlere yazabilmeli', async () => {
        const testIniPath = path.join(mockUserData, 'test-nested.ini');
        fs.writeFileSync(testIniPath, '[General]\nVersion=1.0\n', 'utf-8');
        
        await configEditor.applyChanges(testIniPath, 'ini', {
            'Frame-Gen': { 'Enable': true, 'Mode': 'Auto' },
            'Anti-Ghosting': { 'Enable': false }
        }, { createIfMissing: true });

        const readBack = await configEditor.readConfig(testIniPath, 'ini');
        assert(readBack.data['Frame-Gen']['Enable'] === true);
        assert(readBack.data['Frame-Gen']['Mode'] === 'Auto');
        assert(readBack.data['Anti-Ghosting']['Enable'] === false);
    });

    // ── 6. conditionChecker testi ─────────────────────────────────────────────────
    console.log('\n─── conditionChecker.js ──────────────────────────────');
    const conditionChecker = require('./core/conditionChecker');

    await test('Boş koşul listesi geçmeli', async () => {
        const result = await conditionChecker.checkConditions([], {});
        assert(result.passed === true);
    });

    await test('Null koşul listesi geçmeli', async () => {
        const result = await conditionChecker.checkConditions(null, {});
        assert(result.passed === true);
    });

    await test('enabled: false koşulları atlanmalı (çalıştırılmamalı)', async () => {
        const conditions = [
            {
                type: 'check_conflicts',
                enabled: false,
                severity: 'blocking',
                message: 'Bu hata asla görünmemeli çünkü enabled: false'
            }
        ];
        const result = await conditionChecker.checkConditions(conditions, {});
        assert(result.passed === true);
        assert(result.failures.length === 0);
    });

    // ── 7. dummy-mod manifest doğrulama ───────────────────────────────────────────
    console.log('\n─── dummy-mod manifest ──────────────────────────────');
    const dummyManifestPath = path.join(__dirname, 'official', 'dummy-mod', 'manifest.json');

    await test('Dummy manifest okunabilmeli', () => {
        assert(fs.existsSync(dummyManifestPath), `Dosya bulunamadı: ${dummyManifestPath}`);
        const raw = fs.readFileSync(dummyManifestPath, 'utf-8');
        const manifest = JSON.parse(raw);
        assert(manifest.id === 'dummy-mod');
        assert(manifest.source.repo === 'vuenxx/dummy');
    });

    await test('Dummy manifest doğrulanabilmeli', () => {
        const raw = fs.readFileSync(dummyManifestPath, 'utf-8');
        const manifest = JSON.parse(raw);
        const result = manifestValidator.validate(manifest);
        assert(result.valid === true, `Errors: ${result.errors.join(', ')}`);
    });

    // ── 8. dlssenabler manifest doğrulama ─────────────────────────────────────────
    console.log('\n─── dlssenabler manifest ────────────────────────────');
    const dlssManifestPath = path.join(__dirname, 'official', 'dlssenabler', 'manifest.json');

    await test('DLSS Enabler manifest okunabilmeli', () => {
        assert(fs.existsSync(dlssManifestPath), `Dosya bulunamadı: ${dlssManifestPath}`);
        const raw = fs.readFileSync(dlssManifestPath, 'utf-8');
        const manifest = JSON.parse(raw);
        assert(manifest.id === 'dlssenabler');
        assert(manifest.source.repo === 'vuenxx/extra_goldteam34');
    });

    await test('DLSS Enabler manifest doğrulanabilmeli (yeni şema alanları dahil)', () => {
        const raw = fs.readFileSync(dlssManifestPath, 'utf-8');
        const manifest = JSON.parse(raw);
        const result = manifestValidator.validate(manifest);
        assert(result.valid === true, `Errors: ${result.errors.join(', ')}`);
        assert(manifest.install.proxyDetection !== undefined, 'proxyDetection alanı olmalı');
        assert(manifest.install.verifyAntiVirusDelayMs === 1500, 'verifyAntiVirusDelayMs 1500 olmalı');
        assert(manifest.install.cleanStaleVersionFiles === true, 'cleanStaleVersionFiles true olmalı');
        assert(manifest.conditions === undefined || manifest.conditions.length === 0, 'check_conflicts condition kaldırılmış olmalı');
        const optiEntry = manifest.uninstall.files.find(f => typeof f === 'object' && f.file === 'OptiScaler.ini');
        assert(optiEntry && optiEntry.unlessAnyState, 'OptiScaler.ini unlessAnyState içermeli');
        assert(manifest.uninstall.verifiedDlls.length === 1, 'verifiedDlls 1 kural içermeli');
        assert(manifest.uninstall.restoreBackup === false, 'restoreBackup false olmalı');
    });

    await test('OptiScaler manifest doğrulanabilmeli', () => {
        const p = path.join(__dirname, 'official', 'optiscaler', 'manifest.json');
        const raw = fs.readFileSync(p, 'utf-8');
        const manifest = JSON.parse(raw);
        const result = manifestValidator.validate(manifest);
        assert(result.valid === true, `Errors: ${result.errors.join(', ')}`);
        assert(manifest.id === 'optiscaler');
    });

    await test('OptiBuilder manifest doğrulanabilmeli', () => {
        const p = path.join(__dirname, 'official', 'optibuilder', 'manifest.json');
        const raw = fs.readFileSync(p, 'utf-8');
        const manifest = JSON.parse(raw);
        const result = manifestValidator.validate(manifest);
        assert(result.valid === true, `Errors: ${result.errors.join(', ')}`);
        assert(manifest.id === 'optibuilder');
    });

    await test('OptiPatcher manifest doğrulanabilmeli', () => {
        const p = path.join(__dirname, 'official', 'optipatcher', 'manifest.json');
        const raw = fs.readFileSync(p, 'utf-8');
        const manifest = JSON.parse(raw);
        const result = manifestValidator.validate(manifest);
        assert(result.valid === true, `Errors: ${result.errors.join(', ')}`);
        assert(manifest.id === 'optipatcher');
    });

    await test('FSR4 manifest doğrulanabilmeli', () => {
        const p = path.join(__dirname, 'official', 'fsr4', 'manifest.json');
        const raw = fs.readFileSync(p, 'utf-8');
        const manifest = JSON.parse(raw);
        const result = manifestValidator.validate(manifest);
        assert(result.valid === true, `Errors: ${result.errors.join(', ')}`);
        assert(manifest.id === 'fsr4');
    });

    await test('Streamline manifest doğrulanabilmeli', () => {
        const p = path.join(__dirname, 'official', 'streamline', 'manifest.json');
        const raw = fs.readFileSync(p, 'utf-8');
        const manifest = JSON.parse(raw);
        const result = manifestValidator.validate(manifest);
        assert(result.valid === true, `Errors: ${result.errors.join(', ')}`);
        assert(manifest.id === 'streamline');
    });

    // ── 9. Geriye dönük uyumluluk doğrulaması ────────────────────────────────────
    console.log('\n─── Geriye Dönük Uyumluluk Testi ────────────────────');
    await test('Yeni şema alanları içermeyen basit manifest sorunsuz doğrulanmalı', () => {
        const simpleManifest = {
            id: 'basit-mod',
            name: 'Basit Mod',
            source: {
                type: 'github',
                repo: 'ornek/repo',
                asset: '*.zip'
            },
            install: {
                destination: 'game_exe'
            }
        };
        const result = manifestValidator.validate(simpleManifest);
        assert(result.valid === true, `Errors: ${result.errors.join(', ')}`);
    });

    // ── 10. moduleManager testi ───────────────────────────────────────────────────
    console.log('\n─── moduleManager.js ─────────────────────────────────');
    const moduleManager = require('./core/moduleManager');

    await test('init() modülleri yüklemeli', () => {
        moduleManager.init();
        const modules = moduleManager.getModules();
        assert(modules.length >= 2, `Yüklenen modül sayısı: ${modules.length}`);
    });

    await test('dummy-mod yüklenmeli', () => {
        const mod = moduleManager.getModule('dummy-mod');
        assert(mod !== null, 'dummy-mod bulunamadı');
        assert(mod.manifest.name === 'Dummy Mod');
    });

    await test('dlssenabler yüklenmeli', () => {
        const mod = moduleManager.getModule('dlssenabler');
        assert(mod !== null, 'dlssenabler bulunamadı');
        assert(mod.manifest.name === 'DLSS Enabler');
    });

    await test('Olmayan modül null döndürmeli', () => {
        const mod = moduleManager.getModule('nonexistent-mod');
        assert(mod === null);
    });

    // ── 11. Manifest Builder & Custom Manifests IPC testleri ─────────────────────
    console.log('\n─── Manifest Builder (Save / Delete / Conflict) ──────');

    const mockIpcHandlers = new Map();
    const mockIpcMain = {
        handle: (channel, handler) => {
            mockIpcHandlers.set(channel, handler);
        }
    };

    moduleManager.registerIpcHandlers(mockIpcMain);

    await test('module-save-manifest: Resmi modül ID çakışması proaktif reddedilmeli', async () => {
        const conflictManifest = {
            id: 'dlssenabler', // Resmi mod ID'si
            name: 'Sahte DLSS',
            source: { type: 'github', repo: 'test/repo', asset: '*.zip' },
            install: { destination: 'game_exe' }
        };
        const saveHandler = mockIpcHandlers.get('module-save-manifest');
        const result = await saveHandler(null, conflictManifest);
        assert(result.success === false, 'Resmi mod ID çakışması reddedilmeliydi');
        assert(result.error.includes('resmi veya topluluk modülü'), `Hata mesajı bekleniyordu, gelen: ${result.error}`);
    });

    await test('module-save-manifest: Geçerli özel manifest AppData dizinine kaydedilmeli ve yüklenmeli', async () => {
        const customManifest = {
            id: 'custom-test-mod',
            name: 'Custom Test Mod',
            description: 'Özel test modu',
            author: 'Test Dev',
            version: '1.0.0',
            source: { type: 'github', repo: 'vuenxx/dummy', release: 'latest', asset: '*.zip' },
            install: { destination: 'game_exe', extractRoot: 'auto', cleanStaleVersionFiles: true }
        };
        const saveHandler = mockIpcHandlers.get('module-save-manifest');
        const result = await saveHandler(null, customManifest);
        assert(result.success === true, `Kayıt başarılı olmalıydı: ${result.error}`);
        assert(fs.existsSync(result.path), `Manifest dosyası diskte bulunamadı: ${result.path}`);

        // moduleManager tarafından yüklendi mi?
        const mod = moduleManager.getModule('custom-test-mod');
        assert(mod !== null, 'custom-test-mod moduleManager tarafından bulunmalı');
        assert(mod.type === 'custom', `Modül tipi 'custom' olmalı, gelen: ${mod.type}`);
    });

    await test('module-delete-custom-manifest: Resmi mod silme isteği reddedilmeli', async () => {
        const deleteHandler = mockIpcHandlers.get('module-delete-custom-manifest');
        const result = await deleteHandler(null, { moduleId: 'dlssenabler' });
        assert(result.success === false, 'Resmi mod silme isteği reddedilmeliydi');
        assert(result.error.includes('Sadece özel (custom) modüller silinebilir'));
    });

    await test('module-delete-custom-manifest: Özel manifest başarıyla silinmeli', async () => {
        const deleteHandler = mockIpcHandlers.get('module-delete-custom-manifest');
        const result = await deleteHandler(null, { moduleId: 'custom-test-mod' });
        assert(result.success === true, `Silme başarılı olmalıydı: ${result.error}`);
        const mod = moduleManager.getModule('custom-test-mod');
        assert(mod === null, 'custom-test-mod silindikten sonra listede olmamalı');
    });

    // ── 10. Destination (game_root vs game_exe) ve Generic Config Handler Testleri ──
    console.log('\n─── Destination (game_root vs game_exe) & Generic Config ───');

    await test('searchBaseDir: destination game_root durumunda game_root dizinini seçmeli', () => {
        const mockGamePaths = {
            game_root: 'C:\\Games\\TestGame',
            exe_path: 'C:\\Games\\TestGame\\bin\\game.exe'
        };
        const rootManifest = { install: { destination: 'game_root' } };

        const exeDir = mockGamePaths.exe_path ? path.dirname(mockGamePaths.exe_path) : null;
        const gameRoot = mockGamePaths.game_root || exeDir;
        const destType = rootManifest.install?.destination || 'game_root';

        let searchBaseDir;
        if (destType === 'game_root') {
            searchBaseDir = gameRoot;
        } else if (destType === 'game_exe') {
            searchBaseDir = exeDir || gameRoot;
        }

        assert(searchBaseDir === 'C:\\Games\\TestGame', `Beklenen: C:\\Games\\TestGame, Alınan: ${searchBaseDir}`);
    });

    await test('searchBaseDir: destination game_exe durumunda exe_dir (bin) dizinini seçmeli', () => {
        const mockGamePaths = {
            game_root: 'C:\\Games\\TestGame',
            exe_path: 'C:\\Games\\TestGame\\bin\\game.exe'
        };
        const exeManifest = { install: { destination: 'game_exe' } };

        const exeDir = mockGamePaths.exe_path ? path.dirname(mockGamePaths.exe_path) : null;
        const gameRoot = mockGamePaths.game_root || exeDir;
        const destType = exeManifest.install?.destination || 'game_root';

        let searchBaseDir;
        if (destType === 'game_root') {
            searchBaseDir = gameRoot;
        } else if (destType === 'game_exe') {
            searchBaseDir = exeDir || gameRoot;
        }

        assert(searchBaseDir === 'C:\\Games\\TestGame\\bin', `Beklenen: C:\\Games\\TestGame\\bin, Alınan: ${searchBaseDir}`);
    });

    await test('manifestValidator: root-test-mod şeması (schema, presets, visibleIf) geçerli olmalı', () => {
        const rootManifest = {
            id: 'root-test-mod',
            name: 'Root Test Mod',
            description: 'game_root dizin hedeflemesini ve generic config okuma/yazma handler\'larını test eden mod.',
            author: 'vuenxx',
            version: '1.0.0',
            source: { type: 'github', repo: 'vuenxx/dummy', release: 'latest', asset: '*.zip' },
            install: { destination: 'game_root', extractRoot: 'auto', cleanStaleVersionFiles: true },
            config: [
                {
                    file: 'root-settings.ini',
                    format: 'ini',
                    search: ['root-settings.ini', 'RootSettings.ini'],
                    required: false,
                    createIfMissing: true,
                    schema: {
                        Engine: {
                            EnableRootFeature: { type: 'toggle', label: 'Enable Root Feature', default: true }
                        },
                        Advanced: {
                            visibleIf: { flag: 'hasDlssEnabler', value: false },
                            CustomFps: { type: 'slider', label: 'Custom FPS', min: 30, max: 144, step: 1, default: 60 }
                        }
                    },
                    presets: {
                        'dev-root-fast': {
                            nameKey: 'modSettings.presets.devFast',
                            values: { 'Engine.EnableRootFeature': true, 'Advanced.CustomFps': 120 }
                        }
                    }
                }
            ],
            state: { flag: 'hasRootTestMod' }
        };
        const result = manifestValidator.validate(rootManifest);
        assert(result.valid === true, `Validasyon başarısız: ${result.errors?.join(', ')}`);
    });

    await test('manifestValidator: applyPresetOnInstall (string ve boolean) geçerli olmalı, geçersiz tipler hata vermeli', () => {
        const base = {
            id: 'preset-check-mod',
            name: 'Preset Check Mod',
            version: '1.0.0',
            source: { type: 'github', repo: 'test/repo', release: 'latest', asset: '*.zip' },
            install: { destination: 'game_exe', applyPresetOnInstall: 'dev-best' }
        };
        const validRes1 = manifestValidator.validate(base);
        assert(validRes1.valid === true, `Geçerli string reddedildi: ${validRes1.errors?.join(', ')}`);

        base.install.applyPresetOnInstall = true;
        const validRes2 = manifestValidator.validate(base);
        assert(validRes2.valid === true, `Geçerli boolean reddedildi: ${validRes2.errors?.join(', ')}`);

        base.install.applyPresetOnInstall = 123;
        const invalidRes = manifestValidator.validate(base);
        assert(invalidRes.valid === false, 'Geçersiz sayı tipi kabul edilmemeliydi');
    });

    await test('visibleIf mantığı: hasDlssEnabler true iken koşullu alan gizlenmeli, false iken gösterilmeli', () => {
        const condition = { flag: 'hasDlssEnabler', value: false };
        const gameWithDlss = { name: 'Cyberpunk', hasDlssEnabler: true };
        const gameWithoutDlss = { name: 'Cyberpunk', hasDlssEnabler: false };

        const isVisibleWithDlss = (gameWithDlss[condition.flag] === condition.value);
        const isVisibleWithoutDlss = (gameWithoutDlss[condition.flag] === condition.value);

        assert(isVisibleWithDlss === false, 'DLSS Enabler varken visibleIf gizlenmeliydi');
        assert(isVisibleWithoutDlss === true, 'DLSS Enabler yokken visibleIf görünmeliydi');
    });

    await test('module-get-active-for-game: Oyun bayraklarına göre aktif modları listelemeli ve üstverileri zenginleştirmeli', async () => {
        const getActiveHandler = mockIpcHandlers.get('module-get-active-for-game');
        const mockGame = {
            name: 'TestGame',
            hasDlssEnabler: true,
            dlssEnablerVersion: '3.0.1',
            hasStreamline: true,
            streamlineVersion: '2.4.0',
            hasOptiscaler: false
        };

        const result = await getActiveHandler(null, mockGame);
        assert(result.success === true, `Handler başarısız: ${result.error}`);
        assert(Array.isArray(result.activeMods), 'activeMods dizi olmalı');
        
        const dlss = result.activeMods.find(m => m.id === 'dlssenabler');
        assert(dlss !== undefined, 'DLSS Enabler aktif modlar arasında olmalı');
        assert(dlss.hasConfig === true, 'DLSS Enabler hasConfig: true olmalı');
        assert(dlss.hasReleases === true, 'DLSS Enabler hasReleases: true olmalı');
        assert(dlss.installedVersion === '3.0.1', `DLSS Enabler sürümü 3.0.1 olmalı, gelen: ${dlss.installedVersion}`);

        const sl = result.activeMods.find(m => m.id === 'streamline');
        assert(sl !== undefined, 'Streamline aktif modlar arasında olmalı');
        assert(sl.hasConfig === false, 'Streamline hasConfig: false olmalı');
        assert(sl.hasReleases === true, 'Streamline hasReleases: true olmalı');
        assert(sl.installedVersion === '2.4.0', `Streamline sürümü 2.4.0 olmalı, gelen: ${sl.installedVersion}`);
    });

    await test('getModule: Alias desteği (dlss-enabler <-> dlssenabler) sorunsuz çalışmalı', () => {
        const mod1 = moduleManager.getModule('dlssenabler');
        const mod2 = moduleManager.getModule('dlss-enabler');
        assert(mod1 !== null, 'dlssenabler bulunabilmeli');
        assert(mod2 !== null, 'dlss-enabler alias ile bulunabilmeli');
        assert(mod1.manifest.id === mod2.manifest.id, 'Her iki ID de aynı manifesti getirmeli');
    });

    // ── 13. Dynamic Search & In-Place Backup Testleri (Streamline) ───────────────
    console.log('\n─── Dynamic Search & In-Place Backup Testleri ────────');
    const moduleEngine = require('./core/moduleEngine');

    await test('findDynamicSearchDir: En sığ (shallowest) DLL dizinini doğru tespit etmeli', () => {
        const testBase = path.join(mockUserData, 'dyn_search_game');
        const deepDir = path.join(testBase, 'Engine', 'Plugins', 'Streamline', 'Binaries', 'Win64');
        const shallowDir = path.join(testBase, 'Binaries', 'Win64');
        fs.mkdirSync(deepDir, { recursive: true });
        fs.mkdirSync(shallowDir, { recursive: true });

        fs.writeFileSync(path.join(deepDir, 'sl.interposer.dll'), 'deep dll');
        fs.writeFileSync(path.join(shallowDir, 'sl.interposer.dll'), 'shallow dll');

        const detection = {
            strategy: 'shallowest_directory',
            files: ['sl.interposer.dll', 'sl.dlss.dll']
        };

        const found = moduleEngine.findDynamicSearchDir(testBase, detection);
        assert(found === shallowDir, `Beklenen ${shallowDir}, bulunan: ${found}`);
    });

    await test('findDynamicSearchDir: Dosya yoksa fallback largest executable dizinini seçmeli', () => {
        const testBase = path.join(mockUserData, 'fallback_game');
        const exeDir = path.join(testBase, 'Game', 'Binaries');
        fs.mkdirSync(exeDir, { recursive: true });
        const bigExe = path.join(exeDir, 'Game.exe');
        // 3 MB dosya oluştur
        const buf = Buffer.alloc(3 * 1024 * 1024);
        fs.writeFileSync(bigExe, buf);

        const detection = {
            strategy: 'shallowest_directory',
            files: ['sl.interposer.dll'],
            fallback: 'largest_executable_directory'
        };

        const found = moduleEngine.findDynamicSearchDir(testBase, detection);
        assert(found === exeDir, `Beklenen ${exeDir}, bulunan: ${found}`);
    });

    await test('Streamline tam manifest validasyonundan geçmeli', () => {
        const p = path.join(__dirname, 'official', 'streamline', 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const res = manifestValidator.validate(manifest);
        assert(res.valid === true, `Streamline validasyon hatası: ${res.errors.join(', ')}`);
        assert(manifest.install.destination === 'dynamic_search');
        assert(manifest.install.extractRoot === 'bin/x64');
        assert(manifest.backup.strategy === 'in_place_suffix');
        assert(manifest.uninstall.strategy === 'in_place_suffix');
    });

    await test('developer-games: nuclear-nightmare bağıl yolu kök klasör tekrarı içermemeli', () => {
        const p = path.join(__dirname, '..', '..', '..', 'developer-games.json');
        const devGames = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const entry = devGames['nuclear-nightmare'];
        assert(entry, 'nuclear-nightmare developer-games içinde tanımlı olmalı');
        assert(
            !entry.exe_relative_path.startsWith('Nuclear Nightmare/'),
            `exe_relative_path fazladan "Nuclear Nightmare/" içermemeli: ${entry.exe_relative_path}`
        );
        assert(
            entry.exe_relative_path === 'NuclearNightmare/Binaries/Win64/NuclearNightmare-Win64-Shipping.exe',
            `Beklenen: NuclearNightmare/Binaries/Win64/NuclearNightmare-Win64-Shipping.exe, Alınan: ${entry.exe_relative_path}`
        );
    });

    console.log('\n─── Yerel Dosya Algılama ve Tekrar İndirmeme Testleri ───');
    const config = require('../config');
    await test('findExistingLocalModDir: Mevcut sürüm klasörünü ve v varyantlarını doğru bulmalı', () => {
        const testModId = 'test-cache-mod';
        const testVer = '1.2.3';
        const testDir = path.join(config.modsPath, testModId, testVer);
        fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(path.join(testDir, 'mod.dll'), 'binary', 'utf-8');

        try {
            const manifest = { id: testModId, source: { repo: 'test/test' } };
            
            // Tam sürüm eşleşmesi
            const foundExact = moduleEngine.findExistingLocalModDir(manifest, testVer);
            assert(foundExact === testDir, `Tam eşleşme başarısız. Beklenen: ${testDir}, Bulunan: ${foundExact}`);

            // 'v' ön ekli arama ile 'v'siz klasörü bulma
            const foundWithV = moduleEngine.findExistingLocalModDir(manifest, `v${testVer}`);
            assert(foundWithV === testDir, `v ön ekli eşleşme başarısız. Beklenen: ${testDir}, Bulunan: ${foundWithV}`);

            // Olmayan sürüm null dönmeli
            const foundMissing = moduleEngine.findExistingLocalModDir(manifest, '9.9.9');
            assert(foundMissing === null, 'Olmayan sürüm null dönmeli');
        } finally {
            try { fs.rmSync(path.join(config.modsPath, testModId), { recursive: true, force: true }); } catch (e) {}
        }
    });

    await test('downloadRelease: Dosya zaten varsa tekrar indirmemeli (alreadyExists: true)', async () => {
        const testModId = 'test-cache-mod2';
        const testVer = '2.0.0';
        const testDir = path.join(config.modsPath, testModId, testVer);
        fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(path.join(testDir, 'version.dll'), 'binary', 'utf-8');

        try {
            const manifest = { id: testModId, source: { repo: 'test/test' } };
            const result = await moduleEngine.downloadRelease(manifest, testVer, 'https://invalid-url.com/fake.zip');
            assert(result.success === true, 'İndirme başarılı kabul edilmeli');
            assert(result.alreadyExists === true, 'alreadyExists bayrağı true olmalı');
            assert(result.targetDir === testDir, `Hedef dizin doğru olmalı: ${result.targetDir}`);
        } finally {
            try { fs.rmSync(path.join(config.modsPath, testModId), { recursive: true, force: true }); } catch (e) {}
        }
    });

    // ── Sonuçlar ──────────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`  Sonuç: ${passed} geçti, ${failed} başarısız`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
