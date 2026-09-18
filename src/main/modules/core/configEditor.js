'use strict';

const fs = require('fs');
const path = require('path');
const iniEditor = require('../../mods/iniEditor');

const TAG = '[CONFIG_EDITOR]';

function setNestedValue(obj, dotPath, value) {
    const parts = dotPath.split('.');
    const last = parts.pop();
    let current = obj;
    for (const part of parts) {
        if (current[part] === undefined || typeof current[part] !== 'object') {
            current[part] = {};
        }
        current = current[part];
    }
    current[last] = value;
}

async function readConfig(filePath, format) {
    console.log(`${TAG} Okunuyor: ${filePath} (Format: ${format})`);
    try {
        if (format === 'ini') {
            return await iniEditor.readIni(filePath);
        } else if (format === 'json') {
            if (!fs.existsSync(filePath)) {
                return { exists: false, data: {} };
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            return { exists: true, data: JSON.parse(content) };
        } else {
            throw new Error(`Bilinmeyen format: ${format}`);
        }
    } catch (err) {
        console.error(`${TAG} Hata (readConfig):`, err);
        throw err;
    }
}

async function writeConfig(filePath, data, format) {
    console.log(`${TAG} Yazılıyor: ${filePath} (Format: ${format})`);
    try {
        if (format === 'ini') {
            await iniEditor.writeIni(filePath, data);
        } else if (format === 'json') {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        } else {
            throw new Error(`Bilinmeyen format: ${format}`);
        }
    } catch (err) {
        console.error(`${TAG} Hata (writeConfig):`, err);
        throw err;
    }
}

async function applyChanges(filePath, format, changes, options = {}) {
    console.log(`${TAG} Değişiklikler uygulanıyor: ${filePath} (Format: ${format})`);
    try {
        const { exists, data, hasBom } = await readConfig(filePath, format);
        
        if (!exists && !options.createIfMissing) {
            console.log(`${TAG} Dosya bulunamadı ve createIfMissing false: ${filePath}`);
            return false;
        }

        let currentData = data || {};

        if (format === 'ini') {
            for (const [key, value] of Object.entries(changes)) {
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    // İç içe obje desteği: { "Frame-Gen": { "Enable": true } }
                    if (!currentData[key]) {
                        currentData[key] = {};
                    }
                    for (const [subKey, subVal] of Object.entries(value)) {
                        currentData[key][subKey] = subVal;
                    }
                } else {
                    // Noktalı format desteği: { "Frame-Gen.Enable": true }
                    //
                    // SON noktadan bölünür, ilkinden değil: INI bölüm adları nokta
                    // içerebiliyor (ReShade addon'ları "[RenoDX.MFGUnlock]" kullanıyor),
                    // anahtar adları içermiyor. İlk noktadan bölmek bu ayarları
                    // yanlışlıkla "[RenoDX]" altına "MFGUnlock.Enabled" olarak yazıyordu.
                    const lastDotIndex = key.lastIndexOf('.');
                    if (lastDotIndex === -1) {
                        console.error(`${TAG} Geçersiz INI anahtarı: ${key}. 'Section.Key' formatında veya { "Section": { "Key": "Val" } } olmalıdır.`);
                        continue;
                    }
                    const section = key.substring(0, lastDotIndex);
                    const subKey = key.substring(lastDotIndex + 1);

                    if (!currentData[section]) {
                        currentData[section] = {};
                    }
                    currentData[section][subKey] = value;
                }
            }
            await writeConfig(filePath, currentData, 'ini');
        } else if (format === 'json') {
            for (const [key, value] of Object.entries(changes)) {
                setNestedValue(currentData, key, value);
            }
            await writeConfig(filePath, currentData, 'json');
        }

        console.log(`${TAG} Değişiklikler başarıyla uygulandı.`);
        return true;
    } catch (err) {
        console.error(`${TAG} Hata (applyChanges):`, err);
        throw err;
    }
}

function findConfigFile(gameDir, fileNames) {
    console.log(`${TAG} Konfigürasyon dosyası aranıyor: ${fileNames.join(', ')} in ${gameDir}`);
    for (const fileName of fileNames) {
        const found = iniEditor.findFileRecursive(gameDir, fileName);
        if (found) {
            console.log(`${TAG} Bulundu: ${found}`);
            return found;
        }
    }
    console.log(`${TAG} Dosya bulunamadı.`);
    return null;
}

module.exports = {
    readConfig,
    writeConfig,
    applyChanges,
    findConfigFile
};
