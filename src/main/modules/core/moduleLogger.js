'use strict';

/**
 * Modül kurulum/kaldırma günlükçüsü.
 *
 * Amaç: Bir kurulumda NE YAPILDIĞI kadar NE YAPILMADIĞI da kayda geçsin
 * (hangi dosya kopyalandı, hangi adım neden atlandı). Kayıtlar hem Türkçe hem
 * İngilizce tutulur; arayüz kullanıcının diline göre `tr`/`en` alanını gösterir.
 *
 * Kullanım (iki biçim de geçerlidir):
 *   logger.step('Manifest doğrulandı');                    // yalnız TR (eski çağrılar)
 *   logger.step({ tr: 'Manifest doğrulandı',
 *                 en: 'Manifest validated' });             // iki dilli
 *   logger.skip({ tr: 'Yedekleme atlandı (manifest\'te yok)',
 *                 en: 'Backup skipped (not declared in manifest)' });
 *
 * Girdi biçimi (getLog()):
 *   { timestamp, level, message, tr, en, detail }
 *   `message` geriye dönük uyumluluk için TR metnidir.
 *
 * Günlük ayrıca `<userData>/logs/modules.log` dosyasına da yazılır; arayüz
 * kapansa bile kurulum kaydı diskte kalır.
 */

const fs = require('fs');
const path = require('path');

const LEVEL_SYMBOLS = {
    step: '✓',
    skip: '⊘',
    warn: '⚠',
    error: '✗',
    info: 'ℹ'
};

let _logFilePath = null;
let _logFileBroken = false;

/** `<userData>/logs/modules.log` — electron yoksa (testler) devre dışı kalır. */
function getLogFilePath() {
    if (_logFilePath || _logFileBroken) return _logFilePath;
    try {
        const { app } = require('electron');
        const dir = path.join(app.getPath('userData'), 'logs');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        _logFilePath = path.join(dir, 'modules.log');
    } catch (e) {
        _logFileBroken = true;
    }
    return _logFilePath;
}

/** Dosya günlüğü 5 MB'ı aşarsa bir kez döndürülür (modules.log.1). */
function rotateIfNeeded(file) {
    try {
        if (!fs.existsSync(file)) return;
        if (fs.statSync(file).size < 5 * 1024 * 1024) return;
        fs.renameSync(file, `${file}.1`);
    } catch (e) {
        /* döndürme başarısızsa yazmaya devam et */
    }
}

function appendToFile(line) {
    const file = getLogFilePath();
    if (!file) return;
    try {
        rotateIfNeeded(file);
        fs.appendFileSync(file, line + '\n', 'utf-8');
    } catch (e) {
        _logFileBroken = true;
    }
}

/**
 * `'metin'` veya `{ tr, en }` → `{ tr, en }`.
 * Tek dil verilmişse diğer dil aynı metne düşer (bilgi kaybetmemek için).
 */
function normalizeMessage(input) {
    if (input && typeof input === 'object') {
        const tr = input.tr || input.en || '';
        const en = input.en || input.tr || '';
        return { tr, en, detail: input.detail || null };
    }
    const text = String(input == null ? '' : input);
    return { tr: text, en: text, detail: null };
}

function createLogger(moduleId, context = {}) {
    const logs = [];
    const scope = context.scope || 'install';   // install | uninstall | ...
    const gameName = context.gameName || null;

    function getTimestamp() {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        return `[${h}:${m}:${s}]`;
    }

    function logEntry(level, input) {
        const { tr, en, detail } = normalizeMessage(input);
        const timestamp = getTimestamp();
        const symbol = LEVEL_SYMBOLS[level] || '·';
        const gameTag = gameName ? ` {${gameName}}` : '';
        const formatted = `${timestamp} [${moduleId}]${gameTag} [${scope}] ${symbol} ${en}`;

        logs.push({ timestamp, level, message: tr, tr, en, detail });

        if (level === 'error') {
            console.error(formatted);
        } else if (level === 'warn') {
            console.warn(formatted);
        } else {
            console.log(formatted);
        }

        appendToFile(`${new Date().toISOString()} [${moduleId}]${gameTag} [${scope}] ${symbol} TR: ${tr} | EN: ${en}`);
    }

    return {
        /** Yapılan iş. */
        step: (message) => logEntry('step', message),
        /** Bilinçli olarak YAPILMAYAN iş — sebebiyle birlikte yazılmalı. */
        skip: (message) => logEntry('skip', message),
        /** Nötr bilgi (ör. çözülen sürüm, hedef klasör). */
        info: (message) => logEntry('info', message),
        warn: (message) => logEntry('warn', message),
        error: (message) => logEntry('error', message),
        getLog: () => [...logs],
        /** Seviyeye göre özet — sonuç ekranında "n kopyalandı, m atlandı". */
        summary: () => logs.reduce((acc, e) => {
            acc[e.level] = (acc[e.level] || 0) + 1;
            return acc;
        }, {}),
        clear: () => { logs.length = 0; }
    };
}

module.exports = {
    createLogger,
    normalizeMessage,
    getLogFilePath
};
