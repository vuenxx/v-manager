/**
 * manifest-builder.js — V-Manager Manifest Yöneticisi & Oluşturucu UI
 * 
 * Dinamik Şema (schema), Şema Tabanlı Görsel Ön Ayarlar (presets) ve Görsel İlk Kurulum Değerleri (set)
 */

import { showInfoModal } from './modals/info.js';

let isEditorActive = false;
let validationDebounceTimer = null;
let currentEditingManifest = null;
let currentEditingType = 'custom'; // 'official' | 'community' | 'custom'
let allLoadedModules = [];
let activeFilter = 'all'; // 'all' | 'official' | 'community' | 'custom'
let searchQuery = '';

// Canlı Şema, Preset ve Set State'i
let currentSchemaObj = {};
let currentPresetsObj = {};
let currentSetObj = {};
let presetViewModes = {}; // { [presetId]: 'visual' | 'raw' }
let initialSetViewMode = 'visual'; // 'visual' | 'raw'
let expandedSchemaSections = new Set();
let expandedPresetGroups = {}; // { [presetId_sectionName]: boolean }
let expandedSetGroups = new Set(); // Set<sectionName>

export function initManifestBuilder() {
    // 1. Header Toolbar Actions: Yeni Oluştur & Yenile
    const startCreateBtn = document.getElementById('manifest-btn-start-create');
    if (startCreateBtn) {
        startCreateBtn.addEventListener('click', () => {
            openEditor(getEmptyTemplate(), 'custom');
        });
    }

    const emptyCreateBtn = document.getElementById('manifest-empty-create-btn');
    if (emptyCreateBtn) {
        emptyCreateBtn.addEventListener('click', () => {
            openEditor(getEmptyTemplate(), 'custom');
        });
    }

    const refreshBtn = document.getElementById('manifest-btn-refresh-list');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            await refreshManifestsList();
        });
    }

    // 2. Search Box Listener
    const searchInput = document.getElementById('manifest-search-input');
    const searchClear = document.getElementById('manifest-search-clear');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            searchQuery = searchInput.value.trim().toLowerCase();
            if (searchClear) searchClear.style.display = searchQuery ? 'block' : 'none';
            renderFilteredCards();
        });
    }

    if (searchClear) {
        searchClear.addEventListener('click', () => {
            if (searchInput) {
                searchInput.value = '';
                searchQuery = '';
                searchClear.style.display = 'none';
                renderFilteredCards();
            }
        });
    }

    // 3. Category Filter Chips
    const filterChips = document.querySelectorAll('.manifest-chip');
    filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            filterChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeFilter = chip.dataset.filter || 'all';
            renderFilteredCards();
        });
    });

    // 4. Editor View Actions: Geri Dön, Kaydet, Çatalla (Fork)
    const backBtn = document.getElementById('manifest-btn-back');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            closeEditor();
        });
    }

    const saveBtn = document.getElementById('manifest-btn-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            saveCurrentManifest();
        });
    }

    const forkBtn = document.getElementById('manifest-btn-fork');
    if (forkBtn) {
        forkBtn.addEventListener('click', () => {
            forkCurrentManifestAsCustom();
        });
    }

    const noticeForkLink = document.getElementById('notice-fork-link');
    if (noticeForkLink) {
        noticeForkLink.addEventListener('click', () => {
            forkCurrentManifestAsCustom();
        });
    }

    // 5. Copy JSON Button
    const copyJsonBtn = document.getElementById('mb-copy-json-btn');
    if (copyJsonBtn) {
        copyJsonBtn.addEventListener('click', () => {
            const jsonText = document.getElementById('mb-json-code')?.textContent;
            if (jsonText) {
                navigator.clipboard.writeText(jsonText).then(() => {
                    copyJsonBtn.textContent = '✓ Kopyalandı';
                    setTimeout(() => { copyJsonBtn.textContent = '📋 Kopyala'; }, 1500);
                });
            }
        });
    }

    // 6. Destination Change (Dynamic Search Panel)
    const destSelect = document.getElementById('mb-destination');
    const dynSearchPanel = document.getElementById('mb-dynamic-search-panel');
    if (destSelect && dynSearchPanel) {
        destSelect.addEventListener('change', () => {
            dynSearchPanel.style.display = destSelect.value === 'dynamic_search' ? 'block' : 'none';
            triggerLiveUpdate();
        });
    }

    // 6b. Proxy Detection Toggle
    const proxyToggle = document.getElementById('mb-proxy-enable');
    const proxyFields = document.getElementById('mb-proxy-fields');
    if (proxyToggle && proxyFields) {
        proxyToggle.addEventListener('change', () => {
            proxyFields.style.display = proxyToggle.checked ? 'block' : 'none';
            triggerLiveUpdate();
        });
    }

    // 7. Config Format Switch (Placeholder update)
    const cfgFormatSelect = document.getElementById('mb-cfg-format');
    if (cfgFormatSelect) {
        cfgFormatSelect.addEventListener('change', () => {
            updateConfigSetPlaceholder(cfgFormatSelect.value);
            syncSetObjToRawText();
            triggerLiveUpdate();
        });
    }

    // 8. Card 4 Sub-Tabs Switcher (Visual Schema, Raw Schema, Presets, Set)
    const configSubtabBtns = document.querySelectorAll('.mb-config-subtab-btn');
    configSubtabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            configSubtabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            document.querySelectorAll('.mb-config-subpanel').forEach(p => {
                p.style.display = (p.id === targetId) ? 'flex' : 'none';
            });

            // Tab geçiş senkronizasyonu
            if (targetId === 'cfg-sub-raw-schema') {
                syncVisualToRawSchema();
            } else if (targetId === 'cfg-sub-visual-schema') {
                syncRawToVisualSchema();
            } else if (targetId === 'cfg-sub-presets') {
                renderPresets();
            } else if (targetId === 'cfg-sub-initial-set') {
                renderInitialSet();
            }
        });
    });

    // 9. Schema Builder Actions: Bölüm Ekle
    const addSectionBtn = document.getElementById('mb-btn-add-section');
    if (addSectionBtn) {
        addSectionBtn.addEventListener('click', () => {
            let count = 1;
            while (currentSchemaObj[`Section_${count}`]) {
                count++;
            }
            const newSecName = `Section_${count}`;
            currentSchemaObj[newSecName] = {};
            expandedSchemaSections.add(newSecName);
            renderVisualSchema();
            renderPresets();
            renderInitialSet();
            triggerLiveUpdate();

            setTimeout(() => {
                const inputs = document.querySelectorAll('.sec-name-input');
                if (inputs.length > 0) {
                    const lastInput = inputs[inputs.length - 1];
                    lastInput.focus();
                    lastInput.select();
                }
            }, 50);
        });
    }

    const formatRawSchemaBtn = document.getElementById('mb-btn-format-raw-schema');
    if (formatRawSchemaBtn) {
        formatRawSchemaBtn.addEventListener('click', () => {
            const rawEl = document.getElementById('mb-cfg-raw-schema');
            if (!rawEl) return;
            try {
                const parsed = JSON.parse(rawEl.value.trim() || '{}');
                rawEl.value = JSON.stringify(parsed, null, 2);
                currentSchemaObj = parsed;
                renderVisualSchema();
                renderPresets();
                renderInitialSet();
                triggerLiveUpdate();
            } catch (err) {
                alert('Geçersiz JSON formatı: ' + err.message);
            }
        });
    }

    const rawSchemaTextarea = document.getElementById('mb-cfg-raw-schema');
    if (rawSchemaTextarea) {
        rawSchemaTextarea.addEventListener('input', () => {
            try {
                const parsed = JSON.parse(rawSchemaTextarea.value.trim() || '{}');
                currentSchemaObj = parsed;
                renderVisualSchema();
                renderPresets();
                renderInitialSet();
            } catch (_) {}
            triggerLiveUpdate();
        });
    }

    // 10. Presets Builder Actions: Ön Ayar Ekle
    const addPresetBtn = document.getElementById('mb-btn-add-preset');
    if (addPresetBtn) {
        addPresetBtn.addEventListener('click', () => {
            let count = 1;
            while (currentPresetsObj[`preset_${count}`]) {
                count++;
            }
            const pId = `preset_${count}`;
            currentPresetsObj[pId] = {
                name: `Ön Ayar ${count}`,
                locked: false,
                values: {}
            };
            presetViewModes[pId] = 'visual';
            renderPresets();
            triggerLiveUpdate();

            setTimeout(() => {
                const presetInputs = document.querySelectorAll('.preset-name-input');
                if (presetInputs.length > 0) {
                    const lastInput = presetInputs[presetInputs.length - 1];
                    lastInput.focus();
                    lastInput.select();
                }
            }, 50);
        });
    }

    // 11. Initial Set Mini View Switcher (Visual vs Raw)
    const setBtnVisual = document.getElementById('mb-set-btn-visual');
    const setBtnRaw = document.getElementById('mb-set-btn-raw');
    const setVisualCont = document.getElementById('mb-initial-set-visual-container');
    const setRawCont = document.getElementById('mb-initial-set-raw-container');

    if (setBtnVisual && setBtnRaw) {
        setBtnVisual.addEventListener('click', () => {
            initialSetViewMode = 'visual';
            setBtnVisual.classList.add('active');
            setBtnRaw.classList.remove('active');
            if (setVisualCont) setVisualCont.style.display = 'block';
            if (setRawCont) setRawCont.style.display = 'none';
            renderInitialSet();
        });

        setBtnRaw.addEventListener('click', () => {
            initialSetViewMode = 'raw';
            setBtnRaw.classList.add('active');
            setBtnVisual.classList.remove('active');
            if (setVisualCont) setVisualCont.style.display = 'none';
            if (setRawCont) setRawCont.style.display = 'block';
            syncSetObjToRawText();
        });
    }

    const setRawTextarea = document.getElementById('mb-cfg-set');
    if (setRawTextarea) {
        setRawTextarea.addEventListener('input', () => {
            const parsed = parseConfigSetInput(setRawTextarea.value);
            if (parsed) {
                currentSetObj = parsed;
            }
            triggerLiveUpdate();
        });
    }

    // 12. Form Inputs Live Change Listener with 300ms Debounce & Input Sanitizers
    const mbIdInput = document.getElementById('mb-id');
    if (mbIdInput) {
        mbIdInput.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
            }
        });
        mbIdInput.addEventListener('input', () => {
            const sanitized = mbIdInput.value.toLowerCase().replace(/[^a-z0-9-_]/g, '').replace(/_+/g, '-');
            if (mbIdInput.value !== sanitized) {
                mbIdInput.value = sanitized;
            }
        });
    }

    const mbRepoInput = document.getElementById('mb-repo');
    if (mbRepoInput) {
        mbRepoInput.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
            }
        });
        const sanitizeRepo = () => {
            let v = mbRepoInput.value.trim();
            v = v.replace(/^https?:\/\/(www\.)?github\.com\//i, '')
                 .replace(/^git@github\.com:/i, '')
                 .replace(/\.git$/i, '')
                 .replace(/^\/+|\/+$/g, '');
            if (mbRepoInput.value !== v) {
                mbRepoInput.value = v;
            }
        };
        mbRepoInput.addEventListener('input', sanitizeRepo);
        mbRepoInput.addEventListener('paste', () => {
            setTimeout(() => {
                sanitizeRepo();
                triggerLiveUpdate(50);
            }, 0);
        });
    }

    const mbVersionInput = document.getElementById('mb-version');
    if (mbVersionInput) {
        mbVersionInput.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
            }
        });
        mbVersionInput.addEventListener('input', () => {
            const sanitized = mbVersionInput.value.replace(/[^0-9a-zA-Z.-]/g, '');
            if (mbVersionInput.value !== sanitized) {
                mbVersionInput.value = sanitized;
            }
        });
    }

    const mbAvDelayInput = document.getElementById('mb-av-delay');
    if (mbAvDelayInput) {
        mbAvDelayInput.addEventListener('keydown', (e) => {
            if (!/[0-9]/.test(e.key) && !['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
            }
        });
        mbAvDelayInput.addEventListener('input', () => {
            const sanitized = mbAvDelayInput.value.replace(/[^0-9]/g, '');
            if (mbAvDelayInput.value !== sanitized) {
                mbAvDelayInput.value = sanitized;
            }
        });
    }

    // 12b. Wizard Event Listeners
    const wizEnableCheckbox = document.getElementById('mb-wiz-enabled');
    const wizBody = document.getElementById('mb-wiz-body');
    const wizTypeSelect = document.getElementById('mb-wiz-type');
    const wizAutotestPanel = document.getElementById('mb-wiz-autotest-panel');

    if (wizEnableCheckbox) {
        wizEnableCheckbox.addEventListener('change', () => {
            if (wizBody) {
                wizBody.style.display = wizEnableCheckbox.checked ? 'block' : 'none';
            }
            triggerLiveUpdate();
        });
    }

    if (wizTypeSelect) {
        wizTypeSelect.addEventListener('change', () => {
            if (wizAutotestPanel) {
                wizAutotestPanel.style.display = wizTypeSelect.value === 'auto_test' ? 'block' : 'none';
            }
            triggerLiveUpdate();
        });
    }

    // Ek bileşen (addon) ekleme butonu — satırlar dinamik oluşturulduğu için
    // kendi dinleyicilerini buildAddonRow() içinde bağlar.
    const addonAddBtn = document.getElementById('mb-addon-add-btn');
    if (addonAddBtn) {
        addonAddBtn.addEventListener('click', () => {
            const list = document.getElementById('mb-addons-list');
            if (list) {
                list.appendChild(buildAddonRow({}));
                triggerLiveUpdate();
            }
        });
    }

    // Çakışan modül ekleme butonu — satırlar buildConflictRow() içinde kendi
    // dinleyicilerini bağlar (addon satırlarıyla aynı desen).
    const conflictAddBtn = document.getElementById('mb-conflict-add-btn');
    if (conflictAddBtn) {
        conflictAddBtn.addEventListener('click', () => {
            const list = document.getElementById('mb-conflicts-list');
            if (list) {
                list.appendChild(buildConflictRow({}));
                triggerLiveUpdate();
            }
        });
    }

    const formInputs = document.querySelectorAll('#manifest-builder-editor input, #manifest-builder-editor textarea, #manifest-builder-editor select');
    formInputs.forEach(input => {
        input.addEventListener('input', () => triggerLiveUpdate());
        input.addEventListener('change', () => triggerLiveUpdate());
    });

    // 13. Tab Switch Listener
    document.addEventListener('tab-activated', (e) => {
        if (e.detail && (e.detail.tabId === 'manifest-builder' || (e.detail.tabId === 'modes' && document.getElementById('mods-sub-builder')?.style.display !== 'none'))) {
            if (!isEditorActive) {
                loadManifestsList();
            }
        }
    });

    // İlk yükleme
    loadManifestsList();
}

