'use strict';

/**
 * rarExtractor.js — RAR4/RAR5 arşiv çıkarma (node-unrar-js / WASM)
 *
 * Projedeki 7za.exe RAR desteklemediği için (format listesi: 7z/zip/tar/xz/bz2/gz/cab)
 * .rar arşivleri bu modülle açılır. `archive.js` buraya tembel (lazy) require ile
 * delege eder; paket yüklenemezse mevcut .zip/.7z akışları etkilenmez.
 */

const fs = require('fs');
const path = require('path');

const TAG = '[RAR_EXTRACTOR]';

let _wasmBinary = null;
let _wasmChecked = false;

/**
 * node-unrar-js'in unrar.wasm dosyasını okur.
 * Paketlenmiş uygulamada dosya app.asar içinde kalırsa WASM okunamayabilir;
 * bu yüzden app.asar.unpacked varyantı da denenir (package.json → build.asarUnpack).
 *
 * @returns {Buffer|null} bulunamazsa null (kütüphane kendi yükleyicisini dener)
 */
function _loadWasmBinary() {
    if (_wasmChecked) return _wasmBinary;
    _wasmChecked = true;

    try {
        const entry = require.resolve('node-unrar-js');      // .../node-unrar-js/dist/index.js
        const distDir = path.dirname(entry);
        const pkgDir = path.dirname(distDir);

        const candidates = [
            path.join(distDir, 'js', 'unrar.wasm'),
            path.join(pkgDir, 'dist', 'js', 'unrar.wasm'),
            path.join(pkgDir, 'esm', 'js', 'unrar.wasm'),
            path.join(pkgDir, 'unrar.wasm')
        ];

        for (const candidate of candidates) {
            for (const p of [candidate, candidate.replace('app.asar', 'app.asar.unpacked')]) {
                try {
                    if (fs.existsSync(p)) {
                        _wasmBinary = fs.readFileSync(p);
                        console.log(`${TAG} WASM yüklendi: ${p}`);
                        return _wasmBinary;
                    }
                } catch (e) { /* sonraki adaya geç */ }
            }
        }

        console.warn(`${TAG} unrar.wasm bulunamadı, kütüphanenin kendi yükleyicisi denenecek.`);
    } catch (e) {
        console.warn(`${TAG} WASM yolu çözümlenemedi: ${e.message}`);
    }

    return null;
}

/**
 * RAR arşivini targetDir içine çıkarır.
 *
 * @param {string} archivePath  .rar dosyasının yolu
 * @param {string} targetDir    hedef klasör (yoksa oluşturulur)
 * @returns {Promise<{ files: string[] }>} çıkarılan dosyaların göreli adları
 */
async function extractRar(archivePath, targetDir) {
    let createExtractorFromData;
    try {
        ({ createExtractorFromData } = require('node-unrar-js'));
    } catch (e) {
        throw new Error('RAR desteği için node-unrar-js paketi kurulu değil. "npm install node-unrar-js" çalıştırın.');
    }

    if (!fs.existsSync(archivePath)) {
        throw new Error(`RAR arşivi bulunamadı: ${archivePath}`);
    }
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const data = fs.readFileSync(archivePath);
    const wasmBinary = _loadWasmBinary();

    const extractor = await createExtractorFromData(
        wasmBinary ? { data, wasmBinary } : { data }
    );

    // getFileList() lazy iterator döndürür; extract() öncesi materyalize edilmeli
    const list = extractor.getFileList();
    const headers = [...list.fileHeaders];
    console.log(`${TAG} ${path.basename(archivePath)} → ${headers.length} giriş`);

    const extracted = extractor.extract();
    const resolvedTarget = path.resolve(targetDir);
    const files = [];

    for (const file of extracted.files) {
        const header = file.fileHeader;
        const entryName = header.name;

        // Zip-slip koruması: arşiv "../" ile hedef klasörün dışına yazamaz
        const dest = path.join(targetDir, entryName);
        const resolvedDest = path.resolve(dest);
        if (resolvedDest !== resolvedTarget && !resolvedDest.startsWith(resolvedTarget + path.sep)) {
            throw new Error(`Güvensiz arşiv yolu reddedildi: ${entryName}`);
        }

        if (header.flags && header.flags.directory) {
            fs.mkdirSync(dest, { recursive: true });
            continue;
        }

        if (!file.extraction) {
            // Şifre korumalı veya bozuk giriş
            throw new Error(`Arşiv girişi çıkarılamadı (şifreli olabilir): ${entryName}`);
        }

        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(file.extraction));
        files.push(entryName);
    }

    console.log(`${TAG} ${files.length} dosya çıkarıldı → ${targetDir}`);
    return { files };
}

module.exports = {
    extractRar
};
