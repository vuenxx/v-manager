import { openModal, closeModal } from './base.js';
import { showInfoModal, showConfirmDialog } from './info.js';
import { renderGames, updateHomeStats } from '../games.js';
import { t, getCurrentLang } from '../../i18n/i18n.js';

let isWizardRunning = false;
let closeAttempts = 0;
let cancelRequested = false;
export function isOptiWizardRunning() {
    return isWizardRunning;
}

export async function openOptiWizardModal(params) {
    if (isWizardRunning) return;
    closeAttempts = 0;
    cancelRequested = false;

    const wizardModal = document.getElementById('opti-wizard-modal');
    const infoGame = document.getElementById('opti-wizard-info-game');
    const infoExe = document.getElementById('opti-wizard-info-exe');
    const infoVersion = document.getElementById('opti-wizard-info-version');
    const infoInjection = document.getElementById('opti-wizard-info-injection');
    const infoPatcher = document.getElementById('opti-wizard-info-patcher');
    const infoFsr4 = document.getElementById('opti-wizard-info-fsr4');
    const logArea = document.getElementById('opti-wizard-log-area');
    const statusText = document.getElementById('opti-wizard-status-text');
    const spinner = document.getElementById('opti-wizard-spinner');
    const finalBtn = document.getElementById('opti-wizard-final-btn');

    if (!wizardModal) return;

    // Fill info fields
    if (infoGame) infoGame.textContent = params.game.name;
    if (infoExe) infoExe.textContent = params.exePath || '-';
    if (infoVersion) infoVersion.textContent = params.tag;
    if (infoInjection) infoInjection.textContent = params.injection;
    if (infoPatcher) {
        infoPatcher.textContent = params.installOptiPatcher ? `${t('dlss.yesBtn') || 'Evet'} (${params.optiPatcherTag})` : (t('dlss.noBtn') || 'Hayır');
    }
    if (infoFsr4) {
        infoFsr4.textContent = params.installFsr4 ? `${t('dlss.yesBtn') || 'Evet'} (${params.fsr4Name})` : (t('dlss.noBtn') || 'Hayır');
    }

    // Reset log
    if (logArea) logArea.innerHTML = '';

    // Set UI states
    if (statusText) statusText.textContent = t('wizard.stepInstall') || 'Kurulum yapılıyor...';
    if (spinner) spinner.style.display = 'block';
    if (finalBtn) finalBtn.style.display = 'none';

    isWizardRunning = true;
    openModal('opti-wizard-modal');

    // Remove old listeners
    if (window.electronAPI.removeOptiWizardLogListeners) {
        window.electronAPI.removeOptiWizardLogListeners();
    }

    // Setup live log listener
    window.electronAPI.onOptiWizardLog((data) => {
        // Append line to terminal
        const line = document.createElement('div');
        line.className = `wizard-log-line ${data.type}`;
        line.textContent = data.msg;
        if (logArea) {
            logArea.appendChild(line);
            logArea.scrollTop = logArea.scrollHeight;
        }
    });

    try {
        const result = await window.electronAPI.runOptiWizard({
            ...params,
            lang: getCurrentLang()
        });

        // Check if DX12 support is not detected and handle the bypass dialog
        if (!result.success && result.error === 'DX12_NOT_SUPPORTED') {
            isWizardRunning = false;
            closeModal('opti-wizard-modal');
            if (window.electronAPI.removeOptiWizardLogListeners) {
                window.electronAPI.removeOptiWizardLogListeners();
            }

            // Ask the user if they want to bypass/continue
            // "Evet" means "Yes, I don't want to continue" -> cancel
            // Ask the user if they want to proceed/continue
            // "Evet" means "Yes, I want to proceed" -> bypass
            // "Hayır" means "No, I want to cancel" -> cancel
            const wantToProceed = await showConfirmDialog(
                t('opti.warningTitle') || (getCurrentLang() === 'en' ? 'Warning! ⚠️' : 'Uyarı! ⚠️'),
                t('opti.dx12WarningBody') || 'Oyunda DirectX12 desteği bulunmadığı tespit edildi...'
            );

            if (wantToProceed) {
                // User wants to continue (bypass DX12 check)
                const newParams = { ...params, bypassDx12Check: true };
                await openOptiWizardModal(newParams);
                return;
            } else {
                // User wants to cancel
                return;
            }
        }

        isWizardRunning = false;

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
                renderGames(result.games);
                updateHomeStats();
            }
        }
    } catch (err) {
        isWizardRunning = false;
        if (spinner) spinner.style.display = 'none';
        if (statusText) statusText.textContent = cancelRequested ? (t('wizard.cancelled') || 'Iptal edildi') : (t('wizard.finalError') || 'Kurulum basarisiz oldu');
        cancelRequested = false;
        if (finalBtn) finalBtn.style.display = 'block';

        const line = document.createElement('div');
        line.className = 'wizard-log-line err';
        line.textContent = `${t('opti.unexpectedError') || 'Beklenmeyen hata: '}${err.message}`;
        if (logArea) {
            logArea.appendChild(line);
            logArea.scrollTop = logArea.scrollHeight;
        }
    }
}

export async function closeOptiWizardModal() {
    if (isWizardRunning) {
        const statusText = document.getElementById('opti-wizard-status-text');
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
            await window.electronAPI.abortOptiWizard();
        }
        return;
    }

    closeAttempts = 0;
    cancelRequested = false;
    closeModal('opti-wizard-modal');

    if (window.electronAPI.removeOptiWizardLogListeners) {
        window.electronAPI.removeOptiWizardLogListeners();
    }
}

export function initOptiWizardListeners() {
    const closeBtn = document.getElementById('opti-wizard-close-btn');
    const finalBtn = document.getElementById('opti-wizard-final-btn');

    if (closeBtn) {
        closeBtn.addEventListener('click', closeOptiWizardModal);
    }
    if (finalBtn) {
        finalBtn.addEventListener('click', closeOptiWizardModal);
    }
}
