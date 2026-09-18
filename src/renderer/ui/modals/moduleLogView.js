import { getCurrentLang, t } from '../../i18n/i18n.js';

/**
 * Modül kurulum/kaldırma günlüğünün arayüz tarafı.
 *
 * `moduleEngine` her satırı iki dilli üretir (`{ tr, en, level }`). Burada
 * kullanıcının seçili diline göre doğru metin alınır ve katlanabilir bir
 * "Kurulum günlüğü / Installation log" bloğu olarak çizilir. Böylece kurulumda
 * NE YAPILDIĞI kadar NE YAPILMADIĞI (⊘ atlandı) da görünür kalır.
 */

const LEVEL_META = {
    step:  { symbol: '✓', color: '#4ade80' },
    skip:  { symbol: '⊘', color: '#94a3b8' },
    info:  { symbol: 'ℹ', color: '#60a5fa' },
    warn:  { symbol: '⚠', color: '#fbbf24' },
    error: { symbol: '✗', color: '#ef4444' }
};

function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Bir günlük satırının geçerli dildeki metni. */
export function logLineText(entry) {
    if (!entry) return '';
    const lang = getCurrentLang();
    if (lang === 'en') return entry.en || entry.tr || entry.message || '';
    return entry.tr || entry.message || entry.en || '';
}

/** Günlüğü düz metne çevirir (panoya kopyalama / hata ayıklama için). */
export function formatModuleLog(log) {
    if (!Array.isArray(log)) return '';
    return log.map(e => {
        const meta = LEVEL_META[e.level] || { symbol: '·' };
        return `${e.timestamp || ''} ${meta.symbol} ${logLineText(e)}`.trim();
    }).join('\n');
}

/**
 * Günlüğü katlanabilir bir blok olarak `container`'a ekler.
 * @param {HTMLElement} container
 * @param {Array} log       moduleEngine'in döndürdüğü `result.log`
 * @param {Object} [opts]
 * @param {Object} [opts.summary]  `result.logSummary` — seviye başına sayaç
 * @param {string} [opts.logFile]  `result.logFile` — diskteki günlük dosyası
 */
export function appendModuleLog(container, log, opts = {}) {
    if (!container || !Array.isArray(log) || log.length === 0) return;

    const { summary, logFile } = opts;

    const details = document.createElement('details');
    details.className = 'module-log-details';

    const summaryEl = document.createElement('summary');
    const counts = summary || log.reduce((acc, e) => {
        acc[e.level] = (acc[e.level] || 0) + 1;
        return acc;
    }, {});
    const label = t('modLog.title') || 'Kurulum günlüğü';
    const doneLabel = t('modLog.done') || 'yapıldı';
    const skipLabel = t('modLog.skipped') || 'atlandı';
    summaryEl.textContent =
        `${label} — ${counts.step || 0} ${doneLabel}, ${counts.skip || 0} ${skipLabel}`;
    details.appendChild(summaryEl);

    const list = document.createElement('div');
    list.className = 'module-log-lines';
    list.innerHTML = log.map(e => {
        const meta = LEVEL_META[e.level] || { symbol: '·', color: 'var(--text-secondary)' };
        return `<div class="module-log-line module-log-${escapeHtml(e.level || 'info')}">` +
            `<span class="module-log-sym" style="color:${meta.color}">${meta.symbol}</span>` +
            `<span class="module-log-time">${escapeHtml(e.timestamp || '')}</span>` +
            `<span class="module-log-msg">${escapeHtml(logLineText(e))}</span>` +
            `</div>`;
    }).join('');
    details.appendChild(list);

    if (logFile) {
        const foot = document.createElement('div');
        foot.className = 'module-log-file';
        foot.textContent = `${t('modLog.savedTo') || 'Günlük dosyası'}: ${logFile}`;
        details.appendChild(foot);
    }

    container.appendChild(details);
}
