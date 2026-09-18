import { state } from '../../state.js';
import { openModal, closeModal } from './base.js';
import { showInfoModal, showLauncherWarningModal } from './info.js';
import { renderGames, updateHomeStats } from '../games.js';
import { t } from '../../i18n/i18n.js';
import { buildCacheStatusBar } from './cacheHelpers.js';
import { openWizardModal, isDlssWizardRunning } from './dlssWizard.js';
import { selectExeWithPicker } from './exePicker.js';

const dlssGameCover = document.getElementById('dlss-game-cover');
const dlssGamePlaceholder = document.getElementById('dlss-game-placeholder');
const dlssGameName = document.getElementById('dlss-game-name');
const dlssInstallBtn = document.getElementById('dlss-install-btn');
const dlssVersionSelect = document.getElementById('dlss-version');
const dlssDllNameSelect = document.getElementById('dlss-dll-name');
const dlssAutoInstallBtn = document.getElementById('dlss-auto-install-btn');
const dlssConfirmModal = document.getElementById('dlss-confirm-modal');
const dlssConfirmYesBtn = document.getElementById('dlss-confirm-yes-btn');
const dlssConfirmNoBtn = document.getElementById('dlss-confirm-no-btn');

let currentDlssReleases = [];

export async function openDlssModal(forceRefresh = false) {
    if (!state.currentSelectedGame) return;

    // Symmetric conflict check: if OptiScaler or OptiBuilder is already installed
    if (state.currentSelectedGame.hasOptiscaler || state.currentSelectedGame.hasOptiBuilder) {
        showInfoModal(t('dlss.warningTitle'), t('dlss.conflictWarning'), true);
        return;
    }

    dlssGameName.textContent = state.currentSelectedGame.name;
    
    if (state.currentSelectedGame.cover) {
        dlssGameCover.src = state.currentSelectedGame.cover;
        dlssGameCover.style.display = 'block';
        dlssGamePlaceholder.style.display = 'none';
    } else {
        dlssGameCover.style.display = 'none';
        dlssGamePlaceholder.style.display = 'flex';
    }

    // Önceki cache status barını temizle
    if (dlssVersionSelect && dlssVersionSelect.parentNode) {
        const existingBar = dlssVersionSelect.parentNode.querySelector('.release-cache-status-bar');
        if (existingBar) existingBar.remove();
    }

    // Fetch and populate DLSS versions
    try {
        const result = await window.electronAPI.getDlssEnablerReleases(forceRefresh);
        dlssVersionSelect.innerHTML = '';

        const releases = result.releases ?? result;
        const fetchedAt = result.fetchedAt ?? null;
        const fromStaleCache = result.fromStaleCache ?? false;

        if (releases && releases.length > 0) {
            currentDlssReleases = releases;

            // Cache durum çubuğu— dlss-version select'in üstüne ekle
            const cacheBar = buildCacheStatusBar(fetchedAt, fromStaleCache, async () => {
                await openDlssModal(true);
            });
            dlssVersionSelect.parentNode.insertBefore(cacheBar, dlssVersionSelect);

            releases.forEach((r, index) => {
                const opt = document.createElement('option');
                opt.value = r.name;
                opt.textContent = `${r.name} ${r.installed ? t('opti.downloaded') : t('opti.toDownload')}`;
                if (index === 0) opt.selected = true;
                dlssVersionSelect.appendChild(opt);
            });
        } else {
            const opt = document.createElement('option');
            opt.value = "";
            opt.textContent = t('dlss.noVersions');
            dlssVersionSelect.appendChild(opt);
        }
    } catch (e) {
        dlssVersionSelect.innerHTML = `<option value="">${t('dlss.error')}</option>`;
    }

    openModal('dlss-modal');
}

