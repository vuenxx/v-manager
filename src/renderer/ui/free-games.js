import { t } from '../i18n/i18n.js';

const CACHE_KEY = 'gamerpower_cache';
const CACHE_TIME_KEY = 'gamerpower_cache_time';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

let allGiveaways = [];
let filteredGiveaways = [];
let currentPage = 1;
const ITEMS_PER_PAGE = 9;

export function initFreeGames() {
    // Listen for tab activation to load the free games automatically
    document.addEventListener('tab-activated', (e) => {
        if (e.detail && e.detail.tabId === 'free-games') {
            loadFreeGames(false);
        }
    });

    // Refresh button event listener
    const refreshBtn = document.getElementById('refresh-free-games-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadFreeGames(true);
        });
    }

    // Search and filters event listeners
    const searchInput = document.getElementById('free-games-search-input');
    const platformSelect = document.getElementById('free-games-platform-select');
    const searchClear = document.getElementById('free-games-search-clear');

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            applyFilters();
        });
    }

    if (platformSelect) {
        platformSelect.addEventListener('change', () => {
            applyFilters();
        });
    }

    if (searchClear) {
        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            applyFilters();
        });
    }

    // Attribution link click handler (to securely bypass Electron sandbox restriction)
    const attributionLink = document.querySelector('#free-games .attribution-link');
    if (attributionLink) {
        attributionLink.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const url = attributionLink.getAttribute('data-url') || 'https://www.gamerpower.com';
            window.electronAPI.logToMain(`Free Games: Opening attribution link -> ${url}`);
            if (window.electronAPI && window.electronAPI.openExternalLink) {
                window.electronAPI.openExternalLink(url);
            } else if (window.electronAPI && window.electronAPI.openExternal) {
                window.electronAPI.openExternal(url);
            }
        });
    }

    // Re-render current page if language changes while looking at this tab
    document.addEventListener('language-changed', () => {
        const activeTab = document.querySelector('.tab-content.active');
        if (activeTab && activeTab.id === 'free-games' && allGiveaways.length > 0) {
            renderPage(currentPage);
        }
    });
}

async function loadFreeGames(force = false) {
    const container = document.getElementById('free-games-container');
    const paginationContainer = document.getElementById('free-games-pagination');
    const loading = document.getElementById('free-games-loading');
    const error = document.getElementById('free-games-error');

    if (!container || !loading || !error) return;

    // Reset UI state
    container.innerHTML = '';
    if (paginationContainer) paginationContainer.innerHTML = '';
    loading.style.display = 'block';
    error.style.display = 'none';

    // Caching check
    if (!force) {
        const cachedData = localStorage.getItem(CACHE_KEY);
        const cachedTime = localStorage.getItem(CACHE_TIME_KEY);
        
        if (cachedData && cachedTime) {
            const timePassed = Date.now() - parseInt(cachedTime, 10);
            if (timePassed < CACHE_DURATION) {
                try {
                    allGiveaways = JSON.parse(cachedData);
                    filteredGiveaways = allGiveaways;
                    currentPage = 1;
                    applyFilters();
                    loading.style.display = 'none';
                    return;
                } catch (e) {
                    console.error('Failed to parse cached GamerPower data, fetching fresh...', e);
                }
            }
        }
    }

    try {
        // Fetch fresh data via IPC using global fetch on the backend
        window.electronAPI.logToMain('Free Games: Fetching fresh giveaways from GamerPower API...');
        const data = await window.electronAPI.fetchFreeGames();

        if (!data || !Array.isArray(data)) {
            throw new Error('Invalid data format received from GamerPower API');
        }

        // Cache the response
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());

        allGiveaways = data;
        filteredGiveaways = data;
        currentPage = 1;
        applyFilters();
        loading.style.display = 'none';
    } catch (err) {
        console.error('Error fetching or rendering free games:', err);
        loading.style.display = 'none';
        error.style.display = 'block';
        if (paginationContainer) paginationContainer.innerHTML = '';
    }
}

