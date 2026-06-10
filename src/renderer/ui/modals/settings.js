import { state } from '../../state.js';
import { openModal, closeModal, setSettingsCloseGuard } from './base.js';
import { DLSS_ENABLER_SCHEMA, OPTISCALER_FOCUSED_KEYS, OPTISCALER_INSTALL_KEYS } from './iniSchema.js';
import { t } from '../../i18n/i18n.js';

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

// ─── Modül Durumu ────────────────────────────────────────────────────────────
let currentSettingsData = {};
let currentActiveMod = null;
let userPresets = [];           // Kullanıcının kaydettiği presetler
let activePresetId = null;      // Şu an seçili preset ID'si (null = hiçbiri)
let isDirty = false;            // Kaydedilmemiş değişiklik var mı?

// ─── Başlatma ────────────────────────────────────────────────────────────────
export function initSettingsListeners() {
    document.getElementById('tab-dlss-enabler')?.addEventListener('click', () => {
        loadModSettings('dlss-enabler');
    });
    document.getElementById('tab-optiscaler')?.addEventListener('click', () => loadModSettings('optiscaler'));

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
export function openSettingsModal(game) {
    try {
        console.log('[RENDERER settings.js] openSettingsModal triggered for game:', JSON.stringify(game, null, 2));
        if (window.electronAPI && window.electronAPI.logToMain) {
            window.electronAPI.logToMain(`[RENDERER settings.js] openSettingsModal triggered for game: ${game.name}`);
        }
        state.currentSelectedGame = game;

        // Dirty flag'i sıfırla
        isDirty = false;
        activePresetId = null;

        const coverEl     = document.getElementById('settings-game-cover');
        const placeholder = document.getElementById('settings-game-placeholder');
        const nameEl      = document.getElementById('settings-game-name');

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

        const tabDlss = document.getElementById('tab-dlss-enabler');
        const tabOpti = document.getElementById('tab-optiscaler');

        console.log('[RENDERER settings.js] game.hasDlssEnabler:', game.hasDlssEnabler);
        console.log('[RENDERER settings.js] game.hasOptiscaler:', game.hasOptiscaler);

        if (tabDlss) tabDlss.style.display = game.hasDlssEnabler ? 'block' : 'none';
        if (tabOpti) tabOpti.style.display = (game.hasOptiscaler || game.hasDlssEnabler) ? 'block' : 'none';

        const contentDiv = document.getElementById('settings-content');
        if (contentDiv) contentDiv.innerHTML = '';

        hideError();

        // Varsayılan sekmeyi belirle: önce DLSS, yoksa OptiScaler
        if (game.hasDlssEnabler) {
            console.log('[RENDERER settings.js] Defaulting to dlss-enabler tab');
            loadModSettings('dlss-enabler');
        } else if (game.hasOptiscaler) {
            console.log('[RENDERER settings.js] Defaulting to optiscaler tab');
            loadModSettings('optiscaler');
        } else {
            console.log('[RENDERER settings.js] No mod available for settings');
            if (contentDiv) {
                contentDiv.innerHTML = `
                    <div style="text-align: center; color: var(--text-secondary); padding: 30px;">
                        <div style="font-size: 32px; margin-bottom: 10px;">ℹ️</div>
                        <div style="font-size: 14px;">${t('modSettings.noMod')}</div>
                    </div>`;
            }
        }

        // Floating kaydet butonu görünürlüğü
        const saveBtn = document.getElementById('settings-save-btn');
        if (saveBtn) saveBtn.style.display = 'flex';

        openModal('settings-modal');
    } catch (err) {
        console.error('[RENDERER settings.js] Exception in openSettingsModal:', err);
        if (window.electronAPI && window.electronAPI.logToMain) {
            window.electronAPI.logToMain(`[RENDERER settings.js] CRITICAL EXCEPTION in openSettingsModal for "${game ? game.name : 'unknown'}": ${err.stack || err.message}`);
        }
    }
}

// ─── Ortak tab stil güncelleyicisi ───────────────────────────────────────────
function updateTabStyles(activeMod) {
    const tabDlss = document.getElementById('tab-dlss-enabler');
    const tabOpti = document.getElementById('tab-optiscaler');

    const active   = { opacity: '1', borderWidth: '2px' };
    const inactive = { opacity: '0.5', borderWidth: '1px' };

    const dlssStyle = activeMod === 'dlss-enabler' ? active : inactive;
    const optiStyle = activeMod === 'optiscaler'   ? active : inactive;

    if (tabDlss) { tabDlss.style.opacity = dlssStyle.opacity; tabDlss.style.borderWidth = dlssStyle.borderWidth; }
    if (tabOpti) { tabOpti.style.opacity = optiStyle.opacity; tabOpti.style.borderWidth = optiStyle.borderWidth; }
}

// ─── Mod ayarlarını yükle ────────────────────────────────────────────────────
async function loadModSettings(mod) {
    const game = state.currentSelectedGame;
    currentActiveMod = mod;
    activePresetId = null;
    console.log(`[RENDERER settings.js] loadModSettings: mod="${mod}", game="${game ? game.name : 'undefined'}"`);
    if (window.electronAPI && window.electronAPI.logToMain) {
        window.electronAPI.logToMain(`[RENDERER settings.js] loadModSettings: mod="${mod}", game="${game ? game.name : 'undefined'}"`);
    }

    updateTabStyles(mod);

    const contentDiv = document.getElementById('settings-content');
    contentDiv.innerHTML = `<div style="color:var(--text-secondary);">${t('modSettings.loading')}</div>`;
    hideError();

    // Kullanıcı presetlerini yükle
    try {
        const presetsResult = await window.electronAPI.readModPresets(mod);
        userPresets = (presetsResult && presetsResult.success) ? (presetsResult.presets || []) : [];
    } catch (_) {
        userPresets = [];
    }

    try {
        console.log('[RENDERER settings.js] invoking readModIni...');
        const result = await window.electronAPI.readModIni(game, mod);
        console.log('[RENDERER settings.js] readModIni result:', JSON.stringify(result, null, 2));
        if (window.electronAPI && window.electronAPI.logToMain) {
            window.electronAPI.logToMain(`[RENDERER settings.js] readModIni result.exists: ${result.exists}`);
        }

        if (!result.exists) {
            console.log('[RENDERER settings.js] INI file does not exist');
            contentDiv.innerHTML = `
                <div style="text-align: center; color: var(--text-secondary); padding: 30px;">
                    <div style="font-size: 32px; margin-bottom: 10px;">⚠️</div>
                    <div style="font-size: 14px;">${t('modSettings.noIni')}</div>
                </div>`;
            currentSettingsData = {};
            const saveBtn = document.getElementById('settings-save-btn');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.5'; }
            return;
        }

        const saveBtn = document.getElementById('settings-save-btn');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = '1'; }

        if (mod === 'dlss-enabler') {
            currentSettingsData = result.data;
            renderWithPresets(mod, () => renderSettingsUI(mod, currentSettingsData));
        } else if (mod === 'optiscaler') {
            const showOptiFG = game && game.hasOptiscaler && !game.hasDlssEnabler;
            const schema = showOptiFG 
                ? { ...OPTISCALER_FOCUSED_KEYS, ...OPTISCALER_INSTALL_KEYS }
                : OPTISCALER_FOCUSED_KEYS;

            const focused = extractFocusedKeys(result.data, schema);
            
            // Map 'auto' values to explicit defaults for newly added keys
            if (showOptiFG) {
                if (focused.FrameGen) {
                    if (focused.FrameGen.Enabled === 'auto') focused.FrameGen.Enabled = 'false';
                    if (focused.FrameGen.FGInput === 'auto') focused.FrameGen.FGInput = 'nofg';
                    if (focused.FrameGen.FGOutput === 'auto') focused.FrameGen.FGOutput = 'nofg';
                }
                if (focused.OptiFG) {
                    if (focused.OptiFG.HUDFix === 'auto') focused.OptiFG.HUDFix = 'false';
                }
            }

            currentSettingsData = focused;
            renderWithPresets(mod, () => renderFocusedSettingsUI(focused, schema));
        }

    } catch (err) {
        console.error('[RENDERER settings.js] error in loadModSettings:', err);
        if (window.electronAPI && window.electronAPI.logToMain) {
            window.electronAPI.logToMain(`[RENDERER settings.js] error in loadModSettings: ${err.message}`);
        }
        showError(t('modSettings.iniError') + err.message);
        contentDiv.innerHTML = '';
    }
}

