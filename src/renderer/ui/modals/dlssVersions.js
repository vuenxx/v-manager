import { openModal, closeModal } from './base.js';
import { showInfoModal } from './info.js';
import { t } from '../../i18n/i18n.js';
import { buildCacheStatusBar } from './cacheHelpers.js';

// DOM elements
const dlssVersionsBtn = document.getElementById('dlss-versions-btn');
const dlssVersionsLoading = document.getElementById('dlss-versions-loading');
const dlssVersionsContainer = document.getElementById('dlss-versions-container');
const dlssVersionSelect = document.getElementById('dlss-version-select');
const dlssDownloadBtn = document.getElementById('dlss-download-btn');

let isDownloading = false;
let currentReleases = [];

async function _loadDlssReleases(forceRefresh = false) {
    if (dlssVersionsLoading) {
        dlssVersionsLoading.style.display = 'block';
        dlssVersionsLoading.textContent = t('opti.standaloneLoading');
        dlssVersionsLoading.style.color = 'var(--text-secondary)';
    }
    if (dlssVersionsContainer) dlssVersionsContainer.style.display = 'none';
    if (dlssVersionSelect) dlssVersionSelect.innerHTML = '';
    
    // Önceki cache status barını temizle
    const existingBar = dlssVersionsContainer?.parentNode?.querySelector('.release-cache-status-bar');
    if (existingBar) existingBar.remove();
    
    try {
        const result = await window.electronAPI.getDlssEnablerReleases(forceRefresh);
        if (result.error) throw new Error(result.error);
        
        const releases = result.releases ?? result;
        const fetchedAt = result.fetchedAt ?? null;
        const fromStaleCache = result.fromStaleCache ?? false;

        currentReleases = releases;
        
        // Cache durum çubuğunu ekle
        const cacheBar = buildCacheStatusBar(fetchedAt, fromStaleCache, () => _loadDlssReleases(true));
        dlssVersionsContainer.parentNode.insertBefore(cacheBar, dlssVersionsContainer);

        if (dlssVersionSelect) {
            releases.forEach((r, index) => {
                const opt = document.createElement('option');
                opt.value = index;
                if (r.installed) {
                    opt.textContent = `${r.name} - ${t('opti.installed')}`;
                    opt.style.color = '#22c55e'; // Green for installed
                } else {
                    opt.textContent = r.name;
                }
                dlssVersionSelect.appendChild(opt);
            });
        }

        if (releases.length > 0 && dlssDownloadBtn) {
            if (releases[0].installed) {
                dlssDownloadBtn.textContent = t('opti.alreadyDownloaded');
                dlssDownloadBtn.style.backgroundColor = '#16a34a';
            } else {
                dlssDownloadBtn.textContent = t('opti.patcherInstallBtn');
                dlssDownloadBtn.style.backgroundColor = ''; 
            }
        }
        
        if (dlssVersionsLoading) dlssVersionsLoading.style.display = 'none';
        if (dlssVersionsContainer) dlssVersionsContainer.style.display = 'block';
    } catch(e) {
        if (dlssVersionsLoading) {
            dlssVersionsLoading.textContent = (t('opti.standaloneLoadError') || 'Sürümler yüklenemedi: ') + e.message;
            dlssVersionsLoading.style.color = '#ef4444';
        }
    }
}

export function initDlssVersionListeners() {
    if (dlssVersionsBtn) {
        dlssVersionsBtn.addEventListener('click', async () => {
            if (isDownloading) {
                showInfoModal(t('opti.busyTitle'), t('dlss.busyMsg') || 'DLSS Enabler indiriliyor, lütfen bekleyin.', true);
                return;
            }
            openModal('dlss-versions-modal');
            await _loadDlssReleases(false);
        });
    }

    if (dlssVersionSelect) {
        dlssVersionSelect.addEventListener('change', () => {
            const selectedIdx = dlssVersionSelect.value;
            if (selectedIdx !== '' && selectedIdx != null) {
                const release = currentReleases[selectedIdx];
                if (release && dlssDownloadBtn) {
                    if (release.installed) {
                        dlssDownloadBtn.textContent = t('opti.alreadyDownloaded');
                        dlssDownloadBtn.style.backgroundColor = '#16a34a';
                    } else {
                        dlssDownloadBtn.textContent = t('opti.patcherInstallBtn');
                        dlssDownloadBtn.style.backgroundColor = ''; 
                    }
                }
            }
        });
    }

    if (dlssDownloadBtn) {
        dlssDownloadBtn.addEventListener('click', async () => {
            if (isDownloading) return;
            const selectedIdx = dlssVersionSelect ? dlssVersionSelect.value : '';
            if (selectedIdx === '' || selectedIdx == null) return;
            
            const release = currentReleases[selectedIdx];
            if (!release) return;
            
            isDownloading = true;
            closeModal('dlss-versions-modal');
            
            const infoModalProgress = document.getElementById('info-modal-progress');
            showInfoModal(t('opti.downloadingTitle'), `DLSS Enabler ${release.name} indirme başlatıldı...`);
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
                        infoProgress(data.percent);
                    }
                }
            });
            
            function infoProgress(percent) {
                if (infoModalProgress) {
                    infoModalProgress.textContent = `%${percent}`;
                }
            }
            
            try {
                const result = await window.electronAPI.downloadDlssEnablerRelease({
                    name: release.name,
                    downloadUrl: release.downloadUrl
                });
                
                if (infoModalProgress) {
                    infoModalProgress.style.display = 'none';
                }
                
                closeModal('info-modal');
                if (result.success) {
                    showInfoModal(t('opti.successTitle'), `✅ DLSS Enabler ${release.name} başarıyla indirildi ve kuruldu.`);
                } else {
                    showInfoModal(t('opti.errorTitle'), `DLSS Enabler indirilirken hata oluştu: ` + result.error, true);
                }
            } catch(e) {
                if (infoModalProgress) {
                    infoModalProgress.style.display = 'none';
                }
                closeModal('info-modal');
                showInfoModal(t('opti.errorTitle'), (t('opti.unexpectedError') || 'Beklenmeyen hata: ') + e.message, true);
            } finally {
                isDownloading = false;
            }
        });
    }
}
