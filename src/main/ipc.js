const { ipcMain, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

const config = require('./config');
const scanner = require('./scanner');
const utils = require('./utils');
const dlssEnabler = require('./mods/dlssEnabler');
const optiScaler = require('./mods/optiScaler');
const optiBuilder = require('./mods/optiBuilder');
const optiBuilderWizard = require('./mods/optiBuilderWizard');
const optiPatcher = require('./mods/optiPatcher');
const fsr4Files = require('./mods/fsr4Files');
const streamline = require('./mods/streamline');
const uninstaller = require('./mods/uninstaller');
const compressor = require('./mods/compressor');
const analyser = require('./mods/analyser');
const compressionDb = require('./mods/compressionDb');
const steamScanner = require('./mods/steamScanner');
const iniEditor = require('./mods/iniEditor');
const updater = require('./updater');
const releaseCache = require('./mods/releaseCache');
const dlssWizard = require('./mods/dlssWizard');
const optiWizard = require('./mods/optiWizard');

let isScanning = false;
let isCompressing = false;
let isDlssWizardAborted = false;
let isOptiWizardAborted = false;
let isOptiBuilderWizardAborted = false;
let cachedSystemInfo = null;
// C-06: Prevent duplicate IPC handler registration
let ipcRegistered = false;

function registerIpcHandlers() {
    if (ipcRegistered) return;
    ipcRegistered = true;
    ipcMain.on('log-to-main', (event, msg) => {
        console.log(`[RENDERER] ${msg}`);
    });

    ipcMain.handle('get-app-version', () => {
        return require('electron').app.getVersion();
    });

    // Game retrieval
    ipcMain.handle('get-games', async () => {
        return config.getExistingGamesState();
    });

    ipcMain.handle('get-settings', () => {
        return config.getSettings();
    });

    ipcMain.handle('save-settings', (event, settings) => {
        const oldSettings = config.getSettings();
        config.saveSettings(settings);
        // Apply resolution changes instantly
        if (settings && settings.resolution) {
            const parts = settings.resolution.split('x');
            if (parts.length === 2) {
                const w = parseInt(parts[0], 10);
                const h = parseInt(parts[1], 10);
                if (!isNaN(w) && !isNaN(h)) {
                    const win = BrowserWindow.fromWebContents(event.sender);
                    if (win) {
                        win.setSize(w, h);
                        win.center();
                    }
                }
            }
        }

        // Apply Discord RPC changes instantly
        try {
            const discord = require('./discord');
            if (oldSettings.discordRpcEnabled !== settings.discordRpcEnabled || oldSettings.discordClientId !== settings.discordClientId) {
                if (settings.discordRpcEnabled) {
                    discord.initDiscordRpc();
                } else {
                    discord.shutdownDiscordRpc();
                }
            } else if (settings.discordRpcEnabled) {
                discord.setPresence();
            }
        } catch (e) {
            console.error('[IPC] Failed to update Discord RPC after settings save:', e.message);
        }

        return { success: true };
    });

    ipcMain.handle('launch-game', async (event, game) => {
        const result = await require('./mods/launcher').launchGame(game);
        if (result && result.success) {
            config.addRecentGame(game);
            try {
                require('./tray').updateTrayMenu();
            } catch (e) {}
        }
        return result;
    });

    // Scanner
    ipcMain.on('start-scan', async (event, scanSettings) => {
        if (isScanning) return; // Prevent multiple scans
        isScanning = true;

        try {
            await scanner.runScan(event, scanSettings);
        } catch(e) {
            console.error('Scan error', e);
        } finally {
            isScanning = false;
            // M-18: Guard against sending to a destroyed window
            if (!event.sender.isDestroyed()) {
                event.sender.send('scan-complete');
            }
        }
    });

    // Single-game refresh — sadece o oyunu yeniden tara, cover yenileme
    ipcMain.handle('refresh-single-game', async (event, gameData) => {
        if (isScanning) {
            return { exists: true, success: false, error: 'scan_in_progress' };
        }
        const gameRoot = gameData.gameRoot || path.dirname(gameData.exePath || '');
        if (!gameRoot || !fs.existsSync(gameRoot)) {
            return { exists: false };
        }
        try {
            // cover'ı koru — yeniden indirme, mevcut değeri geçir
            await scanner.processAndStreamGame({
                name: gameData.name,
                exePath: gameData.exePath,
                gameRoot: gameRoot,
                source: gameData.source || 'manual',
                launcherId: gameData.launcherId || null,
                cover: gameData.cover || null,
                coverUrl: null // kapak yenilenmesini engelle
            }, event);
            return { exists: true, success: true };
        } catch (err) {
            console.error('[IPC] refresh-single-game error:', err);
            return { exists: true, success: false, error: err.message };
        }
    });

    // System Drives
    ipcMain.handle('get-system-drives', async () => {
        return await utils.getSystemDrives();
    });

    // Manual Game adds — now opens a FOLDER dialog (game_root), not a file dialog
    ipcMain.handle('add-manual-game', async (event) => {
        console.log('[IPC] add-manual-game triggered');
        const window = BrowserWindow.fromWebContents(event.sender);
        const settings = config.getSettings();
        const lang = settings.language || 'tr';
        const isEn = lang === 'en';
        const { canceled, filePaths } = await dialog.showOpenDialog(window, {
            title: isEn ? 'Select Game Root Folder' : 'Oyun Ana Klasörünü Seçin',
            properties: ['openDirectory']
        });

        if (canceled || filePaths.length === 0) {
            console.log('[IPC] add-manual-game: Selection canceled');
            return null;
        }
        const gameRoot = filePaths[0];
        const defaultName = path.basename(gameRoot); // Use folder name as default game name
        console.log(`[IPC] add-manual-game: Folder selected: ${gameRoot}, defaultName: ${defaultName}`);
        return { gameRoot, defaultName };
    });

    ipcMain.handle('save-manual-game', async (event, { name, gameRoot, exePath }) => {
        console.log(`[IPC] save-manual-game: Saving -> name="${name}", gameRoot="${gameRoot}", exePath="${exePath}"`);
        try {
            // Fallback: if gameRoot not provided but exePath is, derive gameRoot from exe
            const resolvedGameRoot = gameRoot || (exePath ? path.dirname(exePath) : null);
            const finalExePath = exePath || resolvedGameRoot;

            if (!resolvedGameRoot) {
                console.error('[IPC] save-manual-game: No gameRoot or exePath provided!');
                throw new Error('Oyun klasörü veya EXE yolu belirtilmedi.');
            }

            const normKey = config.normalizeGameKey(name);

            // 1. Save to user-games.json
            const userGames = config.getUserGames();
            userGames[normKey] = {
                game_root: resolvedGameRoot,
                exe_path: finalExePath,
                display_name: name
            };
            config.saveUserGames(userGames);
            console.log(`[IPC] save-manual-game: user-games.json updated -> key="${normKey}", game_root="${resolvedGameRoot}", exe_path="${finalExePath}"`);

            // 2. Process and stream to UI
            await scanner.processAndStreamGame({
                name: name,
                exePath: finalExePath,
                gameRoot: resolvedGameRoot,
                source: 'manual',
                coverUrl: null
            }, event);

            console.log('[IPC] save-manual-game: Completed successfully');
            return config.getExistingGamesState();
        } catch (e) {
            console.error("[IPC] save-manual-game ERROR:", e);
            throw e;
        }
    });

    // Blacklist
    ipcMain.handle('get-blacklist', async () => {
        return config.getBlacklistState();
    });

    ipcMain.handle('add-to-blacklist', async (event, gameName) => {
        const blacklistState = config.getBlacklistState();
        if (!blacklistState.includes(gameName)) {
            blacklistState.push(gameName);
            config.saveBlacklist();
        }

        // Disable custom subfolder checkbox state if it came from one
        const game = config.getExistingGamesState().find(g => g.name === gameName);
        if (game && game.gameRoot) {
            const parentDir = path.dirname(game.gameRoot);
            const customFolders = config.getCustomFolders();
            if (customFolders.includes(parentDir)) {
                const subfolderState = config.getCustomSubfoldersState();
                subfolderState[game.gameRoot] = false;
                config.saveCustomSubfoldersState(subfolderState);
                console.log(`[IPC] Automatically disabled custom subfolder state on blacklist for: ${game.gameRoot}`);
            }
        }

        const filteredGames = config.getExistingGamesState().filter(g => g.name !== gameName);
        config.setExistingGamesState(filteredGames);
        config.saveGamesState();

        const normKey = config.normalizeGameKey(gameName);
        const userGames = config.getUserGames();
        if (userGames[normKey]) {
            delete userGames[normKey];
            config.saveUserGames(userGames);
        }
        return true;
    });

    ipcMain.handle('remove-game', async (event, gameName) => {
        const game = config.getExistingGamesState().find(g => g.name === gameName);
        if (game && game.gameRoot) {
            const parentDir = path.dirname(game.gameRoot);
            const customFolders = config.getCustomFolders();
            if (customFolders.includes(parentDir)) {
                const subfolderState = config.getCustomSubfoldersState();
                subfolderState[game.gameRoot] = false;
                config.saveCustomSubfoldersState(subfolderState);
                console.log(`[IPC] Automatically disabled custom subfolder state on remove for: ${game.gameRoot}`);
            }
        }

        const filteredGames = config.getExistingGamesState().filter(g => g.name !== gameName);
        config.setExistingGamesState(filteredGames);
        config.saveGamesState();

        const normKey = config.normalizeGameKey(gameName);
        const userGames = config.getUserGames();
        if (userGames[normKey]) {
            delete userGames[normKey];
            config.saveUserGames(userGames);
        }
        return true;
    });

    ipcMain.handle('remove-from-blacklist', async (event, gameName) => {
        const filteredBlacklist = config.getBlacklistState().filter(name => name !== gameName);
        config.setBlacklistState(filteredBlacklist);
        config.saveBlacklist();
        return true;
    });

    ipcMain.handle('compare-versions', async (event, v1, v2) => {
        return utils.compareVersions(v1, v2);
    });

    ipcMain.handle('toggle-favorite', async (event, gameName) => {
        return config.toggleFavorite(gameName);
    });

    // Mod uninstallations
    ipcMain.handle('uninstall-mod', async (event, data) => {
        return await uninstaller.uninstallMod(data);
    });

    // DLSS Enabler
    ipcMain.handle('get-dlss-versions', async () => {
        return await dlssEnabler.getDlssVersions();
    });

    ipcMain.handle('select-exe', async (event) => {
        return await dlssEnabler.selectExe(event);
    });

    ipcMain.handle('scan-folder-for-exes', async (event, folderPath) => {
        return utils.scanFolderForExes(folderPath);
    });

    ipcMain.handle('execute-dlss-install', async (event, { game, exePath, version, dllName, downloadUrl }) => {
        return await dlssEnabler.executeDlssInstall(event, game, exePath, version, dllName, downloadUrl);
    });

    ipcMain.handle('auto-install-dlss', async (event, { game, version, dllName, downloadUrl }) => {
        return await dlssEnabler.autoInstallDlss(event, game, version, dllName, downloadUrl);
    });

    // DLSS Sürüm Yöneticisi
    ipcMain.handle('dlss-parse-zip', async (event, { filePath, fileName }) => {
        console.log(`[IPC] dlss-parse-zip: "${fileName}" @ "${filePath}"`);
        return await dlssEnabler.parseZipForDlss(filePath);
    });

    ipcMain.handle('dlss-install-from-zip', async (event, { filePath, version }) => {
        console.log(`[IPC] dlss-install-from-zip: sürüm="${version}" @ "${filePath}"`);
        return await dlssEnabler.installDlssFromZip(filePath, version);
    });

    ipcMain.handle('get-dlss-enabler-releases', async (event, { forceRefresh } = {}) => {
        return await dlssEnabler.getDlssEnablerReleases(forceRefresh);
    });

    ipcMain.handle('download-dlss-enabler-release', async (event, { name, downloadUrl }) => {
        return await dlssEnabler.downloadDlssEnablerRelease(event, { name, downloadUrl });
    });

    ipcMain.handle('run-dlss-wizard', async (event, data) => {
        isDlssWizardAborted = false;
        return await dlssWizard.runDlssWizard(event, data, () => isDlssWizardAborted);
    });

    ipcMain.handle('abort-dlss-wizard', async () => {
        isDlssWizardAborted = true;
        return { success: true };
    });

    ipcMain.handle('clear-wizard-logs', async () => {
        return await dlssWizard.clearWizardLogs();
    });

    ipcMain.handle('get-wizard-logs-info', async () => {
        return await dlssWizard.getWizardLogsInfo();
    });

    ipcMain.handle('open-wizard-logs-dir', async () => {
        return await dlssWizard.openWizardLogsDir();
    });

    ipcMain.handle('check-dx12-support', async (event, exePath) => {
        return await utils.checkDx12Support(exePath);
    });

    ipcMain.handle('run-opti-wizard', async (event, data) => {
        isOptiWizardAborted = false;
        return await optiWizard.runOptiWizard(event, data, () => isOptiWizardAborted);
    });

    ipcMain.handle('abort-opti-wizard', async () => {
        isOptiWizardAborted = true;
        return { success: true };
    });

    ipcMain.handle('get-system-info', async (event, { forceRefresh } = {}) => {
        if (!cachedSystemInfo) {
            try {
                const settings = config.getSettings();
                if (settings && settings.systemInfo) {
                    cachedSystemInfo = settings.systemInfo;
                }
            } catch (e) {
                console.error('[IPC] Failed to read systemInfo from settings:', e);
            }
        }

        if (cachedSystemInfo && !forceRefresh) {
            return cachedSystemInfo;
        }

        return new Promise((resolve) => {
            const psCommand = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ` +
                `$gpu = ''; try { ` +
                `  $gpus = Get-CimInstance Win32_VideoController | Where-Object { $_.Status -eq 'OK' } | Select-Object Name, AdapterRAM; ` +
                `  $discretePatterns = 'NVIDIA GeForce|NVIDIA RTX|NVIDIA Quadro|NVIDIA T\\d|AMD Radeon RX|AMD Radeon Pro|Radeon\\(TM\\)\\s*RX|Intel\\(R\\)\\s*Arc A\\d'; ` +
                `  $discrete = $gpus | Where-Object { $_.Name -match $discretePatterns }; ` +
                `  if ($discrete) { ` +
                `    $gpu = ($discrete | Select-Object -First 1).Name ` +
                `  } else { ` +
                `    $integratedPatterns = 'Intel\\(R\\)\\s*(HD|UHD|Iris)|Radeon\\(TM\\)\\s*Graphics$|Vega\\s*\\d*\\s*Graphics$'; ` +
                `    $nonIntegrated = $gpus | Where-Object { $_.Name -notmatch $integratedPatterns }; ` +
                `    $gpu = if ($nonIntegrated) { ($nonIntegrated | Select-Object -First 1).Name } else { ($gpus | Select-Object -First 1).Name } ` +
                `  } ` +
                `} catch {}; ` +
                `$cpu = ''; try { $cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name } catch {}; ` +
                `$ramGb = '0'; try { $ramGb = [Math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB) } catch {}; ` +
                `$d3d12Max = 0; ` +
                `try { ` +
                `  $dx = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\DirectX' -ErrorAction SilentlyContinue; ` +
                `  if ($dx -ne $null -and $dx.D3D12MaxFeatureLevel -ne $null) { $d3d12Max = $dx.D3D12MaxFeatureLevel }; ` +
                `  $subkeys = Get-ChildItem -Path 'HKLM:\\SOFTWARE\\Microsoft\\DirectX' -ErrorAction SilentlyContinue; ` +
                `  if ($subkeys -ne $null) { ` +
                `    foreach ($sub in $subkeys) { ` +
                `      $subProps = Get-ItemProperty -Path $sub.PSPath -ErrorAction SilentlyContinue; ` +
                `      if ($subProps -ne $null -and $subProps.D3D12MaxFeatureLevel -ne $null) { ` +
                `        if ($subProps.D3D12MaxFeatureLevel -gt $d3d12Max) { $d3d12Max = $subProps.D3D12MaxFeatureLevel } ` +
                `      } ` +
                `    } ` +
                `  } ` +
                `} catch {}; ` +
                `$dx12Supported = 'False'; $dx12FeatureLevel = 'Yok'; ` +
                `if ($d3d12Max -gt 0) { ` +
                `  if ($d3d12Max -ge 49664) { $dx12Supported = 'True'; $dx12FeatureLevel = '12_2 (Ultimate)' } ` +
                `  elseif ($d3d12Max -ge 49408) { $dx12Supported = 'True'; $dx12FeatureLevel = '12_1' } ` +
                `  elseif ($d3d12Max -ge 48000) { $dx12Supported = 'True'; $dx12FeatureLevel = '12_0' } ` +
                `} else { ` +
                `  $dx12Supported = 'True'; $dx12FeatureLevel = 'Genel (Bilinmiyor)' ` +
                `}; ` +
                `$gpuTrim = if ($gpu) { $gpu.Trim() } else { 'Bilinmiyor' }; ` +
                `$cpuTrim = if ($cpu) { $cpu.Trim() } else { 'Bilinmiyor' }; ` +
                `Write-Output ($gpuTrim + ';' + $cpuTrim + ';' + $ramGb + ';' + $dx12Supported + ';' + $dx12FeatureLevel)`;

            const { spawn } = require('child_process');
            const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
                shell: false
            });

            let stdout = '';
            let stderr = '';

            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                if (code !== 0) {
                    console.error('[IPC] get-system-info process exited with code', code, 'stderr:', stderr);
                    resolve({ success: false, error: stderr || `Exited with code ${code}` });
                    return;
                }
                const parts = stdout.trim().split(';');
                if (parts.length >= 5) {
                    const info = {
                        success: true,
                        gpu: parts[0].trim() || 'Bilinmiyor',
                        cpu: parts[1].trim() || 'Bilinmiyor',
                        ram: (parts[2].trim() !== '0' ? parts[2].trim() + ' GB' : 'Bilinmiyor'),
                        dx12Supported: parts[3].trim() === 'True',
                        dx12FeatureLevel: parts[4].trim()
                    };
                    cachedSystemInfo = info;
                    try {
                        const settings = config.getSettings();
                        settings.systemInfo = info;
                        config.saveSettings(settings);
                    } catch (e) {
                        console.error('[IPC] Failed to save systemInfo to settings:', e);
                    }
                    resolve(info);
                } else {
                    resolve({
                        success: false,
                        error: 'Format error: ' + stdout
                    });
                }
            });

            child.on('error', (err) => {
                console.error('[IPC] get-system-info spawn error:', err);
                resolve({ success: false, error: err.message });
            });
        });
    });

    // ── Dual-layer Game Path System IPCs ──────────────────────────────────────

    /** Returns the full user-games.json map */
    ipcMain.handle('get-user-games', async () => {
        return config.getUserGames();
    });

    /** Save or update a user game entry */
    ipcMain.handle('save-user-game', async (event, { gameName, gameRoot, exePath }) => {
        console.log(`[IPC] save-user-game: gameName="${gameName}", gameRoot="${gameRoot}", exePath="${exePath}"`);
        const normKey = config.normalizeGameKey(gameName);
        const userGames = config.getUserGames();
        userGames[normKey] = {
            game_root: gameRoot,
            exe_path: exePath || gameRoot,
            display_name: gameName
        };
        config.saveUserGames(userGames);

        // Also try to scan this game now so it appears in the UI immediately
        const finalExePath = exePath || gameRoot;
        if (finalExePath && fs.existsSync(finalExePath)) {
            await scanner.processAndStreamGame({
                name: gameName,
                exePath: finalExePath,
                gameRoot: gameRoot,
                source: 'manual',
                coverUrl: null
            }, event);
        }

        return config.getUserGames();
    });

    /** Delete a user game entry by normalized key */
    ipcMain.handle('delete-user-game', async (event, normKey) => {
        const userGames = config.getUserGames();
        if (userGames[normKey]) {
            delete userGames[normKey];
            config.saveUserGames(userGames);
        }
        return config.getUserGames();
    });

    /** Returns developer-games.json (read-only, for UI display) */
    ipcMain.handle('get-developer-games', async () => {
        return config.getDeveloperGames();
    });

    /** Returns dlss_enabler_games.json (read-only, for UI display/highlighting) */
    ipcMain.handle('get-dlss-enabler-games', async () => {
        return config.getDlssEnablerGames();
    });

    /**
     * Resolves paths for a game using the dual-layer priority system.
     * Returns { game_root, exe_path, source } or null.
     */
    ipcMain.handle('resolve-game-paths', async (event, gameName, exePath) => {
        return config.getGamePaths(gameName, exePath);
    });

    // Streamline
    ipcMain.handle('get-streamline-versions', async () => {
        return await streamline.getStreamlineVersions();
    });

    ipcMain.handle('check-streamline-backup', async (event, { game, isAuto, manualExePath }) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        return await streamline.checkStreamlineBackup(game, isAuto, manualExePath, window);
    });

    ipcMain.handle('install-streamline', async (event, { game, version, targetDir, overwriteBackup, skipBackup }) => {
        return await streamline.installStreamline(game, version, targetDir, overwriteBackup, skipBackup);       
    });

    ipcMain.handle('restore-streamline', async (event, { gameName }) => {
        return await streamline.restoreStreamline(gameName);
    });

    ipcMain.handle('get-streamline-releases', async (event, { forceRefresh } = {}) => {
        return await streamline.getStreamlineReleases(forceRefresh);
    });

    ipcMain.handle('download-streamline-release', async (event, { tag, downloadUrl }) => {
        return await streamline.downloadStreamlineRelease(event, { tag, downloadUrl });
    });

    // OptiScaler
    ipcMain.handle('get-optiscaler-releases', async (event, { forceRefresh } = {}) => {
        return await optiScaler.getOptiScalerReleases(forceRefresh);
    });

    ipcMain.handle('download-optiscaler-release', async (event, { tag, downloadUrl }) => {
        return await optiScaler.downloadOptiScalerRelease(event, { tag, downloadUrl });
    });

    ipcMain.handle('install-optiscaler', async (event, data) => {
        return await optiScaler.installOptiScaler(event, data);
    });

    // OptiBuilder
    ipcMain.handle('run-optibuilder-wizard', async (event, data) => {
        isOptiBuilderWizardAborted = false;
        return await optiBuilderWizard.runOptiBuilderWizard(event, data, () => isOptiBuilderWizardAborted);
    });

    ipcMain.handle('abort-optibuilder-wizard', async () => {
        isOptiBuilderWizardAborted = true;
        return { success: true };
    });

    ipcMain.handle('get-optibuilder-releases', async (event, { forceRefresh } = {}) => {
        return await optiBuilder.getOptiBuilderReleases(forceRefresh);
    });

    ipcMain.handle('download-optibuilder-release', async (event, { tag, downloadUrl }) => {
        return await optiBuilder.downloadOptiBuilderRelease(event, { tag, downloadUrl });
    });

    ipcMain.handle('install-optibuilder', async (event, data) => {
        return await optiBuilder.installOptiBuilder(event, data);
    });

    // OptiPatcher
    ipcMain.handle('get-optipatcher-releases', async (event, { forceRefresh } = {}) => {
        if (forceRefresh) releaseCache.clearCache('optipatcher');
        return await optiPatcher.getOptiPatcherReleases();
    });

    ipcMain.handle('download-optipatcher-release', async (event, { tag, downloadUrl }) => {
        return await optiPatcher.downloadOptiPatcherRelease(event, { tag, downloadUrl });
    });

    // FSR4 Files
    ipcMain.handle('get-fsr4-releases', async (event, { forceRefresh } = {}) => {
        if (forceRefresh) releaseCache.clearCache('fsr4files');
        return await fsr4Files.getFsr4Releases();
    });

    ipcMain.handle('download-fsr4-release', async (event, { name, downloadUrl }) => {
        return await fsr4Files.downloadFsr4Release(event, { name, downloadUrl });
    });

    // Folder selection
    ipcMain.handle('select-folder', async (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        const settings = config.getSettings();
        const lang = settings.language || 'tr';
        const isEn = lang === 'en';
        const { canceled, filePaths } = await dialog.showOpenDialog(window, {
            title: isEn ? 'Select Folder' : 'Klasör Seç',
            properties: ['openDirectory']
        });

        if (canceled || filePaths.length === 0) return null;
        return filePaths[0];
    });

    ipcMain.handle('analyze-folder', async (event, folderPath) => {
        return await analyser.analyze(folderPath);
    });

    ipcMain.handle('get-folder-game-info', async (event, folderPath) => {
        // Compression DB disabled per user request — only return Steam identity info
        const steamInfo = await steamScanner.getAppIdForFolder(folderPath);
        if (steamInfo && steamInfo.appId) {
            return {
                isGame: true,
                steamId: steamInfo.appId,
                name: steamInfo.name,
                dbEntry: null
            };
        }
        return { isGame: false };
    });

    // Compression Core
    ipcMain.handle('run-compression', async (event, { folderPath, algorithm }) => {
        isCompressing = true;
        const startTime = Date.now();
        // Sıkıştırma öncesi analiz
        let beforeStats = { uncompressedBytes: 0, compressedBytes: 0, fileCount: 0, ratio: '1.0' };
        try { beforeStats = await analyser.analyze(folderPath); } catch (_) {}
        try {
            const result = await compressor.compress(folderPath, algorithm, {}, (progress) => {
                // M-18: Guard against sending to destroyed window
                if (!event.sender.isDestroyed()) {
                    event.sender.send('compression-progress', { folderPath, progress });
                }
            });
            // Sıkıştırma sonrası analiz → geçmişe kaydet
            let afterStats = { uncompressedBytes: beforeStats.uncompressedBytes, compressedBytes: 0, ratio: '1.0' };
            try { afterStats = await analyser.analyze(folderPath); } catch (_) {}
            const durationMs = Date.now() - startTime;
            const savedBytes = Math.max(0, afterStats.uncompressedBytes - afterStats.compressedBytes);
            const savedPercent = afterStats.uncompressedBytes > 0
                ? Math.max(0, Math.round((savedBytes / afterStats.uncompressedBytes) * 100))
                : 0;
            const folderName = require('path').basename(folderPath);
            await compressionDb.removeEntriesByPath(folderPath);
            await compressionDb.addEntry({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                timestamp: new Date().toISOString(),
                type: 'compress',
                folderPath,
                folderName,
                algorithm: algorithm || null,
                sizeBefore: afterStats.uncompressedBytes,
                sizeAfter: afterStats.compressedBytes,
                fileCount: afterStats.fileCount,
                ratio: afterStats.ratio,
                savedBytes,
                savedPercent,
                durationMs,
                success: true
            });
            return result;
        } finally {
            isCompressing = false;
        }
    });

    ipcMain.handle('run-uncompression', async (event, { folderPath }) => {
        isCompressing = true;
        const startTime = Date.now();
        // Geri alma öncesi analiz
        let beforeStats = { uncompressedBytes: 0, compressedBytes: 0, fileCount: 0, ratio: '1.0' };
        try { beforeStats = await analyser.analyze(folderPath); } catch (_) {}
        try {
            const result = await compressor.uncompress(folderPath, (progress) => {
                // M-18: Guard against sending to destroyed window
                if (!event.sender.isDestroyed()) {
                    event.sender.send('compression-progress', { folderPath, progress });
                }
            });
            // Geri alma başarılıysa o klasörün tüm geçmiş kayıtlarını sil
            await compressionDb.removeEntriesByPath(folderPath);
            return result;
        } finally {
            isCompressing = false;
        }
    });

    // Compression History
    ipcMain.handle('get-compression-history', async () => {
        return await compressionDb.getHistory();
    });

    ipcMain.handle('remove-history-entry', async (event, id) => {
        await compressionDb.removeEntry(id);
        return { success: true };
    });

    ipcMain.handle('clear-compression-history', async () => {
        await compressionDb.clearHistory();
        return { success: true };
    });


    // INI Editor
    ipcMain.handle('read-mod-ini', async (event, { game, mod }) => {
        console.log(`[IPC] read-mod-ini: requested for mod "${mod}", game Name: "${game ? game.name : 'undefined'}"`);
        console.log(`[IPC] read-mod-ini: game data:`, JSON.stringify(game, null, 2));
        const filePath = iniEditor.findIniPath(game, mod);
        console.log(`[IPC] read-mod-ini: resolved filePath is "${filePath}"`);
        if (!filePath) {
            console.log(`[IPC] read-mod-ini: returning EXE not found error`);
            return { exists: false, error: 'Oyun EXE yolu bulunamadı.' };
        }
        try {
            const res = iniEditor.readIni(filePath);
            console.log(`[IPC] read-mod-ini: readIni returned:`, JSON.stringify(res, null, 2));
            return res;
        } catch (err) {
            console.error('[IPC] read-mod-ini: Error reading INI:', err);
            return { exists: false, error: err.message };
        }
    });

    ipcMain.handle('write-mod-ini', async (event, { game, mod, data }) => {
        console.log(`[IPC] write-mod-ini: requested for mod "${mod}", game Name: "${game ? game.name : 'undefined'}"`);
        console.log(`[IPC] write-mod-ini: game data:`, JSON.stringify(game, null, 2));
        console.log(`[IPC] write-mod-ini: data payload:`, JSON.stringify(data, null, 2));
        const filePath = iniEditor.findIniPath(game, mod);
        console.log(`[IPC] write-mod-ini: resolved filePath is "${filePath}"`);
        if (!filePath) {
            console.log(`[IPC] write-mod-ini: returning EXE not found error`);
            return { success: false, error: 'Oyun EXE yolu bulunamadı.' };
        }
        try {
            iniEditor.writeIni(filePath, data);
            console.log(`[IPC] write-mod-ini: successfully wrote INI to "${filePath}"`);
            return { success: true };
        } catch (err) {
            console.error('[IPC] write-mod-ini: Error writing INI:', err);
            // Catching Windows EBUSY specifically
            if (err.code === 'EBUSY') {
                return { success: false, error: 'Dosya kullanılıyor. Oyun açık olabilir, oyunu kapatıp tekrar deneyin.' };
            }
            return { success: false, error: err.message };
        }
    });

    // Mod Presets
    ipcMain.handle('mod-presets:read', async (event, { mod }) => {
        console.log(`[IPC] mod-presets:read for mod="${mod}"`);
        try {
            return { success: true, presets: config.getModPresets(mod) };
        } catch (e) {
            console.error('[IPC] mod-presets:read error:', e.message);
            return { success: false, presets: [], error: e.message };
        }
    });

    ipcMain.handle('mod-presets:write', async (event, { mod, presets }) => {
        console.log(`[IPC] mod-presets:write for mod="${mod}", count=${presets ? presets.length : 0}`);
        try {
            config.saveModPresets(mod, presets);
            return { success: true };
        } catch (e) {
            console.error('[IPC] mod-presets:write error:', e.message);
            return { success: false, error: e.message };
        }
    });

    // YouTube RSS Feed Fetcher with automatic HTML fallback scraper
    ipcMain.handle('fetch-youtube-videos', async () => {
        const channelId = 'UCCeWDMKoZfZSNOn0pRIGBcw';
        const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        console.log('[IPC Debug] Attempting YouTube RSS feed fetch from:', rssUrl);
        
        // Attempt 1: Fetch via RSS feed
        try {
            const xml = await new Promise((resolve, reject) => {
                const options = {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                };
                https.get(rssUrl, options, (res) => {
                    console.log('[IPC Debug] YouTube RSS response status:', res.statusCode);
                    if (res.statusCode !== 200) {
                        return reject(new Error(`YouTube RSS returned HTTP status ${res.statusCode}`));
                    }
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => resolve(data));
                }).on('error', reject);
            });
            console.log('[IPC Debug] Standard RSS fetch succeeded (data length: %d bytes)', xml.length);
            return xml;
        } catch (err) {
            console.warn('[IPC Debug] Standard RSS fetch failed (%s). Attempting fallback channel page scraper...', err.message);
        }

        // Attempt 2: Scrape channel HTML page directly when YouTube RSS feed returns 404 or fails
        return new Promise((resolve, reject) => {
            const htmlUrl = `https://www.youtube.com/channel/${channelId}/videos`;
            console.log('[IPC Debug] Fetching channel videos HTML page from:', htmlUrl);
            const options = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
                }
            };

            https.get(htmlUrl, options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    const videoItems = [];
                    // Extract videoId + title pairs from YouTube lockupViewModel blocks
                    const blocks = data.split('lockupViewModel":');
                    const seen = new Set();

                    for (let i = 1; i < blocks.length; i++) {
                        const block = blocks[i];
                        const idMatch = block.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
                        const titleMatch = block.match(/"lockupMetadataViewModel":\{"title":\{"content":"([^"]+)"\}/) ||
                                           block.match(/"title":\{"content":"([^"]+)"\}/) ||
                                           block.match(/"title":\{"runs":\[\{"text":"([^"]+)"\}\]/);
                        if (idMatch && titleMatch) {
                            const id = idMatch[1];
                            const rawTitle = titleMatch[1] || titleMatch[2] || titleMatch[3];
                            // Decode unicode escape sequences like \u0026 -> &
                            const cleanTitle = rawTitle.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
                            if (!seen.has(id)) {
                                seen.add(id);
                                videoItems.push({ videoId: id, title: cleanTitle });
                            }
                        }
                    }

                    // Fallback to videoId extraction if lockupViewModel matching fails
                    if (videoItems.length === 0) {
                        const idMatches = [...data.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map(m => m[1]);
                        for (const id of idMatches) {
                            if (!seen.has(id)) {
                                seen.add(id);
                                videoItems.push({ videoId: id, title: 'YouTube Video' });
                            }
                        }
                    }

                    console.log(`[IPC Debug] Fallback successfully extracted ${videoItems.length} videos with real titles from YouTube HTML.`);

                    if (videoItems.length === 0) {
                        return reject(new Error('No videos found on YouTube channel page'));
                    }

                    // Construct XML response for renderer DOMParser
                    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">\n`;
                    xml += ` <link rel="self" href="${rssUrl}"/>\n`;
                    xml += ` <id>yt:channel:${channelId}</id>\n`;
                    xml += ` <title>VuenXx YouTube</title>\n`;
                    for (const v of videoItems) {
                        xml += ` <entry>\n`;
                        xml += `  <id>yt:video:${v.videoId}</id>\n`;
                        xml += `  <yt:videoId>${v.videoId}</yt:videoId>\n`;
                        xml += `  <title>${v.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>\n`;
                        xml += `  <link rel="alternate" href="https://www.youtube.com/watch?v=${v.videoId}"/>\n`;
                        xml += ` </entry>\n`;
                    }
                    xml += `</feed>`;
                    resolve(xml);
                });
            }).on('error', (err) => {
                console.error('[IPC Debug] Channel HTML scraper failed:', err);
                reject(err);
            });
        });
    });

    // GamerPower Free Games Fetcher using modern fetch API
    ipcMain.handle('fetch-free-games', async () => {
        try {
            const response = await fetch('https://www.gamerpower.com/api/giveaways', {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('[IPC] fetch-free-games error:', error);
            throw error;
        }
    });

    // GitHub Releases API — tüm sürümleri çek
    ipcMain.handle('fetch-all-releases', async () => {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                path: '/repos/vuenxx/v-manager/releases',
                method: 'GET',
                headers: {
                    'User-Agent': 'V-Manager-App',
                    'Accept': 'application/vnd.github.v3+json'
                }
            };
            const req = https.get(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const releases = JSON.parse(data);
                        if (!Array.isArray(releases)) {
                            console.error('[IPC] fetch-all-releases: Beklenmedik yanıt:', data.slice(0, 200));
                            resolve([]);
                            return;
                        }
                        // Sadece gerekli alanları gönder
                        const filtered = releases.map(r => ({
                            tag_name:    r.tag_name,
                            name:        r.name,
                            body:        r.body,
                            published_at: r.published_at,
                            prerelease:  r.prerelease,
                            draft:       r.draft,
                            html_url:    r.html_url
                        }));
                        resolve(filtered);
                    } catch (e) {
                        console.error('[IPC] fetch-all-releases parse hatası:', e.message);
                        reject(e);
                    }
                });
            });
            req.on('error', (err) => {
                console.error('[IPC] fetch-all-releases request hatası:', err.message);
                reject(err);
            });
        });
    });

    // Custom scan folders
    ipcMain.handle('get-custom-folders', async () => {
        return config.getCustomFolders();
    });

    ipcMain.handle('save-custom-folders', async (event, folders) => {
        config.saveCustomFolders(folders);
        return true;
    });

    ipcMain.handle('get-custom-subfolders-list', async (event) => {
        console.log('[IPC] get-custom-subfolders-list triggered');
        const folders = config.getCustomFolders();
        const savedState = config.getCustomSubfoldersState();
        const result = [];

        for (const folder of folders) {
            try {
                if (!fs.existsSync(folder)) {
                    console.log(`[IPC] custom folder does not exist: ${folder}`);
                    continue;
                }
                const dirents = await fs.promises.readdir(folder, { withFileTypes: true });
                for (const dirent of dirents) {
                    if (dirent.isDirectory()) {
                        if (scanner.isIgnoredGame({ name: dirent.name, exePath: '' })) {
                            console.log(`[IPC] Ignoring blacklisted launcher/redist subfolder: ${dirent.name}`);
                            continue;
                        }
                        const subfolderPath = path.join(folder, dirent.name);
                        const checked = savedState[subfolderPath] !== false;
                        result.push({
                            parentFolder: folder,
                            name: dirent.name,
                            path: subfolderPath,
                            checked: checked
                        });
                    }
                }
            } catch (e) {
                console.error(`[IPC] Error scanning custom folder ${folder}:`, e.message);
            }
        }
        return result;
    });

    ipcMain.handle('save-custom-subfolders-list', async (event, subfolders) => {
        console.log('[IPC] save-custom-subfolders-list triggered');
        const window = BrowserWindow.fromWebContents(event.sender);
        const savedState = config.getCustomSubfoldersState();
        const existingGames = config.getExistingGamesState();

        // 1. Save all states first (remember checkboxes for unchecked items too)
        for (const item of subfolders) {
            savedState[item.path] = item.checked;
        }
        config.saveCustomSubfoldersState(savedState);

        // 2. Filter out the checked ones to process
        const checkedItems = subfolders.filter(item => item.checked);
        const totalItems = checkedItems.length;
        let processedCount = 0;

        if (totalItems > 0) {
            event.sender.send('scan-progress', 0);
            
            for (const item of checkedItems) {
                const gameName = item.name;
                const gameRoot = item.path;
                const normKey = config.normalizeGameKey(gameName);

                const existingGame = existingGames.find(g => g.name.toLowerCase() === gameName.toLowerCase() || g.gameRoot === gameRoot);
                if (existingGame) {
                    const settings = config.getSettings();
                    const lang = settings.language || 'tr';
                    const isEn = lang === 'en';
                    const response = await dialog.showMessageBox(window, {
                        type: 'question',
                        buttons: isEn ? ['Yes', 'No'] : ['Evet', 'Hayır'],
                        title: isEn ? 'Conflict Detected' : 'Çakışma Tespit Edildi',
                        message: isEn 
                            ? `"${gameName}" is already in your list. Do you want to overwrite the existing game's data?`
                            : `"${gameName}" zaten listenizde mevcut. Mevcut oyunun verilerini üzerine yazmak istiyor musunuz?`
                    });

                    if (response.response !== 0) {
                        processedCount++;
                        const percent = Math.round((processedCount / totalItems) * 100);
                        event.sender.send('scan-progress', percent);
                        continue;
                    }
                    const updatedGamesList = existingGames.filter(g => g !== existingGame);
                    config.setExistingGamesState(updatedGamesList);
                }

                const devGames = config.getDeveloperGames();
                let exePath = gameRoot;
                if (devGames[normKey] && devGames[normKey].exe_relative_path) {
                    const relPath = devGames[normKey].exe_relative_path.replace(/\//g, '\\');
                    exePath = path.join(gameRoot, relPath);
                }

                try {
                    await scanner.processAndStreamGame({
                        name: gameName,
                        exePath: exePath,
                        gameRoot: gameRoot,
                        source: 'manual',
                        coverUrl: null
                    }, event);
                } catch (e) {
                    console.error(`[IPC] Error processing custom game ${gameName}:`, e.message);
                }

                processedCount++;
                const percent = Math.round((processedCount / totalItems) * 100);
                event.sender.send('scan-progress', percent);
            }
            // Tüm oyunlar işlendikten sonra son bir kayıt (her oyun için ayrı kayıt yerine daha verimli)
            config.saveGamesState();
        }

        return config.getExistingGamesState();
    });

    // C-05: Secure Link Opener via IPC — only allow http/https URLs
    ipcMain.on('open-external-link', (event, url) => {
        if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
            shell.openExternal(url);
        } else {
            console.warn('[IPC] open-external-link: blocked non-http URL:', url);
        }
    });

    // ── Auto-Updater IPCs ──────────────────────────────────────────────────────

    // Kullanıcı "Güncelleme Kontrol Et" butonuna bastığında
    ipcMain.handle('check-for-updates-manual', async () => {
        try {
            const result = await updater.checkForUpdates();
            return { success: true, result };
        } catch (e) {
            console.error('[IPC] check-for-updates-manual ERROR:', e.message);
            return { success: false, error: e.message };
        }
    });

    // Kullanıcı "İndir" butonuna bastığında
    ipcMain.on('start-update-download', () => {
        updater.startDownload();
    });

    // Kullanıcı "Kur ve Yeniden Başlat" butonuna bastığında
    ipcMain.on('quit-and-install', () => {
        updater.quitAndInstall();
    });

    // Unified Mod Versions - Delete and Open Folder handlers
    ipcMain.handle('delete-mod-version', async (event, { modName, name, tag }) => {
        try {
            const folderName = (modName === 'dlssenabler' || modName === 'fsr4') ? name : tag;
            if (!folderName) {
                return { success: false, error: 'Sürüm ismi/etiketi geçersiz.' };
            }

            let targetDir;
            if (modName === 'dlssenabler') {
                targetDir = path.join(config.modsPath, 'dlssenabler', folderName);
            } else if (modName === 'optiscaler') {
                targetDir = path.join(config.modsPath, 'optiscaler', folderName);
            } else if (modName === 'optibuilder') {
                targetDir = path.join(config.modsPath, 'optibuilder', folderName);
            } else if (modName === 'optipatcher') {
                targetDir = path.join(config.modsPath, 'OptiPatcher', folderName);
            } else if (modName === 'fsr4') {
                targetDir = path.join(config.modsPath, 'fsr4files', folderName);
            } else if (modName === 'streamline') {
                targetDir = path.join(config.streamlineModsPath, folderName);
            } else {
                const candidateTag = tag || folderName || name;
                targetDir = path.join(config.modsPath, modName, candidateTag);
                if (!fs.existsSync(targetDir) && name) {
                    const altDir = path.join(config.modsPath, modName, name);
                    if (fs.existsSync(altDir)) targetDir = altDir;
                }
            }

            console.log(`[IPC] delete-mod-version: received request to delete modName=${modName}, name=${name}, tag=${tag}`);
            console.log(`[IPC] delete-mod-version: target folderName resolved to: ${folderName}`);
            console.log(`[IPC] delete-mod-version: full target path to delete: ${targetDir}`);
            if (fs.existsSync(targetDir)) {
                await fs.promises.rm(targetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
                console.log(`[IPC] delete-mod-version: successfully deleted ${targetDir}`);
                return { success: true };
            } else {
                console.warn(`[IPC] delete-mod-version: target path not found: ${targetDir}`);
                return { success: false, error: `Sürüm klasörü bulunamadı: ${targetDir}` };
            }
        } catch (e) {
            console.error('[IPC] delete-mod-version error:', e);
            return { success: false, error: `Silme hatası: ${e.message}` };
        }
    });

    ipcMain.handle('open-mod-folder', async (event, { modName, name, tag }) => {
        try {
            const folderName = (modName === 'dlssenabler' || modName === 'fsr4') ? name : tag;
            if (!folderName) {
                return { success: false, error: 'Sürüm ismi/etiketi geçersiz.' };
            }

            let targetDir;
            if (modName === 'dlssenabler') {
                targetDir = path.join(config.modsPath, 'dlssenabler', folderName);
            } else if (modName === 'optiscaler') {
                targetDir = path.join(config.modsPath, 'optiscaler', folderName);
            } else if (modName === 'optibuilder') {
                targetDir = path.join(config.modsPath, 'optibuilder', folderName);
            } else if (modName === 'optipatcher') {
                targetDir = path.join(config.modsPath, 'OptiPatcher', folderName);
            } else if (modName === 'fsr4') {
                targetDir = path.join(config.modsPath, 'fsr4files', folderName);
            } else if (modName === 'streamline') {
                targetDir = path.join(config.streamlineModsPath, folderName);
            } else {
                const candidateTag = tag || folderName || name;
                targetDir = path.join(config.modsPath, modName, candidateTag);
                if (!fs.existsSync(targetDir) && name) {
                    const altDir = path.join(config.modsPath, modName, name);
                    if (fs.existsSync(altDir)) targetDir = altDir;
                }
            }

            console.log(`[IPC] open-mod-folder: opening targetDir -> ${targetDir}`);
            if (fs.existsSync(targetDir)) {
                await shell.openPath(targetDir);
                return { success: true };
            } else {
                return { success: false, error: `Sürüm klasörü bulunamadı: ${targetDir}` };
            }
        } catch (e) {
            console.error('[IPC] open-mod-folder error:', e);
            return { success: false, error: `Klasör açma hatası: ${e.message}` };
        }
    });

    // ── Manifest tabanlı modül sistemi ─────────────────────────────────────
    const moduleManager = require('./modules/core/moduleManager');
    moduleManager.registerIpcHandlers(ipcMain);

    // ── Winget Tabanlı Araçlar Sistemi ─────────────────────────────────────
    const toolsManager = require('./modules/tools/toolsManager');
    ipcMain.handle('tools:get-status', async () => {
        return await toolsManager.getToolsStatus();
    });

    ipcMain.handle('tools:install', async (event, toolId) => {
        return await toolsManager.runWingetOperation('install', toolId, event);
    });

    ipcMain.handle('tools:uninstall', async (event, toolId) => {
        return await toolsManager.runWingetOperation('uninstall', toolId, event);
    });

    ipcMain.handle('tools:upgrade', async (event, toolId) => {
        return await toolsManager.runWingetOperation('upgrade', toolId, event);
    });

    ipcMain.handle('tools:launch', async (event, toolId) => {
        return await toolsManager.launchTool(toolId);
    });

    // ── Pencere kontrolleri (frame: false — kendi başlık çubuğumuz) ────────
    // Her handler pencereyi event.sender üzerinden bulur; böylece ileride
    // başka bir BrowserWindow (ör. aktivasyon penceresi) de aynı kanalları kullanabilir.
    ipcMain.handle('window:minimize', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) win.minimize();
    });

    ipcMain.handle('window:toggle-maximize', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return false;
        if (win.isMaximized()) {
            win.unmaximize();
        } else {
            win.maximize();
        }
        return win.isMaximized();
    });

    ipcMain.handle('window:close', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        // win.close() → window.js'deki 'close' handler'ı çalışır
        // (sıkıştırma uyarısı + tepsiye gizleme / çıkış davranışı korunur)
        if (win) win.close();
    });

    ipcMain.handle('window:is-maximized', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        return win ? win.isMaximized() : false;
    });

    // ── VLSS5 (github.com/vuenxx/VLSS5) ────────────────────────────────────
    const vlss5Manager = require('./modules/vlss5/vlss5Manager');

    ipcMain.handle('vlss5:get-status', async (event, opts) => {
        return await vlss5Manager.getStatus(opts || {});
    });

    ipcMain.handle('vlss5:install', async (event, opts) => {
        return await vlss5Manager.install(event, opts || {});
    });

    ipcMain.handle('vlss5:launch', async () => {
        return await vlss5Manager.launch();
    });

    ipcMain.handle('vlss5:set-dll', async (event, filePath) => {
        return await vlss5Manager.setModelDll(filePath);
    });

    ipcMain.handle('vlss5:find-dll', async () => {
        return await vlss5Manager.findModelDllInDriverStore();
    });

    ipcMain.handle('vlss5:open-folder', async () => {
        return await vlss5Manager.openInstallFolder();
    });

    ipcMain.handle('vlss5:uninstall', async () => {
        return await vlss5Manager.uninstall();
    });

    // "Güncellemeleri kontrol et" — sürümü tazeler, güncelleme varsa kurar
    ipcMain.handle('vlss5:check-updates', async (event) => {
        return await vlss5Manager.checkForUpdatesManual(event);
    });

    // Kurulum/güncelleme sürüyor mu (renderer kapanma uyarısı için)
    ipcMain.handle('vlss5:is-busy', () => vlss5Manager.isBusy());

    // Model DLL'i dosya seçiciyle belirleme (select-exe deseni)
    ipcMain.handle('vlss5:pick-dll', async (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        const isEn = (config.getSettings().language || 'tr') === 'en';
        const result = await dialog.showOpenDialog(window, {
            title: isEn ? 'Select nvngx_dlssnr.dll' : 'nvngx_dlssnr.dll Dosyasını Seç',
            filters: [{ name: 'DLSS Neural Rendering Model', extensions: ['dll'] }],
            properties: ['openFile']
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { canceled: true };
        }
        return await vlss5Manager.setModelDll(result.filePaths[0]);
    });
}

module.exports = {
    registerIpcHandlers,
    isCompressionRunning: () => isCompressing
};