/**
 * Varsayılan boş manifest şablonu
 */
/**
 * Ek bileşen (addon) satırlarını çizer.
 * Her satır BAŞKA bir modülün id'sini referans alır — repo/asset burada
 * tekrarlanmaz, ilgili modülün kendi manifest'inden çözülür.
 */
function renderAddonRows(addons = []) {
    const list = document.getElementById('mb-addons-list');
    if (!list) return;
    list.innerHTML = '';

    addons.forEach((a) => list.appendChild(buildAddonRow(a)));
}

function buildAddonRow(a = {}) {
    const row = document.createElement('div');
    row.className = 'mb-addon-row';
    row.style.cssText =
        'border:1px solid var(--border-color); border-radius:8px; padding:10px; ' +
        'background:var(--card-bg); display:flex; flex-direction:column; gap:8px;';

    // Referans verilebilecek modüller (kendisi hariç)
    const selfId = document.getElementById('mb-id')?.value?.trim();
    const options = (allLoadedModules || [])
        .filter(m => m.id && m.id !== selfId)
        .map(m => {
            const role = m.role || m.manifest?.role || 'mod';
            const sel = m.id === a.moduleId ? ' selected' : '';
            return `<option value="${m.id}"${sel}>${m.name || m.id}${role === 'addon' ? ' (eklenti)' : ''}</option>`;
        })
        .join('');

    row.innerHTML = `
        <div class="form-row-2">
            <div class="form-group" style="margin:0;">
                <label>Referans Modül <span class="req">*</span></label>
                <select class="mb-input mb-addon-module">
                    <option value="">— seçin —</option>
                    ${options}
                </select>
            </div>
            <div class="form-group" style="margin:0;">
                <label>Hedef Klasör <small>(game_exe veya alt klasör)</small></label>
                <input type="text" class="mb-input mb-addon-dest" value="${a.install?.destination || 'game_exe'}" placeholder="game_exe / plugins">
            </div>
        </div>
        <div class="form-row-2">
            <div class="form-group" style="margin:0;">
                <label>Dosya Filtresi <small>(virgülle)</small></label>
                <input type="text" class="mb-input mb-addon-include" value="${(a.install?.files?.include || []).join(', ')}" placeholder="*.dll, *.asi">
            </div>
            <div class="form-group" style="margin:0;">
                <label>Yeniden Adlandır <small>(tek dosyaysa)</small></label>
                <input type="text" class="mb-input mb-addon-rename" value="${a.install?.renameTo || ''}" placeholder="OptiPatcher.asi">
            </div>
        </div>
        <div class="form-group" style="margin:0;">
            <label>Etiket <small>(kullanıcıya gösterilen ad)</small></label>
            <input type="text" class="mb-input mb-addon-label" value="${a.label || ''}" placeholder="OptiPatcher">
        </div>
        <div class="form-group" style="margin:0;">
            <label>Config Değişiklikleri <small>(Bolum.Anahtar=deger, her satıra bir tane)</small></label>
            <textarea class="mb-textarea mb-addon-config" rows="2" placeholder="Plugins.LoadAsiPlugins=true">${
                Object.entries(a.configChanges || {}).map(([k, v]) => `${k}=${v}`).join('\n')
            }</textarea>
        </div>
        <label style="display:flex; align-items:center; gap:6px; font-size:12px;">
            <input type="checkbox" class="mb-addon-default"${a.default ? ' checked' : ''}>
            Varsayılan olarak işaretli gelsin
        </label>
        <button type="button" class="mb-btn-danger mb-addon-remove" style="align-self:flex-start;">Kaldır</button>
    `;

    row.querySelector('.mb-addon-remove')?.addEventListener('click', () => {
        row.remove();
        triggerLiveUpdate();
    });
    row.querySelectorAll('input, select, textarea').forEach(el => {
        el.addEventListener('input', () => triggerLiveUpdate());
        el.addEventListener('change', () => triggerLiveUpdate());
    });

    return row;
}

/** Form satırlarından addons dizisini toplar. */
function collectAddonsFromForm() {
    const list = document.getElementById('mb-addons-list');
    if (!list) return [];

    const addons = [];
    list.querySelectorAll('.mb-addon-row').forEach(row => {
        const moduleId = row.querySelector('.mb-addon-module')?.value?.trim();
        if (!moduleId) return; // referanssız satır yazılmaz

        const dest = row.querySelector('.mb-addon-dest')?.value?.trim() || 'game_exe';
        const include = (row.querySelector('.mb-addon-include')?.value || '')
            .split(',').map(s => s.trim()).filter(Boolean);
        const renameTo = row.querySelector('.mb-addon-rename')?.value?.trim();
        const label = row.querySelector('.mb-addon-label')?.value?.trim();
        const isDefault = row.querySelector('.mb-addon-default')?.checked || false;

        const configChanges = {};
        (row.querySelector('.mb-addon-config')?.value || '')
            .split('\n').map(l => l.trim()).filter(Boolean)
            .forEach(line => {
                const i = line.indexOf('=');
                if (i > 0) configChanges[line.slice(0, i).trim()] = line.slice(i + 1).trim();
            });

        const entry = { moduleId };
        if (label) entry.label = label;
        if (isDefault) entry.default = true;

        const install = { destination: dest };
        if (include.length > 0) install.files = { include };
        if (renameTo) install.renameTo = renameTo;
        entry.install = install;

        if (Object.keys(configChanges).length > 0) entry.configChanges = configChanges;

        addons.push(entry);
    });

    return addons;
}

/**
 * Çakışan modül (conflicts) satırlarını çizer.
 * `manifest.conflicts` string dizisi de olabilir; ikisi de aynı satıra düşer.
 */
function renderConflictRows(conflicts = []) {
    const list = document.getElementById('mb-conflicts-list');
    if (!list) return;
    list.innerHTML = '';

    (Array.isArray(conflicts) ? conflicts : []).forEach(c => {
        const entry = typeof c === 'string' ? { moduleId: c } : (c || {});
        list.appendChild(buildConflictRow(entry));
    });
}

function buildConflictRow(c = {}) {
    const row = document.createElement('div');
    row.className = 'mb-conflict-row';
    row.style.cssText =
        'border:1px solid var(--border-color); border-radius:8px; padding:10px; ' +
        'background:var(--card-bg); display:flex; flex-direction:column; gap:8px;';

    const selfId = document.getElementById('mb-id')?.value?.trim();
    const options = (allLoadedModules || [])
        .filter(m => m.id && m.id !== selfId)
        .map(m => {
            const sel = m.id === c.moduleId ? ' selected' : '';
            return `<option value="${m.id}"${sel}>${m.name || m.id}</option>`;
        })
        .join('');

    row.innerHTML = `
        <div class="form-row-2">
            <div class="form-group" style="margin:0;">
                <label>Çakışan Modül <span class="req">*</span></label>
                <select class="mb-input mb-conflict-module">
                    <option value="">— seçin —</option>
                    ${options}
                </select>
            </div>
            <div class="form-group" style="margin:0;">
                <label>Sertlik <small>(block: kurulumu durdurur)</small></label>
                <select class="mb-input mb-conflict-severity">
                    <option value="block"${c.severity !== 'warn' ? ' selected' : ''}>block — kurulumu engelle</option>
                    <option value="warn"${c.severity === 'warn' ? ' selected' : ''}>warn — yalnızca uyar</option>
                </select>
            </div>
        </div>
        <div class="form-group" style="margin:0;">
            <label>Uyarı Metni <small>(boşsa standart metin kullanılır)</small></label>
            <input type="text" class="mb-input mb-conflict-message" value="${c.message || ''}" placeholder="OptiScaler ile çakışıyor, lütfen önce o modu kaldırın">
        </div>
        <label style="display:flex; align-items:center; gap:6px; font-size:12px;">
            <input type="checkbox" class="mb-conflict-enabled"${c.enabled === false ? '' : ' checked'}>
            Etkin (kapalıysa bu kural hiç işletilmez)
        </label>
        <button type="button" class="mb-btn-danger mb-conflict-remove" style="align-self:flex-start;">Kaldır</button>
    `;

    row.querySelector('.mb-conflict-remove')?.addEventListener('click', () => {
        row.remove();
        triggerLiveUpdate();
    });
    row.querySelectorAll('input, select, textarea').forEach(el => {
        el.addEventListener('input', () => triggerLiveUpdate());
        el.addEventListener('change', () => triggerLiveUpdate());
    });

    return row;
}

/** Form satırlarından conflicts dizisini toplar. */
function collectConflictsFromForm() {
    const list = document.getElementById('mb-conflicts-list');
    if (!list) return [];

    const conflicts = [];
    list.querySelectorAll('.mb-conflict-row').forEach(row => {
        const moduleId = row.querySelector('.mb-conflict-module')?.value?.trim();
        if (!moduleId) return; // referanssız satır yazılmaz

        const entry = { moduleId };

        const severity = row.querySelector('.mb-conflict-severity')?.value;
        if (severity === 'warn') entry.severity = 'warn';

        const message = row.querySelector('.mb-conflict-message')?.value?.trim();
        if (message) entry.message = message;

        if (row.querySelector('.mb-conflict-enabled')?.checked === false) entry.enabled = false;

        conflicts.push(entry);
    });

    return conflicts;
}

function getEmptyTemplate() {
    return {
        id: '',
        name: '',
        description: '',
        author: '',
        version: '1.0.0',
        role: 'mod',
        source: {
            type: 'github',
            repo: '',
            release: 'latest',
            asset: '*.zip'
        },
        install: {
            destination: 'game_exe',
            extractRoot: 'auto',
            cleanStaleVersionFiles: true,
            refreshGameOnComplete: true
        },
        config: [
            {
                file: '',
                format: 'ini',
                search: [],
                createIfMissing: false,
                required: false,
                schema: {},
                presets: {},
                set: {}
            }
        ]
    };
}

/**
 * Manifest listesini yükle ve grid'e aktar
 */
export async function loadManifestsList() {
    if (!window.electronAPI || !window.electronAPI.moduleList) return;

    try {
        const modules = await window.electronAPI.moduleList();
        
        const detailedModules = [];
        for (const mod of modules) {
            try {
                const info = await window.electronAPI.moduleGetInfo(mod.id);
                if (info && info.success && info.module) {
                    detailedModules.push({
                        ...mod,
                        manifest: info.module.manifest,
                        type: info.module.type || mod.type || 'official'
                    });
                } else {
                    detailedModules.push(mod);
                }
            } catch {
                detailedModules.push(mod);
            }
        }

        allLoadedModules = detailedModules;
        updateCountsAndBadges();
        renderFilteredCards();
        document.dispatchEvent(new CustomEvent('manifests-updated', { detail: { modules: allLoadedModules } }));
    } catch (e) {
        console.error('[MANIFEST_BUILDER] Manifest listesi yüklenemedi:', e);
    }
}

