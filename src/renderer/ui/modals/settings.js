import { state } from '../../state.js';
import { openModal } from './base.js';
import { DLSS_ENABLER_SCHEMA, OPTISCALER_SCHEMA } from './iniSchema.js';

let currentSettingsData = {};
let currentActiveMod = null;

export function initSettingsListeners() {
    document.getElementById('tab-dlss-enabler')?.addEventListener('click', () => loadModSettings('dlss-enabler'));

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
        const coverEl = document.getElementById('settings-game-cover');
        const placeholder = document.getElementById('settings-game-placeholder');
        const nameEl = document.getElementById('settings-game-name');
        
        if (nameEl) {
            nameEl.textContent = game.name;
        } else {
            console.warn('[RENDERER settings.js] settings-game-name element NOT FOUND');
        }
        
        if (game.cover) {
            if (coverEl) {
                coverEl.src = game.cover;
                coverEl.style.display = 'block';
            }
            if (placeholder) placeholder.style.display = 'none';
        } else {
            if (coverEl) coverEl.style.display = 'none';
            if (placeholder) placeholder.style.display = 'flex';
        }

        const tabDlss = document.getElementById('tab-dlss-enabler');
        const tabOpti = document.getElementById('tab-optiscaler');
        
        console.log('[RENDERER settings.js] game.hasDlssEnabler flag:', game.hasDlssEnabler);
        if (tabDlss) {
            tabDlss.style.display = game.hasDlssEnabler ? 'block' : 'none';
        } else {
            console.warn('[RENDERER settings.js] tab-dlss-enabler element NOT FOUND');
        }
        
        // OptiScaler config sekmesi kaldırıldı
        if (tabOpti) tabOpti.style.display = 'none';

        const contentDiv = document.getElementById('settings-content');
        if (contentDiv) {
            contentDiv.innerHTML = '';
        } else {
            console.warn('[RENDERER settings.js] settings-content element NOT FOUND');
        }
        
        hideError();

        // Default: sadece DLSS Enabler sekmesi
        if (game.hasDlssEnabler) {
            console.log('[RENDERER settings.js] hasDlssEnabler is true, calling loadModSettings("dlss-enabler")');
            loadModSettings('dlss-enabler');
        } else {
            console.log('[RENDERER settings.js] hasDlssEnabler is false, not calling loadModSettings');
        }

        openModal('settings-modal');
    } catch (err) {
        console.error('[RENDERER settings.js] Exception in openSettingsModal:', err);
        if (window.electronAPI && window.electronAPI.logToMain) {
            window.electronAPI.logToMain(`[RENDERER settings.js] CRITICAL EXCEPTION in openSettingsModal for "${game ? game.name : 'unknown'}": ${err.stack || err.message}`);
        }
        throw err;
    }
}

async function loadModSettings(mod) {
    const game = state.currentSelectedGame;
    currentActiveMod = mod;
    console.log(`[RENDERER settings.js] loadModSettings: mod="${mod}", game name="${game ? game.name : 'undefined'}"`);
    if (window.electronAPI && window.electronAPI.logToMain) {
        window.electronAPI.logToMain(`[RENDERER settings.js] loadModSettings: mod="${mod}", game="${game ? game.name : 'undefined'}"`);
    }
    
    // Tab styles update
    const tabDlss = document.getElementById('tab-dlss-enabler');
    const tabOpti = document.getElementById('tab-optiscaler');
    if (mod === 'dlss-enabler') {
        if (tabDlss) {
            tabDlss.style.opacity = '1';
            tabDlss.style.borderWidth = '2px';
        }
        if (tabOpti) {
            tabOpti.style.opacity = '0.5';
            tabOpti.style.borderWidth = '1px';
        }
    } else {
        if (tabOpti) {
            tabOpti.style.opacity = '1';
            tabOpti.style.borderWidth = '2px';
        }
        if (tabDlss) {
            tabDlss.style.opacity = '0.5';
            tabDlss.style.borderWidth = '1px';
        }
    }

    const contentDiv = document.getElementById('settings-content');
    contentDiv.innerHTML = '<div style="color:var(--text-secondary);">Yükleniyor...</div>';
    hideError();

    try {
        console.log('[RENDERER settings.js] invoking window.electronAPI.readModIni...');
        const result = await window.electronAPI.readModIni(game, mod);
        console.log('[RENDERER settings.js] readModIni result:', JSON.stringify(result, null, 2));
        if (window.electronAPI && window.electronAPI.logToMain) {
            window.electronAPI.logToMain(`[RENDERER settings.js] readModIni result exists: ${result.exists}`);
        }
        
        if (!result.exists) {
            console.log('[RENDERER settings.js] INI file does not exist, showing warning in UI.');
            contentDiv.innerHTML = `
                <div style="text-align: center; color: var(--text-secondary); padding: 30px;">
                    <div style="font-size: 32px; margin-bottom: 10px;">⚠️</div>
                    <div style="font-size: 14px;">Henüz INI dosyası oluşturulmadı.<br>Oyunu bir kez başlatırsanız dosya otomatik oluşacaktır.</div>
                </div>`;
            currentSettingsData = {};
            document.getElementById('settings-save-btn').disabled = true;
            document.getElementById('settings-save-btn').style.opacity = '0.5';
            return;
        }

        console.log('[RENDERER settings.js] INI file exists, enabling save button and rendering settings UI.');
        document.getElementById('settings-save-btn').disabled = false;
        document.getElementById('settings-save-btn').style.opacity = '1';
        
        currentSettingsData = result.data;
        renderSettingsUI(mod, currentSettingsData);
        
    } catch (err) {
        console.error('[RENDERER settings.js] error in loadModSettings:', err);
        if (window.electronAPI && window.electronAPI.logToMain) {
            window.electronAPI.logToMain(`[RENDERER settings.js] error in loadModSettings: ${err.message}`);
        }
        showError('Hata: ' + err.message);
        contentDiv.innerHTML = '';
    }
}

