const fs = require('fs');
const path = require('path');

/**
 * Klasör içinde derinlemesine dosya araması yapar (sembolik linkler ve gereksiz klasörler elenir)
 */
function findFileRecursive(dir, fileName, visited = new Set()) {
    try {
        const absPath = path.resolve(dir);
        if (visited.has(absPath)) return null;
        visited.add(absPath);

        console.log(`[INI EDITOR] findFileRecursive: checking directory "${dir}" for "${fileName}"`);

        if (!fs.existsSync(dir)) {
            console.log(`[INI EDITOR] findFileRecursive: directory "${dir}" does not exist`);
            return null;
        }
        const stats = fs.statSync(dir);
        if (stats.isFile()) {
            dir = path.dirname(dir);
        }

        const targetPath = path.join(dir, fileName);
        if (fs.existsSync(targetPath)) {
            console.log(`[INI EDITOR] findFileRecursive: FOUND EXACT MATCH at "${targetPath}"`);
            return targetPath;
        }

        const files = fs.readdirSync(dir, { withFileTypes: true });
        const priorityDirs = ['bin', 'binaries', 'x64', 'win64', 'dx12', 'plugins', 'b1', 'mafiatheoldcountry', 'runtime', 'retail'];
        const ignoreFolders = ['data', 'shader', 'resource', 'asset', 'sound', 'audio', 'video', 'movie', 'ui', 'localization', 'language', '_redist', '__commonredist', 'docs'];

        const subDirs = [];
        for (const file of files) {
            if (file.isSymbolicLink()) continue;
            if (file.isDirectory()) {
                const nameLow = file.name.toLowerCase();
                if (!ignoreFolders.includes(nameLow)) {
                    subDirs.push(path.join(dir, file.name));
                }
            }
        }

        // Öncelikli klasörleri öne al
        subDirs.sort((a, b) => {
            const baseA = path.basename(a).toLowerCase();
            const baseB = path.basename(b).toLowerCase();
            const aPriority = priorityDirs.includes(baseA);
            const bPriority = priorityDirs.includes(baseB);
            return (bPriority ? 1 : 0) - (aPriority ? 1 : 0);
        });

        for (const subDir of subDirs) {
            console.log(`[INI EDITOR] findFileRecursive: descending into "${subDir}"`);
            const found = findFileRecursive(subDir, fileName, visited);
            if (found) return found;
        }
    } catch (e) {
        console.error(`[INI EDITOR] findFileRecursive: error at "${dir}":`, e.message);
    }
    return null;
}

/**
 * Oyun nesnesinden ve mod adından ilgili INI dosyasının konumunu bulur.
 * Öncelikle kayıtlı yolları, ardından exe yanını kontrol eder.
 * Bulamazsa oyunun ana klasöründe (gameRoot) arama yapar.
 */
