import { initTheme } from './ui/theme.js';
import { initNavigation } from './ui/navigation.js';
import { initBaseModals } from './ui/modals/base.js';
import { initInfoModal } from './ui/modals/info.js';
import { initGames, initGamesListeners } from './ui/games.js';
import { initBlacklistListeners } from './ui/blacklist.js';
import { initSettingsListeners, renderUserGamesUI } from './ui/settings.js';
import { initCompress } from './ui/compress.js';
import { initDlssListeners } from './ui/modals/dlss.js';
import { initOptiListeners } from './ui/modals/opti.js';
import { initOptiPatcherListeners } from './ui/modals/optiPatcher.js';
import { initFsr4Listeners } from './ui/modals/fsr4.js';
import { initStreamlineListeners } from './ui/modals/streamline.js';
import { initUpdateListeners } from './ui/modals/update.js';
import { initModSelectionListeners } from './ui/modals/modSelection.js';
import { initSettingsListeners as initModalSettingsListeners } from './ui/modals/settings.js';
import { initDlssVersionListeners } from './ui/modals/dlssVersions.js';
import { initVideos } from './ui/videos.js';
import { initUpdatesTab } from './ui/updates-tab.js';
import { initI18n, setLanguage, getCurrentLang, applyTranslations } from './i18n/i18n.js';


document.addEventListener('DOMContentLoaded', async () => {
    // 0. i18n — must run before any UI renders
    initI18n();

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
    initNavigation();
    initTheme();

    // 2. Modals Event Listeners
    initBaseModals();
    initInfoModal();
    initDlssListeners();
    initOptiListeners();
    initOptiPatcherListeners();
    initFsr4Listeners();
    initStreamlineListeners();
    initUpdateListeners();
    initModSelectionListeners();
    initModalSettingsListeners();
    initDlssVersionListeners();

    // 3. Page Components Listeners
    initGamesListeners();
    initBlacklistListeners();
    initSettingsListeners();
    initCompress();
    initVideos();
    initUpdatesTab();

    // 4. Initial Load
    initGames();
});
