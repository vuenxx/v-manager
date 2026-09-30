import { showInfoModal } from './modals/info.js';

export function initNavigation() {
    // External links logic (using event delegation to support dynamic translation strings)
    document.addEventListener('click', (e) => {
        const link = e.target.closest('.external-link');
        if (link) {
            e.preventDefault();
            const url = link.getAttribute('data-url');
            if (url && window.electronAPI) {
                if (window.electronAPI.openExternalLink) {
                    window.electronAPI.openExternalLink(url);
                }
            }
        }
    });

    // Tab switching logic
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetId = item.getAttribute('data-target');
            window.electronAPI.logToMain(`Navigation: Tab clicked -> ${targetId}`);
            switchTab(targetId);
        });
    });

    // System tray navigation listener
    if (window.electronAPI && window.electronAPI.onNavigateTab) {
        window.electronAPI.onNavigateTab((tabId) => {
            switchTab(tabId);
        });
    }
}
export function switchTab(tabId) {
    window.electronAPI.logToMain(`Navigation: switchTab called -> ${tabId}`);
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');
    
    // Update nav buttons
    navItems.forEach(nav => {
        if (nav.getAttribute('data-target') === tabId) {
            nav.classList.add('active');
        } else {
            nav.classList.remove('active');
        }
    });

    // Update tab visibility
    tabContents.forEach(content => {
        if (content.id === tabId) {
            window.electronAPI.logToMain(`Navigation: Activating element with ID -> ${tabId}`);
            content.style.display = 'block'; // Force visibility
            content.classList.add('active');
            // Notify interested modules that this tab is now active
            document.dispatchEvent(new CustomEvent('tab-activated', { detail: { tabId } }));
        } else {
            content.style.display = 'none'; // Force hide
            content.classList.remove('active');
        }
    });

    // Reset scroll position on tab switch to keep layout consistent
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        mainContent.scrollTop = 0;
    }
}
export function switchTabToSettings() {
    switchTab('settings-tab');
}