function renderPage(page) {
    const container = document.getElementById('free-games-container');
    const paginationContainer = document.getElementById('free-games-pagination');
    if (!container) return;

    container.innerHTML = '';
    if (paginationContainer) paginationContainer.innerHTML = '';

    if (!filteredGiveaways || filteredGiveaways.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-secondary); width: 100%; padding: 40px;" data-i18n="freeGames.noResults">${t('freeGames.noResults')}</div>`;
        return;
    }

    const totalItems = filteredGiveaways.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

    // Bounds checking
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    currentPage = page;

    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalItems);
    const pageItems = filteredGiveaways.slice(startIndex, endIndex);

    pageItems.forEach(item => {
        const title = item.title || 'Unknown Game';
        const thumbnail = item.thumbnail || 'icons/program_logo.png';
        const worth = item.worth || 'N/A';
        const platforms = item.platforms || 'PC';
        
        // Use multiple fallback fields to get the correct giveaway URL
        const link = item.open_giveaway || item.open_giveaway_url || item.gamerpower_url || 'https://www.gamerpower.com';

        // Create Card Element
        const card = document.createElement('div');
        card.className = 'free-game-card';

        // Parse platforms for display badges
        const platformBadges = platforms.split(',')
            .map(p => `<span class="platform-badge">${p.trim()}</span>`)
            .join(' ');

        card.innerHTML = `
            <div class="free-game-thumb-wrapper">
                <img class="free-game-thumb" src="${thumbnail}" alt="${title}" onerror="this.onerror=null; this.src='icons/program_logo.png';">
                <span class="free-game-worth-badge">${t('freeGames.worth')} ${worth}</span>
            </div>
            <div class="free-game-info">
                <h3 class="free-game-title" title="${title}">${title}</h3>
                <div class="free-game-platforms">
                    ${platformBadges}
                </div>
                <button class="free-game-btn">${t('freeGames.getGiveaway')}</button>
            </div>
        `;

        // Click handler to open link securely (via IPC to avoid Electron sandbox blocks)
        const handleOpen = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            window.electronAPI.logToMain(`Free Games: Opening giveaway link -> ${link}`);
            
            if (window.electronAPI && window.electronAPI.openExternalLink) {
                window.electronAPI.openExternalLink(link);
            } else if (window.electronAPI && window.electronAPI.openExternal) {
                window.electronAPI.openExternal(link);
            }
        };

        const btn = card.querySelector('.free-game-btn');
        if (btn) {
            btn.addEventListener('click', handleOpen);
        }
        card.addEventListener('click', handleOpen);

        container.appendChild(card);
    });

    // Render pagination controls if we have more than 1 page
    if (totalPages > 1 && paginationContainer) {
        // Prev button
        const prevBtn = document.createElement('button');
        prevBtn.className = `pagination-btn ${currentPage === 1 ? 'disabled' : ''}`;
        prevBtn.textContent = '◀';
        if (currentPage > 1) {
            prevBtn.addEventListener('click', () => goToPage(currentPage - 1));
        }
        paginationContainer.appendChild(prevBtn);

        // Numbered buttons with a sliding window
        const maxVisibleButtons = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxVisibleButtons / 2));
        let endPage = Math.min(totalPages, startPage + maxVisibleButtons - 1);

        if (endPage - startPage + 1 < maxVisibleButtons) {
            startPage = Math.max(1, endPage - maxVisibleButtons + 1);
        }

        if (startPage > 1) {
            const firstBtn = document.createElement('button');
            firstBtn.className = 'pagination-btn';
            firstBtn.textContent = '1';
            firstBtn.addEventListener('click', () => goToPage(1));
            paginationContainer.appendChild(firstBtn);

            if (startPage > 2) {
                const dots = document.createElement('span');
                dots.className = 'pagination-dots';
                dots.textContent = '...';
                paginationContainer.appendChild(dots);
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            const pageBtn = document.createElement('button');
            pageBtn.className = `pagination-btn ${i === currentPage ? 'active' : ''}`;
            pageBtn.textContent = i;
            pageBtn.addEventListener('click', () => goToPage(i));
            paginationContainer.appendChild(pageBtn);
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                const dots = document.createElement('span');
                dots.className = 'pagination-dots';
                dots.textContent = '...';
                paginationContainer.appendChild(dots);
            }

            const lastBtn = document.createElement('button');
            lastBtn.className = 'pagination-btn';
            lastBtn.textContent = totalPages;
            lastBtn.addEventListener('click', () => goToPage(totalPages));
            paginationContainer.appendChild(lastBtn);
        }

        // Next button
        const nextBtn = document.createElement('button');
        nextBtn.className = `pagination-btn ${currentPage === totalPages ? 'disabled' : ''}`;
        nextBtn.textContent = '▶';
        if (currentPage < totalPages) {
            nextBtn.addEventListener('click', () => goToPage(currentPage + 1));
        }
        paginationContainer.appendChild(nextBtn);
    }
}

function goToPage(page) {
    currentPage = page;
    renderPage(currentPage);
    
    // Scroll the main content to the top
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        mainContent.scrollTop = 0;
    }
}

function applyFilters() {
    const searchInput = document.getElementById('free-games-search-input');
    const platformSelect = document.getElementById('free-games-platform-select');
    const searchClear = document.getElementById('free-games-search-clear');
    
    if (!searchInput || !platformSelect) return;
    
    const query = searchInput.value.toLowerCase().trim();
    const platform = platformSelect.value;
    
    // Toggle search clear button
    if (searchClear) {
        searchClear.style.display = query.length > 0 ? 'block' : 'none';
    }
    
    filteredGiveaways = allGiveaways.filter(item => {
        // Search query check (title or description)
        const titleMatch = !query || 
            (item.title && item.title.toLowerCase().includes(query)) || 
            (item.description && item.description.toLowerCase().includes(query));
        
        // Platform check
        let platformMatch = true;
        if (platform !== 'all') {
            let matchString = platform.replace('-', ' ');
            if (platform === 'epic-games-store') matchString = 'epic games';
            if (platform === 'xbox-series-xs') matchString = 'xbox series';
            if (platform === 'playstation4') matchString = 'playstation 4';
            if (platform === 'playstation5') matchString = 'playstation 5';
            if (platform === 'xbox-one') matchString = 'xbox one';
            if (platform === 'nintendo-switch') matchString = 'nintendo switch';
            
            const itemPlatforms = (item.platforms || '').toLowerCase();
            platformMatch = itemPlatforms.includes(matchString);
        }
        
        return titleMatch && platformMatch;
    });
    
    currentPage = 1;
    renderPage(currentPage);
}
