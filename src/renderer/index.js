import { initTheme } from './ui/theme.js';
import { initNavigation } from './ui/navigation.js';
import { initBaseModals, openModal, closeModal } from './ui/modals/base.js';
import { initInfoModal, showInfoModal } from './ui/modals/info.js';
import { initGames, initGamesListeners } from './ui/games.js';
import { initBlacklistListeners } from './ui/blacklist.js';
import { initSettingsListeners, renderUserGamesUI } from './ui/settings.js';
import { initCompress } from './ui/compress.js';
import { initDlssListeners } from './ui/modals/dlss.js';
import { initWizardListeners } from './ui/modals/dlssWizard.js';
import { initOptiListeners } from './ui/modals/opti.js';
import { initOptiWizardListeners } from './ui/modals/optiWizard.js';
import { initOptiBuilderListeners } from './ui/modals/optiBuilder.js';
import { initOptiBuilderWizardListeners } from './ui/modals/optiBuilderWizard.js';
import { initOptiPatcherListeners } from './ui/modals/optiPatcher.js';
import { initFsr4Listeners } from './ui/modals/fsr4.js';
import { initStreamlineListeners } from './ui/modals/streamline.js';
import { initModSelectionListeners } from './ui/modals/modSelection.js';
import { initSettingsListeners as initModalSettingsListeners } from './ui/modals/settings.js';
import { initModsTab } from './ui/mods-tab.js';
import { initVideos } from './ui/videos.js';
import { initUpdatesTab } from './ui/updates-tab.js';
import { initFreeGames } from './ui/free-games.js';
import { initSystemInfo } from './ui/system-info.js';
import { initI18n, setLanguage, getCurrentLang, applyTranslations, t } from './i18n/i18n.js';
import { initCacheWarningModal } from './ui/modals/cacheHelpers.js';
import { initManifestBuilder } from './ui/manifest-builder.js';
import { initTools } from './ui/tools.js';
import { initVlss5Modal } from './ui/modals/vlss5.js';
import { initWindowControls } from './ui/window-controls.js';


document.addEventListener('DOMContentLoaded', async () => {
    // 0. i18n — must run before any UI renders
    initI18n();
    if (window.electronAPI && window.electronAPI.logToMain) {
        window.electronAPI.logToMain('LANG TEST: currentLang=' + getCurrentLang() + ' t(nav.home)=' + t('nav.home'));
    }

    // Language select dropdown (top-right)
    const langSelect = document.getElementById('lang-select');
    if (langSelect) {
        langSelect.value = getCurrentLang();
        langSelect.addEventListener('change', () => {
            setLanguage(langSelect.value);
        });
    }

    // Re-render dynamic UI on language change
    document.addEventListener('language-changed', () => {
        // Re-render games list with fresh language strings
        initGames();
    });

    // 1. Core UI Navigation and Theme
    initWindowControls();
    initNavigation();
    initTheme();

    // 2. Modals Event Listeners
    initBaseModals();
    initInfoModal();
    initCacheWarningModal();
    initDlssListeners();
    initWizardListeners();
    initOptiListeners();
    initOptiWizardListeners();
    initOptiBuilderListeners();
    initOptiBuilderWizardListeners();
    initOptiPatcherListeners();
    initFsr4Listeners();
    initStreamlineListeners();
    initModSelectionListeners();
    initModalSettingsListeners();
    initModsTab();
    initVlss5Modal();

    // 3. Page Components Listeners
    initGamesListeners();
    initBlacklistListeners();
    initSettingsListeners();
    initCompress();
    initVideos();
    initUpdatesTab();
    initFreeGames();
    initSystemInfo();
    initManifestBuilder();
    initTools();

    // Close attempt listener (during compression)
    if (window.electronAPI && window.electronAPI.onShowCloseWarning) {
        window.electronAPI.onShowCloseWarning(() => {
            showInfoModal(t('compress.closeWarningTitle'), t('compress.closeWarningMessage'), true);
        });
    }

    // 4. Initial Load
    initGames();
    initDlssEnablerList();
});

async function initDlssEnablerList() {
    const listGrid = document.getElementById('dlss-games-list-grid');
    const searchInput = document.getElementById('dlss-games-search');
    const noResults = document.getElementById('dlss-games-no-results');

    if (!listGrid || !searchInput) return;

    try {
        if (!window.electronAPI || !window.electronAPI.getDlssEnablerGames) return;
        const rawGames = await window.electronAPI.getDlssEnablerGames();
        if (!rawGames) return;

        const gameNames = Object.keys(rawGames).sort((a, b) => a.localeCompare(b));

        const renderList = (filterQuery = '') => {
            listGrid.innerHTML = '';
            const normalizedQuery = filterQuery.toLowerCase().trim();

            const filteredNames = gameNames.filter(name => 
                name.toLowerCase().includes(normalizedQuery)
            );

            if (filteredNames.length === 0) {
                noResults.style.display = 'block';
            } else {
                noResults.style.display = 'none';
                filteredNames.forEach(name => {
                    const item = document.createElement('div');
                    item.className = 'dlss-game-list-item';
                    
                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'dlss-game-item-name';
                    nameSpan.textContent = name;
                    nameSpan.title = name;

                    const badge = document.createElement('span');
                    badge.className = 'dlss-game-item-badge';
                    badge.textContent = 'DLSS Enabler';

                    item.appendChild(nameSpan);
                    item.appendChild(badge);
                    listGrid.appendChild(item);
                });
            }
        };

        // Initial render
        renderList();

        // Search listener
        searchInput.addEventListener('input', () => {
            renderList(searchInput.value);
        });

        // Open Modal Trigger
        const openBtn = document.getElementById('open-dlss-list-btn');
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                openModal('dlss-supported-games-modal');
            });
        }

        const openBtn2 = document.getElementById('games-tab-support-list-btn');
        if (openBtn2) {
            openBtn2.addEventListener('click', () => {
                openModal('dlss-supported-games-modal');
            });
        }

        // Close Modal Trigger
        const closeBtn = document.getElementById('close-dlss-list-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                closeModal('dlss-supported-games-modal');
            });
        }

    } catch (err) {
        console.error('Failed to initialize DLSS Enabler list on home page:', err);
    }
}
