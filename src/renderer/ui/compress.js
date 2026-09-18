import { t } from '../i18n/i18n.js';
import { showInfoModal } from './modals/info.js';

// H-04: Module-level state instead of window.* globals to prevent pollution
let compCount = 0;
let compTotal = 0;

let addedFolders = [];
let selectedFolderIndex = -1;
let isProcessing = false;

// C-01: Locale-aware percent formatter
function formatPercent(value) {
    const lang = document.documentElement.lang || 'en';
    return lang === 'tr' ? `%${value}` : `${value}%`;
}

function toggleProcessing(processing) {
    isProcessing = processing;
    const selectFolderBtn = document.getElementById('select-folder-btn');
    const compressSelectedBtn = document.getElementById('compress-selected-btn');
    const uncompressSelectedBtn = document.getElementById('uncompress-selected-btn');
    const addedFoldersList = document.getElementById('added-folders-list');
    const methodBoxes = document.querySelectorAll('.method-box');

    if (selectFolderBtn) selectFolderBtn.disabled = processing;
    if (compressSelectedBtn) compressSelectedBtn.disabled = processing;
    if (uncompressSelectedBtn) uncompressSelectedBtn.disabled = processing;
    
    methodBoxes.forEach(box => {
        box.style.pointerEvents = processing ? 'none' : 'auto';
        box.style.opacity = processing ? '0.5' : '1';
    });

    if (addedFoldersList) {
        addedFoldersList.style.pointerEvents = processing ? 'none' : 'auto';
        addedFoldersList.style.opacity = processing ? '0.6' : '1';
    }
}

// ──────────────────────────────────────────────────────────────
// Themed confirm/alert modal (respects dark/light theme)
// ──────────────────────────────────────────────────────────────

/**
 * Temalı onay kutusu gösterir.
 * @param {string} title
 * @param {string} message
 * @param {{ ok: string, cancel?: string, danger?: boolean }} opts
 * @returns {Promise<boolean>}  true → OK/Evet, false → iptal
 */
function showThemedConfirm(title, message, opts = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'themed-confirm-overlay';

        const okLabel = opts.ok || t('compress.historyDeleteConfirmYes');
        const cancelLabel = opts.cancel || t('compress.historyDeleteConfirmNo');
        const isDanger = opts.danger !== false; // default danger=true for delete

        overlay.innerHTML = `
            <div class="themed-confirm-box">
                <h3>${title}</h3>
                <p>${message}</p>
                <div class="themed-confirm-actions">
                    <button class="themed-confirm-btn cancel" id="tcb-cancel">${cancelLabel}</button>
                    <button class="themed-confirm-btn ${isDanger ? 'confirm-danger' : 'confirm-ok'}" id="tcb-ok">${okLabel}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const cleanup = (result) => {
            overlay.remove();
            resolve(result);
        };

        overlay.querySelector('#tcb-ok').addEventListener('click', () => cleanup(true));
        overlay.querySelector('#tcb-cancel').addEventListener('click', () => cleanup(false));
        // Overlay click → cancel
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    });
}

/**
 * Temalı bilgi mesajı gösterir (tek Tamam butonu).
 */
function showThemedAlert(title, message) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'themed-confirm-overlay';
        overlay.innerHTML = `
            <div class="themed-confirm-box">
                <h3>${title}</h3>
                <p>${message}</p>
                <div class="themed-confirm-actions">
                    <button class="themed-confirm-btn confirm-ok" id="tcb-alert-ok">Tamam</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const cleanup = () => { overlay.remove(); resolve(); };
        overlay.querySelector('#tcb-alert-ok').addEventListener('click', cleanup);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
    });
}

// ──────────────────────────────────────────────────────────────
// Paths
// ──────────────────────────────────────────────────────────────

function normalizePath(p) {
    return (p || '').replace(/\\/g, '/').toLowerCase().trim();
}

