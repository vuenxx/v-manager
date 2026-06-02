import { state } from '../state.js';
import { openModal, closeModal } from './modals/base.js';
import { showConfirmModal } from './blacklist.js';
import { openUpdateModal } from './modals/update.js';
import { openSettingsModal } from './modals/settings.js';
import { showInfoModal } from './modals/info.js';
import { t } from '../i18n/i18n.js';

// Get elements helper to ensure they exist before use
const getGamesContainer = () => document.getElementById('games-container');
const getLoadingEl = () => document.getElementById('loading-games');
const getAddGameBtn = () => document.getElementById('add-game-btn');

export function createGameCard(game) {
    const card = document.createElement('div');
    card.className = 'game-cover-card';
    card.title = game.exePath;

    let coverHtml = '';
    if (game.cover) {
        coverHtml = `<img src="${game.cover}" alt="${game.name}" class="game-cover-img">`;
    } else {
        coverHtml = `<div class="game-cover-placeholder">🎮</div>`;
    }

    let modTagsHtml = '';
    let currentBottom = 10;

    if (game.hasDlssEnabler) {
        const dlssVerText = game.dlssEnablerVersion ? ` v${game.dlssEnablerVersion}` : '';
        modTagsHtml += `<div class="dlss-tag" style="bottom: ${currentBottom}px;">DLSS Enabler${dlssVerText}</div>`;
        currentBottom += 34;
    }
    if (game.hasOptiscaler) {
        const optiVerText = game.optiscalerVersion ? ` ${game.optiscalerVersion}` : '';
        modTagsHtml += `<div class="dlss-tag" style="background: rgba(245,158,11,0.92); border: 1px solid rgba(245,158,11,0.5); box-shadow: 0 0 10px rgba(245,158,11,0.3); bottom: ${currentBottom}px;">OptiScaler${optiVerText}</div>`;
        currentBottom += 34;
    }
    if (game.hasStreamline) {
        const slVerText = game.streamlineVersion ? ` v${game.streamlineVersion}` : '';
        modTagsHtml += `<div class="dlss-tag" style="background: rgba(147, 51, 234, 0.95); border: 1px solid rgba(147, 51, 234, 0.4); box-shadow: 0 0 10px rgba(147, 51, 234, 0.3); bottom: ${currentBottom}px;">Streamline${slVerText}</div>`;
        currentBottom += 34;
    }

    // Upscaler tags
    let upscalerHtml = '';
    if (game.upscalers) {
        upscalerHtml = '<div class="upscaler-tags">';
        if (game.upscalers.dlss) upscalerHtml += '<span class="utag utag-dlss">DLSS</span>';
        if (game.upscalers.xess) upscalerHtml += '<span class="utag utag-xess">XeSS</span>';
        if (game.upscalers.fsr) upscalerHtml += '<span class="utag utag-fsr">FSR</span>';
        upscalerHtml += '</div>';
    }

    // Define source label
    let sourceLabel = t('games.sourceManual');
    if (game.source === 'steam') sourceLabel = 'Steam';
    else if (game.source === 'epic') sourceLabel = 'Epic Games';
    else if (game.source === 'gog') sourceLabel = 'GOG';
    else if (game.source === 'ea') sourceLabel = 'EA Play';
    else if (game.source === 'ubisoft') sourceLabel = 'Ubisoft';
    else if (game.source === 'rockstar') sourceLabel = 'Rockstar';
    else if (game.source === 'xbox') sourceLabel = 'Xbox';
    else if (game.source === 'registry') sourceLabel = t('games.sourceRegistry');
    // 'manual' already handled as default above

    card.innerHTML = `
        <div class="game-cover-wrapper">
            <div class="source-tag">${sourceLabel}</div>
            ${coverHtml}
            ${modTagsHtml}
            <div class="game-cover-overlay">
                <div class="game-actions-wrapper">
                    <button class="mod-install-btn" data-game="${game.name}">${t('games.installMod')}</button>
                    ${(game.hasDlssEnabler || game.hasStreamline || game.hasOptiscaler) ? `<button class="mod-manage-btn" data-game="${game.name}">${t('games.manageMod')}</button>` : ''}
                    ${(game.hasDlssEnabler || game.hasOptiscaler) ? `<button class="mod-settings-btn" data-game="${game.name}">${t('games.modSettings')}</button>` : ''}
                </div>
                <button class="remove-game-btn" data-game="${game.name}">${t('games.removeGame')}</button>
            </div>
        </div>
        <div class="game-info">
            <button class="favorite-btn ${game.isFavorite ? 'active' : ''}" data-game="${game.name}">
                ${game.isFavorite ? '★' : '☆'}
            </button>
            <div class="game-title">${game.name}</div>
            ${upscalerHtml}
        </div>
    `;

    // Bind favorite button
    const favoriteBtn = card.querySelector('.favorite-btn');
    favoriteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (window.electronAPI && window.electronAPI.toggleFavorite) {
            const updatedGames = await window.electronAPI.toggleFavorite(game.name);
            renderGames(updatedGames);
        }
    });

    // Bind remove button
    const removeBtn = card.querySelector('.remove-game-btn');
    removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        showConfirmModal(game.name, card);
    });

    // Bind Mod Kur button
    const modBtn = card.querySelector('.mod-install-btn');
    modBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openModModal(game);
    });

    // Bind Güncelle button
    const manageBtn = card.querySelector('.mod-manage-btn');
    if (manageBtn) {
        manageBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openUpdateModal(game);
        });
    }

    // Bind Yönet (Settings) button
    const settingsBtn = card.querySelector('.mod-settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('[RENDERER games.js] "Modu Yönet" clicked for game:', JSON.stringify(game, null, 2));
            if (window.electronAPI && window.electronAPI.logToMain) {
                window.electronAPI.logToMain(`[RENDERER games.js] "Modu Yönet" clicked for game: ${game.name}`);
            }
            try {
                openSettingsModal(game);
            } catch (err) {
                console.error('[RENDERER games.js] Error in click event openSettingsModal:', err);
                if (window.electronAPI && window.electronAPI.logToMain) {
                    window.electronAPI.logToMain(`[RENDERER games.js] Error in click event openSettingsModal: ${err.stack || err.message}`);
                }
            }
        });
    }

    // Add verified compatibility badge if developer-supported
    const normKey = game.name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
        .replace(/\s+/g, '-');

    if (window.electronAPI && window.electronAPI.getDeveloperGames) {
        window.electronAPI.getDeveloperGames().then(devGames => {
            if (devGames && devGames[normKey]) {
                const devGameInfo = devGames[normKey];
                const compatibility = devGameInfo.compatibility || 'green';
                const tooltipText = compatibility === 'green'
                    ? t('settings.tooltipGreen')
                    : t('settings.tooltipYellow');

                const badgeContainer = document.createElement('div');
                badgeContainer.className = 'verified-badge-container';
                badgeContainer.innerHTML = `<img src="icons/verified_${compatibility}.png" class="verified-badge-icon" />`;

                // Hover events for tooltip
                badgeContainer.addEventListener('mouseenter', () => {
                    const tooltip = document.getElementById('global-tooltip');
                    if (tooltip) {
                        tooltip.textContent = tooltipText;
                        tooltip.style.display = 'block';

                        const rect = badgeContainer.getBoundingClientRect();
                        const tooltipRect = tooltip.getBoundingClientRect();

                        let top = rect.top - tooltipRect.height - 8;
                        let left = rect.left + (rect.width - tooltipRect.width) / 2;

                        if (left < 10) left = 10;
                        if (top < 10) top = rect.bottom + 8; // fallback below

                        tooltip.style.top = `${top}px`;
                        tooltip.style.left = `${left}px`;
                    }
                });

                badgeContainer.addEventListener('mouseleave', () => {
                    const tooltip = document.getElementById('global-tooltip');
                    if (tooltip) {
                        tooltip.style.display = 'none';
                    }
                });

                const coverWrapper = card.querySelector('.game-cover-wrapper');
                if (coverWrapper) {
                    coverWrapper.appendChild(badgeContainer);
                }
            }
        }).catch(err => {
            console.error("Error loading developer games inside card:", err);
        });
    }

    return card;
}