/**
 * Yenile butonu tıklandığında diskteki modülleri anında yeniden tara
 */
async function refreshManifestsList() {
    const refreshBtn = document.getElementById('manifest-btn-refresh-list');
    const icon = refreshBtn?.querySelector('.manifest-refresh-icon');

    if (icon) icon.classList.add('spinning');
    if (refreshBtn) refreshBtn.disabled = true;

    try {
        if (window.electronAPI && window.electronAPI.moduleReload) {
            await window.electronAPI.moduleReload();
        }
        await loadManifestsList();
    } catch (e) {
        console.error('[MANIFEST_BUILDER] Reload hatası:', e);
    } finally {
        setTimeout(() => {
            if (icon) icon.classList.remove('spinning');
            if (refreshBtn) refreshBtn.disabled = false;
        }, 400);
    }
}

/**
 * Filtre sayaçlarını güncelle
 */
function updateCountsAndBadges() {
    const totalCount = allLoadedModules.length;
    const officialCount = allLoadedModules.filter(m => m.type === 'official').length;
    const communityCount = allLoadedModules.filter(m => m.type === 'community').length;
    const customCount = allLoadedModules.filter(m => m.type === 'custom').length;

    const countBadge = document.getElementById('manifest-count-badge');
    if (countBadge) countBadge.textContent = `${totalCount} Modül`;

    const elAll = document.getElementById('count-all');
    if (elAll) elAll.textContent = totalCount;

    const elOff = document.getElementById('count-official');
    if (elOff) elOff.textContent = officialCount;

    const elCom = document.getElementById('count-community');
    if (elCom) elCom.textContent = communityCount;

    const elCus = document.getElementById('count-custom');
    if (elCus) elCus.textContent = customCount;
}

/**
 * Filtrelenmiş ve arama yapılmış manifest kartlarını render et
 */
function renderFilteredCards() {
    const grid = document.getElementById('manifest-cards-grid');
    const emptyState = document.getElementById('manifest-empty-state');
    if (!grid) return;

    grid.innerHTML = '';

    const filtered = allLoadedModules.filter(mod => {
        if (activeFilter !== 'all' && mod.type !== activeFilter) {
            return false;
        }

        if (searchQuery) {
            const matchName = (mod.name || '').toLowerCase().includes(searchQuery);
            const matchId = (mod.id || '').toLowerCase().includes(searchQuery);
            const matchAuthor = (mod.author || '').toLowerCase().includes(searchQuery);
            const matchRepo = (mod.source?.repo || '').toLowerCase().includes(searchQuery);
            const matchDesc = (mod.description || '').toLowerCase().includes(searchQuery);
            return matchName || matchId || matchAuthor || matchRepo || matchDesc;
        }

        return true;
    });

    if (filtered.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    filtered.forEach(mod => {
        const card = document.createElement('div');
        card.className = 'manifest-card';

        const typeLabel = mod.type === 'official' ? '🛡️ Resmi' : (mod.type === 'community' ? '👥 Topluluk' : '⚡ Özel');
        const badgeClass = mod.type === 'official' ? 'badge-official' : (mod.type === 'community' ? 'badge-community' : 'badge-custom');
        const dest = mod.manifest?.install?.destination || 'game_exe';
        const hasConfig = (mod.manifest?.config && (Array.isArray(mod.manifest.config) ? mod.manifest.config.length > 0 : !!mod.manifest.config.file));
        const configFile = hasConfig ? (Array.isArray(mod.manifest.config) ? mod.manifest.config[0].file : mod.manifest.config.file) : null;

        card.innerHTML = `
            <div class="manifest-card-top">
                <span class="manifest-type-badge ${badgeClass}">${typeLabel}</span>
                <span class="manifest-version-badge">v${mod.version || mod.manifest?.version || '1.0.0'}</span>
            </div>
            <div class="manifest-card-header">
                <h4 class="manifest-card-title">${mod.name || mod.id}</h4>
                <span class="manifest-card-id">#${mod.id}</span>
            </div>
            <p class="manifest-card-desc">${mod.description || mod.manifest?.description || 'Açıklama belirtilmemiş.'}</p>
            <div class="manifest-card-meta-chips">
                <span class="manifest-meta-chip" title="GitHub Deposu">📦 ${mod.source?.repo || mod.manifest?.source?.repo || 'Repo Yok'}</span>
                <span class="manifest-meta-chip" title="Kurulum Hedefi">🎯 ${dest}</span>
                ${configFile ? `<span class="manifest-meta-chip" title="Yapılandırma Dosyası">⚙️ ${configFile}</span>` : ''}
                ${mod.manifest?.wizard ? `<span class="manifest-meta-chip" title="Kurulum Sihirbazı Tanımlı" style="color: var(--accent-color); border-color: rgba(59, 130, 246, 0.35);">🧙‍♂️ Sihirbaz</span>` : ''}
            </div>
            <div class="manifest-card-actions">
                <button class="mb-btn-edit" data-id="${mod.id}" title="Manifesti düzenle veya incele">✏️ Düzenle / İncele</button>
                <button class="mb-btn-copy" data-id="${mod.id}" title="Raw JSON kopyala">📋 JSON</button>
                ${mod.type === 'custom' ? `<button class="mb-btn-delete" data-id="${mod.id}" title="Özel manifesti sil">🗑️ Sil</button>` : ''}
            </div>
        `;

        // 1. Düzenle / İncele Butonu
        card.querySelector('.mb-btn-edit')?.addEventListener('click', async () => {
            const manifestData = mod.manifest || (await window.electronAPI.moduleGetInfo(mod.id))?.module?.manifest;
            if (manifestData) {
                openEditor(manifestData, mod.type);
            }
        });

        // 2. JSON Kopyala Butonu
        const copyBtn = card.querySelector('.mb-btn-copy');
        copyBtn?.addEventListener('click', async () => {
            const manifestData = mod.manifest || (await window.electronAPI.moduleGetInfo(mod.id))?.module?.manifest;
            if (manifestData) {
                navigator.clipboard.writeText(JSON.stringify(manifestData, null, 2)).then(() => {
                    const originalText = copyBtn.innerHTML;
                    copyBtn.innerHTML = '✓ Kopyalandı';
                    setTimeout(() => { copyBtn.innerHTML = originalText; }, 1500);
                });
            }
        });

        // 3. Sil Butonu (Yalnızca Custom modüller için)
        card.querySelector('.mb-btn-delete')?.addEventListener('click', async () => {
            if (confirm(`'${mod.name}' (#${mod.id}) özel manifestini silmek istediğinize emin misiniz?`)) {
                try {
                    const delResult = await window.electronAPI.moduleDeleteCustomManifest(mod.id);
                    if (delResult && delResult.success) {
                        await loadManifestsList();
                    } else {
                        showInfoModal('Silme Hatası', delResult?.error || 'Silinemedi.', true);
                    }
                } catch (err) {
                    showInfoModal('Hata', err.message, true);
                }
            }
        });

        grid.appendChild(card);
    });
}

/**
 * Editörü aç ve veriyi form alanlarına doldur
 */
export function openEditor(manifest = null, moduleType = 'custom') {
    isEditorActive = true;
    currentEditingManifest = manifest || getEmptyTemplate();
    currentEditingType = moduleType || 'custom';
    expandedSchemaSections.clear();
    expandedPresetGroups = {};
    expandedSetGroups.clear();

    const welcomeView = document.getElementById('manifest-builder-welcome');
    const editorView = document.getElementById('manifest-builder-editor');
    const heading = document.getElementById('manifest-editor-heading');
    const typeBadge = document.getElementById('manifest-editor-type-badge');
    const subtitle = document.getElementById('manifest-editor-subtitle');
    const officialNotice = document.getElementById('manifest-official-notice');
    const forkBtn = document.getElementById('manifest-btn-fork');

    if (welcomeView) welcomeView.style.display = 'none';
    if (editorView) editorView.style.display = 'block';

    const isOfficialOrCommunity = currentEditingType === 'official' || currentEditingType === 'community';

    if (heading) {
        heading.textContent = currentEditingManifest.id 
            ? `Manifest Düzenle: ${currentEditingManifest.name || currentEditingManifest.id}` 
            : 'Yeni Manifest Tasarımı';
    }

    if (typeBadge) {
        typeBadge.style.display = 'inline-block';
        if (currentEditingType === 'official') {
            typeBadge.textContent = '🛡️ Resmi Modül';
            typeBadge.className = 'manifest-type-badge badge-official';
        } else if (currentEditingType === 'community') {
            typeBadge.textContent = '👥 Topluluk Modülü';
            typeBadge.className = 'manifest-type-badge badge-community';
        } else {
            typeBadge.textContent = '⚡ Özel Manifest';
            typeBadge.className = 'manifest-type-badge badge-custom';
        }
    }

    if (subtitle) {
        subtitle.textContent = isOfficialOrCommunity 
            ? 'Bu manifest resmi dahili kütüphaneden okunmaktadır. Özelleştirmek için "Özel Kopya Olarak Çatalla" seçeneğini kullanabilirsiniz.' 
            : 'Bu manifest %AppData% dizinindeki özel modül kütüphanenize kaydedilecektir.';
    }

    if (officialNotice) {
        officialNotice.style.display = isOfficialOrCommunity ? 'flex' : 'none';
    }

    if (forkBtn) {
        forkBtn.style.display = isOfficialOrCommunity ? 'inline-flex' : 'none';
    }

    // Formu doldur
    populateForm(currentEditingManifest);

    // Canlı JSON ve doğrulamayı güncelle
    triggerLiveUpdate(0);
}

/**
 * Editörü kapatıp ana karşılama / liste ekranına dön
 */
export function closeEditor() {
    isEditorActive = false;
    currentEditingManifest = null;

    const welcomeView = document.getElementById('manifest-builder-welcome');
    const editorView = document.getElementById('manifest-builder-editor');

    if (welcomeView) welcomeView.style.display = 'block';
    if (editorView) editorView.style.display = 'none';

    // Listeyi tazele
    loadManifestsList();
}

/**
 * Resmi veya topluluk modülünü anında düzenlenebilir özel bir kopyaya dönüştür
 */
function forkCurrentManifestAsCustom() {
    const idInput = document.getElementById('mb-id');
    const nameInput = document.getElementById('mb-name');

    if (idInput) {
        const rawId = idInput.value.trim();
        idInput.value = rawId.endsWith('-custom') ? rawId : `${rawId}-custom`;
    }

    if (nameInput) {
        const rawName = nameInput.value.trim();
        if (!rawName.includes('(Özel)')) {
            nameInput.value = `${rawName} (Özel)`;
        }
    }

    currentEditingType = 'custom';

    const typeBadge = document.getElementById('manifest-editor-type-badge');
    if (typeBadge) {
        typeBadge.textContent = '⚡ Özel Manifest';
        typeBadge.className = 'manifest-type-badge badge-custom';
    }

    const officialNotice = document.getElementById('manifest-official-notice');
    if (officialNotice) officialNotice.style.display = 'none';

    const forkBtn = document.getElementById('manifest-btn-fork');
    if (forkBtn) forkBtn.style.display = 'none';

    const subtitle = document.getElementById('manifest-editor-subtitle');
    if (subtitle) {
        subtitle.textContent = 'Bu manifest %AppData% dizinindeki özel modül kütüphanenize kaydedilecektir.';
    }

    triggerLiveUpdate(0);
}

/**
 * Form alanlarını manifest objesiyle doldur
 */
function populateForm(m) {
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val !== undefined && val !== null ? val : '';
    };

    setVal('mb-id', m.id || '');
    setVal('mb-name', m.name || '');
    setVal('mb-desc', m.description || '');
    setVal('mb-author', m.author || '');
    setVal('mb-version', m.version || '1.0.0');

    setVal('mb-role', m.role || 'mod');

    // Source — asset tek glob veya glob dizisi olabilir
    setVal('mb-repo', m.source?.repo || '');
    setVal('mb-release', m.source?.release || 'latest');
    setVal('mb-asset', Array.isArray(m.source?.asset) ? m.source.asset.join(', ') : (m.source?.asset || '*.zip'));

    // Addons
    renderAddonRows(Array.isArray(m.addons) ? m.addons : []);

    // Conflicts — 'incompatible_mods' aynı şemanın takma adı
    renderConflictRows(m.conflicts || m.incompatible_mods || []);

    // Install
    const dest = typeof m.install?.destination === 'string' ? m.install.destination : (m.install?.destination?.type === 'relative' ? 'game_root' : 'game_exe');
    setVal('mb-destination', dest);
    setVal('mb-extract-root', m.install?.extractRoot || 'auto');
    setVal('mb-av-delay', m.install?.verifyAntiVirusDelayMs || 0);

    // Dynamic Search & Whitelist
    const dynSearchPanel = document.getElementById('mb-dynamic-search-panel');
    if (dest === 'dynamic_search') {
        if (dynSearchPanel) dynSearchPanel.style.display = 'block';
        const detFiles = m.install?.detection?.files;
        setVal('mb-det-files', Array.isArray(detFiles) ? detFiles.join(', ') : '');
        setVal('mb-det-strategy', m.install?.detection?.strategy || 'shallowest_directory');
        setVal('mb-det-fallback', m.install?.detection?.fallback || 'largest_executable_directory');
        const wlFiles = m.install?.whitelistFiles;
        setVal('mb-whitelist-files', Array.isArray(wlFiles) ? wlFiles.join(', ') : '');
    } else {
        if (dynSearchPanel) dynSearchPanel.style.display = 'none';
        setVal('mb-det-files', '');
        setVal('mb-det-strategy', 'shallowest_directory');
        setVal('mb-det-fallback', 'largest_executable_directory');
        setVal('mb-whitelist-files', '');
    }

    // Backup Strategy
    const backupStrat = m.backup?.strategy || (dest === 'dynamic_search' ? 'in_place_suffix' : 'folder');
    setVal('mb-backup-strategy', backupStrat);
    const backupRollbackEl = document.getElementById('mb-backup-rollback');
    if (backupRollbackEl) {
        backupRollbackEl.checked = m.backup?.rollbackOnFailure !== false;
    }

    const cleanStaleCheckbox = document.getElementById('mb-clean-stale');
    if (cleanStaleCheckbox) {
        cleanStaleCheckbox.checked = m.install?.cleanStaleVersionFiles !== false;
    }

    // Proxy Detection
    const proxyToggle = document.getElementById('mb-proxy-enable');
    const proxyFields = document.getElementById('mb-proxy-fields');
    if (m.install?.proxyDetection) {
        if (proxyToggle) proxyToggle.checked = true;
        if (proxyFields) proxyFields.style.display = 'block';
        setVal('mb-proxy-source', m.install.proxyDetection.sourceFile || 'version.dll');
        setVal('mb-proxy-default', m.install.proxyDetection.defaultTarget || 'dxgi.dll');
        setVal('mb-proxy-match', m.install.proxyDetection.descriptionMatch || '');
        setVal('mb-proxy-candidates', Array.isArray(m.install.proxyDetection.candidates) 
            ? m.install.proxyDetection.candidates.join(', ') 
            : 'version.dll, dxgi.dll, winmm.dll, dbghelp.dll, psapi.dll, winhttp.dll');
    } else {
        if (proxyToggle) proxyToggle.checked = false;
        if (proxyFields) proxyFields.style.display = 'none';
        setVal('mb-proxy-source', 'version.dll');
        setVal('mb-proxy-default', 'dxgi.dll');
        setVal('mb-proxy-match', '');
        setVal('mb-proxy-candidates', 'version.dll, dxgi.dll, winmm.dll, dbghelp.dll, psapi.dll, winhttp.dll');
    }

    // Config & Schema
    const configEntry = Array.isArray(m.config) ? (m.config[0] || {}) : (m.config || {});
    setVal('mb-cfg-file', configEntry.file || '');
    const cfgFormat = configEntry.format || 'ini';
    setVal('mb-cfg-format', cfgFormat);
    updateConfigSetPlaceholder(cfgFormat);

    // Advanced search, createIfMissing, required
    if (Array.isArray(configEntry.search)) {
        setVal('mb-cfg-search', configEntry.search.join(', '));
    } else {
        setVal('mb-cfg-search', '');
    }

    const createIfMissingEl = document.getElementById('mb-cfg-create-if-missing');
    if (createIfMissingEl) {
        createIfMissingEl.checked = configEntry.createIfMissing === true;
    }

    const requiredEl = document.getElementById('mb-cfg-required');
    if (requiredEl) {
        requiredEl.checked = configEntry.required === true;
    }

    // Schema State & Render
    currentSchemaObj = (configEntry.schema && typeof configEntry.schema === 'object' && !Array.isArray(configEntry.schema)) 
        ? JSON.parse(JSON.stringify(configEntry.schema)) 
        : {};
    syncVisualToRawSchema();
    renderVisualSchema();

    // Presets State & Render
    currentPresetsObj = (configEntry.presets && typeof configEntry.presets === 'object' && !Array.isArray(configEntry.presets))
        ? JSON.parse(JSON.stringify(configEntry.presets))
        : {};
    renderPresets();

    // Initial Set State & Render
    currentSetObj = (configEntry.set && typeof configEntry.set === 'object')
        ? JSON.parse(JSON.stringify(configEntry.set))
        : {};
    syncSetObjToRawText();
    renderInitialSet();

    // Wizard Setup
    const wizEnableCheckbox = document.getElementById('mb-wiz-enabled');
    const wizBody = document.getElementById('mb-wiz-body');
    const wizTypeSelect = document.getElementById('mb-wiz-type');
    const wizAutotestPanel = document.getElementById('mb-wiz-autotest-panel');

    if (m.wizard) {
        if (wizEnableCheckbox) wizEnableCheckbox.checked = true;
        if (wizBody) wizBody.style.display = 'block';
        
        const wType = m.wizard.type || 'auto_test';
        setVal('mb-wiz-type', wType);
        if (wizAutotestPanel) {
            wizAutotestPanel.style.display = wType === 'auto_test' ? 'block' : 'none';
        }

        setVal('mb-wiz-title', m.wizard.title || '');
        setVal('mb-wiz-desc', m.wizard.description || '');

        updateWizardPresetDropdown();
        setVal('mb-wiz-preset', m.wizard.applyPresetOnSuccess || '');

        if (m.wizard.autoTest) {
            const at = m.wizard.autoTest;
            setVal('mb-wiz-source-file', at.sourceFile || 'version.dll');
            setVal('mb-wiz-watch-file', at.watchFile || 'dlss-enabler.ini');
            setVal('mb-wiz-candidates', Array.isArray(at.candidates) ? at.candidates.join(', ') : 'version.dll, dxgi.dll, winmm.dll, dbghelp.dll, psapi.dll, winhttp.dll');
            setVal('mb-wiz-timeout', at.timeoutSeconds !== undefined ? at.timeoutSeconds : 10);
            setVal('mb-wiz-watch-loc', at.watchLocation || 'game_exe');

            const termGameEl = document.getElementById('mb-wiz-terminate-game');
            if (termGameEl) termGameEl.checked = at.autoTerminateGame !== false;

            const checkProcEl = document.getElementById('mb-wiz-check-process');
            if (checkProcEl) checkProcEl.checked = at.checkProcessRunning !== false;
        } else {
            setVal('mb-wiz-source-file', 'version.dll');
            setVal('mb-wiz-watch-file', 'dlss-enabler.ini');
            setVal('mb-wiz-candidates', 'version.dll, dxgi.dll, winmm.dll, dbghelp.dll, psapi.dll, winhttp.dll');
            setVal('mb-wiz-timeout', 10);
            setVal('mb-wiz-watch-loc', 'game_exe');
        }
    } else {
        if (wizEnableCheckbox) wizEnableCheckbox.checked = false;
        if (wizBody) wizBody.style.display = 'none';
        setVal('mb-wiz-type', 'auto_test');
        setVal('mb-wiz-title', '');
        setVal('mb-wiz-desc', '');
        updateWizardPresetDropdown();
        setVal('mb-wiz-preset', '');
        setVal('mb-wiz-source-file', 'version.dll');
        setVal('mb-wiz-watch-file', 'dlss-enabler.ini');
        setVal('mb-wiz-candidates', 'version.dll, dxgi.dll, winmm.dll, dbghelp.dll, psapi.dll, winhttp.dll');
        setVal('mb-wiz-timeout', 10);
        setVal('mb-wiz-watch-loc', 'game_exe');
        if (wizAutotestPanel) wizAutotestPanel.style.display = 'block';
    }

    // Uninstall
    if (Array.isArray(m.uninstall?.files)) {
        const fileNames = m.uninstall.files.map(f => typeof f === 'string' ? f : f.path).filter(Boolean);
        setVal('mb-un-files', fileNames.join(', '));
    } else {
        setVal('mb-un-files', '');
    }

    if (Array.isArray(m.uninstall?.verifiedDlls)) {
        const vNames = m.uninstall.verifiedDlls.map(f => typeof f === 'string' ? f : f.candidates ? f.candidates.join(',') : '').filter(Boolean);
        setVal('mb-un-verified', vNames.join(', '));
    } else {
        setVal('mb-un-verified', '');
    }
}

