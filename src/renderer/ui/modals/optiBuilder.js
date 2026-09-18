import { state } from '../../state.js';
import { openModal, closeModal } from './base.js';
import { showInfoModal, showLauncherWarningModal } from './info.js';
import { openOptiBuilderWizardModal, isOptiBuilderWizardRunning } from './optiBuilderWizard.js';
import { isDlssWizardRunning } from './dlssWizard.js';
import { isOptiWizardRunning } from './optiWizard.js';
import { selectExeWithPicker } from './exePicker.js';
import { renderGames, updateHomeStats } from '../games.js';
import { t } from '../../i18n/i18n.js';
import { buildCacheStatusBar } from './cacheHelpers.js';

const obGameCover = document.getElementById('ob-game-cover');
const obGamePlaceholder = document.getElementById('ob-game-placeholder');
const obGameName = document.getElementById('ob-game-name');
const obInstallBtn = document.getElementById('ob-install-btn');
const obAutoInstallBtn = document.getElementById('ob-auto-install-btn');
const obWizardBtn = document.getElementById('ob-wizard-btn');
const obVersionSelect = document.getElementById('ob-version');
const obVersionsLoading = document.getElementById('ob-versions-loading');
const obInjectionSelect = document.getElementById('ob-injection');

export async function openOptiBuilderModal(forceRefreshOpti = false) {
    if (!state.currentSelectedGame) return;

    // Zaten OptiBuilder kuruluysa engelle
    if (state.currentSelectedGame.hasOptiBuilder) {
        showInfoModal(t('optiBuilder.warningTitle'), t('optiBuilder.alreadyInstalled'), true);
        return;
    }

    // DLSS Enabler kuruluysa engelle
    if (state.currentSelectedGame.hasDlssEnabler) {
        showInfoModal(t('optiBuilder.warningTitle'), t('optiBuilder.conflictWarning'), true);
        return;
    }

    // OptiScaler kuruluysa engelle
    if (state.currentSelectedGame.hasOptiscaler) {
        showInfoModal(t('optiBuilder.warningTitle'), t('optiBuilder.conflictWarningOptiScaler'), true);
        return;
    }

    obGameName.textContent = state.currentSelectedGame.name;
    
    if (state.currentSelectedGame.cover) {
        obGameCover.src = state.currentSelectedGame.cover;
        obGameCover.style.display = 'block';
        obGamePlaceholder.style.display = 'none';
    } else {
        obGameCover.style.display = 'none';
        obGamePlaceholder.style.display = 'flex';
    }

    // Önceki cache status barını temizle
    if (obVersionSelect && obVersionSelect.parentNode) {
        const oldBar = obVersionSelect.parentNode.querySelector('.release-cache-status-bar');
        if (oldBar) oldBar.remove();
    }

    // Reset version dropdown
    obVersionSelect.style.display = 'none';
    obVersionSelect.innerHTML = '';
    obVersionsLoading.style.display = 'block';
    obVersionsLoading.textContent = t('optiBuilder.loadingVersions');
    obVersionsLoading.style.color = 'var(--text-secondary)';

    openModal('optibuilder-modal');

    try {
        const result = await window.electronAPI.getOptiBuilderReleases(forceRefreshOpti);

        if (result.error) throw new Error(result.error);
        const optiReleases = result.releases ?? result;

        state.currentOptiBuilderReleases = optiReleases;

        const optiCacheBar = buildCacheStatusBar(
            result.fetchedAt ?? null,
            result.fromStaleCache ?? false,
            async () => {
                await openOptiBuilderModal(true);
            }
        );
        obVersionSelect.parentNode.insertBefore(optiCacheBar, obVersionSelect);

        optiReleases.forEach((r, index) => {
            const opt = document.createElement('option');
            opt.value = r.tag;
            opt.textContent = `${r.name} ${r.installed ? t('optiBuilder.downloaded') : t('optiBuilder.toDownload')}`;
            if (index === 0) opt.selected = true;
            obVersionSelect.appendChild(opt);
        });

        obVersionsLoading.style.display = 'none';
        obVersionSelect.style.display = 'block';

    } catch(e) {
        obVersionsLoading.style.display = 'block';
        obVersionsLoading.textContent = t('optiBuilder.loadError') + e.message;
        obVersionsLoading.style.color = '#ef4444';
    }
}