function findSchemaSection(schema, sectionName) {
    const target = sectionName.toLowerCase();
    for (const [key, val] of Object.entries(schema)) {
        if (key.toLowerCase() === target) {
            return { key, val };
        }
    }
    return null;
}

function findSchemaKey(sectionSchema, keyName) {
    const target = keyName.toLowerCase();
    for (const [key, val] of Object.entries(sectionSchema)) {
        if (key.toLowerCase() === target) {
            return { key, val };
        }
    }
    return null;
}

function renderSettingsUI(mod, data) {
    const contentDiv = document.getElementById('settings-content');
    contentDiv.innerHTML = '';
    
    const schema = mod === 'dlss-enabler' ? DLSS_ENABLER_SCHEMA : OPTISCALER_SCHEMA;
    
    // Iterate over sections in data
    for (const [section, keys] of Object.entries(data)) {
        const schemaSectionMatch = findSchemaSection(schema, section);
        if (!schemaSectionMatch) continue;
        
        const sectionSchema = schemaSectionMatch.val;
        const schemaSectionKey = schemaSectionMatch.key;
        
        // Filter and map keys case-insensitively
        const keysToShow = [];
        for (const [key, val] of Object.entries(keys)) {
            const schemaKeyMatch = findSchemaKey(sectionSchema, key);
            if (schemaKeyMatch) {
                keysToShow.push({
                    rawKey: key,
                    schemaKey: schemaKeyMatch.key,
                    value: val,
                    def: schemaKeyMatch.val
                });
            }
        }
        
        if (keysToShow.length === 0) continue;
        
        const sectionEl = document.createElement('div');
        sectionEl.style.background = 'rgba(255,255,255,0.02)';
        sectionEl.style.padding = '15px';
        sectionEl.style.borderRadius = '8px';
        sectionEl.style.border = '1px solid rgba(255,255,255,0.05)';
        
        const titleEl = document.createElement('h3');
        titleEl.textContent = `[${schemaSectionKey}]`;
        titleEl.style.marginTop = '0';
        titleEl.style.marginBottom = '15px';
        titleEl.style.color = 'var(--accent-color)';
        titleEl.style.fontSize = '15px';
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
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '6px';
    wrapper.style.minWidth = '0'; // Prevent grid blowout
    
    const label = document.createElement('label');
    label.textContent = def.label || key;
    label.style.fontSize = '12px';
    label.style.color = 'var(--text-secondary)';
    label.style.fontWeight = 'bold';
    label.title = key; // hover to see raw key name
    label.style.whiteSpace = 'nowrap';
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';
    wrapper.appendChild(label);
    
    if (def.type === 'toggle') {
        const select = document.createElement('select');
        select.className = 'dlss-select-box';
        select.style.padding = '8px';
        select.style.background = 'rgba(0,0,0,0.3)';
        select.style.border = '1px solid rgba(255,255,255,0.1)';
        select.style.color = 'white';
        select.style.borderRadius = '4px';
        select.style.width = '100%';
        select.style.boxSizing = 'border-box';
        select.style.minWidth = '0';
        
        const optTrue = document.createElement('option');
        optTrue.value = 'true';
        optTrue.textContent = 'Açık';
        const optFalse = document.createElement('option');
        optFalse.value = 'false';
        optFalse.textContent = 'Kapalı';
        
        select.appendChild(optTrue);
        select.appendChild(optFalse);
        
        // currentValue true/false or 'true'/'false' string
        if (currentValue === true || String(currentValue).toLowerCase() === 'true') select.value = 'true';
        else select.value = 'false';
        
        select.addEventListener('change', () => {
            currentSettingsData[section][key] = select.value === 'true';
        });
        wrapper.appendChild(select);
        
    } else if (def.type === 'dropdown') {
        const select = document.createElement('select');
        select.className = 'dlss-select-box';
        select.style.padding = '8px';
        select.style.background = 'rgba(0,0,0,0.3)';
        select.style.border = '1px solid rgba(255,255,255,0.1)';
        select.style.color = 'white';
        select.style.borderRadius = '4px';
        select.style.width = '100%';
        select.style.boxSizing = 'border-box';
        select.style.minWidth = '0';
        
        for (const opt of def.options) {
            const optionEl = document.createElement('option');
            optionEl.value = opt.val;
            optionEl.textContent = opt.label;
            select.appendChild(optionEl);
        }
        
        select.value = String(currentValue);
        select.addEventListener('change', () => {
            let newVal = select.value;
            // auto-cast if numeric
            if (!isNaN(Number(newVal)) && newVal !== '') newVal = Number(newVal);
            currentSettingsData[section][key] = newVal;
        });
        wrapper.appendChild(select);
        
    } else if (def.type === 'slider') {
        const flexDiv = document.createElement('div');
        flexDiv.style.display = 'flex';
        flexDiv.style.alignItems = 'center';
        flexDiv.style.gap = '10px';
        flexDiv.style.width = '100%';
        flexDiv.style.minWidth = '0';
        
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = def.min;
        slider.max = def.max;
        slider.step = def.step;
        slider.value = currentValue;
        slider.style.flex = '1';
        slider.style.minWidth = '0';
        slider.style.width = '100%';
        
        const valDisplay = document.createElement('span');
        valDisplay.textContent = currentValue;
        valDisplay.style.fontSize = '12px';
        valDisplay.style.width = '30px';
        valDisplay.style.textAlign = 'right';
        valDisplay.style.flexShrink = '0';
        
        slider.addEventListener('input', () => {
            valDisplay.textContent = slider.value;
            currentSettingsData[section][key] = Number(slider.value);
        });
        
        flexDiv.appendChild(slider);
        flexDiv.appendChild(valDisplay);
        wrapper.appendChild(flexDiv);
        
    } else {
        // Fallback or explicit text
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentValue;
        input.style.padding = '8px';
        input.style.background = 'rgba(0,0,0,0.3)';
        input.style.border = '1px solid rgba(255,255,255,0.1)';
        input.style.color = 'white';
        input.style.borderRadius = '4px';
        input.style.width = '100%';
        input.style.boxSizing = 'border-box';
        input.style.minWidth = '0';
        
        input.addEventListener('input', () => {
            currentSettingsData[section][key] = input.value;
        });
        wrapper.appendChild(input);
    }
    
    return wrapper;
}

async function saveModSettings() {
    const game = state.currentSelectedGame;
    if (!game || !currentActiveMod) return;
    
    const btn = document.getElementById('settings-save-btn');
    const oldText = btn.textContent;
    btn.textContent = 'Kaydediliyor...';
    btn.disabled = true;
    hideError();
    
    try {
        const result = await window.electronAPI.writeModIni(game, currentActiveMod, currentSettingsData);
        if (result.success) {
            btn.style.backgroundColor = '#10b981'; // Green
            btn.textContent = 'Kaydedildi ✓';
            setTimeout(() => {
                btn.style.backgroundColor = '#3b82f6'; // Back to blue
                btn.textContent = oldText;
                btn.disabled = false;
            }, 2000);
        } else {
            throw new Error(result.error);
        }
    } catch (err) {
        showError(err.message);
        btn.textContent = oldText;
        btn.disabled = false;
    }
}

function showError(msg) {
    const errBanner = document.getElementById('settings-error-banner');
    if (errBanner) {
        errBanner.textContent = msg;
        errBanner.style.display = 'block';
    }
}

function hideError() {
    const errBanner = document.getElementById('settings-error-banner');
    if (errBanner) {
        errBanner.style.display = 'none';
    }
}
