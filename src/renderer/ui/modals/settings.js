import { state } from '../../state.js';
import { openModal, closeModal, setSettingsCloseGuard } from './base.js';
import { t } from '../../i18n/i18n.js';
import { renderModSelectionModal } from './modSelection.js';
import { renderGames, updateHomeStats } from '../games.js';
import { showInfoModal, showConfirmDialog } from './info.js';

// ─── Geliştirici Presetleri (Salt Okunur) ────────────────────────────────────
// Yeni preset eklemek için buraya yeni bir nesne ekleyin.
const DEVELOPER_PRESETS = {
    'dlss-enabler': [
        {
            id: 'dev-best',
            nameKey: 'modSettings.presets.devBestName',
            locked: true,
            values: {
                Performance: { MFGOverrideMode: 6, MFGHotkeys: true },
                UI: { Monitoring: true },
                GhostBuster: { Enabled: true }
            }
        }
    ],
    'optibuilder': [
        {
            id: 'dev-optibuilder-fg',
            nameKey: 'modSettings.presets.devOptiFgName',
            locked: true,
            values: {
                FrameGen: {
                    Enabled: 'true',
                    FGInput: 'upscaler',
                    FGOutput: 'dlssgwithnvngx'
                },
                DLSSG: {
                    InterpolationCount: 6,
                    DisableHudless: 'true',
                    DispatchFlags: '0x4100000'
                },
                Menu: {
                    ShowFps: 'true',
                    FpsOverlayPos: 'auto',
                    FpsOverlayType: 'auto'
                }
            }
        }
    ],
    'optiscaler': [
        {
            id: 'dev-opti-fg',
            nameKey: 'modSettings.presets.devOptiFgName',
            locked: true,
            values: {
                FrameGen: {
                    FGInput: 'upscaler',
                    FGOutput: 'xefg',
                    Enabled: 'true'
                },
                OptiFG: {
                    HUDFix: 'true'
                },
                Menu: {
                    ShowFps: 'true'
                }
            }
        }
    ]
};

// ─── ID Normalizasyonu (Manifest ID vs Preset/Legacy ID) ─────────────────────
const normalizeModId = (id) => (id === 'dlssenabler' ? 'dlss-enabler' : id);
const toManifestId = (id) => (id === 'dlss-enabler' ? 'dlssenabler' : id);

// ─── Modül Durumu ────────────────────────────────────────────────────────────
let currentSettingsData = {};
let currentActiveMod = null;
let currentActiveModsList = [];
let currentActiveModInfo = null;
let userPresets = [];           // Kullanıcının kaydettiği presetler
let activePresetId = null;      // Şu an seçili preset ID'si (null = hiçbiri)
let isDirty = false;            // Kaydedilmemiş değişiklik var mı?

// ─── Başlatma ────────────────────────────────────────────────────────────────
export function initSettingsListeners() {
    // Floating kaydet butonu
    document.getElementById('settings-save-btn')?.addEventListener('click', async () => {
        await saveModSettings();
    });

    // settings-modal'ı kapat guard'ı kayıt et
    setSettingsCloseGuard(handleModalCloseAttempt);
}


function handleModalCloseAttempt() {
    if (!isDirty) {
        closeModal('settings-modal');
        return;
    }
    showUnsavedWarning();
}

function showUnsavedWarning() {
    // Mevcut info-modal'ı uyarı için kullan
    const infoModal = document.getElementById('info-modal');
    const infoTitle = document.getElementById('info-modal-title');
    const infoBody = document.getElementById('info-modal-message');
    const infoClose = document.getElementById('info-modal-ok-btn');
    const infoProgress = document.getElementById('info-modal-progress');

    if (!infoModal || !infoTitle || !infoBody) {
        // Fallback: doğrudan kapat
        closeModal('settings-modal');
        return;
    }

    if (infoProgress) infoProgress.style.display = 'none';
    infoTitle.textContent = t('modSettings.presets.unsavedTitle');
    infoBody.innerHTML = t('modSettings.presets.unsavedBody');
    infoBody.style.color = '';

    // Butonları özelleştir
    const existingExtra = infoModal.querySelector('.unsaved-extra-btn');
    if (existingExtra) existingExtra.remove();

    if (infoClose) {
        infoClose.textContent = t('modSettings.presets.unsavedCancel');
        infoClose.onclick = () => {
            closeModal('info-modal');
        };
    }

    // "Evet, Kapat" butonu ekle
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'unsaved-extra-btn';
    confirmBtn.textContent = t('modSettings.presets.unsavedConfirm');
    confirmBtn.style.cssText = 'background:#ef4444;color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-size:14px;margin-left:10px;';
    confirmBtn.onclick = () => {
        closeModal('info-modal');
        isDirty = false;
        closeModal('settings-modal');
    };

    const btnRow = infoClose?.parentElement;
    if (btnRow) btnRow.appendChild(confirmBtn);

    openModal('info-modal');
}

