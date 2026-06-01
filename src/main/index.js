const { app, BrowserWindow } = require('electron');
const config = require('./config');
const ipc = require('./ipc');
const windowManager = require('./window');
const { initAutoUpdater } = require('./updater');

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

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
