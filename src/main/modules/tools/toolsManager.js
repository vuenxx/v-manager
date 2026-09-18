const { spawn } = require('child_process');
const { shell } = require('electron');
const path = require('path');
const fs = require('fs');

const TOOLS_CATALOG = [
    {
        id: 'JAMSoftware.TreeSize.Free',
        slug: 'treesize',
        name: 'TreeSize Free',
        categoryKey: 'tools.catDisk',
        icon: '📊',
        descriptionKey: 'tools.treesizeDesc',
        officialUrl: 'https://www.jam-software.com/treesize_free',
        exeCandidates: () => [
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'JAM Software', 'TreeSize Free', 'TreeSizeFree.exe'),
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'JAM Software', 'TreeSize Free', 'TreeSizeFree.exe'),
            path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'JAM Software', 'TreeSize Free', 'TreeSizeFree.exe')
        ]
    },
    {
        id: 'voidtools.Everything',
        slug: 'everything',
        name: 'Everything Search',
        categoryKey: 'tools.catSearch',
        icon: '🔍',
        descriptionKey: 'tools.everythingDesc',
        officialUrl: 'https://www.voidtools.com/',
        exeCandidates: () => [
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Everything', 'Everything.exe'),
            path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Everything', 'Everything.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Everything', 'Everything.exe')
        ]
    },
    {
        id: 'obteknoloji.UToolbox',
        slug: 'utoolbox',
        name: 'Ü Toolbox',
        categoryKey: 'tools.catSystem',
        icon: '🛠️',
        descriptionKey: 'tools.utoolboxDesc',
        officialUrl: 'https://github.com/obteknoloji/u-toolbox',
        exeCandidates: () => [
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'u-toolbox', 'Ü Toolbox.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'u-toolbox', 'u-toolbox.exe'),
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ü Toolbox', 'Ü Toolbox.exe'),
            path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Ü Toolbox', 'Ü Toolbox.exe')
        ]
    }
];

let activeProcess = null;

