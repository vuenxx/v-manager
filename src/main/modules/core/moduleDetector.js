'use strict';

/**
 * moduleDetector.js — Manifest tabanlı disk üzerinde mod tespiti
 *
 * Eskiden `scanner.js` içinde her mod için elle yazılmış if/else zinciri vardı
 * (optiscaler / optibuilder / dlssenabler / streamline). Artık her modül
 * "diskte nasıl tanınırım" bilgisini kendi manifest'inde `detect` bloğuyla
 * bildiriyor; scanner sadece bu motoru çağırıyor.
 *
 * manifest.detect:
 * {
 *   "priority": 60,                 // yüksek olan önce dener, ilk eşleşen kazanır
 *   "exclusiveGroup": "optiscaler", // aynı gruptan yalnızca en yüksek öncelikli tespit kalır
 *   "depthStrategy": "shallowest",  // "deepest" → daha derin klasör bulunursa üzerine yazar
 *   "sticky": false,                // true → tespit edilmezse mevcut state korunur (streamline)
 *   "match": {
 *     "anyFileName": ["dlss-enabler.dll"],
 *     "fileNamePattern": "sl.*.dll",
 *     "proxyDll": { "candidates": ["dxgi.dll", ...], "descriptionMatch": "optiscaler" },
 *     "requireSiblingFile": "nvngx.dll_dlssnr.dll",
 *     "versionRange": { "min": "0.10", "max": "1.0" }   // min dahil, max hariç
 *   }
 * }
 */

// Not: moduleManager tembel (lazy) require ediliyor — scanner <-> modules arasinda
// dairesel bagimlilik olustugu icin dosya yuklenirken cozulmemesi gerekiyor.
let _moduleManager = null;
function mgr() {
    if (!_moduleManager) _moduleManager = require('./moduleManager');
    return _moduleManager;
}

const TAG = '[MODULE_DETECTOR]';

const TYPE_SCORE = { official: 0, community: 1, custom: 2 };

function matchGlob(str, pattern) {
    if (!pattern) return false;
    const escapeRegex = (s) => s.replace(/([.*+?^=!:${}()|[\]\/\\])/g, '\\$1');
    const regexRule = pattern.split('*').map(escapeRegex).join('.*');
    return new RegExp('^' + regexRule + '$', 'i').test(str);
}

/**
 * "0.10.5", "v10.0.0.1", "0.7.7-pre" gibi değerleri sayısal parçalara ayırır.
 * Sayı ile başlamayan parçalar 0 sayılır.
 */
function versionParts(v) {
    return String(v || '')
        .trim()
        .replace(/^v/i, '')
        .split(/[.\-+_\s]/)
        .map(p => {
            const m = /^\d+/.exec(p);
            return m ? parseInt(m[0], 10) : 0;
        });
}

function compareVersions(a, b) {
    const pa = versionParts(a);
    const pb = versionParts(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x > y) return 1;
        if (x < y) return -1;
    }
    return 0;
}

/**
 * Yüklü manifest'lerden `detect` bloğu olanları öncelik sırasıyla döndürür.
 * Sıra: priority (büyükten küçüğe) → tür (official > community > custom) → id.
 */
function getDetectors() {
    const list = [];
    for (const mod of mgr().getModules()) {
        const detect = mod.manifest && mod.manifest.detect;
        if (!detect || detect.enabled === false) continue;
        if (!detect.match) continue;
        list.push({
            moduleId: mod.id,
            type: mod.type,
            manifest: mod.manifest,
            detect,
            priority: Number.isFinite(detect.priority) ? detect.priority : 50
        });
    }

    list.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        const ts = (TYPE_SCORE[a.type] ?? 1) - (TYPE_SCORE[b.type] ?? 1);
        if (ts !== 0) return ts;
        return a.moduleId.localeCompare(b.moduleId);
    });

    return list;
}

/**
 * Tarama öncesi hazırlık: hangi dosya adlarında durup FileDescription/FileVersion
 * okunacağı. Böylece BFS sırasında her dosya için pahalı okuma yapılmaz.
 */