function openModModal(game) {
    state.currentSelectedGame = game;
    const modModalGameName = document.getElementById('mod-modal-game-name');
    if (modModalGameName) modModalGameName.textContent = game.name;
    openModal('mod-modal');
}

export function renderGames(games) {
    const container = getGamesContainer();
    const loading = getLoadingEl();
    if (!container) return;

    const searchInput = document.getElementById('game-search-input');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

    let filteredGames = games;
    if (query) {
        filteredGames = games.filter(game => game.name.toLowerCase().includes(query));
    }

    container.innerHTML = '';

    // FIX 1b: Check the loading element's real computed visibility, not just inline style
    // to prevent the "no games" message from flashing during scan startup
    const loadingVisible = loading && (loading.style.display !== 'none') && loading.style.display !== '';
    if (filteredGames.length === 0 && !loadingVisible) {
        if (query) {
            container.innerHTML = `<p style="color: var(--text-secondary); text-align: center; grid-column: 1 / -1;">${t('games.noGamesSearch')}</p>`;
        } else {
            container.innerHTML = `<p style="color: var(--text-secondary); text-align: center; grid-column: 1 / -1;">${t('games.noGames')}</p>`;
        }
        return;
    }

    // Apply sorting: Favorites ALWAYS first, then secondary sort
    const sortedGames = [...filteredGames].sort((a, b) => {
        // Priority 1: Favorites
        if (a.isFavorite && !b.isFavorite) return -1;
        if (!a.isFavorite && b.isFavorite) return 1;

        // Priority 2: Selected sort method
        if (state.gameSortMethod === 'source') {
            const sourceA = (a.source || '').toLowerCase();
            const sourceB = (b.source || '').toLowerCase();
            if (sourceA < sourceB) return -1;
            if (sourceA > sourceB) return 1;
            // FIX 1d: Tie-break with name sort when source is equal
        }

        // Default / tie-break: Name sort
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
    });

    sortedGames.forEach(game => {
        container.appendChild(createGameCard(game));
    });
}

