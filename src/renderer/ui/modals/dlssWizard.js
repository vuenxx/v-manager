import { openModal, closeModal } from './base.js';
import { showInfoModal, showConfirmDialog } from './info.js';
import { renderGames, updateHomeStats } from '../games.js';
import { t, getCurrentLang } from '../../i18n/i18n.js';

/**
 * Sihirbaz terminali — hem eski DLSS Enabler akışını (runDlssWizard) hem de
 * manifest tabanlı evrensel sihirbazı (moduleRunWizard) aynı canlı log UI'ında çalıştırır.
 *
 * moduleCtx verilirse ve manifest'te wizard tanımı varsa manifest motoru kullanılır;
 * verilmezse eski DLSS Enabler yolu korunur (dlss.js modalı bu yoldan çağırıyor).
 */

const DEFAULT_DLL_ORDER = ['version.dll', 'dxgi.dll', 'winmm.dll', 'dbghelp.dll', 'psapi.dll', 'winhttp.dll'];

let isWizardRunning = false;
let closeAttempts = 0;
let cancelRequested = false;
let hasStreamlineWarningPending = false;

// Aktif çalışan sihirbazın bağlamı — iptal ve kapanış bunun üzerinden karar verir.
let activeCtx = { useModuleEngine: false, moduleId: null };

export function isDlssWizardRunning() {
    return isWizardRunning;
}

/**
 * @param {object} game            Oyun nesnesi
 * @param {string} version         Kurulacak sürüm / tag
 * @param {string} dllName         İlk denenecek proxy DLL
 * @param {string} exePath         Oyun exe yolu
 * @param {string} downloadUrl     Seçilen release'in indirme linki
 * @param {object|null} moduleCtx  { id, manifest, preset } — manifest tabanlı modül bağlamı
 */
