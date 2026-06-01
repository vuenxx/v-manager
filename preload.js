const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getGames: () => ipcRenderer.invoke('get-games'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    startScan: (scanSettings) => ipcRenderer.send('start-scan', scanSettings),
    onGameFound: (callback) => ipcRenderer.on('game-found', (_event, game) => callback(game)),
    onScanProgress: (callback) => ipcRenderer.on('scan-progress', (_event, percent) => callback(percent)),
    onScanComplete: (callback) => ipcRenderer.on('scan-complete', () => callback()),
    addManualGame: () => ipcRenderer.invoke('add-manual-game'),
    saveManualGame: (data) => ipcRenderer.invoke('save-manual-game', data),
    toggleFavorite: (gameName) => ipcRenderer.invoke('toggle-favorite', gameName),
    openExternal: (url) => shell.openExternal(url),
    
    // Logging
    logToMain: (msg) => ipcRenderer.send('log-to-main', msg),

    // Blacklist IPCs
    getBlacklist: () => ipcRenderer.invoke('get-blacklist'),
    addToBlacklist: (gameName) => ipcRenderer.invoke('add-to-blacklist', gameName),
    removeFromBlacklist: (gameName) => ipcRenderer.invoke('remove-from-blacklist', gameName),
    removeGame: (gameName) => ipcRenderer.invoke('remove-game', gameName),
    compareVersions: (v1, v2) => ipcRenderer.invoke('compare-versions', v1, v2),

    // Mod Uninstall IPC
    uninstallMod: (data) => ipcRenderer.invoke('uninstall-mod', data),

    // DLSS Enabler IPCs
    getSystemDrives: () => ipcRenderer.invoke('get-system-drives'),
    getDlssVersions: () => ipcRenderer.invoke('get-dlss-versions'),
    selectExe: () => ipcRenderer.invoke('select-exe'),
    executeDlssInstall: (data) => ipcRenderer.invoke('execute-dlss-install', data),
    autoInstallDlss: (data) => ipcRenderer.invoke('auto-install-dlss', data),

    // DLSS Sürüm Yöneticisi
    dlssParseZip: (data) => ipcRenderer.invoke('dlss-parse-zip', data),
    dlssInstallFromZip: (data) => ipcRenderer.invoke('dlss-install-from-zip', data),

    // ── Dual-layer Game Path System IPCs ────────────────────────────────────
    getUserGames: () => ipcRenderer.invoke('get-user-games'),
    saveUserGame: (data) => ipcRenderer.invoke('save-user-game', data),
    deleteUserGame: (normKey) => ipcRenderer.invoke('delete-user-game', normKey),
    getDeveloperGames: () => ipcRenderer.invoke('get-developer-games'),
    resolveGamePaths: (gameName, exePath) => ipcRenderer.invoke('resolve-game-paths', gameName, exePath),

    // Streamline IPCs
    getStreamlineVersions: () => ipcRenderer.invoke('get-streamline-versions'),
    checkStreamlineBackup: (data) => ipcRenderer.invoke('check-streamline-backup', data),
    installStreamline: (data) => ipcRenderer.invoke('install-streamline', data),
    restoreStreamline: (data) => ipcRenderer.invoke('restore-streamline', data),
    getStreamlineReleases: () => ipcRenderer.invoke('get-streamline-releases'),
    downloadStreamlineRelease: (data) => ipcRenderer.invoke('download-streamline-release', data),
    onStreamlineDownloadProgress: (callback) => ipcRenderer.on('streamline-download-progress', (_event, data) => callback(data)),
    removeStreamlineProgressListeners: () => ipcRenderer.removeAllListeners('streamline-download-progress'),

    // OptiScaler IPCs
    getOptiScalerReleases: () => ipcRenderer.invoke('get-optiscaler-releases'),
    downloadOptiScalerRelease: (data) => ipcRenderer.invoke('download-optiscaler-release', data),
    onOptiscalerDownloadProgress: (callback) => ipcRenderer.on('optiscaler-download-progress', (_event, data) => callback(data)),
    // FIX 4f: Expose a cleanup function to remove accumulated progress listeners
    removeOptiScalerProgressListeners: () => ipcRenderer.removeAllListeners('optiscaler-download-progress'),
    installOptiscaler: (data) => ipcRenderer.invoke('install-optiscaler', data),

    // OptiPatcher IPCs
    getOptiPatcherReleases: () => ipcRenderer.invoke('get-optipatcher-releases'),
    downloadOptiPatcherRelease: (data) => ipcRenderer.invoke('download-optipatcher-release', data),
    onOptipatcherDownloadProgress: (callback) => ipcRenderer.on('optipatcher-download-progress', (_event, data) => callback(data)),
    removeOptiPatcherProgressListeners: () => ipcRenderer.removeAllListeners('optipatcher-download-progress'),

    // FSR4 Files IPCs
    getFsr4Releases: () => ipcRenderer.invoke('get-fsr4-releases'),
    downloadFsr4Release: (data) => ipcRenderer.invoke('download-fsr4-release', data),
    onFsr4DownloadProgress: (callback) => ipcRenderer.on('fsr4-download-progress', (_event, data) => callback(data)),
    removeFsr4ProgressListeners: () => ipcRenderer.removeAllListeners('fsr4-download-progress'),

    // INI Editor IPCs
    readModIni: (game, mod) => ipcRenderer.invoke('read-mod-ini', { game, mod }),
    writeModIni: (game, mod, data) => ipcRenderer.invoke('write-mod-ini', { game, mod, data }),

    // Folder selection
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    analyzeFolder: (folderPath) => ipcRenderer.invoke('analyze-folder', folderPath),
    getFolderGameInfo: (folderPath) => ipcRenderer.invoke('get-folder-game-info', folderPath),

    // Compression Core
    runCompression: (data) => ipcRenderer.invoke('run-compression', data),
    runUncompression: (data) => ipcRenderer.invoke('run-uncompression', data),
    onCompressionProgress: (callback) => ipcRenderer.on('compression-progress', (_event, data) => callback(data)),

    // Compression DB
    getCompressionDb: () => ipcRenderer.invoke('get-compression-db'),

    // YouTube RSS and External Link opening
    fetchYoutubeVideos: () => ipcRenderer.invoke('fetch-youtube-videos'),
    openExternalLink: (url) => ipcRenderer.send('open-external-link', url),

    // Custom scan folders API
    getCustomFolders: () => ipcRenderer.invoke('get-custom-folders'),
    saveCustomFolders: (folders) => ipcRenderer.invoke('save-custom-folders', folders),
    getCustomSubfoldersList: () => ipcRenderer.invoke('get-custom-subfolders-list'),
    saveCustomSubfoldersList: (subfolders) => ipcRenderer.invoke('save-custom-subfolders-list', subfolders),

    // ── Auto-Updater IPCs ──────────────────────────────────────────────────────
    checkForUpdatesManual: () => ipcRenderer.invoke('check-for-updates-manual'),
    startUpdateDownload: () => ipcRenderer.send('start-update-download'),
    quitAndInstall: () => ipcRenderer.send('quit-and-install'),

    // Updater Event Listeners
    onUpdateChecking:         (cb) => ipcRenderer.on('update-checking',          ()        => cb()),
    onUpdateAvailable:        (cb) => ipcRenderer.on('update-available',         (_e, info) => cb(info)),
    onUpdateNotAvailable:     (cb) => ipcRenderer.on('update-not-available',     (_e, info) => cb(info)),
    onUpdateDownloadProgress: (cb) => ipcRenderer.on('update-download-progress', (_e, data) => cb(data)),
    onUpdateDownloaded:       (cb) => ipcRenderer.on('update-downloaded',        (_e, info) => cb(info)),
    onUpdateError:            (cb) => ipcRenderer.on('update-error',             (_e, msg)  => cb(msg)),
    removeUpdateListeners: () => {
        ipcRenderer.removeAllListeners('update-checking');
        ipcRenderer.removeAllListeners('update-available');
        ipcRenderer.removeAllListeners('update-not-available');
        ipcRenderer.removeAllListeners('update-download-progress');
        ipcRenderer.removeAllListeners('update-downloaded');
        ipcRenderer.removeAllListeners('update-error');
    }
});