// ─── Modal Açma ──────────────────────────────────────────────────────────────
export async function openSettingsModal(game) {
    try {
        console.log('[RENDERER settings.js] openSettingsModal triggered for game:', JSON.stringify(game, null, 2));
        if (window.electronAPI && window.electronAPI.logToMain) {
            window.electronAPI.logToMain(`[RENDERER settings.js] openSettingsModal triggered for game: ${game ? game.name : 'unknown'}`);
        }
        state.currentSelectedGame = game;

        // Dirty flag'i sıfırla
        isDirty = false;
        activePresetId = null;

        const coverEl     = document.getElementById('settings-game-cover');
        const placeholder = document.getElementById('settings-game-placeholder');
        const nameEl      = document.getElementById('settings-game-name');
        const techsEl     = document.getElementById('settings-game-techs');

        if (nameEl) {
            nameEl.textContent = game.name;
        } else {
            console.warn('[RENDERER settings.js] settings-game-name element NOT FOUND');
        }

        if (game.cover) {
            if (coverEl) { coverEl.src = game.cover; coverEl.style.display = 'block'; }
            if (placeholder) placeholder.style.display = 'none';
        } else {
            if (coverEl) coverEl.style.display = 'none';
            if (placeholder) placeholder.style.display = 'flex';
        }

        // Render game upscaler tags in left sidebar
        if (techsEl) {
            techsEl.innerHTML = '';
            if (game.upscalers) {
                if (game.upscalers.dlss) techsEl.innerHTML += '<span class="utag utag-dlss" style="font-size:10px;padding:2px 6px;">DLSS</span>';
                if (game.upscalers.xess) techsEl.innerHTML += '<span class="utag utag-xess" style="font-size:10px;padding:2px 6px;">XeSS</span>';
                if (game.upscalers.fsr) techsEl.innerHTML += '<span class="utag utag-fsr" style="font-size:10px;padding:2px 6px;">FSR</span>';
            }
        }

        // Wire "Yeni Mod Kur" button
        const addModBtn = document.getElementById('settings-add-mod-btn');
        if (addModBtn) {
            addModBtn.onclick = () => {
                closeModal('settings-modal');
                renderModSelectionModal(game);
            };
        }

        // Manifest sistemi üzerinden aktif modları al
        let activeMods = [];
        try {
            if (window.electronAPI && window.electronAPI.moduleGetActiveForGame) {
                const activeRes = await window.electronAPI.moduleGetActiveForGame(game);
                if (activeRes && activeRes.success && Array.isArray(activeRes.activeMods)) {
                    activeMods = activeRes.activeMods;
                }
            }
        } catch (e) {
            console.warn('[RENDERER settings.js] moduleGetActiveForGame failed:', e.message);
        }

        currentActiveModsList = activeMods;

        const tabsContainer = document.getElementById('settings-tabs-container');
        if (tabsContainer) tabsContainer.innerHTML = '';

        const contentDiv = document.getElementById('settings-content');
        if (contentDiv) contentDiv.innerHTML = '';

        const manageCard = document.getElementById('settings-mod-manage-card');
        const saveBtn = document.getElementById('settings-save-btn');

        hideError();

        // ── Boş Durum: Oyunda hiç mod yoksa ───────────────────────────────
        if (!activeMods || activeMods.length === 0) {
            console.log('[RENDERER settings.js] No mod available for settings');
            if (manageCard) manageCard.style.display = 'none';
            if (saveBtn) saveBtn.style.display = 'none';
            if (contentDiv) {
                contentDiv.innerHTML = `
                    <div style="text-align: center; color: var(--text-secondary); padding: 50px 20px;">
                        <div style="font-size: 44px; margin-bottom: 12px;">📦</div>
                        <div style="font-size: 16px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">${t('modSettings.noActiveMods') || 'Bu oyunda henüz kurulu bir mod bulunmuyor'}</div>
                        <div style="font-size: 13px; color: var(--text-secondary); max-width: 380px; margin: 0 auto 20px auto; line-height: 1.5;">${t('modSettings.noActiveModsDesc') || 'Yeni modlar keşfetmek veya kurmak için mod kataloğuna göz atabilirsiniz.'}</div>
                        <button id="settings-empty-catalog-btn" class="install-btn" style="padding: 10px 22px; font-size: 13px; font-weight: 600; background: var(--accent-color); border: none; border-radius: 8px; color: white; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                            ➕ <span>${t('modSettings.openCatalogBtn') || 'Mod Kataloğunu Aç'}</span>
                        </button>
                    </div>`;
                const emptyCatalogBtn = document.getElementById('settings-empty-catalog-btn');
                if (emptyCatalogBtn) {
                    emptyCatalogBtn.onclick = () => {
                        closeModal('settings-modal');
                        renderModSelectionModal(game);
                    };
                }
            }
            openModal('settings-modal');
            return;
        }

        // ── Dinamik Sol Sekme Butonları Üret ───────────────────────────────
        activeMods.forEach((mod) => {
            const btn = document.createElement('button');
            btn.className = 'install-btn settings-tab-btn';
            btn.dataset.modId = mod.id;
            btn.style.cssText = 'background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: white; display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 8px; cursor: pointer; width: 100%; transition: all 0.2s;';

            const nameSpan = document.createElement('span');
            nameSpan.style.cssText = 'font-weight: 600; font-size: 13px; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
            nameSpan.textContent = mod.name || mod.id;

            const verBadge = document.createElement('span');
            verBadge.style.cssText = 'font-size: 10px; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; color: #cbd5e1; margin-left: 6px; white-space: nowrap;';
            const verText = mod.installedVersion ? (mod.installedVersion.startsWith('v') ? mod.installedVersion : `v${mod.installedVersion}`) : (t('modSettings.installedBadge') || 'Kurulu');
            verBadge.textContent = verText;

            btn.appendChild(nameSpan);
            btn.appendChild(verBadge);

            btn.addEventListener('click', () => loadModSettings(mod.id));
            if (tabsContainer) tabsContainer.appendChild(btn);
        });

        // İlk aktif modu yükle
        await loadModSettings(activeMods[0].id);
        openModal('settings-modal');
    } catch (err) {
        console.error('[RENDERER settings.js] Exception in openSettingsModal:', err);
        if (window.electronAPI && window.electronAPI.logToMain) {
            window.electronAPI.logToMain(`[RENDERER settings.js] CRITICAL EXCEPTION in openSettingsModal for "${game ? game.name : 'unknown'}": ${err.stack || err.message}`);
        }
    }
}

/**
 * Mod kurulum/kaldırma sonrası oyun state'ini diskten tazeler.
 *
 * `get-games` IPC'si oyun DİZİSİ döndürür (`{ games: [...] }` değil) — burada
 * yanlış alan okunduğu için kaldırma sonrası `state.currentSelectedGame` eski
 * kalıyor ve silinen mod ekranda duruyordu.
 */
async function refreshGamesAfterModChange(gameName) {
    try {
        if (!window.electronAPI || !window.electronAPI.getGames) return;

        const games = await window.electronAPI.getGames();
        if (!Array.isArray(games)) return;

        state.games = games;
        renderGames(state.games);
        updateHomeStats();

        const updated = games.find(g => g && g.name === gameName);
        if (updated) state.currentSelectedGame = updated;
    } catch (e) {
        console.warn('[RENDERER settings.js] Oyun listesi tazelenemedi:', e.message);
    }
}

// ─── Dinamik Sekme Stil Güncelleyicisi ────────────────────────────────────────
function updateTabActiveState(activeModId) {
    const buttons = document.querySelectorAll('#settings-tabs-container .settings-tab-btn');
    buttons.forEach(btn => {
        const btnId = btn.dataset.modId;
        const isActive = (btnId === activeModId || normalizeModId(btnId) === normalizeModId(activeModId));
        btn.style.opacity = isActive ? '1' : '0.6';
        btn.style.background = isActive ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.04)';
        btn.style.borderWidth = '1px';
        btn.style.borderColor = isActive ? 'var(--accent-color, #3b82f6)' : 'rgba(255, 255, 255, 0.1)';
    });
}

