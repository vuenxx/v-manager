'use strict';

/**
 * conflictChecker.js — Modül çakışma denetimi
 *
 * İki ayrı çakışma türü var; ikisi de aynı şekilde raporlanır:
 *
 * 1. **Bildirilmiş çakışma** (`manifest.conflicts`) — mod yazarı "benimle X aynı
 *    anda duramaz" diyor. `requires`'ın aynası: bildirimsel, hem kurulum modalı
 *    hem motor aynı sonucu okur.
 *
 * 2. **Dahili (dosya sahipliği) çakışması** — hedef dosya zaten var VE bu dosya
 *    başka bir V-Manager moduna ait. Bu durumda dosya `.bak` alınıp üzerine
 *    YAZILMAZ; kurulum durdurulur, çünkü `.bak` alınırsa diğer modun kurulumu
 *    sessizce bozulur ve kaldırıldığında geri gelmez.
 *
 * manifest.conflicts (geriye dönük uyumlu — alan yoksa hiçbir şey değişmez):
 * [
 *   {
 *     "moduleId": "optiscaler",
 *     "severity": "block",         // "block" (varsayılan) | "warn"
 *     "message": "...",            // opsiyonel; yoksa standart metin
 *     "messageKey": "...",         // i18n anahtarı (renderer çözer)
 *     "enabled": true              // false → koşul tamamen atlanır
 *   }
 * ]
 *
 * `incompatible_mods` aynı şemanın takma adıdır; string dizisi de kabul edilir
 * (["optiscaler"] → [{ moduleId: "optiscaler" }]).
 */

const fs = require('fs');
const path = require('path');
const moduleDetector = require('./moduleDetector');

const TAG = '[CONFLICT_CHECKER]';

// moduleManager <-> conflictChecker dairesel bağımlılığı: tembel require
let _moduleManager = null;
function mgr() {
    if (!_moduleManager) _moduleManager = require('./moduleManager');
    return _moduleManager;
}

let _config = null;
function cfg() {
    if (!_config) _config = require('../../config');
    return _config;
}

/** Standart çakışma metni — spesifikasyonda birebir bu cümle isteniyor. */
function conflictMessage(name) {
    return `${name} ile çakışıyor, lütfen önce o modu kaldırın`;
}

/**
 * Hedef dosya oyuna (ya da V-Manager dışı bir yazılıma) aitken gösterilen metin.
 * Kullanıcının yapabileceği tek şey başka bir enjeksiyon adı seçmek.
 */
function injectionConflictMessage(fileName) {
    return `Seçtiğiniz enjeksiyon tipi (${fileName}) oyunun içerisindeki dosyalarla ` +
           `çakışıyor. Lütfen farklı bir enjeksiyon tipi deneyin.`;
}

/**
 * `conflicts` / `incompatible_mods` alanını normalize eder.
 * String dizisi de, nesne dizisi de kabul edilir.
 */
function normalizeConflictEntries(manifest) {
    const raw = (manifest && (manifest.conflicts || manifest.incompatible_mods)) || [];
    if (!Array.isArray(raw)) return [];

    return raw
        .map(entry => {
            if (typeof entry === 'string') return { moduleId: entry };
            if (entry && typeof entry === 'object' && entry.moduleId) return { ...entry };
            return null;
        })
        .filter(e => e && e.enabled !== false);
}

/** games.json içinden oyun kaydını bulur (requirementChecker ile aynı idiom). */
function findGameRecord(gameName) {
    if (!gameName) return null;
    try {
        const config = cfg();
        const games = config.getExistingGamesState() || [];
        return games.find(g =>
            config.normalizeGameKey(g.name) === config.normalizeGameKey(gameName)
        ) || null;
    } catch (e) {
        console.warn(`${TAG} Oyun kaydı okunamadı: ${e.message}`);
        return null;
    }
}

function isInstalledInState(game, moduleId, targetManifest) {
    if (!game) return false;
    const flag = targetManifest && targetManifest.state && targetManifest.state.flag;
    if (flag && game[flag] === true) return true;
    if (game.installedMods && game.installedMods[moduleId] && game.installedMods[moduleId].installed) return true;
    return false;
}

