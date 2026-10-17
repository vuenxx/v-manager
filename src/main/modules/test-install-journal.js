/**
 * test-install-journal.js — Yarım kalan kurulum defteri (installJournal) ve
 * açılış onarımı (moduleEngine.repairPendingInstalls) testleri.
 *
 * Gerçek indirme yapmaz; çökmüş bir kurulumun bıraktığı disk durumu ve defter
 * kaydı elle hazırlanır, sonra onarımın bunu geri aldığı doğrulanır.
 */

'use strict';

const path = require('path');
const fs = require('fs');

// Diğer testlerin userData'sına (ve oradaki olası defter dosyasına) dokunmamak için ayrı klasör
const testDataDir = path.join(__dirname, '..', '..', '..', 'test-data');
const mockUserData = path.join(testDataDir, 'journal-userData');
const fakeGameDir = path.join(testDataDir, 'journal-game');
fs.rmSync(mockUserData, { recursive: true, force: true });
fs.rmSync(fakeGameDir, { recursive: true, force: true });
fs.mkdirSync(mockUserData, { recursive: true });

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

const installJournal = require('./core/installJournal');
const moduleEngine = require('./core/moduleEngine');
const moduleManager = require('./core/moduleManager');

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

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

/**
 * Kopyalama adımında çökmüş bir kurulumun disk durumu:
 *   dxgi.dll      → orijinali dxgi.dll.bak'a alınmış, yerine mod dosyası yazılmış
 *   extra.dll     → kurulumla yeni eklenmiş
 *   pending.dll   → deftere yazılmış ama kopyalanamadan process ölmüş (diskte yok)
 */
function simulateCrashedInstall(entryId) {
    fs.mkdirSync(fakeGameDir, { recursive: true });
    const dxgi = path.join(fakeGameDir, 'dxgi.dll');
    fs.writeFileSync(dxgi + '.bak', 'orijinal');
    fs.writeFileSync(dxgi, 'mod');
    fs.writeFileSync(path.join(fakeGameDir, 'extra.dll'), 'mod');

    installJournal.begin(entryId, { manifestId: 'test-mod', gameName: 'JournalGame', destDir: fakeGameDir });
    installJournal.update(entryId, {
        destDir: fakeGameDir,
        backupCreated: null,
        rollbackState: {
            installedPaths: [dxgi, path.join(fakeGameDir, 'extra.dll'), path.join(fakeGameDir, 'pending.dll')],
            renamedBaks: [{ original: dxgi, backup: dxgi + '.bak' }],
            inPlaceBackups: []
        }
    });
}

async function run() {
    console.log('\n=== installJournal / repairPendingInstalls ===');

    // ── 1. Defter temel işlemleri ─────────────────────────────────────────
    installJournal.begin('a::1', { manifestId: 'a' });
    installJournal.update('a::1', { step: 13 });
    let all = installJournal.getAllPending();
    check('begin + update kaydı birleştirir', all['a::1'] && all['a::1'].manifestId === 'a' && all['a::1'].step === 13, all);
    installJournal.clear('a::1');
    check('clear kaydı siler', !installJournal.getAllPending()['a::1']);
    check('defter yazımı .tmp dosyası bırakmaz (atomik)',
        !fs.existsSync(path.join(mockUserData, 'pending-install-journal.json.tmp')));

    // ── 2. Açılış onarımı yarım kurulumu geri alır ────────────────────────
    simulateCrashedInstall('test-mod::crash1');
    const res = await moduleEngine.repairPendingInstalls();
    check('onarım 1 kaydı işledi', res.repaired === 1 && res.total === 1, res);
    check('orijinal dxgi.dll geri yüklendi', read(path.join(fakeGameDir, 'dxgi.dll')) === 'orijinal');
    check('.bak dosyası kalmadı', !fs.existsSync(path.join(fakeGameDir, 'dxgi.dll.bak')));
    check('kurulumla eklenen dosya silindi', !fs.existsSync(path.join(fakeGameDir, 'extra.dll')));
    check('onarım sonrası defter boş', Object.keys(installJournal.getAllPending()).length === 0);

    // ── 3. init() tekrar çağrıldığında süren kurulum geri ALINMAMALI ──────
    // İlk init() açılış onarımını tetikler (defter şu an boş).
    moduleManager.init();
    await new Promise(r => setTimeout(r, 50));

    // Şimdi "süren" bir kurulum varmış gibi defter kaydı aç ve init()'i
    // özel manifest kaydet / module-reload'daki gibi yeniden çağır.
    fs.rmSync(fakeGameDir, { recursive: true, force: true });
    simulateCrashedInstall('test-mod::running');
    moduleManager.init();
    await new Promise(r => setTimeout(r, 50));

    check('ikinci init() süren kurulumun defter kaydını silmedi',
        !!installJournal.getAllPending()['test-mod::running']);
    check('ikinci init() süren kurulumun dosyalarına dokunmadı',
        read(path.join(fakeGameDir, 'dxgi.dll')) === 'mod' && fs.existsSync(path.join(fakeGameDir, 'extra.dll')));

    // ── Temizlik ──────────────────────────────────────────────────────────
    fs.rmSync(mockUserData, { recursive: true, force: true });
    fs.rmSync(fakeGameDir, { recursive: true, force: true });

    console.log('\n=======================================');
    console.log(`  Sonuc: ${passed} gecti, ${failed} basarisiz`);
    console.log('=======================================\n');
    if (failed > 0) process.exit(1);
}

run().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
});
