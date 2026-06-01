import { state } from '../../state.js';
import { openModal, closeModal } from './base.js';
import { showInfoModal } from './info.js';
import { renderGames, updateHomeStats } from '../games.js';

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
    slVersionSelect.innerHTML = '<option value="" disabled selected>Yükleniyor...</option>';
    try {
        const versions = await window.electronAPI.getStreamlineVersions();
        slVersionSelect.innerHTML = '';
        if (versions.length === 0) {
            slVersionSelect.innerHTML = '<option value="" disabled>Hiç versiyon bulunamadı (mods/streamline klasörünü kontrol edin)</option>';
        } else {
            versions.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = v;
                slVersionSelect.appendChild(opt);
            });
        }
    } catch(e) {
        slVersionSelect.innerHTML = '<option value="" disabled>Versiyonlar yüklenemedi</option>';
    }
    
    openModal('streamline-modal');
}

export async function runStreamlineInstall(game, version, targetDir, overwriteBackup = false, skipBackup = false) {
    showInfoModal('Kuruluyor', 'Streamline dosyaları kopyalanıyor, lütfen bekleyin...');
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
            showInfoModal('Başarılı', `🎉 Streamline (${version}) başarıyla kuruldu!`);
            if (result.games) {
                renderGames(result.games);
                updateHomeStats();
            }
        } else {
            showInfoModal('Hata', 'Kurulum başarısız oldu:\n' + result.error, true);
        }
    } catch(e) {
        showInfoModal('Hata', 'Kurulum sırasında beklenmeyen bir hata oluştu:\n' + e.message, true);
    }
}

export function initStreamlineListeners() {
    // Auto-install Streamline click
    if (slAutoInstallBtn) {
        slAutoInstallBtn.addEventListener('click', async () => {
            const version = slVersionSelect.value;
            if (!version) {
                showInfoModal('Hata', 'Lütfen kurulacak bir Streamline sürümü seçin!', true);
                return;
            }
            
            showInfoModal('Kontrol Ediliyor', 'Yol bilgileri doğrulanıyor ve yedek kontrolü yapılıyor...');
            try {
                const check = await window.electronAPI.checkStreamlineBackup({
                    game: state.currentSelectedGame,
                    isAuto: true
                });
                
                if (!check.success) {
                    showInfoModal('Hata', check.error, true);
                    return;
                }
                
                // Rule: Prevent Streamline update if original version < 2.0
                const originalVersion = (check.backupExists && check.backupVersion && check.backupVersion !== '0.0.0.0') 
                    ? check.backupVersion 
                    : check.currentVersion;

                if (originalVersion && originalVersion !== '0.0.0.0') {
                    const compare = await window.electronAPI.compareVersions(originalVersion, '2.0.0.0');
                    if (compare < 0) {
                        showInfoModal('DİKKAT!', `Bu oyun Streamline dosyalarının 2.0 altı versiyonunu (${originalVersion}) kullanıyor ve güncellerseniz hiçbir şekilde işe yaramayacak/hatta oyununuz bozulabilecektir.`, true);
                        return;
                    }
                }

                await runStreamlineInstall(state.currentSelectedGame, version, check.targetDir, false, false);
            } catch(e) {
                showInfoModal('Hata', 'Yol doğrulanırken hata oluştu: ' + e.message, true);
            }
        });
    }

    // Streamline Sürümler butonu tıklama
    if (streamlineVersionsBtn) {
        streamlineVersionsBtn.addEventListener('click', async () => {
            if (state.isDownloadingStreamline) {
                showInfoModal('İşlem Devam Ediyor', 'Zaten aktif bir Streamline indirme işlemi devam ediyor, lütfen onun tamamlanmasını bekleyin.', true);
                return;
            }
            openModal('streamline-versions-modal');
            streamlineVersionsLoading.style.display = 'block';
            streamlineVersionsLoading.textContent = 'Sürümler aranıyor, lütfen bekleyin...';
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
                        opt.textContent = `${r.name} - [YÜKLÜ]`;
                        opt.style.color = '#22c55e';
                    } else {
                        opt.textContent = `${r.name}`;
                    }
                    streamlineVersionSelect.appendChild(opt);
                });

                if (releases.length > 0) {
                    const firstRelease = releases[0];
                    if (firstRelease.installed) {
                        streamlineDownloadBtn.textContent = 'Zaten Yüklü (Yeniden İndir)';
                        streamlineDownloadBtn.style.backgroundColor = '#16a34a';
                    } else {
                        streamlineDownloadBtn.textContent = 'İndir ve Çıkart';
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
                                streamlineDownloadBtn.textContent = 'Zaten Yüklü (Yeniden İndir)';
                                streamlineDownloadBtn.style.backgroundColor = '#16a34a';
                            } else {
                                streamlineDownloadBtn.textContent = 'İndir ve Çıkart';
                                streamlineDownloadBtn.style.backgroundColor = '';
                            }
                        }
                    }
                });
                
                streamlineVersionsLoading.style.display = 'none';
                streamlineVersionsContainer.style.display = 'block';
            } catch(e) {
                streamlineVersionsLoading.textContent = 'Sürümler yüklenirken hata oluştu: ' + e.message;
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
            showInfoModal('İndiriliyor...', `Streamline ${release.tag} sürümü indiriliyor, lütfen bekleyin.\n\nBu işlem internet hızınıza göre zaman alabilir.`);
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
                        infoModalProgress.textContent = 'Çıkartılıyor...';
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
                    showInfoModal('Başarılı', `✅ Streamline ${release.tag} başarıyla indirildi!`);
                } else {
                    // UI tarafında indirme barının kırmızıya dönüp "Kurulum Başarısız" mesajı vermesi
                    if (infoModalProgress) {
                        infoModalProgress.style.color = '#ef4444';
                        infoModalProgress.textContent = '❌ Kurulum Başarısız';
                    }
                    await new Promise(r => setTimeout(r, 1500));
                    if (infoModalProgress) infoModalProgress.style.display = 'none';
                    closeModal('info-modal');
                    showInfoModal('Hata', 'İndirme sırasında hata oluştu:\n' + result.error, true);
                }
            } catch(e) {
                if (infoModalProgress) {
                    infoModalProgress.style.color = '#ef4444';
                    infoModalProgress.textContent = '❌ Kurulum Başarısız';
                }
                await new Promise(r => setTimeout(r, 1500));
                if (infoModalProgress) infoModalProgress.style.display = 'none';
                closeModal('info-modal');
                showInfoModal('Hata', 'Beklenmeyen hata:\n' + e.message, true);
            } finally {
                state.isDownloadingStreamline = false;
                if (window.electronAPI.removeStreamlineProgressListeners) {
                    window.electronAPI.removeStreamlineProgressListeners();
                }
            }
        });
    }
}
