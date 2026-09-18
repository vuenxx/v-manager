'use strict';

const extract = require('extract-zip');
const { execFile } = require('child_process');
const { path7za } = require('7zip-bin');

const SUPPORTED_FORMATS = ['.zip', '.7z', '.rar', '.exe'];

function getSupportedFormats() {
    return [...SUPPORTED_FORMATS];
}

function supportsFormat(extension) {
    if (!extension) return false;
    let ext = extension.toLowerCase();
    if (!ext.startsWith('.')) ext = '.' + ext;
    return SUPPORTED_FORMATS.includes(ext);
}

async function extractArchive(archivePath, targetDir) {
    console.log(`[ARCHIVE] Çıkarılıyor: ${archivePath} -> ${targetDir}`);
    const lower = archivePath.toLowerCase();

    // SFX kurulum dosyalari (.exe) genelde gomulu zip/7z arsividir; 7za bunlari acabilir
    // (ReShade setup exe'si bu sekilde -> icinden ReShade32/64.dll cikarilir)
    if (lower.endsWith('.7z') || lower.endsWith('.exe')) {
        return new Promise((resolve, reject) => {
            execFile(path7za, ['x', archivePath, `-o${targetDir}`, '-y'], (err, stdout, stderr) => {
                if (err) {
                    console.error('[ARCHIVE] 7za extract error:', err, stderr);
                    return reject(new Error(`7z extraction failed: ${err.message || stderr}`));
                }
                resolve();
            });
        });
    } else if (lower.endsWith('.zip')) {
        try {
            await extract(archivePath, { dir: targetDir });
        } catch (err) {
            console.error('[ARCHIVE] ZIP çıkarma hatası:', err);
            throw new Error(`ZIP extraction failed: ${err.message}`);
        }
    } else if (lower.endsWith('.rar')) {
        // 7za RAR desteklemiyor; RAR4/RAR5 için node-unrar-js (WASM).
        // Tembel require: paket yüklenemezse .zip/.7z akışları etkilenmesin.
        const { extractRar } = require('./rarExtractor');
        try {
            await extractRar(archivePath, targetDir);
        } catch (err) {
            console.error('[ARCHIVE] RAR çıkarma hatası:', err);
            throw new Error(`RAR extraction failed: ${err.message}`);
        }
    } else {
        throw new Error(`Desteklenmeyen arşiv formatı: ${archivePath}. Desteklenen formatlar: ${SUPPORTED_FORMATS.join(', ')}`);
    }
}

module.exports = {
    extractArchive,
    supportsFormat,
    getSupportedFormats
};