/**
 * Format seçimine göre placeholder güncelle
 */
function updateConfigSetPlaceholder(format) {
    const textarea = document.getElementById('mb-cfg-set');
    if (!textarea) return;
    if (format === 'ini') {
        textarea.placeholder = '[Frame-Gen]\nEnable=true\n\n[Anti-Ghosting]\nEnable=false';
    } else {
        textarea.placeholder = '{\n  "Frame-Gen": {\n    "Enable": true\n  },\n  "Anti-Ghosting": {\n    "Enable": false\n  }\n}';
    }
}

/**
 * Görsel Şema Nesnesini Raw Textarea'ya aktar
 */
function syncVisualToRawSchema() {
    const rawEl = document.getElementById('mb-cfg-raw-schema');
    if (rawEl) {
        rawEl.value = JSON.stringify(currentSchemaObj || {}, null, 2);
    }
}

/**
 * Raw Textarea'yı Görsel Şema Nesnesine aktar
 */
function syncRawToVisualSchema() {
    const rawEl = document.getElementById('mb-cfg-raw-schema');
    if (rawEl) {
        try {
            currentSchemaObj = JSON.parse(rawEl.value.trim() || '{}');
            renderVisualSchema();
            renderPresets();
            renderInitialSet();
        } catch (_) {}
    }
}

/**
 * currentSetObj'i Raw textarea'ya INI veya JSON olarak yaz
 */
function syncSetObjToRawText() {
    const textarea = document.getElementById('mb-cfg-set');
    if (!textarea) return;

    const format = document.getElementById('mb-cfg-format')?.value || 'ini';
    if (!currentSetObj || Object.keys(currentSetObj).length === 0) {
        textarea.value = '';
        return;
    }

    if (format === 'ini') {
        const iniLines = [];
        for (const [secOrKey, val] of Object.entries(currentSetObj)) {
            if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                iniLines.push(`[${secOrKey}]`);
                for (const [k, v] of Object.entries(val)) {
                    iniLines.push(`${k}=${v}`);
                }
                iniLines.push('');
            } else if (secOrKey.includes('.')) {
                const [sec, k] = secOrKey.split('.');
                iniLines.push(`[${sec}]`);
                iniLines.push(`${k}=${val}`);
                iniLines.push('');
            } else {
                iniLines.push(`${secOrKey}=${val}`);
            }
        }
        textarea.value = iniLines.join('\n').trim();
    } else {
        textarea.value = JSON.stringify(currentSetObj, null, 2);
    }
}

/**
 * Görsel Şema Ağacını DOM'a Çiz (Katlanabilir / Accordion Yapıda)
 */
