export const state = {
    currentSelectedGame: null,
    pendingExePath: null,
    pendingVersion: null,
    pendingDllName: null,
    currentOptiReleases: [],
    currentStreamlineReleases: [],
    isDownloadingOptiScaler: false,
    isDownloadingStreamline: false,
    isScanning: false,
    isRefreshingSingle: false, // Tekil oyun yenileme kilidi

    currentBlacklistPage: 1,
    gameSortMethod: 'name', // 'name', 'source'
    activePlatformFilter: null,
    gamesViewMode: localStorage.getItem('vmanager_games_view_mode') || 'grid' // 'grid' or 'list'
};