// ─── Mod ayarlarını yükle (Generic + Fallback) ───────────────────────────────
async function loadModSettings(modId) {
    const game = state.currentSelectedGame;
    currentActiveMod = modId;
    activePresetId = null;
    hideError();

    console.log(`[RENDERER settings.js] loadModSettings: modId="${modId}", game="${game ? game.name : 'undefined'}"`);
    if (window.electronAPI && window.electronAPI.logToMain) {
        window.electronAPI.logToMain(`[RENDERER settings.js] loadModSettings: modId="${modId}", game="${game ? game.name : 'undefined'}"`);
    }

    updateTabActiveState(modId);

    const contentDiv = document.getElementById('settings-content');
    if (contentDiv) {
        contentDiv.innerHTML = `<div style="color:var(--text-secondary); padding: 20px;">${t('modSettings.loading')}</div>`;
    }

    const normalizedId = normalizeModId(modId);
    const manifestId = toManifestId(modId);

    // 1. Bulunan mod nesnesini al
    const mod = currentActiveModsList.find(m => m.id === modId || normalizeModId(m.id) === normalizedId) || {
        id: modId,
        name: modId,
        type: 'official',
        installedVersion: 'Kurulu',
        hasConfig: true,
        hasReleases: true
    };
    currentActiveModInfo = mod;

    // 2. Mod Lifecycle & Management Card Elemanlarını Doldur
    const manageCard = document.getElementById('settings-mod-manage-card');
    const cardName = document.getElementById('settings-card-mod-name');
    const cardType = document.getElementById('settings-card-mod-type');
    const cardVersion = document.getElementById('settings-card-mod-version');
    const cardDesc = document.getElementById('settings-card-mod-desc');
    const uninstallBtn = document.getElementById('settings-uninstall-btn');
    const versionSection = document.getElementById('settings-version-section');
    const versionSelect = document.getElementById('settings-version-select');
    const changeVersionBtn = document.getElementById('settings-change-version-btn');
    const progressRow = document.getElementById('settings-mod-progress-row');
    const saveBtn = document.getElementById('settings-save-btn');

    if (manageCard) manageCard.style.display = 'block';
    if (progressRow) progressRow.style.display = 'none';

    if (cardName) cardName.textContent = mod.name || mod.id;
    if (cardType) {
        cardType.textContent = mod.type === 'community' ? (t('modSettings.communityBadge') || '🌐 Topluluk') : (t('modSettings.officialBadge') || '🛡️ Resmi');
    }
    if (cardVersion) {
        cardVersion.textContent = mod.installedVersion ? (mod.installedVersion.startsWith('v') ? mod.installedVersion : `v${mod.installedVersion}`) : (t('modSettings.installedBadge') || 'Kurulu');
    }
    if (cardDesc) {
        cardDesc.textContent = mod.description || '';
        cardDesc.style.display = mod.description ? 'block' : 'none';
    }

    // 3. Mod Kaldırma (Uninstall) Butonu Dinleyicisi
    // Bazı modüller "kaldırılmaz, yalnızca değiştirilir" (ör. Streamline oyunun
    // kendi sl.*.dll dosyalarının yerine geçer). Manifest bunu
    // `uninstall.userRemovable: false` ile bildirir; alan yoksa buton görünür.
    const userRemovable = mod.manifest?.uninstall?.userRemovable !== false;
    if (uninstallBtn) uninstallBtn.style.display = userRemovable ? '' : 'none';

    if (uninstallBtn && userRemovable) {
        uninstallBtn.onclick = async () => {
            const confirmTitle = t('modSettings.uninstallConfirmTitle') || 'Modu Kaldır';
            const confirmMsg = `"${mod.name || mod.id}" ${t('modSettings.uninstallConfirmMsg') || 'adlı modu bu oyundan tamamen kaldırmak istediğinize emin misiniz? Varsa orijinal yedek dosyalar geri yüklenecektir.'}`;
            const confirmed = await showConfirmDialog(confirmTitle, confirmMsg);
            if (!confirmed) return;

            // Kaldırma işlemi
            uninstallBtn.disabled = true;
            uninstallBtn.style.opacity = '0.5';
            if (progressRow) {
                progressRow.style.display = 'block';
                const statusTxt = document.getElementById('settings-progress-status-text');
                const percentTxt = document.getElementById('settings-progress-percent-text');
                const bar = document.getElementById('settings-progress-bar');
                if (statusTxt) statusTxt.textContent = `${mod.name || mod.id} kaldırılıyor...`;
                if (percentTxt) percentTxt.textContent = '%50';
                if (bar) bar.style.width = '50%';
            }

            try {
                let unResult;
                if (window.electronAPI && window.electronAPI.moduleUninstall) {
                    unResult = await window.electronAPI.moduleUninstall(manifestId, game.name, game.exePath);
                }
                

                if (unResult && unResult.success) {
                    // Oyun listesini ve seçili oyunu tazele — kaldırılan mod
                    // hem oyun kartlarından hem de bu ekrandan hemen düşmeli.
                    await refreshGamesAfterModChange(game.name);

                    // ÖNCE Settings Hub'ı güncel oyun durumuyla yeniden çiz
                    // (kalan modları ya da boş ekranı gösterir), SONRA bilgi
                    // modalini aç. Ters sırada, openModal()'ın dinamik z-index'i
                    // settings-modal'ı bilgi modalinin üstüne çıkarıyordu.
                    await openSettingsModal(state.currentSelectedGame);
                    showInfoModal(
                        t('update.successTitle') || 'Başarılı',
                        `${mod.name || mod.id} ${t('modSettings.uninstallSuccess') || 'başarıyla kaldırıldı.'}`,
                        false,
                        { log: unResult.log, logSummary: unResult.logSummary, logFile: unResult.logFile }
                    );
                } else {
                    const errText = (unResult && (unResult.error || unResult.message)) || 'Bilinmeyen hata';
                    showError(`${t('modSettings.uninstallError') || 'Mod kaldırılırken hata oluştu: '}${errText}`);
                }
            } catch (unErr) {
                console.error('[RENDERER settings.js] Kaldırma hatası:', unErr);
                showError(`${t('modSettings.uninstallError') || 'Mod kaldırılırken hata oluştu: '}${unErr.message}`);
            } finally {
                uninstallBtn.disabled = false;
                uninstallBtn.style.opacity = '1';
                if (progressRow) progressRow.style.display = 'none';
            }
        };
    }

    // 4. Sürüm Değiştirici (Version Switcher) Bölümü
    if (versionSection && versionSelect && changeVersionBtn) {
        if (mod.hasReleases) {
            versionSection.style.display = 'block';
            versionSelect.innerHTML = `<option value="" disabled selected>${t('update.loadingVersions') || 'Sürümler yükleniyor...'}</option>`;
            changeVersionBtn.disabled = true;

            // Arka planda sürümleri çek
            (async () => {
                try {
                    let releases = [];
                    if (window.electronAPI && window.electronAPI.moduleGetReleases) {
                        const relRes = await window.electronAPI.moduleGetReleases(manifestId);
                        if (relRes && relRes.success && Array.isArray(relRes.releases)) {
                            releases = relRes.releases;
                        }
                    }

                    if (releases && releases.length > 0) {
                        versionSelect.innerHTML = '';
                        releases.forEach(r => {
                            const opt = document.createElement('option');
                            const tagVal = r.tag || r.name || r.version;
                            opt.value = tagVal;
                            const isCur = (tagVal === mod.installedVersion || (mod.installedVersion && mod.installedVersion.replace(/^v/, '') === tagVal.replace(/^v/, '')));
                            opt.textContent = `${tagVal}${isCur ? ' (Kurulu)' : ''}`;
                            if (isCur) opt.selected = true;
                            versionSelect.appendChild(opt);
                        });
                        changeVersionBtn.disabled = false;
                    } else {
                        versionSelect.innerHTML = `<option value="" disabled>${t('update.noVersions') || 'Sürüm bulunamadı'}</option>`;
                        changeVersionBtn.disabled = true;
                    }
                } catch (e) {
                    console.warn('[RENDERER settings.js] Sürümler yüklenemedi:', e);
                    versionSelect.innerHTML = `<option value="" disabled>${t('update.loadError') || 'Hata oluştu'}</option>`;
                    changeVersionBtn.disabled = true;
                }
            })();

            changeVersionBtn.onclick = async () => {
                const targetVersion = versionSelect.value;
                if (!targetVersion) return;

                const curVerNorm = (mod.installedVersion || '').replace(/^v/, '');
                const targetNorm = targetVersion.replace(/^v/, '');
                if (curVerNorm && curVerNorm === targetNorm) {
                    showInfoModal(t('update.infoTitle') || 'Bilgi', t('update.changeDlssSameVersion') || 'Bu sürüm zaten kurulu.');
                    return;
                }

                changeVersionBtn.disabled = true;
                if (progressRow) {
                    progressRow.style.display = 'block';
                    const statusTxt = document.getElementById('settings-progress-status-text');
                    const percentTxt = document.getElementById('settings-progress-percent-text');
                    const bar = document.getElementById('settings-progress-bar');
                    if (statusTxt) statusTxt.textContent = `${targetVersion} indiriliyor ve kuruluyor...`;
                    if (percentTxt) percentTxt.textContent = '%0';
                    if (bar) bar.style.width = '0%';
                }

                try {
                    // İlerleme dinleyicisi
                    if (window.electronAPI && window.electronAPI.onModuleDownloadProgress) {
                        window.electronAPI.onModuleDownloadProgress((data) => {
                            const bar = document.getElementById('settings-progress-bar');
                            const txt = document.getElementById('settings-progress-percent-text');
                            const statusTxt = document.getElementById('settings-progress-status-text');
                            if (bar) bar.style.width = `${data.percent || 0}%`;
                            if (txt) txt.textContent = `%${data.percent || 0}`;
                            if (statusTxt) statusTxt.textContent = data.stage === 'extracting' ? 'Arşiv açılıyor...' : 'İndiriliyor...';
                        });
                    }

                    let installRes;
                    if (window.electronAPI && window.electronAPI.moduleInstall) {
                        const installOptions = {
                            preset: false // Varsayılan preset ile kullanıcı ayarlarını ezme
                        };
                        // proxyTarget'ı mevcut oyun durumundan al
                        if (mod.manifest?.state?.injectionField && game[mod.manifest.state.injectionField]) {
                            installOptions.proxyTarget = game[mod.manifest.state.injectionField];
                        }
                        // Aktif addons'ları mevcut oyun durumundan al
                        if (mod.manifest?.addons) {
                            installOptions.addons = {};
                            for (const addon of mod.manifest.addons) {
                                if (game.installedMods && game.installedMods[addon.moduleId]?.installed) {
                                    installOptions.addons[addon.moduleId] = true;
                                }
                            }
                        }

                        installRes = await window.electronAPI.moduleInstall({
                            moduleId: manifestId,
                            gameName: game.name,
                            exePath: game.exePath,
                            tag: targetVersion,
                            options: installOptions
                        });
                    }

                    if (installRes && installRes.success) {
                        await refreshGamesAfterModChange(game.name);

                        showInfoModal(t('update.successTitle') || 'Başarılı', `${mod.name || mod.id} ${targetVersion} ${t('modSettings.versionChangeSuccess') || 'başarıyla güncellendi.'}`);
                        await openSettingsModal(state.currentSelectedGame);
                    } else {
                        const err = (installRes && (installRes.error || installRes.message)) || 'Bilinmeyen kurulum hatası';
                        showError(`${t('modSettings.versionChangeError') || 'Mod sürümü değiştirilirken hata oluştu: '}${err}`);
                    }
                } catch (chErr) {
                    console.error('[RENDERER settings.js] Sürüm değiştirme hatası:', chErr);
                    showError(`${t('modSettings.versionChangeError') || 'Mod sürümü değiştirilirken hata oluştu: '}${chErr.message}`);
                } finally {
                    if (window.electronAPI && window.electronAPI.removeModuleDownloadProgressListeners) {
                        window.electronAPI.removeModuleDownloadProgressListeners();
                    }
                    changeVersionBtn.disabled = false;
                    if (progressRow) progressRow.style.display = 'none';
                }
            };
        } else {
            versionSection.style.display = 'none';
        }
    }

    // 5. Konfigürasyon Bölümü (INI / Generic Config)
    // 5. Konfigürasyon Bölümü (INI / Generic Config)
    // Eğer mod konfigürasyon desteklemiyorsa (hasConfig: false), temiz bir bilgi mesajı göster ve Kaydet butonunu gizle!
    if (!mod.hasConfig) {
        if (contentDiv) {
            contentDiv.innerHTML = `
                <div style="text-align: center; color: var(--text-secondary); padding: 40px 20px;">
                    <div style="font-size: 36px; margin-bottom: 12px;">✨</div>
                    <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">${mod.name || mod.id}</div>
                    <div style="font-size: 13px; color: var(--text-secondary); max-width: 440px; margin: 0 auto; line-height: 1.6;">
                        ${t('modSettings.noConfigNote') || 'Bu mod için harici bir konfigürasyon (INI/JSON) ayarı gerekmemektedir. Modun sürümünü değiştirebilir veya yukarıdaki panelden kaldırabilirsiniz.'}
                    </div>
                </div>`;
        }
        if (saveBtn) saveBtn.style.display = 'none';
        return;
    }

    // Konfigürasyon varsa Kaydet butonunu göster
    if (saveBtn) saveBtn.style.display = 'flex';

    // 6. Kullanıcı presetlerini yükle
    try {
        const presetsResult = await window.electronAPI.readModPresets(manifestId);
        userPresets = (presetsResult && presetsResult.success) ? (presetsResult.presets || []) : [];
    } catch (_) {
        userPresets = [];
    }

    // 7. Manifest Bilgisini Sorgula
    let manifest = null;
    try {
        if (window.electronAPI && window.electronAPI.moduleGetInfo) {
            const infoRes = await window.electronAPI.moduleGetInfo(manifestId);
            if (infoRes && infoRes.success && infoRes.module?.manifest) {
                manifest = infoRes.module.manifest;
            }
        }
    } catch (_) {
        manifest = null;
    }

    // Manifest Varsa (Yeni Dinamik Generic Motor)
    if (manifest && Array.isArray(manifest.config) && manifest.config.length > 0) {
        const configEntry = manifest.config.find(c => c.format === 'ini') || manifest.config[0];
        try {
            const readRes = await window.electronAPI.moduleReadConfig({
                moduleId: manifestId,
                gameName: game.name,
                exePath: game.exePath
            });

            if (!readRes || !readRes.exists) {
                console.log('[RENDERER settings.js] INI file does not exist (moduleReadConfig)');
                contentDiv.innerHTML = `
                    <div style="text-align: center; color: var(--text-secondary); padding: 30px;">
                        <div style="font-size: 32px; margin-bottom: 10px;">⚠️</div>
                        <div style="font-size: 14px;">${t('modSettings.noIni')}</div>
                    </div>`;
                currentSettingsData = {};
                if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.5'; }
                return;
            }

            if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = '1'; }

            currentSettingsData = readRes.data || {};
            const presetsSource = configEntry.presets || manifest.presets || null;
            renderWithPresets(manifestId, () => {
                renderSettingsUI(manifestId, currentSettingsData, configEntry.schema || {}, game);
            }, presetsSource);
            return;
        } catch (err) {
            console.error('[RENDERER settings.js] Error reading generic config:', err);
            showError(t('modSettings.iniError') + err.message);
            contentDiv.innerHTML = `
                <div style="text-align: center; color: var(--text-secondary); padding: 30px;">
                    <div style="font-size: 32px; margin-bottom: 10px;">⚠️</div>
                    <div style="font-size: 14px;">${t('modSettings.noIni')}</div>
                </div>`;
            if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.5'; }
            return;
        }
    } else {
        contentDiv.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); padding: 30px;">
                <div style="font-size: 32px; margin-bottom: 10px;">⚠️</div>
                <div style="font-size: 14px;">${t('modSettings.noIni')}</div>
            </div>`;
        if (saveBtn) saveBtn.style.display = 'none';
    }
}

// ─── Preset UI ───────────────────────────────────────────────────────────────
/**
 * Preset çubuğunu (banner) oluşturur ve ardından renderFn ile form içeriğini üretir.
 * settings-content div'ine önce preset bar, sonra form eklenir.
 */
function renderWithPresets(mod, renderFn, manifestPresets = null) {
    const contentDiv = document.getElementById('settings-content');
    contentDiv.innerHTML = '';

    // Preset Bar Wrapper
    const presetBar = document.createElement('div');
    presetBar.id = 'preset-bar';
    presetBar.style.cssText = `
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px;
        padding: 12px 16px;
        margin-bottom: 16px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
    `;

    // Başlık
    const title = document.createElement('span');
    title.textContent = t('modSettings.presets.sectionTitle') + ':';
    title.style.cssText = 'font-size:12px;color:var(--text-secondary);font-weight:600;margin-right:4px;white-space:nowrap;';
    presetBar.appendChild(title);

    const normalizedMod = normalizeModId(mod);
    // Geliştirici presetleri (öncelik manifest'te tanımlı olanlar)
    const game = state.currentSelectedGame;
    let devList = [];
    if (manifestPresets && typeof manifestPresets === 'object') {
        devList = Object.entries(manifestPresets).map(([id, p]) => ({
            id,
            name: p.name || id,
            nameKey: p.nameKey,
            locked: p.locked !== false,
            values: p.values || {}
        }));
    } else if (DEVELOPER_PRESETS[normalizedMod]) {
        devList = DEVELOPER_PRESETS[normalizedMod];
    }

    if (normalizedMod === 'optiscaler') {
        const showOptiFG = game && game.hasOptiscaler && !game.hasDlssEnabler;
        if (!showOptiFG) {
            devList = [];
        }
    }
    for (const preset of devList) {
        presetBar.appendChild(buildPresetChip(preset, normalizedMod, true));
    }

    // Kullanıcı presetleri
    for (const preset of userPresets) {
        presetBar.appendChild(buildPresetChip(preset, normalizedMod, false));
    }

    // + Yeni Ön Ayar butonu
    const newBtn = document.createElement('button');
    newBtn.textContent = t('modSettings.presets.newPresetBtn');
    newBtn.style.cssText = `
        background: rgba(255,255,255,0.07);
        border: 1px dashed rgba(255,255,255,0.25);
        color: var(--text-secondary);
        padding: 5px 12px;
        border-radius: 20px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
    `;
    newBtn.addEventListener('mouseenter', () => {
        newBtn.style.background = 'rgba(255,255,255,0.12)';
        newBtn.style.color = 'var(--text-primary)';
    });
    newBtn.addEventListener('mouseleave', () => {
        newBtn.style.background = 'rgba(255,255,255,0.07)';
        newBtn.style.color = 'var(--text-secondary)';
    });
    newBtn.addEventListener('click', () => showNewPresetForm(presetBar, newBtn, normalizedMod));
    presetBar.appendChild(newBtn);

    contentDiv.appendChild(presetBar);

    // Form içeriği için wrapper div oluştur — renderFn bunu kullanacak
    const formWrapper = document.createElement('div');
    formWrapper.id = 'settings-form-wrapper';
    contentDiv.appendChild(formWrapper);

    // renderFn, settings-form-wrapper'a yazacak
    renderFn();
}

/**
 * Bir preset chip (rozet/buton) elementi oluşturur.
 */
function buildPresetChip(preset, mod, isDevPreset) {
    const chip = document.createElement('div');
    chip.dataset.presetId = preset.id;
    chip.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 20px;
        padding: 5px 10px 5px 12px;
        cursor: pointer;
        font-size: 12px;
        color: var(--text-primary);
        transition: all 0.2s;
        user-select: none;
        position: relative;
    `;

    const displayName = isDevPreset ? t(preset.nameKey) : preset.name;

    if (isDevPreset) {
        const lock = document.createElement('span');
        lock.textContent = t('modSettings.presets.lockedBadge');
        lock.style.cssText = 'font-size:11px;opacity:0.8;';
        chip.appendChild(lock);
    }

    const nameSpan = document.createElement('span');
    nameSpan.textContent = displayName;
    chip.appendChild(nameSpan);

    if (!isDevPreset) {
        // Silme butonu
        const delBtn = document.createElement('span');
        delBtn.textContent = '×';
        delBtn.title = t('modSettings.presets.deleteTooltip');
        delBtn.style.cssText = `
            width: 16px;
            height: 16px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            font-size: 13px;
            line-height: 1;
            color: rgba(255,255,255,0.4);
            transition: all 0.15s;
            margin-left: 2px;
        `;
        delBtn.addEventListener('mouseenter', () => {
            delBtn.style.color = '#ef4444';
            delBtn.style.background = 'rgba(239,68,68,0.2)';
        });
        delBtn.addEventListener('mouseleave', () => {
            delBtn.style.color = 'rgba(255,255,255,0.4)';
            delBtn.style.background = '';
        });
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteUserPreset(preset.id, mod);
        });
        chip.appendChild(delBtn);
    }

    // Chip tıklama → preset uygula
    chip.addEventListener('click', () => applyPreset(preset, chip));

    // Hover efektleri
    chip.addEventListener('mouseenter', () => {
        if (activePresetId !== preset.id) {
            chip.style.background = 'rgba(255,255,255,0.10)';
            chip.style.borderColor = 'rgba(255,255,255,0.22)';
        }
    });
    chip.addEventListener('mouseleave', () => {
        if (activePresetId !== preset.id) {
            chip.style.background = 'rgba(255,255,255,0.06)';
            chip.style.borderColor = 'rgba(255,255,255,0.12)';
        }
    });

    return chip;
}