export async function updateHomeStats() {
    if (!window.electronAPI) return;
    const games = await window.electronAPI.getGames();

    const dlssCount = games.filter(g => g.hasDlssEnabler).length;
    const optiCount = games.filter(g => g.hasOptiscaler).length;
    const totalCount = dlssCount + optiCount;

    const totalEl = document.getElementById('total-mods-count');
    if (totalEl) totalEl.textContent = totalCount;

    const dlssEl = document.getElementById('dlss-enabler-count');
    if (dlssEl) dlssEl.textContent = dlssCount;

    const optiEl = document.getElementById('optiscaler-count');
    if (optiEl) optiEl.textContent = optiCount;

    // Backward compatibility support for modded-games-count
    const oldEl = document.getElementById('modded-games-count');
    if (oldEl) {
        const uniqueModdedCount = games.filter(g => g.hasDlssEnabler || g.hasStreamline || g.hasOptiscaler).length;
        oldEl.textContent = uniqueModdedCount;
    }
}

export async function initGames() {
    try {
        const loading = getLoadingEl();
        const container = getGamesContainer();

        let games = await window.electronAPI.getGames();

        if (!games || games.length === 0) {
            if (loading) {
                loading.style.display = 'block';
                loading.textContent = t('games.scanningShort');
            }
            if (container) container.innerHTML = '';
            window.electronAPI.startScan();
        } else {
            renderGames(games);
            updateHomeStats();
        }
    } catch (e) {
        console.error("Init error:", e);
        const loading = getLoadingEl();
        if (loading) loading.style.display = 'none';
        renderGames([]);
    }
}