export async function openWizardModal(game, version, dllName, exePath, downloadUrl, moduleCtx = null) {
    if (isWizardRunning) return;
    if (!game) return;
    closeAttempts = 0;
    cancelRequested = false;

    const manifest = moduleCtx?.manifest || null;
    const autoTest = manifest?.wizard?.autoTest || {};
    const useModuleEngine = Boolean(manifest?.wizard);
    const moduleId = moduleCtx?.id || manifest?.id || 'dlssenabler';

    activeCtx = { useModuleEngine, moduleId };

    // Denenecek DLL listesi manifest'ten gelir; yoksa klasik sıra kullanılır.
    const candidates = (Array.isArray(autoTest.candidates) && autoTest.candidates.length > 0)
        ? autoTest.candidates
        : DEFAULT_DLL_ORDER;

    version = version || game[manifest?.state?.versionField] || game.dlssEnablerVersion || 'latest';
    dllName = dllName || autoTest.sourceFile || candidates[0] || 'version.dll';

    if (!exePath || !exePath.toLowerCase().endsWith('.exe')) {
        if (window.electronAPI && window.electronAPI.resolveGamePaths && game.name) {
            try {
                const paths = await window.electronAPI.resolveGamePaths(game.name, game.exePath || game.exe_path);
                if (paths && paths.exe_path && paths.exe_path.toLowerCase().endsWith('.exe')) {
                    exePath = paths.exe_path;
                }
            } catch (e) {
                console.error('[WIZARD_UI] resolveGamePaths error:', e);
            }
        }
        if (!exePath && (game.exePath || game.exe_path)) {
            const candidate = game.exePath || game.exe_path;
            if (candidate.toLowerCase().endsWith('.exe')) {
                exePath = candidate;
            }
        }
    }

    const wizardModal = document.getElementById('dlss-wizard-modal');
    const titleEl = document.getElementById('wizard-modal-title');
    const infoGame = document.getElementById('wizard-info-game');
    const infoExe = document.getElementById('wizard-info-exe');
    const infoPlatform = document.getElementById('wizard-info-platform');
    const infoVersion = document.getElementById('wizard-info-version');
    const infoDll = document.getElementById('wizard-info-dll');
    const logArea = document.getElementById('wizard-log-area');
    const dllListContainer = document.getElementById('wizard-dll-list');
    const statusText = document.getElementById('wizard-status-text');
    const spinner = document.getElementById('wizard-spinner');
    const finalBtn = document.getElementById('wizard-final-btn');

    if (!wizardModal) return;

    // Başlık: manifest wizard.title > "<Mod Adı> Sihirbazı" > varsayılan çeviri
    if (titleEl) {
        titleEl.textContent =
            manifest?.wizard?.title ||
            (manifest?.name ? `${manifest.name} Sihirbazı` : (t('wizard.modalTitle') || 'Kurulum Sihirbazı'));
    }

    if (infoGame) infoGame.textContent = game.name;
    if (infoExe) infoExe.textContent = exePath;
    if (infoPlatform) {
        const platform = game.source || 'manual';
        infoPlatform.textContent = platform.charAt(0).toUpperCase() + platform.slice(1);
    }
    if (infoVersion) infoVersion.textContent = version;
    if (infoDll) infoDll.textContent = dllName;

    // Log ve DLL listesini sıfırla
    if (logArea) logArea.innerHTML = '';
    const dllsToTry = [dllName, ...candidates.filter(d => d !== dllName)];
    const totalAttempts = dllsToTry.length;

    if (dllListContainer) {
        dllListContainer.innerHTML = '';
        dllsToTry.forEach((dll, idx) => {
            const item = document.createElement('div');
            item.className = 'wizard-dll-item';
            item.id = `wizard-dll-item-${dll.replace('.', '-')}`;
            item.innerHTML = `
                <span>[${idx + 1}/${totalAttempts}] ${dll}</span>
                <span class="dll-status">-</span>
            `;
            dllListContainer.appendChild(item);
        });
    }

    if (statusText) statusText.textContent = t('wizard.stepInstall');
    if (spinner) spinner.style.display = 'block';
    if (finalBtn) finalBtn.style.display = 'none';

    isWizardRunning = true;
    hasStreamlineWarningPending = false;
    openModal('dlss-wizard-modal');

    if (window.electronAPI.removeWizardLogListeners) {
        window.electronAPI.removeWizardLogListeners();
    }

    // Canlı log dinleyicisi — her iki motor da 'wizard-log' kanalını kullanır.
    window.electronAPI.onWizardLog((data) => {
        if (data.type === 'dll-attempt') {
            const { attemptIndex, totalAttempts: total, dllName: currentDll, status: dllStatus } = data.data;
            const item = document.getElementById(`wizard-dll-item-${currentDll.replace('.', '-')}`);
            if (item) {
                item.className = 'wizard-dll-item';
                const statusSpan = item.querySelector('.dll-status');

                if (dllStatus === 'trying') {
                    item.classList.add('active');
                    if (statusSpan) statusSpan.textContent = '→';
                    if (statusText) {
                        statusText.textContent = t('wizard.stepRetryDll')
                            .replace('{n}', attemptIndex)
                            .replace('{total}', total || totalAttempts)
                            .replace('{dll}', currentDll);
                    }
                } else if (dllStatus === 'ok') {
                    item.classList.add('ok');
                    if (statusSpan) statusSpan.textContent = '✅';
                } else if (dllStatus === 'failed') {
                    item.classList.add('failed');
                    if (statusSpan) statusSpan.textContent = '❌';
                }
            }
        } else if (data.type === 'waiting') {
            if (statusText) statusText.textContent = t('wizard.stepWaiting').replace('{n}', data.msg);
        } else {
            const line = document.createElement('div');
            line.className = `wizard-log-line ${data.type}`;
            line.textContent = data.msg;
            if (logArea) {
                logArea.appendChild(line);
                logArea.scrollTop = logArea.scrollHeight;
            }
        }
    });

    try {
        // Uygulanacak preset: modal seçimi > manifest wizard.applyPresetOnSuccess > klasik 'dev-best'
        const developerPreset =
            moduleCtx?.preset ||
            manifest?.wizard?.applyPresetOnSuccess ||
            (useModuleEngine ? null : 'dev-best');

        const payload = {
            game,
            version,
            dllName,
            downloadUrl,
            developerPreset,
            exePath,
            lang: getCurrentLang()
        };

        const result = useModuleEngine
            ? await window.electronAPI.moduleRunWizard({
                moduleId,
                gameName: game.name,
                ...payload
            })
            : await window.electronAPI.runDlssWizard(payload);

        isWizardRunning = false;

        if (spinner) spinner.style.display = 'none';
        if (statusText) {
            const wasCancelled = result && result.error === 'ABORTED';
            statusText.textContent = result.success
                ? t('wizard.finalSuccess')
                : (wasCancelled ? (t('wizard.cancelled') || 'Iptal edildi') : t('wizard.finalError'));
        }
        if (finalBtn) finalBtn.style.display = 'block';

        if (result.success) {
            // Streamline uyarısı yalnızca DLSS Enabler akışında anlamlı.
            hasStreamlineWarningPending = (moduleId === 'dlssenabler');
            if (result.games) {
                renderGames(result.games);
                updateHomeStats();
            }
        } else if (result.error && result.error !== 'ABORTED') {
            const line = document.createElement('div');
            line.className = 'wizard-log-line err';
            line.textContent = result.error;
            if (logArea) {
                logArea.appendChild(line);
                logArea.scrollTop = logArea.scrollHeight;
            }
        }
    } catch (err) {
        isWizardRunning = false;
        if (spinner) spinner.style.display = 'none';
        if (statusText) statusText.textContent = cancelRequested ? (t('wizard.cancelled') || 'Iptal edildi') : t('wizard.finalError');
        cancelRequested = false;
        if (finalBtn) finalBtn.style.display = 'block';

        const line = document.createElement('div');
        line.className = 'wizard-log-line err';
        line.textContent = `${t('opti.unexpectedError') || 'Beklenmeyen hata: '}${err.message}`;
        if (logArea) {
            logArea.appendChild(line);
            logArea.scrollTop = logArea.scrollHeight;
        }
    }
}

