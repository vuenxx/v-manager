import { state } from '../state.js';
import { closeModal } from './modals/base.js';
import { renderGames, updateHomeStats } from './games.js';
import { switchTab } from './navigation.js';

// Get elements helpers to ensure they exist before use
const getBlacklistContainer = () => document.getElementById('blacklist-container');
const getToggleBlacklistBtn = () => document.getElementById('toggle-blacklist-btn');
const getConfirmModal = () => document.getElementById('confirm-modal');

let gameToRemove = null;
let cardToRemove = null;

const ITEMS_PER_PAGE = 5;

export function showConfirmModal(gameName, card) {
    gameToRemove = gameName;
    cardToRemove = card;
    const modal = getConfirmModal();
    if (modal) modal.classList.add('active');
}

export async function renderBlacklistUI() {
    const blacklistContainerEl = getBlacklistContainer();
    if (!blacklistContainerEl) return;
    const blacklist = await window.electronAPI.getBlacklist();
    blacklistContainerEl.innerHTML = '';

    if (blacklist.length === 0) {
        blacklistContainerEl.innerHTML = '<div style="padding: 12px 16px; color: var(--text-secondary); text-align: center; font-size: 14px;">Kara listeniz boş.</div>';
        return;
    }

    const totalPages = Math.ceil(blacklist.length / ITEMS_PER_PAGE);
    if (state.currentBlacklistPage > totalPages) {
        state.currentBlacklistPage = totalPages;
    }

    const startIndex = (state.currentBlacklistPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const currentItems = blacklist.slice(startIndex, endIndex);

    currentItems.forEach(gameName => {
        const item = document.createElement('div');
        item.className = 'blacklist-item';
        
        item.innerHTML = `
            <div class="blacklist-item-name">${gameName}</div>
            <button class="blacklist-remove-btn">Kaldır</button>
        `;

        const btn = item.querySelector('.blacklist-remove-btn');
        btn.addEventListener('click', async () => {
            await window.electronAPI.removeFromBlacklist(gameName);
            renderBlacklistUI();
        });

        blacklistContainerEl.appendChild(item);
    });

    // Add Pagination Controls
    if (totalPages > 1) {
        const paginationEl = document.createElement('div');
        paginationEl.className = 'pagination-controls';
        
        paginationEl.innerHTML = `
            <button class="page-btn prev-btn" ${state.currentBlacklistPage === 1 ? 'disabled' : ''}>Önceki</button>
            <div class="page-info">Sayfa ${state.currentBlacklistPage} / ${totalPages}</div>
            <button class="page-btn next-btn" ${state.currentBlacklistPage === totalPages ? 'disabled' : ''}>Sonraki</button>
        `;

        const prevBtn = paginationEl.querySelector('.prev-btn');
        const nextBtn = paginationEl.querySelector('.next-btn');

        prevBtn.addEventListener('click', () => {
            if (state.currentBlacklistPage > 1) {
                state.currentBlacklistPage--;
                renderBlacklistUI();
            }
        });

        nextBtn.addEventListener('click', () => {
            if (state.currentBlacklistPage < totalPages) {
                state.currentBlacklistPage++;
                renderBlacklistUI();
            }
        });

        blacklistContainerEl.appendChild(paginationEl);
    }
}

export function initBlacklistListeners() {
    const confirmBlacklistBtn = document.getElementById('confirm-blacklist-btn');
    const confirmRemoveBtn = document.getElementById('confirm-remove-btn');
    const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
    const toggleBlacklistBtn = getToggleBlacklistBtn();
    const blacklistContainerEl = getBlacklistContainer();

    if (confirmBlacklistBtn) {
        confirmBlacklistBtn.addEventListener('click', async () => {
            if (gameToRemove && cardToRemove) {
                await window.electronAPI.addToBlacklist(gameToRemove);
                cardToRemove.remove();
                
                const gamesContainer = document.getElementById('games-container');
                if (gamesContainer && gamesContainer.children.length === 0) {
                    gamesContainer.innerHTML = '<p style="color: var(--text-secondary); text-align: center; grid-column: 1 / -1;">Hiç oyun bulunamadı.</p>';
                }
                
                if (blacklistContainerEl && blacklistContainerEl.classList.contains('active')) {
                    renderBlacklistUI();
                }
                updateHomeStats();
            }
            closeModal('confirm-modal');
        });
    }

    if (confirmRemoveBtn) {
        confirmRemoveBtn.addEventListener('click', async () => {
            if (gameToRemove && cardToRemove) {
                await window.electronAPI.removeGame(gameToRemove);
                cardToRemove.remove();
                
                const gamesContainer = document.getElementById('games-container');
                if (gamesContainer && gamesContainer.children.length === 0) {
                    gamesContainer.innerHTML = '<p style="color: var(--text-secondary); text-align: center; grid-column: 1 / -1;">Hiç oyun bulunamadı.</p>';
                }
                
                if (blacklistContainerEl && blacklistContainerEl.classList.contains('active')) {
                    renderBlacklistUI();
                }
                updateHomeStats();
            }
            closeModal('confirm-modal');
        });
    }

    if (confirmCancelBtn) {
        confirmCancelBtn.addEventListener('click', () => {
            closeModal('confirm-modal');
        });
    }

    if (toggleBlacklistBtn && blacklistContainerEl) {
        toggleBlacklistBtn.addEventListener('click', () => {
            const isActive = blacklistContainerEl.classList.toggle('active');
            if (isActive) {
                toggleBlacklistBtn.textContent = 'Kara Listeyi Gizle';
                renderBlacklistUI();
            } else {
                toggleBlacklistBtn.textContent = 'Kara Listeyi Göster';
            }
        });
    }
}
