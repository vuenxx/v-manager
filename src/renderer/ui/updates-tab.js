/**
 * updates-tab.js — Güncellemeler sekmesi UI mantığı
 *
 * Durum makinesi: idle → checking → available → downloading → downloaded
 *                                              ↘ error (herhangi bir aşamada)
 *
 * Sürüm geçmişi: GitHub Releases API'den tüm sürümleri çeker ve gösterir.
 */

import { t, getCurrentLang } from '../i18n/i18n.js';

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initUpdatesTab() {
    // Mevcut uygulama versiyonunu göster
    if (window.electronAPI.getAppVersion) {
        window.electronAPI.getAppVersion().then(v => {
            const el = document.getElementById('current-app-version');
            if (el) el.textContent = `v${v}`;
        }).catch(() => {});
    }

    _setupButtonListeners();
    _setupIpcListeners();

    // Sürüm geçmişini arka planda yükle (sekme açık olmasa da)
    _loadReleaseHistory();
}

// ─── Buton Listener'ları ──────────────────────────────────────────────────────

function _setupButtonListeners() {
    document.getElementById('check-updates-btn')?.addEventListener('click', async () => {
        _setState('checking');
        try {
            await window.electronAPI.checkForUpdatesManual();
        } catch (e) {
            _setState('error', e.message || t('updates.unknownError'));
        }
    });

    document.getElementById('download-update-btn')?.addEventListener('click', () => {
        _setState('downloading');
        window.electronAPI.startUpdateDownload();
    });

    document.getElementById('install-update-btn')?.addEventListener('click', () => {
        window.electronAPI.quitAndInstall();
    });
}

// ─── IPC Event Listener'ları ──────────────────────────────────────────────────

function _setupIpcListeners() {
    window.electronAPI.removeUpdateListeners?.();

    window.electronAPI.onUpdateChecking(() => {
        _setState('checking');
    });

    window.electronAPI.onUpdateAvailable((info) => {
        _setState('available', info);
    });

    window.electronAPI.onUpdateNotAvailable(() => {
        _setState('idle', null, true);
    });

    window.electronAPI.onUpdateDownloadProgress((data) => {
        _updateProgressBar(data.percent, data.bytesPerSecond);
    });

    window.electronAPI.onUpdateDownloaded((info) => {
        _setState('downloaded', info);
    });

    window.electronAPI.onUpdateError((msg) => {
        _setState('error', msg);
    });
}

// ─── Sürüm Geçmişi ────────────────────────────────────────────────────────────

async function _loadReleaseHistory() {
    const container = document.getElementById('release-history-list');
    if (!container) return;

    // Yükleniyor göstergesi
    container.innerHTML = `
        <div style="text-align:center; padding: 20px; color: var(--text-secondary); font-size: 13px;">
            🔄 ${t('updates.historyLoading')}
        </div>`;

    try {
        const releases = await window.electronAPI.fetchAllReleases();

        if (!releases || releases.length === 0) {
            container.innerHTML = `
                <div style="color: var(--text-secondary); font-size: 13px; padding: 10px 0;">
                    ${t('updates.historyEmpty')}
                </div>`;
            return;
        }

        container.innerHTML = releases.map((r, i) => {
            const date = r.published_at
                ? new Date(r.published_at).toLocaleDateString(getCurrentLang() === 'tr' ? 'tr-TR' : 'en-US', {
                    year: 'numeric', month: 'long', day: 'numeric'
                  })
                : '';

            const isLatest = i === 0;
            const isPrerelease = r.prerelease;

            return `
                <div class="release-history-item ${isLatest ? 'release-latest' : ''}">
                    <div class="release-history-header">
                        <div style="display:flex; align-items:center; gap: 10px; flex-wrap:wrap;">
                            <span class="release-version-tag">${_escSafe(r.tag_name)}</span>
                             ${isLatest ? `<span class="utag utag-dlssEnabler" style="font-size:11px;" data-i18n="updates.latestBadge">${t('updates.latestBadge')}</span>` : ''}
                            ${isPrerelease ? '<span class="utag" style="font-size:11px; background:rgba(251,191,36,0.15); color:#fbbf24; border:1px solid rgba(251,191,36,0.3);">Pre-release</span>' : ''}
                            ${r.name && r.name !== r.tag_name ? `<span class="release-title">${_escSafe(r.name)}</span>` : ''}
                        </div>
                        ${date ? `<span class="release-date">${date}</span>` : ''}
                    </div>
                    ${r.body ? `
                    <div class="release-notes-body">
                        ${_markdownToHtml(r.body)}
                    </div>` : `<p style="margin:8px 0 0; font-size:13px; color:var(--text-secondary);">${t('updates.noChangeNotes')}</p>`}
                </div>`;
        }).join('');

    } catch (err) {
        console.error('[UpdatesTab] Release geçmişi yüklenemedi:', err);
        container.innerHTML = `
            <div style="color: var(--text-secondary); font-size: 13px; padding: 10px 0;">
                ⚠️ ${t('updates.historyError')}
            </div>`;
    }
}

