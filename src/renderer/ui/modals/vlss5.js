/**
 * vlss5.js — VLSS5 kurulum modalı (#vlss5-modal)
 *
 * Header'daki VLSS5 butonundan açılır. Kur / Güncelle / Aç durum makinesi,
 * indirme ilerlemesi ve nvngx_dlssnr.dll için sürükle-bırak burada.
 *
 * Durum tamamen main tarafındaki `vlss5:get-status` yanıtından sürülür;
 * burada kurulu olup olmadığına dair yerel varsayım tutulmaz.
 */

import { openModal, showNotification } from './base.js';
import { showInfoModal, showConfirmDialog } from './info.js';
import { t } from '../../i18n/i18n.js';

let vlss5Status = null;      // son getStatus yanıtı
let isBusy = false;          // kurulum / dll işlemi sürüyor
let isCheckingUpdates = false;
let listenersBound = false;

// ─────────────────────────────────────────────────────────────────────────────
// Kurulum ve açılış
// ─────────────────────────────────────────────────────────────────────────────

export function initVlss5Modal() {
    if (listenersBound) return;
    listenersBound = true;

    const headerBtn = document.getElementById('vlss5-header-btn');
    if (headerBtn) headerBtn.addEventListener('click', openVlss5Modal);

    const primaryBtn = document.getElementById('vlss5-primary-btn');
    if (primaryBtn) primaryBtn.addEventListener('click', handlePrimaryAction);

    const secondaryBtn = document.getElementById('vlss5-secondary-btn');
    if (secondaryBtn) secondaryBtn.addEventListener('click', handleLaunch);

    const pickBtn = document.getElementById('vlss5-pick-dll-btn');
    if (pickBtn) pickBtn.addEventListener('click', handlePickDll);

    const findBtn = document.getElementById('vlss5-find-dll-btn');
    if (findBtn) findBtn.addEventListener('click', handleFindDll);

    const folderBtn = document.getElementById('vlss5-folder-btn');
    if (folderBtn) folderBtn.addEventListener('click', handleOpenFolder);

    const uninstallBtn = document.getElementById('vlss5-uninstall-btn');
    if (uninstallBtn) uninstallBtn.addEventListener('click', handleUninstall);

    const checkUpdatesBtn = document.getElementById('vlss5-check-updates-btn');
    if (checkUpdatesBtn) checkUpdatesBtn.addEventListener('click', handleCheckUpdates);

    bindDropzone();

    if (window.electronAPI && window.electronAPI.onVlss5Progress) {
        window.electronAPI.onVlss5Progress(handleProgress);
    }

    // Arka plan guncelleme olaylari — modal kapaliyken de bildirim gosterilir
    if (window.electronAPI && window.electronAPI.onVlss5UpdateEvent) {
        window.electronAPI.onVlss5UpdateEvent(handleUpdateEvent);
    }

    // Dinamik metinler applyTranslations kapsamında olmadığı için yeniden render
    document.addEventListener('language-changed', () => {
        if (vlss5Status) renderVlss5UI();
    });
}

export async function openVlss5Modal() {
    openModal('vlss5-modal');
    showError(null);

    // Arka planda bir güncelleme sürüyor olabilir (açılışta başlatılan otomatik
    // güncelleme) — modal onun durumuyla açılsın.
    try {
        if (window.electronAPI && window.electronAPI.vlss5IsBusy) {
            isBusy = await window.electronAPI.vlss5IsBusy();
        }
    } catch (e) { /* yoksay */ }

    if (!isBusy) setProgressVisible(false);
    renderVlss5UI();          // önce "yükleniyor" durumu
    await loadStatus();
}

async function loadStatus(forceRefresh = false) {
    try {
        if (!window.electronAPI || !window.electronAPI.vlss5GetStatus) return;
        vlss5Status = await window.electronAPI.vlss5GetStatus({ forceRefresh });
    } catch (e) {
        console.error('[VLSS5] Durum alınamadı:', e);
        showError(e.message);
    }
    renderVlss5UI();
}

