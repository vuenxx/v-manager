// Guard callback: settings.js bunu override eder
let _settingsCloseGuard = null;
export function setSettingsCloseGuard(fn) { _settingsCloseGuard = fn; }

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
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-target');
            closeModal(target);
        });
    });

    const modModal = document.getElementById('mod-modal');
    const dlssModal = document.getElementById('dlss-modal');
    const streamlineModal = document.getElementById('streamline-modal');
    const streamlineVersionsModal = document.getElementById('streamline-versions-modal');
    const optiscalerModal = document.getElementById('optiscaler-modal');
    const confirmModal = document.getElementById('confirm-modal');
    const manageModal = document.getElementById('manage-modal');
    const optiscalerVersionsModal = document.getElementById('optiscaler-versions-modal');
    const optipatcherVersionsModal = document.getElementById('optipatcher-versions-modal');
    const fsr4VersionsModal = document.getElementById('fsr4-versions-modal');
    const uninstallModal = document.getElementById('uninstall-modal');
    const dlssConfirmModal = document.getElementById('dlss-confirm-modal');
    const infoModal = document.getElementById('info-modal');
    const uninstallConfirmModal = document.getElementById('uninstall-confirm-modal');
    const refreshConfirmModal = document.getElementById('refresh-confirm-modal');
    const scanProgressModal = document.getElementById('scan-progress-modal');
    const manualAddModal = document.getElementById('manual-add-modal');

    const settingsModal = document.getElementById('settings-modal');

    window.addEventListener('click', (e) => {
        if (e.target === modModal) closeModal('mod-modal');
        if (e.target === dlssModal) closeModal('dlss-modal');
        if (e.target === streamlineModal) closeModal('streamline-modal');
        if (e.target === streamlineVersionsModal) closeModal('streamline-versions-modal');
        if (e.target === optiscalerModal) closeModal('optiscaler-modal');
        if (e.target === confirmModal) closeModal('confirm-modal');
        if (e.target === manageModal) closeModal('manage-modal');
        if (e.target === optiscalerVersionsModal) closeModal('optiscaler-versions-modal');
        if (e.target === optipatcherVersionsModal) closeModal('optipatcher-versions-modal');
        if (e.target === fsr4VersionsModal) closeModal('fsr4-versions-modal');
        if (e.target === uninstallModal) closeModal('uninstall-modal');
        if (e.target === dlssConfirmModal) closeModal('dlss-confirm-modal');
        if (e.target === infoModal) closeModal('info-modal');
        if (e.target === uninstallConfirmModal) closeModal('uninstall-confirm-modal');
        if (e.target === refreshConfirmModal) closeModal('refresh-confirm-modal');
        if (e.target === scanProgressModal) closeModal('scan-progress-modal');
        if (e.target === manualAddModal) closeModal('manual-add-modal');
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
};
