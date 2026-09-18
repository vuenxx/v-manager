import { state } from '../state.js';
import { openModal, closeModal, setManualAddCloseGuard } from './modals/base.js';
import { showConfirmModal } from './blacklist.js';
import { openSettingsModal } from './modals/settings.js';
import { showInfoModal, showLauncherWarningModal, showConfirmDialog } from './modals/info.js';
import { renderModSelectionModal } from './modals/modSelection.js';
import { t } from '../i18n/i18n.js';

// Get elements helper to ensure they exist before use
const getGamesContainer = () => document.getElementById('games-container');
const getLoadingEl = () => document.getElementById('loading-games');
const getAddGameBtn = () => document.getElementById('add-game-btn');

/** Manifest'ten gelen metinleri innerHTML'e gömmeden önce kaçır. */
function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─── Modül kataloğu önbelleği ────────────────────────────────────────────────
// Kart görünümü senkron çizildiği için manifest listesi burada bir kez tutulur.
// Boşsa aşağıdaki LEGACY_MOD_FIELDS eşlemesi devreye girer (eski davranış).
let _moduleCatalog = null;

export async function preloadModuleCatalog(force = false) {
    if (_moduleCatalog && !force) return _moduleCatalog;
    try {
        if (window.electronAPI && window.electronAPI.moduleList) {
            const mods = await window.electronAPI.moduleList();
            _moduleCatalog = Array.isArray(mods) ? mods : [];
        } else {
            _moduleCatalog = [];
        }
    } catch (e) {
        console.warn('[RENDERER games.js] Modül kataloğu alınamadı:', e.message);
        _moduleCatalog = [];
    }
    return _moduleCatalog;
}

// Manifest kataloğu yüklenemediğinde kullanılan yedek eşleme
// (games.json'daki eski, sabit alan adları → modül id'si).
const LEGACY_MOD_FIELDS = [
    { modId: 'dlssenabler', flag: 'hasDlssEnabler', versionField: 'dlssEnablerVersion' },
    { modId: 'optibuilder', flag: 'hasOptiBuilder', versionField: 'optiBuilderVersion' },
    { modId: 'optiscaler', flag: 'hasOptiscaler', versionField: 'optiscalerVersion' },
    { modId: 'streamline', flag: 'hasStreamline', versionField: 'streamlineVersion' }
];

/**
 * Oyunda kurulu modları `{ modId, version }` listesi olarak döndürür.
 *
 * Kart görünümü mod ADI veya açıklaması yerine manifest'teki `id`'yi gösterir —
 * kullanıcı hangi modülün kurulu olduğunu tek bir kanonik adla görür.
 */
export function getInstalledModEntries(game) {
    if (!game) return [];

    const entries = [];
    const seen = new Set();

    const push = (modId, version) => {
        if (!modId) return;
        const key = String(modId).toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        entries.push({ modId, version: version || null });
    };

    if (_moduleCatalog && _moduleCatalog.length > 0) {
        for (const mod of _moduleCatalog) {
            const st = mod.manifest && mod.manifest.state;
            if (!st) continue;
            const installed = (st.flag && game[st.flag] === true) ||
                (game.installedMods && game.installedMods[mod.id] && game.installedMods[mod.id].installed);
            if (!installed) continue;
            push(mod.id, st.versionField ? game[st.versionField] : null);
        }
    } else {
        // Katalog yok — eski sabit alanlardan oku
        for (const legacy of LEGACY_MOD_FIELDS) {
            if (game[legacy.flag] === true) push(legacy.modId, game[legacy.versionField]);
        }
    }

    // Manifest'i çözülemeyen ama state'e yazılmış modüller de listelenmeli
    if (game.installedMods && typeof game.installedMods === 'object') {
        for (const [modId, info] of Object.entries(game.installedMods)) {
            if (info && info.installed) push(modId, info.version);
        }
    }

    return entries;
}

/** "modid v1.2.3" — sürüm yoksa yalnızca id. */
function formatModEntry(entry) {
    if (!entry.version) return entry.modId;
    const v = String(entry.version);
    return `${entry.modId} ${v.startsWith('v') ? v : 'v' + v}`;
}

