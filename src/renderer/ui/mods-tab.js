import { t } from '../i18n/i18n.js';
import { showRefreshWarning, formatCacheAge } from './modals/cacheHelpers.js';
import { showInfoModal, showConfirmDialog } from './modals/info.js';

// Controller State
let currentMod = 'dlssenabler'; // default mod tab
let releasesData = {}; // cache release info per mod: { [modId]: { releases, fetchedAt, fromStaleCache } }
let activeDownload = null; // { modName, tag, name, downloadUrl, progressText }
const downloadQueue = []; // array of queue items
const failedDownloads = {}; // key: modName-tag -> errorMsg
let allModules = [];        // son çekilen manifest listesi (ray + künye ondan çizilir)
let railFilter = '';        // sol raydaki arama kutusunun metni

/**
 * Initializes the entire Mods tab and dynamic sub-navigation.
 */
export async function initModsTab() {
    // 0. Sub-Tab navigation for Mods (Mod Sürümleri vs Manifest Oluşturucu)
    const modsSubNavItems = document.querySelectorAll('.mods-sub-nav-item');
    const modsSubTabContents = document.querySelectorAll('.mods-sub-tab-content');

    modsSubNavItems.forEach(item => {
        item.addEventListener('click', async () => {
            const targetId = item.getAttribute('data-mods-sub-target');
            modsSubNavItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            modsSubTabContents.forEach(content => {
                content.style.display = content.id === targetId ? 'block' : 'none';
            });

            if (targetId === 'mods-sub-builder') {
                document.dispatchEvent(new CustomEvent('tab-activated', { detail: { tabId: 'manifest-builder' } }));
            } else if (targetId === 'mods-sub-versions') {
                await renderModTabsNav();
                await loadModReleases(false);
            }
        });
    });

    // 1. Tab switches listeners (Delegated click for dynamic buttons)
    const tabNav = document.getElementById('mods-tabs-nav');
    if (tabNav) {
        tabNav.addEventListener('click', async (e) => {
            const btn = e.target.closest('.mods-tab-btn');
            if (!btn) return;
            
            // Set active class
            tabNav.querySelectorAll('.mods-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const selectedMod = btn.getAttribute('data-mod');
            if (selectedMod && selectedMod !== currentMod) {
                currentMod = selectedMod;
                renderDetailHeader();
                await loadModReleases(false);
            }
        });
    }

    // 2. Refresh button listener (Force GitHub API refresh with 1-hour cache invalidation)
    const refreshBtn = document.getElementById('mods-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            showRefreshWarning(async () => {
                await loadModReleases(true);
            });
        });
    }

    // 2b. Sol raydaki mod arama kutusu — liste uzadıkça aramak şart
    const railSearch = document.getElementById('mods-rail-search');
    if (railSearch) {
        railSearch.addEventListener('input', () => {
            railFilter = railSearch.value.trim().toLowerCase();
            renderModRail();
        });
    }

    // 3. Tab activation listener (from main sidebar / header navigation)
    document.addEventListener('tab-activated', async (e) => {
        if (e.detail && e.detail.tabId === 'modes') {
            const activeSub = document.querySelector('.mods-sub-nav-item.active');
            const targetId = activeSub ? activeSub.getAttribute('data-mods-sub-target') : 'mods-sub-versions';
            if (targetId === 'mods-sub-builder') {
                document.dispatchEvent(new CustomEvent('tab-activated', { detail: { tabId: 'manifest-builder' } }));
            } else {
                await renderModTabsNav();
                await loadModReleases(false);
            }
        }
    });

    // 4. Manifest list changed listener (re-render tabs on the fly when user saves/deletes custom manifests)
    document.addEventListener('manifests-updated', async () => {
        await renderModTabsNav();
    });

    // Initial render of tabs
    await renderModTabsNav();
}

