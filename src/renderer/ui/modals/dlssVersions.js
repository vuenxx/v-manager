import { openModal, closeModal } from './base.js';
import { showInfoModal } from './info.js';

// ── DOM Referansları ──────────────────────────────────────────────────────────
const dlssVersionsBtn     = document.getElementById('dlss-versions-btn');
const dlssVersionsList    = document.getElementById('dlss-versions-list');
const dlssOpenUploadBtn   = document.getElementById('dlss-open-upload-btn');

const dlssDropzone        = document.getElementById('dlss-dropzone');
const dlssUploadLoading   = document.getElementById('dlss-upload-loading');
const dlssUploadInfo      = document.getElementById('dlss-upload-info');
const dlssUploadError     = document.getElementById('dlss-upload-error');

const dlssVersionDisplay  = document.getElementById('dlss-upload-version-display');
const dlssVersionInput    = document.getElementById('dlss-upload-version-input');
const dlssFilename        = document.getElementById('dlss-upload-filename');
const dlssInstallBtn      = document.getElementById('dlss-upload-install-btn');

// ── Modül Durumu ──────────────────────────────────────────────────────────────
let _pendingFilePath = null;   // Sürüklenen ZIP'in sistem yolu
let _pendingVersion  = null;   // Otomatik okunan ya da manuel girilen sürüm

// ── Yardımcı: Sürüm listesini doldur ─────────────────────────────────────────
async function populateDlssVersionsList() {
    if (!dlssVersionsList) return;
    dlssVersionsList.innerHTML = '<span style="font-size:13px; color:var(--text-secondary);">Yükleniyor...</span>';

    try {
        const versions = await window.electronAPI.getDlssVersions();
        dlssVersionsList.innerHTML = '';

        if (!versions || versions.length === 0) {
            dlssVersionsList.innerHTML = `
                <div style="font-size:13px; color:var(--text-secondary); padding:12px; text-align:center;
                            background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05);
                            border-radius:8px;">
                    Henüz yüklü sürüm bulunamadı.
                </div>`;
            return;
        }

        versions.forEach(ver => {
            const row = document.createElement('div');
            row.style.cssText = `
                display: flex; justify-content: space-between; align-items: center;
                padding: 10px 14px; background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.07); border-radius: 8px;
                font-size: 13px;
            `;
            row.innerHTML = `
                <span style="font-weight:600; color:var(--text-primary);">📦 ${ver}</span>
                <span style="font-size:11px; padding:2px 8px; border-radius:12px;
                             background:rgba(139,92,246,0.15); color:#a78bfa; font-weight:600;">
                    Yüklü
                </span>`;
            dlssVersionsList.appendChild(row);
        });
    } catch (e) {
        dlssVersionsList.innerHTML = `
            <span style="font-size:13px; color:#ef4444;">
                Sürümler yüklenirken hata: ${e.message}
            </span>`;
    }
}

// ── Yardımcı: Upload modalını sıfırla ────────────────────────────────────────
function resetUploadModal() {
    _pendingFilePath = null;
    _pendingVersion  = null;

    dlssDropzone.style.borderColor   = 'rgba(255,255,255,0.2)';
    dlssDropzone.style.background    = '';
    dlssUploadLoading.style.display  = 'none';
    dlssUploadInfo.style.display     = 'none';
    dlssUploadError.style.display    = 'none';
    dlssUploadError.textContent      = '';

    dlssVersionDisplay.textContent   = '—';
    dlssVersionDisplay.style.display = '';
    dlssVersionInput.style.display   = 'none';
    dlssVersionInput.value           = '';
    dlssFilename.textContent         = '—';

    dlssInstallBtn.disabled          = true;
    dlssInstallBtn.style.opacity     = '0.4';
    dlssInstallBtn.style.cursor      = 'not-allowed';
    dlssInstallBtn.textContent       = 'Yükle';
}

// ── Yardımcı: Hata göster ────────────────────────────────────────────────────
function showUploadError(msg) {
    dlssUploadLoading.style.display = 'none';
    dlssUploadInfo.style.display    = 'none';
    dlssUploadError.textContent     = msg;
    dlssUploadError.style.display   = 'block';

    // Dropzone'u hata rengine döndür
    dlssDropzone.style.borderColor = 'rgba(239,68,68,0.5)';
    dlssDropzone.style.background  = 'rgba(239,68,68,0.04)';
}

// ── Yardımcı: YÜKLE butonunu etkinleştir ─────────────────────────────────────
function enableInstallBtn() {
    dlssInstallBtn.disabled      = false;
    dlssInstallBtn.style.opacity = '1';
    dlssInstallBtn.style.cursor  = 'pointer';
}

// ── Drag & Drop Mantığı ───────────────────────────────────────────────────────
function handleDragOver(e) {
    // Revizyon: Chromium'un ZIP'i sayfa olarak açmasını engelle
    e.preventDefault();
    e.stopPropagation();
    dlssDropzone.style.borderColor = 'var(--accent-color)';
    dlssDropzone.style.background  = 'rgba(139,92,246,0.06)';
}

function handleDragLeave(e) {
    // Revizyon: dışarı çıkış
    e.preventDefault();
    e.stopPropagation();
    dlssDropzone.style.borderColor = 'rgba(255,255,255,0.2)';
    dlssDropzone.style.background  = '';
}