export function initGamesListeners() {
    // Handle Refresh Games — now opens scan-settings-modal
    const refreshGamesBtn = document.getElementById('refresh-games-btn');
    if (refreshGamesBtn) {
        refreshGamesBtn.addEventListener('click', () => {
            if (state.isScanning) {
                // Tarama zaten devam ediyorsa direkt progress modal'ı aç
                openModal('scan-progress-modal');
                return;
            }
            openScanSettingsModal();
        });
    }

    // Render custom folders list inside scan settings modal
    async function renderCustomFoldersList() {
        const listEl = document.getElementById('scan-custom-folders-list');
        if (!listEl) return;
        listEl.innerHTML = '';

        try {
            const folders = await window.electronAPI.getCustomFolders();
            if (folders.length === 0) {
                listEl.innerHTML = `<div style="color: var(--text-secondary); font-size: 13px; text-align: center; padding: 10px;">${t('scan.noFolders')}</div>`;
                return;
            }

            folders.forEach((folder, idx) => {
                const row = document.createElement('div');
                row.className = 'scan-item-row';
                row.style.padding = '4px 0';
                row.innerHTML = `
                    <div style="flex: 1; min-width: 0; padding-right: 10px;">
                        <div class="scan-item-name" style="font-size: 13px; font-weight: normal; word-break: break-all;">${folder}</div>
                    </div>
                    <button class="remove-custom-folder-btn" data-index="${idx}" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 14px; font-weight: bold; padding: 2px 6px;">×</button>
                `;

                row.querySelector('.remove-custom-folder-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const index = parseInt(row.querySelector('.remove-custom-folder-btn').dataset.index);
                    const currentFolders = await window.electronAPI.getCustomFolders();
                    currentFolders.splice(index, 1);
                    await window.electronAPI.saveCustomFolders(currentFolders);
                    renderCustomFoldersList();
                });

                listEl.appendChild(row);
            });
        } catch (e) {
            console.error('Error rendering custom folders:', e);
        }
    }

    // Scan Settings Modal
    async function openScanSettingsModal() {
        // coversOnly toggle'ı sıfırla
        const coversOnlyToggle = document.getElementById('scan-covers-only-toggle');
        if (coversOnlyToggle) coversOnlyToggle.checked = false;
        toggleScanSectionsDisabled(false);

        // Sürücü listesini temizle ve yükleniyor göster
        const drivesList = document.getElementById('scan-drives-list');
        if (drivesList) drivesList.innerHTML = `<div class="scan-drives-loading">${t('scan.drivesLoading')}</div>`;

        // İsteğe bağlı klasörleri yükle
        renderCustomFoldersList();

        openModal('scan-settings-modal');

        // Sürücüleri IPC'den çek ve listeye ekle
        try {
            const drives = await window.electronAPI.getSystemDrives();
            if (drivesList) {
                drivesList.innerHTML = '';
                drives.forEach(drive => {
                    const row = document.createElement('div');
                    row.className = 'scan-item-row';
                    row.innerHTML = `
                        <div>
                            <div class="scan-item-name">${drive.letter}</div>
                            <div class="scan-item-label">${drive.label}</div>
                        </div>
                        <label class="scan-toggle-label">
                            <input type="checkbox" class="scan-drive-toggle" data-drive="${drive.letter}" checked>
                            <span class="scan-toggle-track"></span>
                        </label>
                    `;
                    drivesList.appendChild(row);
                });
            }
        } catch (e) {
            console.error('Sürücüler alınamadı:', e);
            if (drivesList) drivesList.innerHTML = `<div class="scan-drives-loading" style="color:#ef4444;">${t('scan.drivesError')}</div>`;
        }
    }

    function toggleScanSectionsDisabled(disabled) {
        const drivesSection = document.getElementById('scan-drives-section');
        const sourcesSection = document.getElementById('scan-sources-section');
        const customFoldersSection = document.getElementById('scan-custom-folders-section');
        if (drivesSection) drivesSection.classList.toggle('scan-section-disabled', disabled);
        if (sourcesSection) sourcesSection.classList.toggle('scan-section-disabled', disabled);
        if (customFoldersSection) customFoldersSection.classList.toggle('scan-section-disabled', disabled);
    }

    // coversOnly toggle değiştiğinde sürücü+kaynak bölümlerini disable et
    const coversOnlyToggle = document.getElementById('scan-covers-only-toggle');
    if (coversOnlyToggle) {
        coversOnlyToggle.addEventListener('change', () => {
            toggleScanSectionsDisabled(coversOnlyToggle.checked);
        });
    }

    // Kapat butonu
    const scanCloseBtn = document.getElementById('scan-settings-close-btn');
    if (scanCloseBtn) {
        scanCloseBtn.addEventListener('click', () => closeModal('scan-settings-modal'));
    }

    // İsteğe bağlı klasör ekleme butonu
    const addCustomFolderBtn = document.getElementById('scan-add-custom-folder-btn');
    if (addCustomFolderBtn) {
        addCustomFolderBtn.addEventListener('click', async () => {
            const folder = await window.electronAPI.selectFolder();
            if (folder) {
                const currentFolders = await window.electronAPI.getCustomFolders();
                if (!currentFolders.includes(folder)) {
                    currentFolders.push(folder);
                    await window.electronAPI.saveCustomFolders(currentFolders);
                    renderCustomFoldersList();
                }
            }
        });
    }

    // Taramayı Başlat butonu
    const scanStartBtn = document.getElementById('scan-settings-start-btn');
    if (scanStartBtn) {
        scanStartBtn.addEventListener('click', () => {
            closeModal('scan-settings-modal');
            if (state.isScanning) return; // Guard

            // Seçimleri topla
            const coversOnly = document.getElementById('scan-covers-only-toggle')?.checked || false;
            const drives = [...document.querySelectorAll('.scan-drive-toggle:checked')].map(el => el.dataset.drive);
            const sources = [...document.querySelectorAll('.scan-source-toggle:checked')].map(el => el.dataset.source);

            // Progress bar'ı ve modal durumlarını sıfırla
            const progressTitle = document.getElementById('scan-progress-title');
            if (progressTitle) progressTitle.textContent = t('games.scanTitle');

            const runningArea = document.getElementById('scan-progress-running-area');
            if (runningArea) runningArea.style.display = 'block';

            const resultsArea = document.getElementById('scan-custom-results-area');
            if (resultsArea) resultsArea.style.display = 'none';

            const progressModal = document.getElementById('scan-progress-modal');
            if (progressModal) {
                const content = progressModal.querySelector('.modal-content');
                if (content) content.style.maxWidth = ''; // reset to default
            }

            const progressBar = document.getElementById('scan-progress-bar');
            const progressPercent = document.getElementById('scan-progress-percent');
            const progressStatus = document.getElementById('scan-progress-status');
            if (progressBar) progressBar.style.width = '0%';
            if (progressPercent) progressPercent.textContent = '0%';
            if (progressStatus) progressStatus.textContent = coversOnly ? t('games.coverSearchLabel') : t('games.preparingLabel');

            openModal('scan-progress-modal');

            const container = getGamesContainer();
            const loading = getLoadingEl();
            if (!coversOnly) {
                // Tam taramada listeyi temizle
                if (container) container.innerHTML = '';
                if (loading) {
                    loading.style.display = 'block';
                    loading.textContent = t('games.scanningProgress');
                }
            }

            state.isScanning = true;
            // FIX 1a: Disable sort dropdown during scan
            if (sortSelect) sortSelect.disabled = true;

            window.electronAPI.startScan({ coversOnly, drives, sources });
        });
    }

    let currentSubfoldersList = [];

    // Save custom scan results
    const customSaveBtn = document.getElementById('scan-custom-save-btn');
    if (customSaveBtn) {
        customSaveBtn.addEventListener('click', async () => {
            state.isScanning = true;

            // Disable sort dropdown during scan/import
            const sortSelectEl = document.getElementById('game-sort-select');
            if (sortSelectEl) sortSelectEl.disabled = true;

            // Reset modal UI to scan running view
            const progressTitle = document.getElementById('scan-progress-title');
            if (progressTitle) progressTitle.textContent = t('games.addingGames');

            const runningArea = document.getElementById('scan-progress-running-area');
            if (runningArea) runningArea.style.display = 'block';

            const resultsArea = document.getElementById('scan-custom-results-area');
            if (resultsArea) resultsArea.style.display = 'none';

            const progressBar = document.getElementById('scan-progress-bar');
            const progressPercent = document.getElementById('scan-progress-percent');
            const progressStatus = document.getElementById('scan-progress-status');
            if (progressBar) progressBar.style.width = '0%';
            if (progressPercent) progressPercent.textContent = '0%';
            if (progressStatus) progressStatus.textContent = t('games.addingToList');

            try {
                const updatedGames = await window.electronAPI.saveCustomSubfoldersList(currentSubfoldersList);
                renderGames(updatedGames || []);
                updateHomeStats();
                closeModal('scan-progress-modal');
            } catch (e) {
                console.error('Error saving custom subfolders:', e);
                showInfoModal(t('dlss.errorTitle'), t('games.saveError') + e.message, true);
            } finally {
                state.isScanning = false;
                if (sortSelectEl) sortSelectEl.disabled = false;
            }
        });
    }

    // Finish custom scan results
    const customFinishBtn = document.getElementById('scan-custom-finish-btn');
    if (customFinishBtn) {
        customFinishBtn.addEventListener('click', () => {
            closeModal('scan-progress-modal');
        });
    }

    // Handle Scan Progress
    window.electronAPI.onScanProgress((percent) => {
        const progressBar = document.getElementById('scan-progress-bar');
        const progressPercent = document.getElementById('scan-progress-percent');
        const progressStatus = document.getElementById('scan-progress-status');

        if (progressBar) progressBar.style.width = `${percent}%`;
        if (progressPercent) progressPercent.textContent = `${percent}%`;
        if (progressStatus) progressStatus.textContent = t('games.analyzingFiles');
    });

    // Handle Sort Change
    // FIX 1a: Sort dropdown is disabled during scan to prevent race conditions
    const sortSelect = document.getElementById('game-sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', async (e) => {
            if (state.isScanning) return; // Guard: ignore while scanning
            state.gameSortMethod = e.target.value;
            const games = await window.electronAPI.getGames();
            renderGames(games);
        });
    }

    // Handle Manual Add
    const addBtn = getAddGameBtn();
    let pendingManualResult = null;

    // Helper: normalize game name to kebab-case key (mirrors main process)
    function normalizeKey(name) {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .trim()
            .replace(/\s+/g, '-');
    }

    // Auto-fill exe path from developer-games.json
    async function tryAutoFillExe(gameRoot, gameName) {
        if (!gameRoot || !gameName) return null;
        try {
            const devGames = await window.electronAPI.getDeveloperGames();
            const normKey = normalizeKey(gameName);
            if (devGames[normKey] && devGames[normKey].exe_relative_path) {
                const relPath = devGames[normKey].exe_relative_path.replace(/\//g, '\\');
                const root = gameRoot.replace(/\\/g, '\\').replace(/\\$/, '');
                return root + '\\' + relPath;
            }
        } catch (e) { }
        return null;
    }

    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            window.electronAPI.logToMain('Manual add button clicked');
            try {
                const result = await window.electronAPI.addManualGame();
                if (result && result.gameRoot) {
                    window.electronAPI.logToMain(`Folder selected, opening modal: ${result.defaultName}`);
                    pendingManualResult = result;

                    // Populate modal fields
                    const nameInput = document.getElementById('manual-game-name-input');
                    const rootDisplay = document.getElementById('manual-game-root-display');
                    const exeInput = document.getElementById('manual-exe-path-input');
                    const exeHint = document.getElementById('manual-exe-hint');

                    if (nameInput) nameInput.value = result.defaultName;
                    if (rootDisplay) rootDisplay.textContent = result.gameRoot;
                    if (exeInput) exeInput.value = '';
                    if (exeHint) exeHint.style.display = 'none';

                    // Try auto-fill exe from developer-games.json
                    const autoExe = await tryAutoFillExe(result.gameRoot, result.defaultName);
                    if (autoExe && exeInput) {
                        exeInput.value = autoExe;
                        if (exeHint) exeHint.style.display = 'inline';
                    }

                    openModal('manual-add-modal');
                } else {
                    window.electronAPI.logToMain('Folder selection canceled or null');
                }
            } catch (e) {
                window.electronAPI.logToMain(`Manual add general ERROR: ${e.message}`);
                console.error("Manual add error:", e);
                showInfoModal(t('dlss.errorTitle'), t('games.folderError'), true);
            }
        });
    }

    // Modal Events for Manual Add
    const manualAddConfirmBtn = document.getElementById('manual-add-confirm-btn');
    const manualAddCancelBtn = document.getElementById('manual-add-cancel-btn');
    const manualAddInput = document.getElementById('manual-game-name-input');
    const manualExeInput = document.getElementById('manual-exe-path-input');
    const manualExeHint = document.getElementById('manual-exe-hint');
    const manualExeBrowseBtn = document.getElementById('manual-exe-browse-btn');

    // Browse button — let user pick .exe from Windows file dialog
    if (manualExeBrowseBtn) {
        manualExeBrowseBtn.addEventListener('click', async () => {
            const selected = await window.electronAPI.selectExe();
            if (selected && manualExeInput) {
                manualExeInput.value = selected;
                if (manualExeHint) manualExeHint.style.display = 'none'; // user chose manually
            }
        });
    }

    // When game name changes inside modal, try auto-fill exe
    if (manualAddInput) {
        let autoFillTimer = null;
        manualAddInput.addEventListener('input', () => {
            clearTimeout(autoFillTimer);
            autoFillTimer = setTimeout(async () => {
                if (!pendingManualResult) return;
                const gameName = manualAddInput.value.trim();
                if (!gameName) return;
                const autoExe = await (async () => {
                    try {
                        const devGames = await window.electronAPI.getDeveloperGames();
                        const normKey = gameName.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-');
                        if (devGames[normKey] && devGames[normKey].exe_relative_path) {
                            const relPath = devGames[normKey].exe_relative_path.replace(/\//g, '\\');
                            const root = pendingManualResult.gameRoot.replace(/\\$/, '');
                            return root + '\\' + relPath;
                        }
                    } catch (e) { }
                    return null;
                })();
                if (autoExe && manualExeInput) {
                    manualExeInput.value = autoExe;
                    if (manualExeHint) manualExeHint.style.display = 'inline';
                }
            }, 400);
        });
    }

    if (manualAddConfirmBtn) {
        manualAddConfirmBtn.addEventListener('click', async () => {
            if (!pendingManualResult) return;

            const gameName = manualAddInput ? (manualAddInput.value.trim() || pendingManualResult.defaultName) : pendingManualResult.defaultName;
            const exePath = manualExeInput ? manualExeInput.value.trim() : '';
            const gameRoot = pendingManualResult.gameRoot;

            window.electronAPI.logToMain(`Saving game with name: ${gameName}, root: ${gameRoot}, exe: ${exePath}`);

            closeModal('manual-add-modal');

            const loading = getLoadingEl();
            if (loading) {
                loading.style.display = 'block';
                loading.textContent = `${gameName} ${t('games.modInstalling')}`;
            }

            try {
                window.electronAPI.logToMain('Calling saveManualGame...');
                const updatedGames = await window.electronAPI.saveManualGame({
                    name: gameName,
                    gameRoot: gameRoot,
                    exePath: exePath || gameRoot
                });
                window.electronAPI.logToMain('saveManualGame successful');

                if (loading) loading.style.display = 'none';
                renderGames(updatedGames || []);
                updateHomeStats();
                showInfoModal(t('dlss.successTitle'), `🎉 ${gameName} ${t('games.addSuccess')}`);
            } catch (e) {
                window.electronAPI.logToMain(`saveManualGame ERROR: ${e.message}`);
                if (loading) loading.style.display = 'none';
                showInfoModal(t('dlss.errorTitle'), t('games.addError') + e.message, true);
            }

            pendingManualResult = null;
        });
    }

    if (manualAddCancelBtn) {
        manualAddCancelBtn.addEventListener('click', () => {
            window.electronAPI.logToMain('Manual add canceled');
            closeModal('manual-add-modal');
            pendingManualResult = null;
        });
    }

    if (manualAddInput) {
        manualAddInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                manualAddConfirmBtn.click();
            }
        });
    }

    // Set up listeners for streaming
    window.electronAPI.onGameFound((game) => {
        const container = getGamesContainer();
        if (!container) return;

        const searchInput = document.getElementById('game-search-input');
        const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

        if (query && !game.name.toLowerCase().includes(query)) {
            return; // Don't append if it doesn't match the search query
        }

        const noGameMsg = container.querySelector('p');
        if (noGameMsg) noGameMsg.remove();

        // During scan, we append to avoid full re-renders, 
        // but sorting will be fixed onScanComplete
        container.appendChild(createGameCard(game));
    });

    window.electronAPI.onScanComplete(async () => {
        state.isScanning = false;
        const loading = getLoadingEl();
        const container = getGamesContainer();
        if (loading) loading.style.display = 'none';

        // FIX 1a: Re-enable sort dropdown after scan completes
        const sortSelectEl = document.getElementById('game-sort-select');
        if (sortSelectEl) sortSelectEl.disabled = false;

        // Re-fetch and re-render ALL games to ensure FAVORITES are at the top
        const allGames = await window.electronAPI.getGames();
        renderGames(allGames);

        updateHomeStats();

        // Check if there are custom folders to show subfolders list
        try {
            const coversOnly = document.getElementById('scan-covers-only-toggle')?.checked || false;
            const customFolders = await window.electronAPI.getCustomFolders();
            if (!coversOnly && customFolders && customFolders.length > 0) {
                const listEl = document.getElementById('scan-custom-results-list');
                if (listEl) {
                    listEl.innerHTML = `<div style="color: var(--text-secondary); text-align: center; padding: 10px;">${t('games.resultsLoading')}</div>`;

                    // Show results area & adjust modal width
                    const progressModal = document.getElementById('scan-progress-modal');
                    if (progressModal) {
                        const content = progressModal.querySelector('.modal-content');
                        if (content) content.style.maxWidth = '600px';
                    }

                    const progressTitle = document.getElementById('scan-progress-title');
                    if (progressTitle) progressTitle.textContent = 'İsteğe Bağlı Klasör Tarama Sonuçları';

                    const runningArea = document.getElementById('scan-progress-running-area');
                    if (runningArea) runningArea.style.display = 'none';

                    const resultsArea = document.getElementById('scan-custom-results-area');
                    if (resultsArea) resultsArea.style.display = 'block';

                    const subfolders = await window.electronAPI.getCustomSubfoldersList();
                    currentSubfoldersList = subfolders;

                    listEl.innerHTML = '';
                    if (subfolders.length === 0) {
                        listEl.innerHTML = '<div style="color: var(--text-secondary); text-align: center; padding: 10px;">Hiçbir alt klasör bulunamadı.</div>';
                        return;
                    }

                    subfolders.forEach((item, idx) => {
                        const row = document.createElement('div');
                        row.className = 'scan-item-row';
                        row.style.padding = '8px 0';
                        row.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
                        row.style.display = 'flex';
                        row.style.justifyContent = 'space-between';
                        row.style.alignItems = 'center';

                        row.innerHTML = `
                            <div style="flex: 1; min-width: 0; padding-right: 10px;">
                                <div class="scan-item-name" style="font-size: 14px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name}</div>
                                <div class="scan-item-label" style="font-size: 11px; color: var(--text-secondary); word-break: break-all;">${item.path}</div>
                            </div>
                            <label class="scan-toggle-label" style="margin-left: 10px; flex-shrink: 0;">
                                <input type="checkbox" class="custom-subfolder-toggle" data-index="${idx}" ${item.checked ? 'checked' : ''}>
                                <span class="scan-toggle-track"></span>
                            </label>
                        `;

                        row.querySelector('.custom-subfolder-toggle').addEventListener('change', (e) => {
                            const index = parseInt(e.target.dataset.index);
                            currentSubfoldersList[index].checked = e.target.checked;
                        });

                        listEl.appendChild(row);
                    });
                }
            } else {
                // No custom folders, just close the scan progress modal
                closeModal('scan-progress-modal');
            }
        } catch (e) {
            console.error('Error handling scan complete results:', e);
            closeModal('scan-progress-modal');
        }
    });

    // Game Search Listeners
    const searchInput = document.getElementById('game-search-input');
    const searchClear = document.getElementById('game-search-clear');

    if (searchInput && searchClear) {
        searchInput.addEventListener('input', async () => {
            const query = searchInput.value.trim();
            searchClear.style.display = query ? 'flex' : 'none';

            const games = await window.electronAPI.getGames();
            renderGames(games);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                searchInput.blur();
            }
        });

        searchClear.addEventListener('click', async () => {
            searchInput.value = '';
            searchClear.style.display = 'none';
            searchInput.focus();

            const games = await window.electronAPI.getGames();
            renderGames(games);
        });
    }

    // Auto-focus search input when switching to Games tab
    document.addEventListener('tab-activated', (e) => {
        if (e.detail.tabId === 'games') {
            const searchInput = document.getElementById('game-search-input');
            if (searchInput) {
                setTimeout(() => searchInput.focus(), 50); // slight timeout to allow transition/rendering
            }
        }
    });

    // Global keyboard shortcut to focus search bar (Ctrl + F or Cmd + F)
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
            const gamesTab = document.getElementById('games');
            if (gamesTab) {
                e.preventDefault();
                // Switch to games tab if not active
                const activeTab = document.querySelector('.tab-content.active');
                if (activeTab && activeTab.id !== 'games') {
                    const gamesNavItem = document.querySelector('.nav-item[data-target="games"]');
                    if (gamesNavItem) gamesNavItem.click();
                }
                const searchInput = document.getElementById('game-search-input');
                if (searchInput) {
                    searchInput.focus();
                    searchInput.select();
                }
            }
        }
    });
}
