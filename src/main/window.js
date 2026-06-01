const { BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        minWidth: 800,
        minHeight: 600,
        autoHideMenuBar: true,
        icon: path.resolve(__dirname, '..', '..', 'program_logo.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // Since window.js is inside projectRoot/src/main/,
            // preload.js is located at projectRoot/preload.js (two levels up)
            preload: path.resolve(__dirname, '..', '..', 'preload.js')
        }
    });

    mainWindow.loadFile(path.resolve(__dirname, '..', '..', 'index.html'));
    return mainWindow;
}

module.exports = {
    createWindow
};