function renderVisualSchema() {
    const container = document.getElementById('mb-schema-sections-container');
    if (!container) return;

    container.innerHTML = '';

    const sections = Object.entries(currentSchemaObj);
    if (sections.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding: 24px; color: var(--text-secondary); border: 1px dashed rgba(255,255,255,0.08); border-radius: 10px;">
                <div style="font-size: 24px; margin-bottom: 6px;">📐</div>
                <span style="font-size: 12px;">Henüz ayar bölümü tanımlanmadı. Yukarıdaki <strong>+ Bölüm Ekle</strong> butonuna tıklayarak yeni bir bölüm ekleyin.</span>
            </div>
        `;
        return;
    }

    sections.forEach(([secName, secData]) => {
        const secCard = document.createElement('div');
        const isExpanded = expandedSchemaSections.has(secName);
        secCard.className = `mb-schema-section-card ${isExpanded ? 'expanded' : ''}`;

        const keys = Object.entries(secData).filter(([k]) => k !== 'visibleIf');

        secCard.innerHTML = `
            <div class="mb-schema-section-header">
                <div class="mb-schema-section-title-box">
                    <span class="mb-accordion-arrow">▶</span>
                    <span>📁 [</span>
                    <input type="text" class="sec-name-input" value="${secName}" title="Bölüm Adını Düzenle" placeholder="BolumAdi">
                    <span>]</span>
                    <span class="mb-count-badge">${keys.length} Ayar</span>
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button type="button" class="mb-sub-add-btn add-key-btn" style="padding: 4px 10px; font-size: 11px;">+ Anahtar Ekle</button>
                    <button type="button" class="mb-delete-mini-btn del-sec-btn" title="Bölümü Sil">🗑️</button>
                </div>
            </div>
            <div class="mb-schema-keys-list">
                <!-- Keys will be rendered here -->
            </div>
        `;

        // Accordion Toggle
        const header = secCard.querySelector('.mb-schema-section-header');
        header?.addEventListener('click', (e) => {
            if (e.target.closest('.sec-name-input') || e.target.closest('.add-key-btn') || e.target.closest('.del-sec-btn')) {
                return;
            }
            if (expandedSchemaSections.has(secName)) {
                expandedSchemaSections.delete(secName);
                secCard.classList.remove('expanded');
            } else {
                expandedSchemaSections.add(secName);
                secCard.classList.add('expanded');
            }
        });

        // Bölüm Adı Değiştirme
        const secNameInput = secCard.querySelector('.sec-name-input');
        secNameInput?.addEventListener('change', () => {
            const newName = secNameInput.value.trim().replace(/[\[\]]/g, '');
            if (newName && newName !== secName) {
                if (!currentSchemaObj[newName]) {
                    currentSchemaObj[newName] = currentSchemaObj[secName];
                    delete currentSchemaObj[secName];

                    if (expandedSchemaSections.has(secName)) {
                        expandedSchemaSections.delete(secName);
                        expandedSchemaSections.add(newName);
                    }

                    // Preset ve Set değerlerini de güncelle
                    for (const pId of Object.keys(currentPresetsObj)) {
                        if (currentPresetsObj[pId].values && currentPresetsObj[pId].values[secName]) {
                            currentPresetsObj[pId].values[newName] = currentPresetsObj[pId].values[secName];
                            delete currentPresetsObj[pId].values[secName];
                        }
                    }
                    if (currentSetObj && currentSetObj[secName]) {
                        currentSetObj[newName] = currentSetObj[secName];
                        delete currentSetObj[secName];
                    }

                    renderVisualSchema();
                    renderPresets();
                    renderInitialSet();
                    triggerLiveUpdate();
                } else {
                    secNameInput.value = secName;
                }
            }
        });

        // Bölüm Silme
        secCard.querySelector('.del-sec-btn')?.addEventListener('click', () => {
            delete currentSchemaObj[secName];
            expandedSchemaSections.delete(secName);
            for (const pId of Object.keys(currentPresetsObj)) {
                if (currentPresetsObj[pId].values) {
                    delete currentPresetsObj[pId].values[secName];
                }
            }
            if (currentSetObj) {
                delete currentSetObj[secName];
            }
            renderVisualSchema();
            renderPresets();
            renderInitialSet();
            triggerLiveUpdate();
        });

        // Anahtar Ekleme
        secCard.querySelector('.add-key-btn')?.addEventListener('click', () => {
            let count = 1;
            const sec = currentSchemaObj[secName] || {};
            while (sec[`Key_${count}`]) {
                count++;
            }
            const newKeyName = `Key_${count}`;
            if (!currentSchemaObj[secName]) currentSchemaObj[secName] = {};
            currentSchemaObj[secName][newKeyName] = {
                type: 'toggle',
                label: `Ayar ${count}`
            };
            expandedSchemaSections.add(secName);
            renderVisualSchema();
            renderPresets();
            renderInitialSet();
            triggerLiveUpdate();

            setTimeout(() => {
                const keyInputs = secCard.querySelectorAll('.key-name-input');
                if (keyInputs.length > 0) {
                    const last = keyInputs[keyInputs.length - 1];
                    last.focus();
                    last.select();
                }
            }, 50);
        });

        // Bölüm Anahtarlarını Çiz
        const keysList = secCard.querySelector('.mb-schema-keys-list');

        if (keys.length === 0) {
            keysList.innerHTML = '<div style="font-size: 11px; color: var(--text-secondary); padding: 6px;">Bu bölüme henüz bir ayar anahtarı eklenmedi. <strong>+ Anahtar Ekle</strong> butonuna tıklayarak ekleyin.</div>';
        } else {
            keys.forEach(([keyName, keyDef]) => {
                const keyCard = document.createElement('div');
                keyCard.className = 'mb-schema-key-card';

                const curType = keyDef.type || 'toggle';
                const curLabel = keyDef.label || keyName;
                const curDefault = keyDef.displayDefault || '';

                keyCard.innerHTML = `
                    <div class="mb-schema-key-header">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 13px;">⚙️</span>
                            <input type="text" class="mb-input key-name-input" value="${keyName}" placeholder="Ayar Anahtarı (Key)" style="font-weight: 700; width: 170px; padding: 4px 8px; font-size: 12px;">
                        </div>
                        <button type="button" class="mb-delete-mini-btn del-key-btn" title="Anahtarı Sil">×</button>
                    </div>
                    <div class="mb-schema-key-grid">
                        <div>
                            <div class="mb-schema-mini-label">Görünen Etiket (Label):</div>
                            <input type="text" class="mb-input key-label-input" value="${curLabel}" placeholder="Görünen İsim">
                        </div>
                        <div>
                            <div class="mb-schema-mini-label">Kontrol Tipi:</div>
                            <select class="mb-select key-type-select">
                                <option value="toggle" ${curType === 'toggle' ? 'selected' : ''}>Aç/Kapa (Toggle)</option>
                                <option value="dropdown" ${curType === 'dropdown' ? 'selected' : ''}>Seçim Kutusu (Dropdown)</option>
                                <option value="slider" ${curType === 'slider' ? 'selected' : ''}>Kaydırıcı (Slider)</option>
                                <option value="text" ${curType === 'text' ? 'selected' : ''}>Metin / Değer (Text)</option>
                            </select>
                        </div>
                        <div>
                            <div class="mb-schema-mini-label">Varsayılan Görüntü (displayDefault):</div>
                            <input type="text" class="mb-input key-default-input" value="${curDefault}" placeholder="Örn: auto veya true">
                        </div>
                    </div>
                    <!-- Type Specific Settings -->
                    <div class="type-specific-container" style="margin-top: 6px;"></div>
                `;

                // Key Name Değişimi
                const keyNameInput = keyCard.querySelector('.key-name-input');
                keyNameInput?.addEventListener('change', () => {
                    const newK = keyNameInput.value.trim();
                    if (newK && newK !== keyName) {
                        if (!currentSchemaObj[secName][newK]) {
                            currentSchemaObj[secName][newK] = currentSchemaObj[secName][keyName];
                            delete currentSchemaObj[secName][keyName];

                            for (const pId of Object.keys(currentPresetsObj)) {
                                if (currentPresetsObj[pId].values && currentPresetsObj[pId].values[secName] && currentPresetsObj[pId].values[secName][keyName] !== undefined) {
                                    currentPresetsObj[pId].values[secName][newK] = currentPresetsObj[pId].values[secName][keyName];
                                    delete currentPresetsObj[pId].values[secName][keyName];
                                }
                            }

                            if (currentSetObj && currentSetObj[secName] && currentSetObj[secName][keyName] !== undefined) {
                                currentSetObj[secName][newK] = currentSetObj[secName][keyName];
                                delete currentSetObj[secName][keyName];
                            }

                            renderVisualSchema();
                            renderPresets();
                            renderInitialSet();
                            triggerLiveUpdate();
                        } else {
                            keyNameInput.value = keyName;
                        }
                    }
                });

                // Type Specific Controls Container
                const typeContainer = keyCard.querySelector('.type-specific-container');
                if (curType === 'dropdown') {
                    renderDropdownOptionsControl(typeContainer, secName, keyName, keyDef);
                } else if (curType === 'slider') {
                    renderSliderParamsControl(typeContainer, secName, keyName, keyDef);
                }

                // Label Değişimi
                keyCard.querySelector('.key-label-input')?.addEventListener('input', (e) => {
                    currentSchemaObj[secName][keyName].label = e.target.value;
                    renderPresets();
                    renderInitialSet();
                    triggerLiveUpdate();
                });

                // Default Değişimi
                keyCard.querySelector('.key-default-input')?.addEventListener('input', (e) => {
                    const val = e.target.value.trim();
                    if (val) {
                        currentSchemaObj[secName][keyName].displayDefault = val;
                    } else {
                        delete currentSchemaObj[secName][keyName].displayDefault;
                    }
                    triggerLiveUpdate();
                });

                // Tip Değişimi
                keyCard.querySelector('.key-type-select')?.addEventListener('change', (e) => {
                    const newType = e.target.value;
                    currentSchemaObj[secName][keyName].type = newType;
                    if (newType === 'dropdown' && !Array.isArray(currentSchemaObj[secName][keyName].options)) {
                        currentSchemaObj[secName][keyName].options = [
                            { val: 'auto', label: 'Varsayılan' },
                            { val: 'true', label: 'Açık' }
                        ];
                    } else if (newType === 'slider') {
                        currentSchemaObj[secName][keyName].min = 0;
                        currentSchemaObj[secName][keyName].max = 100;
                        currentSchemaObj[secName][keyName].step = 1;
                    }
                    renderVisualSchema();
                    renderPresets();
                    renderInitialSet();
                    triggerLiveUpdate();
                });

                // Anahtar Silme
                keyCard.querySelector('.del-key-btn')?.addEventListener('click', () => {
                    delete currentSchemaObj[secName][keyName];
                    for (const pId of Object.keys(currentPresetsObj)) {
                        if (currentPresetsObj[pId].values && currentPresetsObj[pId].values[secName]) {
                            delete currentPresetsObj[pId].values[secName][keyName];
                        }
                    }
                    if (currentSetObj && currentSetObj[secName]) {
                        delete currentSetObj[secName][keyName];
                    }
                    renderVisualSchema();
                    renderPresets();
                    renderInitialSet();
                    triggerLiveUpdate();
                });

                keysList.appendChild(keyCard);
            });
        }

        container.appendChild(secCard);
    });
}

/**
 * Dropdown seçenekleri kontrolü çizici
 */
function renderDropdownOptionsControl(container, secName, keyName, keyDef) {
    container.innerHTML = `
        <div style="background: rgba(0,0,0,0.25); border: 1px dashed rgba(255,255,255,0.08); border-radius: 8px; padding: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span class="mb-schema-mini-label" style="margin: 0;">Dropdown Seçenekleri:</span>
                <button type="button" class="mb-sub-add-btn add-opt-btn" style="padding: 2px 8px; font-size: 10px;">+ Seçenek Ekle</button>
            </div>
            <div class="options-list" style="display: flex; flex-direction: column; gap: 6px;"></div>
        </div>
    `;

    const optionsList = container.querySelector('.options-list');
    const options = Array.isArray(keyDef.options) ? keyDef.options : [];

    options.forEach((opt, idx) => {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; gap: 8px; align-items: center;';
        row.innerHTML = `
            <input type="text" class="mb-input opt-val" value="${opt.val !== undefined ? opt.val : ''}" placeholder="Değer (val)" style="flex: 1; padding: 6px 10px; font-size: 11px;">
            <input type="text" class="mb-input opt-label" value="${opt.label || ''}" placeholder="Etiket (label)" style="flex: 1.5; padding: 6px 10px; font-size: 11px;">
            <button type="button" class="mb-delete-mini-btn del-opt-btn" style="font-size: 12px;">×</button>
        `;

        row.querySelector('.opt-val')?.addEventListener('input', (e) => {
            currentSchemaObj[secName][keyName].options[idx].val = e.target.value;
            renderPresets();
            renderInitialSet();
            triggerLiveUpdate();
        });

        row.querySelector('.opt-label')?.addEventListener('input', (e) => {
            currentSchemaObj[secName][keyName].options[idx].label = e.target.value;
            renderPresets();
            renderInitialSet();
            triggerLiveUpdate();
        });

        row.querySelector('.del-opt-btn')?.addEventListener('click', () => {
            currentSchemaObj[secName][keyName].options.splice(idx, 1);
            renderVisualSchema();
            renderPresets();
            renderInitialSet();
            triggerLiveUpdate();
        });

        optionsList.appendChild(row);
    });

    container.querySelector('.add-opt-btn')?.addEventListener('click', () => {
        if (!Array.isArray(currentSchemaObj[secName][keyName].options)) {
            currentSchemaObj[secName][keyName].options = [];
        }
        currentSchemaObj[secName][keyName].options.push({ val: '', label: '' });
        renderVisualSchema();
        renderPresets();
        renderInitialSet();
        triggerLiveUpdate();
    });
}

/**
 * Slider parametreleri kontrolü çizici
 */
function renderSliderParamsControl(container, secName, keyName, keyDef) {
    container.innerHTML = `
        <div style="background: rgba(0,0,0,0.25); border: 1px dashed rgba(255,255,255,0.08); border-radius: 8px; padding: 10px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
            <div>
                <div class="mb-schema-mini-label">Min Değer:</div>
                <input type="number" class="mb-input slider-min" value="${keyDef.min !== undefined ? keyDef.min : 0}" style="padding: 6px 10px; font-size: 11px;">
            </div>
            <div>
                <div class="mb-schema-mini-label">Max Değer:</div>
                <input type="number" class="mb-input slider-max" value="${keyDef.max !== undefined ? keyDef.max : 100}" style="padding: 6px 10px; font-size: 11px;">
            </div>
            <div>
                <div class="mb-schema-mini-label">Adım (Step):</div>
                <input type="number" class="mb-input slider-step" value="${keyDef.step !== undefined ? keyDef.step : 1}" style="padding: 6px 10px; font-size: 11px;">
            </div>
        </div>
    `;

    container.querySelector('.slider-min')?.addEventListener('input', (e) => {
        currentSchemaObj[secName][keyName].min = Number(e.target.value);
        triggerLiveUpdate();
    });
    container.querySelector('.slider-max')?.addEventListener('input', (e) => {
        currentSchemaObj[secName][keyName].max = Number(e.target.value);
        triggerLiveUpdate();
    });
    container.querySelector('.slider-step')?.addEventListener('input', (e) => {
        currentSchemaObj[secName][keyName].step = Number(e.target.value);
        triggerLiveUpdate();
    });
}

/**
 * Preset seçim dropdown'ını güncelle (Sihirbaz için)
 */
function updateWizardPresetDropdown() {
    const presetSelect = document.getElementById('mb-wiz-preset');
    if (!presetSelect) return;
    const currentVal = presetSelect.value;
    presetSelect.innerHTML = '<option value="">-- Ön Ayar Uygulama --</option>';

    if (currentPresetsObj && typeof currentPresetsObj === 'object') {
        for (const [pId, pData] of Object.entries(currentPresetsObj)) {
            const opt = document.createElement('option');
            opt.value = pId;
            const displayName = pData.name || pData.nameKey || pId;
            opt.textContent = `${pId} (${displayName})`;
            if (pId === currentVal) {
                opt.selected = true;
            }
            presetSelect.appendChild(opt);
        }
    }
}

/**
 * Şema Tabanlı Ön Ayarlar Listesini Çiz (Katlanabilir / Accordion Yapıda)
 */
function renderPresets() {
    const container = document.getElementById('mb-presets-container');
    if (!container) return;

    updateWizardPresetDropdown();
    container.innerHTML = '';

    const presets = Object.entries(currentPresetsObj);
    if (presets.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding: 24px; color: var(--text-secondary); border: 1px dashed rgba(255,255,255,0.08); border-radius: 10px;">
                <div style="font-size: 24px; margin-bottom: 6px;">⚡</div>
                <span style="font-size: 12px;">Henüz bir hazır mod ön ayarı tanımlanmadı. Kullanıcıların tek tıkla uygulayabileceği profiller için <strong>+ Ön Ayar Ekle</strong> butonuna tıklayın.</span>
            </div>
        `;
        return;
    }

    const schemaSections = Object.entries(currentSchemaObj);

    presets.forEach(([pId, pData]) => {
        const card = document.createElement('div');
        card.className = 'mb-preset-card';

        const name = pData.name || pData.nameKey || pId;
        const currentMode = presetViewModes[pId] || 'visual';

        card.innerHTML = `
            <div class="mb-preset-card-header">
                <div style="display: flex; gap: 8px; align-items: center;">
                    <strong style="color: var(--text-primary); font-size: 13px;">⚡</strong>
                    <input type="text" class="mb-input preset-id-input" value="${pId}" placeholder="preset_id" style="font-family: monospace; font-size: 11px; width: 140px; padding: 4px 8px;">
                </div>
                <button type="button" class="mb-delete-mini-btn del-preset-btn" title="Ön Ayarı Sil">🗑️</button>
            </div>
            <div class="form-row-2">
                <div>
                    <div class="mb-schema-mini-label">Ön Ayar Görünen Adı:</div>
                    <input type="text" class="mb-input preset-name-input" value="${name}">
                </div>
                <div class="form-group mb-checkbox-group" style="margin-top: 18px;">
                    <label class="mb-checkbox-label">
                        <input type="checkbox" class="preset-locked-input" ${pData.locked ? 'checked' : ''}>
                        <span>Kilitli Profil (locked)</span>
                    </label>
                </div>
            </div>

            <!-- Mini View Switcher (Visual vs Raw JSON) -->
            <div class="mb-preset-subnav">
                <button type="button" class="mb-preset-subbtn ${currentMode === 'visual' ? 'active' : ''}" data-mode="visual">🎨 Görsel Değerler</button>
                <button type="button" class="mb-preset-subbtn ${currentMode === 'raw' ? 'active' : ''}" data-mode="raw">📝 Raw JSON</button>
            </div>

            <!-- Visual Schema Value Editor Container -->
            <div class="preset-visual-container" style="display: ${currentMode === 'visual' ? 'block' : 'none'};"></div>

            <!-- Raw JSON Container -->
            <div class="preset-raw-container" style="display: ${currentMode === 'raw' ? 'block' : 'none'};">
                <div class="mb-schema-mini-label">Uygulanacak Ayar Değerleri (JSON):</div>
                <textarea class="mb-textarea code-font preset-values-raw-input" rows="5">${JSON.stringify(pData.values || {}, null, 2)}</textarea>
            </div>
        `;

        // Preset ID Değişimi
        card.querySelector('.preset-id-input')?.addEventListener('change', (e) => {
            const newId = e.target.value.trim();
            if (newId && newId !== pId) {
                if (!currentPresetsObj[newId]) {
                    currentPresetsObj[newId] = currentPresetsObj[pId];
                    presetViewModes[newId] = presetViewModes[pId];
                    delete currentPresetsObj[pId];
                    delete presetViewModes[pId];
                    renderPresets();
                    triggerLiveUpdate();
                } else {
                    e.target.value = pId;
                }
            }
        });

        // Preset Adı Değişimi
        card.querySelector('.preset-name-input')?.addEventListener('input', (e) => {
            currentPresetsObj[pId].name = e.target.value;
            triggerLiveUpdate();
        });

        // Locked Değişimi
        card.querySelector('.preset-locked-input')?.addEventListener('change', (e) => {
            currentPresetsObj[pId].locked = e.target.checked;
            triggerLiveUpdate();
        });

        // Silme
        card.querySelector('.del-preset-btn')?.addEventListener('click', () => {
            delete currentPresetsObj[pId];
            delete presetViewModes[pId];
            renderPresets();
            triggerLiveUpdate();
        });

        // Mini Tab Switcher (Visual vs Raw)
        const subBtns = card.querySelectorAll('.mb-preset-subbtn');
        const visualCont = card.querySelector('.preset-visual-container');
        const rawCont = card.querySelector('.preset-raw-container');
        const rawTextarea = card.querySelector('.preset-values-raw-input');

        subBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                presetViewModes[pId] = mode;
                subBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                if (mode === 'visual') {
                    if (visualCont) visualCont.style.display = 'block';
                    if (rawCont) rawCont.style.display = 'none';
                    renderPresetVisualControls(visualCont, pId, schemaSections);
                } else {
                    if (visualCont) visualCont.style.display = 'none';
                    if (rawCont) rawCont.style.display = 'block';
                    if (rawTextarea) {
                        rawTextarea.value = JSON.stringify(currentPresetsObj[pId].values || {}, null, 2);
                    }
                }
            });
        });

        // Raw Textarea Girişi
        rawTextarea?.addEventListener('input', (e) => {
            try {
                currentPresetsObj[pId].values = JSON.parse(e.target.value.trim() || '{}');
            } catch (_) {}
            triggerLiveUpdate();
        });

        // Görsel Kontrolleri Render Et
        if (visualCont) {
            renderPresetVisualControls(visualCont, pId, schemaSections);
        }

        container.appendChild(card);
    });
}

