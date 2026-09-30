const { app, Tray, Menu } = require('electron');
const path = require('path');
const config = require('./config');

let tray = null;
let currentMainWindow = null;

// Tray menüsü daha önce hiç yerelleştirilmemişti — uygulama ayarlarda İngilizce'ye
// çevrilse bile tepsi menüsü kalıcı olarak Türkçe kalıyordu (discord.js'deki
// TRANSLATIONS deseniyle aynı fikir).
const TRANSLATIONS = {
    tr: { games: 'Oyunlar', mods: 'Modlar', settings: 'Ayarlar', exit: 'Çıkış' },
    en: { games: 'Games', mods: 'Mods', settings: 'Settings', exit: 'Exit' }
};
function getTrayStrings() {
    const lang = (config.getSettings().language === 'en') ? 'en' : 'tr';
    return TRANSLATIONS[lang];
}

function createTray(mainWindow) {
    currentMainWindow = mainWindow;
    if (tray) {
        updateTrayMenu();
        return tray;
    }

    const iconPath = path.join(app.getAppPath(), 'program_logo.ico');
    tray = new Tray(iconPath);
    tray.setToolTip('V-Manager');

    updateTrayMenu();

    // Single click / Double click to restore and focus window
    tray.on('click', () => {
        if (currentMainWindow) {
            if (currentMainWindow.isVisible()) {
                if (currentMainWindow.isMinimized()) currentMainWindow.restore();
                currentMainWindow.focus();
            } else {
                currentMainWindow.show();
                currentMainWindow.focus();
            }
        }
    });

    tray.on('double-click', () => {
        if (currentMainWindow) {
            currentMainWindow.show();
            if (currentMainWindow.isMinimized()) currentMainWindow.restore();
            currentMainWindow.focus();
        }
    });

    return tray;
}

function updateTrayMenu() {
    if (!tray) return;

    const recentGames = config.getRecentGames() || [];
    const template = [];

    if (recentGames.length > 0) {
        recentGames.forEach(game => {
            template.push({
                label: game.name,
                click: async () => {
                    const launcher = require('./mods/launcher');
                    await launcher.launchGame(game);
                    config.addRecentGame(game);
                    updateTrayMenu();
                }
            });
        });
        template.push({ type: 'separator' });
    }

    const strings = getTrayStrings();
    template.push(
        {
            label: strings.games,
            click: () => {
                showWindowAndNavigate(currentMainWindow, 'games');
            }
        },
        {
            label: strings.mods,
            click: () => {
                showWindowAndNavigate(currentMainWindow, 'modes');
            }
        },
        {
            label: strings.settings,
            click: () => {
                showWindowAndNavigate(currentMainWindow, 'settings-tab');
            }
        },
        { type: 'separator' },
        {
            label: strings.exit,
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    );

    const contextMenu = Menu.buildFromTemplate(template);
    tray.setContextMenu(contextMenu);
}

function showWindowAndNavigate(mainWindow, tabId) {
    if (!mainWindow) return;
    if (!mainWindow.isVisible()) {
        mainWindow.show();
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.focus();
    mainWindow.webContents.send('navigate-tab', tabId);
}

function destroyTray() {
    if (tray) {
        tray.destroy();
        tray = null;
    }
}

module.exports = {
    createTray,
    updateTrayMenu,
    destroyTray
};
