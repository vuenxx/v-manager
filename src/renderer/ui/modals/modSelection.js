import { openDlssModal } from './dlss.js';
import { openOptiModal } from './opti.js';
import { openStreamlineModal } from './streamline.js';
import { closeModal } from './base.js';

export function initModSelectionListeners() {
    document.querySelectorAll('.mod-option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mod = btn.getAttribute('data-mod');
            closeModal('mod-modal');
            
            if (mod === 'DLSS Enabler') {
                openDlssModal();
            } else if (mod === 'Optiscaler') {
                openOptiModal();
            } else if (mod === 'Streamline') {
                openStreamlineModal();
            }
        });
    });
}
