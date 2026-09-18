const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const config = require('../config');
const releaseCache = require('./releaseCache');

const MOD_NAME = 'optipatcher';

async function getOptiPatcherReleases() {
    // --- Disk cache kontrolü ---
    if (releaseCache.isCacheValid(MOD_NAME)) {
        console.log('[OPTIPATCHER] Disk cache geçerli, döndürülüyor.');
        const cached = releaseCache.readCache(MOD_NAME);
        return {
            fetchedAt: cached.fetchedAt,
            releases: cached.releases.map(r => {
                const targetFile = require('path').join(config.modsPath, 'OptiPatcher', r.tag, 'OptiPatcher.asi');
                return { ...r, installed: require('fs').existsSync(targetFile) };
            })
        };
    }

    try {
        const response = await fetch('https://api.github.com/repos/optiscaler/OptiPatcher/releases', {
            headers: { 'User-Agent': 'vuenxxFG' }
        });

        if (response.status === 403) {
            const rateLimitReset = response.headers.get('X-RateLimit-Reset');
            let errorMsg = 'GitHub API limitine ulaşıldı. Lütfen daha sonra tekrar deneyin.';
            if (rateLimitReset) {
                const resetDate = new Date(parseInt(rateLimitReset) * 1000);
                errorMsg += ` (Sıfırlanma zamanı: ${resetDate.toLocaleTimeString()})`;
            }
            throw new Error(errorMsg);
        }

        if (!response.ok) throw new Error(`GitHub API HTTP error: ${response.status}`);
        const releases = await response.json();

        const mappedReleases = [];
        for (const r of releases.slice(0, 10)) {
            const asset = r.assets && r.assets.find(a => a.name.toLowerCase().endsWith('.asi'));
            if (!asset) continue;
            mappedReleases.push({
                name: r.name || r.tag_name,
                tag:  r.tag_name,
                downloadUrl: asset.browser_download_url,
                size: asset.size,
                publishedAt: r.published_at
            });
        }

        releaseCache.writeCache(MOD_NAME, mappedReleases);
        const fetchedAt = Date.now();

        return {
            fetchedAt,
            releases: mappedReleases.map(r => {
                const targetFile = path.join(config.modsPath, 'OptiPatcher', r.tag, 'OptiPatcher.asi');
                return { ...r, installed: fs.existsSync(targetFile) };
            })
        };
    } catch (e) {
        console.error('[OPTIPATCHER] Fetch hatası:', e.message);
        // Stale cache fallback
        const stale = releaseCache.readCache(MOD_NAME);
        if (stale) {
            console.log('[OPTIPATCHER] Stale cache fallback kullanılıyor.');
            return {
                fetchedAt: stale.fetchedAt,
                fromStaleCache: true,
                releases: stale.releases.map(r => {
                    const targetFile = path.join(config.modsPath, 'OptiPatcher', r.tag, 'OptiPatcher.asi');
                    return { ...r, installed: fs.existsSync(targetFile) };
                })
            };
        }
        return { error: e.message };
    }
}

async function downloadOptiPatcherRelease(event, { tag, downloadUrl }) {
    const targetDir = path.join(config.modsPath, 'OptiPatcher', tag);
    const targetFile = path.join(targetDir, 'OptiPatcher.asi');

    const candidateFiles = [
        targetFile,
        path.join(config.modsPath, 'OptiPatcher', tag.replace(/^v/i, ''), 'OptiPatcher.asi'),
        path.join(config.modsPath, 'OptiPatcher', `v${tag.replace(/^v/i, '')}`, 'OptiPatcher.asi')
    ];

    for (const cand of candidateFiles) {
        if (fs.existsSync(cand)) {
            console.log(`[OPTIPATCHER] Sürüm zaten indirilmiş: ${cand}`);
            if (event && event.sender && !event.sender.isDestroyed()) {
                event.sender.send('optipatcher-download-progress', { percent: 100 });
            }
            return { success: true, targetDir: path.dirname(cand), alreadyExists: true };
        }
    }

    const tempAsiPath = path.join(app.getPath('temp'), `optipatcher_${tag.replace(/[^a-z0-9.-]/gi, '_')}.asi`);

    try {
        if (!downloadUrl) throw new Error("İndirme linki bulunamadı.");

        const response = await fetch(downloadUrl);
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);

        const contentLength = +response.headers.get('Content-Length') || 0;
        const reader = response.body.getReader();
        let receivedLength = 0;
        let chunks = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;
            if (contentLength && event && event.sender && !event.sender.isDestroyed()) {
                const percent = Math.round((receivedLength / contentLength) * 100);
                event.sender.send('optipatcher-download-progress', { percent });
            }
        }

        const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
        fs.writeFileSync(tempAsiPath, buffer);

        // Create target directory if it doesn't exist
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // Copy from temp to target location
        fs.copyFileSync(tempAsiPath, targetFile);

        return { success: true, targetDir };
    } catch (e) {
        console.error("OptiPatcher download error:", e);
        return { success: false, error: e.message };
    } finally {
        // Always clean up the temp file regardless of success or failure
        try {
            if (fs.existsSync(tempAsiPath)) {
                fs.unlinkSync(tempAsiPath);
            }
        } catch (unlinkErr) {
            console.error("Failed to clean up temp file:", unlinkErr);
        }
    }
}


module.exports = {
    getOptiPatcherReleases,
    downloadOptiPatcherRelease
};
