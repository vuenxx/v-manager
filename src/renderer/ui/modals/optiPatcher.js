import { openModal, closeModal } from './base.js';
import { showInfoModal } from './info.js';

const optipatcherVersionsBtn = document.getElementById('optipatcher-versions-btn');
const optipatcherVersionsModal = document.getElementById('optipatcher-versions-modal');
const optipatcherVersionsLoading = document.getElementById('optipatcher-versions-loading');
const optipatcherVersionsContainer = document.getElementById('optipatcher-versions-container');
const optipatcherVersionSelect = document.getElementById('optipatcher-version-select');
const optipatcherDownloadBtn = document.getElementById('optipatcher-download-btn');

let isDownloading = false;
let currentReleases = [];

export function initOptiPatcherListeners() {
    if (optipatcherVersionsBtn) {
        optipatcherVersionsBtn.addEventListener('click', async () => {
            if (isDownloading) {
                showInfoModal('İşlem Devam Ediyor', 'Zaten aktif bir OptiPatcher indirme işlemi devam ediyor, lütfen onun tamamlanmasını bekleyin.', true);
                return;
            }
            openModal('optipatcher-versions-modal');
            optipatcherVersionsLoading.style.display = 'block';
            optipatcherVersionsLoading.textContent = 'Sürümler aranıyor, lütfen bekleyin...';
            optipatcherVersionsLoading.style.color = 'var(--text-secondary)';
            optipatcherVersionsContainer.style.display = 'none';
            optipatcherVersionSelect.innerHTML = '';
            
            try {
                const releases = await window.electronAPI.getOptiPatcherReleases();
                if (releases.error) throw new Error(releases.error);
                
                currentReleases = releases;
                
                releases.forEach((r, index) => {
                    const opt = document.createElement('option');
                    opt.value = index;
                    if (r.installed) {
                        opt.textContent = `${r.name} (${r.tag}) - [YÜKLÜ]`;
                        opt.style.color = '#22c55e'; // Green for installed
                    } else {
                        opt.textContent = `${r.name} (${r.tag})`;
                    }
                    optipatcherVersionSelect.appendChild(opt);
                });

                // Update download button state initially based on the first selected release
                if (releases.length > 0) {
                    if (releases[0].installed) {
                        optipatcherDownloadBtn.textContent = 'Zaten Yüklü (Yeniden İndir)';
                        optipatcherDownloadBtn.style.backgroundColor = '#16a34a';
                    } else {
                        optipatcherDownloadBtn.textContent = 'Yükle';
                        optipatcherDownloadBtn.style.backgroundColor = ''; // Reset to default CSS
                    }
                }

                // Add change listener to update download button dynamically
                optipatcherVersionSelect.addEventListener('change', () => {
                    const selectedIdx = optipatcherVersionSelect.value;
                    if (selectedIdx !== '' && selectedIdx != null) {
                        const release = currentReleases[selectedIdx];
                        if (release) {
                            if (release.installed) {
                                optipatcherDownloadBtn.textContent = 'Zaten Yüklü (Yeniden İndir)';
                                optipatcherDownloadBtn.style.backgroundColor = '#16a34a';
                            } else {
                                optipatcherDownloadBtn.textContent = 'Yükle';
                                optipatcherDownloadBtn.style.backgroundColor = ''; // Reset to default CSS
                            }
                        }
                    }
                });
                
                optipatcherVersionsLoading.style.display = 'none';
                optipatcherVersionsContainer.style.display = 'block';
            } catch(e) {
                optipatcherVersionsLoading.textContent = 'Sürümler yüklenirken hata oluştu: ' + e.message;
                optipatcherVersionsLoading.style.color = '#ef4444';
            }
        });
    }

    if (optipatcherDownloadBtn) {
        optipatcherDownloadBtn.addEventListener('click', async () => {
            if (isDownloading) return;
            const selectedIdx = optipatcherVersionSelect.value;
            if (selectedIdx === '' || selectedIdx == null) return;
            
            const release = currentReleases[selectedIdx];
            if (!release) return;
            
            isDownloading = true;
            closeModal('optipatcher-versions-modal');
            
            const infoModalProgress = document.getElementById('info-modal-progress');
            showInfoModal('İndiriliyor...', `OptiPatcher ${release.tag} sürümü indiriliyor, lütfen bekleyin.\n\nBu işlem internet hızınıza göre zaman alabilir.`);
            if (infoModalProgress) {
                infoModalProgress.style.display = 'block';
                infoModalProgress.textContent = '%0';
            }
            
            // Remove any previously registered progress listeners before adding a new one
            if (window.electronAPI.removeOptiPatcherProgressListeners) {
                window.electronAPI.removeOptiPatcherProgressListeners();
            }
            
            // Wire progress updates
            window.electronAPI.onOptipatcherDownloadProgress((data) => {
                if (infoModalProgress) {
                    infoModalProgress.textContent = `%${data.percent}`;
                }
            });
            
            try {
                const result = await window.electronAPI.downloadOptiPatcherRelease({
                    tag: release.tag,
                    downloadUrl: release.downloadUrl
                });
                
                // Hide progress indicator
                if (infoModalProgress) {
                    infoModalProgress.style.display = 'none';
                }
                
                closeModal('info-modal');
                if (result.success) {
                    showInfoModal('Başarılı', `✅ OptiPatcher ${release.tag} başarıyla indirildi!`);
                } else {
                    showInfoModal('Hata', 'İndirme sırasında hata oluştu:\n' + result.error, true);
                }
            } catch(e) {
                if (infoModalProgress) {
                    infoModalProgress.style.display = 'none';
                }
                closeModal('info-modal');
                showInfoModal('Hata', 'Beklenmeyen hata:\n' + e.message, true);
            } finally {
                isDownloading = false;
            }
        });
    }
}
