import { openModal, closeModal } from './base.js';
import { showInfoModal } from './info.js';
import { updateHomeStats, refreshGame } from '../games.js';
import { buildCacheStatusBar } from './cacheHelpers.js';
import { openWizardModal } from './dlssWizard.js';
import { selectExeWithPicker } from './exePicker.js';
import { t } from '../../i18n/i18n.js';

let _currentModule = null;
let _currentGame = null;
let _fetchedReleases = [];

// Kurulumu engelleyen ilk ön koşul (varsa) — "Önce X'i Kur" butonu bunu kullanır.
let _blockingRequirement = null;

// Ön koşul kurulumu için başka bir modüle geçildiğinde, o kurulum bitince
// geri dönülecek modül. Her kullanımdan ve iptalden sonra temizlenir; aksi
// hâlde alakasız bir kurulumdan sonra yanlış modal açılır.
let _returnToAfterPrereq = null;

/**
 * Oyunun gerçek .exe yolunu çözer.
 * Sırasıyla: resolveGamePaths → oyun kaydındaki exePath → kullanıcıya exe seçtirme.
 * Hem sihirbaz hem de doğrudan kurulum bu yolu kullanır; aksi hâlde manifest'teki
 * destination: "game_exe" yanlış klasöre (ör. oyun kökü) çözülüyordu.
 *
 * @returns {Promise<string|null>} null = kullanıcı iptal etti / bulunamadı
 */
async function resolveExeForGame(game, { allowPicker = true } = {}) {
    let exePath = null;
    let gameRoot = null;

    try {
        const paths = await window.electronAPI.resolveGamePaths(
            game.name,
            game.exePath || game.exe_path
        );
        if (paths) {
            gameRoot = paths.game_root || null;
            if (paths.exe_path && paths.exe_path.toLowerCase().endsWith('.exe')) {
                exePath = paths.exe_path;
            }
        }
    } catch (err) {
        console.error('[MODULE_INSTALL] resolveGamePaths hatası:', err);
    }

    if (!exePath) {
        const candidate = game.exePath || game.exe_path || game.path;
        if (candidate && candidate.toLowerCase().endsWith('.exe')) {
            exePath = candidate;
        }
    }

    if (!exePath && allowPicker) {
        const selected = await selectExeWithPicker(
            game.name,
            gameRoot || game.gameRoot || game.exePath || game.path
        );
        if (!selected) return null;
        exePath = selected;
    }

    return exePath;
}

/** Modal üzerinde seçili sürüm için release kaydını ve indirme linkini döndürür. */
function getSelectedRelease() {
    const verSelect = document.getElementById('module-install-version-select');
    const selectedTag = (verSelect && verSelect.value) ? verSelect.value : 'latest';
    const release = _fetchedReleases.find(r => (r.tag || r.name) === selectedTag) || _fetchedReleases[0] || null;
    return { selectedTag, release, downloadUrl: release ? release.downloadUrl : null };
}

/**
 * İşaretli eklentiler → { <moduleId>: true }. Hiçbiri seçili değilse null.
 * Motor bu id'lerle ilgili modülün kendi manifest'inden repo/asset bilgisini çözer.
 */
function getSelectedAddons() {
    const sec = document.getElementById('module-install-addons-section');
    if (!sec || sec.style.display === 'none') return null;

    const result = {};
    let any = false;
    sec.querySelectorAll('.module-install-addon-cb').forEach(cb => {
        if (cb.checked && cb.dataset.moduleId) {
            result[cb.dataset.moduleId] = true;
            any = true;
        }
    });
    return any ? result : null;
}

/**
 * Modal üzerinde seçili grafik API'si (bölüm gizliyse null).
 * apiTargeting kullanan modüllerde (ör. ReShade) kopyalanacak DLL'in adını belirler.
 */
function getSelectedApi() {
    const sec = document.getElementById('module-install-api-section');
    const select = document.getElementById('module-install-api-select');
    const isVisible = sec && sec.style.display !== 'none';
    const val = (isVisible && select) ? select.value : '';
    return val && val !== 'auto' ? val : null;
}