// ─── Durum Makinesi ───────────────────────────────────────────────────────────

function _setState(state, data = null, isLatest = false) {
    const $ = (id) => document.getElementById(id);

    const statusCard   = $('update-status-card');
    const statusIcon   = $('update-status-icon');
    const statusMsg    = $('update-status-message');
    const checkBtn     = $('check-updates-btn');
    const newVerBlock  = $('update-new-version-block');
    const newVerBadge  = $('update-new-version-badge');
    const releaseNotes = $('update-release-notes');
    const downloadBtn  = $('download-update-btn');
    const installBtn   = $('install-update-btn');
    const progressWrap = $('update-progress-wrapper');
    const progressBar  = $('update-progress-bar');
    const progressText = $('update-progress-text');

    if (!statusCard) return;

    // Reset
    newVerBlock.style.display  = 'none';
    progressWrap.style.display = 'none';
    downloadBtn.style.display  = 'none';
    installBtn.style.display   = 'none';
    checkBtn.disabled          = false;
    statusCard.className       = 'update-status-card';

    switch (state) {
        case 'idle':
            statusIcon.textContent = isLatest ? '✅' : '⏸️';
            statusMsg.textContent  = isLatest
                ? t('updates.isLatest')
                : t('updates.notChecked');
            checkBtn.textContent = t('updates.checkBtn');
            statusCard.classList.add(isLatest ? 'status-latest' : 'status-idle');
            break;

        case 'checking':
            statusIcon.textContent = '🔄';
            statusMsg.textContent  = t('updates.checking');
            checkBtn.textContent   = t('updates.checkingBtn');
            checkBtn.disabled      = true;
            statusCard.classList.add('status-checking');
            break;

        case 'available':
            statusIcon.textContent = '🔔';
            statusMsg.textContent  = `${t('updates.newVersionMsg')} v${data?.version}`;
            checkBtn.textContent   = t('updates.retryBtn');
            statusCard.classList.add('status-available');
            newVerBadge.textContent        = `v${data?.version ?? ''}`;
            // HTML olarak render et (electron-updater HTML döner)
            releaseNotes.innerHTML = _renderNotes(data?.releaseNotes);
            newVerBlock.style.display  = 'block';
            downloadBtn.style.display  = 'inline-flex';
            break;

        case 'downloading':
            statusIcon.textContent     = '⬇️';
            statusMsg.textContent      = t('updates.downloading');
            checkBtn.disabled          = true;
            statusCard.classList.add('status-downloading');
            newVerBlock.style.display  = 'block';
            progressWrap.style.display = 'flex';
            progressBar.style.width    = '0%';
            progressText.textContent   = '0%';
            break;

        case 'downloaded':
            statusIcon.textContent     = '✅';
            statusMsg.textContent      = t('updates.downloaded');
            checkBtn.disabled          = true;
            statusCard.classList.add('status-downloaded');
            newVerBlock.style.display  = 'block';
            progressWrap.style.display = 'flex';
            progressBar.style.width    = '100%';
            progressText.textContent   = '100%';
            installBtn.style.display   = 'inline-flex';
            break;

        case 'error':
            statusIcon.textContent = '❌';
            statusMsg.textContent  = `${t('updates.error')} ${data ?? t('updates.unknownError')}`;
            checkBtn.textContent   = t('updates.retryBtn');
            statusCard.classList.add('status-error');
            break;
    }
}

