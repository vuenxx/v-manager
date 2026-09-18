// Guard callback: settings.js bunu override eder
let _settingsCloseGuard = null;
export function setSettingsCloseGuard(fn) { _settingsCloseGuard = fn; }

let _manualAddCloseGuard = null;
export function setManualAddCloseGuard(fn) { _manualAddCloseGuard = fn; }

export function closeModal(modalId) {
    if (modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            modal.style.zIndex = '';
        }
        // Floating kaydet butonunu settings-modal kapanınca gizle
        if (modalId === 'settings-modal') {
            const saveBtn = document.getElementById('settings-save-btn');
            if (saveBtn) saveBtn.style.display = 'none';
        }
    } else {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            modal.classList.remove('active');
            modal.style.zIndex = '';
        });
        // Tüm modaller kapanırsa floating butonu da gizle
        const saveBtn = document.getElementById('settings-save-btn');
        if (saveBtn) saveBtn.style.display = 'none';
    }
}

export function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        
        // Dynamic z-index for stacked modals
        const activeModals = document.querySelectorAll('.modal.active');
        modal.style.zIndex = (1000 + activeModals.length * 10).toString();
        
        // Focus input if it's the manual add modal
        if (modalId === 'manual-add-modal') {
            const input = document.getElementById('manual-game-name-input');
            if (input) {
                setTimeout(() => {
                    input.focus();
                    input.select();
                }, 100);
            }
        }
    }
}

export function initBaseModals() {
    const closeModalBtns = document.querySelectorAll('.close-modal');
    closeModalBtns.forEach(btn => {
        const target = btn.getAttribute('data-target');
        if (target === 'settings-modal' || target === 'manual-add-modal') return;

        btn.addEventListener('click', () => {
            closeModal(target);
        });
    });

    const modModal = document.getElementById('mod-modal');
    const dlssModal = document.getElementById('dlss-modal');
    const streamlineModal = document.getElementById('streamline-modal');
    const optiscalerModal = document.getElementById('optiscaler-modal');
    const confirmModal = document.getElementById('confirm-modal');
    const manageModal = document.getElementById('manage-modal');
    const uninstallModal = document.getElementById('uninstall-modal');
    const dlssConfirmModal = document.getElementById('dlss-confirm-modal');
    const infoModal = document.getElementById('info-modal');
    const exePickerModal = document.getElementById('exe-picker-modal');
    const uninstallConfirmModal = document.getElementById('uninstall-confirm-modal');
    const refreshConfirmModal = document.getElementById('refresh-confirm-modal');
    const scanProgressModal = document.getElementById('scan-progress-modal');
    const manualAddModal = document.getElementById('manual-add-modal');

    const settingsModal = document.getElementById('settings-modal');
    const vlss5Modal = document.getElementById('vlss5-modal');

    window.addEventListener('click', (e) => {
        if (e.target === modModal) closeModal('mod-modal');
        if (e.target === vlss5Modal) closeModal('vlss5-modal');
        if (e.target === dlssModal) closeModal('dlss-modal');
        if (e.target === streamlineModal) closeModal('streamline-modal');
        if (e.target === optiscalerModal) closeModal('optiscaler-modal');
        if (e.target === confirmModal) closeModal('confirm-modal');
        if (e.target === manageModal) closeModal('manage-modal');
        if (e.target === uninstallModal) closeModal('uninstall-modal');
        if (e.target === dlssConfirmModal) closeModal('dlss-confirm-modal');
        if (e.target === infoModal) closeModal('info-modal');
        if (e.target === exePickerModal) closeModal('exe-picker-modal');
        if (e.target === uninstallConfirmModal) closeModal('uninstall-confirm-modal');
        if (e.target === refreshConfirmModal) closeModal('refresh-confirm-modal');
        if (e.target === scanProgressModal) closeModal('scan-progress-modal');
        if (e.target === manualAddModal) {
            if (_manualAddCloseGuard) {
                _manualAddCloseGuard();
            } else {
                closeModal('manual-add-modal');
            }
        }
        // settings-modal: guard üzerinden geç
        if (e.target === settingsModal) {
            if (_settingsCloseGuard) {
                _settingsCloseGuard();
            } else {
                closeModal('settings-modal');
            }
        }
    });

    // settings-modal X butonu: guard üzerinden geç
    const settingsCloseBtn = settingsModal ? settingsModal.querySelector('.modal-close') : null;
    if (settingsCloseBtn) {
        // base.js'in genel close-modal listener'ını bu butona uygulamayı engelle
        settingsCloseBtn.removeAttribute('data-target');
        settingsCloseBtn.addEventListener('click', () => {
            if (_settingsCloseGuard) {
                _settingsCloseGuard();
            } else {
                closeModal('settings-modal');
            }
        });
    }

    // manual-add-modal X butonu: guard üzerinden geç
    const manualAddCloseBtn = manualAddModal ? manualAddModal.querySelector('.close-modal') : null;
    if (manualAddCloseBtn) {
        manualAddCloseBtn.addEventListener('click', () => {
            if (_manualAddCloseGuard) {
                _manualAddCloseGuard();
            } else {
                closeModal('manual-add-modal');
            }
        });
    }
};

export function showNotification(title, message, duration = 5000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.style.pointerEvents = 'auto';

    toast.innerHTML = `
        <div class="toast-header">
            <span class="toast-title">
                🔔 ${title}
            </span>
            <button class="toast-close">&times;</button>
        </div>
        <div class="toast-body">
            ${message}
        </div>
    `;

    container.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 50);

    let dismissTimeout = setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, duration);

    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            clearTimeout(dismissTimeout);
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        });
    }
}
