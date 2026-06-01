const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const extract = require('extract-zip');

const config = require('../config');

async function getFsr4Releases() {
    try {
        const response = await fetch('http://190.92.151.212/fsr4files/', {
            headers: { 'User-Agent': 'vuenxxFG' }
        });
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        const html = await response.text();

        const releases = [];
        // Regex to match .zip files in the directory listing
        const regex = /href="([^"]+\.zip)"/gi;
        let match;
        
        while ((match = regex.exec(html)) !== null) {
            const filenameEncoded = match[1];
            const filename = decodeURIComponent(filenameEncoded);
            const name = filename.replace(/\.zip$/i, '');
            
            const targetDir = path.join(config.modsPath, 'fsr4files', name);
            let installed = false;

            if (fs.existsSync(targetDir)) {
                try {
                    const files = fs.readdirSync(targetDir);
                    if (files.length > 0) {
                        installed = true;
                    }
                } catch (e) {}
            }

            releases.push({
                name: name,
                tag: name,
                downloadUrl: `http://190.92.151.212/fsr4files/${filenameEncoded}`,
                installed: installed
            });
        }

        // Return latest releases (reversed if they are listed chronologically, or sorted)
        // Usually nginx lists alphabetically, so we return them directly
        return releases;
    } catch (e) {
        console.error("Failed to fetch FSR4 releases:", e);
        return { error: e.message };
    }
}

async function downloadFsr4Release(event, { name, downloadUrl }) {
    const tempZipPath = path.join(app.getPath('temp'), `fsr4_${name.replace(/[^a-z0-9.-]/gi, '_')}.zip`);
    const targetDir = path.join(config.modsPath, 'fsr4files', name);

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
                event.sender.send('fsr4-download-progress', { percent });
            }
        }

        const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
        fs.writeFileSync(tempZipPath, buffer);

        // Ensure target directory exists and is clean
        if (fs.existsSync(targetDir)) {
            try {
                // If it already exists, let's clear its contents or just write over it
                // To avoid folder removal permission issues, we can just extract over it.
            } catch(e) {}
        } else {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        if (event && event.sender && !event.sender.isDestroyed()) {
            event.sender.send('fsr4-download-progress', { percent: 100, stage: 'extracting' });
        }

        // Extract using extract-zip
        await extract(tempZipPath, { dir: targetDir });

        // Clean up temporary archive file
        try {
            fs.unlinkSync(tempZipPath);
        } catch (e) {
            console.error("Failed to clean up temp zip:", e);
        }

        return { success: true, targetDir };
    } catch (e) {
        console.error("FSR4 download error:", e);
        
        // Check if the temp file exists. If it exists and we crashed during extraction,
        // it means the downloaded archive was corrupted or incomplete.
        const isCorrupt = fs.existsSync(tempZipPath);
        
        // Clean up temp file on error
        try {
            if (fs.existsSync(tempZipPath)) {
                fs.unlinkSync(tempZipPath);
            }
        } catch (unlinkErr) {
            console.error("Failed to clean up temp zip on error:", unlinkErr);
        }

        let errorMessage = e.message;
        if (isCorrupt) {
            errorMessage = "Dosya bozuk veya eksik indi, lütfen tekrar deneyin.";
        }

        return { success: false, error: errorMessage };
    }
}

module.exports = {
    getFsr4Releases,
    downloadFsr4Release
};
