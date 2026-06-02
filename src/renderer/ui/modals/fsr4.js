import { openModal, closeModal } from './base.js';
import { showInfoModal } from './info.js';
import { t } from '../../i18n/i18n.js';

const fsr4VersionsBtn = document.getElementById('fsr4-versions-btn');
const fsr4VersionsModal = document.getElementById('fsr4-versions-modal');
const fsr4VersionsLoading = document.getElementById('fsr4-versions-loading');
const fsr4VersionsContainer = document.getElementById('fsr4-versions-container');
const fsr4VersionSelect = document.getElementById('fsr4-version-select');
const fsr4DownloadBtn = document.getElementById('fsr4-download-btn');

let isDownloading = false;
let currentReleases = [];

export function initFsr4Listeners() {
    if (fsr4VersionsBtn) {
        fsr4VersionsBtn.addEventListener('click', async () => {
            if (isDownloading) {
                showInfoModal(t('opti.busyTitle'), t('opti.fsr4BusyMsg'), true);
                return;
            }
            openModal('fsr4-versions-modal');
            fsr4VersionsLoading.style.display = 'block';
            fsr4VersionsLoading.textContent = t('opti.standaloneLoading');
            fsr4VersionsLoading.style.color = 'var(--text-secondary)';
            fsr4VersionsContainer.style.display = 'none';
            fsr4VersionSelect.innerHTML = '';
            
            try {
                const releases = await window.electronAPI.getFsr4Releases();
                if (releases.error) throw new Error(releases.error);
                
                currentReleases = releases;
                
                releases.forEach((r, index) => {
                    const opt = document.createElement('option');
                    opt.value = index;
                    if (r.installed) {
                        opt.textContent = `${r.name} - ${t('opti.installed')}`;
                        opt.style.color = '#22c55e'; // Green for installed
                    } else {
                        opt.textContent = r.name;
                    }
                    fsr4VersionSelect.appendChild(opt);
                });

                // Update download button state initially based on the first selected release
                if (releases.length > 0) {
                    if (releases[0].installed) {
                        fsr4DownloadBtn.textContent = t('opti.alreadyDownloaded');
                        fsr4DownloadBtn.style.backgroundColor = '#16a34a';
                    } else {
                        fsr4DownloadBtn.textContent = t('opti.patcherInstallBtn');
                        fsr4DownloadBtn.style.backgroundColor = ''; // Reset to default CSS
                    }
                }

                // Add change listener to update download button dynamically
                fsr4VersionSelect.addEventListener('change', () => {
                    const selectedIdx = fsr4VersionSelect.value;
                    if (selectedIdx !== '' && selectedIdx != null) {
                        const release = currentReleases[selectedIdx];
                        if (release) {
                            if (release.installed) {
                                fsr4DownloadBtn.textContent = t('opti.alreadyDownloaded');
                                fsr4DownloadBtn.style.backgroundColor = '#16a34a';
                            } else {
                                fsr4DownloadBtn.textContent = t('opti.patcherInstallBtn');
                                fsr4DownloadBtn.style.backgroundColor = ''; // Reset to default CSS
                            }
                        }
                    }
                });
                
                fsr4VersionsLoading.style.display = 'none';
                fsr4VersionsContainer.style.display = 'block';
            } catch(e) {
                fsr4VersionsLoading.textContent = t('opti.standaloneLoadError') + e.message;
                fsr4VersionsLoading.style.color = '#ef4444';
            }
        });
    }

    if (fsr4DownloadBtn) {
        fsr4DownloadBtn.addEventListener('click', async () => {
            if (isDownloading) return;
            const selectedIdx = fsr4VersionSelect.value;
            if (selectedIdx === '' || selectedIdx == null) return;
            
            const release = currentReleases[selectedIdx];
            if (!release) return;
            
            isDownloading = true;
            closeModal('fsr4-versions-modal');
            
            const infoModalProgress = document.getElementById('info-modal-progress');
            showInfoModal(t('opti.downloadingTitle'), `FSR4 Files ${release.name} ${t('opti.fsr4DownloadingMsg')}`);
            if (infoModalProgress) {
                infoModalProgress.style.display = 'block';
                infoModalProgress.textContent = '%0';
            }
            
            // Remove any previously registered progress listeners before adding a new one
            if (window.electronAPI.removeFsr4ProgressListeners) {
                window.electronAPI.removeFsr4ProgressListeners();
            }
            
            // Wire progress updates
            window.electronAPI.onFsr4DownloadProgress((data) => {
                if (infoModalProgress) {
                    if (data.stage === 'extracting') {
                        infoModalProgress.textContent = t('opti.extractingShort');
                    } else {
                        infoModalProgress.textContent = `%${data.percent}`;
                    }
                }
            });
            
            try {
                const result = await window.electronAPI.downloadFsr4Release({
                    name: release.name,
                    downloadUrl: release.downloadUrl
                });
                
                // Hide progress indicator
                if (infoModalProgress) {
                    infoModalProgress.style.display = 'none';
                }
                
                closeModal('info-modal');
                if (result.success) {
                    showInfoModal(t('opti.successTitle'), `✅ FSR4 Files ${release.name} ${t('opti.fsr4DownloadSuccess')}`);
                } else {
                    showInfoModal(t('opti.errorTitle'), t('opti.fsr4DownloadError') + result.error, true);
                }
            } catch(e) {
                if (infoModalProgress) {
                    infoModalProgress.style.display = 'none';
                }
                closeModal('info-modal');
                showInfoModal(t('opti.errorTitle'), t('opti.unexpectedError') + e.message, true);
            } finally {
                isDownloading = false;
            }
        });
    }
}
