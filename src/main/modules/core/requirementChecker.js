'use strict';

/**
 * requirementChecker.js — Manifest ön koşulları (`requires`)
 *
 * Bazı modüller tek başına çalışmaz: MFG Unlock bir `.addon64` dosyasıdır ve
 * yalnızca ReShade'in addon destekli sürümü tarafından yüklenir. ReShade yokken
 * dosyayı oyun klasörüne atmak sessizce hiçbir şey yapmaz. `conditions` bloğu bu
 * iş için yeterli değil: kurulum başladıktan sonra throw ediyor ve UI'da hiç
 * görünmüyor. `requires` bildirimsel — hem kurulum modalı hem motor aynı
 * sonucu okur.
 *
 * manifest.requires:
 * [
 *   {
 *     "moduleId": "reshade",
 *     "severity": "block",            // "block" (varsayılan) | "warn"
 *     "messageKey": "mfg.requiresReshade",  // i18n anahtarı (renderer çözer)
 *     "message": "Bu mod ReShade gerektirir."
 *   }
 * ]
 *
 * Kontrol sırası: önce DİSK (en güvenilir), sonra games.json state'i.
 * Kullanıcı ReShade'i V-Manager dışında kurmuş olabilir ya da tarama bayat
 * olabilir; bu yüzden bayrağa değil dosyaya bakılır.
 */

const moduleDetector = require('./moduleDetector');

const TAG = '[REQUIREMENT_CHECKER]';

// moduleManager <-> requirementChecker arasında dairesel bağımlılık oluşmaması
// için tembel (lazy) require — moduleDetector'daki mgr() ile aynı gerekçe.
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

/** games.json içinden oyun kaydını bulur (moduleEngine:926 ile aynı idiom). */
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

/**
 * Oyun kaydında modülün kurulu görünüp görünmediği.
 * moduleManager'ın `module-get-active-for-game` içindeki kanonik ikili kontrolü.
 */
function isInstalledInState(game, moduleId, targetManifest) {
    if (!game) return false;
    const flag = targetManifest && targetManifest.state && targetManifest.state.flag;
    if (flag && game[flag] === true) return true;
    if (game.installedMods && game.installedMods[moduleId] && game.installedMods[moduleId].installed) return true;
    return false;
}

/**
 * Bir manifestin tüm ön koşullarını değerlendirir.
 *
 * @param {object} manifest  Kurulmak istenen modülün manifest'i
 * @param {object} context   { gameName, exePath, gameDir }
 * @returns {Promise<{
 *   satisfied: boolean,
 *   results: Array<{moduleId, name, satisfied, severity, via, message, messageKey, installable}>,
 *   failures: Array<{type:'requires', moduleId, message}>
 * }>}
 *
 * `failures` şekli bilerek conditionChecker ile aynı — kurulum modalı bu diziyi
 * zaten ayrıştırıp gösteriyor.
 */
async function checkRequirements(manifest, context = {}) {
    const { gameName, gameDir } = context;
    const requires = Array.isArray(manifest && manifest.requires) ? manifest.requires : [];

    if (requires.length === 0) {
        return { satisfied: true, results: [], failures: [] };
    }

    const game = findGameRecord(gameName);
    const results = [];
    const failures = [];

    for (const req of requires) {
        if (!req || typeof req !== 'object' || !req.moduleId) continue;
        if (req.enabled === false) continue;

        const moduleId = req.moduleId;
        const severity = req.severity === 'warn' ? 'warn' : 'block';

        let target = null;
        try {
            target = mgr().getModule(moduleId);
        } catch (e) {
            console.warn(`${TAG} Modül çözümlenemedi (${moduleId}): ${e.message}`);
        }
        const targetManifest = target ? target.manifest : null;
        const name = (targetManifest && targetManifest.name) || moduleId;

        // 1) Disk — en güvenilir kaynak
        let via = null;
        let version = null;
        const diskHit = await moduleDetector.isModuleInstalledIn(moduleId, gameDir);
        if (diskHit.installed) {
            via = 'disk';
            version = diskHit.version || null;
        } else if (isInstalledInState(game, moduleId, targetManifest)) {
            // 2) games.json — tespit kuralı olmayan modüller için yedek
            via = 'state';
            const vf = targetManifest && targetManifest.state && targetManifest.state.versionField;
            version = (vf && game && game[vf]) || null;
        }

        const satisfied = Boolean(via);

        results.push({
            moduleId,
            name,
            satisfied,
            severity,
            via,
            version,
            message: req.message || `Bu mod ${name} gerektirir.`,
            messageKey: req.messageKey || null,
            // Hedef modül yüklü değilse UI "Önce kur" butonu göstermemeli
            installable: Boolean(target)
        });

        if (!satisfied && severity === 'block') {
            failures.push({
                type: 'requires',
                moduleId,
                message: req.message || `Bu mod ${name} gerektirir. Lütfen önce ${name} kurun.`
            });
        }
    }

    const satisfied = failures.length === 0;
    console.log(`${TAG} ${manifest.id}: ${satisfied ? 'SAĞLANDI' : 'EKSİK (' + failures.length + ')'}`);

    return { satisfied, results, failures };
}

module.exports = {
    checkRequirements
};
