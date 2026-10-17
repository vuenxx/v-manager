'use strict';

/**
 * installJournal.js — Yarım kalan kurulumları diske kaydeden defter.
 *
 * moduleEngine.install() her ilerleme adımında buraya anlık rollbackState
 * yazar. Uygulama kurulum sırasında çökerse/öldürülürse, bir sonraki açılışta
 * moduleEngine.repairPendingInstalls() bu dosyayı okuyup yarım kalan
 * değişiklikleri (yeni kopyalanan dosyalar, .bak'a alınan orijinaller) geri
 * alır. Normal tamamlanan (başarılı veya zaten rollback edilmiş) kurulumlar
 * kendi girdisini temizler — bu dosyada kalan her kayıt "yarım kalmış" demektir.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { atomicWriteFile } = require('../../config');

function getJournalPath() {
    return path.join(app.getPath('userData'), 'pending-install-journal.json');
}

function readAll() {
    try {
        const p = getJournalPath();
        if (!fs.existsSync(p)) return {};
        const raw = fs.readFileSync(p, 'utf8');
        return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) {
        console.warn('[INSTALL_JOURNAL] Okuma hatası, defter sıfırlanıyor:', e.message);
        return {};
    }
}

function writeAll(data) {
    try {
        // Atomik yazım (temp + rename): defterin kendisi çökme anında yazılırken
        // yarım kalırsa okuma tarafı onu boş sayar ve onarım bilgisi kaybolurdu.
        atomicWriteFile(getJournalPath(), JSON.stringify(data));
    } catch (e) {
        console.warn('[INSTALL_JOURNAL] Yazma hatası (göz ardı edildi):', e.message);
    }
}

function begin(entryId, info) {
    const all = readAll();
    all[entryId] = { ...info, startedAt: new Date().toISOString() };
    writeAll(all);
}

function update(entryId, patch) {
    const all = readAll();
    if (!all[entryId]) return;
    all[entryId] = { ...all[entryId], ...patch };
    writeAll(all);
}

function clear(entryId) {
    const all = readAll();
    if (all[entryId]) {
        delete all[entryId];
        writeAll(all);
    }
}

function getAllPending() {
    return readAll();
}

module.exports = { begin, update, clear, getAllPending };
