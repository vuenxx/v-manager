const { autoUpdater } = require('electron-updater');
const { app, BrowserWindow } = require('electron');
const log = require('electron-log');

// ─── Loglama ──────────────────────────────────────────────────────────────────
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('[UPDATER] updater.js yüklendi.');

// Kullanıcı onayından sonra manuel indirme yapacağız
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

// ─── Yardımcı: aktif pencereye event gönder ───────────────────────────────────
function sendToRenderer(channel, payload) {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) {
        wins[0].webContents.send(channel, payload);
    }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
autoUpdater.on('checking-for-update', () => {
    log.info('[UPDATER] Güncelleme kontrol ediliyor...');
    sendToRenderer('update-checking');
});

autoUpdater.on('update-available', (info) => {
    log.info(`[UPDATER] Yeni sürüm bulundu: ${info.version}`);
    sendToRenderer('update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes || '',
        releaseDate: info.releaseDate || ''
    });
});

autoUpdater.on('update-not-available', (info) => {
    log.info(`[UPDATER] Güncel sürüm kullanılıyor: ${info.version}`);
    sendToRenderer('update-not-available', { version: info.version });
});

autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update-download-progress', {
        percent: Math.floor(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond
    });
});

autoUpdater.on('update-downloaded', (info) => {
    log.info(`[UPDATER] Güncelleme indirildi: ${info.version}`);
    sendToRenderer('update-downloaded', { version: info.version });
});

autoUpdater.on('error', (err) => {
    log.error('[UPDATER] Hata:', err.message);
    sendToRenderer('update-error', err.message);
});

// ─── Dışa Açılan Fonksiyonlar ─────────────────────────────────────────────────

let autoCheckInterval = null;
const AUTO_CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Otomatik updater'ı başlatır.
 * SADECE paketlenmiş (production) build'de çalışır.
 * Uygulama hazır olunca 3 sn bekleyip sessizce kontrol eder.
 */
function initAutoUpdater() {
    if (!app.isPackaged) {
        log.info('[UPDATER] Development modunda — otomatik kontrol atlandı.');
        return;
    }

    // Uygulama penceresi hazır oluncaya kadar 3 saniye bekle
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => {
            log.error('[UPDATER] Otomatik kontrol hatası:', err.message);
        });
    }, 3000);

    // Periyodik kontrolü kur
    if (autoCheckInterval) {
        clearInterval(autoCheckInterval);
    }
    autoCheckInterval = setInterval(() => {
        log.info('[UPDATER] Periyodik güncelleme kontrolü başlatılıyor...');
        autoUpdater.checkForUpdates().catch((err) => {
            log.error('[UPDATER] Periyodik kontrol hatası:', err.message);
        });
    }, AUTO_CHECK_INTERVAL);

    // Memory leak önleme: uygulama kapatılırken interval'ı temizle
    app.on('before-quit', () => {
        if (autoCheckInterval) {
            clearInterval(autoCheckInterval);
            autoCheckInterval = null;
            log.info('[UPDATER] Periyodik kontrol intervali temizlendi.');
        }
    });
}

/**
 * Kullanıcının manuel olarak "Güncelleme Kontrol Et" butonuna basmasıyla çağrılır.
 * Development'ta sahte "güncel" yanıtı döner.
 */
async function checkForUpdates() {
    if (!app.isPackaged) {
        log.info('[UPDATER] Development — manuel kontrol simüle edildi.');
        return { updateAvailable: false, devMode: true };
    }

    try {
        return await autoUpdater.checkForUpdates();
    } catch (err) {
        log.error('[UPDATER] Manuel kontrol hatası:', err.message);
        throw err;
    }
}

/** İndirmeyi başlatır. */
function startDownload() {
    if (!app.isPackaged) {
        log.info('[UPDATER] Development — indirme simüle edildi.');
        return;
    }
    autoUpdater.downloadUpdate().catch((err) => {
        log.error('[UPDATER] İndirme hatası:', err.message);
        sendToRenderer('update-error', err.message);
    });
}

/** İndirilen güncellemeyi uygular ve uygulamayı yeniden başlatır. */
function quitAndInstall() {
    log.info('[UPDATER] quitAndInstall çağrıldı.');
    autoUpdater.quitAndInstall();
}

module.exports = { initAutoUpdater, checkForUpdates, startDownload, quitAndInstall };
