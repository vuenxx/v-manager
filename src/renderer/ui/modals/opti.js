import { state } from '../../state.js';
import { openModal, closeModal } from './base.js';
import { showInfoModal } from './info.js';
import { renderGames, updateHomeStats } from '../games.js';
import { t } from '../../i18n/i18n.js';

const optiGameCover = document.getElementById('opti-game-cover');
const optiGamePlaceholder = document.getElementById('opti-game-placeholder');
const optiGameName = document.getElementById('opti-game-name');
const optiInstallBtn = document.getElementById('opti-install-btn');
const optiAutoInstallBtn = document.getElementById('opti-auto-install-btn');
const optiVersionSelect = document.getElementById('opti-version');
const optiVersionsLoading = document.getElementById('opti-versions-loading');
const optiInjectionSelect = document.getElementById('opti-injection');

// FSR4 elements
const optiFsr4Checkbox = document.getElementById('opti-install-fsr4');
const optiFsr4VersionSelect = document.getElementById('opti-fsr4-version');
const optiFsr4VersionsLoading = document.getElementById('opti-fsr4-versions-loading');

// OptiPatcher elements
const optiPatcherCheckbox = document.getElementById('opti-install-patcher');
const optiPatcherVersionSelect = document.getElementById('opti-patcher-version');
const optiPatcherVersionsLoading = document.getElementById('opti-patcher-versions-loading');

// Standalone Releases Downloader Elements
const optiscalerVersionsBtn = document.getElementById('optiscaler-versions-btn');
const optiscalerVersionsModal = document.getElementById('optiscaler-versions-modal');
const optiscalerVersionsLoading = document.getElementById('optiscaler-versions-loading');
const optiscalerVersionsContainer = document.getElementById('optiscaler-versions-container');
const optiscalerVersionSelect = document.getElementById('optiscaler-version-select');
const optiscalerDownloadBtn = document.getElementById('optiscaler-download-btn');

// Track loaded releases for FSR4 / OptiPatcher
let currentFsr4Releases = [];
let currentOptiPatcherReleases = [];

export async function openOptiModal() {
    if (!state.currentSelectedGame) return;

    // Already installed check
    if (state.currentSelectedGame.hasOptiscaler) {
        showInfoModal(t('opti.warningTitle'), t('opti.alreadyInstalled'), true);
        return;
    }

    // Conflict check
    if (state.currentSelectedGame.hasDlssEnabler) {
        showInfoModal(t('opti.warningTitle'), t('opti.conflictWarning'), true);
        return;
    }

    optiGameName.textContent = state.currentSelectedGame.name;
    
    if (state.currentSelectedGame.cover) {
        optiGameCover.src = state.currentSelectedGame.cover;
        optiGameCover.style.display = 'block';
        optiGamePlaceholder.style.display = 'none';
    } else {
        optiGameCover.style.display = 'none';
        optiGamePlaceholder.style.display = 'flex';
    }

    // Reset version dropdown
    optiVersionSelect.style.display = 'none';
    optiVersionSelect.innerHTML = '';
    optiVersionsLoading.style.display = 'block';
    optiVersionsLoading.textContent = t('opti.loadingVersions');
    optiVersionsLoading.style.color = 'var(--text-secondary)';

    // Reset FSR4 + OptiPatcher UI
    if (optiFsr4Checkbox) optiFsr4Checkbox.checked = false;
    if (optiFsr4VersionSelect) { 
        optiFsr4VersionSelect.style.opacity = '0.5';
        optiFsr4VersionSelect.style.pointerEvents = 'none';
        optiFsr4VersionSelect.innerHTML = ''; 
    }
    if (optiFsr4VersionsLoading) optiFsr4VersionsLoading.style.display = 'none';

    if (optiPatcherCheckbox) optiPatcherCheckbox.checked = false;
    if (optiPatcherVersionSelect) { 
        optiPatcherVersionSelect.style.opacity = '0.5';
        optiPatcherVersionSelect.style.pointerEvents = 'none';
        optiPatcherVersionSelect.innerHTML = ''; 
    }
    if (optiPatcherVersionsLoading) optiPatcherVersionsLoading.style.display = 'none';

    currentFsr4Releases = [];
    currentOptiPatcherReleases = [];

    openModal('optiscaler-modal');

    // Load all releases in parallel
    try {
        const [optiReleases, fsr4Releases, patcherReleases] = await Promise.all([
            window.electronAPI.getOptiScalerReleases(),
            window.electronAPI.getFsr4Releases(),
            window.electronAPI.getOptiPatcherReleases()
        ]);

        // --- OptiScaler versions ---
        if (optiReleases.error) throw new Error(optiReleases.error);
        state.currentOptiReleases = optiReleases;

        optiReleases.forEach((r, index) => {
            const opt = document.createElement('option');
            opt.value = r.tag;
            opt.textContent = `${r.name} ${r.installed ? t('opti.downloaded') : t('opti.toDownload')}`;
            if (index === 0) opt.selected = true;
            optiVersionSelect.appendChild(opt);
        });

        optiVersionsLoading.style.display = 'none';
        optiVersionSelect.style.display = 'block';

        // --- FSR4 versions ---
        if (!fsr4Releases.error && fsr4Releases.length > 0) {
            currentFsr4Releases = fsr4Releases;
            fsr4Releases.forEach((r, index) => {
                const opt = document.createElement('option');
                opt.value = index;
                opt.textContent = `${r.name} ${r.installed ? t('opti.downloaded') : t('opti.toDownload')}`;
                optiFsr4VersionSelect.appendChild(opt);
            });
        }

        // --- OptiPatcher versions ---
        if (!patcherReleases.error && patcherReleases.length > 0) {
            currentOptiPatcherReleases = patcherReleases;
            patcherReleases.forEach((r, index) => {
                const opt = document.createElement('option');
                opt.value = index;
                opt.textContent = `${r.name} (${r.tag}) ${r.installed ? t('opti.downloaded') : t('opti.toDownload')}`;
                optiPatcherVersionSelect.appendChild(opt);
            });
        }

    } catch(e) {
        optiVersionsLoading.style.display = 'block';
        optiVersionsLoading.textContent = t('opti.loadError') + e.message;
        optiVersionsLoading.style.color = '#ef4444';
    }
}