/**
 * Preset uygula — form alanlarını kısmi olarak güncelle.
 */
function applyPreset(preset, chipEl) {
    console.log('[applyPreset] Applying preset:', preset.id, preset.name || preset.nameKey);
    // Önceki aktif chip'i normal hale getir ve yeşil border'ları temizle
    clearActivePresetHighlight();

    activePresetId = preset.id;

    // Bu chip'i vurgula
    highlightChip(chipEl, true);

    const changedFields = [];

    // Mevcut currentSettingsData'ya kısmi uygula ve neyin değiştiğini tespit et
    for (const [sectionOrKey, valOrNested] of Object.entries(preset.values)) {
        if (sectionOrKey.includes('.') && (typeof valOrNested !== 'object' || valOrNested === null)) {
            // SON noktadan böl: INI bölüm adları nokta içerebilir
            // (ör. "RenoDX.MFGUnlock.Enabled" → bölüm "RenoDX.MFGUnlock").
            const lastDot = sectionOrKey.lastIndexOf('.');
            const sec = sectionOrKey.substring(0, lastDot);
            const k = sectionOrKey.substring(lastDot + 1);
            const matchedSec = Object.keys(currentSettingsData).find(s => s.toLowerCase() === sec.toLowerCase()) || sec;
            if (!currentSettingsData[matchedSec]) currentSettingsData[matchedSec] = {};
            const matchedKey = Object.keys(currentSettingsData[matchedSec]).find(keyItem => keyItem.toLowerCase() === k.toLowerCase()) || k;
            changedFields.push({ section: matchedSec, key: matchedKey });
            currentSettingsData[matchedSec][matchedKey] = valOrNested;
            continue;
        }

        if (typeof valOrNested === 'object' && valOrNested !== null) {
            const matchedSec = Object.keys(currentSettingsData).find(s => s.toLowerCase() === sectionOrKey.toLowerCase()) || sectionOrKey;
            if (!currentSettingsData[matchedSec]) currentSettingsData[matchedSec] = {};
            for (const [key, val] of Object.entries(valOrNested)) {
                const matchedKey = Object.keys(currentSettingsData[matchedSec]).find(k => k.toLowerCase() === key.toLowerCase()) || key;
                changedFields.push({ section: matchedSec, key: matchedKey });
                currentSettingsData[matchedSec][matchedKey] = val;
            }
        }
    }

    console.log('[applyPreset] Fields to highlight:', JSON.stringify(changedFields));

    // Form alanlarını güncelle (DOM'daki select/input'ları yenile)
    syncFormToData(currentSettingsData);

    // Değişen/ön ayar kapsamındaki tüm alanların border rengini yeşil yap
    const formWrapper = document.getElementById('settings-form-wrapper');
    if (formWrapper) {
        const inputs = formWrapper.querySelectorAll('[data-section][data-key]');
        console.log('[applyPreset] Found form inputs count:', inputs.length);
        changedFields.forEach(({ section, key }) => {
            const el = Array.from(inputs).find(input => 
                input.dataset.section && 
                input.dataset.key &&
                input.dataset.section.toLowerCase() === section.toLowerCase() &&
                input.dataset.key.toLowerCase() === key.toLowerCase()
            );
            if (el) {
                console.log(`[applyPreset] Highlighting field: ${section} -> ${key}`);
                el.classList.add('green-border-highlight');
            } else {
                console.warn(`[applyPreset] Could not find form element to highlight for: ${section} -> ${key}`);
            }
        });
    }

    // Dirty yap ama preset vurgusu kalsın
    markDirty();
}

