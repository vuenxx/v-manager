import { state } from '../../state.js';
import { openModal, closeModal } from './base.js';
import { showInfoModal } from './info.js';
import { renderGames, updateHomeStats } from '../games.js';
import { t } from '../../i18n/i18n.js';

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

export async function openDlssModal() {
    if (!state.currentSelectedGame) return;

    // Symmetric conflict check: if OptiScaler is already installed
    if (state.currentSelectedGame.hasOptiscaler) {
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

    // Fetch and populate DLSS versions
    try {
        const versions = await window.electronAPI.getDlssVersions();
        dlssVersionSelect.innerHTML = '';
        if (versions && versions.length > 0) {
            versions.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = v;
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
        // Install DLSS Enabler
        let dlssResult;
        if (exePath === "AUTO") {
            dlssResult = await window.electronAPI.autoInstallDlss({
                game: state.currentSelectedGame,
                version: dlssVersion,
                dllName: dllName || 'version.dll'
            });
        } else {
            dlssResult = await window.electronAPI.executeDlssInstall({
                game: state.currentSelectedGame,
                exePath: exePath,
                version: dlssVersion,
                dllName: dllName || 'version.dll'
            });
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
            const version = dlssVersionSelect.value;
            if (!version) {
                showInfoModal(t('dlss.errorTitle'), t('dlss.selectVersion'), true);
                return;
            }

            try {
                const exePath = await window.electronAPI.selectExe();
                if (!exePath) return; // User cancelled

                state.pendingExePath = exePath;
                state.pendingVersion = version;
                state.pendingDllName = dlssDllNameSelect ? dlssDllNameSelect.value : 'version.dll';

                closeModal('dlss-modal');
                openModal('dlss-confirm-modal');
            } catch (e) {
                closeModal('info-modal');
                showInfoModal(t('dlss.errorTitle'), `${t('dlss.genericError')}${e.message}`, true);
            }
        });
    }

    if (dlssAutoInstallBtn) {
        dlssAutoInstallBtn.addEventListener('click', async () => {
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
}