export function hasAnyActiveMod(game) {
    if (!game) return false;
    if (game.hasDlssEnabler || game.hasStreamline || game.hasOptiscaler || game.hasOptiBuilder) return true;
    if (game.installedMods && typeof game.installedMods === 'object') {
        return Object.values(game.installedMods).some(m => m && m.installed);
    }
    return false;
}

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

    // ── Kurulu mod etiketleri ────────────────────────────────────────────
    // Etiket metni manifest `id`'si + kurulu sürüm. Kartta en fazla 3 etiket
    // gösterilir; kalanlar "+N" rozetine toplanır (tooltip liste görünümüne
    // yönlendirir), aksi hâlde etiketler kapak görselini tamamen kaplıyor.
    const MAX_CARD_MOD_TAGS = 3;
    const installedEntries = getInstalledModEntries(game);
    const visibleEntries = installedEntries.slice(0, MAX_CARD_MOD_TAGS);
    const hiddenCount = installedEntries.length - visibleEntries.length;

    let modTagsHtml = '';
    let currentBottom = 10;

    visibleEntries.forEach(entry => {
        modTagsHtml += `<div class="dlss-tag" style="bottom: ${currentBottom}px;" title="${escapeHtml(formatModEntry(entry))}">${escapeHtml(formatModEntry(entry))}</div>`;
        currentBottom += 34;
    });

    if (hiddenCount > 0) {
        const moreTooltip = t('games.moreModsTooltip') ||
            'Birden fazla mod tespit edildi, görebilmek için lütfen liste görünümüne geçin.';
        modTagsHtml += `<div class="dlss-tag dlss-tag-more" style="bottom: ${currentBottom}px;" data-tooltip="${escapeHtml(moreTooltip)}">+${hiddenCount}</div>`;
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

    const hasMod = hasAnyActiveMod(game);

    card.innerHTML = `
        <div class="game-cover-wrapper">
            <div class="source-tag">${sourceLabel}</div>
            ${coverHtml}
            ${modTagsHtml}
            <div class="game-cover-overlay">
                <div class="game-actions-wrapper">
                    <button class="game-launch-btn" data-game="${game.name}"> ${t('games.launchGame')}</button>
                    <button class="mod-install-btn" data-game="${game.name}">${t('games.installMod')}</button>
                    ${hasMod ? `<button class="mod-manage-btn" data-game="${game.name}">${t('games.manageMod')}</button>` : ''}
                </div>
                <button class="remove-game-btn" data-game="${game.name}">${t('games.removeGame')}</button>
            </div>
        </div>
        <div class="game-info">
            <button class="favorite-btn ${game.isFavorite ? 'active' : ''}" data-game="${game.name}">
                ${game.isFavorite ? '★' : '☆'}
            </button>
            <button class="refresh-game-btn" data-game="${game.name}" title="Oyunu Yenile">↻</button>
            <div class="game-title">${game.name}</div>
            ${upscalerHtml}
        </div>
    `;

    // Bind events using shared helper
    bindGameEvents(card, game);

    // Add verified compatibility badge if developer-supported or DLSS Enabler supported
    const normKey = game.name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
        .replace(/\s+/g, '-');

    if (window.electronAPI) {
        const getDev = window.electronAPI.getDeveloperGames ? window.electronAPI.getDeveloperGames() : Promise.resolve({});
        const getDlss = window.electronAPI.getDlssEnablerGames ? window.electronAPI.getDlssEnablerGames() : Promise.resolve({});

        Promise.all([getDev, getDlss]).then(([devGames, dlssGamesRaw]) => {
            const dlssGames = {};
            if (dlssGamesRaw) {
                for (const name of Object.keys(dlssGamesRaw)) {
                    const normalized = name
                        .toLowerCase()
                        .replace(/[^a-z0-9\s]/g, '')
                        .trim()
                        .replace(/\s+/g, '-');
                    dlssGames[normalized] = dlssGamesRaw[name];
                }
            }

            const isDlssSupported = dlssGames && dlssGames[normKey];
            const isDevSupported = devGames && devGames[normKey];

            if (isDlssSupported) {
                card.classList.add('dlss-supported');
            }

            if (isDlssSupported || isDevSupported) {
                let compatibility = 'green';
                if (!isDlssSupported && isDevSupported) {
                    compatibility = devGames[normKey].compatibility || 'green';
                }

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
            console.error("Error loading games support data inside card:", err);
        });
    }

    return card;
}

function bindGameEvents(el, game) {
    const launchBtn = el.querySelector('.game-launch-btn');
    if (launchBtn) {
        launchBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (window.electronAPI && window.electronAPI.launchGame) {
                try {
                    const result = await window.electronAPI.launchGame(game);
                    if (!result.success) {
                        showInfoModal(t('dlss.errorTitle'), result.error || 'Oyun başlatılamadı.', true);
                    }
                } catch (err) {
                    console.error("Game launch error:", err);
                    showInfoModal(t('dlss.errorTitle'), err.message || 'Oyun başlatılırken bir hata oluştu.', true);
                }
            }
        });
    }

    const favoriteBtn = el.querySelector('.favorite-btn');
    if (favoriteBtn) {
        favoriteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (window.electronAPI && window.electronAPI.toggleFavorite) {
                const updatedGames = await window.electronAPI.toggleFavorite(game.name);
                renderGames(updatedGames);
            }
        });
    }

    const removeBtn = el.querySelector('.remove-game-btn');
    if (removeBtn) {
        removeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            showConfirmModal(game.name, el);
        });
    }

    const modBtn = el.querySelector('.mod-install-btn');
    if (modBtn) {
        modBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openModModal(game);
        });
    }

    const manageBtn = el.querySelector('.mod-manage-btn');
    if (manageBtn) {
        manageBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                openSettingsModal(game);
            } catch (err) {
                console.error('[RENDERER games.js] Error in click event openSettingsModal:', err);
            }
        });
    }

    const refreshBtn = el.querySelector('.refresh-game-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await refreshGame(game);
        });
    }

    const settingsBtn = el.querySelector('.mod-settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                openSettingsModal(game);
            } catch (err) {
                console.error('[RENDERER games.js] Error in click event openSettingsModal:', err);
            }
        });
    }
}

