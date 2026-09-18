import { t } from '../i18n/i18n.js';
import { showInfoModal } from './modals/info.js';

const DEFAULT_TOOLS = [
    {
        id: 'JAMSoftware.TreeSize.Free',
        slug: 'treesize',
        name: 'TreeSize Free',
        categoryKey: 'tools.catDisk',
        icon: '📊',
        descriptionKey: 'tools.treesizeDesc',
        officialUrl: 'https://www.jam-software.com/treesize_free',
        isInstalled: false,
        installedVersion: null,
        availableVersion: null,
        hasUpdate: false
    },
    {
        id: 'voidtools.Everything',
        slug: 'everything',
        name: 'Everything Search',
        categoryKey: 'tools.catSearch',
        icon: '🔍',
        descriptionKey: 'tools.everythingDesc',
        officialUrl: 'https://www.voidtools.com/',
        isInstalled: false,
        installedVersion: null,
        availableVersion: null,
        hasUpdate: false
    },
    {
        id: 'obteknoloji.UToolbox',
        slug: 'utoolbox',
        name: 'Ü Toolbox',
        categoryKey: 'tools.catSystem',
        icon: '🛠️',
        descriptionKey: 'tools.utoolboxDesc',
        officialUrl: 'https://github.com/obteknoloji/u-toolbox',
        isInstalled: false,
        installedVersion: null,
        availableVersion: null,
        hasUpdate: false
    }
];

let toolsState = {
    winget: { available: false, version: null },
    tools: [...DEFAULT_TOOLS],
    loading: false,
    activeOperations: {} // toolId -> { operation, logs: [], status: 'running'|'done'|'error' }
};

let listenersInitialized = false;

/**
 * Initializes the Tools UI module.
 */
export function initTools() {
    initToolsListeners();

    // Render cards immediately with default catalog
    renderToolsUI();

    // Listen for tab activation to refresh status
    document.addEventListener('tab-activated', (e) => {
        if (e.detail && e.detail.tabId === 'tools') {
            loadToolsStatus();
        }
    });

    // Listen for language changes to re-render
    document.addEventListener('language-changed', () => {
        renderWingetStatus();
        renderToolsUI();
    });

    // Initial status check
    loadToolsStatus();
}

function initToolsListeners() {
    if (listenersInitialized) return;
    listenersInitialized = true;

    // Refresh button listener
    const refreshBtn = document.getElementById('tools-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshBtn.classList.add('rotating');
            loadToolsStatus().finally(() => {
                setTimeout(() => refreshBtn.classList.remove('rotating'), 600);
            });
        });
    }

    // Winget log listener
    if (window.electronAPI && window.electronAPI.onToolsOperationLog) {
        window.electronAPI.onToolsOperationLog((data) => {
            const { toolId, text, type } = data;
            if (!toolsState.activeOperations[toolId]) {
                toolsState.activeOperations[toolId] = {
                    operation: data.operation,
                    logs: [],
                    status: 'running'
                };
            }
            toolsState.activeOperations[toolId].logs.push({ text, type });
            appendLogToUI(toolId, text, type);
        });
    }
}

/**
 * Loads current status of winget and catalog tools.
 */
export async function loadToolsStatus() {
    if (!window.electronAPI || !window.electronAPI.toolsGetStatus) return;

    // Clear completed operation logs on refresh so old drawers don't stay open
    Object.keys(toolsState.activeOperations).forEach(id => {
        if (toolsState.activeOperations[id]?.status !== 'running') {
            delete toolsState.activeOperations[id];
        }
    });

    toolsState.loading = true;
    renderWingetStatus();

    try {
        const data = await window.electronAPI.toolsGetStatus();
        if (data) {
            toolsState.winget = data.winget || { available: false, version: null };
            toolsState.tools = data.tools || [];
        }
    } catch (err) {
        console.error('[Tools] Failed to get tools status:', err);
    } finally {
        toolsState.loading = false;
        renderWingetStatus();
        renderToolsUI();
    }
}