async function runOptiBuilderInstall(isAuto) {
    if (isOptiBuilderWizardRunning() || isOptiWizardRunning() || isDlssWizardRunning()) {
        showInfoModal(t('update.infoTitle') || 'Bilgi', t('wizard.ongoingWarning'), true);
        return;
    }

    const selectedTag = obVersionSelect.value;
    const injection = obInjectionSelect.value;
    
    if (!selectedTag) {
        showInfoModal(t('optiBuilder.errorTitle'), t('optiBuilder.selectVersion'), true);
        return;
    }
    
    const release = state.currentOptiBuilderReleases.find(r => r.tag === selectedTag);
    if (!release) {
        showInfoModal(t('optiBuilder.errorTitle'), t('optiBuilder.releaseNotFound'), true);
        return;
    }

    let targetGame = state.currentSelectedGame;
    if (!isAuto) {
        const selectedExe = await new Promise((resolve) => {
            showLauncherWarningModal(async () => {
                const selected = await window.electronAPI.selectExe();
                resolve(selected);
            });
        });
        if (!selectedExe) return; // Canceled
        targetGame = { ...state.currentSelectedGame, exePath: selectedExe };
    }

    closeModal('optibuilder-modal');

    const infoModalProgress = document.getElementById('info-modal-progress');
    showInfoModal(t('optiBuilder.installingTitle'), `OptiBuilder ${release.tag} ${t('optiBuilder.installingMsg')}`);
    if (infoModalProgress) {
        infoModalProgress.style.display = 'block';
        infoModalProgress.style.color = '';
        infoModalProgress.textContent = '%0';
    }

    // Clean up previous listeners
    if (window.electronAPI.removeOptiBuilderProgressListeners) {
        window.electronAPI.removeOptiBuilderProgressListeners();
    }

    // Wire progress updates
    window.electronAPI.onOptiBuilderDownloadProgress((data) => {
        if (infoModalProgress) {
            if (data.stage === 'extracting') {
                infoModalProgress.textContent = `OptiBuilder ${t('optiBuilder.extracting')}`;
            } else {
                infoModalProgress.textContent = `OptiBuilder: %${data.percent}`;
            }
        }
    });

    try {
        const result = await window.electronAPI.installOptiBuilder({
            game: targetGame,
            version: release.name,
            tag: release.tag,
            downloadUrl: release.downloadUrl,
            injection,
            isAuto
        });

        if (infoModalProgress) infoModalProgress.style.display = 'none';
        closeModal('info-modal');

        if (result.success) {
            let successMsg = `🎉 OptiBuilder ${release.tag} ${t('optiBuilder.installSuccess')}\n\nEnjeksiyon: ${injection}`;
            if (result.savedToUserGames) {
                successMsg += `\n\n${t('optiBuilder.savedPath')}`;
            }
            showInfoModal(t('optiBuilder.successTitle'), successMsg);
            if (result.games) {
                const updatedGame = result.games.find(g => g.name === state.currentSelectedGame.name);
                if (updatedGame) {
                    state.currentSelectedGame = updatedGame;
                }
                renderGames(result.games);
                updateHomeStats();
            }
        } else {
            showInfoModal(t('optiBuilder.errorTitle'), result.error, true);
        }
    } catch(e) {
        if (infoModalProgress) {
            infoModalProgress.style.color = '#ef4444';
            infoModalProgress.textContent = t('optiBuilder.installFailed');
        }
        await new Promise(r => setTimeout(r, 1500));
        if (infoModalProgress) infoModalProgress.style.display = 'none';
        closeModal('info-modal');
        showInfoModal(t('optiBuilder.errorTitle'), t('optiBuilder.unexpectedError') + e.message, true);
    }
}