async function runOptiInstall(isAuto) {
    const selectedTag = optiVersionSelect.value;
    const injection = optiInjectionSelect.value;
    
    if (!selectedTag) {
        showInfoModal(t('opti.errorTitle'), t('opti.selectVersion'), true);
        return;
    }
    
    const release = state.currentOptiReleases.find(r => r.tag === selectedTag);
    if (!release) {
        showInfoModal(t('opti.errorTitle'), t('opti.releaseNotFound'), true);
        return;
    }

    // Collect optional selections
    const installFsr4 = optiFsr4Checkbox && optiFsr4Checkbox.checked;
    const installPatcher = optiPatcherCheckbox && optiPatcherCheckbox.checked;

    let fsr4Release = null;
    if (installFsr4) {
        const idx = optiFsr4VersionSelect ? parseInt(optiFsr4VersionSelect.value) : -1;
        fsr4Release = (idx >= 0 && currentFsr4Releases[idx]) ? currentFsr4Releases[idx] : null;
        if (!fsr4Release) {
            showInfoModal(t('opti.errorTitle'), t('opti.fsr4NoData'), true);
            return;
        }
    }

    let patcherRelease = null;
    if (installPatcher) {
        const idx = optiPatcherVersionSelect ? parseInt(optiPatcherVersionSelect.value) : -1;
        patcherRelease = (idx >= 0 && currentOptiPatcherReleases[idx]) ? currentOptiPatcherReleases[idx] : null;
        if (!patcherRelease) {
            showInfoModal(t('opti.errorTitle'), t('opti.patcherNoData'), true);
            return;
        }
    }

    let targetGame = state.currentSelectedGame;
    if (!isAuto) {
        const selectedExe = await window.electronAPI.selectExe();
        if (!selectedExe) return; // Canceled
        targetGame = { ...state.currentSelectedGame, exePath: selectedExe };
    }

    closeModal('optiscaler-modal');

    const infoModalProgress = document.getElementById('info-modal-progress');
    showInfoModal(t('opti.installingTitle'), `OptiScaler ${release.tag} ${t('opti.installingMsg')}`);
    if (infoModalProgress) {
        infoModalProgress.style.display = 'block';
        infoModalProgress.style.color = '';
        infoModalProgress.textContent = '%0';
    }

    // Clean up previous listeners
    if (window.electronAPI.removeOptiScalerProgressListeners) {
        window.electronAPI.removeOptiScalerProgressListeners();
    }
    if (window.electronAPI.removeOptiPatcherProgressListeners) {
        window.electronAPI.removeOptiPatcherProgressListeners();
    }
    if (window.electronAPI.removeFsr4ProgressListeners) {
        window.electronAPI.removeFsr4ProgressListeners();
    }

    // Wire progress updates
    window.electronAPI.onOptiscalerDownloadProgress((data) => {
        if (infoModalProgress) {
            if (data.stage === 'extracting') {
                infoModalProgress.textContent = `OptiScaler ${t('opti.extracting')}`;
            } else {
                infoModalProgress.textContent = `OptiScaler: %${data.percent}`;
            }
        }
    });

    window.electronAPI.onOptipatcherDownloadProgress((data) => {
        if (infoModalProgress) {
            infoModalProgress.textContent = `OptiPatcher: %${data.percent}`;
        }
    });

    window.electronAPI.onFsr4DownloadProgress((data) => {
        if (infoModalProgress) {
            if (data.stage === 'extracting') {
                infoModalProgress.textContent = `FSR4 ${t('opti.extracting')}`;
            } else {
                infoModalProgress.textContent = `FSR4: %${data.percent}`;
            }
        }
    });

    try {
        const result = await window.electronAPI.installOptiscaler({
            game: targetGame,
            version: release.name,
            tag: release.tag,
            downloadUrl: release.downloadUrl,
            injection,
            isAuto,
            // Optional extras
            installOptiPatcher: installPatcher,
            optiPatcherTag: patcherRelease ? patcherRelease.tag : null,
            optiPatcherUrl: patcherRelease ? patcherRelease.downloadUrl : null,
            installFsr4: installFsr4,
            fsr4Name: fsr4Release ? fsr4Release.name : null,
            fsr4Url: fsr4Release ? fsr4Release.downloadUrl : null
        });

        if (infoModalProgress) infoModalProgress.style.display = 'none';
        closeModal('info-modal');

        if (result.success) {
            let successMsg = `🎉 OptiScaler ${release.tag} ${t('opti.installSuccess')}\n\nEnjeksiyon: ${injection}`;
            if (result.optiPatcherInstalled) {
                successMsg += `\n${t('opti.patcherInstalled')}`;
            }
            if (result.fsr4Installed) {
                successMsg += `\n${t('opti.fsr4Installed')}`;
            }
            if (result.savedToUserGames) {
                successMsg += `\n\n${t('opti.savedPath')}`;
            }
            showInfoModal(t('opti.successTitle'), successMsg);
            if (result.games) {
                renderGames(result.games);
                updateHomeStats();
            }
        } else {
            showInfoModal(t('opti.errorTitle'), result.error, true);
        }
    } catch(e) {
        // Show red error in progress indicator, then switch to error modal
        if (infoModalProgress) {
            infoModalProgress.style.color = '#ef4444';
            infoModalProgress.textContent = t('opti.installFailed');
        }
        await new Promise(r => setTimeout(r, 1500));
        if (infoModalProgress) infoModalProgress.style.display = 'none';
        closeModal('info-modal');
        showInfoModal(t('opti.errorTitle'), t('opti.unexpectedError') + e.message, true);
    }
}