export function createGameListItem(game) {
    const row = document.createElement('div');
    row.className = 'game-list-row';
    row.title = game.exePath || '';

    let coverHtml = '';
    if (game.cover) {
        coverHtml = `<img src="${game.cover}" alt="${game.name}" class="game-list-icon-img">`;
    } else {
        coverHtml = `<div style="font-size: 18px;">🎮</div>`;
    }

    let sourceLabel = t('games.sourceManual');
    if (game.source === 'steam') sourceLabel = 'Steam';
    else if (game.source === 'epic') sourceLabel = 'Epic Games';
    else if (game.source === 'gog') sourceLabel = 'GOG';
    else if (game.source === 'ea') sourceLabel = 'EA Play';
    else if (game.source === 'ubisoft') sourceLabel = 'Ubisoft';
    else if (game.source === 'rockstar') sourceLabel = 'Rockstar';
    else if (game.source === 'xbox') sourceLabel = 'Xbox';
    else if (game.source === 'registry') sourceLabel = t('games.sourceRegistry');

    // Build Compact Monochromatic Mod Chips for Mod/Optimizasyon Sütunu
    const modChips = [];
    if (game.hasDlssEnabler) {
        const ver = game.dlssEnablerVersion ? ` v${game.dlssEnablerVersion}` : '';
        modChips.push({ label: `DLSS Enabler${ver}` });
    }
    if (game.hasOptiBuilder) {
        const ver = game.optiBuilderVersion ? ` ${game.optiBuilderVersion}` : '';
        modChips.push({ label: `OptiBuilder${ver}` });
    } else if (game.hasOptiscaler) {
        const ver = game.optiscalerVersion ? ` ${game.optiscalerVersion}` : '';
        modChips.push({ label: `OptiScaler${ver}` });
    }
    if (game.hasStreamline) {
        const ver = game.streamlineVersion ? ` v${game.streamlineVersion}` : '';
        modChips.push({ label: `Streamline${ver}` });
    }

    // Add modular installed mods
    if (game.installedMods && typeof game.installedMods === 'object') {
        for (const [modId, info] of Object.entries(game.installedMods)) {
            if (info && info.installed) {
                const isLegacy = (modId === 'dlssenabler' || modId === 'streamline' || modId === 'optiscaler' || modId === 'optibuilder');
                if (!isLegacy) {
                    const ver = info.version ? ` v${info.version}` : '';
                    modChips.push({ label: `${info.name || modId}${ver}` });
                }
            }
        }
    }

    let modColHtml = '';
    if (modChips.length === 0) {
        modColHtml = `<span style="color: var(--text-secondary); opacity: 0.5;">–</span>`;
    } else if (modChips.length <= 4) {
        modColHtml = `<div class="compact-mod-row">` + 
            modChips.map(c => `<span class="compact-chip">${c.label}</span>`).join('') +
            `</div>`;
    } else {
        const visibleChips = modChips.slice(0, 3);
        const hiddenChips = modChips.slice(3);
        const hiddenTooltip = hiddenChips.map(c => c.label).join(', ');
        modColHtml = `<div class="compact-mod-row">` + 
            visibleChips.map(c => `<span class="compact-chip">${c.label}</span>`).join('') +
            `<span class="compact-chip compact-chip-more" data-tooltip="${hiddenTooltip}">+${hiddenChips.length}</span>` +
            `</div>`;
    }

    let upscalerHtml = '';
    if (game.upscalers) {
        if (game.upscalers.dlss) upscalerHtml += '<span class="utag utag-dlss">DLSS</span>';
        if (game.upscalers.xess) upscalerHtml += '<span class="utag utag-xess">XeSS</span>';
        if (game.upscalers.fsr) upscalerHtml += '<span class="utag utag-fsr">FSR</span>';
    }

    let versionText = game.version || game.dlssEnablerVersion || game.optiBuilderVersion || game.optiscalerVersion || game.streamlineVersion || '-';
    if (versionText !== '-' && !versionText.startsWith('v')) {
        versionText = `v${versionText}`;
    }

    const hasAnyMod = hasAnyActiveMod(game);

    const launchTooltip = t('games.launchGame') || 'Oyunu Başlat';
    const installTooltip = t('games.installMod') || 'Mod Kur';
    const manageTooltip = t('games.manageMod') || 'Modu Yönet';
    const removeTooltip = t('games.removeGame') || 'Oyunu Kaldır';

    row.innerHTML = `
        <div class="game-list-icon-cell">${coverHtml}</div>
        <div class="game-list-title-cell" title="${game.name}">${game.name}</div>
        <div class="game-list-platform-cell"><span class="platform-text-badge">${sourceLabel}</span></div>
        <div class="game-list-version-cell">${versionText}</div>
        <div class="game-list-mods-cell">${modColHtml}</div>
        <div class="game-list-tech-cell">${upscalerHtml}</div>
        <div class="list-actions-group">
            <button class="icon-action-btn launch-btn game-launch-btn btn-play" data-game="${game.name}" data-tooltip="${launchTooltip}">▶</button>
            <button class="icon-action-btn mod-install-btn btn-kur" data-game="${game.name}" data-tooltip="${installTooltip}">⚡</button>
            ${hasAnyMod ? `<button class="icon-action-btn mod-manage-btn btn-yonet" data-game="${game.name}" data-tooltip="${manageTooltip}">🔄</button>` : ''}
            <button class="icon-action-btn remove-btn remove-game-btn btn-sil" data-game="${game.name}" data-tooltip="${removeTooltip}">🗑️</button>
            <div class="favorite-star-separator"></div>
            <button class="refresh-game-btn list-refresh-btn" data-game="${game.name}" title="Oyunu Yenile">↻</button>
            <button class="favorite-btn ${game.isFavorite ? 'active' : ''}" data-game="${game.name}" title="Favorilere Ekle/Çıkar">
                ${game.isFavorite ? '★' : '☆'}
            </button>
        </div>
    `;

    bindGameEvents(row, game);

    // Add green border if game is supported in DLSS Enabler or Developer list
    const normKey = game.name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
        .replace(/\s+/g, '-');

    if (window.electronAPI) {
        const getDev = window.electronAPI.getDeveloperGames ? window.electronAPI.getDeveloperGames() : Promise.resolve({});
        const getDlss = window.electronAPI.getDlssEnablerGames ? window.electronAPI.getDlssEnablerGames() : Promise.resolve({});

        Promise.all([getDev, getDlss]).then(([devGames, dlssGamesRaw]) => {
            const dlssGames = {};
            if (dlssGamesRaw) {
                for (const name of Object.keys(dlssGamesRaw)) {
                    const normalized = name
                        .toLowerCase()
                        .replace(/[^a-z0-9\s]/g, '')
                        .trim()
                        .replace(/\s+/g, '-');
                    dlssGames[normalized] = dlssGamesRaw[name];
                }
            }

            const isDlssSupported = dlssGames && dlssGames[normKey];
            const isDevSupported = devGames && devGames[normKey];

            if (isDlssSupported || isDevSupported) {
                row.classList.add('dlss-supported');
            }
        });
    }

    return row;
}