function findIniPath(game, mod) {
    console.log(`[INI EDITOR] findIniPath: start. Game name: "${game ? game.name : 'undefined'}", mod: "${mod}"`);
    console.log(`[INI EDITOR] findIniPath: game object payload:`, JSON.stringify(game, null, 2));

    // 1. Oyun nesnesinde önceden bulunmuş/kaydedilmiş mod klasörleri varsa kontrol et
    if (mod === 'dlss-enabler' && game.dlssEnablerPath) {
        const targetPath = path.join(game.dlssEnablerPath, 'dlss-enabler.ini');
        const exists = fs.existsSync(targetPath);
        console.log(`[INI EDITOR] findIniPath: Step 1 checking game.dlssEnablerPath "${targetPath}" - exists: ${exists}`);
        if (exists) return targetPath;
    }
    if (mod === 'optiscaler') {
        if (game.optiscalerPath) {
            const opti1 = path.join(game.optiscalerPath, 'OptiScaler.ini');
            const opti2 = path.join(game.optiscalerPath, 'optiscaler.ini');
            const exists2 = fs.existsSync(opti2);
            const exists1 = fs.existsSync(opti1);
            console.log(`[INI EDITOR] findIniPath: Step 1 checking game.optiscalerPath. optiscaler.ini exists: ${exists2}, OptiScaler.ini exists: ${exists1}`);
            if (exists2) return opti2;
            if (exists1) return opti1;
        }
        if (game.dlssEnablerPath) {
            const opti1 = path.join(game.dlssEnablerPath, 'OptiScaler.ini');
            const opti2 = path.join(game.dlssEnablerPath, 'optiscaler.ini');
            const exists2 = fs.existsSync(opti2);
            const exists1 = fs.existsSync(opti1);
            console.log(`[INI EDITOR] findIniPath: Step 1 checking game.dlssEnablerPath for OptiScaler. optiscaler.ini exists: ${exists2}, OptiScaler.ini exists: ${exists1}`);
            if (exists2) return opti2;
            if (exists1) return opti1;
        }
    }

    // 2. Standart konum: EXE'nin bulunduğu klasör
    if (!game.exePath) {
        console.log(`[INI EDITOR] findIniPath: Step 2 failed, game.exePath is empty`);
        return null;
    }
    let baseDir = game.exePath;
    try {
        if (fs.existsSync(game.exePath)) {
            const stats = fs.statSync(game.exePath);
            if (stats.isFile()) {
                baseDir = path.dirname(game.exePath);
            }
        }
    } catch (e) {
        console.error(`[INI EDITOR] findIniPath: error stats for game.exePath "${game.exePath}":`, e.message);
    }
    console.log(`[INI EDITOR] findIniPath: Step 2 derived baseDir is "${baseDir}"`);

    if (mod === 'dlss-enabler') {
        const stdPath = path.join(baseDir, 'dlss-enabler.ini');
        const exists = fs.existsSync(stdPath);
        console.log(`[INI EDITOR] findIniPath: Step 2 checking baseDir "${stdPath}" - exists: ${exists}`);
        if (exists) return stdPath;
    } else if (mod === 'optiscaler') {
        const opti1 = path.join(baseDir, 'OptiScaler.ini');
        const opti2 = path.join(baseDir, 'optiscaler.ini');
        const exists2 = fs.existsSync(opti2);
        const exists1 = fs.existsSync(opti1);
        console.log(`[INI EDITOR] findIniPath: Step 2 checking baseDir. optiscaler.ini exists: ${exists2}, OptiScaler.ini exists: ${exists1}`);
        if (exists2) return opti2;
        if (exists1) return opti1;
    }

    // 3. Fallback: Oyun ana klasöründe (gameRoot) veya exe klasöründe recursive ara
    const searchRoot = game.gameRoot || baseDir;
    console.log(`[INI EDITOR] findIniPath: Step 3 starting recursive search in searchRoot "${searchRoot}"`);
    if (mod === 'dlss-enabler') {
        const found = findFileRecursive(searchRoot, 'dlss-enabler.ini');
        console.log(`[INI EDITOR] findIniPath: Step 3 found for dlss-enabler: "${found}"`);
        if (found) return found;
    } else if (mod === 'optiscaler') {
        const found1 = findFileRecursive(searchRoot, 'OptiScaler.ini');
        console.log(`[INI EDITOR] findIniPath: Step 3 found1 for OptiScaler: "${found1}"`);
        if (found1) return found1;
        const found2 = findFileRecursive(searchRoot, 'optiscaler.ini');
        console.log(`[INI EDITOR] findIniPath: Step 3 found2 for optiscaler: "${found2}"`);
        if (found2) return found2;
    }

    // 4. Bulunamazsa varsayılan olarak exe yanını döndür (yeni oluşturulacaksa)
    if (mod === 'dlss-enabler') {
        const fallback = path.join(baseDir, 'dlss-enabler.ini');
        console.log(`[INI EDITOR] findIniPath: Step 4 fallback path for dlss-enabler: "${fallback}"`);
        return fallback;
    } else if (mod === 'optiscaler') {
        const fallback = path.join(baseDir, 'OptiScaler.ini');
        console.log(`[INI EDITOR] findIniPath: Step 4 fallback path for optiscaler: "${fallback}"`);
        return fallback;
    }
    console.log(`[INI EDITOR] findIniPath: returning null`);
    return null;
}