/**
 * Tüm yüklü manifest'leri (resmi / topluluk / özel) çeker, sıralar ve sol
 * modül rayını çizer.
 *
 * Eskiden bu yatay bir sekme şerididi: modül sayısı 6'yı geçince isimler
 * ekrana sığmıyor, taşan kısım scrollbar'ı gizlenmiş bir alanda kayboluyordu.
 * Dikey ray modül sayısından bağımsız okunabilir kalıyor.
 */
export async function renderModTabsNav() {
    const tabNav = document.getElementById('mods-tabs-nav');
    if (!tabNav) return;

    let modules = [];
    if (window.electronAPI && window.electronAPI.moduleList) {
        try {
            modules = await window.electronAPI.moduleList();
        } catch (e) {
            console.warn('[ModsTab] moduleList fetch error:', e);
        }
    }

    // Fallback if no modules returned
    if (!modules || modules.length === 0) {
        modules = [
            { id: 'dlssenabler', name: 'DLSS Enabler', type: 'official' },
            { id: 'optiscaler', name: 'OptiScaler', type: 'official' },
            { id: 'optibuilder', name: 'OptiBuilder', type: 'official' },
            { id: 'optipatcher', name: 'OptiPatcher', type: 'official' },
            { id: 'fsr4', name: 'FSR4 Dosyaları', type: 'official' },
            { id: 'streamline', name: 'Streamline', type: 'official' }
        ];
    }

    // Sort order: Official prominent mods first, then other official, then community, then custom
    const preferredOrder = ['dlssenabler', 'optiscaler', 'optiscaler-dlssnr', 'optibuilder', 'optipatcher', 'fsr4', 'streamline'];
    modules.sort((a, b) => {
        const aIdx = preferredOrder.indexOf(a.id);
        const bIdx = preferredOrder.indexOf(b.id);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;

        // By type: official -> community -> custom
        const typeScore = { official: 1, community: 2, custom: 3 };
        const scoreDiff = (typeScore[a.type] || 2) - (typeScore[b.type] || 2);
        if (scoreDiff !== 0) return scoreDiff;

        return (a.name || a.id).localeCompare(b.name || b.id);
    });

    allModules = modules;

    // Ensure currentMod is in the module list
    const hasCurrent = modules.some(m => m.id === currentMod);
    if (!hasCurrent && modules.length > 0) {
        currentMod = modules[0].id;
    }

    renderModRail();
    renderDetailHeader();
}

/** Modül için kullanıcıya gösterilecek ad. */
function modDisplayName(mod) {
    if (mod.id === 'fsr4') return t('mods.fsr4Title') || mod.name || mod.id;
    return mod.name || mod.id;
}

/** Kaynak türü rozeti — resmi / topluluk / özel. */
function modTypeBadge(type) {
    if (type === 'custom') return { cls: 'custom', label: t('modsTab.typeCustom') || 'Özel' };
    if (type === 'community') return { cls: 'community', label: t('modsTab.typeCommunity') || 'Topluluk' };
    return { cls: 'official', label: t('modsTab.typeOfficial') || 'Resmi' };
}

function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Sol modül rayını çizer. Arama kutusu doluysa yalnızca eşleşenler listelenir
 * (ad VE id üzerinden — kullanıcı "optiscaler" yazarak da bulabilsin).
 */