function openModModal(game) {
    renderModSelectionModal(game);
}

/**
 * DOM içerisinde belirli bir oyuna ait kartı bulur (grid veya liste modunda).
 * CSS seçici kaçış hatalarına karşı doğrudan öznitelik ve başlık kontrolü yapar.
 * @param {string} gameName
 * @returns {HTMLElement|null}
 */
export function findGameCardElement(gameName) {
    if (!gameName) return null;
    const container = getGamesContainer();
    if (!container) return null;

    const cards = container.querySelectorAll('.game-cover-card, .game-list-row');
    const targetNorm = gameName.trim().toLowerCase();

    for (const card of cards) {
        const els = card.querySelectorAll('[data-game]');
        for (const el of els) {
            const val = el.getAttribute('data-game');
            if (val && (val === gameName || val.trim().toLowerCase() === targetNorm)) {
                return card;
            }
        }
        const titleEl = card.querySelector('.game-title, .game-list-title');
        if (titleEl && titleEl.textContent.trim().toLowerCase() === targetNorm) {
            return card;
        }
    }
    return null;
}

/**
 * Tekil yenileme sonrası gelen güncel game verisini DOM'da yerine koy.
 * Grid modunda .game-cover-card, liste modunda .game-list-row öğesini günceller.
 */
export function updateExistingGameCard(game) {
    if (!game || !game.name) return;
    const existingCard = findGameCardElement(game.name);
    if (!existingCard) {
        console.warn('[RENDERER] Kart bulunamadı, güncellenemedi:', game.name);
        return;
    }

    const isListView = state.gamesViewMode === 'list';
    const newCard = isListView ? createGameListItem(game) : createGameCard(game);
    existingCard.replaceWith(newCard);
    console.log('[RENDERER] Oyun kartı başarıyla güncellendi:', game.name);
}