/**
 * Manifest'te bildirilen çakışmaları değerlendirir.
 *
 * @param {object} manifest  Kurulmak istenen modülün manifest'i
 * @param {object} context   { gameName, exePath, gameDir }
 * @returns {Promise<{clear:boolean, results:Array, failures:Array}>}
 *
 * `failures` şekli bilerek conditionChecker / requirementChecker ile aynı —
 * kurulum modalı bu diziyi zaten ayrıştırıp gösteriyor.
 */
async function checkDeclaredConflicts(manifest, context = {}) {
    const { gameName, gameDir } = context;
    const entries = normalizeConflictEntries(manifest);

    if (entries.length === 0) {
        return { clear: true, results: [], failures: [] };
    }

    const game = findGameRecord(gameName);
    const results = [];
    const failures = [];

    for (const entry of entries) {
        const moduleId = entry.moduleId;
        if (!moduleId || moduleId === manifest.id) continue;

        const severity = entry.severity === 'warn' ? 'warn' : 'block';

        let target = null;
        try {
            target = mgr().getModule(moduleId);
        } catch (e) {
            console.warn(`${TAG} Modül çözümlenemedi (${moduleId}): ${e.message}`);
        }
        const targetManifest = target ? target.manifest : null;
        const name = (targetManifest && targetManifest.name) || moduleId;

        // Önce disk (en güvenilir), sonra games.json bayrağı — requires ile aynı sıra
        let via = null;
        const diskHit = await moduleDetector.isModuleInstalledIn(moduleId, gameDir);
        if (diskHit.installed) {
            via = 'disk';
        } else if (isInstalledInState(game, moduleId, targetManifest)) {
            via = 'state';
        }

        const present = Boolean(via);

        results.push({
            moduleId,
            name,
            present,
            severity,
            via,
            message: entry.message || conflictMessage(name),
            messageKey: entry.messageKey || null
        });

        if (present && severity === 'block') {
            failures.push({
                type: 'conflicts',
                moduleId,
                message: entry.message || conflictMessage(name)
            });
        }
    }

    const clear = failures.length === 0;
    console.log(`${TAG} ${manifest.id}: ${clear ? 'TEMİZ' : 'ÇAKIŞMA (' + failures.length + ')'}`);

    return { clear, results, failures };
}

/**
 * Dahili çakışma: hedef dosya zaten var ve başka bir V-Manager moduna ait mi?
 *
 * Aynı `detect.exclusiveGroup` içindeki modüller (ör. OptiScaler ↔ OptiBuilder)
 * birbirinin varyantıdır — biri diğerinin üzerine kurulabilir, çakışma sayılmaz.
 *
 * @param {object} manifest    Kurulmak istenen modülün manifest'i
 * @param {string} destDir     Kurulum hedef klasörü
 * @param {string[]} fileNames destDir altında yazılacak dosya adları
 * @returns {Promise<{moduleId, moduleName, fileName, version}|null>}
 */
async function findFileOwnerConflict(manifest, destDir, fileNames = []) {
    if (!destDir || !Array.isArray(fileNames) || fileNames.length === 0) return null;

    const excludeModuleIds = [manifest.id, ...(Array.isArray(manifest.aliases) ? manifest.aliases : [])];
    const ownGroup = manifest.detect && manifest.detect.exclusiveGroup;

    for (const fileName of fileNames) {
        if (!fileName) continue;
        const targetPath = path.join(destDir, fileName);

        const owner = await moduleDetector.identifyFileOwner(targetPath, { excludeModuleIds });
        if (!owner) continue;

        // Aynı aileden bir varyant — üzerine kurulum normal akış
        if (ownGroup && owner.exclusiveGroup === ownGroup) {
            console.log(`${TAG} ${fileName} sahibi aynı grupta (${ownGroup}), çakışma sayılmadı: ${owner.moduleId}`);
            continue;
        }

        console.log(`${TAG} Dahili çakışma: ${fileName} → ${owner.moduleId}`);
        return owner;
    }

    return null;
}

