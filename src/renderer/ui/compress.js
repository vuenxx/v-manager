let addedFolders = [];
let selectedFolderIndex = -1;
let compressionDbData = [];
let watchedFolders = [];
let isProcessing = false;

function toggleProcessing(processing) {
    isProcessing = processing;
    const selectFolderBtn = document.getElementById('select-folder-btn');
    const compressSelectedBtn = document.getElementById('compress-selected-btn');
    const uncompressSelectedBtn = document.getElementById('uncompress-selected-btn');
    const watchCheckbox = document.getElementById('watch-folder-checkbox');
    const addedFoldersList = document.getElementById('added-folders-list');
    const methodBoxes = document.querySelectorAll('.method-box');

    if (selectFolderBtn) selectFolderBtn.disabled = processing;
    if (compressSelectedBtn) compressSelectedBtn.disabled = processing;
    if (uncompressSelectedBtn) uncompressSelectedBtn.disabled = processing;
    if (watchCheckbox) watchCheckbox.disabled = processing;
    
    methodBoxes.forEach(box => {
        box.style.pointerEvents = processing ? 'none' : 'auto';
        box.style.opacity = processing ? '0.5' : '1';
    });

    if (addedFoldersList) {
        addedFoldersList.style.pointerEvents = processing ? 'none' : 'auto';
        addedFoldersList.style.opacity = processing ? '0.6' : '1';
    }
}

