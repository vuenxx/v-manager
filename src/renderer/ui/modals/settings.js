import { state } from '../../state.js';
import { openModal } from './base.js';
import { DLSS_ENABLER_SCHEMA, OPTISCALER_FOCUSED_KEYS } from './iniSchema.js';
import { t } from '../../i18n/i18n.js';

let currentSettingsData = {};
let currentActiveMod = null;

export function initSettingsListeners() {
    document.getElementById('tab-dlss-enabler')?.addEventListener('click', () => loadModSettings('dlss-enabler'));
    document.getElementById('tab-optiscaler')?.addEventListener('click', () => loadModSettings('optiscaler'));

    document.getElementById('settings-save-btn')?.addEventListener('click', async () => {
        await saveModSettings();
    });
}

export function openSettingsModal(game) {
    try {
        console.log('[RENDERER settings.js] openSettingsModal triggered for game:', JSON.stringify(game, null, 2));
        if (window.electronAPI && window.electronAPI.logToMain) {
            window.electronAPI.logToMain(`[RENDERER settings.js] openSettingsModal triggered for game: ${game.name}`);
        }
        state.currentSelectedGame = game;

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
    console.log(`[RENDERER settings.js] loadModSettings: mod="${mod}", game="${game ? game.name : 'undefined'}"`);
    if (window.electronAPI && window.electronAPI.logToMain) {
        window.electronAPI.logToMain(`[RENDERER settings.js] loadModSettings: mod="${mod}", game="${game ? game.name : 'undefined'}"`);
    }

    updateTabStyles(mod);

    const contentDiv = document.getElementById('settings-content');
    contentDiv.innerHTML = `<div style="color:var(--text-secondary);">${t('modSettings.loading')}</div>`;
    hideError();

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
            renderSettingsUI(mod, currentSettingsData);
        } else if (mod === 'optiscaler') {
            // Sadece OPTISCALER_FOCUSED_KEYS'teki key'leri extract et
            const focused = extractFocusedKeys(result.data, OPTISCALER_FOCUSED_KEYS);
            currentSettingsData = focused;
            renderFocusedSettingsUI(focused, OPTISCALER_FOCUSED_KEYS);
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

// ─── Focused-keys extraction ─────────────────────────────────────────────────
/**
 * iniData (tam parse edilmiş INI) içinden sadece focusedSchema'daki key'leri çeker.
 * Bulunamayan key'ler için varsayılan değer 'auto' olur.
 * Dönen yapı: { section: { key: value } }
 */
function extractFocusedKeys(iniData, focusedSchema) {
    const result = {};
    for (const [section, keys] of Object.entries(focusedSchema)) {
        result[section] = {};
        const iniSection = findSectionCaseInsensitive(iniData, section);
        for (const key of Object.keys(keys)) {
            let val = 'auto'; // default
            if (iniSection) {
                const iniVal = findKeyCaseInsensitive(iniSection, key);
                if (iniVal !== undefined) {
                    // readIni sayısal değerleri Number'a çevirir; biz string olarak saklıyoruz
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
/**
 * Sadece focusedSchema'daki key'leri dropdown olarak tek bir grid'de gösterir.
 * Section başlıkları da gösterilir, daha temiz görünüm için.
 */
function renderFocusedSettingsUI(focusedData, focusedSchema) {
    const contentDiv = document.getElementById('settings-content');
    contentDiv.innerHTML = '';
    contentDiv.style.gridTemplateColumns = 'repeat(auto-fit, minmax(320px, 1fr))';

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
            label.textContent = def.label || key;
            label.style.cssText = 'font-size:12px;color:var(--text-secondary);font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            label.title = key;
            wrapper.appendChild(label);

            // Tüm focused key'ler dropdown
            const select = document.createElement('select');
            select.className = 'dlss-select-box';
            select.style.cssText = 'padding:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:white;border-radius:4px;width:100%;box-sizing:border-box;min-width:0;';

            for (const opt of def.options) {
                const optEl = document.createElement('option');
                optEl.value = String(opt.val);
                optEl.textContent = opt.label;
                select.appendChild(optEl);
            }

            // Mevcut değeri seç — eşleşme string karşılaştırması ile
            select.value = currentVal;
            // Eğer eşleşme yoksa (beklenmedik değer) ilk seçeneği seç
            if (select.value !== currentVal) {
                select.selectedIndex = 0;
            }

            select.addEventListener('change', () => {
                if (!currentSettingsData[section]) currentSettingsData[section] = {};
                currentSettingsData[section][key] = select.value;
            });

            wrapper.appendChild(select);
            gridEl.appendChild(wrapper);
        }

        sectionEl.appendChild(gridEl);
        contentDiv.appendChild(sectionEl);
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
    contentDiv.innerHTML = '';

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
        contentDiv.appendChild(sectionEl);
    }
}

function createInputControl(section, key, currentValue, def) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;gap:6px;min-width:0;';

    const label = document.createElement('label');
    label.textContent = def.label || key;
    label.style.cssText = 'font-size:12px;color:var(--text-secondary);font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    label.title = key;
    wrapper.appendChild(label);

    if (def.type === 'toggle') {
        const select = document.createElement('select');
        select.className = 'dlss-select-box';
        select.style.cssText = 'padding:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:white;border-radius:4px;width:100%;box-sizing:border-box;min-width:0;';

        const optTrue  = document.createElement('option'); optTrue.value  = 'true';  optTrue.textContent  = t('modSettings.toggleOn');
        const optFalse = document.createElement('option'); optFalse.value = 'false'; optFalse.textContent = t('modSettings.toggleOff');
        select.appendChild(optTrue);
        select.appendChild(optFalse);

        select.value = (currentValue === true || String(currentValue).toLowerCase() === 'true') ? 'true' : 'false';
        select.addEventListener('change', () => {
            currentSettingsData[section][key] = select.value === 'true';
        });
        wrapper.appendChild(select);

    } else if (def.type === 'dropdown') {
        const select = document.createElement('select');
        select.className = 'dlss-select-box';
        select.style.cssText = 'padding:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:white;border-radius:4px;width:100%;box-sizing:border-box;min-width:0;';

        for (const opt of def.options) {
            const optionEl = document.createElement('option');
            optionEl.value = opt.val;
            optionEl.textContent = opt.label;
            select.appendChild(optionEl);
        }
        select.value = String(currentValue);
        select.addEventListener('change', () => {
            let newVal = select.value;
            if (!isNaN(Number(newVal)) && newVal !== '') newVal = Number(newVal);
            currentSettingsData[section][key] = newVal;
        });
        wrapper.appendChild(select);

    } else if (def.type === 'slider') {
        const flexDiv   = document.createElement('div');
        flexDiv.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%;min-width:0;';

        const slider = document.createElement('input');
        slider.type  = 'range';
        slider.min   = def.min; slider.max = def.max; slider.step = def.step;
        slider.value = currentValue;
        slider.style.cssText = 'flex:1;min-width:0;width:100%;';

        const valDisplay = document.createElement('span');
        valDisplay.textContent = currentValue;
        valDisplay.style.cssText = 'font-size:12px;width:30px;text-align:right;flex-shrink:0;';

        slider.addEventListener('input', () => {
            valDisplay.textContent = slider.value;
            currentSettingsData[section][key] = Number(slider.value);
        });

        flexDiv.appendChild(slider);
        flexDiv.appendChild(valDisplay);
        wrapper.appendChild(flexDiv);

    } else {
        const input = document.createElement('input');
        input.type  = 'text';
        input.value = currentValue;
        input.style.cssText = 'padding:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:white;border-radius:4px;width:100%;box-sizing:border-box;min-width:0;';
        input.addEventListener('input', () => {
            currentSettingsData[section][key] = input.value;
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
    const oldText = btn ? btn.textContent : t('modSettings.saveBtn');
    if (btn) { btn.textContent = t('modSettings.savingBtn'); btn.disabled = true; }
    hideError();

    try {
        const result = await window.electronAPI.writeModIni(game, currentActiveMod, currentSettingsData);
        if (result.success) {
            if (btn) {
                btn.style.backgroundColor = '#10b981';
                btn.textContent = t('modSettings.savedBtn');
                setTimeout(() => {
                    btn.style.backgroundColor = '#22c55e';
                    btn.textContent = oldText;
                    btn.disabled = false;
                }, 2000);
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
        if (btn) { btn.textContent = oldText; btn.disabled = false; }
    }
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
