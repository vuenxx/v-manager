/**
 * releaseCache.js — Merkezi disk tabanlı önbellek modülü
 *
 * Her mod için ayrı bir JSON dosyası: releases-cache/<modName>.json
 * Format: { fetchedAt: <unix ms>, releases: [...] }
 * TTL: 1 saat (3 600 000 ms)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { app } = require('electron');

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 saat

function _cacheDir() {
    return path.join(app.getPath('userData'), 'releases-cache');
}

function _cacheFilePath(modName) {
    return path.join(_cacheDir(), `${modName}.json`);
}

function _ensureCacheDir() {
    const dir = _cacheDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Önbellekten okur.
 * @param {string} modName  - örn. 'optiscaler', 'dlssenabler'
 * @returns {{ releases: any[], fetchedAt: number } | null}
 */
function readCache(modName) {
    try {
        const filePath = _cacheFilePath(modName);
        if (!fs.existsSync(filePath)) return null;
        const raw  = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.releases) || typeof data.fetchedAt !== 'number') {
            return null;
        }
        return data;
    } catch (e) {
        console.warn(`[ReleaseCache] readCache("${modName}") hata:`, e.message);
        return null;
    }
}

/**
 * Önbelleğe yazar.
 * @param {string} modName
 * @param {any[]}  releases
 */
function writeCache(modName, releases, repo = null) {
    try {
        _ensureCacheDir();
        // repo da saklanir: manifest kaynagi degisirse onbellek otomatik gecersiz olur.
        const data = { fetchedAt: Date.now(), repo, releases };
        fs.writeFileSync(_cacheFilePath(modName), JSON.stringify(data), 'utf-8');
    } catch (e) {
        console.warn(`[ReleaseCache] writeCache("${modName}") hata:`, e.message);
    }
}

/**
 * Önbellek dosyasını siler (zorla yenileme için).
 * @param {string} modName
 */
function clearCache(modName) {
    try {
        const filePath = _cacheFilePath(modName);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`[ReleaseCache] clearCache("${modName}") — dosya silindi.`);
        }
    } catch (e) {
        console.warn(`[ReleaseCache] clearCache("${modName}") hata:`, e.message);
    }
}

/**
 * Önbelleğin 1 saat içinde geçerli olup olmadığını kontrol eder.
 * @param {string} modName
 * @param {string} [repo] - manifest source.repo; farkliysa onbellek gecersiz
 * @returns {boolean}
 */
function isCacheValid(modName, repo = null) {
    const cached = readCache(modName);
    if (!cached) return false;
    // Manifest repo'su degistiyse (or. dummy -> extra_newrepo) eski kayitlar
    // artik yanlis modu gosterir; TTL dolmasa da gecersiz say.
    if (repo && cached.repo && cached.repo !== repo) return false;
    if (repo && !cached.repo) return false; // repo bilgisi olmayan eski onbellek
    return (Date.now() - cached.fetchedAt) < CACHE_TTL_MS;
}

/**
 * fetchedAt değerinden geçen süreyi döner (saniye cinsinden).
 * @param {string} modName
 * @returns {number | null}
 */
function getCacheAgeSeconds(modName) {
    const cached = readCache(modName);
    if (!cached) return null;
    return Math.floor((Date.now() - cached.fetchedAt) / 1000);
}

module.exports = {
    readCache,
    writeCache,
    clearCache,
    isCacheValid,
    getCacheAgeSeconds,
    CACHE_TTL_MS,
};