export async function initCompress() {
    // C-02: Remove any accumulated progress listeners before adding new ones
    window.electronAPI.removeCompressionProgressListeners();

    // ── Sub-tab navigation ──────────────────────────────────────
    const subNavBtns = document.querySelectorAll('.compress-sub-nav-btn');
    subNavBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-compress-sub-target');
            subNavBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.sub-tab-content').forEach(tab => {
                tab.classList.toggle('active', tab.id === targetId);
            });
            if (targetId === 'compress-history') {
                renderHistoryTab();
            }
        });
    });

    // 1. Core Elements
    const selectFolderBtn = document.getElementById('select-folder-btn');
    const compressSelectedBtn = document.getElementById('compress-selected-btn');
    const uncompressSelectedBtn = document.getElementById('uncompress-selected-btn');
    const addedFoldersList = document.getElementById('added-folders-list');


    // Progress Listener
    window.electronAPI.onCompressionProgress((data) => {
        const progressText = document.getElementById('realtime-progress-text');
        const statusText = document.getElementById('realtime-status-text');
        const progressBar = document.getElementById('realtime-progress-bar');
        
        if (progressText && data.progress) {
            // compact.exe output parser — detect [OK] or [SKIPPED] per file
            if (data.progress.includes('[OK]') || data.progress.includes('[SKIPPED]')) {
                compCount++;
                
                // M-06: Guard against compTotal being 0
                if (compTotal > 0) {
                    const percent = Math.min(99, Math.round((compCount / compTotal) * 100));
                    // C-01: Use locale-aware percent format
                    progressText.textContent = formatPercent(percent);
                    if (progressBar) progressBar.style.width = `${percent}%`;
                    // H-10: Use textContent to avoid XSS
                    if (statusText) statusText.textContent = `${compCount} / ${compTotal} ${t('compress.filesProcessed')}`;
                }
            } else if (
                // H-06: Locale-independent completion detection: if compCount reaches compTotal
                compTotal > 0 && compCount >= compTotal
            ) {
                progressText.textContent = formatPercent(100);
                if (progressBar) progressBar.style.width = '100%';
                if (statusText) statusText.textContent = t('compress.completed');
            }
        }
    });


    // 3. Folder Selection
    if (selectFolderBtn) {
        selectFolderBtn.addEventListener('click', async () => {
            if (isProcessing) return;
            const folderPath = await window.electronAPI.selectFolder();
            if (folderPath) {
                // ── Duplicate klasör kontrolü ──────────────────────────────
                const isDuplicate = addedFolders.some(
                    f => normalizePath(f.path) === normalizePath(folderPath)
                );
                if (isDuplicate) {
                    await showThemedAlert(
                        t('compress.duplicateFolderTitle'),
                        t('compress.duplicateFolderMsg')
                    );
                    return;
                }
                addFolderToList(folderPath);
            }
        });
    }


    // 4. Execution
    if (compressSelectedBtn) {
        compressSelectedBtn.addEventListener('click', async () => {
            if (selectedFolderIndex === -1 || isProcessing) return;
            const folder = addedFolders[selectedFolderIndex];

            // H-04: Use module-level state variables
            compCount = 0;
            compTotal = parseInt(String(folder.fileCount).replace(/[^0-9]/g, '')) || 0;
            
            toggleProcessing(true);
            
            const statsSection = document.getElementById('compression-stats-section');
            const progressContainer = document.getElementById('realtime-progress-container');
            const methodSection = document.getElementById('compression-method-section');
            const methodContainer = document.getElementById('detected-method-container');
            const actualStatsContainer = document.getElementById('compression-actual-stats');

            statsSection.style.display = 'flex';
            progressContainer.style.display = 'block';
            methodSection.style.display = 'none';
            if (methodContainer) methodContainer.style.display = 'none';
            if (actualStatsContainer) actualStatsContainer.style.display = 'none';

            const realtimeProgressBar = document.getElementById('realtime-progress-bar');
            if (realtimeProgressBar) realtimeProgressBar.style.width = '0%';
            // C-01: Locale-aware
            document.getElementById('realtime-progress-text').textContent = formatPercent(0);

            try {
                const result = await window.electronAPI.runCompression({
                    folderPath: folder.path,
                    algorithm: folder.method
                });
                if (result.success) {
                    // H-06: Force 100% on success
                    if (realtimeProgressBar) realtimeProgressBar.style.width = '100%';
                    document.getElementById('realtime-progress-text').textContent = formatPercent(100);
                    const statusText = document.getElementById('realtime-status-text');
                    if (statusText) statusText.textContent = t('compress.completed');
                    showInfoModal(t('opti.successTitle'), t('compress.compressDone'));
                }
            } catch (e) {
                // H-11: Translate error codes from main process
                const msg = translateErrorCode(e.message);
                showInfoModal(t('opti.errorTitle'), t('compress.genericError') + msg, true);
            } finally {
                toggleProcessing(false);
                const progressContainerFinal = document.getElementById('realtime-progress-container');
                if (progressContainerFinal) progressContainerFinal.style.display = 'none';
                
                await refreshFolderState(folder);
            }
        });
    }

    if (uncompressSelectedBtn) {
        uncompressSelectedBtn.addEventListener('click', async () => {
            if (selectedFolderIndex === -1 || isProcessing) return;
            const folder = addedFolders[selectedFolderIndex];
            await _runUncompressForFolder(folder);
        });
    }

    // 5. Watcher & Method UI
    const methodBoxes = document.querySelectorAll('.method-box');
    methodBoxes.forEach(box => {
        box.addEventListener('click', () => {
            if (selectedFolderIndex !== -1 && !isProcessing) {
                const method = box.getAttribute('data-method');
                addedFolders[selectedFolderIndex].method = method;
                updateMethodUI(method, addedFolders[selectedFolderIndex]);
            }
        });
    });
}

