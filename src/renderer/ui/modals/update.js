import { state } from '../../state.js';
import { openModal, closeModal } from './base.js';
import { showInfoModal } from './info.js';
import { renderGames, updateHomeStats } from '../games.js';
import { runStreamlineInstall } from './streamline.js';
import { t } from '../../i18n/i18n.js';

const manageGameCover = document.getElementById('update-game-cover');
const manageGamePlaceholder = document.getElementById('update-game-placeholder');
const manageGameName = document.getElementById('update-game-name');

const manageDlssSection = document.getElementById('update-dlss-section');
const manageDlssVersionBadge = document.getElementById('update-dlss-version-badge');
const manageDlssVersionSelect = document.getElementById('update-dlss-version-select');
const manageChangeDlssBtn = document.getElementById('update-change-dlss-btn');
const manageRestoreDlssBtn = document.getElementById('update-restore-dlss-btn');

const manageStreamlineSection = document.getElementById('update-streamline-section');
const manageSlVersionBadge = document.getElementById('update-sl-version-badge');
const manageSlVersionSelect = document.getElementById('update-sl-version-select');
const manageChangeSlBtn = document.getElementById('update-change-sl-btn');
const manageRestoreSlBtn = document.getElementById('update-restore-sl-btn');

const manageOptiSection = document.getElementById('update-opti-section');
const manageOptiVersionBadge = document.getElementById('update-opti-version-badge');
const manageRestoreOptiBtn = document.getElementById('update-restore-opti-btn');

const manageNoModsSection = document.getElementById('update-no-mods-section');

export async function openUpdateModal(game) {
    state.currentSelectedGame = game;
    manageGameName.textContent = game.name;
    
    if (game.cover) {
        manageGameCover.src = game.cover;
        manageGameCover.style.display = 'block';
        manageGamePlaceholder.style.display = 'none';
    } else {
        manageGameCover.style.display = 'none';
        manageGamePlaceholder.style.display = 'flex';
    }
    
    let hasActiveMod = false;
    
    // 1. Render DLSS Enabler manage section if active
    if (game.hasDlssEnabler) {
        hasActiveMod = true;
        manageDlssVersionBadge.textContent = `${t('update.version')} ${game.dlssEnablerVersion || t('update.unknown')}`;
        manageDlssSection.style.display = 'block';
        
        // Populate versions in change dropdown
        manageDlssVersionSelect.innerHTML = `<option value="" disabled selected>${t('update.loadingVersions')}</option>`;
        try {
            const versions = await window.electronAPI.getDlssVersions();
            manageDlssVersionSelect.innerHTML = '';
            versions.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = v;
                if (v === game.dlssEnablerVersion) {
                    opt.selected = true;
                }
                manageDlssVersionSelect.appendChild(opt);
            });
        } catch(e) {}
    } else {
        manageDlssSection.style.display = 'none';
    }

    // 2. Render Streamline manage section if active
    if (game.hasStreamline) {
        hasActiveMod = true;
        manageSlVersionBadge.textContent = `${t('update.version')} ${game.streamlineVersion || t('update.unknown')}`;
        manageStreamlineSection.style.display = 'block';
        
        // Populate versions in change dropdown
        manageSlVersionSelect.innerHTML = `<option value="" disabled selected>${t('update.loadingVersions')}</option>`;
        try {
            const versions = await window.electronAPI.getStreamlineVersions();
            manageSlVersionSelect.innerHTML = '';
            versions.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = v;
                if (v === game.streamlineVersion) {
                    opt.selected = true;
                }
                manageSlVersionSelect.appendChild(opt);
            });
        } catch(e) {}
    } else {
        manageStreamlineSection.style.display = 'none';
    }

    // 3. Render OptiScaler manage section if active
    if (game.hasOptiscaler) {
        hasActiveMod = true;
        manageOptiVersionBadge.textContent = `${t('update.version')} ${game.optiscalerVersion || t('update.unknown')}`;
        manageOptiSection.style.display = 'block';
    } else {
        manageOptiSection.style.display = 'none';
    }
    
    // Handle empty state
    if (hasActiveMod) {
        manageNoModsSection.style.display = 'none';
    } else {
        manageNoModsSection.style.display = 'block';
    }
    
    openModal('update-modal');
}

