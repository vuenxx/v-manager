import { state } from '../../state.js';
import { openModal, closeModal } from './base.js';
import { showInfoModal, showConfirmDialog } from './info.js';
import { renderGames, updateHomeStats } from '../games.js';
import { t, getCurrentLang } from '../../i18n/i18n.js';

let isBuilderWizardRunning = false;
let closeAttempts = 0;
let cancelRequested = false;

export function isOptiBuilderWizardRunning() {
    return isBuilderWizardRunning;
}

export async function openOptiBuilderWizardModal(params) {
    if (isBuilderWizardRunning) return;
    closeAttempts = 0;
    cancelRequested = false;

    const wizardModal = document.getElementById('ob-wizard-modal');
    const infoGame = document.getElementById('ob-wizard-info-game');
    const infoExe = document.getElementById('ob-wizard-info-exe');
    const infoVersion = document.getElementById('ob-wizard-info-version');
    const infoInjection = document.getElementById('ob-wizard-info-injection');
    const logArea = document.getElementById('ob-wizard-log-area');
    const statusText = document.getElementById('ob-wizard-status-text');
    const spinner = document.getElementById('ob-wizard-spinner');
    const finalBtn = document.getElementById('ob-wizard-final-btn');

    if (!wizardModal) return;

    // Fill info fields
    if (infoGame) infoGame.textContent = params.game.name;
    if (infoExe) infoExe.textContent = params.exePath || '-';
    if (infoVersion) infoVersion.textContent = params.tag;
    if (infoInjection) infoInjection.textContent = params.injection;

    // Reset log
    if (logArea) logArea.innerHTML = '';

    // Set UI states
    if (statusText) statusText.textContent = t('wizard.stepInstall') || 'Kurulum yapılıyor...';
    if (spinner) spinner.style.display = 'block';
    if (finalBtn) finalBtn.style.display = 'none';

    isBuilderWizardRunning = true;
    openModal('ob-wizard-modal');

    // Remove old listeners
    if (window.electronAPI.removeOptiBuilderWizardLogListeners) {
        window.electronAPI.removeOptiBuilderWizardLogListeners();
    }

    // Setup live log listener
    window.electronAPI.onOptiBuilderWizardLog((data) => {
        const line = document.createElement('div');
        line.className = `wizard-log-line ${data.type}`;
        line.textContent = data.msg;
        if (logArea) {
            logArea.appendChild(line);
            logArea.scrollTop = logArea.scrollHeight;
        }
    });

    try {
        const result = await window.electronAPI.runOptiBuilderWizard({
            ...params,
            lang: getCurrentLang()
        });

        // Check if DX12 support is not detected and handle the bypass dialog
        if (!result.success && result.error === 'DX12_NOT_SUPPORTED') {
            isBuilderWizardRunning = false;
            closeModal('ob-wizard-modal');
            if (window.electronAPI.removeOptiBuilderWizardLogListeners) {
                window.electronAPI.removeOptiBuilderWizardLogListeners();
            }

            const wantToProceed = await showConfirmDialog(
                t('optiBuilder.warningTitle') || (getCurrentLang() === 'en' ? 'Warning! ⚠️' : 'Uyarı! ⚠️'),
                t('optiBuilder.dx12WarningBody') || 'Oyunda DirectX12 desteği bulunmadığı tespit edildi...'
            );

            if (wantToProceed) {
                const newParams = { ...params, bypassDx12Check: true };
                await openOptiBuilderWizardModal(newParams);
                return;
            } else {
                return;
            }
        }

        isBuilderWizardRunning = false;

        if (spinner) spinner.style.display = 'none';
        if (statusText) {
            const wasCancelled = result && result.error === 'ABORTED';
            statusText.textContent = result.success
                ? (t('wizard.finalSuccess') || 'Kurulum basarili')
                : (wasCancelled ? (t('wizard.cancelled') || 'Iptal edildi') : (t('wizard.finalError') || 'Kurulum basarisiz oldu'));
        }
        if (finalBtn) finalBtn.style.display = 'block';

        if (result.success) {
            if (result.games) {
                const updatedGame = result.games.find(g => g.name === state.currentSelectedGame.name);
                if (updatedGame) {
                    state.currentSelectedGame = updatedGame;
                }
                renderGames(result.games);
                updateHomeStats();
            }
        }
    } catch (err) {
        isBuilderWizardRunning = false;
        if (spinner) spinner.style.display = 'none';
        if (statusText) statusText.textContent = cancelRequested ? (t('wizard.cancelled') || 'Iptal edildi') : (t('wizard.finalError') || 'Kurulum basarisiz oldu');
        cancelRequested = false;
        if (finalBtn) finalBtn.style.display = 'block';

        const line = document.createElement('div');
        line.className = 'wizard-log-line err';
        line.textContent = `${t('optiBuilder.unexpectedError') || 'Beklenmeyen hata: '}${err.message}`;
        if (logArea) {
            logArea.appendChild(line);
            logArea.scrollTop = logArea.scrollHeight;
        }
    }
}

export async function closeOptiBuilderWizardModal() {
    if (isBuilderWizardRunning) {
        const statusText = document.getElementById('ob-wizard-status-text');
        if (cancelRequested) {
            showInfoModal(
                t('update.infoTitle') || (getCurrentLang() === 'en' ? 'Information' : 'Bilgi'),
                t('wizard.cancelling') || 'Iptal ediliyor...'
            );
            return;
        }

        const confirmCancel = await showConfirmDialog(
            t('wizard.cancelTitle') || (getCurrentLang() === 'en' ? 'Cancel Installation' : 'Kurulumu Iptal Et'),
            t('wizard.cancelMsg') || 'Kurulumu iptal etmek istiyor musunuz? Kopyalanan dosyalar kaldirilacak.'
        );
        if (confirmCancel) {
            cancelRequested = true;
            if (statusText) statusText.textContent = t('wizard.cancelling') || 'Iptal ediliyor...';
            await window.electronAPI.abortOptiBuilderWizard();
        }
        return;
    }

    closeAttempts = 0;
    cancelRequested = false;
    closeModal('ob-wizard-modal');

    if (window.electronAPI.removeOptiBuilderWizardLogListeners) {
        window.electronAPI.removeOptiBuilderWizardLogListeners();
    }
}

export function initOptiBuilderWizardListeners() {
    const closeBtn = document.getElementById('ob-wizard-close-btn');
    const finalBtn = document.getElementById('ob-wizard-final-btn');

    if (closeBtn) {
        closeBtn.addEventListener('click', closeOptiBuilderWizardModal);
    }
    if (finalBtn) {
        finalBtn.addEventListener('click', closeOptiBuilderWizardModal);
    }
}
