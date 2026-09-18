import { openModal, closeModal } from './base.js';
import { appendModuleLog } from './moduleLogView.js';
import { t } from '../../i18n/i18n.js';

/**
 * @param {string} title
 * @param {string} message
 * @param {boolean} [isError]
 * @param {Object} [options]
 * @param {Array}  [options.log]         moduleEngine `result.log` — iki dilli kurulum günlüğü
 * @param {Object} [options.logSummary]  `result.logSummary`
 * @param {string} [options.logFile]     `result.logFile`
 */
export function showInfoModal(title, message, isError = false, options = {}) {
    const infoModal = document.getElementById('info-modal');
    const infoModalTitle = document.getElementById('info-modal-title');
    const infoModalMessage = document.getElementById('info-modal-message');
    const infoModalOkBtn = document.getElementById('info-modal-ok-btn');
    
    if (!infoModal || !infoModalTitle || !infoModalMessage) return;

    // Reset custom buttons and state to prevent leakage from unsaved changes dialog
    const existingExtra = infoModal.querySelector('.unsaved-extra-btn');
    if (existingExtra) existingExtra.remove();

    // Önceki çağrıdan kalan günlük bloğunu temizle
    const staleLog = infoModal.querySelector('.module-log-details');
    if (staleLog) (staleLog.parentElement || staleLog).remove();

    if (infoModalOkBtn) {
        infoModalOkBtn.textContent = t('info.okBtn') || 'Tamam';
        infoModalOkBtn.style.backgroundColor = '';
        infoModalOkBtn.style.color = '';
        infoModalOkBtn.onclick = null; // Clear the temporary onclick handler
    }

    infoModalTitle.textContent = title;
    if (isError === 'warning') {
        infoModalTitle.style.color = '#eab308';
    } else {
        infoModalTitle.style.color = isError ? '#ef4444' : 'var(--accent-color)';
    }
    infoModalMessage.textContent = message;

    // Kurulum/kaldırma günlüğü verildiyse mesajın altına katlanabilir blok ekle
    if (options && Array.isArray(options.log) && options.log.length > 0) {
        const host = document.createElement('div');
        // Mesaj paragrafının hemen ardına yerleştir — buton grubunun altına değil
        infoModalMessage.insertAdjacentElement('afterend', host);
        appendModuleLog(host, options.log, {
            summary: options.logSummary,
            logFile: options.logFile
        });
        // Günlük yoksa boş kapsayıcı kalmasın
        if (!host.firstChild) host.remove();
    }

    infoModal.classList.add('active');
    infoModal.style.zIndex = '9999';
}

export function initInfoModal() {
    const infoModalOkBtn = document.getElementById('info-modal-ok-btn');
    if (infoModalOkBtn) {
        infoModalOkBtn.addEventListener('click', () => {
            closeModal('info-modal');
        });
    }
}

export function showLauncherWarningModal(onConfirm) {
    const infoModal = document.getElementById('info-modal');
    const infoTitle = document.getElementById('info-modal-title');
    const infoBody = document.getElementById('info-modal-message');
    const infoClose = document.getElementById('info-modal-ok-btn');
    const infoProgress = document.getElementById('info-modal-progress');

    if (!infoModal || !infoTitle || !infoBody) {
        onConfirm();
        return;
    }

    if (infoProgress) infoProgress.style.display = 'none';

    infoTitle.textContent = t('manualAdd.warningTitle') || 'Önemli Uyarı';
    infoTitle.style.color = 'var(--accent-color)';
    infoBody.innerHTML = `<strong>${t('manualAdd.warningMessage')}</strong><br><br>${t('manualAdd.warningDetail')}`;

    // Clean up existing extra buttons
    const existingExtra = infoModal.querySelector('.unsaved-extra-btn');
    if (existingExtra) existingExtra.remove();

    // Cancel Button (Red styled)
    if (infoClose) {
        infoClose.textContent = t('manualAdd.cancelBtn') || 'İptal';
        infoClose.style.backgroundColor = '#ef4444';
        infoClose.style.color = '#ffffff';
        infoClose.onclick = () => {
            closeModal('info-modal');
        };
    }

    // Confirm Button
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'unsaved-extra-btn';
    confirmBtn.textContent = t('manualAdd.confirmSelectBtn') || 'Anladım, Dosya Seç';
    confirmBtn.style.cssText = 'background:var(--accent-color);border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-size:14px;margin-left:10px;font-weight:bold;';
    
    // Theme-specific contrast color for the text of confirm button
    const isDark = document.body.getAttribute('data-theme') === 'dark' || document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
        confirmBtn.style.color = '#000000';
    } else {
        confirmBtn.style.color = '#ffffff';
    }

    confirmBtn.onclick = () => {
        closeModal('info-modal');
        onConfirm();
    };

    const btnRow = infoClose?.parentElement;
    if (btnRow) btnRow.appendChild(confirmBtn);

    infoModal.classList.add('active');
    infoModal.style.zIndex = '9999';
}

export function showConfirmDialog(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('general-confirm-modal');
        const titleEl = document.getElementById('general-confirm-title');
        const messageEl = document.getElementById('general-confirm-message');
        const yesBtn = document.getElementById('general-confirm-yes-btn');
        const noBtn = document.getElementById('general-confirm-no-btn');
        const closeBtn = modal?.querySelector('.close-modal');

        if (!modal || !titleEl || !messageEl || !yesBtn || !noBtn) {
            resolve(false);
            return;
        }

        titleEl.textContent = title;
        messageEl.textContent = message;

        yesBtn.textContent = t('dlss.yesBtn') || 'Evet';
        noBtn.textContent = t('dlss.noBtn') || 'Hayır';

        // Apply contrast text color based on the current theme
        const isDark = document.body.getAttribute('data-theme') === 'dark' || document.documentElement.getAttribute('data-theme') === 'dark';
        yesBtn.style.color = isDark ? '#000000' : '#ffffff';

        let active = false;
        setTimeout(() => { active = true; }, 300);

        const cleanUp = () => {
            yesBtn.onclick = null;
            noBtn.onclick = null;
            if (closeBtn) closeBtn.onclick = null;
        };

        yesBtn.onclick = () => {
            if (!active) return;
            cleanUp();
            closeModal('general-confirm-modal');
            resolve(true);
        };

        noBtn.onclick = () => {
            if (!active) return;
            cleanUp();
            closeModal('general-confirm-modal');
            resolve(false);
        };

        if (closeBtn) {
            closeBtn.onclick = () => {
                if (!active) return;
                cleanUp();
                closeModal('general-confirm-modal');
                resolve(false);
            };
        }

        openModal('general-confirm-modal');
    });
}
