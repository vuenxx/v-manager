import { state } from '../../state.js';
import { openModal, closeModal } from './base.js';
import { showInfoModal } from './info.js';
import { renderGames, updateHomeStats } from '../games.js';
import { t } from '../../i18n/i18n.js';

const slVersionSelect = document.getElementById('sl-version');
const slAutoInstallBtn = document.getElementById('sl-auto-install-btn');
const slGameCover = document.getElementById('sl-game-cover');
const slGamePlaceholder = document.getElementById('sl-game-placeholder');
const slGameName = document.getElementById('sl-game-name');

// Streamline Versions Downloader Elements
const streamlineVersionsBtn = document.getElementById('streamline-versions-btn');
const streamlineVersionsModal = document.getElementById('streamline-versions-modal');
const streamlineVersionsLoading = document.getElementById('streamline-versions-loading');
const streamlineVersionsContainer = document.getElementById('streamline-versions-container');
const streamlineVersionSelect = document.getElementById('streamline-version-select');
const streamlineDownloadBtn = document.getElementById('streamline-download-btn');

export async function openStreamlineModal() {
    if (!state.currentSelectedGame) return;
    
    slGameName.textContent = state.currentSelectedGame.name;
    if (state.currentSelectedGame.cover) {
        slGameCover.src = state.currentSelectedGame.cover;
        slGameCover.style.display = 'block';
        slGamePlaceholder.style.display = 'none';
    } else {
        slGameCover.style.display = 'none';
        slGamePlaceholder.style.display = 'flex';
    }
    
    // Load Streamline versions into select dropdown
    slVersionSelect.innerHTML = `<option value="" disabled selected>${t('streamline.loadingVersions')}</option>`;
    try {
        const versions = await window.electronAPI.getStreamlineVersions();
        slVersionSelect.innerHTML = '';
        if (versions.length === 0) {
            slVersionSelect.innerHTML = `<option value="" disabled>${t('streamline.noVersions')}</option>`;
        } else {
            versions.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = v;
                slVersionSelect.appendChild(opt);
            });
        }
    } catch(e) {
        slVersionSelect.innerHTML = `<option value="" disabled>${t('streamline.loadError')}</option>`;
    }
    
    openModal('streamline-modal');
}

export async function runStreamlineInstall(game, version, targetDir, overwriteBackup = false, skipBackup = false) {
    showInfoModal(t('streamline.installingTitle'), t('streamline.installing'));
    try {
        const result = await window.electronAPI.installStreamline({
            game,
            version,
            targetDir,
            overwriteBackup,
            skipBackup
        });
        
        if (result.success) {
            closeModal('streamline-modal');
            closeModal('update-modal');
            showInfoModal(t('streamline.successTitle'), `🎉 Streamline (${version}) ${t('streamline.installSuccess')}`);
            if (result.games) {
                renderGames(result.games);
                updateHomeStats();
            }
        } else {
            showInfoModal(t('streamline.errorTitle'), t('streamline.installError') + result.error, true);
        }
    } catch(e) {
        showInfoModal(t('streamline.errorTitle'), t('streamline.unexpectedError') + e.message, true);
    }
}

