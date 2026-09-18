// webUtils: Electron 32+ ile File.path kaldırıldığı için sürükle-bırakta dosya yolu
// almanın tek yolu. Eski sürümlerde undefined gelir, aşağıda file.path'e düşülür.
const { contextBridge, ipcRenderer, shell, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getGames: () => ipcRenderer.invoke('get-games'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    launchGame: (game) => ipcRenderer.invoke('launch-game', game),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    startScan: (scanSettings) => ipcRenderer.send('start-scan', scanSettings),
    onGameFound: (callback) => { ipcRenderer.removeAllListeners('game-found'); ipcRenderer.on('game-found', (_event, game) => callback(game)); },
    onScanProgress: (callback) => { ipcRenderer.removeAllListeners('scan-progress'); ipcRenderer.on('scan-progress', (_event, percent) => callback(percent)); },
    onScanComplete: (callback) => { ipcRenderer.removeAllListeners('scan-complete'); ipcRenderer.on('scan-complete', () => callback()); },
    addManualGame: () => ipcRenderer.invoke('add-manual-game'),
    saveManualGame: (data) => ipcRenderer.invoke('save-manual-game', data),
    toggleFavorite: (gameName) => ipcRenderer.invoke('toggle-favorite', gameName),
    refreshSingleGame: (gameData) => ipcRenderer.invoke('refresh-single-game', gameData),

    // M-28: openExternal removed — use openExternalLink IPC channel for security
    
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
    scanFolderForExes: (folderPath) => ipcRenderer.invoke('scan-folder-for-exes', folderPath),
    executeDlssInstall: (data) => ipcRenderer.invoke('execute-dlss-install', data),
    autoInstallDlss: (data) => ipcRenderer.invoke('auto-install-dlss', data),

    // DLSS Sürüm Yöneticisi
    dlssParseZip: (data) => ipcRenderer.invoke('dlss-parse-zip', data),
    dlssInstallFromZip: (data) => ipcRenderer.invoke('dlss-install-from-zip', data),
    getDlssEnablerReleases: (forceRefresh = false) => ipcRenderer.invoke('get-dlss-enabler-releases', { forceRefresh }),
    downloadDlssEnablerRelease: (data) => ipcRenderer.invoke('download-dlss-enabler-release', data),
    onDlssEnablerDownloadProgress: (callback) => ipcRenderer.on('dlss-enabler-download-progress', (_event, data) => callback(data)),
    removeDlssEnablerProgressListeners: () => ipcRenderer.removeAllListeners('dlss-enabler-download-progress'),

    // ── Dual-layer Game Path System IPCs ────────────────────────────────────
    getUserGames: () => ipcRenderer.invoke('get-user-games'),
    saveUserGame: (data) => ipcRenderer.invoke('save-user-game', data),
    deleteUserGame: (normKey) => ipcRenderer.invoke('delete-user-game', normKey),
    getDeveloperGames: () => ipcRenderer.invoke('get-developer-games'),
    getDlssEnablerGames: () => ipcRenderer.invoke('get-dlss-enabler-games'),
    resolveGamePaths: (gameName, exePath) => ipcRenderer.invoke('resolve-game-paths', gameName, exePath),

    // Streamline IPCs
    getStreamlineVersions: () => ipcRenderer.invoke('get-streamline-versions'),
    checkStreamlineBackup: (data) => ipcRenderer.invoke('check-streamline-backup', data),
    installStreamline: (data) => ipcRenderer.invoke('install-streamline', data),
    restoreStreamline: (data) => ipcRenderer.invoke('restore-streamline', data),
    getStreamlineReleases: (forceRefresh = false) => ipcRenderer.invoke('get-streamline-releases', { forceRefresh }),
    downloadStreamlineRelease: (data) => ipcRenderer.invoke('download-streamline-release', data),
    onStreamlineDownloadProgress: (callback) => ipcRenderer.on('streamline-download-progress', (_event, data) => callback(data)),
    removeStreamlineProgressListeners: () => ipcRenderer.removeAllListeners('streamline-download-progress'),

    // OptiScaler IPCs
    getOptiScalerReleases: (forceRefresh = false) => ipcRenderer.invoke('get-optiscaler-releases', { forceRefresh }),
    downloadOptiScalerRelease: (data) => ipcRenderer.invoke('download-optiscaler-release', data),
    onOptiscalerDownloadProgress: (callback) => ipcRenderer.on('optiscaler-download-progress', (_event, data) => callback(data)),
    // FIX 4f: Expose a cleanup function to remove accumulated progress listeners
    removeOptiScalerProgressListeners: () => ipcRenderer.removeAllListeners('optiscaler-download-progress'),
    installOptiscaler: (data) => ipcRenderer.invoke('install-optiscaler', data),

    // OptiBuilder IPCs
    getOptiBuilderReleases: (forceRefresh = false) => ipcRenderer.invoke('get-optibuilder-releases', { forceRefresh }),
    downloadOptiBuilderRelease: (data) => ipcRenderer.invoke('download-optibuilder-release', data),
    onOptiBuilderDownloadProgress: (callback) => ipcRenderer.on('optibuilder-download-progress', (_event, data) => callback(data)),
    removeOptiBuilderProgressListeners: () => ipcRenderer.removeAllListeners('optibuilder-download-progress'),
    installOptiBuilder: (data) => ipcRenderer.invoke('install-optibuilder', data),

    // OptiPatcher IPCs
    getOptiPatcherReleases: (forceRefresh = false) => ipcRenderer.invoke('get-optipatcher-releases', { forceRefresh }),
    downloadOptiPatcherRelease: (data) => ipcRenderer.invoke('download-optipatcher-release', data),
    onOptipatcherDownloadProgress: (callback) => ipcRenderer.on('optipatcher-download-progress', (_event, data) => callback(data)),
    removeOptiPatcherProgressListeners: () => ipcRenderer.removeAllListeners('optipatcher-download-progress'),

    // FSR4 Files IPCs
    getFsr4Releases: (forceRefresh = false) => ipcRenderer.invoke('get-fsr4-releases', { forceRefresh }),
    downloadFsr4Release: (data) => ipcRenderer.invoke('download-fsr4-release', data),
    onFsr4DownloadProgress: (callback) => ipcRenderer.on('fsr4-download-progress', (_event, data) => callback(data)),
    removeFsr4ProgressListeners: () => ipcRenderer.removeAllListeners('fsr4-download-progress'),

    // INI Editor IPCs
    readModIni: (game, mod) => ipcRenderer.invoke('read-mod-ini', { game, mod }),
    writeModIni: (game, mod, data) => ipcRenderer.invoke('write-mod-ini', { game, mod, data }),

    // Mod Presets IPCs
    readModPresets: (mod) => ipcRenderer.invoke('mod-presets:read', { mod }),
    writeModPresets: (mod, presets) => ipcRenderer.invoke('mod-presets:write', { mod, presets }),

    // Folder selection
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    analyzeFolder: (folderPath) => ipcRenderer.invoke('analyze-folder', folderPath),
    getFolderGameInfo: (folderPath) => ipcRenderer.invoke('get-folder-game-info', folderPath),

    // Compression Core
    runCompression: (data) => ipcRenderer.invoke('run-compression', data),
    runUncompression: (data) => ipcRenderer.invoke('run-uncompression', data),
    onCompressionProgress: (callback) => ipcRenderer.on('compression-progress', (_event, data) => callback(data)),
    // C-02: Cleanup function for compression progress listeners to prevent memory leaks
    removeCompressionProgressListeners: () => ipcRenderer.removeAllListeners('compression-progress'),

    // System Info
    getSystemInfo: (args) => ipcRenderer.invoke('get-system-info', args),

    // Compression History
    getCompressionHistory: () => ipcRenderer.invoke('get-compression-history'),
    removeHistoryEntry: (id) => ipcRenderer.invoke('remove-history-entry', id),
    clearCompressionHistory: () => ipcRenderer.invoke('clear-compression-history'),

    // YouTube RSS and External Link opening
    fetchYoutubeVideos: () => ipcRenderer.invoke('fetch-youtube-videos'),
    fetchFreeGames: () => ipcRenderer.invoke('fetch-free-games'),
    openExternalLink: (url) => ipcRenderer.send('open-external-link', url),

    // GitHub Releases API — tüm sürümleri çek
    fetchAllReleases: () => ipcRenderer.invoke('fetch-all-releases'),

    // Custom scan folders API
    getCustomFolders: () => ipcRenderer.invoke('get-custom-folders'),
    saveCustomFolders: (folders) => ipcRenderer.invoke('save-custom-folders', folders),
    getCustomSubfoldersList: () => ipcRenderer.invoke('get-custom-subfolders-list'),
    saveCustomSubfoldersList: (subfolders) => ipcRenderer.invoke('save-custom-subfolders-list', subfolders),

    // ── Auto-Updater IPCs ──────────────────────────────────────────────────────
    checkForUpdatesManual: () => ipcRenderer.invoke('check-for-updates-manual'),
    startUpdateDownload: () => ipcRenderer.send('start-update-download'),
    quitAndInstall: () => ipcRenderer.send('quit-and-install'),
    onShowCloseWarning: (cb) => { ipcRenderer.removeAllListeners('show-close-warning'); ipcRenderer.on('show-close-warning', () => cb()); },
    onNavigateTab: (cb) => { ipcRenderer.removeAllListeners('navigate-tab'); ipcRenderer.on('navigate-tab', (_event, tabId) => cb(tabId)); },

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
    },

    // DLSS Wizard IPCs
    runDlssWizard: (data) => ipcRenderer.invoke('run-dlss-wizard', data),
    abortDlssWizard: () => ipcRenderer.invoke('abort-dlss-wizard'),
    clearWizardLogs: () => ipcRenderer.invoke('clear-wizard-logs'),
    getWizardLogsInfo: () => ipcRenderer.invoke('get-wizard-logs-info'),
    openWizardLogsDir: () => ipcRenderer.invoke('open-wizard-logs-dir'),
    onWizardLog: (callback) => {
        ipcRenderer.removeAllListeners('wizard-log');
        ipcRenderer.on('wizard-log', (_event, data) => callback(data));
    },
    removeWizardLogListeners: () => ipcRenderer.removeAllListeners('wizard-log'),
    checkDx12Support: (exePath) => ipcRenderer.invoke('check-dx12-support', exePath),
    runOptiWizard: (data) => ipcRenderer.invoke('run-opti-wizard', data),
    abortOptiWizard: () => ipcRenderer.invoke('abort-opti-wizard'),
    onOptiWizardLog: (callback) => { ipcRenderer.removeAllListeners('opti-wizard-log'); ipcRenderer.on('opti-wizard-log', (_event, data) => callback(data)); },
    removeOptiWizardLogListeners: () => ipcRenderer.removeAllListeners('opti-wizard-log'),

    // OptiBuilder Wizard
    runOptiBuilderWizard: (data) => ipcRenderer.invoke('run-optibuilder-wizard', data),
    abortOptiBuilderWizard: () => ipcRenderer.invoke('abort-optibuilder-wizard'),
    onOptiBuilderWizardLog: (callback) => { ipcRenderer.removeAllListeners('optibuilder-wizard-log'); ipcRenderer.on('optibuilder-wizard-log', (_event, data) => callback(data)); },
    removeOptiBuilderWizardLogListeners: () => ipcRenderer.removeAllListeners('optibuilder-wizard-log'),

    deleteModVersion: (data) => ipcRenderer.invoke('delete-mod-version', data),
    openModFolder: (data) => ipcRenderer.invoke('open-mod-folder', data),

    // Discord Rich Presence APIs
    onDiscordRpcError: (callback) => {
        ipcRenderer.removeAllListeners('discord-rpc-error');
        ipcRenderer.on('discord-rpc-error', (_event, errorMsg) => callback(errorMsg));
    },
    removeDiscordRpcErrorListeners: () => ipcRenderer.removeAllListeners('discord-rpc-error'),

    // ── Manifest Tabanlı Modül Sistemi IPCs ─────────────────────────────────
    moduleList: () => ipcRenderer.invoke('module-list'),
    moduleGetInfo: (moduleId) => ipcRenderer.invoke('module-get-info', typeof moduleId === 'object' ? moduleId : { moduleId }),
    moduleGetActiveForGame: (game) => ipcRenderer.invoke('module-get-active-for-game', game),
    moduleReadConfig: (opts) => ipcRenderer.invoke('module-read-config', opts),
    moduleApplyConfigChanges: (opts) => ipcRenderer.invoke('module-apply-config-changes', opts),
    moduleSaveManifest: (manifest) => ipcRenderer.invoke('module-save-manifest', manifest),
    moduleDeleteCustomManifest: (moduleId) => ipcRenderer.invoke('module-delete-custom-manifest', typeof moduleId === 'object' ? moduleId : { moduleId }),
    moduleValidateManifest: (manifest) => ipcRenderer.invoke('module-validate-manifest', manifest),
    moduleReload: () => ipcRenderer.invoke('module-reload'),
    moduleInstall: (dataOrModuleId, gameName, exePath, tag, options) => {
        if (typeof dataOrModuleId === 'object' && dataOrModuleId !== null) {
            return ipcRenderer.invoke('module-install', dataOrModuleId);
        }
        return ipcRenderer.invoke('module-install', {
            moduleId: dataOrModuleId,
            gameName,
            exePath,
            tag,
            options
        });
    },
    moduleUninstall: (dataOrModuleId, gameName, exePath) => {
        if (typeof dataOrModuleId === 'object' && dataOrModuleId !== null) {
            return ipcRenderer.invoke('module-uninstall', dataOrModuleId);
        }
        return ipcRenderer.invoke('module-uninstall', {
            moduleId: dataOrModuleId,
            gameName,
            exePath
        });
    },
    moduleGetReleases: (moduleIdOrOpts, forceRefresh = false) => {
        if (typeof moduleIdOrOpts === 'object' && moduleIdOrOpts !== null) {
            return ipcRenderer.invoke('module-get-releases', moduleIdOrOpts);
        }
        return ipcRenderer.invoke('module-get-releases', {
            moduleId: moduleIdOrOpts,
            forceRefresh
        });
    },
    moduleDownloadRelease: (opts) => ipcRenderer.invoke('module-download-release', opts),
    onModuleDownloadProgress: (callback) => {
        ipcRenderer.removeAllListeners('module-download-progress');
        ipcRenderer.on('module-download-progress', (_event, data) => callback(data));
    },
    removeModuleDownloadProgressListeners: () => ipcRenderer.removeAllListeners('module-download-progress'),
    onModuleProgress: (callback) => {
        ipcRenderer.removeAllListeners('module-progress');
        ipcRenderer.on('module-progress', (_event, data) => callback(data));
    },
    moduleRunWizard: (moduleIdOrOpts, gameName, exePath, options) => {
        if (typeof moduleIdOrOpts === 'object' && moduleIdOrOpts !== null) {
            return ipcRenderer.invoke('module-wizard-run', moduleIdOrOpts);
        }
        return ipcRenderer.invoke('module-wizard-run', {
            moduleId: moduleIdOrOpts,
            gameName,
            exePath,
            options
        });
    },
    moduleAbortWizard: () => ipcRenderer.invoke('module-wizard-abort'),
    moduleDetectApi: (data) => ipcRenderer.invoke('module-detect-api', data),
    moduleCheckRequirements: (data) => ipcRenderer.invoke('module-check-requirements', data),
    moduleCheckConflicts: (data) => ipcRenderer.invoke('module-check-conflicts', data),
    removeModuleProgressListeners: () => ipcRenderer.removeAllListeners('module-progress'),

    // ── Winget Tabanlı Araçlar API ───────────────────────────────────────────
    toolsGetStatus: () => ipcRenderer.invoke('tools:get-status'),
    toolsInstall: (toolId) => ipcRenderer.invoke('tools:install', toolId),
    toolsUninstall: (toolId) => ipcRenderer.invoke('tools:uninstall', toolId),
    toolsUpgrade: (toolId) => ipcRenderer.invoke('tools:upgrade', toolId),
    toolsLaunch: (toolId) => ipcRenderer.invoke('tools:launch', toolId),
    onToolsOperationLog: (callback) => {
        ipcRenderer.on('tools-operation-log', (_event, data) => callback(data));
    },
    removeToolsOperationLogListeners: () => ipcRenderer.removeAllListeners('tools-operation-log'),

    // ── Pencere kontrolleri (özel başlık çubuğu) ─────────────────────────────
    windowMinimize: () => ipcRenderer.invoke('window:minimize'),
    windowToggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    windowClose: () => ipcRenderer.invoke('window:close'),
    windowIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onWindowMaximizeChanged: (callback) => {
        ipcRenderer.removeAllListeners('window-maximize-changed');
        ipcRenderer.on('window-maximize-changed', (_event, isMaximized) => callback(isMaximized));
    },
    removeWindowMaximizeListeners: () => ipcRenderer.removeAllListeners('window-maximize-changed'),

    // ── VLSS5 API ────────────────────────────────────────────────────────────
    vlss5GetStatus: (opts) => ipcRenderer.invoke('vlss5:get-status', opts),
    vlss5Install: (opts) => ipcRenderer.invoke('vlss5:install', opts),
    vlss5Launch: () => ipcRenderer.invoke('vlss5:launch'),
    vlss5SetDll: (filePath) => ipcRenderer.invoke('vlss5:set-dll', filePath),
    vlss5PickDll: () => ipcRenderer.invoke('vlss5:pick-dll'),
    vlss5FindDll: () => ipcRenderer.invoke('vlss5:find-dll'),
    vlss5OpenFolder: () => ipcRenderer.invoke('vlss5:open-folder'),
    vlss5Uninstall: () => ipcRenderer.invoke('vlss5:uninstall'),
    vlss5CheckUpdates: () => ipcRenderer.invoke('vlss5:check-updates'),
    vlss5IsBusy: () => ipcRenderer.invoke('vlss5:is-busy'),
    onVlss5UpdateEvent: (callback) => {
        ipcRenderer.removeAllListeners('vlss5-update-event');
        ipcRenderer.on('vlss5-update-event', (_event, data) => callback(data));
    },
    removeVlss5UpdateEventListeners: () => ipcRenderer.removeAllListeners('vlss5-update-event'),
    onVlss5Progress: (callback) => {
        ipcRenderer.removeAllListeners('vlss5-progress');
        ipcRenderer.on('vlss5-progress', (_event, data) => callback(data));
    },
    removeVlss5ProgressListeners: () => ipcRenderer.removeAllListeners('vlss5-progress'),

    /**
     * Sürüklenen File nesnesinin disk yolunu döndürür.
     * Electron 32+ → webUtils.getPathForFile, öncesi → file.path
     */
    getPathForFile: (file) => {
        try {
            if (webUtils && typeof webUtils.getPathForFile === 'function') {
                return webUtils.getPathForFile(file) || '';
            }
        } catch (e) { /* aşağıdaki geriye dönük yola düş */ }
        return (file && file.path) || '';
    }
});

