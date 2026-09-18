'use strict';

const fs = require('fs');
const path = require('path');
const releaseCache = require('../../mods/releaseCache');

function matchGlob(str, rule) {
    if (!rule) return false;
    const escapeRegex = (s) => s.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
    const regexRule = rule.split('*').map(escapeRegex).join('.*');
    return new RegExp("^" + regexRule + "$", "i").test(str);
}

/**
 * source.asset hem tek glob ("*.zip") hem de glob dizisi (["*.7z", "*.zip"])
 * olabilir; herhangi biri eşleşirse true.
 */
function matchAnyGlob(str, rules) {
    if (!rules) return false;
    if (Array.isArray(rules)) return rules.some(r => matchGlob(str, r));
    return matchGlob(str, rules);
}

async function fetchReleases(moduleId, repo, options = {}) {
    const forceRefresh = options.forceRefresh || false;
    const assetFilter = options.assetFilter;
    
    console.log(`[GITHUB_FETCHER] Github sürümleri yükleniyor: ${moduleId} (${repo})`);
    
    if (forceRefresh) {
        releaseCache.clearCache(moduleId);
    }
    
    if (!forceRefresh && releaseCache.isCacheValid(moduleId, repo)) {
        const cached = releaseCache.readCache(moduleId);
        return { fetchedAt: cached.fetchedAt, releases: cached.releases };
    }
    
    try {
        const response = await fetch(`https://api.github.com/repos/${repo}/releases`, {
            headers: { 'User-Agent': 'vuenxxFG' }
        });
        
        if (response.status === 403) {
            const rateLimitReset = response.headers.get('X-RateLimit-Reset');
            let errorMsg = 'GitHub API limitine ulaşıldı.';
            if (rateLimitReset) {
                const resetDate = new Date(parseInt(rateLimitReset) * 1000);
                errorMsg += ` (Sıfırlanma zamanı: ${resetDate.toLocaleTimeString()})`;
            }
            throw new Error(errorMsg);
        }
        
        if (!response.ok) throw new Error(`GitHub API HTTP error: ${response.status}`);
        
        const rawReleases = await response.json();
        const mappedReleases = [];
        let count = 0;
        const maxReleases = options.maxReleases || 10;
        
        for (const release of rawReleases) {
            if (count >= maxReleases) break;
            
            let matchingAssets = release.assets || [];
            if (assetFilter) {
                matchingAssets = matchingAssets.filter(a => matchAnyGlob(a.name, assetFilter));
            }
            
            if (matchingAssets.length > 0) {
                for (const asset of matchingAssets) {
                    mappedReleases.push({
                        name: release.name || release.tag_name,
                        tag: release.tag_name,
                        downloadUrl: asset.browser_download_url,
                        size: asset.size,
                        publishedAt: release.published_at,
                        assetName: asset.name
                    });
                }
                count++;
            }
        }
        
        releaseCache.writeCache(moduleId, mappedReleases, repo);
        return { fetchedAt: Date.now(), releases: mappedReleases };
        
    } catch (e) {
        console.warn(`[GITHUB_FETCHER] API hatası, önbellek deneniyor: ${e.message}`);
        const stale = releaseCache.readCache(moduleId);
        if (stale) return { fetchedAt: stale.fetchedAt, fromStaleCache: true, releases: stale.releases };
        return { error: e.message };
    }
}

function findAsset(release, assetPattern) {
    if (!release || !release.assets) return null;
    return release.assets.find(a => matchAnyGlob(a.name, assetPattern)) || null;
}

function findRelease(releases, tag) {
    if (!releases || releases.length === 0) return null;
    if (tag === 'latest') return releases[0];
    return releases.find(r => r.tag === tag) || null;
}

async function downloadAsset(downloadUrl, destDir, fileName, onProgress) {
    console.log(`[GITHUB_FETCHER] İndiriliyor: ${fileName}`);
    
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    const destPath = path.join(destDir, fileName);
    const response = await fetch(downloadUrl, {
        headers: { 'User-Agent': 'vuenxxFG' }
    });
    
    if (!response.ok) {
        throw new Error(`İndirme hatası (HTTP ${response.status})`);
    }
    
    const totalSize = parseInt(response.headers.get('content-length'), 10);
    let downloadedSize = 0;
    
    const fileStream = fs.createWriteStream(destPath);
    
    for await (const chunk of response.body) {
        downloadedSize += chunk.length;
        fileStream.write(chunk);
        if (onProgress && totalSize) {
            const percent = Math.round((downloadedSize / totalSize) * 100);
            onProgress(percent, downloadedSize, totalSize);
        }
    }
    
    await new Promise((resolve, reject) => {
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
        fileStream.end();
    });
    
    return { path: destPath, size: downloadedSize };
}

module.exports = {
    fetchReleases,
    findAsset,
    findRelease,
    downloadAsset
};