// ──────────────────────────────────────────────────────────────
// Shared uncompress runner (used by button AND history delete)
// ──────────────────────────────────────────────────────────────

async function _runUncompressForFolder(folder) {
    // Uncompress: no percent display needed (user request)
    // Set compTotal=0 so the progress listener won't update the bar
    compCount = 0;
    compTotal = 0;
    
    toggleProcessing(true);
    
    const statsSection = document.getElementById('compression-stats-section');
    const progressContainer = document.getElementById('realtime-progress-container');
    const methodSection = document.getElementById('compression-method-section');
    const actualStatsContainer = document.getElementById('compression-actual-stats');
    const realtimeProgressBarContainer = progressContainer ? progressContainer.querySelector('.comp-progress-container') : null;
    const progressText = document.getElementById('realtime-progress-text');
    const statusText = document.getElementById('realtime-status-text');

    statsSection.style.display = 'flex';
    progressContainer.style.display = 'block';
    methodSection.style.display = 'none';
    if (actualStatsContainer) actualStatsContainer.style.display = 'none';

    // Hide the percent text and bar, just show processing status
    if (realtimeProgressBarContainer) realtimeProgressBarContainer.style.display = 'none';
    if (progressText) progressText.style.display = 'none';
    if (statusText) statusText.textContent = t('compress.processing');

    try {
        const result = await window.electronAPI.runUncompression({ folderPath: folder.path });
        if (result.success) {
            if (statusText) statusText.textContent = t('compress.completed');
        }
        return result;
    } catch (e) {
        const msg = translateErrorCode(e.message);
        showInfoModal(t('opti.errorTitle'), t('compress.genericError') + msg, true);
        throw e;
    } finally {
        toggleProcessing(false);
        // Restore bar/text visibility for next compress operation
        if (realtimeProgressBarContainer) realtimeProgressBarContainer.style.display = '';
        if (progressText) progressText.style.display = '';
        const progressContainerFinal = document.getElementById('realtime-progress-container');
        if (progressContainerFinal) progressContainerFinal.style.display = 'none';
        
        await refreshFolderState(folder);
    }
}