export async function initCompress() {
    // 1. Core Elements
    const selectFolderBtn = document.getElementById('select-folder-btn');
    const compressSelectedBtn = document.getElementById('compress-selected-btn');
    const uncompressSelectedBtn = document.getElementById('uncompress-selected-btn');
    const addedFoldersList = document.getElementById('added-folders-list');
    const watchCheckbox = document.getElementById('watch-folder-checkbox');

    // Progress Listener
    window.electronAPI.onCompressionProgress((data) => {
        const progressText = document.getElementById('realtime-progress-text');
        const statusText = document.getElementById('realtime-status-text');
        const progressBar = document.getElementById('compression-bar');
        
        if (progressText && data.progress) {
            // compact.exe output parser:
            if (data.progress.includes(' [OK]') || data.progress.includes(' [SKIPPED]')) {
                if (!window._compCount) window._compCount = 0;
                window._compCount++;
                
                if (window._compTotal > 0) {
                    const percent = Math.min(99, Math.round((window._compCount / window._compTotal) * 100));
                    progressText.textContent = `%${percent}`;
                    progressBar.style.width = `${percent}%`;
                    statusText.textContent = `${window._compCount} / ${window._compTotal} dosya işlendi`;
                }
            } else if (data.progress.includes('files within') || data.progress.includes('directories are compressed')) {
                progressText.textContent = '%100';
                progressBar.style.width = '100%';
                statusText.textContent = 'Tamamlandı';
            }
        }
    });

    // 2. Sub-Tab Navigation
    const subNavItems = document.querySelectorAll('.sub-nav-item');
    const subTabContents = document.querySelectorAll('.sub-tab-content');

    subNavItems.forEach(item => {
        item.addEventListener('click', () => {
            if (isProcessing) return;
            const targetId = item.getAttribute('data-sub-target');
            subNavItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            subTabContents.forEach(content => {
                content.style.display = content.id === targetId ? 'block' : 'none';
            });
            if (targetId === 'compress-db') loadCompressionDb();
            if (targetId === 'compress-watch') loadWatchedFolders();
        });
    });

    // 3. Folder Selection
    if (selectFolderBtn) {
        selectFolderBtn.addEventListener('click', async () => {
            if (isProcessing) return;
            const folderPath = await window.electronAPI.selectFolder();
            if (folderPath) {
                addFolderToList(folderPath);
            }
        });
    }

    if (addedFoldersList) {
        addedFoldersList.addEventListener('click', (e) => {
            if (isProcessing) return;
            const item = e.target.closest('.folder-item');
            if (item) {
                const index = parseInt(item.getAttribute('data-index'));
                selectFolder(index);
            }
        });
    }

    // 4. Execution
    if (compressSelectedBtn) {
        compressSelectedBtn.addEventListener('click', async () => {
            if (selectedFolderIndex === -1 || isProcessing) return;
            const folder = addedFolders[selectedFolderIndex];
            window._compCount = 0;
            window._compTotal = parseInt(String(folder.fileCount).replace(/[^0-9]/g, '')) || 0;
            
            toggleProcessing(true);
            
            const statsSection = document.getElementById('compression-stats-section');
            const progressContainer = document.getElementById('realtime-progress-container');
            const methodSection = document.getElementById('compression-method-section');
            const methodContainer = document.getElementById('detected-method-container');
            const barGroups = document.querySelectorAll('.stat-bar-group');
            const savedText = document.getElementById('compression-saved-percent') ? document.getElementById('compression-saved-percent').parentElement : null;
            
            statsSection.style.display = 'flex';
            progressContainer.style.display = 'block';
            methodSection.style.display = 'none';
            methodContainer.style.display = 'none';
            barGroups.forEach(bg => bg.style.display = 'none');
            if (savedText) savedText.style.display = 'none';

            document.getElementById('compression-bar').style.width = '0%';
            document.getElementById('realtime-progress-text').textContent = '0%';

            try {
                const result = await window.electronAPI.runCompression({
                    folderPath: folder.path,
                    algorithm: folder.method
                });
                if (result.success) {
                    alert('Sıkıştırma tamamlandı!');
                }
            } catch (e) {
                alert('Hata: ' + e.message);
            } finally {
                toggleProcessing(false);
                const progressContainer = document.getElementById('realtime-progress-container');
                const barGroups = document.querySelectorAll('.stat-bar-group');
                const savedText = document.getElementById('compression-saved-percent') ? document.getElementById('compression-saved-percent').parentElement : null;
                
                if (progressContainer) progressContainer.style.display = 'none';
                barGroups.forEach(bg => bg.style.display = 'flex');
                if (savedText) savedText.style.display = 'block';
                
                await refreshFolderState(folder);
            }
        });
    }

    if (uncompressSelectedBtn) {
        uncompressSelectedBtn.addEventListener('click', async () => {
            if (selectedFolderIndex === -1 || isProcessing) return;
            const folder = addedFolders[selectedFolderIndex];
            window._compCount = 0;
            window._compTotal = parseInt(String(folder.fileCount).replace(/[^0-9]/g, '')) || 0;
            
            toggleProcessing(true);
            
            const statsSection = document.getElementById('compression-stats-section');
            const progressContainer = document.getElementById('realtime-progress-container');
            const methodSection = document.getElementById('compression-method-section');
            const barGroups = document.querySelectorAll('.stat-bar-group');
            const savedText = document.getElementById('compression-saved-percent') ? document.getElementById('compression-saved-percent').parentElement : null;
            
            statsSection.style.display = 'flex';
            progressContainer.style.display = 'block';
            methodSection.style.display = 'none';
            barGroups.forEach(bg => bg.style.display = 'none');
            if (savedText) savedText.style.display = 'none';
            document.getElementById('compression-bar').style.width = '100%';

            try {
                const result = await window.electronAPI.runUncompression({ folderPath: folder.path });
                if (result.success) {
                    alert('Sıkıştırma geri alındı!');
                }
            } catch (e) {
                alert('Hata: ' + e.message);
            } finally {
                toggleProcessing(false);
                const progressContainer = document.getElementById('realtime-progress-container');
                const barGroups = document.querySelectorAll('.stat-bar-group');
                const savedText = document.getElementById('compression-saved-percent') ? document.getElementById('compression-saved-percent').parentElement : null;
                
                if (progressContainer) progressContainer.style.display = 'none';
                barGroups.forEach(bg => bg.style.display = 'flex');
                if (savedText) savedText.style.display = 'block';
                
                await refreshFolderState(folder);
            }
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

    if (watchCheckbox) {
        watchCheckbox.addEventListener('change', async () => {
            if (selectedFolderIndex === -1 || isProcessing) return;
            const folder = addedFolders[selectedFolderIndex];
            watchedFolders = await window.electronAPI.toggleWatchFolder({
                folderPath: folder.path,
                algorithm: folder.method,
                enable: watchCheckbox.checked
            });
        });
    }

    // 6. DB Search
    const dbSearchInput = document.getElementById('db-search-input');
    if (dbSearchInput) {
        dbSearchInput.addEventListener('input', () => renderCompressionDb(dbSearchInput.value));
    }

    watchedFolders = await window.electronAPI.getWatchedFolders();
}

async function addFolderToList(path) {
    const name = path.split(/[\\/]/).pop() || path;
    const newFolder = {
        name: name,
        path: path,
        size: 'İnceleniyor...',
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

async function refreshFolderState(folder) {
    folder.isAnalyzing = true;
    folder.size = 'İnceleniyor...';
    renderFolderList();
    updateDetailsView(folder);

    try {
        const [stats, gameInfo] = await Promise.all([
            window.electronAPI.analyzeFolder(folder.path),
            window.electronAPI.getFolderGameInfo(folder.path)
        ]);

        folder.size = formatBytes(stats.uncompressedBytes);
        folder.rawUncompressedBytes = stats.uncompressedBytes;
        folder.compressedSize = formatBytes(stats.compressedBytes);
        folder.fileCount = stats.fileCount.toLocaleString();
        folder.isCompressed = stats.isCompressed;
        folder.compressionRatio = stats.ratio;
        folder.gameInfo = gameInfo;
        folder.isAnalyzing = false;

        if (selectedFolderIndex === addedFolders.indexOf(folder)) {
            updateDetailsView(folder);
        }
        renderFolderList();
    } catch (e) {
        console.error('Analysis error:', e);
        folder.isAnalyzing = false;
        folder.size = 'Hata';
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
        
        let status = '';
        if (folder.isAnalyzing) status = '<span class="loading-spinner-small"></span>';
        else if (folder.isCompressed) status = '<span style="color:var(--accent-color); float:right;">✓</span>';
        
        item.innerHTML = `
            ${status}
            <span class="folder-item-name">${folder.name}</span>
            <span class="folder-item-path">${folder.path}</span>
        `;
        listContainer.appendChild(item);
    });
}

function selectFolder(index) {
    selectedFolderIndex = index;
    const folder = addedFolders[index];
    renderFolderList();
    updateDetailsView(folder);
    document.getElementById('folder-details-view').style.display = 'flex';
}

function updateDetailsView(folder) {
    document.getElementById('detail-folder-name').textContent = folder.name;
    document.getElementById('detail-folder-path').textContent = folder.path;
    document.getElementById('detail-folder-size').textContent = folder.isAnalyzing ? 'İnceleniyor...' : folder.size;
    document.getElementById('detail-file-count').textContent = folder.isAnalyzing ? '...' : folder.fileCount;

    const compressBtn = document.getElementById('compress-selected-btn');
    const uncompressBtn = document.getElementById('uncompress-selected-btn');

    if (folder.isAnalyzing) {
        compressBtn.disabled = true;
        uncompressBtn.style.display = 'none';
        compressBtn.textContent = 'Analiz Ediliyor...';
    } else {
        compressBtn.disabled = false;
        if (folder.isCompressed) {
            compressBtn.textContent = `Yeniden Sıkıştır (Oran: ${folder.compressionRatio}:1)`;
            uncompressBtn.style.display = 'block';

            // Update Statistics Bar
            const methodContainer = document.getElementById('detected-method-container');
            const methodNameEl = document.getElementById('detected-method-name');
            if (methodContainer && methodNameEl && folder.gameInfo && folder.gameInfo.algorithm) {
                methodContainer.style.display = 'flex';
                methodNameEl.textContent = folder.gameInfo.algorithm;
            } else if (methodContainer) {
                methodContainer.style.display = 'none';
            }

            const statsSection = document.getElementById('compression-stats-section');
            const methodSection = document.getElementById('compression-method-section');
            if (statsSection && methodSection) {
                statsSection.style.display = 'flex';
                methodSection.style.display = 'none';

                const ratioValue = parseFloat(folder.compressionRatio) || 1.0;
                const currentPercent = Math.round((1 / ratioValue) * 100);
                const savedPercent = 100 - currentPercent;

                document.getElementById('detail-folder-size-raw').textContent = folder.size;
                document.getElementById('detail-folder-compressed-size').textContent = folder.compressedSize;
                document.getElementById('compression-bar').style.width = currentPercent + '%';
                document.getElementById('compression-saved-percent').textContent = '%' + savedPercent;
            }
        } else {
            compressBtn.textContent = 'Seçilen Klasörü Sıkıştır';
            uncompressBtn.style.display = 'none';
            const statsSection = document.getElementById('compression-stats-section');
            const methodSection = document.getElementById('compression-method-section');
            if (statsSection && methodSection) {
                statsSection.style.display = 'none';
                methodSection.style.display = 'block';
            }
        }
    }

    document.getElementById('watch-folder-checkbox').checked = watchedFolders.includes(folder.path);
    updateMethodUI(folder.method, folder);
}

function updateMethodUI(selectedMethod, folder = null) {
    const methodBoxes = document.querySelectorAll('.method-box');
    
    let dbEntry = null;
    if (folder && folder.gameInfo && folder.gameInfo.dbEntry) {
        dbEntry = folder.gameInfo.dbEntry;
    }

    methodBoxes.forEach(box => {
        const method = box.getAttribute('data-method');
        box.classList.toggle('active', method === selectedMethod);
        
        const infoEl = box.querySelector('.method-info');
        if (dbEntry) {
            let result = null;
            if (method === 'XPRESS4K') result = dbEntry.Result_X4K;
            else if (method === 'XPRESS8K') result = dbEntry.Result_X8K;
            else if (method === 'XPRESS16K') result = dbEntry.Result_X16K;
            else if (method === 'LZX') result = dbEntry.Result_LZX;

            if (result && result.BeforeBytes > 0) {
                const ratio = (result.AfterBytes / result.BeforeBytes * 100).toFixed(1);
                const savedPercent = (100 - parseFloat(ratio)).toFixed(1);
                
                const currentUncompressedBytes = folder ? (folder.rawUncompressedBytes || 0) : 0;
                const estCompressedBytes = currentUncompressedBytes * (parseFloat(ratio) / 100);
                
                const beforeStr = formatBytes(currentUncompressedBytes, 1);
                const afterStr = formatBytes(estCompressedBytes, 1);

                infoEl.innerHTML = `%${savedPercent} beklenen tasarruf<br><span style="font-size:10px; opacity:0.8;">${beforeStr} ➔ ${afterStr}</span>`;
            } else {
                infoEl.textContent = 'Veri yok';
            }
        } else {
            // Default labels
            if (method === 'XPRESS4K') infoEl.textContent = '%21 sıkıştırma oranı';
            else if (method === 'XPRESS8K') infoEl.textContent = 'Daha fazla tasarruf';
            else if (method === 'XPRESS16K') infoEl.textContent = 'Yüksek tasarruf';
            else if (method === 'LZX') infoEl.textContent = 'Maksimum tasarruf';
        }
    });
}

async function loadCompressionDb() {
    const container = document.getElementById('db-cards-container');
    if (compressionDbData.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 40px; color: var(--text-secondary);">Veritabanı yükleniyor...</div>';
        compressionDbData = await window.electronAPI.getCompressionDb();
    }
    renderCompressionDb();
}

function renderCompressionDb(query = '') {
    const container = document.getElementById('db-cards-container');
    if (!container) return;
    container.innerHTML = '';
    
    const filtered = compressionDbData.filter(entry => 
        entry.GameName.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 100);

    if (filtered.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 40px; color: var(--text-secondary);">Oyun bulunamadı.</div>';
        return;
    }

    filtered.forEach(entry => {
        const card = document.createElement('div');
        card.className = 'db-game-card';
        
        card.innerHTML = `
            <div class="db-game-title">
                <span>${entry.GameName}</span>
                <span class="db-steam-id">ID: ${entry.SteamID || 'N/A'}</span>
            </div>
            <div class="db-results-grid">
                ${renderDbResultItem('X4K', entry.Result_X4K)}
                ${renderDbResultItem('X8K', entry.Result_X8K)}
                ${renderDbResultItem('X16K', entry.Result_X16K)}
                ${renderDbResultItem('LZX', entry.Result_LZX)}
            </div>
        `;
        container.appendChild(card);
    });
}

function renderDbResultItem(label, result) {
    if (!result || !result.BeforeBytes || result.BeforeBytes === 0) {
        return `
            <div class="db-result-item" style="opacity: 0.5;">
                <div class="db-result-label">${label}</div>
                <div class="db-result-value">-</div>
            </div>
        `;
    }

    const ratio = (result.AfterBytes / result.BeforeBytes * 100).toFixed(1);
    const savedPercent = (100 - parseFloat(ratio)).toFixed(1);
    const savedGB = ((result.BeforeBytes - result.AfterBytes) / (1024 * 1024 * 1024)).toFixed(1);

    return `
        <div class="db-result-item">
            <div class="db-result-label">${label}</div>
            <div class="db-result-value">
                <span class="db-result-percent">%${savedPercent}</span>
                <span class="db-result-saved">-${savedGB}GB</span>
            </div>
        </div>
    `;
}

async function loadWatchedFolders() {
    const container = document.getElementById('watched-folders-list');
    if (!container) return;
    container.innerHTML = '';
    watchedFolders = await window.electronAPI.getWatchedFolders();
    if (watchedFolders.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary)">Henüz izlenen bir klasör yok.</p>';
        return;
    }
    watchedFolders.forEach(folderPath => {
        const name = folderPath.split(/[\\/]/).pop() || folderPath;
        const card = document.createElement('div');
        card.className = 'watch-card';
        card.innerHTML = `<div class="watch-info"><span class="watch-name">${name}</span><span class="watch-path">${folderPath}</span></div><button class="unwatch-btn" data-path="${folderPath}">İzlemeyi Durdur</button>`;
        card.querySelector('.unwatch-btn').addEventListener('click', async () => {
            watchedFolders = await window.electronAPI.toggleWatchFolder({ folderPath: folderPath, enable: false });
            loadWatchedFolders();
        });
        container.appendChild(card);
    });
}