function buildMatchPlan(detectors) {
    const names = new Set();
    const patterns = [];
    for (const d of detectors) {
        const m = d.detect.match || {};
        if (Array.isArray(m.anyFileName)) {
            m.anyFileName.forEach(n => names.add(String(n).toLowerCase()));
        }
        if (m.proxyDll && Array.isArray(m.proxyDll.candidates)) {
            m.proxyDll.candidates.forEach(n => names.add(String(n).toLowerCase()));
        }
        if (m.fileNamePattern) patterns.push(String(m.fileNamePattern).toLowerCase());
    }
    return {
        names,
        patterns,
        isCandidate(fileNameLow) {
            if (names.has(fileNameLow)) return true;
            return patterns.some(p => matchGlob(fileNameLow, p));
        }
    };
}

/**
 * Tek bir dosyayı tüm detector'lara karşı dener, ilk eşleşeni döndürür.
 *
 * ctx: {
 *   fileNameLow,
 *   hasSibling(name)     → aynı klasörde dosya var mı (senkron, dizin listesi cache'li)
 *   readDescription()    → Promise<string>  (çağıran taraf cache'ler)
 *   readVersion()        → Promise<string|null>
 * }
 */
async function matchFile(detectors, ctx) {
    for (const d of detectors) {
        const m = d.detect.match || {};
        let nameHit = false;
        let viaProxy = false;

        if (Array.isArray(m.anyFileName) && m.anyFileName.some(n => String(n).toLowerCase() === ctx.fileNameLow)) {
            nameHit = true;
        }

        if (!nameHit && m.fileNamePattern && matchGlob(ctx.fileNameLow, String(m.fileNamePattern).toLowerCase())) {
            nameHit = true;
        }

        if (!nameHit && m.proxyDll && Array.isArray(m.proxyDll.candidates) &&
            m.proxyDll.candidates.some(c => String(c).toLowerCase() === ctx.fileNameLow)) {
            const desc = (await ctx.readDescription()) || '';
            const needle = String(m.proxyDll.descriptionMatch || '').toLowerCase();
            if (needle && desc.toLowerCase().includes(needle)) {
                nameHit = true;
                viaProxy = true;
            }
        }

        if (!nameHit) continue;

        if (m.requireSiblingFile && !ctx.hasSibling(m.requireSiblingFile)) continue;

        const version = (await ctx.readVersion()) || null;

        if (m.versionRange) {
            if (!version) {
                // Sürüm okunamadıysa: allowUnknown true ise eşleşme sürer
                // (eski davranış: sürümsüz OptiScaler DLL'i OptiScaler sayılırdı)
                if (!m.versionRange.allowUnknown) continue;
            } else {
                if (m.versionRange.min && compareVersions(version, m.versionRange.min) < 0) continue;
                if (m.versionRange.max && compareVersions(version, m.versionRange.max) >= 0) continue;
            }
        }

        return { moduleId: d.moduleId, detector: d, version, viaProxy };
    }

    return null;
}

/**
 * Aynı `exclusiveGroup` içindeki tespitlerden yalnızca en yüksek öncelikli olanı bırakır.
 * (Eski kodda OptiScaler bulununca OptiBuilder alanlarının elle sıfırlanması buydu.)
 */
function resolveExclusives(detections, detectors) {
    const byId = new Map(detectors.map(d => [d.moduleId, d]));
    const bestOfGroup = new Map();

    for (const moduleId of Object.keys(detections)) {
        const det = byId.get(moduleId);
        const group = det && det.detect.exclusiveGroup;
        if (!group) continue;
        const current = bestOfGroup.get(group);
        if (!current || det.priority > byId.get(current).priority) {
            bestOfGroup.set(group, moduleId);
        }
    }

    for (const moduleId of Object.keys(detections)) {
        const det = byId.get(moduleId);
        const group = det && det.detect.exclusiveGroup;
        if (!group) continue;
        if (bestOfGroup.get(group) !== moduleId) {
            console.log(`${TAG} '${group}' grubunda daha yüksek öncelikli tespit var, eleniyor: ${moduleId}`);
            delete detections[moduleId];
        }
    }

    return detections;
}

