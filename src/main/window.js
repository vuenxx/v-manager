const { app, BrowserWindow } = require('electron');
const path = require('path');

const config = require('./config');

function createWindow() {
    const settings = config.getSettings();
    let width = 1280;
    let height = 720;
    if (settings && settings.resolution) {
        const parts = settings.resolution.split('x');
        if (parts.length === 2) {
            const w = parseInt(parts[0], 10);
            const h = parseInt(parts[1], 10);
            if (!isNaN(w) && !isNaN(h)) {
                width = w;
                height = h;
            }
        }
    }

    const mainWindow = new BrowserWindow({
        width,
        height,
        minWidth: 1280,
        minHeight: 720,
        // Windows'un kendi başlık çubuğu yerine uygulamanın kendi kontrolleri kullanılıyor
        // (index.html → .window-controls, src/renderer/ui/window-controls.js).
        // thickFrame varsayılan olarak true kalır; kenarlardan yeniden boyutlandırma çalışır.
        frame: false,
        backgroundColor: '#050505',   // açılışta beyaz parlama olmasın
        autoHideMenuBar: true,
        icon: path.join(app.getAppPath(), 'program_logo.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // Since window.js is inside projectRoot/src/main/,
            // preload.js is located at projectRoot/preload.js (two levels up)
            preload: path.join(app.getAppPath(), 'preload.js')
        }
    });

    mainWindow.loadFile(path.join(app.getAppPath(), 'index.html'));

    // Renderer'daki büyüt/geri al ikonu pencere durumunu takip etsin
    const sendMaximizeState = (isMaximized) => {
        if (!mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('window-maximize-changed', isMaximized);
        }
    };
    mainWindow.on('maximize', () => sendMaximizeState(true));
    mainWindow.on('unmaximize', () => sendMaximizeState(false));

    mainWindow.on('close', (e) => {
        const ipc = require('./ipc');
        if (ipc.isCompressionRunning && ipc.isCompressionRunning()) {
            e.preventDefault();
            mainWindow.webContents.send('show-close-warning');
            return;
        }

        // VLSS5 indirme/kurulum sürerken kapatma engellenir — yarıda kesilen
        // güncelleme bozuk kuruluma yol açabilir. (Zorla kapatılırsa bir sonraki
        // açılışta vlss5Manager.checkForUpdatesOnStartup onarır.)
        try {
            const vlss5Manager = require('./modules/vlss5/vlss5Manager');
            if (vlss5Manager.isBusy && vlss5Manager.isBusy()) {
                e.preventDefault();
                mainWindow.webContents.send('vlss5-update-event', { type: 'close-blocked' });
                return;
            }
        } catch (err) {
            console.error('[WINDOW] VLSS5 kapatma kontrolü hatası:', err.message);
        }

        if (!app.isQuitting) {
            const currentSettings = config.getSettings();
            const behavior = (currentSettings && currentSettings.closeBehavior) ? currentSettings.closeBehavior : 'tray';
            if (behavior === 'exit') {
                app.isQuitting = true;
                app.quit();
            } else {
                e.preventDefault();
                mainWindow.hide();
            }
        }
    });

    return mainWindow;
}

module.exports = {
    createWindow
};