/**
 * INI dosyasını okur ve section-key hiyerarşisinde JSON objesi döner.
 */
function readIni(filePath) {
    console.log(`[INI EDITOR] readIni: start reading path "${filePath}"`);
    if (!fs.existsSync(filePath)) {
        console.log(`[INI EDITOR] readIni: path "${filePath}" does not exist on disk.`);
        return { exists: false, data: {} };
    }

    try {
        const rawContent = fs.readFileSync(filePath, 'utf8');
        // M-11: Detect and strip BOM for parsing, but track its presence
        const hasBom = rawContent.startsWith('\uFEFF');
        const content = hasBom ? rawContent.slice(1) : rawContent;
        console.log(`[INI EDITOR] readIni: successfully read content length: ${content.length}, hasBom: ${hasBom}`);
        // CRLF veya LF tespiti
        const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
        const lines = content.split(/\r?\n/);
        console.log(`[INI EDITOR] readIni: split into ${lines.length} lines`);
        
        const data = {};
        let currentSection = null;
        
        for (const rawLine of lines) {
            const line = rawLine.trim();
            // Yorum satırlarını ve boşlukları atla
            if (!line || line.startsWith(';') || line.startsWith('#')) {
                continue;
            }
            
            // Section algılama
            if (line.startsWith('[') && line.endsWith(']')) {
                currentSection = line.substring(1, line.length - 1).trim();
                if (!data[currentSection]) {
                    data[currentSection] = {};
                }
                continue;
            }
            
            // Key=Value algılama
            if (currentSection) {
                const eqIndex = line.indexOf('=');
                if (eqIndex !== -1) {
                    const key = line.substring(0, eqIndex).trim();
                    const val = line.substring(eqIndex + 1).trim();
                    
                    // M-10: Keep values as strings — numeric coercion removed.
                    // true/false booleans are kept as-is for toggle support.
                    let parsed;
                    if (val.toLowerCase() === 'true') parsed = true;
                    else if (val.toLowerCase() === 'false') parsed = false;
                    else parsed = val; // Always string — no Number() coercion
                    
                    data[currentSection][key] = parsed;
                }
            }
        }
        
        console.log(`[INI EDITOR] readIni: parse success. Sections parsed:`, Object.keys(data));
        // M-11: Pass hasBom back so writeIni can restore it
        return { exists: true, data, hasBom };
    } catch (e) {
        console.error(`[INI EDITOR] readIni: ERROR while reading/parsing:`, e.message);
        return { exists: false, error: e.message };
    }
}

/**
 * INI dosyasına, mevcut yorumları ve yapıyı koruyarak newData içindeki değerleri yazar.
 * Windows sistemlerindeki \r\n vs \n satır sonu formatını tespit eder ve bozmaz.
 */