// H-11: Translate error codes from main process to localized messages
function translateErrorCode(errorMsg) {
    if (errorMsg.includes('ERR_FOLDER_NOT_FOUND')) return t('compress.errFolderNotFound');
    if (errorMsg.includes('ERR_INVALID_ALGORITHM')) return t('compress.errInvalidAlgorithm');
    if (errorMsg.includes('ERR_SPAWN_FAILED')) return t('compress.errSpawnFailed');
    if (errorMsg.includes('ERR_COMPRESS_FAILED')) return errorMsg.replace('ERR_COMPRESS_FAILED:', t('compress.errCompressFailed') + ' (code: ');
    if (errorMsg.includes('ERR_COMPACT_FAILED')) return errorMsg.replace('ERR_COMPACT_FAILED:', t('compress.errCompressFailed') + ' (code: ');
    return errorMsg;
}

async function addFolderToList(path) {
    const name = path.split(/[\\\/]/).pop() || path;
    const newFolder = {
        name: name,
        path: path,
        size: t('compress.analyzing'),
        fileCount: '...',
        method: 'XPRESS4K',
        isCompressed: false,
        isAnalyzing: true
    };

    addedFolders.push(newFolder);
    renderFolderList();
    selectFolder(addedFolders.length - 1);
    document.querySelector('.compress-action-group').style.display = 'flex';

    await refreshFolderState(newFolder);
}

/**
 * Geçmişte bu path ile eşleşen kayıtları siler ve history tab'ı günceller.
 * @param {string} folderPath
 */
async function _removeHistoryMatchForPath(folderPath) {
    try {
        const history = await window.electronAPI.getCompressionHistory();
        const norm = normalizePath(folderPath);
        const matching = history.filter(e => normalizePath(e.folderPath) === norm);
        for (const entry of matching) {
            await window.electronAPI.removeHistoryEntry(entry.id);
        }
        if (matching.length > 0) {
            // Eğer history tab aktifse yenile
            const historyTab = document.getElementById('compress-history');
            if (historyTab && historyTab.classList.contains('active')) {
                renderHistoryTab();
            }
        }
    } catch (e) {
        console.warn('[Compress] _removeHistoryMatchForPath error:', e);
    }
}

async function refreshFolderState(folder) {
    folder.isAnalyzing = true;
    folder.size = t('compress.analyzing');
    renderFolderList();
    updateDetailsView(folder);

    try {
        const stats = await window.electronAPI.analyzeFolder(folder.path);

        folder.size = formatBytes(stats.uncompressedBytes);
        folder.rawUncompressedBytes = stats.uncompressedBytes;
        folder.compressedSize = formatBytes(stats.compressedBytes);
        folder.rawCompressedBytes = stats.compressedBytes; // Populated correctly
        folder.fileCount = stats.fileCount.toLocaleString();
        folder.isCompressed = stats.isCompressed;
        folder.compressionRatio = stats.ratio;
        folder.isAnalyzing = false;

        if (selectedFolderIndex === addedFolders.indexOf(folder)) {
            updateDetailsView(folder);
        }
        renderFolderList();
    } catch (e) {
        console.error('Analysis error:', e);
        folder.isAnalyzing = false;
        folder.size = t('compress.error');
        if (selectedFolderIndex === addedFolders.indexOf(folder)) {
            updateDetailsView(folder);
        }
    }
}