/**
 * Oyun klasörü bulunamadığında kullanıcıya onay soran basit dialog.
 * @param {string} gameName
 * @returns {Promise<boolean>} Kullanıcı "Evet" seçtiyse true
 */
function showGameNotFoundDialog(gameName) {
    return showConfirmDialog(
        'Oyun Bulunamadı',
        `"${gameName}" artık mevcut konumunda bulunamıyor.\nListeden kaldırılsın mı?`
    );
}

/**
 * Bir oyun için yenileme fonksiyonunu çalıştırır ve arayüzdeki "Oyunu Yenile" (↻) butonunu tetikler.
 * Mod kurulduğunda veya butona tıklandığında otomatik olarak tekil taramayı yürütür.
 * @param {Object|string} game Oyun nesnesi veya oyun adı
 * @param {Object} [options]
 * @param {boolean} [options.silent=false]
 * @returns {Promise<Object|null>}
 */
export async function refreshGame(game, options = {}) {
    if (!game) return null;
    const gameName = typeof game === 'string' ? game : game.name;
    if (!gameName) return null;

    // Tam tarama devam ediyorsa uyar
    if (state.isScanning) {
        if (!options.silent) {
            showInfoModal(
                'Tarama Devam Ediyor',
                'Oyun listesi taranırken tekil yenileme yapılamaz. Lütfen tarama tamamlandıktan sonra tekrar deneyin.',
                true
            );
        }
        return null;
    }

    // Başka bir tekil yenileme zaten sürüyorsa uyar
    if (state.isRefreshingSingle) {
        if (!options.silent) {
            showInfoModal(
                'Yenileme Devam Ediyor',
                'Bir oyun zaten yenileniyor. Lütfen bitmesini bekleyin.',
                true
            );
        }
        return null;
    }

    const existingCard = findGameCardElement(gameName);
    const refreshBtn = existingCard ? existingCard.querySelector('.refresh-game-btn') : null;

    state.isRefreshingSingle = true;
    if (refreshBtn) {
        refreshBtn.classList.add('spinning');
        refreshBtn.disabled = true;
    }

    let targetGame = typeof game === 'object' ? game : null;
    if (!targetGame || (!targetGame.exePath && !targetGame.exe_path && !targetGame.gameRoot && !targetGame.game_root)) {
        try {
            const allGames = await window.electronAPI.getGames();
            const found = allGames ? allGames.find(g => g.name.trim().toLowerCase() === gameName.trim().toLowerCase()) : null;
            if (found) targetGame = { ...found, ...(targetGame || {}) };
        } catch (e) {
            console.error('[RENDERER] refreshGame getGames error:', e);
        }
    }
    if (!targetGame) targetGame = { name: gameName };

    try {
        const result = await window.electronAPI.refreshSingleGame({
            name: targetGame.name,
            exePath: targetGame.exePath || targetGame.exe_path,
            gameRoot: targetGame.gameRoot || targetGame.game_root,
            source: targetGame.source,
            launcherId: targetGame.launcherId,
            cover: targetGame.cover
        });

        if (result && !result.exists) {
            const confirmed = await showGameNotFoundDialog(targetGame.name);
            if (confirmed) {
                await window.electronAPI.removeGame(targetGame.name);
                if (existingCard) existingCard.remove();
            }
        } else if (result && result.error === 'scan_in_progress') {
            if (!options.silent) {
                showInfoModal(
                    'Tarama Devam Ediyor',
                    'Arka planda bir tarama devam etmekte. Lütfen daha sonra tekrar deneyin.',
                    true
                );
            }
        }

        // Kartın en son taranan verilerle anında güncellendiğinden emin ol
        try {
            const allGames = await window.electronAPI.getGames();
            const updated = allGames ? allGames.find(g => g.name.trim().toLowerCase() === gameName.trim().toLowerCase()) : null;
            if (updated) {
                updateExistingGameCard(updated);
            }
        } catch (e) {}

        return result;
    } catch (err) {
        console.error('[RENDERER] refreshGame error:', err);
        return null;
    } finally {
        state.isRefreshingSingle = false;
        if (refreshBtn) {
            refreshBtn.classList.remove('spinning');
            refreshBtn.disabled = false;
        }
    }
}

