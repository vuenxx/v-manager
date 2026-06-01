import { closeModal } from './base.js';

export function showInfoModal(title, message, isError = false) {
    const infoModal = document.getElementById('info-modal');
    const infoModalTitle = document.getElementById('info-modal-title');
    const infoModalMessage = document.getElementById('info-modal-message');
    
    if (!infoModal || !infoModalTitle || !infoModalMessage) return;

    infoModalTitle.textContent = title;
    infoModalTitle.style.color = isError ? '#ef4444' : 'var(--accent-color)';
    infoModalMessage.textContent = message;
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