function writeIni(filePath, newData) {
    let content = '';
    let lineEnding = '\r\n'; // Windows için varsayılan
    let hasBom = false;
    
    if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, 'utf8');
        hasBom = content.startsWith('\uFEFF');
        if (hasBom) content = content.slice(1);
        lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
    } else {
        // Dosya hiç yoksa, temiz bir şekilde newData'dan oluşturalım
        let newContent = '';
        for (const [section, keys] of Object.entries(newData)) {
            newContent += `[${section}]${lineEnding}`;
            for (const [key, val] of Object.entries(keys)) {
                newContent += `${key}=${val}${lineEnding}`;
            }
            newContent += lineEnding;
        }
        fs.writeFileSync(filePath, '\uFEFF' + newContent, 'utf8');
        return true;
    }
    
    const lines = content.split(lineEnding);
    let currentSection = null;      // parsed from file
    let schemaSectionKey = null;    // matching key in newData (case-insensitive)
    
    // writtenKeys will track which sections/keys in newData have been written
    // Structure: { schemaSectionKey: Set(schemaKey) }
    const writtenKeys = {};
    for (const sec of Object.keys(newData)) {
        writtenKeys[sec] = new Set();
    }
    
    const outputLines = [];
    
    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const trimmed = rawLine.trim();
        
        // Section header check
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            // Before leaving the previous section, write any of its keys that weren't in the file
            if (schemaSectionKey && newData[schemaSectionKey]) {
                for (const [k, v] of Object.entries(newData[schemaSectionKey])) {
                    if (!writtenKeys[schemaSectionKey].has(k)) {
                        outputLines.push(`${k}=${v}`);
                        writtenKeys[schemaSectionKey].add(k);
                    }
                }
            }
            
            currentSection = trimmed.substring(1, trimmed.length - 1).trim();
            // Find if this section exists in newData case-insensitively
            schemaSectionKey = Object.keys(newData).find(sec => sec.toLowerCase() === currentSection.toLowerCase()) || null;
            
            outputLines.push(rawLine);
            continue;
        }
        
        // Key=Value check
        if (schemaSectionKey && newData[schemaSectionKey] !== undefined) {
            if (trimmed && !trimmed.startsWith(';') && !trimmed.startsWith('#')) {
                const eqIndex = trimmed.indexOf('=');
                if (eqIndex !== -1) {
                    const key = trimmed.substring(0, eqIndex).trim();
                    // Find if this key exists in the schema's section case-insensitively
                    const schemaKey = Object.keys(newData[schemaSectionKey]).find(k => k.toLowerCase() === key.toLowerCase());
                    
                    if (schemaKey) {
                        const newVal = newData[schemaSectionKey][schemaKey];
                        const indent = rawLine.substring(0, rawLine.indexOf(key));
                        // Overwrite using the schema key name to ensure correct casing
                        outputLines.push(`${indent}${schemaKey}=${newVal}`);
                        writtenKeys[schemaSectionKey].add(schemaKey);
                        continue;
                    }
                }
            }
        }
        
        outputLines.push(rawLine);
    }
    
    // Write remaining keys of the last section
    if (schemaSectionKey && newData[schemaSectionKey]) {
        for (const [k, v] of Object.entries(newData[schemaSectionKey])) {
            if (!writtenKeys[schemaSectionKey].has(k)) {
                outputLines.push(`${k}=${v}`);
                writtenKeys[schemaSectionKey].add(k);
            }
        }
    }
    
    // Write completely new sections from newData
    for (const [section, keys] of Object.entries(newData)) {
        const keysNotWritten = Object.keys(keys).filter(k => !writtenKeys[section].has(k));
        if (keysNotWritten.length > 0) {
            // Check if the section was matched with any parsed section
            const wasSectionMatched = Object.keys(writtenKeys).some(sec => sec.toLowerCase() === section.toLowerCase() && (writtenKeys[sec].size > 0 || content.toLowerCase().includes(`[${section.toLowerCase()}]`)));
            
            if (!wasSectionMatched) {
                if (outputLines.length > 0 && outputLines[outputLines.length - 1] !== '') {
                    outputLines.push('');
                }
                outputLines.push(`[${section}]`);
            }
            
            for (const k of keysNotWritten) {
                outputLines.push(`${k}=${keys[k]}`);
                writtenKeys[section].add(k);
            }
        }
    }
    
    const finalContent = (hasBom ? '\uFEFF' : '') + outputLines.join(lineEnding);
    fs.writeFileSync(filePath, finalContent, 'utf8');
    return true;
}

module.exports = {
    findIniPath,
    readIni,
    writeIni
};