function renderModRail() {
    const tabNav = document.getElementById('mods-tabs-nav');
    const emptyEl = document.getElementById('mods-rail-empty');
    if (!tabNav) return;

    const visible = allModules.filter(mod => {
        if (!railFilter) return true;
        return modDisplayName(mod).toLowerCase().includes(railFilter) ||
            String(mod.id).toLowerCase().includes(railFilter);
    });

    if (emptyEl) emptyEl.style.display = visible.length === 0 ? 'block' : 'none';

    tabNav.innerHTML = visible.map(mod => {
        const isActive = mod.id === currentMod;
        const badge = modTypeBadge(mod.type);
        const name = escapeHtml(modDisplayName(mod));
        const cached = releasesData[mod.id];
        const installedCount = cached && Array.isArray(cached.releases)
            ? cached.releases.filter(r => r.installed).length
            : 0;

        // Kurulu sürüm sayısı yalnızca o modülün listesi bir kez yüklendiyse bilinir;
        // bilinmiyorsa rozet hiç çizilmez (0 yazmak yanıltıcı olurdu).
        const installedBadge = installedCount > 0
            ? `<span class="mods-rail-count" title="${escapeHtml(t('modsTab.installedCountTooltip') || 'İndirilmiş sürüm sayısı')}">${installedCount}</span>`
            : '';

        return `
            <button class="mods-tab-btn mods-rail-item ${isActive ? 'active' : ''}" data-mod="${escapeHtml(mod.id)}" title="${name} · ${escapeHtml(mod.id)}">
                <span class="mods-rail-name">${name}</span>
                <span class="mods-rail-meta">
                    <span class="mods-rail-badge ${badge.cls}">${escapeHtml(badge.label)}</span>
                    ${installedBadge}
                </span>
            </button>`;
    }).join('');
}

/**
 * Sağ panelin üstündeki künye: seçili modülün adı, kaynak türü, id'si,
 * açıklaması ve sürüm sayıları. Kullanıcı hangi modülün listesine baktığını
 * kart yığınına bakmadan görsün diye var.
 */
function renderDetailHeader() {
    const el = document.getElementById('mods-detail-header');
    if (!el) return;

    const mod = allModules.find(m => m.id === currentMod);
    if (!mod) {
        el.innerHTML = '';
        return;
    }

    const badge = modTypeBadge(mod.type);
    const manifest = mod.manifest || {};
    const desc = manifest.description || '';
    const repo = manifest.source?.repo || manifest.source?.url || '';

    const cached = releasesData[mod.id];
    const total = cached && Array.isArray(cached.releases) ? cached.releases.length : null;
    const installed = total !== null ? cached.releases.filter(r => r.installed).length : 0;

    const statsParts = [];
    if (total !== null) {
        statsParts.push(`${total} ${t('modsTab.versionsLabel') || 'sürüm'}`);
        statsParts.push(`${installed} ${t('modsTab.downloadedLabel') || 'indirilmiş'}`);
    }

    el.innerHTML = `
        <div class="mods-detail-top">
            <h3 class="mods-detail-title">${escapeHtml(modDisplayName(mod))}</h3>
            <span class="mods-rail-badge ${badge.cls}">${escapeHtml(badge.label)}</span>
            <code class="mods-detail-id">${escapeHtml(mod.id)}</code>
            ${statsParts.length ? `<span class="mods-detail-stats">${escapeHtml(statsParts.join(' · '))}</span>` : ''}
        </div>
        ${desc ? `<p class="mods-detail-desc">${escapeHtml(desc)}</p>` : ''}
        ${repo ? `<span class="mods-detail-repo" title="${escapeHtml(repo)}">${escapeHtml(repo)}</span>` : ''}
    `;
}

/**
 * Loads release versions for the active mod using the unified manifest system.
 * @param {boolean} forceRefresh - Bypasses cache if true
 * @param {boolean} silent - If true, skips loading skeleton render
 */
