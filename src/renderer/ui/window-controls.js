/**
 * window-controls.js — Özel başlık çubuğu kontrolleri
 *
 * Ana pencere `frame: false` ile açılıyor (src/main/window.js), bu yüzden
 * küçült / büyüt / kapat butonlarını uygulama kendisi çiziyor.
 * Sürükleme bölgesi CSS'te (`-webkit-app-region: drag`, styles.css sonu).
 */

import { t } from '../i18n/i18n.js';

let listenersBound = false;

export function initWindowControls() {
    if (listenersBound) return;
    listenersBound = true;

    const api = window.electronAPI;
    const minimizeBtn = document.getElementById('win-minimize-btn');
    const maximizeBtn = document.getElementById('win-maximize-btn');
    const closeBtn = document.getElementById('win-close-btn');

    // Tarayıcıda (Electron dışında) açıldıysa kontrolleri gizle
    if (!api || !api.windowMinimize) {
        const group = document.querySelector('.window-controls');
        if (group) group.style.display = 'none';
        return;
    }

    if (minimizeBtn) minimizeBtn.addEventListener('click', () => api.windowMinimize());
    if (closeBtn) closeBtn.addEventListener('click', () => api.windowClose());
    if (maximizeBtn) maximizeBtn.addEventListener('click', () => api.windowToggleMaximize());

    // Başlık çubuğuna çift tıklama = büyüt / geri al (Windows davranışı)
    const header = document.querySelector('.top-header');
    if (header) {
        header.addEventListener('dblclick', (e) => {
            // Buton, açılır liste vb. üzerindeki çift tıklama pencereyi büyütmesin
            if (e.target.closest('button, select, input, a, .free-games-btn-wrapper')) return;
            api.windowToggleMaximize();
        });
    }

    if (api.onWindowMaximizeChanged) {
        api.onWindowMaximizeChanged(applyMaximizedState);
    }

    // Açılıştaki gerçek durumu uygula (ör. pencere maximized başlatıldıysa)
    api.windowIsMaximized().then(applyMaximizedState).catch(() => { /* yoksay */ });

    // Dil değişince buton ipuçları güncellensin
    document.addEventListener('language-changed', updateTooltips);
    updateTooltips();
}

function applyMaximizedState(isMaximized) {
    document.body.classList.toggle('window-maximized', !!isMaximized);
    updateTooltips();
}

function updateTooltips() {
    const maximizeBtn = document.getElementById('win-maximize-btn');
    if (!maximizeBtn) return;
    const isMaximized = document.body.classList.contains('window-maximized');
    const key = isMaximized ? 'header.restore' : 'header.maximize';
    maximizeBtn.title = t(key);
    maximizeBtn.setAttribute('aria-label', maximizeBtn.title);
    // data-i18n-title'ı da güncelle ki applyTranslations üzerine yazmasın
    maximizeBtn.setAttribute('data-i18n-title', key);
}