function showOptiBuilderWizardPreFlight(onStart) {
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
    infoTitle.style.color = 'var(--accent-color)';
    infoBody.innerHTML = t('wizard.preFlightBody');

    const existingExtra = infoModal.querySelector('.unsaved-extra-btn');
    if (existingExtra) existingExtra.remove();

    if (infoClose) {
        infoClose.textContent = t('wizard.preFlightCancelBtn');
        infoClose.style.backgroundColor = '#ef4444';
        infoClose.style.color = '#ffffff';
        infoClose.onclick = () => {
            closeModal('info-modal');
        };
    }

    const startBtn = document.createElement('button');
    startBtn.className = 'unsaved-extra-btn';
    startBtn.textContent = t('wizard.preFlightStartBtn');
    startBtn.style.cssText = 'background:var(--accent-color);border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-size:14px;margin-left:10px;font-weight:bold;color:#000000;';
    
    startBtn.onclick = () => {
        closeModal('info-modal');
        onStart();
    };

    const btnRow = infoClose?.parentElement;
    if (btnRow) btnRow.appendChild(startBtn);

    openModal('info-modal');
}

export function initOptiBuilderListeners() {
    if (obInstallBtn) {
        obInstallBtn.addEventListener('click', () => runOptiBuilderInstall(false));
    }
    if (obAutoInstallBtn) {
        obAutoInstallBtn.addEventListener('click', () => runOptiBuilderInstall(true));
    }

    if (obWizardBtn) {
        obWizardBtn.addEventListener('click', async () => {
            if (isOptiBuilderWizardRunning() || isOptiWizardRunning() || isDlssWizardRunning()) {
                showInfoModal(t('update.infoTitle') || 'Bilgi', t('wizard.ongoingWarning'), true);
                return;
            }

            if (state.currentSelectedGame.hasOptiBuilder) {
                showInfoModal(t('optiBuilder.warningTitle') || 'Uyarı! ⚠️', t('optiBuilder.alreadyInstalled'), true);
                return;
            }

            if (state.currentSelectedGame.hasDlssEnabler) {
                showInfoModal(t('optiBuilder.warningTitle') || 'Uyarı! ⚠️', t('optiBuilder.conflictWarning'), true);
                return;
            }

            if (state.currentSelectedGame.hasOptiscaler) {
                showInfoModal(t('optiBuilder.warningTitle') || 'Uyarı! ⚠️', t('optiBuilder.conflictWarningOptiScaler'), true);
                return;
            }

            const selectedTag = obVersionSelect ? obVersionSelect.value : null;
            const injection = obInjectionSelect ? obInjectionSelect.value : null;

            if (!selectedTag) {
                showInfoModal(t('optiBuilder.errorTitle'), t('optiBuilder.selectVersion'), true);
                return;
            }

            const release = state.currentOptiBuilderReleases.find(r => r.tag === selectedTag);
            if (!release) {
                showInfoModal(t('optiBuilder.errorTitle'), t('optiBuilder.releaseNotFound'), true);
                return;
            }

            showOptiBuilderWizardPreFlight(async () => {
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

                    closeModal('optibuilder-modal');
                    openOptiBuilderWizardModal({
                        game: state.currentSelectedGame,
                        version: release.name,
                        tag: release.tag,
                        downloadUrl: release.downloadUrl,
                        injection,
                        isAuto: true,
                        exePath: exePath,
                        bypassDx12Check: false
                    });
                } catch (err) {
                    showInfoModal(t('optiBuilder.errorTitle'), t('optiBuilder.pathCheckError') + err.message, true);
                }
            });
        });
    }
}
