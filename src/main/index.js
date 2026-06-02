const { app, BrowserWindow } = require('electron');
const config = require('./config');
const ipc = require('./ipc');
const windowManager = require('./window');
const { initAutoUpdater } = require('./updater');

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

    app.whenReady().then(() => {
        config.cleanOldModsFolder();
        config.loadExistingGames();
        config.loadBlacklist();
        ipc.registerIpcHandlers();
        windowManager.createWindow();
        initAutoUpdater();

        app.on('activate', function () {
            if (BrowserWindow.getAllWindows().length === 0) {
                windowManager.createWindow();
            }
        });
    });
}

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