export function initStreamlineListeners() {
    // Auto-install Streamline click
    if (slAutoInstallBtn) {
        slAutoInstallBtn.addEventListener('click', async () => {
            const version = slVersionSelect.value;
            if (!version) {
                showInfoModal(t('streamline.errorTitle'), t('streamline.selectVersion'), true);
                return;
            }
            
            showInfoModal(t('streamline.checkingTitle'), t('streamline.checkingPaths'));
            try {
                const check = await window.electronAPI.checkStreamlineBackup({
                    game: state.currentSelectedGame,
                    isAuto: true
                });
                
                if (!check.success) {
                    showInfoModal(t('streamline.errorTitle'), check.error, true);
                    return;
                }
                
                // Rule: Prevent Streamline update if original version < 2.0
                const originalVersion = (check.backupExists && check.backupVersion && check.backupVersion !== '0.0.0.0') 
                    ? check.backupVersion 
                    : check.currentVersion;

                if (originalVersion && originalVersion !== '0.0.0.0') {
                    const compare = await window.electronAPI.compareVersions(originalVersion, '2.0.0.0');
                    if (compare < 0) {
                        showInfoModal(t('streamline.versionWarningTitle'), `${t('streamline.versionWarningMsg')} (${originalVersion})`, true);
                        return;
                    }
                }

                await runStreamlineInstall(state.currentSelectedGame, version, check.targetDir, false, false);
            } catch(e) {
                showInfoModal(t('streamline.errorTitle'), t('streamline.pathError') + e.message, true);
            }
        });
    }

    // Streamline Sürümler butonu tıklama
    if (streamlineVersionsBtn) {
        streamlineVersionsBtn.addEventListener('click', async () => {
            if (state.isDownloadingStreamline) {
                showInfoModal(t('streamline.busyTitle'), t('streamline.busyMsg'), true);
                return;
            }
            openModal('streamline-versions-modal');
            streamlineVersionsLoading.style.display = 'block';
            streamlineVersionsLoading.textContent = t('streamline.standaloneLoading');
            streamlineVersionsLoading.style.color = 'var(--text-secondary)';
            streamlineVersionsContainer.style.display = 'none';
            streamlineVersionSelect.innerHTML = '';
            
            try {
                const releases = await window.electronAPI.getStreamlineReleases();
                if (releases.error) throw new Error(releases.error);
                
                state.currentStreamlineReleases = releases;
                
                releases.forEach((r, index) => {
                    const opt = document.createElement('option');
                    opt.value = index;
                    if (r.installed) {
                        opt.textContent = `${r.name} - [${t('streamline.installed').replace(/[\[\]]/g,'')}]`;
                        opt.style.color = '#22c55e';
                    } else {
                        opt.textContent = `${r.name}`;
                    }
                    streamlineVersionSelect.appendChild(opt);
                });

                if (releases.length > 0) {
                    const firstRelease = releases[0];
                    if (firstRelease.installed) {
                        streamlineDownloadBtn.textContent = t('streamline.alreadyDownloaded');
                        streamlineDownloadBtn.style.backgroundColor = '#16a34a';
                    } else {
                        streamlineDownloadBtn.textContent = t('streamline.downloadBtn');
                        streamlineDownloadBtn.style.backgroundColor = '';
                    }
                }

                // Sürüm değiştirildiğinde buton metnini güncelle
                streamlineVersionSelect.addEventListener('change', () => {
                    const selectedIdx = streamlineVersionSelect.value;
                    if (selectedIdx !== '' && selectedIdx != null) {
                        const release = state.currentStreamlineReleases[selectedIdx];
                        if (release) {
                            if (release.installed) {
                                streamlineDownloadBtn.textContent = t('streamline.alreadyDownloaded');
                                streamlineDownloadBtn.style.backgroundColor = '#16a34a';
                            } else {
                                streamlineDownloadBtn.textContent = t('streamline.downloadBtn');
                                streamlineDownloadBtn.style.backgroundColor = '';
                            }
                        }
                    }
                });
                
                streamlineVersionsLoading.style.display = 'none';
                streamlineVersionsContainer.style.display = 'block';
            } catch(e) {
                streamlineVersionsLoading.textContent = t('streamline.standaloneLoadError') + e.message;
                streamlineVersionsLoading.style.color = '#ef4444';
            }
        });
    }

    // İndir ve Çıkart butonu tıklama
    if (streamlineDownloadBtn) {
        streamlineDownloadBtn.addEventListener('click', async () => {
            if (state.isDownloadingStreamline) return;
            const selectedIdx = streamlineVersionSelect.value;
            if (selectedIdx === '' || selectedIdx == null) return;
            
            const release = state.currentStreamlineReleases[selectedIdx];
            if (!release) return;
            
            state.isDownloadingStreamline = true;
            closeModal('streamline-versions-modal');
            
            const infoModalProgress = document.getElementById('info-modal-progress');
            showInfoModal(t('streamline.downloadingTitle'), `Streamline ${release.tag} ${t('streamline.downloadingMsg')}`);
            if (infoModalProgress) {
                infoModalProgress.style.display = 'block';
                infoModalProgress.style.color = '';
                infoModalProgress.textContent = '%0';
            }
            
            if (window.electronAPI.removeStreamlineProgressListeners) {
                window.electronAPI.removeStreamlineProgressListeners();
            }
            window.electronAPI.onStreamlineDownloadProgress((data) => {
                if (infoModalProgress) {
                    if (data.stage === 'extracting') {
                        infoModalProgress.textContent = t('streamline.extractingShort');
                    } else {
                        infoModalProgress.textContent = `%${data.percent}`;
                    }
                }
            });
            
            try {
                const result = await window.electronAPI.downloadStreamlineRelease({
                    tag: release.tag,
                    downloadUrl: release.downloadUrl
                });
                
                if (result.success) {
                    if (infoModalProgress) infoModalProgress.style.display = 'none';
                    closeModal('info-modal');
                    showInfoModal(t('streamline.successTitle'), `✅ Streamline ${release.tag} ${t('streamline.downloadSuccess')}`);
                } else {
                    // UI tarafında indirme barının kırmızıya dönüp "Kurulum Başarısız" mesajı vermesi
                    if (infoModalProgress) {
                        infoModalProgress.style.color = '#ef4444';
                        infoModalProgress.textContent = t('streamline.downloadFailed');
                    }
                    await new Promise(r => setTimeout(r, 1500));
                    if (infoModalProgress) infoModalProgress.style.display = 'none';
                    closeModal('info-modal');
                    showInfoModal(t('streamline.errorTitle'), t('streamline.downloadError') + result.error, true);
                }
            } catch(e) {
                if (infoModalProgress) {
                    infoModalProgress.style.color = '#ef4444';
                    infoModalProgress.textContent = t('streamline.downloadFailed');
                }
                await new Promise(r => setTimeout(r, 1500));
                if (infoModalProgress) infoModalProgress.style.display = 'none';
                closeModal('info-modal');
                showInfoModal(t('streamline.errorTitle'), t('streamline.unexpectedDownloadError') + e.message, true);
            } finally {
                state.isDownloadingStreamline = false;
                if (window.electronAPI.removeStreamlineProgressListeners) {
                    window.electronAPI.removeStreamlineProgressListeners();
                }
            }
        });
    }
}