export function initUpdateListeners() {
    // Change DLSS Enabler Version
    if (manageChangeDlssBtn) {
        manageChangeDlssBtn.addEventListener('click', async () => {
            const version = manageDlssVersionSelect.value;
            if (!version) {
                showInfoModal(t('update.errorTitle'), t('update.changeDlssSelectError'), true);
                return;
            }
            if (version === state.currentSelectedGame.dlssEnablerVersion) {
                showInfoModal(t('update.infoTitle'), t('update.changeDlssSameVersion'));
                return;
            }
            
            closeModal('update-modal');
            showInfoModal(t('update.changeDlssTitle'), t('update.changeDlssMsg'));
            
            try {
                let result;
                if (state.currentSelectedGame.source === 'manual') {
                    result = await window.electronAPI.executeDlssInstall({
                        game: state.currentSelectedGame,
                        exePath: state.currentSelectedGame.exePath,
                        version: version
                    });
                } else {
                    result = await window.electronAPI.autoInstallDlss({
                        game: state.currentSelectedGame,
                        version: version
                    });
                }
                
                closeModal('info-modal');
                if (result.success) {
                    showInfoModal(t('update.successTitle'), `🎉 ${t('update.changeDlssSuccess')} ${version}!`);
                    if (result.games) {
                        renderGames(result.games);
                        updateHomeStats();
                    }
                } else {
                    showInfoModal(t('update.errorTitle'), t('update.changeDlssError') + result.error, true);
                }
            } catch (e) {
                closeModal('info-modal');
                showInfoModal(t('update.errorTitle'), t('update.changeDlssUnexpected') + e.message, true);
            }
        });
    }

    // Restore DLSS Enabler
    if (manageRestoreDlssBtn) {
        manageRestoreDlssBtn.addEventListener('click', async () => {
            closeModal('update-modal');
            showInfoModal(t('update.removeDlssTitle'), t('update.removeDlssMsg'));
            
            try {
                const result = await window.electronAPI.uninstallMod({
                    gameName: state.currentSelectedGame.name,
                    exePath: state.currentSelectedGame.exePath,
                    mod: 'DLSS Enabler'
                });
                
                closeModal('info-modal');
                
                const notFound = result.notFound || 0;
                const deleted = result.deleted || [];
                
                if (deleted.length > 0) {
                    let msg = `✅ ${t('update.removeDlssSuccess')}\n\n${t('update.removeDlssDeleted')} (${deleted.length}):\n` + deleted.map(f => `• ${f}`).join('\n');
                    if (notFound > 0) {
                        msg += `\n\n${t('update.removeDlssNotFound')} (${notFound})`;
                    }
                    showInfoModal(t('update.successTitle'), msg);
                } else {
                    showInfoModal(t('update.infoTitle'), t('update.removeDlssNone'), true);
                }
                
                if (result.games) {
                    renderGames(result.games);
                    updateHomeStats();
                }
            } catch (e) {
                closeModal('info-modal');
                showInfoModal(t('update.errorTitle'), t('update.removeDlssUnexpected') + e.message, true);
            }
        });
    }

    // Change Streamline Version
    if (manageChangeSlBtn) {
        manageChangeSlBtn.addEventListener('click', async () => {
            const version = manageSlVersionSelect.value;
            if (!version) {
                showInfoModal(t('update.errorTitle'), t('update.changeSlSelectError'), true);
                return;
            }
            if (version === state.currentSelectedGame.streamlineVersion) {
                showInfoModal(t('update.infoTitle'), t('update.changeSlSameVersion'));
                return;
            }

            // Rule: Prevent Streamline update if original version < 2.0
            showInfoModal(t('update.checkingTitle'), t('update.checkingMsg'));
            try {
                const isAuto = state.currentSelectedGame.source !== 'manual';
                const check = await window.electronAPI.checkStreamlineBackup({
                    game: state.currentSelectedGame,
                    isAuto: false,
                    manualExePath: null
                });
                
                if (!check.success) {
                    closeModal('info-modal');
                    showInfoModal(t('update.errorTitle'), check.error, true);
                    return;
                }

                const originalVersion = (check.backupExists && check.backupVersion && check.backupVersion !== '0.0.0.0') 
                    ? check.backupVersion 
                    : check.currentVersion;

                if (originalVersion && originalVersion !== '0.0.0.0') {
                    const compare = await window.electronAPI.compareVersions(originalVersion, '2.0.0.0');
                    if (compare < 0) {
                        closeModal('update-modal');
                        closeModal('info-modal');
                        showInfoModal(t('update.slVersionWarningTitle'), `${t('update.slVersionWarningMsg')} (${originalVersion})`, true);
                        return;
                    }
                }
                
                closeModal('update-modal');
                closeModal('info-modal');
                
                setTimeout(async () => {
                    await runStreamlineInstall(state.currentSelectedGame, version, check.targetDir, false, true);
                }, 100);
            } catch(e) {
                closeModal('info-modal');
                showInfoModal(t('update.errorTitle'), t('update.checkError') + e.message, true);
            }
        });
    }

    // Restore Streamline
    if (manageRestoreSlBtn) {
        manageRestoreSlBtn.addEventListener('click', async () => {
            closeModal('update-modal');
            showInfoModal(t('update.restoreSlTitle'), t('update.restoreSlMsg'));
            
            try {
                const result = await window.electronAPI.restoreStreamline({
                    gameName: state.currentSelectedGame.name
                });
                
                closeModal('info-modal');
                if (result.success) {
                    showInfoModal(t('update.successTitle'), t('update.restoreSlSuccess'));
                    if (result.games) {
                        renderGames(result.games);
                        updateHomeStats();
                    }
                } else {
                    showInfoModal(t('update.errorTitle'), result.error, true);
                }
            } catch(e) {
                closeModal('info-modal');
                showInfoModal(t('update.errorTitle'), t('update.restoreSlUnexpected') + e.message, true);
            }
        });
    }

    // Restore OptiScaler
    if (manageRestoreOptiBtn) {
        manageRestoreOptiBtn.addEventListener('click', async () => {
            closeModal('update-modal');
            showInfoModal(t('update.removeOptiTitle'), t('update.removeOptiMsg'));
            
            try {
                const result = await window.electronAPI.uninstallMod({
                    gameName: state.currentSelectedGame.name,
                    exePath: state.currentSelectedGame.exePath,
                    mod: 'Optiscaler'
                });
                
                closeModal('info-modal');
                
                if (result.success) {
                    showInfoModal(t('update.successTitle'), t('update.removeOptiSuccess'));
                    if (result.games) {
                        renderGames(result.games);
                        updateHomeStats();
                    }
                } else {
                    showInfoModal(t('update.errorTitle'), t('update.removeOptiError') + result.error, true);
                }
            } catch (e) {
                closeModal('info-modal');
                showInfoModal(t('update.errorTitle'), t('update.removeOptiUnexpected') + e.message, true);
            }
        });
    }
}