if (typeof window !== 'undefined') {
    window.refreshGame = refreshGame;
}

export function renderGames(games) {
    const container = getGamesContainer();
    const loading = getLoadingEl();
    if (!container) return;

    const isListView = state.gamesViewMode === 'list';
    if (isListView) {
        container.className = 'games-list-view';
    } else {
        container.className = 'games-grid';
    }

    const searchInput = document.getElementById('game-search-input');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const activePlatform = state.activePlatformFilter;

    const filteredGames = games.filter(game => {
        const matchesSearch = query ? game.name.toLowerCase().includes(query) : true;
        const matchesPlatform = activePlatform ? (game.source || '').toLowerCase() === activePlatform : true;
        return matchesSearch && matchesPlatform;
    });

    container.innerHTML = '';

    const loadingVisible = loading && (loading.style.display !== 'none') && loading.style.display !== '';
    if (filteredGames.length === 0 && !loadingVisible) {
        if (query) {
            container.innerHTML = `<p style="color: var(--text-secondary); text-align: center; grid-column: 1 / -1; padding: 20px;">${t('games.noGamesSearch')}</p>`;
        } else {
            container.innerHTML = `<p style="color: var(--text-secondary); text-align: center; grid-column: 1 / -1; padding: 20px;">${t('games.noGames')}</p>`;
        }
        return;
    }

    if (isListView) {
        const headerRow = document.createElement('div');
        headerRow.className = 'games-list-header';
        headerRow.innerHTML = `
            <div>${t('games.colIcon') || 'İkon'}</div>
            <div>${t('games.colName') || 'Oyun Adı'}</div>
            <div>${t('games.colPlatform') || 'Platform'}</div>
            <div>${t('games.colVersion') || 'Versiyon'}</div>
            <div>${t('games.colMods') || 'Mod / Optimizasyon'}</div>
            <div>${t('games.colTech') || 'Teknolojiler'}</div>
            <div style="text-align: right; padding-right: 8px;">${t('games.colActions') || 'Eylemler'}</div>
        `;
        container.appendChild(headerRow);
    }

    const sortedGames = [...filteredGames].sort((a, b) => {
        if (a.isFavorite && !b.isFavorite) return -1;
        if (!a.isFavorite && b.isFavorite) return 1;

        if (state.gameSortMethod === 'source') {
            const sourceA = (a.source || '').toLowerCase();
            const sourceB = (b.source || '').toLowerCase();
            if (sourceA < sourceB) return -1;
            if (sourceA > sourceB) return 1;
        }

        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
    });

    sortedGames.forEach(game => {
        if (isListView) {
            container.appendChild(createGameListItem(game));
        } else {
            container.appendChild(createGameCard(game));
        }
    });
}