async function handleDrop(e) {
    // Revizyon: en kritik önlem — Chromium ZIP'i açmasın
    e.preventDefault();
    e.stopPropagation();

    dlssDropzone.style.borderColor = 'rgba(255,255,255,0.2)';
    dlssDropzone.style.background  = '';

    const file = e.dataTransfer.files[0];
    if (!file) return;

    // Sadece .zip kabul et
    if (!file.name.toLowerCase().endsWith('.zip')) {
        showUploadError('Geçersiz dosya türü. Lütfen yalnızca .zip uzantılı dosya sürükleyin.');
        return;
    }

    // Revizyon 1: Buffer yerine Electron'un verdiği native path'i kullan
    const filePath = file.path;
    if (!filePath) {
        showUploadError('Dosya yolu alınamadı. Lütfen tekrar deneyin.');
        return;
    }

    _pendingFilePath = filePath;

    // Loading durumu göster
    dlssUploadError.style.display   = 'none';
    dlssUploadInfo.style.display    = 'none';
    dlssUploadLoading.style.display = 'block';
    dlssDropzone.style.borderColor  = 'rgba(255,255,255,0.15)';

    try {
        const result = await window.electronAPI.dlssParseZip({ filePath, fileName: file.name });
        dlssUploadLoading.style.display = 'none';

        if (!result.success) {
            showUploadError(result.error || 'ZIP dosyası işlenemedi.');
            _pendingFilePath = null;
            return;
        }

        // Bilgi alanını göster
        dlssFilename.textContent     = file.name;
        dlssUploadInfo.style.display = 'flex';

        if (result.version) {
            // Otomatik sürüm okundu
            _pendingVersion                  = result.version;
            dlssVersionDisplay.textContent   = result.version;
            dlssVersionDisplay.style.display = '';
            dlssVersionInput.style.display   = 'none';
        } else {
            // Revizyon 4: PowerShell null döndü → manuel giriş
            _pendingVersion                  = null;
            dlssVersionDisplay.style.display = 'none';
            dlssVersionInput.style.display   = '';
            dlssVersionInput.value           = '';
            dlssVersionInput.focus();
        }

        enableInstallBtn();
    } catch (err) {
        dlssUploadLoading.style.display = 'none';
        showUploadError(`Beklenmeyen hata: ${err.message}`);
        _pendingFilePath = null;
    }
}

// ── YÜKLE Butonu ─────────────────────────────────────────────────────────────
async function handleInstall() {
    if (!_pendingFilePath) {
        showUploadError('Dosya bilgisi kayboldu. Lütfen ZIP dosyasını tekrar sürükleyin.');
        return;
    }

    // Sürümü belirle: otomatik veya manuel
    const version = _pendingVersion || dlssVersionInput.value.trim();
    if (!version) {
        dlssVersionInput.style.borderColor = '#ef4444';
        dlssVersionInput.placeholder = 'Sürüm girilmedi!';
        return;
    }

    // Buton → yükleniyor
    dlssInstallBtn.textContent   = 'Yükleniyor...';
    dlssInstallBtn.disabled      = true;
    dlssInstallBtn.style.cursor  = 'not-allowed';
    dlssInstallBtn.style.opacity = '0.6';
    dlssUploadError.style.display = 'none';

    try {
        const result = await window.electronAPI.dlssInstallFromZip({
            filePath: _pendingFilePath,
            version
        });

        if (result.success) {
            // Her iki modalı kapat
            closeModal('dlss-upload-modal');
            closeModal('dlss-versions-modal');
            resetUploadModal();

            showInfoModal(
                'Başarılı ✓',
                `Yeni sürüm/Varolan sürüm başarıyla güncellendi veya değiştirildi!\n\nSürüm: ${version}`
            );
        } else {
            // Revizyon 5: EPERM/EBUSY ve diğer hatalar burada gösterilir
            showUploadError(result.error || 'Kurulum başarısız oldu.');
            dlssInstallBtn.textContent   = 'Yükle';
            dlssInstallBtn.disabled      = false;
            dlssInstallBtn.style.opacity = '1';
        }
    } catch (err) {
        showUploadError(`Beklenmeyen hata: ${err.message}`);
        dlssInstallBtn.textContent   = 'Yükle';
        dlssInstallBtn.disabled      = false;
        dlssInstallBtn.style.opacity = '1';
    }
}

// ── Event Listener Kaydı ─────────────────────────────────────────────────────
export function initDlssVersionListeners() {
    // "Sürümler" butonu (Modlar sekmesi)
    if (dlssVersionsBtn) {
        dlssVersionsBtn.addEventListener('click', async () => {
            await populateDlssVersionsList();
            openModal('dlss-versions-modal');
        });
    }

    // "Güncelle/Değiştir" butonu (Sürümler modalı)
    if (dlssOpenUploadBtn) {
        dlssOpenUploadBtn.addEventListener('click', () => {
            resetUploadModal();
            openModal('dlss-upload-modal');
        });
    }

    // Drag & Drop — e.preventDefault() / e.stopPropagation() ilk satırda (Revizyon)
    if (dlssDropzone) {
        dlssDropzone.addEventListener('dragover',  handleDragOver);
        dlssDropzone.addEventListener('dragleave', handleDragLeave);
        dlssDropzone.addEventListener('drop',      handleDrop);
    }

    // YÜKLE butonu
    if (dlssInstallBtn) {
        dlssInstallBtn.addEventListener('click', handleInstall);
    }

    // Upload modali kapandığında state sıfırla
    const uploadModalCloseBtn = document.querySelector('[data-target="dlss-upload-modal"]');
    if (uploadModalCloseBtn) {
        uploadModalCloseBtn.addEventListener('click', resetUploadModal);
    }

    // Manuel sürüm input'unda değer girildiğinde _pendingVersion güncelle
    if (dlssVersionInput) {
        dlssVersionInput.addEventListener('input', () => {
            _pendingVersion = null; // manuel modda otomatik sürümü sıfırla
        });
    }
}
