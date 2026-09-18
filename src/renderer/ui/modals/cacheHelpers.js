/**
 * cacheHelpers.js — Sürüm önbelleği için paylaşılan UI yardımcıları
 *
 * - buildCacheStatusBar(fetchedAt, fromStaleCache, onRefresh)  → DOM element
 * - showRefreshWarning(onConfirm)                              → uyarı modalı
 * - formatCacheAge(fetchedAt)                                  → "23 dk önce"
 */

import { t } from '../../i18n/i18n.js';
import { openModal, closeModal } from './base.js';

// ─── Zaman Formatlayıcı ────────────────────────────────────────────────────────

/**
 * fetchedAt (unix ms) değerini okunabilir metin olarak döner.
 * @param {number} fetchedAt
 * @returns {string}
 */
export function formatCacheAge(fetchedAt) {
    if (!fetchedAt) return '';
    const diffMs  = Date.now() - fetchedAt;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1)  return t('releaseCache.justNow');
    if (diffMin < 60) return `${diffMin} ${t('releaseCache.minutesAgo')}`;
    const diffH = Math.floor(diffMin / 60);
    return `${diffH} ${t('releaseCache.hoursAgo')}`;
}

// ─── Uyarı Modalı ─────────────────────────────────────────────────────────────

let _refreshWarningCallback = null;

/**
 * Yenileme uyarısı gösterir.
 * Kullanıcı "Evet" derse onConfirm() çağrılır.
 * @param {() => void} onConfirm
 */
export function showRefreshWarning(onConfirm) {
    _refreshWarningCallback = onConfirm;
    openModal('release-cache-warning-modal');
}

/** Modali kapat ve butona listener ekle (initCacheWarningModal bir kez çağrılmalı) */
export function initCacheWarningModal() {
    const modal   = document.getElementById('release-cache-warning-modal');
    if (!modal) return;

    document.getElementById('cache-warning-yes-btn')?.addEventListener('click', () => {
        closeModal('release-cache-warning-modal');
        if (typeof _refreshWarningCallback === 'function') {
            _refreshWarningCallback();
            _refreshWarningCallback = null;
        }
    });

    document.getElementById('cache-warning-no-btn')?.addEventListener('click', () => {
        closeModal('release-cache-warning-modal');
        _refreshWarningCallback = null;
    });
}

// ─── Cache Durum Çubuğu ───────────────────────────────────────────────────────

/**
 * Sürüm listesinin üstüne eklenecek önbellek durum çubuğu DOM elementi oluşturur.
 *
 * @param {number|null}  fetchedAt       - Unix ms timestamp
 * @param {boolean}      fromStaleCache  - Eski önbellekten mi geldi?
 * @param {() => void}   onRefresh       - 🔄 butonuna basıldığında çalışacak callback
 * @returns {HTMLElement}
 */
export function buildCacheStatusBar(fetchedAt, fromStaleCache, onRefresh) {
    const bar = document.createElement('div');
    bar.className = 'release-cache-status-bar';

    const ageText = fetchedAt ? formatCacheAge(fetchedAt) : '';
    const staleBadge = fromStaleCache
        ? `<span class="cache-stale-badge">⚠️ ${t('releaseCache.fromStaleCache')}</span>`
        : '';

    bar.innerHTML = `
        <span class="cache-age-text">
            ${staleBadge}
            ${fetchedAt ? `${t('releaseCache.lastUpdated')} <strong>${ageText}</strong>` : ''}
        </span>
        <button class="cache-refresh-btn" title="${t('releaseCache.refreshBtn')}">
            🔄
        </button>
    `;

    bar.querySelector('.cache-refresh-btn')?.addEventListener('click', () => {
        showRefreshWarning(onRefresh);
    });

    return bar;
}