/**
 * Tespit sonuçlarını manifest.state alanlarına yazar.
 * Tespit edilmeyen modüllerin alanları temizlenir (detect.sticky true ise korunur).
 *
 * target: games.json oyun nesnesi (mevcut veya yeni)
 */
function applyDetections(target, detections, detectors) {
    if (!target) return target;
    const list = detectors || getDetectors();
    if (!target.upscalers) target.upscalers = {};

    for (const d of list) {
        const st = d.manifest.state;
        if (!st) continue;

        const hit = detections ? detections[d.moduleId] : null;

        if (hit) {
            if (st.flag) target[st.flag] = true;
            if (st.versionField) target[st.versionField] = hit.version || target[st.versionField] || null;
            if (st.pathField) target[st.pathField] = hit.dir;
            if (st.injectionField) target[st.injectionField] = hit.injection || target[st.injectionField] || null;
            if (st.upscalerField) target.upscalers[st.upscalerField] = true;
            continue;
        }

        if (d.detect.sticky) {
            // Tespit edilmedi ama manifest "yapışkan" diyor → mevcut değerler korunur
            if (st.flag) target[st.flag] = target[st.flag] || false;
            if (st.versionField) target[st.versionField] = target[st.versionField] || null;
            if (st.pathField) target[st.pathField] = target[st.pathField] || null;
            if (st.injectionField) target[st.injectionField] = target[st.injectionField] || null;
            if (st.upscalerField) target.upscalers[st.upscalerField] = target[st.flag] || false;
            continue;
        }

        if (st.flag) target[st.flag] = false;
        if (st.versionField) target[st.versionField] = null;
        if (st.pathField) target[st.pathField] = null;
        if (st.injectionField) target[st.injectionField] = null;
        if (st.upscalerField) target.upscalers[st.upscalerField] = false;
    }

    return target;
}

/**
 * Tek bir modülün belirli bir klasörde kurulu olup olmadığını diskten kontrol eder.
 *
 * `scanner.js` tüm kütüphaneyi tarar; burada ise tek klasör + tek modül soruluyor
 * (ör. "bu oyunun exe klasöründe ReShade var mı?"). Eşleştirme mantığı yeniden
 * yazılmaz — modülün kendi `detect.match` bloğu `matchFile` ile aynen kullanılır,
 * böylece ReShade'in API'ye göre değişen proxy DLL adı (dxgi/d3d9/opengl32) da
 * FileDescription üzerinden doğru bulunur.
 *
 * Tarama sığdır (tek seviye): proxy DLL'ler her zaman exe'nin yanındadır.
 *
 * @returns {Promise<{installed:boolean, via?:string, moduleId:string,
 *                    fileName?:string, version?:string|null, reason?:string}>}
 */
async function isModuleInstalledIn(moduleId, dir) {
    const fs = require('fs');
    const path = require('path');
    const utils = require('../../utils');

    const det = getDetectors().find(d => d.moduleId === moduleId);
    if (!det) {
        return { installed: false, moduleId, reason: 'no-detector' };
    }
    if (!dir || !fs.existsSync(dir)) {
        return { installed: false, moduleId, reason: 'no-dir' };
    }

    let entries;
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
        return { installed: false, moduleId, reason: 'read-failed' };
    }

    const detectors = [det];
    const matchPlan = buildMatchPlan(detectors);

    let dirFileSet = null;
    const hasSibling = (name) => {
        if (!dirFileSet) {
            dirFileSet = new Set(entries.filter(f => !f.isDirectory()).map(f => f.name.toLowerCase()));
        }
        return dirFileSet.has(String(name).toLowerCase());
    };

    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const nameLow = entry.name.toLowerCase();
        if (!matchPlan.isCandidate(nameLow)) continue;

        const filePath = path.join(dir, entry.name);
        let descCache;
        let verCache;

        const hit = await matchFile(detectors, {
            fileNameLow: nameLow,
            hasSibling,
            readDescription: async () => {
                if (descCache === undefined) descCache = await utils.getFileDescription(filePath);
                return descCache;
            },
            readVersion: async () => {
                if (verCache === undefined) verCache = await utils.getFileVersion(filePath);
                return verCache;
            }
        });

        if (hit) {
            return {
                installed: true,
                via: 'disk',
                moduleId,
                fileName: entry.name,
                version: hit.version || null
            };
        }
    }

    return { installed: false, moduleId, reason: 'not-found' };
}