export async function updateHomeStats() {
    try {
        const games = await window.electronAPI.getGames();
        const totalGames = games ? games.length : 0;
        
        let moddedGames = 0;
        if (games) {
            games.forEach(g => {
                if (g.hasDlssEnabler || g.hasOptiscaler || g.hasOptiBuilder || g.hasStreamline) {
                    moddedGames++;
                }
            });
        }
        
        const totalGamesEl = document.getElementById('home-stat-games-count');
        const moddedGamesEl = document.getElementById('home-stat-mods-count');
        if (totalGamesEl) totalGamesEl.textContent = totalGames;
        if (moddedGamesEl) moddedGamesEl.textContent = moddedGames;
        
        if (window.electronAPI.getAppVersion) {
            const version = await window.electronAPI.getAppVersion();
            const versionEl = document.getElementById('home-stat-version-value');
            if (versionEl) versionEl.textContent = `v${version}`;
        }
    } catch (err) {
        console.error('Failed to update home stats:', err);
    }
}

export async function initGames() {
    try {
        const loading = getLoadingEl();
        const container = getGamesContainer();

        // Kart etiketleri manifest id'lerini gösteriyor — katalog çizimden önce hazır olmalı
        await preloadModuleCatalog();

        let games = await window.electronAPI.getGames();

        if (!games || games.length === 0) {
            state.isScanning = true;

            // Disable sort dropdown
            const sortSelectEl = document.getElementById('game-sort-select');
            if (sortSelectEl) sortSelectEl.disabled = true;

            if (loading) {
                loading.style.display = 'block';
                loading.textContent = `${t('games.scanningShort')} (0%)`;
            }
            if (container) container.innerHTML = '';

            // Reset progress modal elements
            const progressTitle = document.getElementById('scan-progress-title');
            if (progressTitle) progressTitle.textContent = t('games.scanTitle');

            const runningArea = document.getElementById('scan-progress-running-area');
            if (runningArea) runningArea.style.display = 'block';

            const resultsArea = document.getElementById('scan-custom-results-area');
            if (resultsArea) resultsArea.style.display = 'none';

            const progressModal = document.getElementById('scan-progress-modal');
            if (progressModal) {
                const content = progressModal.querySelector('.modal-content');
                if (content) content.style.maxWidth = '';
            }

            const progressBar = document.getElementById('scan-progress-bar');
            const progressPercent = document.getElementById('scan-progress-percent');
            const progressStatus = document.getElementById('scan-progress-status');
            if (progressBar) progressBar.style.width = '0%';
            if (progressPercent) progressPercent.textContent = '0%';
            if (progressStatus) progressStatus.textContent = t('games.preparingLabel');

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
    // Handle View Switcher (Grid vs List View)
    const gridBtn = document.getElementById('view-mode-grid-btn');
    const listBtn = document.getElementById('view-mode-list-btn');

    const updateViewSwitchUI = () => {
        const currentMode = state.gamesViewMode;
        if (gridBtn) gridBtn.classList.toggle('active', currentMode === 'grid');
        if (listBtn) listBtn.classList.toggle('active', currentMode === 'list');
    };

    updateViewSwitchUI();

    if (gridBtn) {
        gridBtn.addEventListener('click', async () => {
            if (state.gamesViewMode === 'grid') return;
            state.gamesViewMode = 'grid';
            localStorage.setItem('vmanager_games_view_mode', 'grid');
            updateViewSwitchUI();
            const games = await window.electronAPI.getGames();
            renderGames(games || []);
        });
    }

    if (listBtn) {
        listBtn.addEventListener('click', async () => {
            if (state.gamesViewMode === 'list') return;
            state.gamesViewMode = 'list';
            localStorage.setItem('vmanager_games_view_mode', 'list');
            updateViewSwitchUI();
            const games = await window.electronAPI.getGames();
            renderGames(games || []);
        });
    }

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

        const loading = getLoadingEl();
        if (loading && loading.style.display !== 'none') {
            loading.textContent = `${t('games.scanningShort')} (${percent}%)`;
        }
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
        manualExeBrowseBtn.addEventListener('click', () => {
            showLauncherWarningModal(async () => {
                const selected = await window.electronAPI.selectExe();
                if (selected && manualExeInput) {
                    manualExeInput.value = selected;
                    if (manualExeHint) manualExeHint.style.display = 'none'; // user chose manually
                }
            });
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

    const handleManualAddCloseAttempt = async () => {
        const confirmed = await showConfirmDialog(
            t('manualAdd.cancelConfirmTitle') || 'Emin misiniz?',
            t('manualAdd.cancelConfirmMessage') || 'Yaptığınız değişiklikler kaydedilmeyecektir. Onaylıyor musunuz?'
        );
        if (confirmed) {
            closeModal('manual-add-modal');
            pendingManualResult = null;
        }
    };

    setManualAddCloseGuard(handleManualAddCloseAttempt);

    if (manualAddCancelBtn) {
        manualAddCancelBtn.addEventListener('click', () => {
            window.electronAPI.logToMain('Manual add canceled');
            handleManualAddCloseAttempt();
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

        // Tam tarama devam ediyorsa → kart ekle (mevcut davranış)
        if (state.isScanning) {
            const searchInput = document.getElementById('game-search-input');
            const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
            if (query && !game.name.toLowerCase().includes(query)) return;

            const noGameMsg = container.querySelector('p');
            if (noGameMsg) noGameMsg.remove();

            // During scan, we append to avoid full re-renders,
            // but sorting will be fixed onScanComplete
            container.appendChild(createGameCard(game));
            return;
        }

        // Tekil yenileme → mevcut kartı güncelle
        updateExistingGameCard(game);
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

    // Platform tags filter listeners
    const platformBtns = document.querySelectorAll('.platform-tag-btn');
    platformBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            const platform = btn.dataset.platform;
            
            if (state.activePlatformFilter === platform) {
                state.activePlatformFilter = null;
                btn.classList.remove('active');
            } else {
                platformBtns.forEach(b => b.classList.remove('active'));
                state.activePlatformFilter = platform;
                btn.classList.add('active');
            }
            
            const games = await window.electronAPI.getGames();
            renderGames(games);
        });
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
