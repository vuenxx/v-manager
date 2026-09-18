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

module.exports = {
    checkDeclaredConflicts,
    findFileOwnerConflict,
    normalizeConflictEntries,
    conflictMessage
};
