import { state } from '../../state.js';
import { openModal, closeModal } from './base.js';
import { showInfoModal, showLauncherWarningModal, showConfirmDialog } from './info.js';
import { openOptiWizardModal, isOptiWizardRunning } from './optiWizard.js';
import { isDlssWizardRunning } from './dlssWizard.js';
import { selectExeWithPicker } from './exePicker.js';
import { renderGames, updateHomeStats } from '../games.js';
import { t } from '../../i18n/i18n.js';
import { buildCacheStatusBar } from './cacheHelpers.js';

const optiGameCover = document.getElementById('opti-game-cover');
const optiGamePlaceholder = document.getElementById('opti-game-placeholder');
const optiGameName = document.getElementById('opti-game-name');
const optiInstallBtn = document.getElementById('opti-install-btn');
const optiAutoInstallBtn = document.getElementById('opti-auto-install-btn');
const optiWizardBtn = document.getElementById('opti-wizard-btn');
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

export async function openOptiModal(forceRefreshOpti = false, forceRefreshFsr4 = false, forceRefreshPatcher = false) {
    if (!state.currentSelectedGame) return;

    // Already installed check
    if (state.currentSelectedGame.hasOptiscaler || state.currentSelectedGame.hasOptiBuilder) {
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

    // Önceki cache status barlarını temizle
    if (optiVersionSelect && optiVersionSelect.parentNode) {
        const oldBar = optiVersionSelect.parentNode.querySelector('.release-cache-status-bar');
        if (oldBar) oldBar.remove();
    }
    if (optiFsr4VersionSelect && optiFsr4VersionSelect.parentNode) {
        const oldBar = optiFsr4VersionSelect.parentNode.querySelector('.release-cache-status-bar');
        if (oldBar) oldBar.remove();
    }
    if (optiPatcherVersionSelect && optiPatcherVersionSelect.parentNode) {
        const oldBar = optiPatcherVersionSelect.parentNode.querySelector('.release-cache-status-bar');
        if (oldBar) oldBar.remove();
    }

    // Reset version dropdown
    optiVersionSelect.style.display = 'none';
    optiVersionSelect.innerHTML = '';
    optiVersionsLoading.style.display = 'block';
    optiVersionsLoading.textContent = t('opti.loadingVersions');
    optiVersionsLoading.style.color = 'var(--text-secondary)';

    // Reset FSR4 + OptiPatcher UI (sadece ilk açılışta sıfırla, iç yenilemelerde durum bozulmasın)
    if (!forceRefreshOpti && !forceRefreshFsr4 && !forceRefreshPatcher) {
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
    }

    openModal('optiscaler-modal');

    // Load all releases in parallel
    try {
        const [optiResult, fsr4Result, patcherResult] = await Promise.all([
            window.electronAPI.getOptiScalerReleases(forceRefreshOpti),
            window.electronAPI.getFsr4Releases(forceRefreshFsr4),
            window.electronAPI.getOptiPatcherReleases(forceRefreshPatcher)
        ]);

        // --- OptiScaler versions ---
        if (optiResult.error) throw new Error(optiResult.error);
        const optiReleases   = optiResult.releases  ?? optiResult;
        const fsr4Releases   = fsr4Result.error  ? [] : (fsr4Result.releases   ?? fsr4Result);
        const patcherReleases = patcherResult.error ? [] : (patcherResult.releases ?? patcherResult);

        state.currentOptiReleases = optiReleases;

        // OptiScaler cache bar
        const optiCacheBar = buildCacheStatusBar(
            optiResult.fetchedAt ?? null,
            optiResult.fromStaleCache ?? false,
            async () => {
                await openOptiModal(true, false, false);
            }
        );
        optiVersionSelect.parentNode.insertBefore(optiCacheBar, optiVersionSelect);

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
        if (fsr4Releases.length > 0) {
            currentFsr4Releases = fsr4Releases;
            // FSR4 cache bar
            if (optiFsr4VersionSelect) {
                const fsr4CacheBar = buildCacheStatusBar(
                    fsr4Result.fetchedAt ?? null,
                    fsr4Result.fromStaleCache ?? false,
                    async () => {
                        await openOptiModal(false, true, false);
                    }
                );
                optiFsr4VersionSelect.parentNode.insertBefore(fsr4CacheBar, optiFsr4VersionSelect);
            }
            fsr4Releases.forEach((r, index) => {
                const opt = document.createElement('option');
                opt.value = index;
                opt.textContent = `${r.name} ${r.installed ? t('opti.downloaded') : t('opti.toDownload')}`;
                optiFsr4VersionSelect.appendChild(opt);
            });
        }

        // --- OptiPatcher versions ---
        if (patcherReleases.length > 0) {
            currentOptiPatcherReleases = patcherReleases;
            // Patcher cache bar
            if (optiPatcherVersionSelect) {
                const patcherCacheBar = buildCacheStatusBar(
                    patcherResult.fetchedAt ?? null,
                    patcherResult.fromStaleCache ?? false,
                    async () => {
                        await openOptiModal(false, false, true);
                    }
                );
                optiPatcherVersionSelect.parentNode.insertBefore(patcherCacheBar, optiPatcherVersionSelect);
            }
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
    if (isOptiWizardRunning() || isDlssWizardRunning()) {
        showInfoModal(t('update.infoTitle') || 'Bilgi', t('wizard.ongoingWarning'), true);
        return;
    }

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
        const selectedExe = await new Promise((resolve) => {
            showLauncherWarningModal(async () => {
                const selected = await window.electronAPI.selectExe();
                resolve(selected);
            });
        });
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

async function _loadStandaloneOptiScalerReleases(forceRefresh = false) {
    optiscalerVersionsLoading.style.display = 'block';
    optiscalerVersionsLoading.textContent = t('opti.standaloneLoading');
    optiscalerVersionsLoading.style.color = 'var(--text-secondary)';
    optiscalerVersionsContainer.style.display = 'none';
    optiscalerVersionSelect.innerHTML = '';

    // Önceki cache status barını temizle
    const existingBar = optiscalerVersionsModal?.querySelector('.release-cache-status-bar');
    if (existingBar) existingBar.remove();

    try {
        const result = await window.electronAPI.getOptiScalerReleases(forceRefresh);
        if (result.error) throw new Error(result.error);
        
        const releases = result.releases ?? result;
        const fetchedAt = result.fetchedAt ?? null;
        const fromStaleCache = result.fromStaleCache ?? false;

        state.currentOptiReleases = releases;
        
        // Cache durum çubuğunu ekle
        const cacheBar = buildCacheStatusBar(fetchedAt, fromStaleCache, () => _loadStandaloneOptiScalerReleases(true));
        optiscalerVersionsContainer.parentNode.insertBefore(cacheBar, optiscalerVersionsContainer);

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
        
        optiscalerVersionsLoading.style.display = 'none';
        optiscalerVersionsContainer.style.display = 'block';
    } catch(e) {
        optiscalerVersionsLoading.textContent = t('opti.standaloneLoadError') + e.message;
        optiscalerVersionsLoading.style.color = '#ef4444';
    }
}

function showOptiWizardPreFlight(onStart) {
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
    startBtn.style.cssText = 'background:var(--accent-color);border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-size:14px;margin-left:10px;font-weight:bold;color:#000000;';
    
    startBtn.onclick = () => {
        closeModal('info-modal');
        onStart();
    };

    const btnRow = infoClose?.parentElement;
    if (btnRow) btnRow.appendChild(startBtn);

    openModal('info-modal');
}

export function initOptiListeners() {
    if (optiInstallBtn) {
        optiInstallBtn.addEventListener('click', () => runOptiInstall(false));
    }
    if (optiAutoInstallBtn) {
        optiAutoInstallBtn.addEventListener('click', () => runOptiInstall(true));
    }

    if (optiWizardBtn) {
        optiWizardBtn.addEventListener('click', async () => {
            if (isOptiWizardRunning() || isDlssWizardRunning()) {
                showInfoModal(t('update.infoTitle') || 'Bilgi', t('wizard.ongoingWarning'), true);
                return;
            }

            if (state.currentSelectedGame.hasOptiscaler || state.currentSelectedGame.hasOptiBuilder) {
                showInfoModal(t('opti.warningTitle') || 'Uyarı! ⚠️', t('opti.alreadyInstalled'), true);
                return;
            }

            const selectedTag = optiVersionSelect ? optiVersionSelect.value : null;
            const injection = optiInjectionSelect ? optiInjectionSelect.value : null;

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

            showOptiWizardPreFlight(async () => {
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

                    closeModal('optiscaler-modal');
                    openOptiWizardModal({
                        game: state.currentSelectedGame,
                        version: release.name,
                        tag: release.tag,
                        downloadUrl: release.downloadUrl,
                        injection,
                        isAuto: true,
                        installOptiPatcher: installPatcher,
                        optiPatcherTag: patcherRelease ? patcherRelease.tag : null,
                        optiPatcherUrl: patcherRelease ? patcherRelease.downloadUrl : null,
                        installFsr4: installFsr4,
                        fsr4Name: fsr4Release ? fsr4Release.name : null,
                        fsr4Url: fsr4Release ? fsr4Release.downloadUrl : null,
                        exePath: exePath,
                        bypassDx12Check: false
                    });
                } catch (err) {
                    showInfoModal(t('opti.errorTitle'), t('opti.pathCheckError') + err.message, true);
                }
            });
        });
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
            await _loadStandaloneOptiScalerReleases(false);
        });
    }

    if (optiscalerVersionSelect) {
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