function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function renderFolderList() {
    const listContainer = document.getElementById('added-folders-list');
    listContainer.innerHTML = '';

    addedFolders.forEach((folder, index) => {
        const item = document.createElement('div');
        item.className = `folder-item ${index === selectedFolderIndex ? 'active' : ''}`;
        item.setAttribute('data-index', index);

        // H-10: Use textContent for user-controlled values (XSS prevention)
        const nameSpan = document.createElement('span');
        nameSpan.className = 'folder-item-name';
        nameSpan.textContent = folder.name;

        const pathSpan = document.createElement('span');
        pathSpan.className = 'folder-item-path';
        pathSpan.textContent = folder.path;

        if (folder.isAnalyzing) {
            // Analiz spinner — kaldırma yok
            const spinner = document.createElement('span');
            spinner.className = 'loading-spinner-small';
            item.appendChild(spinner);
        } else {
            // ✓ / ✕ toggle butonu
            const removeBtn = document.createElement('button');
            removeBtn.className = 'folder-item-remove-btn';
            removeBtn.setAttribute('aria-label', 'Remove folder');
            removeBtn.setAttribute('title', 'Listeden kaldır');
            // Normal: ✓ (sıkıştırılmış ise yeşil, değilse gizli)
            // Hover: her zaman ✕ kırmızı
            const checkIcon = document.createElement('span');
            checkIcon.className = 'folder-remove-check';
            checkIcon.textContent = '✓';
            checkIcon.style.color = folder.isCompressed ? 'var(--accent-color)' : 'transparent';

            const closeIcon = document.createElement('span');
            closeIcon.className = 'folder-remove-close';
            closeIcon.textContent = '✕';

            removeBtn.appendChild(checkIcon);
            removeBtn.appendChild(closeIcon);

            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // klasör seçme olayını tetikleme
                if (isProcessing) return;
                _removeFolderFromList(index);
            });

            item.appendChild(removeBtn);
        }

        item.appendChild(nameSpan);
        item.appendChild(pathSpan);

        // Klasör seçme — remove butonuna tıklama hariç
        item.addEventListener('click', (e) => {
            if (isProcessing) return;
            if (!e.target.closest('.folder-item-remove-btn')) {
                selectFolder(index);
            }
        });

        listContainer.appendChild(item);
    });
}

/**
 * Klasörü addedFolders listesinden kaldırır, UI'yi günceller.
 */
function _removeFolderFromList(index) {
    addedFolders.splice(index, 1);

    // selectedFolderIndex'i güncelle
    if (addedFolders.length === 0) {
        selectedFolderIndex = -1;
        const detailView = document.getElementById('folder-details-view');
        if (detailView) detailView.style.display = 'none';
        const actionGroup = document.querySelector('.compress-action-group');
        if (actionGroup) actionGroup.style.display = 'none';
    } else if (selectedFolderIndex >= addedFolders.length) {
        selectedFolderIndex = addedFolders.length - 1;
        selectFolder(selectedFolderIndex);
    } else if (selectedFolderIndex === index) {
        selectFolder(selectedFolderIndex);
    } else if (selectedFolderIndex > index) {
        selectedFolderIndex--;
    }

    renderFolderList();
}

function selectFolder(index) {
    selectedFolderIndex = index;
    const folder = addedFolders[index];
    renderFolderList();
    updateDetailsView(folder);
    document.getElementById('folder-details-view').style.display = 'flex';
}