/**
 * Tek bir dosyanin hangi V-Manager moduluna ait oldugunu diskten belirler.
 *
 * `isModuleInstalledIn` "su modul burada mi?" sorusunu sorar; burada ise tersi
 * soruluyor: "bu dosya kimin?". Kurulum sirasinda hedef dosya zaten varsa,
 * uzerine yazmadan (veya .bak almadan) once sahibini ogrenmek icin kullanilir.
 *
 * Eslestirme mantigi yeniden yazilmaz — tum modullerin kendi `detect.match`
 * bloklari `matchFile` ile oncelik sirasina gore denenir.
 *
 * @param {string} filePath            Kontrol edilecek dosyanin tam yolu
 * @param {object} [options]
 * @param {string[]} [options.excludeModuleIds]  Sahiplik aranirken atlanacak id'ler
 *                                               (or. kurulumu yapilan modulun kendisi)
 * @returns {Promise<{moduleId:string, moduleName:string, fileName:string,
 *                    version:string|null, exclusiveGroup:string|null}|null>}
 */
async function identifyFileOwner(filePath, options = {}) {
    const fs = require('fs');
    const path = require('path');
    const utils = require('../../utils');

    if (!filePath) return null;
    try {
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    } catch (e) {
        return null;
    }

    const exclude = new Set(
        (options.excludeModuleIds || []).filter(Boolean).map(id => String(id).toLowerCase())
    );

    const detectors = getDetectors().filter(d => !exclude.has(String(d.moduleId).toLowerCase()));
    if (detectors.length === 0) return null;

    const fileName = path.basename(filePath);
    const nameLow = fileName.toLowerCase();

    const matchPlan = buildMatchPlan(detectors);
    if (!matchPlan.isCandidate(nameLow)) return null;

    const dir = path.dirname(filePath);
    let dirFileSet = null;
    const hasSibling = (name) => {
        if (!dirFileSet) {
            try {
                dirFileSet = new Set(
                    fs.readdirSync(dir, { withFileTypes: true })
                        .filter(f => !f.isDirectory())
                        .map(f => f.name.toLowerCase())
                );
            } catch (e) {
                dirFileSet = new Set();
            }
        }
        return dirFileSet.has(String(name).toLowerCase());
    };

    let descCache;
    let verCache;

    const hit = await matchFile(detectors, {
        fileNameLow: nameLow,
        hasSibling,
        readDescription: async () => {
            if (descCache === undefined) descCache = await utils.getFileDescription(filePath);
            return descCache;
        },
        readVersion: async () => {
            if (verCache === undefined) verCache = await utils.getFileVersion(filePath);
            return verCache;
        }
    });

    if (!hit) return null;

    const manifest = hit.detector.manifest || {};
    return {
        moduleId: hit.moduleId,
        moduleName: manifest.name || hit.moduleId,
        fileName,
        version: hit.version || null,
        exclusiveGroup: (manifest.detect && manifest.detect.exclusiveGroup) || null
    };
}

module.exports = {
    getDetectors,
    buildMatchPlan,
    matchFile,
    isModuleInstalledIn,
    identifyFileOwner,
    resolveExclusives,
    applyDetections,
    compareVersions,
    matchGlob
};