/**
 * Renders the top-right Winget status indicator.
 */
function renderWingetStatus() {
    const statusContainer = document.getElementById('tools-winget-status');
    const textEl = document.getElementById('tools-winget-text');
    if (!statusContainer || !textEl) return;

    if (toolsState.loading && !toolsState.tools.length) {
        statusContainer.className = 'tools-winget-status checking';
        textEl.textContent = t('tools.operationInProgress') || 'Kontrol Ediliyor...';
        return;
    }

    if (toolsState.winget.available) {
        statusContainer.className = 'tools-winget-status ready';
        textEl.textContent = `${t('tools.wingetReady') || 'Winget Hazır'} (${toolsState.winget.version})`;
        statusContainer.title = `Windows Package Manager: ${toolsState.winget.version}`;
    } else {
        statusContainer.className = 'tools-winget-status missing';
        textEl.textContent = t('tools.wingetMissing') || 'Winget Bulunamadı';
        statusContainer.title = 'winget CLI bulunamadı. Lütfen Windows Güncellemelerini veya App Installer\'ı yükleyin.';
    }
}

/**
 * Renders all tool cards in the grid.
 */
function renderToolsUI() {
    const grid = document.getElementById('tools-grid');
    if (!grid) return;

    if (toolsState.loading && toolsState.tools.length === 0) {
        grid.innerHTML = `
            <div class="tools-loading-state">
                <div class="tools-spinner"></div>
                <span>${t('tools.operationInProgress') || 'Araçlar ve sistem durumu kontrol ediliyor...'}</span>
            </div>
        `;
        return;
    }

    if (!toolsState.tools || toolsState.tools.length === 0) {
        grid.innerHTML = `
            <div class="tools-empty-state">
                <p>Gösterilecek araç bulunamadı.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = '';

    toolsState.tools.forEach((tool) => {
        const card = createToolCard(tool);
        grid.appendChild(card);
    });
}

/**
 * Creates an individual tool DOM card.
 */
function createToolCard(tool) {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.id = `tool-card-${tool.slug}`;

    const op = toolsState.activeOperations[tool.id];
    const isWorking = op && op.status === 'running';

    // Header with Icon, Title, and Category badge
    const header = document.createElement('div');
    header.className = 'tool-header';

    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'tool-icon-wrapper';
    iconWrapper.innerHTML = `<span class="tool-icon">${tool.icon}</span>`;

    const titleGroup = document.createElement('div');
    titleGroup.className = 'tool-title-group';

    const titleRow = document.createElement('div');
    titleRow.className = 'tool-title-row';

    const title = document.createElement('h3');
    title.className = 'tool-title';
    title.textContent = tool.name;

    const categoryBadge = document.createElement('span');
    categoryBadge.className = 'tool-category-badge';
    categoryBadge.textContent = t(tool.categoryKey) || tool.categoryKey;

    titleRow.appendChild(title);
    titleRow.appendChild(categoryBadge);

    const packageId = document.createElement('span');
    packageId.className = 'tool-package-id';
    packageId.textContent = tool.id;

    titleGroup.appendChild(titleRow);
    titleGroup.appendChild(packageId);

    header.appendChild(iconWrapper);
    header.appendChild(titleGroup);

    // Status Banner
    const statusRow = document.createElement('div');
    statusRow.className = 'tool-status-row';

    let statusBadgeClass = 'status-not-installed';
    let statusText = t('tools.statusNotInstalled') || 'Kurulu Değil';

    if (tool.isInstalled) {
        if (tool.hasUpdate && tool.availableVersion) {
            statusBadgeClass = 'status-update-available';
            statusText = `${t('tools.statusUpdateAvailable') || 'Güncelleme Mevcut'} (${tool.installedVersion} ➔ ${tool.availableVersion})`;
        } else {
            statusBadgeClass = 'status-installed';
            statusText = `${t('tools.statusInstalled') || 'Kurulu'} (${tool.installedVersion})`;
        }
    }

    statusRow.innerHTML = `
        <span class="tool-status-badge ${statusBadgeClass}">
            <span class="status-indicator-dot"></span>
            <span class="status-label">${statusText}</span>
        </span>
    `;

    // Features / Description
    const features = document.createElement('div');
    features.className = 'tool-description';
    features.innerHTML = `<p>${t(tool.descriptionKey) || tool.descriptionKey}</p>`;

    // Action Buttons
    const actions = document.createElement('div');
    actions.className = 'tool-actions';

    if (!tool.isInstalled) {
        // Not installed: [ Install ] + [ Official Site ]
        const installBtn = document.createElement('button');
        installBtn.className = 'tool-btn btn-install';
        installBtn.disabled = isWorking;
        installBtn.innerHTML = isWorking
            ? `<div class="btn-spinner"></div> <span>${t('tools.installing') || 'Kuruluyor...'}</span>`
            : `<span>⬇️ ${t('tools.installBtn') || 'Otomatik Kur (Winget)'}</span>`;
        
        installBtn.addEventListener('click', () => handleToolOperation('install', tool));
        actions.appendChild(installBtn);
    } else {
        // Installed: [ Launch ] + (if update [ Upgrade ]) + [ Uninstall ]
        const launchBtn = document.createElement('button');
        launchBtn.className = 'tool-btn btn-launch';
        launchBtn.disabled = isWorking;
        launchBtn.innerHTML = `<span>🚀 ${t('tools.launchBtn') || 'Başlat'}</span>`;
        launchBtn.addEventListener('click', () => handleLaunchTool(tool));
        actions.appendChild(launchBtn);

        if (tool.hasUpdate) {
            const upgradeBtn = document.createElement('button');
            upgradeBtn.className = 'tool-btn btn-upgrade';
            upgradeBtn.disabled = isWorking;
            upgradeBtn.innerHTML = isWorking && op.operation === 'upgrade'
                ? `<div class="btn-spinner"></div> <span>${t('tools.upgrading') || 'Güncelleniyor...'}</span>`
                : `<span>🔄 ${t('tools.upgradeBtn') || 'Güncelle'}</span>`;
            upgradeBtn.addEventListener('click', () => handleToolOperation('upgrade', tool));
            actions.appendChild(upgradeBtn);
        }

        const uninstallBtn = document.createElement('button');
        uninstallBtn.className = 'tool-btn btn-uninstall';
        uninstallBtn.disabled = isWorking;
        uninstallBtn.innerHTML = isWorking && op.operation === 'uninstall'
            ? `<div class="btn-spinner"></div> <span>${t('tools.uninstalling') || 'Kaldırılıyor...'}</span>`
            : `<span>🗑️ ${t('tools.uninstallBtn') || 'Kaldır'}</span>`;
        uninstallBtn.addEventListener('click', () => handleToolOperation('uninstall', tool));
        actions.appendChild(uninstallBtn);
    }

    // Official site button
    const siteBtn = document.createElement('button');
    siteBtn.className = 'tool-btn btn-site external-link';
    siteBtn.setAttribute('data-url', tool.officialUrl);
    siteBtn.innerHTML = `<span>🌐 ${t('tools.officialSiteBtn') || 'Resmi Site ➔'}</span>`;
    actions.appendChild(siteBtn);

    // Real-time Console Log Drawer
    const isDrawerOpen = isWorking || (op && op.status === 'running');
    const logDrawer = document.createElement('div');
    logDrawer.className = `tool-log-drawer ${isDrawerOpen ? 'expanded' : ''}`;
    logDrawer.id = `tool-log-drawer-${tool.slug}`;

    const logHeader = document.createElement('div');
    logHeader.className = 'tool-log-header';
    logHeader.innerHTML = `
        <span class="log-title">⚙️ ${t('tools.consoleLogs') || 'İşlem Günlüğü'}</span>
        <button class="log-toggle-btn" title="Kapat">✕</button>
    `;
    logHeader.querySelector('.log-toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        logDrawer.classList.remove('expanded');
        delete toolsState.activeOperations[tool.id];
    });

    const logConsole = document.createElement('div');
    logConsole.className = 'tool-log-console';
    logConsole.id = `tool-console-${tool.slug}`;

    if (op && op.logs) {
        op.logs.forEach(item => {
            const line = document.createElement('div');
            line.className = `log-line ${item.type || 'stdout'}`;
            line.textContent = item.text;
            logConsole.appendChild(line);
        });
    }

    logDrawer.appendChild(logHeader);
    logDrawer.appendChild(logConsole);

    // Assemble Card
    card.appendChild(header);
    card.appendChild(statusRow);
    card.appendChild(features);
    card.appendChild(actions);
    card.appendChild(logDrawer);

    return card;
}

/**
 * Appends streaming log text to the specific tool console.
 */
function appendLogToUI(toolId, text, type) {
    const tool = toolsState.tools.find(t => t.id === toolId);
    if (!tool) return;

    const drawer = document.getElementById(`tool-log-drawer-${tool.slug}`);
    const consoleEl = document.getElementById(`tool-console-${tool.slug}`);

    if (drawer) {
        drawer.classList.add('expanded');
    }

    if (consoleEl) {
        const line = document.createElement('div');
        line.className = `log-line ${type || 'stdout'}`;
        line.textContent = text;
        consoleEl.appendChild(line);
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }
}

/**
 * Handles install, uninstall, or upgrade operations.
 */
async function handleToolOperation(operation, tool) {
    if (!window.electronAPI) return;

    // Reset or initialize active operation
    toolsState.activeOperations[tool.id] = {
        operation,
        logs: [{ text: `[V-Manager] ${tool.name} ${operation} başlatılıyor...\n`, type: 'info' }],
        status: 'running'
    };

    renderToolsUI();

    try {
        let result;
        if (operation === 'install') {
            result = await window.electronAPI.toolsInstall(tool.id);
        } else if (operation === 'uninstall') {
            result = await window.electronAPI.toolsUninstall(tool.id);
        } else if (operation === 'upgrade') {
            result = await window.electronAPI.toolsUpgrade(tool.id);
        }

        if (result && result.tool) {
            // Update individual tool state
            const idx = toolsState.tools.findIndex(t => t.id === tool.id);
            if (idx !== -1) {
                toolsState.tools[idx] = result.tool;
            }
        } else {
            // Reload whole status
            await loadToolsStatus();
        }

        if (toolsState.activeOperations[tool.id]) {
            toolsState.activeOperations[tool.id].status = result && result.success ? 'done' : 'error';
        }

        if (result && result.success) {
            showInfoModal(t('tools.operationSuccess') || 'Başarılı', `${tool.name}: ${t('tools.operationSuccess') || 'İşlem başarıyla tamamlandı!'}`);
        } else if (result && result.error) {
            showInfoModal(t('tools.operationFailed') || 'Hata', `${tool.name}: ${result.error}`, true);
        }
    } catch (err) {
        console.error(`[Tools] Operation ${operation} failed:`, err);
        showInfoModal(t('tools.operationFailed') || 'Hata', err.message || 'Beklenmedik bir hata oluştu.', true);
        if (toolsState.activeOperations[tool.id]) {
            toolsState.activeOperations[tool.id].status = 'error';
        }
    } finally {
        renderToolsUI();
    }
}

/**
 * Handles launching the tool application.
 */
async function handleLaunchTool(tool) {
    if (!window.electronAPI || !window.electronAPI.toolsLaunch) return;

    try {
        const res = await window.electronAPI.toolsLaunch(tool.id);
        if (res && res.success) {
            // Application opened
            console.log(`[Tools] Successfully launched ${tool.name}`);
        } else {
            showInfoModal(t('tools.launchError') || 'Başlatılamadı', res && res.error ? res.error : `${tool.name} çalıştırılamadı.`, true);
        }
    } catch (err) {
        showInfoModal(t('tools.launchError') || 'Başlatılamadı', err.message, true);
    }
}