// ─────────────────────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────────────────────

function renderVlss5UI() {
    const s = vlss5Status;

    const versionChip = document.getElementById('vlss5-installed-version');
    const checkExe = document.getElementById('vlss5-check-exe');
    const checkDll = document.getElementById('vlss5-check-dll');
    const readyBanner = document.getElementById('vlss5-ready-banner');
    const dropzone = document.getElementById('vlss5-dropzone');
    const dropText = dropzone ? dropzone.querySelector('.vlss5-dropzone-text') : null;
    const gpuWarning = document.getElementById('vlss5-gpu-warning');
    const primaryBtn = document.getElementById('vlss5-primary-btn');
    const secondaryBtn = document.getElementById('vlss5-secondary-btn');
    const folderBtn = document.getElementById('vlss5-folder-btn');
    const uninstallBtn = document.getElementById('vlss5-uninstall-btn');
    const pickBtn = document.getElementById('vlss5-pick-dll-btn');
    const findBtn = document.getElementById('vlss5-find-dll-btn');

    // ── Yükleniyor ──
    if (!s) {
        if (versionChip) versionChip.textContent = '—';
        if (primaryBtn) {
            primaryBtn.disabled = true;
            primaryBtn.textContent = t('vlss5.loading');
        }
        [secondaryBtn, folderBtn, uninstallBtn].forEach(b => { if (b) b.style.display = 'none'; });
        if (pickBtn) pickBtn.disabled = true;
        if (findBtn) findBtn.disabled = true;
        return;
    }

    // ── Sürüm rozeti ──
    if (versionChip) {
        if (!s.isInstalled) {
            versionChip.textContent = t('vlss5.notInstalled');
        } else if (s.hasUpdate && s.latestVersion) {
            versionChip.textContent = `v${s.installedVersion || '?'} → v${s.latestVersion}`;
        } else {
            versionChip.textContent = s.installedVersion ? `v${s.installedVersion}` : t('vlss5.installed');
        }
    }

    // ── Kontrol listesi ──
    if (checkExe) {
        checkExe.classList.toggle('ok', !!s.isInstalled);
        checkExe.classList.toggle('missing', !s.isInstalled);
    }
    if (checkDll) {
        checkDll.classList.toggle('ok', !!s.hasModelDll);
        checkDll.classList.toggle('missing', !s.hasModelDll);
    }
    if (readyBanner) readyBanner.style.display = s.isReady ? 'flex' : 'none';

    // ── Sürükle-bırak ──
    if (dropzone) dropzone.classList.toggle('ok', !!s.hasModelDll);
    if (dropText) {
        dropText.textContent = s.hasModelDll ? t('vlss5.dropReplaceText') : t('vlss5.dropText');
    }
    if (pickBtn) pickBtn.disabled = isBusy;
    if (findBtn) findBtn.disabled = isBusy;

    // ── GPU uyarısı (engelleme değil, bilgilendirme) ──
    if (gpuWarning) {
        if (s.gpuSupported === false) {
            gpuWarning.style.display = 'block';
            gpuWarning.textContent = t('vlss5.gpuWarning') + (s.gpuName ? ` (${s.gpuName})` : '');
        } else {
            gpuWarning.style.display = 'none';
        }
    }

    // ── Sürüm bilgisi hatası ──
    // Ekranda daha spesifik bir hata varsa (ör. başarısız kurulum) onu ezme
    const errEl = document.getElementById('vlss5-error');
    const errShown = errEl && errEl.style.display !== 'none' && errEl.textContent;
    if (s.releaseError && !isBusy && !errShown) {
        showError(`${t('vlss5.releaseError')}: ${s.releaseError}`);
    }

    // ── Ana buton ──
    if (primaryBtn) {
        primaryBtn.disabled = isBusy;
        if (isBusy) {
            primaryBtn.textContent = s.isInstalled ? t('vlss5.updating') : t('vlss5.installing');
        } else if (!s.isInstalled) {
            primaryBtn.textContent = t('vlss5.installBtn');
        } else if (s.hasUpdate) {
            primaryBtn.textContent = `${t('vlss5.updateBtn')}${s.latestVersion ? ` (v${s.latestVersion})` : ''}`;
        } else {
            primaryBtn.textContent = t('vlss5.launchBtn');
        }
    }

    // Güncelleme varken "Aç" ikincil buton olarak görünür
    if (secondaryBtn) {
        const showSecondary = s.isInstalled && s.hasUpdate;
        secondaryBtn.style.display = showSecondary ? 'inline-flex' : 'none';
        secondaryBtn.disabled = isBusy;
        secondaryBtn.textContent = t('vlss5.launchBtn');
    }

    if (folderBtn) {
        folderBtn.style.display = s.isInstalled ? 'inline-flex' : 'none';
        folderBtn.disabled = isBusy;
        folderBtn.textContent = t('vlss5.openFolderBtn');
    }

    if (uninstallBtn) {
        uninstallBtn.style.display = s.isInstalled ? 'inline-flex' : 'none';
        uninstallBtn.disabled = isBusy;
        uninstallBtn.textContent = t('vlss5.uninstallBtn');
    }

    const checkUpdatesBtn = document.getElementById('vlss5-check-updates-btn');
    if (checkUpdatesBtn) {
        checkUpdatesBtn.style.display = s.isInstalled ? 'inline-flex' : 'none';
        checkUpdatesBtn.disabled = isBusy;
        checkUpdatesBtn.textContent = isCheckingUpdates
            ? t('vlss5.checkingUpdates')
            : t('vlss5.checkUpdatesBtn');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// İlerleme / hata gösterimi
// ─────────────────────────────────────────────────────────────────────────────

function handleProgress(data) {
    if (!data) return;

    if (data.phase === 'error') {
        setProgressVisible(false);
        showError(data.text);
        return;
    }

    const label = t(`vlss5.phase.${data.phase}`);
    const text = data.text ? `${label} — ${data.text}` : label;
    setProgress(data.percent, text);
}

function setProgressVisible(visible) {
    const wrap = document.getElementById('vlss5-progress-wrap');
    if (wrap) wrap.style.display = visible ? 'flex' : 'none';
}

function setProgress(percent, text) {
    setProgressVisible(true);
    const fill = document.getElementById('vlss5-progress-fill');
    const label = document.getElementById('vlss5-progress-text');
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
    if (label) label.textContent = text || '';
}

function showError(message) {
    const el = document.getElementById('vlss5-error');
    if (!el) return;
    if (!message) {
        el.style.display = 'none';
        el.textContent = '';
        return;
    }
    el.style.display = 'block';
    el.textContent = message;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aksiyonlar
// ─────────────────────────────────────────────────────────────────────────────

async function handlePrimaryAction() {
    if (isBusy || !vlss5Status) return;

    // Kurulu ve güncel → başlat
    if (vlss5Status.isInstalled && !vlss5Status.hasUpdate) {
        return handleLaunch();
    }

    isBusy = true;
    showError(null);
    setProgress(0, t('vlss5.phase.fetch'));
    renderVlss5UI();

    try {
        const res = await window.electronAPI.vlss5Install({});
        if (res && res.success) {
            vlss5Status = res.status || vlss5Status;
            setProgress(100, t('vlss5.phase.done'));
            showNotification('VLSS5', t('vlss5.installSuccess'), 5000);
        } else {
            setProgressVisible(false);
            showError(resolveErrorText(res));
        }
    } catch (e) {
        setProgressVisible(false);
        showError(e.message);
    } finally {
        isBusy = false;
        await loadStatus();
    }
}

async function handleLaunch() {
    if (isBusy) return;
    try {
        const res = await window.electronAPI.vlss5Launch();
        if (!res || !res.success) {
            showInfoModal(t('vlss5.launchErrorTitle'), resolveErrorText(res), true);
            return;
        }
        if (res.warning === 'MISSING_DLL') {
            showNotification('VLSS5', t('vlss5.launchedWithoutDll'), 7000);
        }
    } catch (e) {
        showInfoModal(t('vlss5.launchErrorTitle'), e.message, true);
    }
}

async function handlePickDll() {
    if (isBusy) return;
    isBusy = true;
    showError(null);
    renderVlss5UI();

    try {
        const res = await window.electronAPI.vlss5PickDll();
        if (res && res.canceled) return;
        applyDllResult(res);
    } catch (e) {
        showError(e.message);
    } finally {
        isBusy = false;
        renderVlss5UI();
    }
}

async function handleFindDll() {
    if (isBusy) return;
    isBusy = true;
    showError(null);
    setProgress(0, t('vlss5.searchingDriver'));
    renderVlss5UI();

    try {
        const res = await window.electronAPI.vlss5FindDll();
        setProgressVisible(false);
        if (!res || !res.found) {
            showError(t('vlss5.dllNotFoundInDriver'));
            return;
        }
        applyDllResult(res);
    } catch (e) {
        setProgressVisible(false);
        showError(e.message);
    } finally {
        isBusy = false;
        renderVlss5UI();
    }
}

async function handleOpenFolder() {
    try {
        await window.electronAPI.vlss5OpenFolder();
    } catch (e) {
        showError(e.message);
    }
}

async function handleUninstall() {
    if (isBusy) return;

    // Uygulamanın kendi onay modalı (general-confirm-modal)
    const ok = await showConfirmDialog(t('vlss5.uninstallBtn'), t('vlss5.uninstallConfirm'));
    if (!ok) return;

    isBusy = true;
    showError(null);
    renderVlss5UI();

    try {
        const res = await window.electronAPI.vlss5Uninstall();
        if (res && res.success) {
            vlss5Status = res.status || vlss5Status;
            showNotification('VLSS5', t('vlss5.uninstallSuccess'), 4000);
        } else {
            showError(resolveErrorText(res));
        }
    } catch (e) {
        showError(e.message);
    } finally {
        isBusy = false;
        await loadStatus();
    }
}

/**
 * "Güncellemeleri Kontrol Et" — sürümü tazeler, güncelleme varsa kurar.
 * Güncelleme akışının kendisi main tarafında; ilerleme ve sonuç
 * `vlss5-progress` / `vlss5-update-event` kanallarından gelir.
 */
async function handleCheckUpdates() {
    if (isBusy || isCheckingUpdates) return;

    isCheckingUpdates = true;
    showError(null);
    renderVlss5UI();

    try {
        const res = await window.electronAPI.vlss5CheckUpdates();

        if (res && res.upToDate) {
            showNotification('VLSS5', t('vlss5.upToDate'), 4000);
            vlss5Status = res.status || vlss5Status;
        } else if (res && res.notInstalled) {
            showNotification('VLSS5', t('vlss5.notInstalled'), 4000);
            vlss5Status = res.status || vlss5Status;
        } else if (res && res.success) {
            vlss5Status = res.status || vlss5Status;
        } else if (res && !res.success) {
            showError(resolveErrorText(res));
        }
    } catch (e) {
        showError(e.message);
    } finally {
        isCheckingUpdates = false;
        await loadStatus();
    }
}

/**
 * Arka plandaki otomatik güncelleme olayları.
 * Modal kapalıyken de çalışır — kullanıcı bildirim olarak görür.
 */
function handleUpdateEvent(data) {
    if (!data || !data.type) return;

    switch (data.type) {
        case 'started':
            isBusy = true;
            // İstenen uyarı metni: indirme başlıyor, uygulamayı kapatma
            showNotification('VLSS5', t('vlss5.updateStartedMsg'), 10000);
            setProgress(0, t('vlss5.phase.fetch'));
            renderVlss5UI();
            break;

        case 'repairing':
            isBusy = true;
            showNotification('VLSS5', t('vlss5.repairingMsg'), 8000);
            setProgress(0, t('vlss5.phase.fetch'));
            renderVlss5UI();
            break;

        case 'closing-app':
            // VLSS5.exe açıkken güncelleme: kapatılacağı bildirilir
            showNotification('VLSS5', t('vlss5.closingAppMsg'), 8000);
            break;

        case 'finished':
            isBusy = false;
            setProgress(100, t('vlss5.phase.done'));
            showNotification(
                'VLSS5',
                t('vlss5.updateFinishedMsg') + (data.version ? ` (v${data.version})` : ''),
                6000
            );
            loadStatus();
            break;

        case 'failed': {
            isBusy = false;
            setProgressVisible(false);
            const detail = data.errorCode
                ? (t(`vlss5.err.${data.errorCode}`) || data.error)
                : data.error;
            showNotification('VLSS5', `${t('vlss5.updateFailedMsg')} ${detail || ''}`.trim(), 8000);
            loadStatus();
            break;
        }

        case 'close-blocked':
            // Pencere kapatma girişimi güncelleme sürerken engellendi
            showInfoModal(t('vlss5.closeBlockedTitle'), t('vlss5.closeBlockedBody'), true);
            break;

        default:
            break;
    }
}

function applyDllResult(res) {
    if (res && res.success) {
        vlss5Status = res.status || vlss5Status;
        showNotification('VLSS5', t('vlss5.dllAdded'), 4000);
        showError(null);
    } else {
        showError(resolveErrorText(res));
    }
}

/** Main'den gelen errorCode varsa çevrilmiş metni, yoksa ham hatayı döndürür. */
function resolveErrorText(res) {
    if (!res) return t('vlss5.installFailed');
    if (res.errorCode) {
        const translated = t(`vlss5.err.${res.errorCode}`);
        if (translated && translated !== `vlss5.err.${res.errorCode}`) return translated;
    }
    return res.error || t('vlss5.installFailed');
}

// ─────────────────────────────────────────────────────────────────────────────
// Sürükle-bırak (nvngx_dlssnr.dll)
// ─────────────────────────────────────────────────────────────────────────────

function bindDropzone() {
    const dz = document.getElementById('vlss5-dropzone');
    if (!dz) return;

    // Tarayıcının dosyayı pencerede açmasını engelle
    ['dragover', 'drop'].forEach(ev => {
        window.addEventListener(ev, (e) => { e.preventDefault(); }, false);
    });

    let depth = 0;

    dz.addEventListener('dragenter', (e) => {
        e.preventDefault();
        depth++;
        dz.classList.add('dragover');
    });

    dz.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });

    dz.addEventListener('dragleave', (e) => {
        e.preventDefault();
        if (--depth <= 0) {
            depth = 0;
            dz.classList.remove('dragover');
        }
    });

    dz.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        depth = 0;
        dz.classList.remove('dragover');

        if (isBusy) return;

        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files || files.length === 0) return showError(t('vlss5.errNoFile'));
        if (files.length > 1) return showError(t('vlss5.errMultipleFiles'));

        const file = files[0];

        if (file.name.toLowerCase() !== 'nvngx_dlssnr.dll') {
            return showError(`${t('vlss5.errWrongFile')} (${file.name})`);
        }

        // Electron 32+ ile File.path kaldırıldı → preload köprüsü
        const filePath = window.electronAPI && window.electronAPI.getPathForFile
            ? window.electronAPI.getPathForFile(file)
            : (file.path || '');

        if (!filePath) return showError(t('vlss5.errPathUnavailable'));

        isBusy = true;
        showError(null);
        renderVlss5UI();
        try {
            const res = await window.electronAPI.vlss5SetDll(filePath);
            applyDllResult(res);
        } catch (err) {
            showError(err.message);
        } finally {
            isBusy = false;
            renderVlss5UI();
        }
    });
}
