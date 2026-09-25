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
 * `source.type: "github_files"` ise release'in EK DOSYASI (asset) hiç yoktur —
 * bazı depolar yalnızca "Source code (zip)" üretir. Bütün kaynak arşivini indirmek
 * (bu depoda ~133 MB) yerine yalnızca gereken dosyalar `raw.githubusercontent.com`
 * üzerinden tek tek çekilir. Dönen kayıtta `downloadUrl` yoktur; yerine
 * `fileMode: true` bulunur ve moduleEngine `downloadFiles()` ile indirir.
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

/** raw.githubusercontent.com adresi — depo içi bir dosyanın sürüm etiketli hâli. */
function rawFileUrl(repo, tag, filePath) {
    const clean = String(filePath).replace(/\\/g, '/').replace(/^\/+/, '');
    const encoded = clean.split('/').map(encodeURIComponent).join('/');
    return `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(tag)}/${encoded}`;
}

/**
 * `github_files` için sürüm listesi — release'lerde asset aranmaz, yalnızca
 * tag'ler listelenir. Kayıt şeması diğer kaynaklarla aynı kalır ki
 * moduleEngine'in sürüm seçimi/önbellek mantığı değişmesin.
 */
async function fetchGithubFileReleases(manifest, options = {}) {
    const source = manifest.source;
    const cacheKey = manifest.id;
    const repo = source.repo;

    if (options.forceRefresh) {
        releaseCache.clearCache(cacheKey);
    } else if (releaseCache.isCacheValid(cacheKey, repo)) {
        const cached = releaseCache.readCache(cacheKey);
        if (cached) return { fetchedAt: cached.fetchedAt, releases: cached.releases };
    }

    try {
        const res = await fetch(`https://api.github.com/repos/${repo}/releases`, {
            headers: { 'User-Agent': USER_AGENT }
        });
        if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);

        const raw = await res.json();
        const maxReleases = source.maxReleases || 10;
        const releases = raw.slice(0, maxReleases).map(r => ({
            name: r.name || r.tag_name,
            tag: r.tag_name,
            downloadUrl: null,
            size: null,
            publishedAt: r.published_at,
            assetName: null,
            fileMode: true
        }));

        releaseCache.writeCache(cacheKey, releases, repo);
        return { fetchedAt: Date.now(), releases };

    } catch (err) {
        console.error(`${TAG} ${manifest.id} sürüm listesi alınamadı:`, err.message);
        const cached = releaseCache.readCache(cacheKey);
        if (cached && cached.releases && cached.releases.length > 0) {
            return { fetchedAt: cached.fetchedAt, fromStaleCache: true, releases: cached.releases };
        }
        return { error: err.message, releases: [] };
    }
}

/**
 * `github_files` indirmesi: depo içi KLASÖR YAPISINI KORUYARAK indirir —
 * `alternatives/dxgi.dll` sürüm klasörüne `alternatives/dxgi.dll` olarak iner.
 *
 * Eskiden yol düzleştiriliyordu (flat). Bunun sorunu: depodaki her proxy adı
 * AYRI bir binary olduğu için (`version.dll` ≠ `alternatives/dxgi.dll`),
 * düzleştirme kökteki `version.dll` ile alt klasörden gelen `dxgi.dll`'i aynı
 * klasöre yığıyor ve sürüm klasörü aynı dosyanın kopyalarıyla doluymuş gibi
 * görünüyordu. Yapı korununca hangi binary'nin nereden geldiği belli olur;
 * oyuna kopyalama adımı dosyayı zaten seçilen enjeksiyon adına göre yeniden
 * adlandırıyor.
 *
 * @param {string} repo      "owner/repo"
 * @param {string} tag       release etiketi
 * @param {string[]} paths   depo içi dosya yolları
 * @param {string} destDir   hedef klasör
 * @param {(info:{index:number,total:number,percent:number,fileName:string})=>void} onProgress
 * @returns {Promise<string[]>} indirilen dosyaların tam yolları
 */
async function downloadFiles(repo, tag, paths, destDir, onProgress) {
    const path = require('path');
    const githubFetcherRef = require('./githubFetcher');
    const written = [];
    const total = paths.length;

    for (let i = 0; i < total; i++) {
        const filePath = paths[i];
        const relPath = String(filePath).replace(/\\/g, '/');
        const fileName = relPath.split('/').pop();
        const subDir = relPath.slice(0, relPath.length - fileName.length).replace(/\/+$/, '');
        const fileDestDir = subDir ? path.join(destDir, ...subDir.split('/')) : destDir;
        const url = rawFileUrl(repo, tag, filePath);

        const result = await githubFetcherRef.downloadAsset(url, fileDestDir, fileName, (percent) => {
            if (onProgress) {
                onProgress({
                    index: i,
                    total,
                    fileName,
                    percent: Math.round(((i + percent / 100) / total) * 100)
                });
            }
        });
        written.push(result.path);
        console.log(`${TAG} ${repo}@${tag} → ${relPath} indirildi`);
    }

    return written;
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

    if (type === 'github_files') {
        return await fetchGithubFileReleases(manifest, options);
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
    applyTemplate,
    rawFileUrl,
    downloadFiles
};
