const { autoUpdater } = require('electron-updater');
const { app, BrowserWindow } = require('electron');
const log = require('electron-log');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ─── Loglama ──────────────────────────────────────────────────────────────────
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('[UPDATER] updater.js yüklendi.');

// Kullanıcı onayından sonra manuel indirme yapacağız
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

// ─── Parçalı (differential) indirme önbelleği ─────────────────────────────────
//
// electron-updater yeni sürümü indirirken tamamını çekmez: eski kurulum
// dosyasında zaten var olan blokları kopyalar, sadece değişen kısmı indirir.
// Bunun için iki şeye bakar (AppUpdater.js → differentialDownloadInstaller):
//   • %LOCALAPPDATA%\<cacheDir>\installer.exe   → eski kurulum dosyası
//   • %LOCALAPPDATA%\<cacheDir>\current.blockmap → o dosyanın blok haritası
//
// Sorun: blockmap'i önbellekten okurken DOĞRULAMIYOR. İkisi birbirinden
// koparsa (bizde blockmap Haziran'daki v0.1.8'den, installer.exe ise
// 0.7.1'den kalmıştı) yeni sürüm bambaşka bir dosyanın haritasına göre
// parçalanıyor:
//   1. "yeniden kullanılabilir" oranı çöpe dönüyor — ölçtük: gerçek blockmap
//      ile %98 kullanılabilirken, bayat blockmap ile %4'e düşüyordu,
//   2. kopyalanan bloklar yanlış yerden geldiği için birleşen dosya bozuk
//      çıkıyor, sha512 tutmuyor,
//   3. updater %100'de "Cannot download differentially" deyip dosyanın
//      tamamını baştan indiriyor. Kullanıcı aynı dosyayı iki kez indiriyor.
//
// Çözüm: çifti her kontrolden önce tutarlılık açısından sınıyoruz. Blockmap'in
// tarif ettiği toplam boyut installer.exe'nin gerçek boyutuyla uyuşmuyorsa
// blockmap'i siliyoruz — electron-updater o zaman doğrusunu eski sürümün
// release'inden indiriyor (~125 KB) ve parçalı indirme düzgün çalışıyor.

/** app-update.yml'deki updaterCacheDirName'den önbellek klasörünü çözer. */
function getUpdaterCacheDir() {
    const base = process.env.LOCALAPPDATA;
    if (!base) return null;
    try {
        const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf-8');
        const match = yml.match(/^updaterCacheDirName:\s*(.+)$/m);
        if (match) return path.join(base, match[1].trim());
    } catch (e) {
        log.warn(`[UPDATER] app-update.yml okunamadı: ${e.message}`);
    }
    return null;
}

/** Önbellekteki blockmap ile installer.exe uyuşmuyorsa blockmap'i siler. */
function pruneStaleBlockmap() {
    const cacheDir = getUpdaterCacheDir();
    if (!cacheDir) return;

    const blockmapPath = path.join(cacheDir, 'current.blockmap');
    const installerPath = path.join(cacheDir, 'installer.exe');
    if (!fs.existsSync(blockmapPath)) return;   // yoksa zaten release'ten inecek

    let reason = null;
    try {
        if (!fs.existsSync(installerPath)) {
            reason = 'eşlik eden installer.exe yok';
        } else {
            const map = JSON.parse(zlib.gunzipSync(fs.readFileSync(blockmapPath)).toString());
            const described = (map.files || []).reduce(
                (sum, f) => sum + (f.sizes || []).reduce((a, b) => a + b, 0), 0);
            const actual = fs.statSync(installerPath).size;
            if (described !== actual) {
                reason = `blockmap ${described} bayt tarif ediyor, installer.exe ${actual} bayt`;
            }
        }
    } catch (e) {
        reason = `blockmap okunamadı: ${e.message}`;
    }

    if (!reason) {
        log.info('[UPDATER] Önbellek tutarlı — parçalı indirme kullanılabilir.');
        return;
    }

    try {
        fs.unlinkSync(blockmapPath);
        log.warn(`[UPDATER] Eskimiş blockmap silindi (${reason}). Doğrusu release'ten indirilecek.`);
    } catch (e) {
        log.error(`[UPDATER] Eskimiş blockmap silinemedi: ${e.message}`);
    }
}

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

    // Bozuk önbellek parçalı indirmeyi sabote ediyor — kontrolden önce ele.
    pruneStaleBlockmap();

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
        sendToRenderer('update-checking');
        setTimeout(() => {
            sendToRenderer('update-not-available', { version: app.getVersion() });
        }, 1000);
        return { updateAvailable: false, devMode: true };
    }

    try {
        pruneStaleBlockmap();
        return await autoUpdater.checkForUpdates();
    } catch (err) {
        log.error('[UPDATER] Manuel kontrol hatası:', err.message);
        sendToRenderer('update-error', err.message);
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

module.exports = { initAutoUpdater, checkForUpdates, startDownload, quitAndInstall, pruneStaleBlockmap };