function clearActivePresetHighlight() {
    const presetBar = document.getElementById('preset-bar');
    if (!presetBar) return;
    const chips = presetBar.querySelectorAll('[data-preset-id]');
    chips.forEach(chip => highlightChip(chip, false));

    // Yeşil border vurgularını temizle
    const formWrapper = document.getElementById('settings-form-wrapper');
    if (formWrapper) {
        formWrapper.querySelectorAll('.green-border-highlight').forEach(el => {
            el.classList.remove('green-border-highlight');
        });
    }
}

function highlightChip(chip, active) {
    if (active) {
        chip.style.background = 'rgba(var(--accent-rgb, 99,102,241), 0.25)';
        chip.style.borderColor = 'var(--accent-color, #6366f1)';
        chip.style.color = 'var(--accent-color, #6366f1)';
        chip.style.fontWeight = '600';
    } else {
        chip.style.background = 'rgba(255,255,255,0.06)';
        chip.style.borderColor = 'rgba(255,255,255,0.12)';
        chip.style.color = 'var(--text-primary)';
        chip.style.fontWeight = '';
    }
}

/**
 * Form DOM elemanlarını currentSettingsData ile senkronize et.
 * Her select/input'u data'daki değerle günceller.
 */
function syncFormToData(data) {
    const formWrapper = document.getElementById('settings-form-wrapper');
    if (!formWrapper) return;

    const selects = formWrapper.querySelectorAll('select[data-section][data-key]');
    selects.forEach(sel => {
        const section = sel.dataset.section;
        const key = sel.dataset.key;
        
        const matchedSec = Object.keys(data).find(s => s.toLowerCase() === section.toLowerCase());
        let newVal = null;
        if (matchedSec) {
            const matchedKey = Object.keys(data[matchedSec]).find(k => k.toLowerCase() === key.toLowerCase());
            if (matchedKey && data[matchedSec][matchedKey] !== undefined) {
                newVal = String(data[matchedSec][matchedKey]);
            }
        }

        if (newVal !== null && sel.value !== newVal) {
            sel.value = newVal;
            if (sel.value !== newVal) sel.selectedIndex = 0;
        }
    });

    const inputs = formWrapper.querySelectorAll('input[data-section][data-key]');
    inputs.forEach(inp => {
        const section = inp.dataset.section;
        const key = inp.dataset.key;
        
        const matchedSec = Object.keys(data).find(s => s.toLowerCase() === section.toLowerCase());
        let newVal = null;
        if (matchedSec) {
            const matchedKey = Object.keys(data[matchedSec]).find(k => k.toLowerCase() === key.toLowerCase());
            if (matchedKey && data[matchedSec][matchedKey] !== undefined) {
                newVal = String(data[matchedSec][matchedKey]);
            }
        }

        if (newVal !== null) inp.value = newVal;
    });

    const sliders = formWrapper.querySelectorAll('input[type=range][data-section][data-key]');
    sliders.forEach(sl => {
        const section = sl.dataset.section;
        const key = sl.dataset.key;
        
        const matchedSec = Object.keys(data).find(s => s.toLowerCase() === section.toLowerCase());
        let newVal = null;
        if (matchedSec) {
            const matchedKey = Object.keys(data[matchedSec]).find(k => k.toLowerCase() === key.toLowerCase());
            if (matchedKey && data[matchedSec][matchedKey] !== undefined) {
                newVal = String(data[matchedSec][matchedKey]);
            }
        }

        if (newVal !== null) {
            sl.value = newVal;
            const display = sl.nextElementSibling;
            if (display) display.textContent = newVal;
        }
    });
}

