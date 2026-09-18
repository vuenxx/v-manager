import { state } from '../../state.js';
import { openModal, closeModal } from './base.js';
import { openModuleInstallModal, initModuleInstallModalListeners } from './moduleInstall.js';

export async function renderModSelectionModal(game) {
    if (!game) return;
    state.currentSelectedGame = game;

    const modModalGameName = document.getElementById('mod-modal-game-name');
    if (modModalGameName) modModalGameName.textContent = game.name;

    const imgEl = document.getElementById('mod-modal-game-cover');
    const placeholderEl = document.getElementById('mod-modal-game-cover-placeholder');
    if (imgEl && placeholderEl) {
        if (game.cover) {
            imgEl.src = game.cover;
            imgEl.style.display = 'block';
            placeholderEl.style.display = 'none';
        } else {
            imgEl.style.display = 'none';
            placeholderEl.style.display = 'flex';
        }
    }

    const techContainer = document.getElementById('mod-modal-game-techs');
    if (techContainer) {
        let techHtml = '';
        if (game.upscalers) {
            if (game.upscalers.dlss) techHtml += '<span class="utag utag-dlss">DLSS</span>';
            if (game.upscalers.xess) techHtml += '<span class="utag utag-xess">XeSS</span>';
            if (game.upscalers.fsr) techHtml += '<span class="utag utag-fsr">FSR</span>';
        }
        if (!techHtml) {
            if (game.hasDlssEnabler || game.isDlssSupported) {
                techHtml += '<span class="utag utag-dlss">DLSS</span>';
            }
        }
        techContainer.innerHTML = techHtml;
    }

    const gridContainer = document.getElementById('mod-modal-options-grid');
    if (!gridContainer) {
        openModal('mod-modal');
        return;
    }

    gridContainer.innerHTML = `
        <div class="mod-options-loading" style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-secondary); font-size: 13px;">
            Modüller taranıyor...
        </div>
    `;

    openModal('mod-modal');

    try {
        let modules = [];
        if (window.electronAPI && window.electronAPI.moduleList) {
            modules = await window.electronAPI.moduleList();
        }

        // Eklenti (role: "addon") modülleri burada listelenmez — bunlar bağlı oldukları
        // modun kurulum ekranında onay kutusu olarak çıkar (ör. OptiScaler → OptiPatcher, FSR4).
        modules = (modules || []).filter(m => (m.role || m.manifest?.role || 'mod') !== 'addon');

        if (!modules || modules.length === 0) {
            gridContainer.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 20px; text-align: center; color: var(--text-secondary); font-size: 13px;">
                    Kullanılabilir mod bulunamadı.
                </div>
            `;
            return;
        }

        gridContainer.innerHTML = '';

        modules.forEach(mod => {
            const manifest = mod.manifest || {};
            const modId = mod.id;
            const modName = manifest.name || modId;
            const modDesc = manifest.description || '';
            const modType = mod.type || 'official';

            // Check if installed on current game
            let isInstalled = false;
            let installedVersion = null;

            // Kurulu mu? — tamamen manifest.state üzerinden.
            // (Eskiden burada dlssenabler/optiscaler/optibuilder/streamline için
            //  mod id'sine gömülü yedek kontroller vardı; artık her modül kendi
            //  state alanlarını manifest'te bildiriyor.)
            const stateFlag = manifest.state?.flag;
            const versionField = manifest.state?.versionField;

            if ((stateFlag && game[stateFlag]) || (versionField && game[versionField])) {
                isInstalled = true;
                if (versionField && game[versionField]) {
                    installedVersion = game[versionField];
                }
            }

            // Ön koşul ipucu — bu mod başka bir modül kurulmadan çalışmaz
            // (ör. MFG Unlock bir ReShade addon'u). Kart yine tıklanabilir
            // kalır; ayrıntı ve "Önce kur" butonu kurulum ekranında.
            let prereqHint = '';
            if (Array.isArray(manifest.requires) && manifest.requires.length > 0) {
                const missing = manifest.requires.filter(r => {
                    if (!r || !r.moduleId || r.enabled === false) return false;
                    if (r.severity === 'warn') return false;
                    const target = modules.find(m => m.id === r.moduleId);
                    const flag = target?.manifest?.state?.flag;
                    if (flag && game[flag] === true) return false;
                    if (game.installedMods && game.installedMods[r.moduleId]?.installed) return false;
                    return true;
                });
                if (missing.length > 0) {
                    const names = missing.map(r => {
                        const target = modules.find(m => m.id === r.moduleId);
                        return target?.manifest?.name || r.moduleId;
                    });
                    prereqHint = `<span class="mod-option-prereq-hint">⚠️ ${names.join(', ')} gerekir</span>`;
                }
            }

            const typeBadgeText = modType === 'official' ? '🛡️ Resmi' : (modType === 'community' ? '👥 Topluluk' : '⚡ Özel');

            // Manifest'te wizard tanımlıysa otomatik kurulum sihirbazı kullanılabilir.
            const hasWizard = Boolean(manifest.wizard);
            const wizardHint = hasWizard
                ? `<span class="mod-option-wizard-hint" title="Otomatik kurulum sihirbazı mevcut">🧙‍♂️ Oto kurulum</span>`
                : '';

            const card = document.createElement('div');
            card.className = `mod-option-card ${isInstalled ? 'installed' : ''}`;
            card.innerHTML = `
                <div>
                    <div class="mod-option-card-header">
                        <span class="mod-option-name" title="${modName}">${modName}</span>
                        <span class="mod-card-badge badge-${modType}">${typeBadgeText}</span>
                    </div>
                    <div class="mod-option-desc" title="${modDesc}">${modDesc || 'Özel modül paketi.'}</div>
                    ${wizardHint}
                    ${prereqHint}
                </div>
                <div class="mod-option-footer">
                    ${isInstalled ? `<span class="mod-card-installed-status">✓ Kurulu ${installedVersion ? `(${installedVersion})` : ''}</span>` : `<span style="color: var(--text-secondary);">Kurulum Yap</span>`}
                    <span style="font-size: 13px;">➔</span>
                </div>
            `;

            card.addEventListener('click', () => {
                closeModal('mod-modal');
                openModuleInstallModal(mod, game);
            });

            gridContainer.appendChild(card);
        });

    } catch (e) {
        gridContainer.innerHTML = `
            <div style="grid-column: 1 / -1; padding: 20px; text-align: center; color: #ef4444; font-size: 13px;">
                Modüller yüklenirken hata oluştu: ${e.message}
            </div>
        `;
    }
}

export function initModSelectionListeners() {
    initModuleInstallModalListeners();

    const newModBtn = document.getElementById('mod-modal-new-btn');
    if (newModBtn) {
        newModBtn.addEventListener('click', () => {
            closeModal('mod-modal');
            // Modlar sekmesi → Manifest Oluşturucu alt sekmesi.
            // (Eskiden hiç var olmayan [data-tab="manifests"] aranıyordu, buton ölüydü.)
            const modsNavBtn = document.querySelector('.nav-item[data-target="modes"]');
            if (modsNavBtn) modsNavBtn.click();

            const builderSubBtn = document.querySelector('.mods-sub-nav-item[data-mods-sub-target="mods-sub-builder"]');
            if (builderSubBtn) builderSubBtn.click();
        });
    }
}
