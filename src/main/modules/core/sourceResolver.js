'use strict';

/**
 * sourceResolver.js — Manifest kaynaklarını çözer (GitHub VEYA doğrudan URL)
 *
 * Manifest sistemi başlangıçta yalnızca GitHub release'leriyle çalışıyordu.
 * ReShade gibi kendi sitesinden dağıtılan modlar için `source.type: "url"`
 * desteği eklendi. Dönen kayıt şeması githubFetcher ile BİREBİR aynıdır
 * (`{ name, tag, downloadUrl, size, publishedAt, assetName }`), böylece
 * moduleEngine'in indirme/çıkarma/önbellek adımları değişmeden çalışır.
 *
 * Sürüm keşfi (`source.versionCheck`):
 *   - html_scrape : bir sayfayı indirip regex ile sürüm yakalar (ReShade)
 *   - json_field  : JSON API'den nokta notasyonlu alan okur
 *   - static      : sürüm sabit (`source.version`), keşif yapılmaz
 *
 * URL şablonlarında `{version}` yer tutucusu kullanılır.
 */

const githubFetcher = require('./githubFetcher');
const releaseCache = require('../../mods/releaseCache');

const TAG = '[SOURCE_RESOLVER]';

const USER_AGENT = 'vuenxxFG';
const FETCH_TIMEOUT_MS = 20000;

/** `{version}` gibi yer tutucuları doldurur. */
function applyTemplate(template, vars) {
    if (!template) return template;
    return String(template).replace(/\{(\w+)\}/g, (match, key) => (
        vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : match
    ));
}

async function fetchText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/json,*/*' },
            signal: controller.signal
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Sürüm numarasını keşfeder.
 * @returns {Promise<string>} bulunan sürüm (bulunamazsa hata fırlatır)
 */
async function discoverVersion(source) {
    const check = source.versionCheck;

    // Keşif tanımlı değilse sabit sürüm kullanılır
    if (!check || check.type === 'static') {
        return source.version || 'latest';
    }

    if (check.type === 'html_scrape') {
        if (!check.url || !check.pattern) {
            throw new Error('versionCheck.html_scrape için url ve pattern gerekli.');
        }
        const html = await fetchText(check.url);
        const re = new RegExp(check.pattern, check.flags || 'g');
        const matches = [...html.matchAll(re)]
            .map(m => (m[1] !== undefined ? m[1] : m[0]))
            .filter(Boolean);

        if (matches.length === 0) {
            throw new Error(`Sürüm bulunamadı (pattern eşleşmedi): ${check.pattern}`);
        }

        // Birden fazla eşleşmede en yüksek sürüm seçilir
        const utils = require('../../utils');
        matches.sort((a, b) => utils.compareVersions(b, a));
        return matches[0];
    }

    if (check.type === 'json_field') {
        if (!check.url || !check.field) {
            throw new Error('versionCheck.json_field için url ve field gerekli.');
        }
        const body = await fetchText(check.url);
        const json = JSON.parse(body);
        const value = check.field.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), json);
        if (!value) throw new Error(`JSON alanı bulunamadı: ${check.field}`);
        return String(value);
    }

    throw new Error(`Bilinmeyen versionCheck tipi: ${check.type}`);
}

/**
 * URL kaynağı için tek elemanlı "release" listesi üretir.
 * Sonuç githubFetcher.fetchReleases ile aynı şekilde önbelleğe alınır.
 */
async function fetchUrlReleases(manifest, options = {}) {
    const source = manifest.source;
    const cacheKey = manifest.id;
    // Önbellek anahtarı olarak URL kullanılır: manifestte URL değişirse
    // (repo değişimiyle aynı mantık) önbellek TTL dolmadan geçersiz olur.
    const cacheIdentity = source.url || source.versionCheck?.url || 'url';

    if (options.forceRefresh) {
        releaseCache.clearCache(cacheKey);
    } else if (releaseCache.isCacheValid(cacheKey, cacheIdentity)) {
        const cached = releaseCache.readCache(cacheKey);
        if (cached) return { fetchedAt: cached.fetchedAt, releases: cached.releases };
    }

    try {
        const version = await discoverVersion(source);
        const downloadUrl = applyTemplate(source.url, { version });
        const assetName = applyTemplate(
            source.assetName || downloadUrl.split('/').pop() || `${manifest.id}-${version}`,
            { version }
        );

        const releases = [{
            name: assetName,
            tag: version,
            downloadUrl,
            size: null,
            publishedAt: null,
            assetName
        }];

        releaseCache.writeCache(cacheKey, releases, cacheIdentity);
        console.log(`${TAG} ${manifest.id}: sürüm ${version} → ${downloadUrl}`);
        return { fetchedAt: Date.now(), releases };

    } catch (err) {
        console.error(`${TAG} ${manifest.id} sürüm çözümlenemedi:`, err.message);
        // Bayat önbelleğe düş — internet yoksa kurulu sürüm yine yönetilebilsin
        const cached = releaseCache.readCache(cacheKey);
        if (cached && cached.releases && cached.releases.length > 0) {
            return { fetchedAt: cached.fetchedAt, fromStaleCache: true, releases: cached.releases };
        }
        return { error: err.message, releases: [] };
    }
}

/**
 * Manifest kaynağından sürüm listesi getirir.
 * `source.type` github ise githubFetcher'a delege eder, url ise kendisi çözer.
 *
 * @param {object} manifest
 * @param {{ forceRefresh?: boolean }} options
 */
async function fetchReleases(manifest, options = {}) {
    const type = manifest.source?.type || 'github';

    if (type === 'url') {
        return await fetchUrlReleases(manifest, options);
    }

    return await githubFetcher.fetchReleases(manifest.id, manifest.source.repo, {
        forceRefresh: options.forceRefresh,
        maxReleases: manifest.source.maxReleases,
        assetFilter: manifest.source.asset
    });
}

/** Sürüm seçimi — github ile aynı davranış (latest = ilk kayıt). */
function findRelease(releases, tag) {
    return githubFetcher.findRelease(releases, tag);
}

module.exports = {
    fetchReleases,
    findRelease,
    discoverVersion,
    applyTemplate
};