/**
 * Yeni preset kaydetme formu göster.
 */
function showNewPresetForm(presetBar, newBtn, mod) {
    // Zaten form varsa çıkar
    const existingForm = presetBar.querySelector('.new-preset-form');
    if (existingForm) { existingForm.remove(); newBtn.style.display = ''; return; }

    newBtn.style.display = 'none';

    const form = document.createElement('div');
    form.className = 'new-preset-form';
    form.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('modSettings.presets.newPresetPlaceholder');
    input.style.cssText = `
        background: rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,255,0.2);
        color: white;
        padding: 5px 10px;
        border-radius: 20px;
        font-size: 12px;
        outline: none;
        width: 160px;
    `;
    input.addEventListener('focus', () => input.style.borderColor = 'var(--accent-color, #6366f1)');
    input.addEventListener('blur', () => input.style.borderColor = 'rgba(255,255,255,0.2)');
    form.appendChild(input);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = t('modSettings.presets.newPresetSave');
    saveBtn.style.cssText = 'background:var(--accent-color,#6366f1);color:white;border:none;padding:5px 12px;border-radius:20px;font-size:12px;cursor:pointer;';
    saveBtn.addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) {
            input.style.borderColor = '#ef4444';
            return;
        }
        await saveNewUserPreset(name, mod, presetBar, newBtn, form);
    });
    form.appendChild(saveBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = t('modSettings.presets.newPresetCancel');
    cancelBtn.style.cssText = 'background:rgba(255,255,255,0.08);color:var(--text-secondary);border:none;padding:5px 10px;border-radius:20px;font-size:12px;cursor:pointer;';
    cancelBtn.addEventListener('click', () => { form.remove(); newBtn.style.display = ''; });
    form.appendChild(cancelBtn);

    presetBar.appendChild(form);
    input.focus();
}