function updateDetailsView(folder) {
    // H-10: textContent for all user data
    document.getElementById('detail-folder-name').textContent = folder.name;
    document.getElementById('detail-folder-path').textContent = folder.path;
    document.getElementById('detail-folder-size').textContent = folder.isAnalyzing ? t('compress.analyzing') : folder.size;
    document.getElementById('detail-file-count').textContent = folder.isAnalyzing ? '...' : folder.fileCount;

    const compressBtn = document.getElementById('compress-selected-btn');
    const uncompressBtn = document.getElementById('uncompress-selected-btn');

    if (folder.isAnalyzing) {
        compressBtn.disabled = true;
        uncompressBtn.style.display = 'none';
        compressBtn.textContent = t('compress.analyzing2');
        
        // Hide stats section and actual stats during analysis
        const statsSection = document.getElementById('compression-stats-section');
        const methodSection = document.getElementById('compression-method-section');
        if (statsSection) statsSection.style.display = 'none';
        if (methodSection) methodSection.style.display = 'none';
    } else {
        compressBtn.disabled = false;
        if (folder.isCompressed) {
            // M-19: Fixed double parentheses: "Re-Compress (Ratio: (1.5:1)" → "Re-Compress (1.5:1)"
            compressBtn.textContent = `${t('compress.reCompress')} (${folder.compressionRatio}:1)`;
            uncompressBtn.style.display = 'block';

            // Update Statistics Bar — show method but NOT size savings (per user requirement)
            const methodContainer = document.getElementById('detected-method-container');
            const methodNameEl = document.getElementById('detected-method-name');
            if (methodContainer && methodNameEl && folder.gameInfo && folder.gameInfo.algorithm) {
                methodContainer.style.display = 'flex';
                methodNameEl.textContent = folder.gameInfo.algorithm;
            } else if (methodContainer) {
                methodContainer.style.display = 'none';
            }

            // Update Statistics
            const rawSizeEl = document.getElementById('detail-folder-size-raw');
            const compSizeEl = document.getElementById('detail-folder-compressed-size');
            const savedPercentEl = document.getElementById('compression-saved-percent');

            if (rawSizeEl) rawSizeEl.textContent = folder.size;
            if (compSizeEl) compSizeEl.textContent = folder.compressedSize || folder.size;

            let savedPercent = 0;
            if (folder.rawUncompressedBytes && folder.rawCompressedBytes && folder.rawUncompressedBytes > 0) {
                savedPercent = Math.max(0, Math.round(((folder.rawUncompressedBytes - folder.rawCompressedBytes) / folder.rawUncompressedBytes) * 100));
            }

            if (savedPercentEl) {
                const lang = document.documentElement.lang || 'en';
                const parentNode = savedPercentEl.parentNode;
                if (parentNode) {
                    if (lang === 'tr') {
                        parentNode.innerHTML = `Diskte <span id="compression-saved-percent" style="color: var(--accent-color); font-weight: bold;">%${savedPercent}</span> oranında yer açıldı.`;
                    } else {
                        parentNode.innerHTML = `<span id="compression-saved-percent" style="color: var(--accent-color); font-weight: bold;">${savedPercent}%</span> of disk space saved.`;
                    }
                }
            }

            const statsSection = document.getElementById('compression-stats-section');
            const methodSection = document.getElementById('compression-method-section');
            const actualStatsContainer = document.getElementById('compression-actual-stats');
            if (statsSection && methodSection) {
                statsSection.style.display = 'flex';
                methodSection.style.display = 'none';
                if (actualStatsContainer) actualStatsContainer.style.display = 'flex';

                // Show compression ratio bar (not size saving %) — only show ratio
                const currentPercent = folder.rawUncompressedBytes && folder.rawCompressedBytes && folder.rawUncompressedBytes > 0 
                    ? Math.round((folder.rawCompressedBytes / folder.rawUncompressedBytes) * 100)
                    : 100;

                document.getElementById('compression-bar').style.width = currentPercent + '%';
            }
        } else {
            compressBtn.textContent = t('compress.compressBtn');
            uncompressBtn.style.display = 'none';
            const statsSection = document.getElementById('compression-stats-section');
            const methodSection = document.getElementById('compression-method-section');
            const actualStatsContainer = document.getElementById('compression-actual-stats');
            if (statsSection && methodSection) {
                statsSection.style.display = 'none';
                methodSection.style.display = 'block';
                if (actualStatsContainer) actualStatsContainer.style.display = 'none';
            }
        }
    }

    updateMethodUI(folder.method, folder);
}