/**
 * Ön koşul bölümünü doldurur (manifest.requires).
 *
 * Bazı modüller tek başına çalışmaz — ör. MFG Unlock bir `.addon64` dosyasıdır ve
 * yalnızca ReShade tarafından yüklenir. Eksik ön koşul varsa kullanıcı boşa
 * indirme başlatmasın diye kurulum butonu burada kilitlenir; motorun 5c adımı
 * ayrıca ikinci bir güvenlik ağı olarak aynı kontrolü yapar.
 *
 * Kontrol edilemezse (IPC hatası) kurulum ENGELLENMEZ — yanlış pozitif yüzünden
 * kullanıcıyı kilitlemek, gereksiz bir kurulumdan daha kötü.
 */
async function renderRequirementsSection(manifest, game) {
    const sec = document.getElementById('module-install-requirements-section');
    const list = document.getElementById('module-install-requirements-list');
    const actionBtn = document.getElementById('module-install-prereq-btn');
    const submitBtn = document.getElementById('module-install-submit-btn');
    if (!sec || !list) return;

    _blockingRequirement = null;
    if (actionBtn) actionBtn.style.display = 'none';

    const requires = Array.isArray(manifest.requires) ? manifest.requires : [];
    if (requires.length === 0) {
        sec.style.display = 'none';
        return;
    }

    sec.style.display = 'block';
    list.innerHTML = '';

    const addRow = (cls, icon, name, detail) => {
        const row = document.createElement('div');
        row.className = `module-prereq-row ${cls}`;

        const iconEl = document.createElement('span');
        iconEl.className = 'module-prereq-icon';
        iconEl.textContent = icon;

        const text = document.createElement('div');
        const nameEl = document.createElement('div');
        nameEl.className = 'module-prereq-name';
        nameEl.textContent = name;
        text.appendChild(nameEl);

        if (detail) {
            const detailEl = document.createElement('div');
            detailEl.className = 'module-prereq-detail';
            detailEl.textContent = detail;
            text.appendChild(detailEl);
        }

        row.appendChild(iconEl);
        row.appendChild(text);
        list.appendChild(row);
    };

    let res = null;
    try {
        res = await window.electronAPI.moduleCheckRequirements({
            moduleId: _currentModule?.id || manifest.id,
            gameName: game?.name,
            exePath: game?.exePath || game?.exe_path
        });
    } catch (e) {
        res = null;
    }

    if (!res || !res.success) {
        addRow('unknown', 'ℹ️', t('modModal.prereqCheckFailed'), res?.error || '');
        return; // kurulum engellenmez
    }

    for (const r of (res.results || [])) {
        if (r.satisfied) {
            const via = r.via === 'disk' ? t('modModal.prereqViaDisk') : t('modModal.prereqViaState');
            addRow('ok', '✓', r.name, `${t('modModal.prereqOk')} (${via})${r.version ? ' · ' + r.version : ''}`);
            continue;
        }

        const message = (r.messageKey ? t(r.messageKey) : null) || r.message;
        if (r.severity === 'warn') {
            addRow('warn', '⚠️', r.name, message);
            continue;
        }

        addRow('blocked', '✗', r.name, message);
        if (!_blockingRequirement && r.installable) {
            _blockingRequirement = { moduleId: r.moduleId, name: r.name };
        }
    }

    if (!res.satisfied) {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = t('modModal.prereqBlocked');
        }
        if (actionBtn && _blockingRequirement) {
            actionBtn.textContent = `${t('modModal.prereqInstallFirst')} ${_blockingRequirement.name}`;
            actionBtn.style.display = 'block';
        }
    }
}

/**
 * Çakışan modlar bölümünü doldurur (`manifest.conflicts` / `incompatible_mods`).
 *
 * `requires`'ın aynası: orada "şu mod OLMALI", burada "şu mod OLMAMALI" deniyor.
 * Alan tanımlı değilse bölüm hiç görünmez — eski manifest'ler etkilenmez.
 *
 * Kontrol edilemezse (IPC hatası) kurulum ENGELLENMEZ; motorun 5d adımı ve
 * kopyalama öncesi dosya sahipliği kontrolü ikinci güvenlik ağıdır.
 */