async function saveNewUserPreset(name, mod, presetBar, newBtn, formEl) {
    // Mevcut currentSettingsData'dan snapshot al
    const snapshot = JSON.parse(JSON.stringify(currentSettingsData));
    const newPreset = {
        id: 'user-' + Date.now(),
        name,
        locked: false,
        values: snapshot
    };

    userPresets.push(newPreset);

    try {
        await window.electronAPI.writeModPresets(mod, userPresets);
    } catch (e) {
        console.error('[settings.js] Failed to save preset:', e);
    }

    // Yeni chip'i bar'a ekle (formEl'den önce)
    const chip = buildPresetChip(newPreset, mod, false);
    presetBar.insertBefore(chip, formEl);
    formEl.remove();
    newBtn.style.display = '';
}

async function deleteUserPreset(presetId, mod) {
    userPresets = userPresets.filter(p => p.id !== presetId);
    if (activePresetId === presetId) activePresetId = null;

    try {
        await window.electronAPI.writeModPresets(mod, userPresets);
    } catch (e) {
        console.error('[settings.js] Failed to delete preset:', e);
    }

    // Chip'i DOM'dan kaldır
    const presetBar = document.getElementById('preset-bar');
    if (presetBar) {
        const chip = presetBar.querySelector(`[data-preset-id="${presetId}"]`);
        if (chip) chip.remove();
    }
}

// ─── Dirty flag yönetimi ──────────────────────────────────────────────────────
function markDirty() {
    isDirty = true;
}

function markCleanAndDeselectPreset() {
    isDirty = false;
    activePresetId = null;
    clearActivePresetHighlight();
}

function findSectionCaseInsensitive(data, sectionName) {
    const target = sectionName.toLowerCase();
    for (const [k, v] of Object.entries(data)) {
        if (k.toLowerCase() === target) return v;
    }
    return null;
}

function findKeyCaseInsensitive(sectionObj, keyName) {
    const target = keyName.toLowerCase();
    for (const [k, v] of Object.entries(sectionObj)) {
        if (k.toLowerCase() === target) return v;
    }
    return undefined;
}

// ─── Manifest Şema UI Renderer ───────────────────────────────────────────────
function findSchemaSection(schema, sectionName) {
    const target = sectionName.toLowerCase();
    for (const [key, val] of Object.entries(schema)) {
        if (key.toLowerCase() === target) return { key, val };
    }
    return null;
}

function findSchemaKey(sectionSchema, keyName) {
    const target = keyName.toLowerCase();
    for (const [key, val] of Object.entries(sectionSchema)) {
        if (key.toLowerCase() === target) return { key, val };
    }
    return null;
}

function renderSettingsUI(mod, data, schemaParam = null, game = null) {
    const contentDiv = document.getElementById('settings-content');
    const target = document.getElementById('settings-form-wrapper') || contentDiv;
    if (!document.getElementById('settings-form-wrapper')) {
        target.innerHTML = '';
    }

    const schema = schemaParam || {};
    const currentGame = game || state.currentSelectedGame;

    for (const [section, keys] of Object.entries(schema)) {
        // Section level visibleIf
        if (keys && keys.visibleIf) {
            const { flag, value } = keys.visibleIf;
            if (currentGame && currentGame[flag] !== value) continue;
        }

        const schemaSectionMatch = findSchemaSection(schema, section);
        if (!schemaSectionMatch) continue;

        const sectionSchema  = schemaSectionMatch.val;
        const schemaSectionKey = schemaSectionMatch.key;

        const keysToShow = [];
        for (const [key, def] of Object.entries(sectionSchema)) {
            if (key === 'visibleIf') continue;

            // Key level visibleIf
            if (def && def.visibleIf) {
                const { flag, value } = def.visibleIf;
                if (currentGame && currentGame[flag] !== value) continue;
            }

            let val = data[section]?.[key];
            if (val === undefined) {
                const dataSec = findSectionCaseInsensitive(data, section);
                if (dataSec) {
                    val = findKeyCaseInsensitive(dataSec, key);
                }
            }

            // displayDefault mapping
            if ((val === undefined || val === 'auto') && def.displayDefault) {
                val = def.displayDefault;
            }

            keysToShow.push({ rawKey: key, schemaKey: key, value: val !== undefined ? val : def.default, def: def });
        }
        if (keysToShow.length === 0) continue;

        const sectionEl = document.createElement('div');
        sectionEl.style.cssText = 'background:rgba(255,255,255,0.02);padding:15px;border-radius:8px;border:1px solid rgba(255,255,255,0.05);margin-bottom:15px;';

        const titleEl = document.createElement('h3');
        titleEl.textContent = `[${schemaSectionKey}]`;
        titleEl.style.cssText = 'margin-top:0;margin-bottom:15px;color:var(--accent-color);font-size:15px;';
        sectionEl.appendChild(titleEl);

        const gridEl = document.createElement('div');
        gridEl.style.display = 'grid';
        gridEl.style.gridTemplateColumns = 'minmax(0, 1fr) minmax(0, 1fr)';
        gridEl.style.gap = '15px';

        for (const item of keysToShow) {
            const inputWrapper = createInputControl(section, item.rawKey, item.value, item.def);
            gridEl.appendChild(inputWrapper);
        }

        sectionEl.appendChild(gridEl);
        target.appendChild(sectionEl);
    }
}

function createInputControl(section, key, currentValue, def) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;gap:6px;min-width:0;';

    const label = document.createElement('label');
    label.textContent = def.labelKey ? t(def.labelKey) : (def.label || key);
    label.style.cssText = 'font-size:12px;color:var(--text-secondary);font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    label.title = key;
    wrapper.appendChild(label);

    if (def.type === 'toggle') {
        const select = document.createElement('select');
        select.className = 'dlss-select-box';
        select.dataset.section = section;
        select.dataset.key = key;
        select.style.cssText = 'padding:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:white;border-radius:4px;width:100%;box-sizing:border-box;min-width:0;';

        const optTrue  = document.createElement('option'); optTrue.value  = 'true';  optTrue.textContent  = t('modSettings.toggleOn');
        const optFalse = document.createElement('option'); optFalse.value = 'false'; optFalse.textContent = t('modSettings.toggleOff');
        select.appendChild(optTrue);
        select.appendChild(optFalse);

        select.value = (currentValue === true || String(currentValue).toLowerCase() === 'true') ? 'true' : 'false';
        select.addEventListener('change', () => {
            if (!currentSettingsData[section]) currentSettingsData[section] = {};
            currentSettingsData[section][key] = select.value === 'true';
            activePresetId = null;
            clearActivePresetHighlight();
            markDirty();
        });
        wrapper.appendChild(select);

    } else if (def.type === 'dropdown') {
        const select = document.createElement('select');
        select.className = 'dlss-select-box';
        select.dataset.section = section;
        select.dataset.key = key;
        select.style.cssText = 'padding:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:white;border-radius:4px;width:100%;box-sizing:border-box;min-width:0;';

        if (Array.isArray(def.options)) {
            for (const opt of def.options) {
                const optionEl = document.createElement('option');
                optionEl.value = String(opt.val);
                optionEl.textContent = opt.labelKey ? t(opt.labelKey) : opt.label;
                select.appendChild(optionEl);
            }
        }
        select.value = String(currentValue);
        select.addEventListener('change', () => {
            let newVal = select.value;
            if (!isNaN(Number(newVal)) && newVal !== '') newVal = Number(newVal);
            if (!currentSettingsData[section]) currentSettingsData[section] = {};
            currentSettingsData[section][key] = newVal;
            activePresetId = null;
            clearActivePresetHighlight();
            markDirty();
        });
        wrapper.appendChild(select);

    } else if (def.type === 'slider') {
        const flexDiv   = document.createElement('div');
        flexDiv.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%;min-width:0;';

        const slider = document.createElement('input');
        slider.type  = 'range';
        slider.min   = def.min !== undefined ? def.min : 0;
        slider.max   = def.max !== undefined ? def.max : 100;
        slider.step  = def.step !== undefined ? def.step : 1;
        slider.value = currentValue !== undefined ? currentValue : slider.min;
        slider.dataset.section = section;
        slider.dataset.key = key;
        slider.style.cssText = 'flex:1;min-width:0;width:100%;';

        const valDisplay = document.createElement('span');
        valDisplay.textContent = slider.value;
        valDisplay.style.cssText = 'font-size:12px;width:30px;text-align:right;flex-shrink:0;';

        slider.addEventListener('input', () => {
            valDisplay.textContent = slider.value;
            if (!currentSettingsData[section]) currentSettingsData[section] = {};
            currentSettingsData[section][key] = Number(slider.value);
            activePresetId = null;
            clearActivePresetHighlight();
            markDirty();
        });

        flexDiv.appendChild(slider);
        flexDiv.appendChild(valDisplay);
        wrapper.appendChild(flexDiv);

    } else {
        const input = document.createElement('input');
        input.type  = 'text';
        input.value = currentValue !== undefined ? currentValue : '';
        input.dataset.section = section;
        input.dataset.key = key;
        input.style.cssText = 'padding:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:white;border-radius:4px;width:100%;box-sizing:border-box;min-width:0;';
        input.addEventListener('input', () => {
            if (!currentSettingsData[section]) currentSettingsData[section] = {};
            currentSettingsData[section][key] = input.value;
            activePresetId = null;
            clearActivePresetHighlight();
            markDirty();
        });
        wrapper.appendChild(input);
    }

    return wrapper;
}