export async function loadModReleases(forceRefresh = false, silent = false) {
    const loadingDiv = document.getElementById('mods-loading');
    const container = document.getElementById('mods-versions-container');
    const cacheAgeSpan = document.getElementById('mods-cache-age');

    if (!silent) {
        if (loadingDiv) loadingDiv.style.display = 'block';
        if (container) container.style.display = 'none';
        if (cacheAgeSpan) cacheAgeSpan.textContent = '';
    }

    try {
        let result;
        // Try unified manifest release fetcher first
        if (window.electronAPI && window.electronAPI.moduleGetReleases) {
            result = await window.electronAPI.moduleGetReleases({ moduleId: currentMod, forceRefresh });
        }

        // Fallback to legacy APIs if manifest release fetcher fails or is not available
        if (!result || result.error || !result.success) {
            if (currentMod === 'dlssenabler' && window.electronAPI.getDlssEnablerReleases) {
                result = await window.electronAPI.getDlssEnablerReleases(forceRefresh);
            } else if (currentMod === 'optiscaler' && window.electronAPI.getOptiScalerReleases) {
                result = await window.electronAPI.getOptiScalerReleases(forceRefresh);
            } else if (currentMod === 'optibuilder' && window.electronAPI.getOptiBuilderReleases) {
                result = await window.electronAPI.getOptiBuilderReleases(forceRefresh);
            } else if (currentMod === 'optipatcher' && window.electronAPI.getOptiPatcherReleases) {
                result = await window.electronAPI.getOptiPatcherReleases(forceRefresh);
            } else if (currentMod === 'fsr4' && window.electronAPI.getFsr4Releases) {
                result = await window.electronAPI.getFsr4Releases(forceRefresh);
            } else if (currentMod === 'streamline' && window.electronAPI.getStreamlineReleases) {
                result = await window.electronAPI.getStreamlineReleases(forceRefresh);
            }
        }

        if (result && result.error) throw new Error(result.error);

        const releases = result?.releases ?? [];
        const fetchedAt = result?.fetchedAt ?? null;
        const fromStaleCache = result?.fromStaleCache ?? false;

        // Store in local data cache
        releasesData[currentMod] = {
            releases,
            fetchedAt,
            fromStaleCache
        };

        // Render versions
        renderReleases();

        // Ray rozetleri ve künye sürüm sayılarını bu veriden okuyor
        renderModRail();
        renderDetailHeader();

        // Update cache age span
        if (cacheAgeSpan && fetchedAt) {
            const ageText = formatCacheAge(fetchedAt);
            const staleText = fromStaleCache ? `[${t('releaseCache.fromStaleCache') || 'Önbellek'}] ` : '';
            cacheAgeSpan.innerHTML = `${staleText}${t('releaseCache.lastUpdated') || 'Son güncelleme:'} <strong>${ageText}</strong>`;
        }

        if (loadingDiv) loadingDiv.style.display = 'none';
        if (container) container.style.display = 'grid';
    } catch (e) {
        console.error('[ModsTab] load error:', e);
        if (container) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #ef4444;">
                    ⚠️ ${t('opti.standaloneLoadError') || 'Sürümler yüklenemedi: '}${e.message}
                </div>
            `;
            if (loadingDiv) loadingDiv.style.display = 'none';
            if (container) container.style.display = 'block';
        }
    }
}

/**
 * Renders releases into the versions grid.
 */
function renderReleases() {
    const container = document.getElementById('mods-versions-container');
    if (!container) return;

    container.innerHTML = '';
    const activeData = releasesData[currentMod];
    if (!activeData || !activeData.releases || activeData.releases.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-secondary);">
                ${t('modsTab.noVersions') || 'Kullanılabilir sürüm bulunamadı.'}
            </div>
        `;
        return;
    }

    activeData.releases.forEach(r => {
        const tag = r.tag || r.name;
        
        // Check size
        let sizeStr = '';
        if (r.size) {
            sizeStr = (r.size / (1024 * 1024)).toFixed(1) + ' MB';
        }

        // Check release date
        let dateStr = '';
        if (r.publishedAt) {
            try {
                const date = new Date(r.publishedAt);
                dateStr = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
            } catch (e) {}
        }

        // Create card element
        const card = document.createElement('div');
        card.className = `version-card ${r.installed ? 'active' : ''}`;
        card.setAttribute('data-card-mod', currentMod);
        card.setAttribute('data-card-tag', tag);

        card.innerHTML = `
            <div class="version-info">
                <div class="version-name">${r.name || tag}</div>
                <div class="version-meta">
                    ${sizeStr ? `<span class="version-size">${sizeStr}</span>` : ''}
                    ${sizeStr && dateStr ? '<span class="meta-dot">•</span>' : ''}
                    ${dateStr ? `<span class="version-date">${dateStr}</span>` : ''}
                </div>
                ${r.installed ? `<span class="version-badge active">✔ ${t('modsTab.installed') || 'Yüklendi'}</span>` : ''}
            </div>
            <div class="version-actions"></div>
        `;

        const actionsContainer = card.querySelector('.version-actions');
        
        // Render actions based on current download queue state
        const isCurrentActive = activeDownload && activeDownload.modName === currentMod && activeDownload.tag === tag;
        const queueIdx = downloadQueue.findIndex(item => item.modName === currentMod && item.tag === tag);
        const failMsg = failedDownloads[`${currentMod}-${tag}`];

        if (r.installed) {
            // Open Folder button
            const openBtn = document.createElement('button');
            openBtn.className = 'version-action-btn open-folder';
            openBtn.title = t('modsTab.openFolder') || 'Klasörü Aç';
            openBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
            openBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await window.electronAPI.openModFolder({ modName: currentMod, name: r.name, tag: r.tag });
            });

            // Delete button
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'version-action-btn delete';
            deleteBtn.title = t('modsTab.delete') || 'Sil';
            deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const confirmed = await showConfirmDialog(
                    t('modsTab.deleteConfirmTitle') || 'Sürümü Sil',
                    (t('modsTab.deleteConfirmMsg') || '"{version}" sürümünü silmek istediğinize emin misiniz?').replace('{version}', r.name || tag)
                );
                if (confirmed) {
                    const delResult = await window.electronAPI.deleteModVersion({ modName: currentMod, name: r.name, tag: r.tag });
                    if (delResult.success) {
                        await loadModReleases(false, true); // reload list silently
                    } else {
                        showInfoModal(t('opti.errorTitle') || 'Hata', delResult.error || t('modsTab.deleteFailed') || 'Silme işlemi başarısız oldu.', true);
                    }
                }
            });

            actionsContainer.appendChild(openBtn);
            actionsContainer.appendChild(deleteBtn);
        } else if (isCurrentActive) {
            // Downloading state
            const progressSpan = document.createElement('span');
            progressSpan.className = 'version-action-btn downloading';
            progressSpan.textContent = activeDownload.progressText || '%0';
            actionsContainer.appendChild(progressSpan);
        } else if (queueIdx !== -1) {
            // Waiting in queue state
            const waitingBtn = document.createElement('button');
            waitingBtn.className = 'version-action-btn waiting';
            waitingBtn.title = t('modsTab.waitingTooltip') || 'İndirme kuyruğunda bekliyor. İptal etmek için tıklayın.';
            waitingBtn.textContent = t('modsTab.waiting') || 'Sırada';
            waitingBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeFromQueue(currentMod, tag);
            });
            actionsContainer.appendChild(waitingBtn);
        } else if (failMsg) {
            // Failed state, show Retry
            const retryBtn = document.createElement('button');
            retryBtn.className = 'version-action-btn retry-btn';
            retryBtn.title = (t('modsTab.retryTooltip') || 'Hata: {error}. Tekrar denemek için tıklayın.').replace('{error}', failMsg);
            retryBtn.textContent = t('modsTab.retry') || 'Tekrar Dene';
            retryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                delete failedDownloads[`${currentMod}-${tag}`];
                addToQueue(currentMod, r);
            });
            actionsContainer.appendChild(retryBtn);
        } else {
            // Default download button
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'version-action-btn download-btn';
            downloadBtn.title = t('modsTab.download') || 'İndir';
            downloadBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>`;
            downloadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                addToQueue(currentMod, r);
            });
            actionsContainer.appendChild(downloadBtn);
        }

        container.appendChild(card);
    });
}

/**
 * Adds an item to the download queue.
 */
function addToQueue(modName, release) {
    const tag = release.tag || release.name;
    // Prevent duplicate entries
    if (activeDownload && activeDownload.modName === modName && activeDownload.tag === tag) return;
    if (downloadQueue.some(item => item.modName === modName && item.tag === tag)) return;

    const queueItem = {
        modName,
        name: release.name,
        tag,
        downloadUrl: release.downloadUrl
    };

    if (!activeDownload) {
        startDownload(queueItem);
    } else {
        downloadQueue.push(queueItem);
        // Silent reload of tab view if current mod matches queue mod
        if (currentMod === modName) {
            renderReleases();
        }
    }
}

/**
 * Removes an item from the queue list.
 */
function removeFromQueue(modName, tag) {
    const idx = downloadQueue.findIndex(item => item.modName === modName && item.tag === tag);
    if (idx !== -1) {
        downloadQueue.splice(idx, 1);
        if (currentMod === modName) {
            renderReleases();
        }
    }
}

/**
 * Processes the next item in the download queue.
 */
function processQueue() {
    if (activeDownload || downloadQueue.length === 0) return;
    const nextItem = downloadQueue.shift();
    startDownload(nextItem);
}

/**
 * Starts download of a mod release and listens to dynamic progress.
 */
async function startDownload(item) {
    activeDownload = item;
    activeDownload.progressText = '%0';

    // Rerender tab to reflect active downloading state
    if (currentMod === item.modName) {
        renderReleases();
    }

    const progressCallback = (data) => {
        if (activeDownload && activeDownload.modName === (data.moduleId || item.modName)) {
            if (data.stage === 'extracting') {
                activeDownload.progressText = t('modsTab.extracting') || 'Açılıyor...';
            } else {
                activeDownload.progressText = `%${data.percent || 0}`;
            }
            
            // Dynamically update UI if the card is currently visible
            const cardActions = document.querySelector(`[data-card-mod="${item.modName}"][data-card-tag="${item.tag}"] .version-actions`);
            if (cardActions) {
                const btn = cardActions.querySelector('.downloading');
                if (btn) {
                    btn.textContent = activeDownload.progressText;
                }
            }
        }
    };

    // Bind unified module download progress listener
    if (window.electronAPI && window.electronAPI.onModuleDownloadProgress) {
        window.electronAPI.removeModuleDownloadProgressListeners();
        window.electronAPI.onModuleDownloadProgress(progressCallback);
    }

    // Also bind legacy progress listeners for backwards compatibility
    if (item.modName === 'dlssenabler' && window.electronAPI.onDlssEnablerDownloadProgress) {
        window.electronAPI.removeDlssEnablerProgressListeners();
        window.electronAPI.onDlssEnablerDownloadProgress(progressCallback);
    } else if (item.modName === 'optiscaler' && window.electronAPI.onOptiscalerDownloadProgress) {
        window.electronAPI.removeOptiScalerProgressListeners();
        window.electronAPI.onOptiscalerDownloadProgress(progressCallback);
    } else if (item.modName === 'optibuilder' && window.electronAPI.onOptiBuilderDownloadProgress) {
        window.electronAPI.removeOptiBuilderProgressListeners();
        window.electronAPI.onOptiBuilderDownloadProgress(progressCallback);
    } else if (item.modName === 'optipatcher' && window.electronAPI.onOptipatcherDownloadProgress) {
        window.electronAPI.removeOptiPatcherProgressListeners();
        window.electronAPI.onOptipatcherDownloadProgress(progressCallback);
    } else if (item.modName === 'fsr4' && window.electronAPI.onFsr4DownloadProgress) {
        window.electronAPI.removeFsr4ProgressListeners();
        window.electronAPI.onFsr4DownloadProgress(progressCallback);
    } else if (item.modName === 'streamline' && window.electronAPI.onStreamlineDownloadProgress) {
        window.electronAPI.removeStreamlineProgressListeners();
        window.electronAPI.onStreamlineDownloadProgress(progressCallback);
    }

    try {
        let result;
        // Try unified manifest download first
        if (window.electronAPI && window.electronAPI.moduleDownloadRelease) {
            result = await window.electronAPI.moduleDownloadRelease({
                moduleId: item.modName,
                tag: item.tag,
                downloadUrl: item.downloadUrl
            });
        }

        // Fallback to legacy APIs if moduleDownloadRelease fails or is unavailable
        if (!result || !result.success) {
            if (item.modName === 'dlssenabler' && window.electronAPI.downloadDlssEnablerRelease) {
                result = await window.electronAPI.downloadDlssEnablerRelease({ name: item.name, downloadUrl: item.downloadUrl });
            } else if (item.modName === 'optiscaler' && window.electronAPI.downloadOptiScalerRelease) {
                result = await window.electronAPI.downloadOptiScalerRelease({ tag: item.tag, downloadUrl: item.downloadUrl });
            } else if (item.modName === 'optibuilder' && window.electronAPI.downloadOptiBuilderRelease) {
                result = await window.electronAPI.downloadOptiBuilderRelease({ tag: item.tag, downloadUrl: item.downloadUrl });
            } else if (item.modName === 'optipatcher' && window.electronAPI.downloadOptiPatcherRelease) {
                result = await window.electronAPI.downloadOptiPatcherRelease({ tag: item.tag, downloadUrl: item.downloadUrl });
            } else if (item.modName === 'fsr4' && window.electronAPI.downloadFsr4Release) {
                result = await window.electronAPI.downloadFsr4Release({ name: item.name, downloadUrl: item.downloadUrl });
            } else if (item.modName === 'streamline' && window.electronAPI.downloadStreamlineRelease) {
                result = await window.electronAPI.downloadStreamlineRelease({ tag: item.tag, downloadUrl: item.downloadUrl });
            }
        }

        cleanupProgressListeners(item.modName);

        if (result && result.success) {
            // Success! Remove from failed list if it was there
            delete failedDownloads[`${item.modName}-${item.tag}`];
            
            // Reload list silent to reflect installed badge & open folder actions
            if (currentMod === item.modName) {
                await loadModReleases(false, true);
            }
        } else {
            failedDownloads[`${item.modName}-${item.tag}`] = result ? result.error : (t('updates.unknownError') || 'Bilinmeyen hata');
            if (currentMod === item.modName) {
                renderReleases();
            }
        }
    } catch (e) {
        cleanupProgressListeners(item.modName);
        failedDownloads[`${item.modName}-${item.tag}`] = e.message;
        if (currentMod === item.modName) {
            renderReleases();
        }
    } finally {
        activeDownload = null;
        // Process next item in download queue
        processQueue();
    }
}

function cleanupProgressListeners(modName) {
    if (window.electronAPI && window.electronAPI.removeModuleDownloadProgressListeners) {
        window.electronAPI.removeModuleDownloadProgressListeners();
    }
    if (modName === 'dlssenabler' && window.electronAPI.removeDlssEnablerProgressListeners) window.electronAPI.removeDlssEnablerProgressListeners();
    else if (modName === 'optiscaler' && window.electronAPI.removeOptiScalerProgressListeners) window.electronAPI.removeOptiScalerProgressListeners();
    else if (modName === 'optibuilder' && window.electronAPI.removeOptiBuilderProgressListeners) window.electronAPI.removeOptiBuilderProgressListeners();
    else if (modName === 'optipatcher' && window.electronAPI.removeOptiPatcherProgressListeners) window.electronAPI.removeOptiPatcherProgressListeners();
    else if (modName === 'fsr4' && window.electronAPI.removeFsr4ProgressListeners) window.electronAPI.removeFsr4ProgressListeners();
    else if (modName === 'streamline' && window.electronAPI.removeStreamlineProgressListeners) window.electronAPI.removeStreamlineProgressListeners();
}