// ─── Preset UI ───────────────────────────────────────────────────────────────
/**
 * Preset çubuğunu (banner) oluşturur ve ardından renderFn ile form içeriğini üretir.
 * settings-content div'ine önce preset bar, sonra form eklenir.
 */
function renderWithPresets(mod, renderFn) {
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

    // Geliştirici presetleri
    const game = state.currentSelectedGame;
    let devList = DEVELOPER_PRESETS[mod] || [];
    if (mod === 'optiscaler') {
        const showOptiFG = game && game.hasOptiscaler && !game.hasDlssEnabler;
        if (!showOptiFG) {
            devList = [];
        }
    }
    for (const preset of devList) {
        presetBar.appendChild(buildPresetChip(preset, mod, true));
    }

    // Kullanıcı presetleri
    for (const preset of userPresets) {
        presetBar.appendChild(buildPresetChip(preset, mod, false));
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
    newBtn.addEventListener('click', () => showNewPresetForm(presetBar, newBtn, mod));
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
    // Önceki aktif chip'i normal hale getir
    clearActivePresetHighlight();

    activePresetId = preset.id;

    // Bu chip'i vurgula
    highlightChip(chipEl, true);

    // Mevcut currentSettingsData'ya kısmi uygula
    for (const [section, keys] of Object.entries(preset.values)) {
        const matchedSec = Object.keys(currentSettingsData).find(s => s.toLowerCase() === section.toLowerCase()) || section;
        if (!currentSettingsData[matchedSec]) currentSettingsData[matchedSec] = {};
        for (const [key, val] of Object.entries(keys)) {
            const matchedKey = Object.keys(currentSettingsData[matchedSec]).find(k => k.toLowerCase() === key.toLowerCase()) || key;
            currentSettingsData[matchedSec][matchedKey] = val;
        }
    }

    // Form alanlarını güncelle (DOM'daki select/input'ları yenile)
    syncFormToData(currentSettingsData);

    // Dirty yap ama preset vurgusu kalsın
    markDirty();
}

function clearActivePresetHighlight() {
    const presetBar = document.getElementById('preset-bar');
    if (!presetBar) return;
    const chips = presetBar.querySelectorAll('[data-preset-id]');
    chips.forEach(chip => highlightChip(chip, false));
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

// ─── Focused-keys extraction ─────────────────────────────────────────────────
function extractFocusedKeys(iniData, focusedSchema) {
    const result = {};
    for (const [section, keys] of Object.entries(focusedSchema)) {
        result[section] = {};
        const iniSection = findSectionCaseInsensitive(iniData, section);
        for (const key of Object.keys(keys)) {
            let val = 'auto';
            if (iniSection) {
                const iniVal = findKeyCaseInsensitive(iniSection, key);
                if (iniVal !== undefined) {
                    val = String(iniVal);
                }
            }
            result[section][key] = val;
        }
    }
    return result;
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

// ─── Focused UI renderer (OptiScaler) ────────────────────────────────────────
function renderFocusedSettingsUI(focusedData, focusedSchema) {
    const contentDiv = document.getElementById('settings-content');

    // Wrapper'a yönlendir (preset bar ile çakışmayı önle)
    const target = document.getElementById('settings-form-wrapper') || contentDiv;
    if (!document.getElementById('settings-form-wrapper')) {
        target.innerHTML = '';
    }
    target.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;';

    for (const [section, keys] of Object.entries(focusedSchema)) {
        const sectionEl = document.createElement('div');
        sectionEl.style.cssText = 'background:rgba(255,255,255,0.02);padding:15px;border-radius:8px;border:1px solid rgba(255,255,255,0.05);';

        const titleEl = document.createElement('h3');
        titleEl.textContent = `[${section}]`;
        titleEl.style.cssText = 'margin-top:0;margin-bottom:15px;color:var(--accent-color);font-size:15px;';
        sectionEl.appendChild(titleEl);

        const gridEl = document.createElement('div');
        gridEl.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr);gap:12px;';

        for (const [key, def] of Object.entries(keys)) {
            const currentVal = (focusedData[section] && focusedData[section][key] !== undefined)
                ? String(focusedData[section][key])
                : 'auto';

            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'display:flex;flex-direction:column;gap:6px;min-width:0;';

            const label = document.createElement('label');
            label.textContent = def.labelKey ? t(def.labelKey) : (def.label || key);
            label.style.cssText = 'font-size:12px;color:var(--text-secondary);font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            label.title = key;
            wrapper.appendChild(label);

            const select = document.createElement('select');
            select.className = 'dlss-select-box';
            select.dataset.section = section;
            select.dataset.key = key;
            select.style.cssText = 'padding:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:white;border-radius:4px;width:100%;box-sizing:border-box;min-width:0;';

            for (const opt of def.options) {
                const optEl = document.createElement('option');
                optEl.value = String(opt.val);
                optEl.textContent = opt.labelKey ? t(opt.labelKey) : opt.label;
                select.appendChild(optEl);
            }

            select.value = currentVal;
            if (select.value !== currentVal) select.selectedIndex = 0;

            select.addEventListener('change', () => {
                if (!currentSettingsData[section]) currentSettingsData[section] = {};
                currentSettingsData[section][key] = select.value;
                // Preset seçili iken değişiklik yapılırsa preset vurgusunu kaldır
                activePresetId = null;
                clearActivePresetHighlight();
                markDirty();
            });

            wrapper.appendChild(select);
            gridEl.appendChild(wrapper);
        }

        sectionEl.appendChild(gridEl);
        target.appendChild(sectionEl);
    }
}

// ─── DLSS Enabler tam şema UI renderer ───────────────────────────────────────
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

function renderSettingsUI(mod, data) {
    const contentDiv = document.getElementById('settings-content');
    const target = document.getElementById('settings-form-wrapper') || contentDiv;
    if (!document.getElementById('settings-form-wrapper')) {
        target.innerHTML = '';
    }

    const schema = DLSS_ENABLER_SCHEMA;

    for (const [section, keys] of Object.entries(data)) {
        const schemaSectionMatch = findSchemaSection(schema, section);
        if (!schemaSectionMatch) continue;

        const sectionSchema  = schemaSectionMatch.val;
        const schemaSectionKey = schemaSectionMatch.key;

        const keysToShow = [];
        for (const [key, val] of Object.entries(keys)) {
            const schemaKeyMatch = findSchemaKey(sectionSchema, key);
            if (schemaKeyMatch) {
                keysToShow.push({ rawKey: key, schemaKey: schemaKeyMatch.key, value: val, def: schemaKeyMatch.val });
            }
        }
        if (keysToShow.length === 0) continue;

        const sectionEl = document.createElement('div');
        sectionEl.style.cssText = 'background:rgba(255,255,255,0.02);padding:15px;border-radius:8px;border:1px solid rgba(255,255,255,0.05);';

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

        for (const opt of def.options) {
            const optionEl = document.createElement('option');
            optionEl.value = String(opt.val);
            optionEl.textContent = opt.labelKey ? t(opt.labelKey) : opt.label;
            select.appendChild(optionEl);
        }
        select.value = String(currentValue);
        select.addEventListener('change', () => {
            let newVal = select.value;
            if (!isNaN(Number(newVal)) && newVal !== '') newVal = Number(newVal);
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
        slider.min   = def.min; slider.max = def.max; slider.step = def.step;
        slider.value = currentValue;
        slider.dataset.section = section;
        slider.dataset.key = key;
        slider.style.cssText = 'flex:1;min-width:0;width:100%;';

        const valDisplay = document.createElement('span');
        valDisplay.textContent = currentValue;
        valDisplay.style.cssText = 'font-size:12px;width:30px;text-align:right;flex-shrink:0;';

        slider.addEventListener('input', () => {
            valDisplay.textContent = slider.value;
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
        input.value = currentValue;
        input.dataset.section = section;
        input.dataset.key = key;
        input.style.cssText = 'padding:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:white;border-radius:4px;width:100%;box-sizing:border-box;min-width:0;';
        input.addEventListener('input', () => {
            currentSettingsData[section][key] = input.value;
            activePresetId = null;
            clearActivePresetHighlight();
            markDirty();
        });
        wrapper.appendChild(input);
    }

    return wrapper;
}

// ─── Kaydetme ────────────────────────────────────────────────────────────────
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

    try {
        const result = await window.electronAPI.writeModIni(game, currentActiveMod, currentSettingsData);
        if (result.success) {
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
            if (currentActiveMod === 'dlss-enabler') {
                const perfSection = findSectionCaseInsensitive(currentSettingsData, 'Performance');
                if (perfSection) {
                    const mfgVal = findKeyCaseInsensitive(perfSection, 'MFGHotkeys');
                    const isTrue = mfgVal === true || String(mfgVal).toLowerCase() === 'true';
                    if (isTrue) {
                        setTimeout(() => showMfgHotkeysNotice(), 300);
                    }
                }
            } else if (currentActiveMod === 'optiscaler') {
                if (savedPresetId === 'dev-opti-fg') {
                    setTimeout(() => showOptiDeveloperPresetWarning(), 300);
                }
            }
        } else {
            throw new Error(result.error || t('modSettings.unknownSaveError'));
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