// ─── Kaydetme (Generic moduleApplyConfigChanges + Fallback) ──────────────────
async function saveModSettings() {
    const game = state.currentSelectedGame;
    if (!game || !currentActiveMod) return;

    const btn     = document.getElementById('settings-save-btn');
    const oldText = btn ? btn.querySelector('.save-btn-text')?.textContent || t('modSettings.saveBtn') : t('modSettings.saveBtn');
    const btnTextEl = btn ? btn.querySelector('.save-btn-text') : null;

    if (btn) {
        btn.disabled = true;
        if (btnTextEl) btnTextEl.textContent = t('modSettings.savingBtn');
        btn.style.opacity = '0.7';
    }
    hideError();

    const normalizedId = normalizeModId(currentActiveMod);
    const manifestId = toManifestId(currentActiveMod);

    try {
        let result;
        if (window.electronAPI && window.electronAPI.moduleApplyConfigChanges) {
            result = await window.electronAPI.moduleApplyConfigChanges({
                moduleId: manifestId,
                gameName: game.name,
                exePath: game.exePath,
                changes: currentSettingsData
            });
        }

        if (result && result.success) {
            const savedPresetId = activePresetId;
            
            // Dirty flag temizle
            markCleanAndDeselectPreset();

            if (btn) {
                btn.style.backgroundColor = '#10b981';
                btn.style.opacity = '1';
                if (btnTextEl) btnTextEl.textContent = t('modSettings.savedBtn');
                setTimeout(() => {
                    btn.style.backgroundColor = '';
                    if (btnTextEl) btnTextEl.textContent = t('modSettings.saveBtn');
                    btn.disabled = false;
                }, 2000);
            }

            // MFGHotkeys bildirimi
            if (normalizedId === 'dlss-enabler') {
                const perfSection = findSectionCaseInsensitive(currentSettingsData, 'Performance');
                if (perfSection) {
                    const mfgVal = findKeyCaseInsensitive(perfSection, 'MFGHotkeys');
                    const isTrue = mfgVal === true || String(mfgVal).toLowerCase() === 'true';
                    if (isTrue) {
                        setTimeout(() => showMfgHotkeysNotice(), 300);
                    }
                }
            } else if (normalizedId === 'optiscaler') {
                if (savedPresetId === 'dev-opti-fg') {
                    setTimeout(() => showOptiDeveloperPresetWarning(), 300);
                }
            }
        } else {
            throw new Error((result && result.error) || t('modSettings.unknownSaveError'));
        }
    } catch (err) {
        console.error('[RENDERER settings.js] error in saveModSettings:', err);
        if (window.electronAPI && window.electronAPI.logToMain) {
            window.electronAPI.logToMain(`[RENDERER settings.js] error in saveModSettings: ${err.message}`);
        }
        showError(t('modSettings.saveError') + err.message);
        if (btn) {
            if (btnTextEl) btnTextEl.textContent = t('modSettings.saveBtn');
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    }
}

function showMfgHotkeysNotice() {
    const infoModal = document.getElementById('info-modal');
    const infoTitle = document.getElementById('info-modal-title');
    const infoBody = document.getElementById('info-modal-message');
    const infoClose = document.getElementById('info-modal-ok-btn');
    const infoProgress = document.getElementById('info-modal-progress');

    if (!infoModal || !infoTitle || !infoBody) return;

    // Unsaved extra btn varsa temizle
    const existingExtra = infoModal.querySelector('.unsaved-extra-btn');
    if (existingExtra) existingExtra.remove();

    if (infoProgress) infoProgress.style.display = 'none';
    infoTitle.textContent = t('modSettings.presets.mfgHotkeysTitle');
    infoBody.innerHTML = `<div style="font-size:15px;line-height:1.7;">${t('modSettings.presets.mfgHotkeysNotice')}</div>`;
    infoBody.style.color = '';

    if (infoClose) {
        infoClose.textContent = t('modSettings.presets.mfgHotkeysOk');
        infoClose.onclick = () => closeModal('info-modal');
    }

    openModal('info-modal');
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────
function showError(msg) {
    const errBanner = document.getElementById('settings-error-banner');
    if (errBanner) { errBanner.textContent = msg; errBanner.style.display = 'block'; }
}

function hideError() {
    const errBanner = document.getElementById('settings-error-banner');
    if (errBanner) errBanner.style.display = 'none';
}

function showOptiDeveloperPresetWarning() {
    const infoModal = document.getElementById('info-modal');
    const infoTitle = document.getElementById('info-modal-title');
    const infoBody = document.getElementById('info-modal-message');
    const infoClose = document.getElementById('info-modal-ok-btn');
    const infoProgress = document.getElementById('info-modal-progress');

    if (!infoModal || !infoTitle || !infoBody) return;

    // Unsaved extra btn varsa temizle
    const existingExtra = infoModal.querySelector('.unsaved-extra-btn');
    if (existingExtra) existingExtra.remove();

    if (infoProgress) infoProgress.style.display = 'none';
    infoTitle.textContent = t('modSettings.presets.devOptiFgWarningTitle');
    infoBody.innerHTML = t('modSettings.presets.devOptiFgWarningBody');
    infoBody.style.color = '';

    if (infoClose) {
        infoClose.textContent = t('modSettings.presets.devOptiFgWarningOk');
        infoClose.onclick = () => closeModal('info-modal');
    }

    openModal('info-modal');
}