/**
 * Ön ayar görsel kontrollerini çizici (Katlanabilir / Accordion Yapıda)
 */
function renderPresetVisualControls(container, pId, schemaSections) {
    if (!currentPresetsObj[pId].values) {
        currentPresetsObj[pId].values = {};
    }
    const values = currentPresetsObj[pId].values;

    if (schemaSections.length === 0) {
        container.innerHTML = `
            <div style="background: rgba(0,0,0,0.2); border: 1px dashed rgba(255,255,255,0.08); border-radius: 8px; padding: 14px; text-align: center; color: var(--text-secondary); font-size: 11px;">
                <span>📐 Henüz <strong>Görsel Şema Tasarımcısı</strong> sekmesinde bir ayar tanımlanmadı.</span>
                <p style="margin: 4px 0 0 0;">Şemanıza bölüm ve anahtar eklediğinizde, bu ön ayarda otomatik olarak listelenecektir.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="mb-preset-schema-container">
            <div class="mb-preset-quick-actions">
                <button type="button" class="mb-preset-quick-btn btn-include-all" title="Şemadaki tüm ayarları bu profile dahil et">⚡ Tümünü Dahil Et</button>
                <button type="button" class="mb-preset-quick-btn btn-clear-all" title="Seçimleri temizle">🧹 Temizle</button>
            </div>
            <div class="preset-groups-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
        </div>
    `;

    const groupsList = container.querySelector('.preset-groups-list');

    // Hızlı Aksiyonlar: Tümünü Dahil Et
    container.querySelector('.btn-include-all')?.addEventListener('click', () => {
        schemaSections.forEach(([secName, secData]) => {
            if (!values[secName]) values[secName] = {};
            const keys = Object.entries(secData).filter(([k]) => k !== 'visibleIf');
            keys.forEach(([keyName, keyDef]) => {
                if (values[secName][keyName] === undefined) {
                    if (keyDef.type === 'toggle') {
                        values[secName][keyName] = true;
                    } else if (keyDef.type === 'dropdown') {
                        values[secName][keyName] = Array.isArray(keyDef.options) && keyDef.options.length > 0 ? keyDef.options[0].val : 'auto';
                    } else if (keyDef.type === 'slider') {
                        values[secName][keyName] = keyDef.min !== undefined ? keyDef.min : 0;
                    } else {
                        values[secName][keyName] = keyDef.displayDefault || '';
                    }
                }
            });
        });
        renderPresets();
        triggerLiveUpdate();
    });

    // Hızlı Aksiyonlar: Temizle
    container.querySelector('.btn-clear-all')?.addEventListener('click', () => {
        currentPresetsObj[pId].values = {};
        renderPresets();
        triggerLiveUpdate();
    });

    // Her Bölümü Çiz
    schemaSections.forEach(([secName, secData]) => {
        const groupKey = `${pId}_${secName}`;
        const isExpanded = expandedPresetGroups[groupKey] === true;

        const groupEl = document.createElement('div');
        groupEl.className = `mb-preset-schema-group ${isExpanded ? 'expanded' : ''}`;

        const keys = Object.entries(secData).filter(([k]) => k !== 'visibleIf');
        if (keys.length === 0) return;

        const includedCount = keys.filter(([k]) => values[secName] && values[secName][k] !== undefined).length;

        groupEl.innerHTML = `
            <div class="mb-preset-schema-group-title">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span class="mb-accordion-arrow">▶</span>
                    <span>📁 [${secName}]</span>
                </div>
                <span class="mb-count-badge">${includedCount}/${keys.length} Seçili</span>
            </div>
            <div class="preset-keys-sublist"></div>
        `;

        // Accordion Toggle
        const groupTitle = groupEl.querySelector('.mb-preset-schema-group-title');
        groupTitle?.addEventListener('click', () => {
            const currentExp = expandedPresetGroups[groupKey] === true;
            expandedPresetGroups[groupKey] = !currentExp;
            groupEl.classList.toggle('expanded', !currentExp);
        });

        const keysSublist = groupEl.querySelector('.preset-keys-sublist');

        keys.forEach(([keyName, keyDef]) => {
            const isIncluded = values[secName] && values[secName][keyName] !== undefined;
            const curVal = isIncluded ? values[secName][keyName] : (keyDef.displayDefault || '');
            const curType = keyDef.type || 'toggle';
            const curLabel = keyDef.label || keyName;

            const keyItem = document.createElement('div');
            keyItem.className = `mb-preset-key-item ${isIncluded ? 'included' : 'excluded'}`;

            keyItem.innerHTML = `
                <div class="mb-preset-key-left">
                    <input type="checkbox" class="mb-preset-include-checkbox" ${isIncluded ? 'checked' : ''} title="Bu ayarı ön ayara dahil et">
                    <div class="mb-preset-key-info">
                        <span class="mb-preset-key-label">${curLabel}</span>
                        <span class="mb-preset-key-id">${keyName}</span>
                    </div>
                </div>
                <div class="mb-preset-key-right">
                    <!-- Dynamic Control Tailored to Key Type -->
                </div>
            `;

            const ctrlContainer = keyItem.querySelector('.mb-preset-key-right');
            const checkbox = keyItem.querySelector('.mb-preset-include-checkbox');

            // Kontrolü Çiz
            renderPresetControlInput(ctrlContainer, curType, keyDef, curVal, isIncluded, (newVal) => {
                if (!values[secName]) values[secName] = {};
                values[secName][keyName] = newVal;
                syncSetObjToRawText();
                triggerLiveUpdate();
            });

            // Checkbox Dahil Et / Hariç Tut Değişimi
            checkbox?.addEventListener('change', () => {
                if (checkbox.checked) {
                    if (!values[secName]) values[secName] = {};
                    if (curType === 'toggle') {
                        values[secName][keyName] = true;
                    } else if (curType === 'dropdown') {
                        values[secName][keyName] = Array.isArray(keyDef.options) && keyDef.options.length > 0 ? keyDef.options[0].val : 'auto';
                    } else if (curType === 'slider') {
                        values[secName][keyName] = keyDef.min !== undefined ? keyDef.min : 0;
                    } else {
                        values[secName][keyName] = keyDef.displayDefault || '';
                    }
                } else {
                    if (values[secName]) {
                        delete values[secName][keyName];
                        if (Object.keys(values[secName]).length === 0) {
                            delete values[secName];
                        }
                    }
                }
                renderPresets();
                triggerLiveUpdate();
            });

            keysSublist.appendChild(keyItem);
        });

        groupsList.appendChild(groupEl);
    });
}

/**
 * İlk Kurulum Değerleri (set) Görsel Kontrollerini Çiz (Katlanabilir / Accordion Yapıda)
 */
function renderInitialSet() {
    const container = document.getElementById('mb-initial-set-visual-container');
    if (!container) return;

    const schemaSections = Object.entries(currentSchemaObj);

    if (schemaSections.length === 0) {
        container.innerHTML = `
            <div style="background: rgba(0,0,0,0.2); border: 1px dashed rgba(255,255,255,0.08); border-radius: 8px; padding: 20px; text-align: center; color: var(--text-secondary); font-size: 12px;">
                <span>📐 Henüz <strong>Görsel Şema Tasarımcısı</strong> sekmesinde bir ayar tanımlanmadı.</span>
                <p style="margin: 4px 0 0 0;">Şemanıza bölüm ve anahtar eklediğinizde, kurulum anında yazılacak değerler burada görsel olarak seçilebilecektir.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="mb-preset-schema-container">
            <div class="mb-preset-quick-actions">
                <button type="button" class="mb-preset-quick-btn btn-set-include-all" title="Şemadaki tüm ayarları kurulum başlangıç değerlerine ekle">⚡ Tümünü Dahil Et</button>
                <button type="button" class="mb-preset-quick-btn btn-set-clear-all" title="Seçimleri temizle">🧹 Temizle</button>
            </div>
            <div class="set-groups-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
        </div>
    `;

    const groupsList = container.querySelector('.set-groups-list');

    // Hızlı Aksiyonlar: Tümünü Dahil Et
    container.querySelector('.btn-set-include-all')?.addEventListener('click', () => {
        schemaSections.forEach(([secName, secData]) => {
            if (!currentSetObj[secName]) currentSetObj[secName] = {};
            const keys = Object.entries(secData).filter(([k]) => k !== 'visibleIf');
            keys.forEach(([keyName, keyDef]) => {
                if (currentSetObj[secName][keyName] === undefined) {
                    if (keyDef.type === 'toggle') {
                        currentSetObj[secName][keyName] = true;
                    } else if (keyDef.type === 'dropdown') {
                        currentSetObj[secName][keyName] = Array.isArray(keyDef.options) && keyDef.options.length > 0 ? keyDef.options[0].val : 'auto';
                    } else if (keyDef.type === 'slider') {
                        currentSetObj[secName][keyName] = keyDef.min !== undefined ? keyDef.min : 0;
                    } else {
                        currentSetObj[secName][keyName] = keyDef.displayDefault || '';
                    }
                }
            });
        });
        renderInitialSet();
        syncSetObjToRawText();
        triggerLiveUpdate();
    });

    // Hızlı Aksiyonlar: Temizle
    container.querySelector('.btn-set-clear-all')?.addEventListener('click', () => {
        currentSetObj = {};
        renderInitialSet();
        syncSetObjToRawText();
        triggerLiveUpdate();
    });

    // Her Bölümü Çiz
    schemaSections.forEach(([secName, secData]) => {
        const isExpanded = expandedSetGroups.has(secName);

        const groupEl = document.createElement('div');
        groupEl.className = `mb-preset-schema-group ${isExpanded ? 'expanded' : ''}`;

        const keys = Object.entries(secData).filter(([k]) => k !== 'visibleIf');
        if (keys.length === 0) return;

        const includedCount = keys.filter(([k]) => currentSetObj[secName] && currentSetObj[secName][k] !== undefined).length;

        groupEl.innerHTML = `
            <div class="mb-preset-schema-group-title">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span class="mb-accordion-arrow">▶</span>
                    <span>📁 [${secName}]</span>
                </div>
                <span class="mb-count-badge">${includedCount}/${keys.length} Yazılacak</span>
            </div>
            <div class="preset-keys-sublist"></div>
        `;

        // Accordion Toggle
        const groupTitle = groupEl.querySelector('.mb-preset-schema-group-title');
        groupTitle?.addEventListener('click', () => {
            if (expandedSetGroups.has(secName)) {
                expandedSetGroups.delete(secName);
                groupEl.classList.remove('expanded');
            } else {
                expandedSetGroups.add(secName);
                groupEl.classList.add('expanded');
            }
        });

        const keysSublist = groupEl.querySelector('.preset-keys-sublist');

        keys.forEach(([keyName, keyDef]) => {
            const isIncluded = currentSetObj[secName] && currentSetObj[secName][keyName] !== undefined;
            const curVal = isIncluded ? currentSetObj[secName][keyName] : (keyDef.displayDefault || '');
            const curType = keyDef.type || 'toggle';
            const curLabel = keyDef.label || keyName;

            const keyItem = document.createElement('div');
            keyItem.className = `mb-preset-key-item ${isIncluded ? 'included' : 'excluded'}`;

            keyItem.innerHTML = `
                <div class="mb-preset-key-left">
                    <input type="checkbox" class="mb-preset-include-checkbox" ${isIncluded ? 'checked' : ''} title="Kurulumda bu başlangıç değerini dosyaya yaz">
                    <div class="mb-preset-key-info">
                        <span class="mb-preset-key-label">${curLabel}</span>
                        <span class="mb-preset-key-id">${keyName}</span>
                    </div>
                </div>
                <div class="mb-preset-key-right">
                    <!-- Dynamic Control Tailored to Key Type -->
                </div>
            `;

            const ctrlContainer = keyItem.querySelector('.mb-preset-key-right');
            const checkbox = keyItem.querySelector('.mb-preset-include-checkbox');

            // Kontrolü Çiz
            renderPresetControlInput(ctrlContainer, curType, keyDef, curVal, isIncluded, (newVal) => {
                if (!currentSetObj[secName]) currentSetObj[secName] = {};
                currentSetObj[secName][keyName] = newVal;
                syncSetObjToRawText();
                triggerLiveUpdate();
            });

            // Checkbox Dahil Et / Hariç Tut
            checkbox?.addEventListener('change', () => {
                if (checkbox.checked) {
                    if (!currentSetObj[secName]) currentSetObj[secName] = {};
                    if (curType === 'toggle') {
                        currentSetObj[secName][keyName] = true;
                    } else if (curType === 'dropdown') {
                        currentSetObj[secName][keyName] = Array.isArray(keyDef.options) && keyDef.options.length > 0 ? keyDef.options[0].val : 'auto';
                    } else if (curType === 'slider') {
                        currentSetObj[secName][keyName] = keyDef.min !== undefined ? keyDef.min : 0;
                    } else {
                        currentSetObj[secName][keyName] = keyDef.displayDefault || '';
                    }
                } else {
                    if (currentSetObj[secName]) {
                        delete currentSetObj[secName][keyName];
                        if (Object.keys(currentSetObj[secName]).length === 0) {
                            delete currentSetObj[secName];
                        }
                    }
                }
                renderInitialSet();
                syncSetObjToRawText();
                triggerLiveUpdate();
            });

            keysSublist.appendChild(keyItem);
        });

        groupsList.appendChild(groupEl);
    });
}

/**
 * Ön ayar ve Set için şema tipine özel giriş kontrolü çizici
 */
function renderPresetControlInput(container, type, keyDef, val, isEnabled, onValueChange) {
    container.innerHTML = '';

    if (type === 'toggle') {
        const boolVal = (val === true || val === 'true' || val === 1 || val === '1');
        const select = document.createElement('select');
        select.className = 'mb-select';
        select.style.cssText = 'padding: 4px 8px; font-size: 11px; width: 110px;';
        select.disabled = !isEnabled;
        select.innerHTML = `
            <option value="true" ${boolVal ? 'selected' : ''}>Açık (true)</option>
            <option value="false" ${!boolVal ? 'selected' : ''}>Kapalı (false)</option>
        `;
        select.addEventListener('change', () => {
            onValueChange(select.value === 'true');
        });
        container.appendChild(select);
    } else if (type === 'dropdown') {
        const select = document.createElement('select');
        select.className = 'mb-select';
        select.style.cssText = 'padding: 4px 8px; font-size: 11px; width: 130px;';
        select.disabled = !isEnabled;

        const options = Array.isArray(keyDef.options) ? keyDef.options : [];
        if (options.length === 0) {
            select.innerHTML = `<option value="${val || ''}">${val || 'Seçenek Yok'}</option>`;
        } else {
            select.innerHTML = options.map(opt => {
                const optValStr = String(opt.val !== undefined ? opt.val : '');
                const curValStr = String(val !== undefined ? val : '');
                return `<option value="${optValStr}" ${optValStr === curValStr ? 'selected' : ''}>${opt.label || optValStr}</option>`;
            }).join('');
        }

        select.addEventListener('change', () => {
            let selectedVal = select.value;
            if (selectedVal === 'true') selectedVal = true;
            else if (selectedVal === 'false') selectedVal = false;
            else if (/^-?\d+$/.test(selectedVal)) selectedVal = Number(selectedVal);
            onValueChange(selectedVal);
        });
        container.appendChild(select);
    } else if (type === 'slider') {
        const numInput = document.createElement('input');
        numInput.type = 'number';
        numInput.className = 'mb-input';
        numInput.style.cssText = 'padding: 4px 8px; font-size: 11px; width: 90px; text-align: center;';
        numInput.disabled = !isEnabled;
        numInput.min = keyDef.min !== undefined ? keyDef.min : 0;
        numInput.max = keyDef.max !== undefined ? keyDef.max : 100;
        numInput.step = keyDef.step !== undefined ? keyDef.step : 1;
        numInput.value = (val !== undefined && val !== '') ? val : (keyDef.min || 0);

        numInput.addEventListener('input', () => {
            onValueChange(Number(numInput.value));
        });
        container.appendChild(numInput);
    } else {
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.className = 'mb-input';
        textInput.style.cssText = 'padding: 4px 8px; font-size: 11px; width: 130px;';
        textInput.disabled = !isEnabled;
        textInput.value = val !== undefined ? val : '';

        textInput.addEventListener('input', () => {
            onValueChange(textInput.value);
        });
        container.appendChild(textInput);
    }
}

/**
 * Hem INI syntax'ını hem JSON syntax'ını parse eder
 */
function parseConfigSetInput(rawText) {
    const trimmed = rawText.trim();
    if (!trimmed) return undefined;

    if (trimmed.startsWith('{')) {
        try {
            return JSON.parse(trimmed);
        } catch {
            return undefined;
        }
    }

    const result = {};
    let currentSection = null;
    const lines = trimmed.split(/\r?\n/);

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(';') || line.startsWith('#')) continue;

        if (line.startsWith('[') && line.endsWith(']')) {
            currentSection = line.substring(1, line.length - 1).trim();
            if (!result[currentSection]) {
                result[currentSection] = {};
            }
            continue;
        }

        const eqIdx = line.indexOf('=');
        if (eqIdx !== -1) {
            const key = line.substring(0, eqIdx).trim();
            const valStr = line.substring(eqIdx + 1).trim();
            let val = valStr;
            if (valStr.toLowerCase() === 'true') val = true;
            else if (valStr.toLowerCase() === 'false') val = false;
            else if (/^-?\d+(\.\d+)?$/.test(valStr) && !isNaN(Number(valStr))) val = Number(valStr);

            if (currentSection) {
                if (!result[currentSection]) result[currentSection] = {};
                result[currentSection][key] = val;
            } else {
                result[key] = val;
            }
        }
    }

    return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Formdaki girdilerden standart uyumlu manifest objesi oluştur
 */
function buildManifestFromForm() {
    const getVal = (id) => document.getElementById(id)?.value?.trim() || '';

    const manifest = {
        id: getVal('mb-id'),
        name: getVal('mb-name'),
        description: getVal('mb-desc') || undefined,
        author: getVal('mb-author') || undefined,
        version: getVal('mb-version') || '1.0.0',
        source: {
            type: 'github',
            repo: getVal('mb-repo'),
            release: getVal('mb-release') || 'latest',
            // Virgülle birden fazla filtre yazıldıysa dizi olarak kaydedilir
            asset: (() => {
                const raw = getVal('mb-asset') || '*.zip';
                const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
                return parts.length > 1 ? parts : (parts[0] || '*.zip');
            })()
        },
        install: {
            destination: getVal('mb-destination') || 'game_exe',
            extractRoot: getVal('mb-extract-root') || 'auto',
            cleanStaleVersionFiles: document.getElementById('mb-clean-stale')?.checked || false,
            refreshGameOnComplete: true
        }
    };

    // Modül rolü — 'addon' olanlar mod seçim ekranında listelenmez
    const role = getVal('mb-role');
    if (role === 'addon') {
        manifest.role = 'addon';
    }

    // Ek bileşenler (addons) — başka modüllerin id'sini referans alır
    const addons = collectAddonsFromForm();
    if (addons.length > 0) {
        manifest.addons = addons;
    }

    // Çakışan modüller — boşsa manifest'e hiç yazılmaz (geriye dönük uyumluluk)
    const conflicts = collectConflictsFromForm();
    if (conflicts.length > 0) {
        manifest.conflicts = conflicts;
    }

    // Dynamic Search & Detection
    if (manifest.install.destination === 'dynamic_search') {
        const detFilesRaw = getVal('mb-det-files');
        const detFiles = detFilesRaw.split(',').map(s => s.trim()).filter(Boolean);
        const fallback = getVal('mb-det-fallback');
        manifest.install.detection = {
            searchBase: 'game_root',
            strategy: getVal('mb-det-strategy') || 'shallowest_directory',
            files: detFiles.length > 0 ? detFiles : undefined,
            fallback: fallback === 'none' ? undefined : fallback,
            allowManualPicker: true
        };
        const wlRaw = getVal('mb-whitelist-files');
        const wlFiles = wlRaw.split(',').map(s => s.trim()).filter(Boolean);
        if (wlFiles.length > 0) {
            manifest.install.whitelistFiles = wlFiles;
        }
    }

    // Backup & Uninstall Strategy
    const backupStrat = getVal('mb-backup-strategy');
    if (backupStrat === 'in_place_suffix') {
        manifest.backup = {
            enabled: true,
            strategy: 'in_place_suffix',
            suffix: '.backup',
            recordHashes: true,
            rollbackOnFailure: document.getElementById('mb-backup-rollback')?.checked !== false
        };
        manifest.uninstall = {
            restoreBackup: true,
            strategy: 'in_place_suffix',
            suffix: '.backup',
            gameUpdatedCheck: true,
            cleanModOnlyFiles: true
        };
    }

    // Antivirüs gecikmesi
    const avDelay = parseInt(getVal('mb-av-delay'), 10);
    if (!isNaN(avDelay) && avDelay > 0) {
        manifest.install.verifyAntiVirusDelayMs = avDelay;
    }

    // Proxy Detection
    const proxyToggle = document.getElementById('mb-proxy-enable');
    if (proxyToggle && proxyToggle.checked) {
        const candidatesRaw = getVal('mb-proxy-candidates');
        const candidates = candidatesRaw.split(',').map(s => s.trim()).filter(Boolean);
        manifest.install.proxyDetection = {
            sourceFile: getVal('mb-proxy-source') || 'version.dll',
            defaultTarget: getVal('mb-proxy-default') || 'dxgi.dll',
            descriptionMatch: getVal('mb-proxy-match') || undefined,
            candidates: candidates.length > 0 ? candidates : undefined
        };
    }

    // Config (Standart Dizi Formatı)
    const cfgFile = getVal('mb-cfg-file');
    const cfgSearchRaw = getVal('mb-cfg-search');
    const cfgCreateIfMissing = document.getElementById('mb-cfg-create-if-missing')?.checked || false;
    const cfgRequired = document.getElementById('mb-cfg-required')?.checked || false;

    if (cfgFile || Object.keys(currentSchemaObj).length > 0) {
        const format = getVal('mb-cfg-format') || 'ini';
        const cfgEntry = {
            file: cfgFile || 'config.ini',
            format: format
        };

        // search array
        if (cfgSearchRaw) {
            const searchCandidates = cfgSearchRaw.split(',').map(s => s.trim()).filter(Boolean);
            if (searchCandidates.length > 0) {
                cfgEntry.search = searchCandidates;
            }
        }

        if (cfgCreateIfMissing) cfgEntry.createIfMissing = true;
        if (cfgRequired) cfgEntry.required = true;

        // Set (Görsel veya Raw nesneden derle)
        if (currentSetObj && Object.keys(currentSetObj).length > 0) {
            cfgEntry.set = currentSetObj;
        } else {
            const cfgSetRaw = getVal('mb-cfg-set');
            if (cfgSetRaw) {
                const parsed = parseConfigSetInput(cfgSetRaw);
                if (parsed) {
                    cfgEntry.set = parsed;
                }
            }
        }

        // Schema
        if (Object.keys(currentSchemaObj).length > 0) {
            cfgEntry.schema = currentSchemaObj;
        }

        // Presets
        if (Object.keys(currentPresetsObj).length > 0) {
            cfgEntry.presets = currentPresetsObj;
        }

        manifest.config = [cfgEntry];
    } else if (currentEditingManifest?.config && Array.isArray(currentEditingManifest.config) && currentEditingManifest.config.length > 0) {
        manifest.config = currentEditingManifest.config;
    }

    // Wizard
    const wizEnableCheckbox = document.getElementById('mb-wiz-enabled');
    if (wizEnableCheckbox && wizEnableCheckbox.checked) {
        const wizType = getVal('mb-wiz-type') || 'auto_test';
        const wizTitle = getVal('mb-wiz-title');
        const wizDesc = getVal('mb-wiz-desc');
        const wizPreset = getVal('mb-wiz-preset');

        const wizardObj = {
            type: wizType
        };
        if (wizTitle) wizardObj.title = wizTitle;
        if (wizDesc) wizardObj.description = wizDesc;
        if (wizPreset) wizardObj.applyPresetOnSuccess = wizPreset;

        if (wizType === 'auto_test') {
            const candidatesRaw = getVal('mb-wiz-candidates');
            const candidates = candidatesRaw.split(',').map(s => s.trim()).filter(Boolean);
            const timeoutSec = parseInt(getVal('mb-wiz-timeout'), 10) || 10;
            wizardObj.autoTest = {
                sourceFile: getVal('mb-wiz-source-file') || 'version.dll',
                candidates: candidates.length > 0 ? candidates : ['version.dll', 'dxgi.dll', 'winmm.dll', 'dbghelp.dll', 'psapi.dll', 'winhttp.dll'],
                watchFile: getVal('mb-wiz-watch-file') || 'dlss-enabler.ini',
                watchLocation: getVal('mb-wiz-watch-loc') || 'game_exe',
                timeoutSeconds: timeoutSec,
                checkProcessRunning: document.getElementById('mb-wiz-check-process')?.checked !== false,
                autoTerminateGame: document.getElementById('mb-wiz-terminate-game')?.checked !== false
            };
        }
        manifest.wizard = wizardObj;
    }

    // Uninstall
    const unFilesRaw = getVal('mb-un-files');
    const unVerifiedRaw = getVal('mb-un-verified');
    if (unFilesRaw || unVerifiedRaw) {
        manifest.uninstall = {
            restoreBackup: false
        };

        if (unFilesRaw) {
            manifest.uninstall.files = unFilesRaw.split(',').map(s => s.trim()).filter(Boolean);
        }

        if (unVerifiedRaw) {
            const candidates = unVerifiedRaw.split(',').map(s => s.trim()).filter(Boolean);
            manifest.uninstall.verifiedDlls = [
                {
                    candidates,
                    descriptionMatch: manifest.install?.proxyDetection?.descriptionMatch || manifest.id
                }
            ];
        }
    }

    // Formda karşılığı olmayan alanlar kaybolmasın: bir manifest düzenlenirken
    // (ör. resmi bir manifesti fork ederken) editörün modellemediği bloklar
    // kaynaktan aynen taşınır. `detect` (tarayıcı mod tespiti) bunların başında gelir.
    if (currentEditingManifest && typeof currentEditingManifest === 'object') {
        const carryOverKeys = ['detect', 'aliases', 'conditions', 'permissions', 'metadata', 'state'];
        for (const key of carryOverKeys) {
            if (manifest[key] === undefined && currentEditingManifest[key] !== undefined) {
                manifest[key] = currentEditingManifest[key];
            }
        }
    }

    return JSON.parse(JSON.stringify(manifest));
}

/**
 * Canlı JSON önizleme ve doğrulama tetikle (300ms debounce)
 */
function triggerLiveUpdate(delayMs = 300) {
    if (validationDebounceTimer) clearTimeout(validationDebounceTimer);

    validationDebounceTimer = setTimeout(async () => {
        const manifest = buildManifestFromForm();
        const jsonCodeEl = document.getElementById('mb-json-code');
        const alertEl = document.getElementById('mb-validation-alert');
        const alertText = document.getElementById('mb-alert-text');
        const badgeEl = document.getElementById('mb-validation-badge');
        const idFeedback = document.getElementById('mb-id-feedback');

        if (jsonCodeEl) {
            jsonCodeEl.textContent = JSON.stringify(manifest, null, 2);
        }

        // IPC üzerinden validasyon kontrolü
        if (window.electronAPI && window.electronAPI.moduleValidateManifest) {
            try {
                const validation = await window.electronAPI.moduleValidateManifest(manifest);
                
                // ID çakışma kontrolü (Resmi/Topluluk ezme uyarısı)
                let idConflictError = null;
                if (manifest.id && window.electronAPI.moduleList) {
                    const modules = await window.electronAPI.moduleList();
                    const match = modules.find(m => m.id === manifest.id);
                    if (match && (match.type === 'official' || match.type === 'community') && currentEditingType === 'custom') {
                        idConflictError = `Bu ID resmi/topluluk modülüne aittir ('${manifest.id}'). Kaydetmek için ID'yi değiştirin (örn: ${manifest.id}-custom) veya çatallayın.`;
                    }
                }

                if (idFeedback) {
                    if (idConflictError) {
                        idFeedback.textContent = idConflictError;
                        idFeedback.className = 'mb-field-feedback mb-error-text';
                    } else {
                        idFeedback.textContent = '';
                    }
                }

                if (!validation.valid || idConflictError) {
                    const errors = [...(validation.errors || [])];
                    if (idConflictError) errors.unshift(idConflictError);

                    if (badgeEl) {
                        badgeEl.textContent = '✗ Hatalı';
                        badgeEl.className = 'mb-badge mb-badge-invalid';
                    }
                    if (alertEl && alertText) {
                        alertEl.className = 'mb-validation-alert mb-alert-error';
                        alertText.textContent = errors.join('; ');
                    }
                } else {
                    if (badgeEl) {
                        badgeEl.textContent = '✓ Geçerli';
                        badgeEl.className = 'mb-badge mb-badge-valid';
                    }
                    if (alertEl && alertText) {
                        alertEl.className = 'mb-validation-alert mb-alert-success';
                        alertText.textContent = validation.warnings && validation.warnings.length > 0 
                            ? `Uyarı: ${validation.warnings.join(', ')}` 
                            : 'Manifest yapısı tamamen geçerli.';
                    }
                }
            } catch (e) {
                console.error('Validation error:', e);
            }
        }
    }, delayMs);
}

/**
 * Manifesti doğrudan AppData'ya kaydet
 */
async function saveCurrentManifest() {
    const manifest = buildManifestFromForm();

    if (!manifest.id || !manifest.name || !manifest.source?.repo) {
        showInfoModal('Eksik Bilgi', 'Lütfen Mod ID, Mod Adı ve GitHub Repository alanlarını doldurun.', true);
        return;
    }

    if (!window.electronAPI || !window.electronAPI.moduleSaveManifest) {
        showInfoModal('Hata', 'Electron API bağlantısı bulunamadı.', true);
        return;
    }

    try {
        const result = await window.electronAPI.moduleSaveManifest(manifest);

        if (result.success) {
            showInfoModal(
                'Manifest Kaydedildi',
                `'${manifest.name}' manifesti başarıyla AppData kütüphanenize kaydedildi ve modül sistemine yüklendi.\n\nKonum: ${result.path}`
            );
            closeEditor();
        } else {
            showInfoModal('Kayıt Başarısız', result.error || 'Bilinmeyen bir hata oluştu.', true);
        }
    } catch (e) {
        showInfoModal('Hata', `Kaydetme sırasında bir hata oluştu: ${e.message}`, true);
    }
}