async function renderConflictsSection(manifest, game) {
    const sec = document.getElementById('module-install-conflicts-section');
    const list = document.getElementById('module-install-conflicts-list');
    const submitBtn = document.getElementById('module-install-submit-btn');
    if (!sec || !list) return;

    const declared = manifest.conflicts || manifest.incompatible_mods;
    if (!Array.isArray(declared) || declared.length === 0) {
        sec.style.display = 'none';
        return;
    }

    sec.style.display = 'block';
    list.innerHTML = '';

    const addRow = (cls, icon, name, detail) => {
        const row = document.createElement('div');
        row.className = `module-prereq-row ${cls}`;

        const iconEl = document.createElement('span');
        iconEl.className = 'module-prereq-icon';
        iconEl.textContent = icon;

        const text = document.createElement('div');
        const nameEl = document.createElement('div');
        nameEl.className = 'module-prereq-name';
        nameEl.textContent = name;
        text.appendChild(nameEl);

        if (detail) {
            const detailEl = document.createElement('div');
            detailEl.className = 'module-prereq-detail';
            detailEl.textContent = detail;
            text.appendChild(detailEl);
        }

        row.appendChild(iconEl);
        row.appendChild(text);
        list.appendChild(row);
    };

    let res = null;
    try {
        res = await window.electronAPI.moduleCheckConflicts({
            moduleId: _currentModule?.id || manifest.id,
            gameName: game?.name,
            exePath: game?.exePath || game?.exe_path
        });
    } catch (e) {
        res = null;
    }

    if (!res || !res.success) {
        addRow('unknown', 'ℹ️', t('modModal.conflictCheckFailed'), res?.error || '');
        return; // kurulum engellenmez
    }

    for (const c of (res.results || [])) {
        if (!c.present) {
            addRow('ok', '✓', c.name, t('modModal.conflictOk'));
            continue;
        }

        const message = (c.messageKey ? t(c.messageKey) : null) || c.message;
        addRow(c.severity === 'warn' ? 'warn' : 'blocked', c.severity === 'warn' ? '⚠️' : '✗', c.name, message);
    }

    if (!res.clear && submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = t('modModal.conflictBlocked');
    }
}

/**
 * apiTargeting bölümünü doldurur: oyunun exe'si analiz edilir, tespit edilen API
 * ön seçili gelir, kullanıcı listeden değiştirebilir.
 */
async function renderApiSection(manifest, game) {
    const sec = document.getElementById('module-install-api-section');
    const select = document.getElementById('module-install-api-select');
    const hint = document.getElementById('module-install-api-hint');
    if (!sec || !select) return;

    const targeting = manifest.install?.apiTargeting;
    if (!targeting) {
        sec.style.display = 'none';
        return;
    }

    sec.style.display = 'block';
    select.innerHTML = '';
    if (hint) hint.textContent = t('modModal.apiDetecting');

    let detection = null;
    let options = [];
    try {
        const res = await window.electronAPI.moduleDetectApi({
            gameName: game?.name,
            exePath: game?.exePath
        });
        if (res && res.success) {
            detection = res.detection;
            options = res.options || [];
        } else if (hint) {
            hint.textContent = t('modModal.apiDetectFailed') + (res && res.error ? ' (' + res.error + ')' : '');
        }
    } catch (e) {
        if (hint) hint.textContent = t('modModal.apiDetectFailed');
    }

    // Manifest yalnızca belirli API'leri destekliyorsa listeyi ona göre daralt
    const supported = targeting.renameByApi ? Object.keys(targeting.renameByApi) : null;
    const list = options.filter(o => !supported || supported.includes(o.api));

    // Otomatik seçenek en üstte
    const autoOpt = document.createElement('option');
    autoOpt.value = 'auto';
    autoOpt.textContent = detection?.recommendedApi
        ? `${t('modModal.apiAuto')} — ${detection.recommendedApi}`
        : t('modModal.apiAuto');
    select.appendChild(autoOpt);

    for (const opt of list) {
        const el = document.createElement('option');
        el.value = opt.api;
        el.textContent = opt.proxyDll ? `${opt.label} → ${opt.proxyDll}` : opt.label;
        select.appendChild(el);
    }

    select.value = 'auto';

    if (hint && detection) {
        const arch = detection.is64Bit ? '64-bit' : '32-bit';
        const source = targeting.sourceByArch
            ? targeting.sourceByArch[detection.is64Bit ? 'x64' : 'x86']
            : null;
        const parts = [`${arch}${source ? ' → ' + source : ''}`];
        if (detection.recommendedProxyDll) parts.push(`${t('modModal.apiTargetFile')}: ${detection.recommendedProxyDll}`);
        if (detection.engine) parts.push(detection.engine);
        if (detection.notes && detection.notes.length > 0) parts.push(detection.notes[0]);
        hint.textContent = parts.join(' · ');
    }
}