export async function runUnifiedInstall(exePath, dlssVersion, dllName) {
    showInfoModal(t('dlss.installTitle'), t('dlss.installing'));
    try {
        const release = currentDlssReleases.find(r => r.name === dlssVersion);
        const downloadUrl = release ? release.downloadUrl : null;

        // Wire progress updates in case the version needs to be downloaded first
        const infoModalProgress = document.getElementById('info-modal-progress');
        if (infoModalProgress) {
            infoModalProgress.style.display = 'block';
            infoModalProgress.textContent = '%0';
        }
        
        if (window.electronAPI.removeDlssEnablerProgressListeners) {
            window.electronAPI.removeDlssEnablerProgressListeners();
        }
        
        window.electronAPI.onDlssEnablerDownloadProgress((data) => {
            if (infoModalProgress) {
                if (data.stage === 'extracting') {
                    infoModalProgress.textContent = t('opti.extractingShort');
                } else {
                    infoModalProgress.textContent = `%${data.percent}`;
                }
            }
        });

        // Install DLSS Enabler
        let dlssResult;
        if (exePath === "AUTO") {
            dlssResult = await window.electronAPI.autoInstallDlss({
                game: state.currentSelectedGame,
                version: dlssVersion,
                dllName: dllName || 'version.dll',
                downloadUrl
            });
        } else {
            dlssResult = await window.electronAPI.executeDlssInstall({
                game: state.currentSelectedGame,
                exePath: exePath,
                version: dlssVersion,
                dllName: dllName || 'version.dll',
                downloadUrl
            });
        }
        
        if (infoModalProgress) {
            infoModalProgress.style.display = 'none';
        }
        closeModal('info-modal');
        
        if (dlssResult.success) {
            let successMsg = `🎉 DLSS Enabler (${dlssVersion}) ${t('dlss.installSuccess')}`;
            if (dlssResult.savedToUserGames) {
                successMsg += `\n\n${t('dlss.installSavedPath')}`;
            }
            showInfoModal(t('dlss.successTitle'), successMsg);
            if (dlssResult.games) {
                renderGames(dlssResult.games);
                updateHomeStats();
            }
        } else {
            showInfoModal(t('dlss.errorTitle'), t('dlss.installError') + dlssResult.error, true);
        }
    } catch(e) {
        const infoModalProgress = document.getElementById('info-modal-progress');
        if (infoModalProgress) {
            infoModalProgress.style.display = 'none';
        }
        closeModal('info-modal');
        showInfoModal(t('dlss.errorTitle'), t('dlss.unexpectedError') + e.message, true);
    }
}

