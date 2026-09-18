import { t } from '../../i18n/i18n.js';
import { openModal, closeModal, showNotification } from './base.js';

let activeScanId = null;

export function selectExeWithPicker(gameName, gameRoot) {
    return new Promise(async (resolve) => {
        // Step 1: If gameRoot is missing, prompt folder selection first
        if (!gameRoot) {
            try {
                const selectedFolder = await window.electronAPI.selectFolder();
                if (!selectedFolder) {
                    return resolve(null); // User cancelled folder selection
                }
                gameRoot = selectedFolder;
            } catch (err) {
                console.error('[EXE-PICKER] Folder selection error:', err);
                return resolve(null);
            }
        }

        // Get DOM Elements
        const modal = document.getElementById('exe-picker-modal');
        const scanningEl = document.getElementById('exe-picker-scanning');
        const listContainer = document.getElementById('exe-picker-list-container');
        const listEl = document.getElementById('exe-picker-list');
        const emptyStateEl = document.getElementById('exe-picker-empty-state');
        const manualBtn = document.getElementById('exe-picker-manual-btn');
        const confirmEl = document.getElementById('exe-picker-confirm');
        const confirmNoBtn = document.getElementById('exe-picker-confirm-no');
        const confirmYesBtn = document.getElementById('exe-picker-confirm-yes');

        if (!modal || !scanningEl || !listContainer || !listEl || !emptyStateEl || !confirmEl) {
            console.error('[EXE-PICKER] Required DOM elements missing!');
            return resolve(null);
        }

        // Translate modal texts dynamically
        document.getElementById('exe-picker-title').textContent = t('exePicker.title');
        document.getElementById('exe-picker-scan-msg').textContent = t('exePicker.scanning');
        const descParagraph = listContainer.querySelector('p');
        if (descParagraph) descParagraph.textContent = t('exePicker.desc');
        emptyStateEl.textContent = t('exePicker.emptyState');
        if (manualBtn) manualBtn.textContent = t('exePicker.manualBtn');
        document.getElementById('exe-picker-confirm-msg').textContent = t('exePicker.warning');
        if (confirmNoBtn) confirmNoBtn.textContent = t('info.noBtn');
        if (confirmYesBtn) confirmYesBtn.textContent = t('info.yesBtn');

        // Reset elements state
        scanningEl.style.display = 'block';
        listContainer.style.display = 'none';
        confirmEl.style.display = 'none';
        listEl.innerHTML = '';
        emptyStateEl.style.display = 'none';
        if (manualBtn) manualBtn.parentElement.style.display = 'block';

        let selectedExe = null;
        const currentScanId = Math.random();
        activeScanId = currentScanId;

        // MutationObserver to detect user closing the modal (click-outside, escape, etc.)
        let isResolved = false;
        const observer = new MutationObserver(() => {
            if (!modal.classList.contains('active') && !isResolved) {
                cleanup();
                resolve(null);
            }
        });
        observer.observe(modal, { attributes: true, attributeFilter: ['class'] });

        const cleanup = () => {
            isResolved = true;
            observer.disconnect();
            // Remove event listeners
            confirmYesBtn?.replaceWith(confirmYesBtn.cloneNode(true));
            confirmNoBtn?.replaceWith(confirmNoBtn.cloneNode(true));
            manualBtn?.replaceWith(manualBtn.cloneNode(true));
        };

        // Open modal
        openModal('exe-picker-modal');

        // Start scanning game files
        try {
            console.log(`[EXE-PICKER] Scanning game root: ${gameRoot}`);
            const exes = await window.electronAPI.scanFolderForExes(gameRoot);
            
            // Check if this scan is still active (modal not closed or reopened)
            if (activeScanId !== currentScanId || isResolved) {
                return;
            }

            scanningEl.style.display = 'none';
            listContainer.style.display = 'block';

            if (!exes || exes.length === 0) {
                emptyStateEl.style.display = 'block';
                listEl.style.display = 'none';
            } else {
                emptyStateEl.style.display = 'none';
                listEl.style.display = 'block';

                exes.forEach(exePath => {
                    const item = document.createElement('div');
                    item.className = 'exe-picker-item';
                    
                    // Simple path formatting
                    const basename = exePath.substring(Math.max(exePath.lastIndexOf('\\'), exePath.lastIndexOf('/')) + 1);
                    
                    item.innerHTML = `
                        <span style="font-size: 16px;">🎮</span>
                        <span class="exe-name" style="font-size: 13px; font-weight: 500; word-break: break-all; color: var(--text-primary);">${basename}</span>
                    `;

                    item.addEventListener('click', () => {
                        // Highlight selected
                        listEl.querySelectorAll('.exe-picker-item').forEach(el => el.classList.remove('selected'));
                        item.classList.add('selected');
                        
                        selectedExe = exePath;
                        confirmEl.style.display = 'block';
                        if (manualBtn) manualBtn.parentElement.style.display = 'none';
                    });

                    listEl.appendChild(item);
                });
            }
        } catch (err) {
            console.error('[EXE-PICKER] Scan error:', err);
            if (activeScanId === currentScanId && !isResolved) {
                scanningEl.style.display = 'none';
                listContainer.style.display = 'block';
                emptyStateEl.style.display = 'block';
            }
        }

        // Setup confirm listeners
        const updatedConfirmYesBtn = document.getElementById('exe-picker-confirm-yes');
        const updatedConfirmNoBtn = document.getElementById('exe-picker-confirm-no');
        const updatedManualBtn = document.getElementById('exe-picker-manual-btn');

        updatedConfirmYesBtn?.addEventListener('click', async () => {
            if (!selectedExe) return;
            const chosenExe = selectedExe;

            cleanup();
            closeModal('exe-picker-modal');

            // Save to user path config
            try {
                const guessedRoot = chosenExe.substring(0, Math.max(chosenExe.lastIndexOf('\\'), chosenExe.lastIndexOf('/')));
                await window.electronAPI.saveUserGame({
                    gameName: gameName,
                    gameRoot: guessedRoot,
                    exePath: chosenExe
                });
                
                // Show bottom-right notification toast
                showNotification(t('exePicker.successToastTitle'), t('exePicker.successToastMsg'));
            } catch (err) {
                console.error('[EXE-PICKER] Failed to save user game:', err);
            }

            resolve(chosenExe);
        });

        updatedConfirmNoBtn?.addEventListener('click', () => {
            confirmEl.style.display = 'none';
            listEl.querySelectorAll('.exe-picker-item').forEach(el => el.classList.remove('selected'));
            selectedExe = null;
            if (manualBtn) manualBtn.parentElement.style.display = 'block';
        });

        // Fallback Manual Selection
        updatedManualBtn?.addEventListener('click', async () => {
            // Temporarily pause class observer so the dialog open doesn't cancel
            observer.disconnect();

            try {
                const manualSelected = await window.electronAPI.selectExe();
                if (!manualSelected) {
                    // Re-connect observer if user cancelled
                    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
                    return; 
                }

                selectedExe = manualSelected;
                confirmEl.style.display = 'block';
            } catch (err) {
                console.error('[EXE-PICKER] Manual exe selection error:', err);
            }

            // Re-connect observer
            observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
        });
    });
}
