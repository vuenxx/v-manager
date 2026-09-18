const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const config = require('./config');
const ipc = require('./ipc');
const windowManager = require('./window');
const { initAutoUpdater } = require('./updater');
const discord = require('./discord');
const license = require('./license');

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const myWindow = BrowserWindow.getAllWindows()[0];
        if (myWindow) {
            if (myWindow.isMinimized()) myWindow.restore();
            myWindow.focus();
        }
    });

    let lastLicenseStatus = null;

    app.whenReady().then(async () => {
        // ── License check ────────────────────────────────────────────────
        lastLicenseStatus = await license.checkLicense();

        if (!lastLicenseStatus.activated) {
            console.log('[MAIN] License not activated. Showing activation window. Error:', lastLicenseStatus.error);
            createActivationWindow();
            return;
        }

        // ── Fully licensed — boot the app normally ───────────────────────
        bootApp();
    });
}

// ── Activation window ─────────────────────────────────────────────────────────

let activationWin = null;

function createActivationWindow() {
    activationWin = new BrowserWindow({
        width: 520,
        height: 640,
        resizable: false,
        // Ana pencereyle aynı görünüm: Windows başlık çubuğu yerine kendi kontrollerimiz
        // (activation.html → .window-controls)
        frame: false,
        backgroundColor: '#050505',
        autoHideMenuBar: true,
        icon: path.join(app.getAppPath(), 'program_logo.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(app.getAppPath(), 'activation_preload.js'),
        },
    });

    activationWin.loadFile(path.join(app.getAppPath(), 'activation.html'));

    // Pencere kontrolleri — ana penceredeki 'window:*' kanalları bootApp() sırasında
    // kaydedildiği için (lisans kapısı ondan önce çalışır) burada ayrı kanallar kullanılıyor.
    ipcMain.handle('activation:minimize', () => {
        if (activationWin && !activationWin.isDestroyed()) activationWin.minimize();
    });

    ipcMain.handle('activation:close', () => {
        if (activationWin && !activationWin.isDestroyed()) activationWin.close();
    });

    // IPC: get HWID to display in the activation window
    ipcMain.handle('license:get-hwid', async () => {
        return await license.getMachineId();
    });

    // IPC: get last license check status/error
    ipcMain.handle('license:get-status', () => {
        return lastLicenseStatus;
    });

    // IPC: submit activation code
    ipcMain.handle('license:activate', async (_event, code) => {
        const result = await license.activate(code);
        if (result.success) {
            // Close activation window and boot the main app
            setTimeout(() => {
                if (activationWin && !activationWin.isDestroyed()) {
                    activationWin.close();
                    activationWin = null;
                }
                bootApp();
            }, 800); // Small delay so the user sees the success message
        }
        return result;
    });

    activationWin.on('closed', () => {
        activationWin = null;
    });
}

const trayManager = require('./tray');

// ── Normal app boot ───────────────────────────────────────────────────────────

function bootApp() {
    config.cleanOldModsFolder();
    config.loadExistingGames();
    config.loadBlacklist();

    // Manifest tabanlı modül sistemi başlat
    const moduleManager = require('./modules/core/moduleManager');
    moduleManager.init();

    // C-06: Guard against duplicate IPC handler registration (e.g. macOS 'activate' re-triggers)
    ipc.registerIpcHandlers();

    const mainWindow = windowManager.createWindow();
    trayManager.createTray(mainWindow);
    initAutoUpdater();

    try {
        discord.initDiscordRpc();
    } catch (e) {
        console.error('[MAIN] Failed to initialize Discord RPC on startup:', e.message);
    }

    // VLSS5: yarım kalan güncellemeyi onar + yeni sürüm varsa arka planda kur.
    // Pencere yüklendikten sonra çalışır ki uyarı mesajı kullanıcıya ulaşabilsin.
    mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(() => {
            const vlss5Manager = require('./modules/vlss5/vlss5Manager');
            vlss5Manager.checkForUpdatesOnStartup().catch((err) => {
                console.error('[MAIN] VLSS5 güncelleme kontrolü başarısız:', err.message);
            });
        }, 3000);   // açılış taramasıyla yarışmasın
    });

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) {
            windowManager.createWindow();
        }
    });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.on('before-quit', () => {
    app.isQuitting = true;
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    try {
        discord.shutdownDiscordRpc();
    } catch (e) {}
});