// ─── Yardımcı Fonksiyonlar ────────────────────────────────────────────────────

function _updateProgressBar(percent, bytesPerSec) {
    const bar  = document.getElementById('update-progress-bar');
    const text = document.getElementById('update-progress-text');
    if (!bar || !text) return;

    const p = Math.min(100, Math.max(0, Math.floor(percent)));
    bar.style.width = `${p}%`;

    if (bytesPerSec) {
        const speed = bytesPerSec > 1024 * 1024
            ? `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`
            : `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
        text.textContent = `${p}% — ${speed}`;
    } else {
        text.textContent = `${p}%`;
    }
}

/**
 * electron-updater'dan gelen releaseNotes HTML veya string olabilir.
 * Dizi gelirse (multi-release) son elemanı al.
 */
function _renderNotes(notes) {
    if (!notes) return `<p style="color:var(--text-secondary);">${t('updates.noNotes')}</p>`;

    // Dizi formatında gelebilir [{ version, note }]
    if (Array.isArray(notes)) {
        return notes.map(n =>
            `<div style="margin-bottom:12px;">
                <strong style="color:var(--accent-color); font-size:12px;">v${_escSafe(n.version)}</strong>
                <div style="margin-top:6px;">${_markdownToHtml(n.note || '')}</div>
             </div>`
        ).join('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.06);margin:12px 0;">');
    }

    // HTML mi yoksa markdown mı kontrol et
    if (typeof notes === 'string' && notes.trim().startsWith('<')) {
        // HTML gelmiş — doğrudan render et
        return `<div class="release-notes-rendered">${notes}</div>`;
    }

    // Markdown gelmiş — dönüştür
    return _markdownToHtml(String(notes));
}

/**
 * Temel Markdown → HTML dönüştürücü.
 * GitHub release body'sini güzel render eder.
 */
function _markdownToHtml(md) {
    if (!md) return '';

    let html = _escSafe(md);

    // Başlıklar
    html = html.replace(/^### (.+)$/gm, '<h4 class="rn-h4">$1</h4>');
    html = html.replace(/^## (.+)$/gm,  '<h3 class="rn-h3">$1</h3>');
    html = html.replace(/^# (.+)$/gm,   '<h2 class="rn-h2">$1</h2>');

    // Bold & italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g,     '<em>$1</em>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="rn-code">$1</code>');

    // Checkbox liste öğeleri
    html = html.replace(/^- \[x\] (.+)$/gm, '<li class="rn-li rn-li-done">✅ $1</li>');
    html = html.replace(/^- \[ \] (.+)$/gm, '<li class="rn-li rn-li-open">⬜ $1</li>');

    // Normal liste öğeleri (- veya *)
    html = html.replace(/^[-*] (.+)$/gm, '<li class="rn-li">$1</li>');

    // Ardışık <li>'leri <ul> ile sar
    html = html.replace(/(<li class="rn-li[^"]*">[^]*?<\/li>\n?)+/g, (match) => `<ul class="rn-ul">${match}</ul>`);

    // Link
    html = html.replace(/\[(.+?)\]\((.+?)\)/g,
        '<a class="rn-link" href="#" onclick="event.preventDefault(); window.electronAPI.openExternalLink(\'$2\')">$1</a>');

    // Yatay çizgi
    html = html.replace(/^---$/gm, '<hr class="rn-hr">');

    // Paragraf (boş satırla ayrılmış bloklar)
    html = html
        .split(/\n{2,}/)
        .map(block => {
            block = block.trim();
            if (!block) return '';
            // Zaten HTML tag içeriyorsa sarmadan bırak
            if (/^<(h[2-4]|ul|hr|div)/.test(block)) return block;
            return `<p class="rn-p">${block.replace(/\n/g, '<br>')}</p>`;
        })
        .join('\n');

    return html;
}

/** HTML özel karakterlerini kaçırır (XSS önlemi — linklerin URL'si hariç kullanılır) */
function _escSafe(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
