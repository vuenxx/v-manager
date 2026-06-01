import { showInfoModal } from './modals/info.js';

export function initNavigation() {
    // External links logic
    const externalLinks = document.querySelectorAll('.external-link');
    externalLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const url = link.getAttribute('data-url');
            if (url && window.electronAPI) {
                window.electronAPI.openExternal(url);
            }
        });
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

    // Promo cards navigation logic
    const promoCards = document.querySelectorAll('.promo-card');
    promoCards.forEach(card => {
        card.addEventListener('click', () => {
            const targetTab = card.getAttribute('data-target-tab');
            if (targetTab) {
                const sidebarItem = document.querySelector(`.nav-item[data-target="${targetTab}"]`);
                if (sidebarItem) {
                    sidebarItem.click();
                } else {
                    switchTab(targetTab);
                }
            }
        });
    });
}
export function switchTab(tabId) {
    if (tabId === 'compress') {
        showInfoModal('Bilgi', '⚠️ BURASI YAPIM AŞAMASINDA', false);
        return;
    }
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
}
export function switchTabToSettings() {
    switchTab('settings-tab');
}