export function initOptiListeners() {
    if (optiInstallBtn) {
        optiInstallBtn.addEventListener('click', () => runOptiInstall(false));
    }
    if (optiAutoInstallBtn) {
        optiAutoInstallBtn.addEventListener('click', () => runOptiInstall(true));
    }

    // FSR4 checkbox → enable/disable version dropdown
    if (optiFsr4Checkbox) {
        optiFsr4Checkbox.addEventListener('change', () => {
            if (optiFsr4VersionSelect) {
                const isChecked = optiFsr4Checkbox.checked;
                optiFsr4VersionSelect.style.opacity = isChecked ? '1' : '0.5';
                optiFsr4VersionSelect.style.pointerEvents = isChecked ? 'auto' : 'none';
            }
        });
    }

    // OptiPatcher checkbox → enable/disable version dropdown
    if (optiPatcherCheckbox) {
        optiPatcherCheckbox.addEventListener('change', () => {
            if (optiPatcherVersionSelect) {
                const isChecked = optiPatcherCheckbox.checked;
                optiPatcherVersionSelect.style.opacity = isChecked ? '1' : '0.5';
                optiPatcherVersionSelect.style.pointerEvents = isChecked ? 'auto' : 'none';
            }
        });
    }

    // Standalone Releases Downloader logic
    if (optiscalerVersionsBtn) {
        optiscalerVersionsBtn.addEventListener('click', async () => {
            if (state.isDownloadingOptiScaler) {
                showInfoModal(t('opti.busyTitle'), t('opti.standaloneBusy'), true);
                return;
            }
            openModal('optiscaler-versions-modal');
            optiscalerVersionsLoading.style.display = 'block';
            optiscalerVersionsLoading.textContent = t('opti.standaloneLoading');
            optiscalerVersionsLoading.style.color = 'var(--text-secondary)';
            optiscalerVersionsContainer.style.display = 'none';
            optiscalerVersionSelect.innerHTML = '';
            
            try {
                const releases = await window.electronAPI.getOptiScalerReleases();
                if (releases.error) throw new Error(releases.error);
                
                state.currentOptiReleases = releases;
                
                releases.forEach((r, index) => {
                    const opt = document.createElement('option');
                    opt.value = index;
                    if (r.installed) {
                        opt.textContent = `${r.name} (${r.tag}) - [${t('opti.installed').replace(/[\[\]]/g,'')}]`;
                        opt.style.color = '#22c55e';
                    } else {
                        opt.textContent = `${r.name} (${r.tag})`;
                    }
                    optiscalerVersionSelect.appendChild(opt);
                });

                if (releases.length > 0) {
                    if (releases[0].installed) {
                        optiscalerDownloadBtn.textContent = t('opti.alreadyDownloaded');
                        optiscalerDownloadBtn.style.backgroundColor = '#16a34a';
                    } else {
                        optiscalerDownloadBtn.textContent = t('opti.downloadBtn');
                        optiscalerDownloadBtn.style.backgroundColor = '';
                    }
                }

                optiscalerVersionSelect.addEventListener('change', () => {
                    const selectedIdx = optiscalerVersionSelect.value;
                    if (selectedIdx !== '' && selectedIdx != null) {
                        const release = state.currentOptiReleases[selectedIdx];
                        if (release) {
                            if (release.installed) {
                                optiscalerDownloadBtn.textContent = t('opti.alreadyDownloaded');
                                optiscalerDownloadBtn.style.backgroundColor = '#16a34a';
                            } else {
                                optiscalerDownloadBtn.textContent = t('opti.downloadBtn');
                                optiscalerDownloadBtn.style.backgroundColor = '';
                            }
                        }
                    }
                });
                
                optiscalerVersionsLoading.style.display = 'none';
                optiscalerVersionsContainer.style.display = 'block';
            } catch(e) {
                optiscalerVersionsLoading.textContent = t('opti.standaloneLoadError') + e.message;
                optiscalerVersionsLoading.style.color = '#ef4444';
            }
        });
    }

    if (optiscalerDownloadBtn) {
        optiscalerDownloadBtn.addEventListener('click', async () => {
            if (state.isDownloadingOptiScaler) return;
            const selectedIdx = optiscalerVersionSelect.value;
            if (selectedIdx === '' || selectedIdx == null) return;
            
            const release = state.currentOptiReleases[selectedIdx];
            if (!release) return;
            
            state.isDownloadingOptiScaler = true;
            closeModal('optiscaler-versions-modal');
            
            const infoModalProgress = document.getElementById('info-modal-progress');
            showInfoModal(t('opti.downloadingTitle'), `OptiScaler ${release.tag} ${t('opti.downloadingMsg')}`);
            if (infoModalProgress) {
                infoModalProgress.style.display = 'block';
                infoModalProgress.style.color = '';
                infoModalProgress.textContent = '%0';
            }
            
            if (window.electronAPI.removeOptiScalerProgressListeners) {
                window.electronAPI.removeOptiScalerProgressListeners();
            }
            window.electronAPI.onOptiscalerDownloadProgress((data) => {
                if (infoModalProgress) {
                    if (data.stage === 'extracting') {
                        infoModalProgress.textContent = t('opti.extractingShort');
                    } else {
                        infoModalProgress.textContent = `%${data.percent}`;
                    }
                }
            });
            
            try {
                const result = await window.electronAPI.downloadOptiScalerRelease({
                    tag: release.tag,
                    downloadUrl: release.downloadUrl
                });
                
                if (infoModalProgress) infoModalProgress.style.display = 'none';
                closeModal('info-modal');
                if (result.success) {
                    if (result.alreadyExists) {
                        showInfoModal(t('opti.successTitle'), `✅ OptiScaler ${release.tag} ${t('opti.alreadyExists')}`);
                    } else {
                        showInfoModal(t('opti.successTitle'), `✅ OptiScaler ${release.tag} ${t('opti.downloadSuccess')}`);
                    }
                } else {
                    showInfoModal(t('opti.errorTitle'), t('opti.downloadError') + result.error, true);
                }
            } catch(e) {
                if (infoModalProgress) {
                    infoModalProgress.style.color = '#ef4444';
                    infoModalProgress.textContent = t('opti.downloadFailed');
                }
                await new Promise(r => setTimeout(r, 1500));
                if (infoModalProgress) infoModalProgress.style.display = 'none';
                closeModal('info-modal');
                showInfoModal(t('opti.errorTitle'), t('opti.unexpectedDownloadError') + e.message, true);
            } finally {
                state.isDownloadingOptiScaler = false;
            }
        });
    }
}
