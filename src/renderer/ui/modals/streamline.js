import { state } from '../../state.js';
import { openModal, closeModal } from './base.js';
import { showInfoModal } from './info.js';
import { renderGames, updateHomeStats } from '../games.js';

const slVersionSelect = document.getElementById('sl-version');
const slAutoInstallBtn = document.getElementById('sl-auto-install-btn');
const slGameCover = document.getElementById('sl-game-cover');
const slGamePlaceholder = document.getElementById('sl-game-placeholder');
const slGameName = document.getElementById('sl-game-name');

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
}
