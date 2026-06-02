/**
 * V-Manager i18n Engine
 * Lightweight internationalization: TR (default) + EN
 * Usage:
 *   import { t, setLanguage, getCurrentLang, applyTranslations } from '../i18n/i18n.js';
 *   t('nav.home')           → "Home" or "Ana Sayfa"
 *   setLanguage('en')       → switch all UI to English
 */

import { tr } from './tr.js';
import { en } from './en.js';

const LOCALES = { tr, en };
const STORAGE_KEY = 'vmanager-lang';

let currentLang = localStorage.getItem(STORAGE_KEY);
if (!currentLang) {
    // Detect system language on first launch (e.g. 'tr-TR', 'en-US')
    const sysLang = (navigator.language || 'tr').toLowerCase();
    currentLang = sysLang.startsWith('tr') ? 'tr' : 'en';
    // Persist this default choice so it is locked in for subsequent launches
    localStorage.setItem(STORAGE_KEY, currentLang);
}

/**
 * Translate a key. Supports nested keys via dot notation: t('nav.home')
 * Falls back to Turkish if key is missing in current locale.
 */
export function t(key) {
    if (!key || typeof key !== 'string') return '';
    const locale = LOCALES[currentLang] || LOCALES['tr'];
    const parts = key.split('.');
    let val = locale;
    for (const part of parts) {
        if (val == null) break;
        val = val[part];
    }
    // Fallback to TR if not found
    if (val == null || typeof val !== 'string') {
        let fallback = LOCALES['tr'];
        for (const part of parts) {
            if (fallback == null) break;
            fallback = fallback[part];
        }
        return (typeof fallback === 'string') ? fallback : key;
    }
    return val;
}

export function getCurrentLang() {
    return currentLang;
}

export function setLanguage(lang) {
    if (!LOCALES[lang]) return;
    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    applyTranslations();
    // Update html lang attribute
    document.documentElement.lang = lang;
    // Dispatch event so any module can react
    document.dispatchEvent(new CustomEvent('language-changed', { detail: { lang } }));
}

/**
 * Scans the DOM for elements with data-i18n attributes and updates their text.
 * data-i18n="key"              → sets textContent
 * data-i18n-placeholder="key" → sets placeholder attribute
 * data-i18n-title="key"       → sets title attribute
 */
export function applyTranslations() {
    // textContent
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (el.hasAttribute('data-i18n-html')) {
            el.innerHTML = t(key);
        } else {
            el.textContent = t(key);
        }
    });
    // placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.placeholder = t(key);
    });
    // title
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        el.title = t(key);
    });
    // Update language select dropdown value
    const langSelect = document.getElementById('lang-select');
    if (langSelect) {
        langSelect.value = currentLang;
    }
}

export function initI18n() {
    // Ensure HTML lang matches
    document.documentElement.lang = currentLang;
    applyTranslations();
}