export async function closeWizardModal() {
    if (isWizardRunning) {
        const statusText = document.getElementById('wizard-status-text');
        if (cancelRequested) {
            showInfoModal(
                t('update.infoTitle') || (getCurrentLang() === 'en' ? 'Information' : 'Bilgi'),
                t('wizard.cancelling') || 'Iptal ediliyor...'
            );
            return;
        }

        const confirmCancel = await showConfirmDialog(
            t('wizard.cancelTitle') || (getCurrentLang() === 'en' ? 'Cancel Installation' : 'Kurulumu Iptal Et'),
            t('wizard.cancelMsg') || 'Kurulumu iptal etmek istiyor musunuz? Kopyalanan dosyalar kaldirilacak.'
        );
        if (confirmCancel) {
            cancelRequested = true;
            if (statusText) statusText.textContent = t('wizard.cancelling') || 'Iptal ediliyor...';
            // İptal doğru motora yönlendirilmeli.
            if (activeCtx.useModuleEngine) {
                await window.electronAPI.moduleAbortWizard();
            } else {
                await window.electronAPI.abortDlssWizard();
            }
        }
        return;
    }

    closeAttempts = 0;
    cancelRequested = false;
    closeModal('dlss-wizard-modal');

    if (window.electronAPI.removeWizardLogListeners) {
        window.electronAPI.removeWizardLogListeners();
    }

    if (hasStreamlineWarningPending) {
        hasStreamlineWarningPending = false;
        setTimeout(() => {
            showInfoModal('Streamline', t('wizard.streamlineWarning'));
        }, 300);
    }
}

export function initWizardListeners() {
    const closeBtn = document.getElementById('wizard-close-btn');
    const finalBtn = document.getElementById('wizard-final-btn');

    if (closeBtn) {
        closeBtn.addEventListener('click', closeWizardModal);
    }
    if (finalBtn) {
        finalBtn.addEventListener('click', closeWizardModal);
    }
}