/** Modal üzerinde seçili enjeksiyon/proxy DLL (bölüm gizliyse null). */
function getSelectedProxyTarget() {
    const proxySec = document.getElementById('module-install-proxy-section');
    const proxySelect = document.getElementById('module-install-proxy-select');
    const isAllowed = proxySec && proxySec.style.display !== 'none';
    const val = (isAllowed && proxySelect) ? proxySelect.value : '';
    return val || null;
}

/** Modal üzerinde seçili preset (bölüm gizliyse null). */
function getSelectedPreset() {
    const presetSec = document.getElementById('module-install-preset-section');
    const presetSelect = document.getElementById('module-install-preset-select');
    const isAllowed = presetSec && presetSec.style.display !== 'none';
    const val = (isAllowed && presetSelect) ? presetSelect.value : '';
    return val || null;
}

export async function openModuleInstallModal(moduleData, game, forceRefresh = false) {
    if (!moduleData || !game) return;

    _currentModule = {
        ...moduleData,
        manifest: moduleData.manifest || moduleData
    };
    _currentGame = game;

    const manifest = _currentModule.manifest;
    
    // Header & Meta
    const titleEl = document.getElementById('module-install-title');
    if (titleEl) titleEl.textContent = manifest.name || moduleData.id;

    const badgeEl = document.getElementById('module-install-badge');
    if (badgeEl) {
        badgeEl.className = `mod-card-badge badge-${moduleData.type || 'official'}`;
        const typeIcons = { official: '🛡️ Resmi', community: '👥 Topluluk', custom: '⚡ Özel' };
        badgeEl.textContent = typeIcons[moduleData.type] || moduleData.type;
    }

    // Left sidebar: Game details & Cover
    const gameNameEl = document.getElementById('module-install-game-name');
    if (gameNameEl) gameNameEl.textContent = game.name;

    const coverEl = document.getElementById('module-install-game-cover');
    const placeholderEl = document.getElementById('module-install-game-placeholder');
    if (coverEl && placeholderEl) {
        if (game.cover) {
            coverEl.src = game.cover;
            coverEl.style.display = 'block';
            placeholderEl.style.display = 'none';
        } else {
            coverEl.style.display = 'none';
            placeholderEl.style.display = 'flex';
        }
    }

    const authorEl = document.getElementById('module-install-author');
    if (authorEl) {
        authorEl.textContent = manifest.author ? `Geliştirici: ${manifest.author}` : '';
    }

    const repoEl = document.getElementById('module-install-repo');
    if (repoEl) {
        repoEl.textContent = manifest.source?.repo ? `Repo: ${manifest.source.repo}` : '';
    }

    // Right: Description
    const descEl = document.getElementById('module-install-desc');
    if (descEl) {
        descEl.textContent = manifest.description || 'Bu modül için açıklama bulunmuyor.';
    }

    // Reset Progress & Sections
    const progressSec = document.getElementById('module-install-progress-section');
    if (progressSec) progressSec.style.display = 'none';

    const submitBtn = document.getElementById('module-install-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Kurulumu Başlat';
    }

    // ── 1. Releases / Sürümler ───────────────────────────────────────────
    const verSelect = document.getElementById('module-install-version-select');
    if (verSelect) {
        verSelect.innerHTML = `<option value="" disabled selected>Sürümler alınıyor...</option>`;
        verSelect.disabled = true;

        const existingBar = verSelect.parentNode.querySelector('.release-cache-status-bar');
        if (existingBar) existingBar.remove();

        try {
            const result = await window.electronAPI.moduleGetReleases(moduleData.id, forceRefresh);
            verSelect.innerHTML = '';
            
            const releases = result.releases ?? result;
            const fetchedAt = result.fetchedAt ?? null;
            const fromStaleCache = result.fromStaleCache ?? false;
            _fetchedReleases = releases || [];

            if (_fetchedReleases.length > 0) {
                const cacheBar = buildCacheStatusBar(fetchedAt, fromStaleCache, () => openModuleInstallModal(_currentModule, _currentGame, true));
                verSelect.parentNode.insertBefore(cacheBar, verSelect);

                _fetchedReleases.forEach((r, idx) => {
                    const opt = document.createElement('option');
                    opt.value = r.tag || r.name;
                    opt.textContent = `${r.name || r.tag} ${r.installed ? '(İndirildi ✓)' : '(İndirilecek 📥)'}`;
                    if (r.installed) opt.style.color = '#22c55e';
                    if (idx === 0) opt.selected = true;
                    verSelect.appendChild(opt);
                });
                verSelect.disabled = false;
            } else {
                verSelect.innerHTML = `<option value="latest">En Son Sürüm (latest)</option>`;
                verSelect.disabled = false;
            }
        } catch (e) {
            verSelect.innerHTML = `<option value="latest">Varsayılan Sürüm (latest)</option>`;
            verSelect.disabled = false;
        }
    }

    // ── 2. Presets / Ön Ayarlar (Varsa ve Manifestte Başlangıçta Uygula İzni Varsa) ──
    const presetSec = document.getElementById('module-install-preset-section');
    const presetSelect = document.getElementById('module-install-preset-select');
    let hasPresets = false;

    // Manifest'te başlangıçta uygula seçeneği var mı kontrol et
    const allowApplyOnInstall = Boolean(
        manifest.install?.applyPresetOnInstall ||
        manifest.applyPresetOnInstall ||
        manifest.wizard?.applyPresetOnSuccess ||
        (Array.isArray(manifest.config) && manifest.config.some(c => c.applyPresetOnInstall))
    );

    const defaultPreset = 
        (typeof manifest.install?.applyPresetOnInstall === 'string' ? manifest.install.applyPresetOnInstall : null) ||
        (typeof manifest.applyPresetOnInstall === 'string' ? manifest.applyPresetOnInstall : null) ||
        (typeof manifest.wizard?.applyPresetOnSuccess === 'string' ? manifest.wizard.applyPresetOnSuccess : null) ||
        '';

    if (presetSec && presetSelect) {
        presetSelect.innerHTML = '<option value="">(Varsayılan Ayarlar)</option>';
        if (allowApplyOnInstall && Array.isArray(manifest.config)) {
            for (const cfg of manifest.config) {
                if (cfg.presets && typeof cfg.presets === 'object') {
                    for (const [pKey, pVal] of Object.entries(cfg.presets)) {
                        const opt = document.createElement('option');
                        opt.value = pKey;
                        opt.textContent = pVal.name || pKey;
                        if (pVal.description) opt.title = pVal.description;
                        if (defaultPreset && pKey === defaultPreset) {
                            opt.selected = true;
                        }
                        presetSelect.appendChild(opt);
                        hasPresets = true;
                    }
                }
            }
        }
        presetSec.style.display = (allowApplyOnInstall && hasPresets) ? 'block' : 'none';
    }

    // ── 3. Proxy DLL Target (Varsa) ──────────────────────────────────────
    const proxySec = document.getElementById('module-install-proxy-section');
    const proxySelect = document.getElementById('module-install-proxy-select');
    if (proxySec && proxySelect) {
        if (manifest.install?.proxyDetection) {
            proxySec.style.display = 'block';
            proxySelect.innerHTML = '';
            const candidates = manifest.install.proxyDetection.candidates || ['dxgi.dll', 'version.dll', 'winmm.dll'];
            const defTarget = manifest.install.proxyDetection.defaultTarget || 'dxgi.dll';
            
            candidates.forEach(cand => {
                const opt = document.createElement('option');
                opt.value = cand;
                opt.textContent = cand;
                if (cand === defTarget) opt.selected = true;
                proxySelect.appendChild(opt);
            });
        } else {
            proxySec.style.display = 'none';
        }
    }

    // ── 3a1. Ön koşullar (manifest requires) ────────────────────────────
    // submitBtn.disabled yukarıda koşulsuz false yapılıyor; bu çağrı ondan
    // SONRA gelmeli, aksi hâlde kilit eziliyor.
    renderRequirementsSection(manifest, game);

    // ── 3a1b. Çakışan modlar (manifest conflicts) ───────────────────────
    renderConflictsSection(manifest, game);

    // ── 3a2. Grafik API seçimi (manifest install.apiTargeting) ──────────
    renderApiSection(manifest, game);

    // ── 3b. Eklentiler (addons) — ek repolardan opsiyonel bileşenler ─────
    const addonsSec = document.getElementById('module-install-addons-section');
    const addonsList = document.getElementById('module-install-addons-list');
    if (addonsSec && addonsList) {
        addonsList.innerHTML = '';
        const addons = Array.isArray(manifest.addons) ? manifest.addons : [];

        if (addons.length === 0) {
            addonsSec.style.display = 'none';
        } else {
            addons.forEach(addon => {
                const row = document.createElement('label');
                row.style.cssText =
                    'display:flex; align-items:flex-start; gap:8px; cursor:pointer; ' +
                    'padding:7px 9px; border:1px solid var(--border-color); border-radius:6px; ' +
                    'background:var(--card-bg);';

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'module-install-addon-cb';
                cb.dataset.moduleId = addon.moduleId;
                cb.checked = Boolean(addon.default);
                cb.style.cssText = 'margin-top:2px; flex-shrink:0;';

                const label = addon.labelKey ? (t(addon.labelKey) || addon.label) : addon.label;
                const desc = addon.descriptionKey ? (t(addon.descriptionKey) || addon.description) : addon.description;

                const text = document.createElement('div');
                const titleEl = document.createElement('div');
                titleEl.style.cssText = 'font-size:12px; font-weight:600; color:var(--text-primary);';
                titleEl.textContent = label || addon.moduleId;
                text.appendChild(titleEl);

                if (desc) {
                    const descEl = document.createElement('div');
                    descEl.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-top:1px;';
                    descEl.textContent = desc;
                    text.appendChild(descEl);
                }

                row.appendChild(cb);
                row.appendChild(text);
                addonsList.appendChild(row);
            });
            addonsSec.style.display = 'block';
        }
    }

    // ── 4. Wizard / Sihirbaz (Varsa) ─────────────────────────────────────
    const wizardSec = document.getElementById('module-install-wizard-section');
    if (wizardSec) {
        wizardSec.style.display = manifest.wizard ? 'block' : 'none';
    }

    openModal('module-install-modal');
}

