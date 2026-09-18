const { app } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * Compression History Database
 * Kalıcı sıkıştırma geçmişi — userData/compression-history.json
 * Kayıt sayısı sınırsız, atomic write ile crash-güvenli.
 */
class CompressionDb {
    _getFile() {
        return path.join(app.getPath('userData'), 'compression-history.json');
    }

    /** Disk'ten geçmişi oku (parse hatasında boş dizi döner) */
    _read() {
        try {
            const file = this._getFile();
            if (!fs.existsSync(file)) return [];
            return JSON.parse(fs.readFileSync(file, 'utf-8'));
        } catch (e) {
            console.error('[CompressionDb] Read error:', e.message);
            return [];
        }
    }

    /** Geçmişi diske yaz (atomic: .tmp → rename) */
    _write(entries) {
        try {
            const file = this._getFile();
            const tmp = file + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf-8');
            fs.renameSync(tmp, file);
        } catch (e) {
            console.error('[CompressionDb] Write error:', e.message);
            throw e;
        }
    }

    /**
     * Yeni geçmiş kaydı ekle.
     * @param {Object} record
     * @param {string} record.id            - Benzersiz kimlik (timestamp tabanlı)
     * @param {string} record.timestamp     - ISO 8601 zaman damgası
     * @param {'compress'|'uncompress'} record.type
     * @param {string} record.folderPath
     * @param {string} record.folderName
     * @param {string|null} record.algorithm
     * @param {number} record.sizeBefore    - Bayt cinsinden (mantıksal)
     * @param {number} record.sizeAfter     - Bayt cinsinden (fiziksel/sıkıştırılmış)
     * @param {number} record.fileCount
     * @param {string} record.ratio
     * @param {number} record.savedBytes
     * @param {number} record.savedPercent
     * @param {number} record.durationMs
     * @param {boolean} record.success
     */
    async addEntry(record) {
        const entries = this._read();
        // En yeni kayıt başa
        entries.unshift(record);
        this._write(entries);
    }

    /**
     * Belirli bir kaydı ID ile sil.
     * @param {string} id
     */
    async removeEntry(id) {
        const entries = this._read();
        const updated = entries.filter(e => e.id !== id);
        this._write(updated);
    }

    /**
     * Belirli bir klasör yoluna ait tüm kayıtları sil.
     * @param {string} folderPath
     */
    async removeEntriesByPath(folderPath) {
        const entries = this._read();
        const normalized = folderPath.replace(/\\/g, '/').toLowerCase();
        const updated = entries.filter(
            e => e.folderPath.replace(/\\/g, '/').toLowerCase() !== normalized
        );
        this._write(updated);
    }

    /**
     * Tüm geçmişi döner (en yeni önce — unshift ile yazıldığı için zaten sıralı).
     * @returns {Promise<Array>}
     */
    async getHistory() {
        return this._read();
    }

    /**
     * Tüm geçmişi temizle.
     */
    async clearHistory() {
        this._write([]);
    }

    // Eski stub metodları — backward compat için korunuyor
    async getDb() { return this._read(); }
    async findEntry() { return null; }
}

module.exports = new CompressionDb();