function updateMethodUI(selectedMethod, folder = null) {
    const methodBoxes = document.querySelectorAll('.method-box');

    methodBoxes.forEach(box => {
        const method = box.getAttribute('data-method');
        box.classList.toggle('active', method === selectedMethod);
        
        const infoEl = box.querySelector('.method-info');
        // Default info labels only — DB result size data removed per user requirement
        if (method === 'XPRESS4K') infoEl.textContent = t('compress.x4kInfo');
        else if (method === 'XPRESS8K') infoEl.textContent = t('compress.x8kInfo');
        else if (method === 'XPRESS16K') infoEl.textContent = t('compress.x16kInfo');
        else if (method === 'LZX') infoEl.textContent = t('compress.lzxInfo');
    });
}

// ──────────────────────────────────────────────────────────────
// HISTORY TAB
// ──────────────────────────────────────────────────────────────

async function renderHistoryTab() {
    const listEl = document.getElementById('compression-history-list');
    const emptyEl = document.getElementById('compression-history-empty');
    if (!listEl) return;

    listEl.innerHTML = '';

    let history = [];
    try {
        history = await window.electronAPI.getCompressionHistory();
    } catch (e) {
        console.error('[Compress] History fetch error:', e);
    }

    const hasEntries = history.length > 0;

    // Boş durum — .visible class ile kontrol
    if (emptyEl) {
        emptyEl.classList.toggle('visible', !hasEntries);
    }
    listEl.style.display = hasEntries ? '' : 'none';

    const lang = document.documentElement.lang || 'en';

    history.forEach(entry => {
        const card = document.createElement('div');
        card.className = 'history-card';
        card.setAttribute('data-history-id', entry.id);

        // ── Üst satır: klasör adı + path + çöp kutusu ──────────
        const header = document.createElement('div');
        header.className = 'history-card-header';

        const titleBlock = document.createElement('div');
        titleBlock.className = 'history-card-title';

        const nameEl = document.createElement('span');
        nameEl.className = 'history-card-folder-name';
        nameEl.textContent = entry.folderName || entry.folderPath.split(/[\\\/]/).pop() || '';

        const pathEl = document.createElement('span');
        pathEl.className = 'history-card-folder-path';
        pathEl.textContent = entry.folderPath || '';

        titleBlock.appendChild(nameEl);
        titleBlock.appendChild(pathEl);

        // Çöp kutusu butonu — sağ üst
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'history-delete-btn';
        deleteBtn.title = t('compress.historyDeleteBtn');
        deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
        deleteBtn.addEventListener('click', () => _handleHistoryDelete(entry));

        header.appendChild(titleBlock);
        header.appendChild(deleteBtn);

        // ── Alt istatistik grid'i ───────────────────────────────
        const stats = document.createElement('div');
        stats.className = 'history-card-stats';

        // Önce
        const statBefore = _makeStatItem(t('compress.historyBefore'), formatBytes(entry.sizeBefore), 'value-muted');
        // Sonra
        const statAfter = _makeStatItem(t('compress.historyAfter'), formatBytes(entry.sizeAfter), 'value-accent');
        // Kazanım
        let savedText = '—';
        let savedClass = 'value-muted';
        if (entry.savedPercent > 0) {
            savedText = lang === 'tr' ? `%${entry.savedPercent}` : `${entry.savedPercent}%`;
            savedClass = 'value-accent';
        }
        const statSaved = _makeStatItem(t('compress.historySavedLabel'), savedText, savedClass);

        // Algoritma
        const algoEl = document.createElement('div');
        algoEl.className = 'history-stat-item';
        const algoLabel = document.createElement('span');
        algoLabel.className = 'history-stat-label';
        algoLabel.textContent = t('compress.historyAlgorithm');
        const algoBadge = document.createElement('span');
        algoBadge.className = 'history-algo-badge';
        if (entry.algorithm && entry.algorithm !== 'None' && entry.algorithm !== 'null') {
            algoBadge.textContent = entry.algorithm;
        } else {
            algoBadge.textContent = '—';
            algoBadge.classList.add('algo-none');
        }
        algoEl.appendChild(algoLabel);
        algoEl.appendChild(algoBadge);

        // Tarih
        let dateText = '—';
        if (entry.timestamp) {
            const d = new Date(entry.timestamp);
            dateText = d.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', {
                day: '2-digit', month: '2-digit', year: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });
        }
        const statDate = _makeStatItem('', dateText, 'value-muted');
        statDate.classList.add('stat-date');

        stats.appendChild(statBefore);
        stats.appendChild(statAfter);
        stats.appendChild(statSaved);
        stats.appendChild(algoEl);
        stats.appendChild(statDate);

        card.appendChild(header);
        card.appendChild(stats);
        listEl.appendChild(card);
    });
}