export function initModuleInstallModalListeners() {
    const cancelBtn = document.getElementById('module-install-cancel-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            // İptal edildiyse zincir kopar — yoksa alakasız bir kurulumdan
            // sonra yanlış modal geri açılır.
            _returnToAfterPrereq = null;
            closeModal('module-install-modal');
        });
    }

    // "Önce ReShade'i Kur" — eksik ön koşulu aynı akış içinde kurdurur,
    // kurulum bitince bu modülün ekranına geri dönülür.
    const prereqBtn = document.getElementById('module-install-prereq-btn');
    if (prereqBtn) {
        prereqBtn.addEventListener('click', async () => {
            if (!_blockingRequirement || !_currentModule || !_currentGame) return;

            const targetId = _blockingRequirement.moduleId;
            const game = _currentGame;
            const back = { module: _currentModule, game };

            let modules = [];
            try {
                modules = await window.electronAPI.moduleList() || [];
            } catch (e) {
                modules = [];
            }

            const target = modules.find(m => m.id === targetId);
            if (!target) {
                showInfoModal('Hata', `Gerekli modül bulunamadı: ${targetId}`, true);
                return;
            }

            _returnToAfterPrereq = back;
            closeModal('module-install-modal');
            openModuleInstallModal(target, game);
        });
    }

    // Wizard Button Listener
    const wizardBtn = document.getElementById('module-install-wizard-btn');
    if (wizardBtn) {
        wizardBtn.addEventListener('click', async () => {
            if (!_currentModule || !_currentGame) return;

            const manifest = _currentModule.manifest || {};
            const autoTest = manifest.wizard?.autoTest || {};

            const { selectedTag, downloadUrl } = getSelectedRelease();

            // İlk denenecek DLL: kullanıcının proxy seçimi > manifest sourceFile > ilk aday
            const proxySelect = document.getElementById('module-install-proxy-select');
            const selectedDll =
                (proxySelect && proxySelect.value) ||
                autoTest.sourceFile ||
                (Array.isArray(autoTest.candidates) ? autoTest.candidates[0] : null) ||
                'version.dll';

            const exePath = await resolveExeForGame(_currentGame);
            if (!exePath) return; // Kullanıcı iptal etti veya exe bulunamadı

            closeModal('module-install-modal');

            // Tüm modüller aynı canlı log terminalinden çalışır.
            // manifest.wizard varsa evrensel motor, yoksa klasik DLSS Enabler akışı devreye girer.
            openWizardModal(_currentGame, selectedTag, selectedDll, exePath, downloadUrl, {
                id: _currentModule.id,
                manifest,
                preset: getSelectedPreset()
            });
        });
    }

    // Submit Install Button Listener
    const submitBtn = document.getElementById('module-install-submit-btn');
    if (submitBtn) {
        submitBtn.addEventListener('click', async () => {
            if (!_currentModule || !_currentGame) return;

            const { selectedTag } = getSelectedRelease();
            const selectedPreset = getSelectedPreset();

            const progressSec = document.getElementById('module-install-progress-section');
            const progressBar = document.getElementById('module-install-progress-bar');
            const statusText = document.getElementById('module-install-status-text');
            const percentText = document.getElementById('module-install-percent-text');

            // Exe yolunu kurulumdan ÖNCE çöz — gerekirse kullanıcıya seçtir.
            // (Bu adım eksikken game_exe hedefli manifestler oyun köküne kuruyordu.)
            const exePath = await resolveExeForGame(_currentGame);
            if (!exePath) return; // Kullanıcı iptal etti

            if (progressSec) progressSec.style.display = 'block';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Kuruluyor...';

            if (progressBar) progressBar.style.width = '10%';
            if (percentText) percentText.textContent = '%10';
            if (statusText) statusText.textContent = 'Kurulum başlatılıyor...';

            try {
                console.log('[MODULE_INSTALL_UI] Kurulum başlatılıyor:', {
                    moduleId: _currentModule.id,
                    gameName: _currentGame.name,
                    exePath,
                    selectedTag,
                    selectedPreset
                });

                // Listen to download progress
                if (window.electronAPI.onModuleDownloadProgress) {
                    window.electronAPI.onModuleDownloadProgress((data) => {
                        if (data && data.moduleId === _currentModule.id) {
                            const p = Math.round(data.percent || 0);
                            if (progressBar) progressBar.style.width = `${Math.min(95, p)}%`;
                            if (percentText) percentText.textContent = `%${p}`;
                            if (statusText) statusText.textContent = `İndiriliyor... %${p}`;
                        }
                    });
                }

                // Listen to overall module progress
                if (window.electronAPI.onModuleProgress) {
                    window.electronAPI.onModuleProgress((data) => {
                        if (data && data.moduleId === _currentModule.id) {
                            const p = Math.round(data.percent || 0);
                            if (progressBar) progressBar.style.width = `${p}%`;
                            if (percentText) percentText.textContent = `%${p}`;
                            if (statusText && data.message) statusText.textContent = data.message;
                            console.log(`[MODULE_PROGRESS] [${_currentModule.id}] Adım ${data.step}: ${data.message} (%${p})`);
                        }
                    });
                }

                const options = {};
                if (selectedPreset) options.preset = selectedPreset;
                // Kullanıcının seçtiği enjeksiyon DLL'i motora iletilir
                // (aksi hâlde manifest defaultTarget'ı zorlanıyordu).
                const proxyTarget = getSelectedProxyTarget();
                if (proxyTarget) options.proxyTarget = proxyTarget;
                // İşaretli ek bileşenler (ör. OptiScaler → OptiPatcher / FSR4)
                const selectedAddons = getSelectedAddons();
                if (selectedAddons) options.addons = selectedAddons;
                // Kullanıcı grafik API'sini elle seçtiyse otomatik tespitin yerine geçer
                // (apiTargeting kullanan modüller: ReShade vb.)
                const targetApi = getSelectedApi();
                if (targetApi) options.targetApi = targetApi;

                const result = await window.electronAPI.moduleInstall(
                    _currentModule.id,
                    _currentGame.name,
                    exePath,
                    selectedTag,
                    options
                );

                if (window.electronAPI.removeModuleDownloadProgressListeners) {
                    window.electronAPI.removeModuleDownloadProgressListeners();
                }
                if (window.electronAPI.removeModuleProgressListeners) {
                    window.electronAPI.removeModuleProgressListeners();
                }

                console.log('[MODULE_INSTALL_UI_RESULT]', result);

                if (result && result.success) {
                    if (progressBar) progressBar.style.width = '100%';
                    if (percentText) percentText.textContent = '%100';
                    if (statusText) statusText.textContent = 'Kurulum tamamlandı!';

                    closeModal('module-install-modal');
                    closeModal('mod-modal');
                    const modName = _currentModule?.manifest?.name || _currentModule?.name || _currentModule?.id || 'Mod';

                    // Eklenti sonuçlarını da bildir — eklenti hatası ana kurulumu bozmaz,
                    // ama kullanıcı neyin kurulup neyin kurulmadığını görmeli.
                    let detail = `🎉 ${modName} (${result.installedVersion || selectedTag}) başarıyla kuruldu!`;
                    if (result.installedAddons && result.installedAddons.length > 0) {
                        const names = result.installedAddons.map(id => {
                            const a = (_currentModule.manifest?.addons || []).find(x => x.moduleId === id);
                            return a ? (a.labelKey ? (t(a.labelKey) || a.label) : a.label) || id : id;
                        });
                        detail += `\n\nEk bileşenler: ${names.join(', ')}`;
                    }
                    if (result.addonWarnings && result.addonWarnings.length > 0) {
                        detail += `\n\n⚠️ ${result.addonWarnings.join('\n⚠️ ')}`;
                    }

                    // Kurulum sonrası kullanıcıya gösterilecek manifest notu
                    // (ör. MFG Unlock: "oyunu bir kez yeniden başlatın")
                    const postNoteKey = _currentModule?.manifest?.metadata?.postInstallNoteKey;
                    if (postNoteKey) {
                        const note = t(postNoteKey);
                        if (note && note !== postNoteKey) detail += `\n\nℹ️ ${note}`;
                    }

                    if (result.partialFailures && result.partialFailures.length > 0) {
                        detail += `\n\n⚠️ Ek dosyalar indirilirken hata oluştu:\n` + result.partialFailures.map(f => `• ${f.label}: ${f.error}`).join('\n');
                    }

                    const isWarning = (result.partialFailures && result.partialFailures.length > 0) || (result.addonWarnings && result.addonWarnings.length > 0);
                    showInfoModal(isWarning ? 'Kurulum Tamamlandı (Uyarılarla)' : 'Kurulum Başarılı', detail, isWarning ? 'warning' : false, {
                        log: result.log,
                        logSummary: result.logSummary,
                        logFile: result.logFile
                    });
                    await refreshGame(_currentGame);
                    updateHomeStats();

                    // Bu kurulum bir ön koşulu tamamlamak için yapıldıysa,
                    // asıl kurulmak istenen modülün ekranına geri dön.
                    if (_returnToAfterPrereq) {
                        const back = _returnToAfterPrereq;
                        _returnToAfterPrereq = null;
                        setTimeout(() => openModuleInstallModal(back.module, back.game), 250);
                    }
                } else {
                    if (progressSec) progressSec.style.display = 'none';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Kurulumu Başlat';
                    
                    const errorDetail = result?.error || result?.message || (result?.failures ? result.failures.map(f => f.message).join('; ') : 'Bilinmeyen bir hata oluştu.');
                    console.error('[MODULE_INSTALL_FAILED_DETAIL]', {
                        error: errorDetail,
                        result,
                        log: result?.log
                    });

                    showInfoModal('Kurulum Hatası', errorDetail, true, {
                        log: result?.log,
                        logSummary: result?.logSummary,
                        logFile: result?.logFile
                    });
                }
            } catch (err) {
                if (window.electronAPI.removeModuleDownloadProgressListeners) {
                    window.electronAPI.removeModuleDownloadProgressListeners();
                }
                if (window.electronAPI.removeModuleProgressListeners) {
                    window.electronAPI.removeModuleProgressListeners();
                }
                if (progressSec) progressSec.style.display = 'none';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Kurulumu Başlat';
                console.error('[MODULE_INSTALL_EXCEPTION]', err);
                showInfoModal('Hata', err.message || 'Beklenmeyen hata oluştu.', true);
            }
        });
    }
}
