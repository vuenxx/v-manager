import { state } from '../../state.js';
import { openModal, closeModal } from './base.js';
import { showInfoModal } from './info.js';
import { renderGames, updateHomeStats } from '../games.js';

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
        showInfoModal('Uyarı! ⚠️', 'Bu oyuna halihazırda OptiScaler kurulu, bu modun çakışmasına sebep olacaktır. Lütfen bu modu kurmadan önce OptiScaler’ı kaldırın.', true);
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
            opt.textContent = "Sürüm bulunamadı";
            dlssVersionSelect.appendChild(opt);
        }
    } catch (e) {
        dlssVersionSelect.innerHTML = '<option value="">Hata</option>';
    }

    openModal('dlss-modal');
}

export async function runUnifiedInstall(exePath, dlssVersion, dllName) {
    showInfoModal('Kuruluyor', 'Kurulum yapılıyor, lütfen bekleyin...');
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
            let successMsg = `🎉 DLSS Enabler (${dlssVersion}) başarıyla kuruldu!`;
            if (dlssResult.savedToUserGames) {
                successMsg += `\n\n📌 Bu oyunun EXE yolu "Kullanıcı Oyun Yolları"na kaydedildi.\nBir dahaki seferde "Otomatik Kur" seçeneğini kullanabilirsiniz.`;
            }
            showInfoModal('Başarılı', successMsg);
            if (dlssResult.games) {
                renderGames(dlssResult.games);
                updateHomeStats();
            }
        } else {
            showInfoModal('Hata', 'DLSS Enabler kurulumu başarısız oldu:\n' + dlssResult.error, true);
        }
    } catch(e) {
        closeModal('info-modal');
        showInfoModal('Hata', 'Kurulum sırasında beklenmeyen bir hata oluştu:\n' + e.message, true);
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
                showInfoModal("Hata", "Lütfen bir sürüm seçin!", true);
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
                showInfoModal("Hata", `Hata oluştu: ${e.message}`, true);
            }
        });
    }

    if (dlssAutoInstallBtn) {
        dlssAutoInstallBtn.addEventListener('click', async () => {
            const version = dlssVersionSelect.value;
            if (!version) {
                showInfoModal("Hata", "Lütfen bir sürüm seçin!", true);
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
                        "Yol Tanımı Eksik",
                        `Bu oyun ("${state.currentSelectedGame.name}") için geçerli bir EXE yolu belirlenemedi.\n\nOtomatik kurulum yapabilmek için lütfen:\n• Ayarlar → "Kullanıcı Oyun Yolları" bölümünden oyunun ana klasörünü ve EXE yolunu tanımlayın, \n\nveya "Manuel Kur" seçeneğini kullanın.`,
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
                showInfoModal("Hata", "Yol kontrol edilirken hata oluştu: " + e.message, true);
            }
        });
    }
}