/** Yardımcı: istatistik sütunu oluşturur */
function _makeStatItem(label, value, valueClass = '') {
    const item = document.createElement('div');
    item.className = 'history-stat-item';
    if (label) {
        const lbl = document.createElement('span');
        lbl.className = 'history-stat-label';
        lbl.textContent = label;
        item.appendChild(lbl);
    }
    const val = document.createElement('span');
    val.className = 'history-stat-value' + (valueClass ? ' ' + valueClass : '');
    val.textContent = value;
    item.appendChild(val);
    return item;
}

/**
 * Geçmiş kaydı silme: onay → tools tab'a geç → klasörü seç/ekle → uncompress → başarı mesajı
 */
async function _handleHistoryDelete(entry) {
    // 1. Onay kutusu
    const confirmed = await showThemedConfirm(
        t('compress.historyDeleteConfirmTitle'),
        t('compress.historyDeleteConfirmMsg'),
        {
            ok: t('compress.historyDeleteConfirmYes'),
            cancel: t('compress.historyDeleteConfirmNo'),
            danger: true
        }
    );
    if (!confirmed) return;

    // 2. Tools tab'a geç
    _switchToToolsTab();

    // 3. Klasörün addedFolders'da var mı kontrol et
    let folderObj = addedFolders.find(
        f => normalizePath(f.path) === normalizePath(entry.folderPath)
    );

    if (!folderObj) {
        // Klasör listede yok — ekle
        const name = entry.folderName || entry.folderPath.split(/[\\\/]/).pop() || entry.folderPath;
        folderObj = {
            name,
            path: entry.folderPath,
            size: t('compress.analyzing'),
            fileCount: '...',
            method: 'XPRESS4K',
            isCompressed: true, // sıkıştırılmış olduğunu biliyoruz
            isAnalyzing: false
        };
        addedFolders.push(folderObj);
        renderFolderList();
        document.querySelector('.compress-action-group').style.display = 'flex';
    }

    // 4. Klasörü seç
    const folderIndex = addedFolders.findIndex(
        f => normalizePath(f.path) === normalizePath(entry.folderPath)
    );
    if (folderIndex !== -1) {
        selectFolder(folderIndex);
    }

    // 5. Uncompress işlemini çalıştır (var olan _runUncompressForFolder akışı)
    try {
        await _runUncompressForFolder(folderObj);
        // ipc.js run-uncompression handler'ı zaten removeEntriesByPath çağırıyor,
        // yani kayıt otomatik silindi. Başarı mesajı göster.
        await showThemedAlert(
            t('compress.historyDeleteSuccessTitle'),
            t('compress.historyDeleteSuccess')
        );
    } catch (_) {
        // Hata durumunda yeniden render — ipc handler hata mesajını zaten gösteriyor
    }

    // 6. History tab'ı yenile (arka planda güncel kalsın)
    renderHistoryTab();
}

/**
 * Sub-tab navigasyonunu Tools tab'a geçirir.
 */
function _switchToToolsTab() {
    const toolsBtn = document.getElementById('compress-sub-nav-tools');
    const historyBtn = document.getElementById('compress-sub-nav-history');
    if (toolsBtn) {
        toolsBtn.classList.add('active');
        if (historyBtn) historyBtn.classList.remove('active');
    }
    document.querySelectorAll('.sub-tab-content').forEach(tab => {
        tab.classList.toggle('active', tab.id === 'compress-tools');
    });
}