function getSpawnOptions() {
    const env = { ...process.env };
    const winApps = path.join(env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps');
    if (winApps && (!env.PATH || !env.PATH.toLowerCase().includes('windowsapps'))) {
        env.PATH = `${winApps};${env.PATH || ''}`;
    }
    return { shell: true, env };
}

/**
 * Checks if winget is available on the system and returns its version.
 */
function checkWinget() {
    return new Promise((resolve) => {
        const proc = spawn('winget', ['--version'], getSpawnOptions());
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        proc.on('error', () => {
            resolve({ available: false, version: null });
        });

        proc.on('close', (code) => {
            if (code === 0 && stdout.trim()) {
                resolve({ available: true, version: stdout.trim() });
            } else {
                resolve({ available: false, version: null, error: stderr.trim() });
            }
        });
    });
}

/**
 * Inspects a specific tool's installation state via winget list.
 */
function checkSingleToolStatus(tool) {
    return new Promise((resolve) => {
        const proc = spawn('winget', ['list', '--exact', '--id', tool.id], getSpawnOptions());
        let stdout = '';

        proc.stdout.on('data', (d) => { stdout += d.toString(); });

        proc.on('error', () => {
            resolve(fallbackStatusCheck(tool));
        });

        proc.on('close', (code) => {
            if (code === 0 && stdout.includes(tool.id)) {
                let installedVersion = null;
                let availableVersion = null;

                const lines = stdout.split(/\r?\n/).filter(l => l.trim().length > 0);
                for (const line of lines) {
                    if (line.includes(tool.id)) {
                        const parts = line.split(/\s{2,}/).map(p => p.trim());
                        const idIdx = parts.findIndex(p => p.toLowerCase() === tool.id.toLowerCase());
                        if (idIdx !== -1) {
                            installedVersion = parts[idIdx + 1] || null;
                            if (parts.length > idIdx + 3) {
                                availableVersion = parts[idIdx + 2] || null;
                            }
                        }
                        break;
                    }
                }

                resolve({
                    id: tool.id,
                    slug: tool.slug,
                    name: tool.name,
                    categoryKey: tool.categoryKey,
                    icon: tool.icon,
                    descriptionKey: tool.descriptionKey,
                    officialUrl: tool.officialUrl,
                    isInstalled: true,
                    installedVersion: installedVersion || 'Kurulu',
                    availableVersion: availableVersion,
                    hasUpdate: !!(availableVersion && availableVersion !== installedVersion),
                    exePath: findExecutable(tool)
                });
            } else {
                resolve(fallbackStatusCheck(tool));
            }
        });
    });
}

function findExecutable(tool) {
    const candidates = typeof tool.exeCandidates === 'function' ? tool.exeCandidates() : [];
    for (const cand of candidates) {
        if (cand && fs.existsSync(cand)) {
            return cand;
        }
    }
    return null;
}

function fallbackStatusCheck(tool) {
    const exe = findExecutable(tool);
    if (exe) {
        return {
            id: tool.id,
            slug: tool.slug,
            name: tool.name,
            categoryKey: tool.categoryKey,
            icon: tool.icon,
            descriptionKey: tool.descriptionKey,
            officialUrl: tool.officialUrl,
            isInstalled: true,
            installedVersion: 'Kurulu',
            availableVersion: null,
            hasUpdate: false,
            exePath: exe
        };
    }
    return {
        id: tool.id,
        slug: tool.slug,
        name: tool.name,
        categoryKey: tool.categoryKey,
        icon: tool.icon,
        descriptionKey: tool.descriptionKey,
        officialUrl: tool.officialUrl,
        isInstalled: false,
        installedVersion: null,
        availableVersion: null,
        hasUpdate: false,
        exePath: null
    };
}

/**
 * Returns overall tools status.
 */
async function getToolsStatus() {
    const wingetInfo = await checkWinget();
    const toolResults = await Promise.all(TOOLS_CATALOG.map(t => checkSingleToolStatus(t)));

    return {
        winget: wingetInfo,
        tools: toolResults
    };
}

/**
 * Executes a winget command (install, uninstall, upgrade) with real-time log streaming.
 */
function runWingetOperation(operation, toolId, event) {
    return new Promise((resolve) => {
        if (activeProcess) {
            return resolve({ success: false, error: 'Başka bir işlem devam ediyor.' });
        }

        const tool = TOOLS_CATALOG.find(t => t.id === toolId || t.slug === toolId);
        if (!tool) {
            return resolve({ success: false, error: `Bilinmeyen araç: ${toolId}` });
        }

        let args = [];
        if (operation === 'install') {
            args = ['install', '--exact', '--id', tool.id, '--accept-source-agreements', '--accept-package-agreements'];
        } else if (operation === 'uninstall') {
            args = ['uninstall', '--exact', '--id', tool.id, '--accept-source-agreements'];
        } else if (operation === 'upgrade') {
            args = ['upgrade', '--exact', '--id', tool.id, '--accept-source-agreements', '--accept-package-agreements'];
        } else {
            return resolve({ success: false, error: `Geçersiz işlem: ${operation}` });
        }

        const sendLog = (text, type = 'stdout') => {
            if (event && event.sender && !event.sender.isDestroyed()) {
                event.sender.send('tools-operation-log', {
                    toolId: tool.id,
                    operation,
                    type,
                    text
                });
            }
        };

        sendLog(`[V-Manager] winget ${args.join(' ')} başlatılıyor...\n`);

        try {
            activeProcess = spawn('winget', args, getSpawnOptions());

            activeProcess.stdout.on('data', (data) => {
                const text = data.toString();
                sendLog(text, 'stdout');
            });

            activeProcess.stderr.on('data', (data) => {
                const text = data.toString();
                sendLog(text, 'stderr');
            });

            activeProcess.on('error', (err) => {
                sendLog(`\n[Hata] İşlem başlatılamadı: ${err.message}\n`, 'error');
                activeProcess = null;
                resolve({ success: false, error: err.message });
            });

            activeProcess.on('close', async (code) => {
                activeProcess = null;
                const isSuccess = (code === 0);
                if (isSuccess) {
                    sendLog(`\n[V-Manager] İşlem başarıyla tamamlandı! (Çıkış Kodu: 0)\n`, 'success');
                } else {
                    sendLog(`\n[V-Manager] İşlem tamamlandı (Çıkış Kodu: ${code})\n`, 'warning');
                }

                // Check updated status
                const updatedStatus = await checkSingleToolStatus(tool);
                resolve({
                    success: isSuccess || updatedStatus.isInstalled,
                    code,
                    tool: updatedStatus
                });
            });
        } catch (err) {
            activeProcess = null;
            resolve({ success: false, error: err.message });
        }
    });
}

/**
 * Launches the installed tool.
 */
async function launchTool(toolId) {
    const tool = TOOLS_CATALOG.find(t => t.id === toolId || t.slug === toolId);
    if (!tool) {
        return { success: false, error: 'Araç bulunamadı.' };
    }

    const exe = findExecutable(tool);
    if (exe && fs.existsSync(exe)) {
        try {
            // Electron shell.openPath uses Windows ShellExecuteEx, which triggers UAC elevation prompts properly
            const openError = await shell.openPath(exe);
            if (!openError) {
                return { success: true, method: 'shell.openPath', path: exe };
            }
            console.warn(`[Tools] shell.openPath returned error: ${openError}, attempting fallback...`);
        } catch (e) {
            console.error(`[Tools] Failed to launch with shell.openPath ${exe}:`, e);
        }
    }

    try {
        const proc = spawn('powershell', ['-Command', `Start-Process '${tool.name}' -ErrorAction SilentlyContinue`], {
            detached: true,
            stdio: 'ignore',
            shell: true
        });
        proc.on('error', (err) => {
            console.error(`[Tools] PowerShell launch error for ${tool.name}:`, err);
        });
        proc.unref();
        return { success: true, method: 'powershell' };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    TOOLS_CATALOG,
    getToolsStatus,
    runWingetOperation,
    launchTool
};