export function initDlssListeners() {
    if (dlssConfirmNoBtn) {
        dlssConfirmNoBtn.addEventListener('click', () => {
            closeModal('dlss-confirm-modal');
            state.pendingExePath = null;
            state.pendingVersion = null;
            state.pendingDllName = null;
        });
    }

    if (dlssConfirmYesBtn) {
        dlssConfirmYesBtn.addEventListener('click', async () => {
            closeModal('dlss-confirm-modal');
            if (!state.pendingExePath || !state.pendingVersion) return;

            await runUnifiedInstall(state.pendingExePath, state.pendingVersion, state.pendingDllName);
            
            state.pendingExePath = null;
            state.pendingVersion = null;
            state.pendingDllName = null;
        });
    }

    if (dlssInstallBtn) {
        dlssInstallBtn.addEventListener('click', async () => {
            if (isDlssWizardRunning()) {
                showInfoModal(t('update.infoTitle') || 'Bilgi', t('wizard.ongoingWarning'), true);
                return;
            }
            const version = dlssVersionSelect.value;
            if (!version) {
                showInfoModal(t('dlss.errorTitle'), t('dlss.selectVersion'), true);
                return;
            }

            try {
                showLauncherWarningModal(async () => {
                    const exePath = await window.electronAPI.selectExe();
                    if (!exePath) return; // User cancelled

                    state.pendingExePath = exePath;
                    state.pendingVersion = version;
                    state.pendingDllName = dlssDllNameSelect ? dlssDllNameSelect.value : 'version.dll';

                    closeModal('dlss-modal');
                    openModal('dlss-confirm-modal');
                });
            } catch (e) {
                closeModal('info-modal');
                showInfoModal(t('dlss.errorTitle'), `${t('dlss.genericError')}${e.message}`, true);
            }
        });
    }

    if (dlssAutoInstallBtn) {
        dlssAutoInstallBtn.addEventListener('click', async () => {
            if (isDlssWizardRunning()) {
                showInfoModal(t('update.infoTitle') || 'Bilgi', t('wizard.ongoingWarning'), true);
                return;
            }
            const version = dlssVersionSelect.value;
            if (!version) {
                showInfoModal(t('dlss.errorTitle'), t('dlss.selectVersion'), true);
                return;
            }

            if (!state.currentSelectedGame) return;

            try {
                // Check if we can resolve a concrete .exe path for this game
                const paths = await window.electronAPI.resolveGamePaths(
                    state.currentSelectedGame.name,
                    state.currentSelectedGame.exePath
                );

                const hasValidExe = paths &&
                    paths.exe_path &&
                    paths.exe_path.toLowerCase().endsWith('.exe');

                if (!hasValidExe) {
                    showInfoModal(
                        t('dlss.pathMissing'),
                        `"${state.currentSelectedGame.name}" ${t('dlss.pathMissingMsg')}`,
                        true
                    );
                    return;
                }

                state.pendingExePath = "AUTO";
                state.pendingVersion = version;
                state.pendingDllName = dlssDllNameSelect ? dlssDllNameSelect.value : 'version.dll';

                closeModal('dlss-modal');
                openModal('dlss-confirm-modal');
            } catch(e) {
                closeModal('info-modal');
                showInfoModal(t('dlss.errorTitle'), t('dlss.pathCheckError') + e.message, true);
            }
        });
    }

    const dlssWizardBtn = document.getElementById('dlss-wizard-btn');
    if (dlssWizardBtn) {
        dlssWizardBtn.addEventListener('click', async () => {
            if (isDlssWizardRunning()) {
                showInfoModal(t('update.infoTitle') || 'Bilgi', t('wizard.ongoingWarning'), true);
                return;
            }
            if (state.currentSelectedGame && state.currentSelectedGame.hasDlssEnabler) {
                showInfoModal(t('update.infoTitle') || 'Bilgi', t('wizard.alreadyInstalledWarning'), true);
                return;
            }
            const version = dlssVersionSelect.value;
            if (!version) {
                showInfoModal(t('dlss.errorTitle'), t('dlss.selectVersion'), true);
                return;
            }

            if (!state.currentSelectedGame) return;

            showWizardPreFlight(async () => {
                let exePath = null;
                try {
                    const paths = await window.electronAPI.resolveGamePaths(
                        state.currentSelectedGame.name,
                        state.currentSelectedGame.exePath
                    );
                    if (paths && paths.exe_path && paths.exe_path.toLowerCase().endsWith('.exe')) {
                        exePath = paths.exe_path;
                    }

                    if (!exePath) {
                        const selected = await selectExeWithPicker(
                            state.currentSelectedGame.name,
                            paths ? paths.game_root : null
                        );
                        if (!selected) return; // User cancelled
                        exePath = selected;
                    }

                    const dllName = dlssDllNameSelect ? dlssDllNameSelect.value : 'version.dll';
                    const release = currentDlssReleases.find(r => r.name === version);
                    const downloadUrl = release ? release.downloadUrl : null;
                    closeModal('dlss-modal');
                    openWizardModal(state.currentSelectedGame, version, dllName, exePath, downloadUrl);
                } catch (err) {
                    showInfoModal(t('dlss.errorTitle'), t('dlss.pathCheckError') + err.message, true);
                }
            });
        });
    }
}

function showWizardPreFlight(onStart) {
    const infoModal = document.getElementById('info-modal');
    const infoTitle = document.getElementById('info-modal-title');
    const infoBody = document.getElementById('info-modal-message');
    const infoClose = document.getElementById('info-modal-ok-btn');
    const infoProgress = document.getElementById('info-modal-progress');

    if (!infoModal || !infoTitle || !infoBody) {
        onStart();
        return;
    }

    if (infoProgress) infoProgress.style.display = 'none';

    infoTitle.textContent = t('wizard.preFlightTitle');
    infoTitle.style.color = '#6366f1';
    infoBody.innerHTML = t('wizard.preFlightBody');

    // Clean up existing extra buttons
    const existingExtra = infoModal.querySelector('.unsaved-extra-btn');
    if (existingExtra) existingExtra.remove();

    // Cancel Button
    if (infoClose) {
        infoClose.textContent = t('wizard.preFlightCancelBtn');
        infoClose.style.backgroundColor = '#ef4444';
        infoClose.style.color = '#ffffff';
        infoClose.onclick = () => {
            closeModal('info-modal');
        };
    }

    // Start Button
    const startBtn = document.createElement('button');
    startBtn.className = 'unsaved-extra-btn';
    startBtn.textContent = t('wizard.preFlightStartBtn');
    startBtn.style.cssText = 'background:#6366f1;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-size:14px;margin-left:10px;font-weight:bold;color:#ffffff;';
    
    startBtn.onclick = () => {
        closeModal('info-modal');
        onStart();
    };

    const btnRow = infoClose?.parentElement;
    if (btnRow) btnRow.appendChild(startBtn);

    openModal('info-modal');
}