/**
 * Yabancı dosya çakışması: hedefte aynı adlı bir dosya VAR ama sahibi
 * ne biz ne de başka bir V-Manager modülü — yani dosya oyunun kendisine
 * (veya elle kurulmuş bir moda) ait. Üzerine yazmak/yedeklemek kullanıcının
 * oyununu bozabileceği için kurulum durdurulur; çözüm başka bir enjeksiyon
 * adı seçmektir.
 *
 * Sahiplik `detect` blokları üzerinden bilinir; `detect` tanımlamayan bir
 * manifest için "bizim mi" sorusu cevaplanamaz, o yüzden kontrol atlanır
 * (eski davranış korunur).
 *
 * @returns {Promise<string|null>} çakışan dosya adı, yoksa null
 */
async function findForeignTargetConflict(manifest, destDir, fileNames = []) {
    if (!manifest || !manifest.detect) return null;
    if (!destDir || !Array.isArray(fileNames) || fileNames.length === 0) return null;

    const ownIds = new Set(
        [manifest.id, ...(Array.isArray(manifest.aliases) ? manifest.aliases : [])]
            .filter(Boolean).map(id => String(id).toLowerCase())
    );
    const ownGroup = manifest.detect.exclusiveGroup;

    for (const fileName of fileNames) {
        if (!fileName) continue;
        const targetPath = path.join(destDir, fileName);

        let exists = false;
        try {
            exists = fs.existsSync(targetPath) && fs.statSync(targetPath).isFile();
        } catch (e) { /* ignore */ }
        if (!exists) continue;

        // Hiçbir modül hariç tutulmaz: dosya BİZE aitse (güncelleme/yeniden
        // kurulum) sahibi bulunur ve çakışma sayılmaz.
        const owner = await moduleDetector.identifyFileOwner(targetPath, {});

        if (owner) {
            const ownerId = String(owner.moduleId || '').toLowerCase();
            if (ownIds.has(ownerId)) continue;                                  // kendi kurulumumuz
            if (ownGroup && owner.exclusiveGroup === ownGroup) continue;        // aynı aileden varyant
            continue;  // başka bir modül → findFileOwnerConflict'in işi
        }

        console.log(`${TAG} Yabancı dosya çakışması: ${fileName} (sahibi bilinmiyor)`);
        return fileName;
    }

    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Eklenti (addon) çakışmaları
//
// `role: "both"` olan bir modül hem tek başına (ör. proxy DLL olarak) hem de
// başka bir modun eklentisi olarak (ör. plugins/X.asi) kurulabilir. İkisi aynı
// oyunda bulunursa mod iki kez yüklenir. Bu iki fonksiyon iki yönü de kapatır:
//   - checkAddonConflicts:      ana mod + eklenti kurulurken
//   - findAddonInstallConflict: modül tek başına kurulurken
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Eklentinin hedef dosya yolu — yalnızca `renameTo` ile tek ve kesin bir ad
 * verilmişse bilinebilir. `include` glob'u (ör. "*.dll") oyunun kendi
 * dosyalarıyla da eşleşeceği için sahiplik kanıtı sayılmaz → null.
 */
function addonTargetPath(addon, destDir) {
    const renameTo = addon && addon.install && addon.install.renameTo;
    if (!renameTo || !destDir) return null;
    const destSpec = addon.install.destination || 'game_exe';
    const addonDest = (destSpec === 'game_exe' || destSpec === 'parent') ? destDir : path.join(destDir, destSpec);
    return path.join(addonDest, renameTo);
}

/**
 * Ana mod kurulurken seçilen bir eklenti kurulabilir mi?
 *
 * Engel durumları:
 *   1. Eklentinin modülü bu oyuna zaten TEK BAŞINA kurulu (disk → games.json)
 *   2. Eklenti modülünün kendi bildirdiği çakışmalardan biri kurulu
 *      (ör. MFGUnlocker ↔ MFG Unlock RenoDX)
 *
 * @param {object} parentManifest  Kurulan ana modun manifest'i
 * @param {object} addon           parentManifest.addons[] girdisi
 * @param {object} context         { gameName, gameDir }
 * @returns {Promise<{clear:boolean, failures:Array}>}
 */
async function checkAddonConflicts(parentManifest, addon, context = {}) {
    const { gameName, gameDir } = context;
    const failures = [];

    let target = null;
    try { target = mgr().getModule(addon.moduleId); } catch (e) { /* aşağıda null */ }
    const addonManifest = target ? target.manifest : null;
    const name = (addonManifest && addonManifest.name) || addon.label || addon.moduleId;

    // 1. Aynı modül tek başına kurulu mu? Eklenti dosyasının kendisi (ör. .asi)
    //    detect adaylarında olmadığı için burada yalnızca bağımsız kurulum yakalanır.
    const diskHit = await moduleDetector.isModuleInstalledIn(addon.moduleId, gameDir);
    const game = findGameRecord(gameName);
    if (diskHit.installed || isInstalledInState(game, addon.moduleId, addonManifest)) {
        failures.push({
            type: 'addon_standalone',
            moduleId: addon.moduleId,
            name,
            message: `${name} bu oyuna zaten tek başına kurulu. Aynı mod iki kez yüklenir; eklenti olarak kurmak için önce onu kaldırın.`
        });
    }

    // 2. Eklenti modülünün kendi bildirdiği çakışmalar (ana modun kendisi hariç)
    if (addonManifest) {
        const declared = await checkDeclaredConflicts(addonManifest, { gameName, gameDir });
        for (const r of declared.results) {
            if (!r.present || r.severity !== 'block' || r.moduleId === parentManifest.id) continue;
            failures.push({
                type: 'addon_conflicts',
                moduleId: r.moduleId,
                name,
                message: r.message,
                messageKey: r.messageKey
            });
        }
    }

    return { clear: failures.length === 0, failures };
}

/**
 * Bir modül tek başına kurulurken: aynı modül bu klasörde zaten başka bir
 * modun eklentisi olarak mı duruyor? (ör. plugins/MFGUnlocker.asi)
 *
 * Tüm yüklü manifest'lerin `addons` listeleri taranır; hedef yolu kesin olan
 * (`renameTo`) ve diskte bulunan ilk eşleşme döner.
 *
 * @returns {Promise<{type, moduleId, parentId, parentName, fileName, message}|null>}
 */
async function findAddonInstallConflict(manifest, destDir) {
    if (!manifest || !destDir) return null;

    let modules = [];
    try { modules = mgr().getModules() || []; } catch (e) { return null; }

    for (const mod of modules) {
        const parent = mod.manifest || mod;
        if (!parent || parent.id === manifest.id || !Array.isArray(parent.addons)) continue;

        for (const addon of parent.addons) {
            if (!addon || addon.moduleId !== manifest.id) continue;
            const targetPath = addonTargetPath(addon, destDir);
            if (!targetPath || !fs.existsSync(targetPath)) continue;

            // Aynı eklenti birden fazla ana modda (OptiBuilder, DLSSNR) tanımlı
            // olabilir; diskte kurulu olanı adlandır, bulunamazsa ilk tanımlayanı.
            let parentName = parent.name || parent.id;
            for (const other of modules) {
                const om = other.manifest || other;
                if (!om || !Array.isArray(om.addons) || !om.addons.some(a => a && a.moduleId === manifest.id)) continue;
                if ((await moduleDetector.isModuleInstalledIn(om.id, destDir)).installed) {
                    parentName = om.name || om.id;
                    break;
                }
            }

            const rel = path.relative(destDir, targetPath).replace(/\\/g, '/');
            return {
                type: 'addon_installed',
                moduleId: manifest.id,
                parentName,
                fileName: rel,
                message: `${manifest.name || manifest.id} bu oyunda zaten ${parentName} eklentisi olarak kurulu (${rel}). ` +
                         `Aynı mod iki kez yüklenir; önce ${parentName} modunu kaldırın.`
            };
        }
    }
    return null;
}

module.exports = {
    checkAddonConflicts,
    findAddonInstallConflict,
    checkDeclaredConflicts,
    findFileOwnerConflict,
    findForeignTargetConflict,
    injectionConflictMessage,
    normalizeConflictEntries,
    conflictMessage
};
