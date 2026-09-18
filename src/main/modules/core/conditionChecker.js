'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { app } = require('electron');
const utils = require('../../utils');

const TAG = '[CONDITION_CHECKER]';

let cachedGpuInfo = null;

async function getGpuInfo() {
    if (cachedGpuInfo) {
        return cachedGpuInfo;
    }

    console.log(`${TAG} GPU bilgisi alınıyor...`);
    return new Promise((resolve, reject) => {
        execFile('powershell.exe', [
            '-NoProfile',
            '-Command',
            '(Get-CimInstance Win32_VideoController | Where-Object { $_.Status -eq "OK" } | Select-Object -First 1).Name'
        ], (error, stdout, stderr) => {
            if (error) {
                console.error(`${TAG} Hata (getGpuInfo):`, error);
                cachedGpuInfo = { vendor: 'unknown', name: 'Unknown GPU' };
                return resolve(cachedGpuInfo);
            }

            const name = stdout.trim();
            const lowerName = name.toLowerCase();
            let vendor = 'unknown';

            if (lowerName.includes('nvidia') || lowerName.includes('geforce') || lowerName.includes('rtx') || lowerName.includes('gtx')) {
                vendor = 'nvidia';
            } else if (lowerName.includes('amd') || lowerName.includes('radeon') || lowerName.includes('rx ')) {
                vendor = 'amd';
            } else if (lowerName.includes('intel') || lowerName.includes('uhd') || lowerName.includes('iris')) {
                vendor = 'intel';
            }

            cachedGpuInfo = { vendor, name };
            console.log(`${TAG} GPU bulundu: ${name} (${vendor})`);
            resolve(cachedGpuInfo);
        });
    });
}

function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    const len = Math.max(parts1.length, parts2.length);
    for (let i = 0; i < len; i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
}

async function checkConditions(conditions, context) {
    console.log(`${TAG} Koşullar kontrol ediliyor...`);
    const { gameDir, gameState } = context || {};
    const failures = [];

    if (!conditions || conditions.length === 0) {
        return { passed: true, failures };
    }

    for (const condition of conditions) {
        // enabled: false ise koşul kontrol edilmeden atlanır
        if (condition.enabled === false) {
            console.log(`${TAG} Koşul devre dışı (enabled: false), atlanıyor: ${condition.type}`);
            continue;
        }

        const { type, message } = condition;
        let passed = true;
        let errorMessage = message || `Bilinmeyen hata (${type})`;

        try {
            switch (type) {
                case 'file_exists': {
                    if (!gameDir) throw new Error('gameDir is required for file_exists');
                    const filePath = path.join(gameDir, condition.path);
                    if (!fs.existsSync(filePath)) {
                        passed = false;
                    }
                    break;
                }
                case 'file_not_exists': {
                    if (!gameDir) throw new Error('gameDir is required for file_not_exists');
                    const filePath = path.join(gameDir, condition.path);
                    if (fs.existsSync(filePath)) {
                        passed = false;
                    }
                    break;
                }
                case 'gpu_vendor': {
                    const gpu = await getGpuInfo();
                    if (gpu.vendor !== condition.vendor.toLowerCase()) {
                        passed = false;
                    }
                    break;
                }
                case 'mod_installed': {
                    if (gameState && gameState[condition.flag] !== condition.value) {
                        passed = false;
                    }
                    break;
                }
                case 'min_app_version': {
                    const currentVersion = app ? app.getVersion() : '0.0.0';
                    if (compareVersions(currentVersion, condition.version) < 0) {
                        passed = false;
                        errorMessage = message || `Bu mod en az V-Manager sürüm ${condition.version} gerektirir. (Mevcut: ${currentVersion})`;
                    }
                    break;
                }
                case 'check_conflicts': {
                    if (!gameDir) break; // Skip if gameDir not resolved yet
                    const candidates = condition.candidates || [];
                    const ignoreMatches = (condition.ignoreDescriptionMatches || []).map(m => m.toLowerCase());

                    const windowsSystemPatterns = [
                        'windows image helper', 'debug help library', 'directx graphics infrastructure',
                        'direct3d 12 runtime', 'microsoft windows control api', 'internet extensions for win32',
                        'windows http services', 'version checking and file installation libraries', 'process status helper'
                    ];

                    for (const dllName of candidates) {
                        const dllPath = path.join(gameDir, dllName);
                        if (fs.existsSync(dllPath)) {
                            let desc = '';
                            try {
                                desc = await utils.getFileDescription(dllPath);
                            } catch (e) { desc = ''; }
                            const descLow = (desc || '').toLowerCase();

                            const isIgnoredMod = ignoreMatches.some(m => descLow.includes(m));
                            const isWinSystem = windowsSystemPatterns.some(p => descLow.includes(p));

                            if (!isIgnoredMod && !isWinSystem) {
                                passed = false;
                                errorMessage = message || `Çakışan mod tespit edildi: ${dllName}`;
                                break;
                            }
                        }
                    }
                    break;
                }
                default:
                    console.warn(`${TAG} Bilinmeyen koşul tipi: ${type}`);
                    break;
            }
        } catch (err) {
            console.error(`${TAG} Hata (checkConditions, ${type}):`, err);
            passed = false;
            errorMessage = `Hata oluştu: ${err.message}`;
        }

        if (!passed) {
            failures.push({ type, message: errorMessage });
        }
    }

    const result = {
        passed: failures.length === 0,
        failures
    };

    console.log(`${TAG} Kontrol sonucu: ${result.passed ? 'BAŞARILI' : 'BAŞARISIZ'}`);
    return result;
}

module.exports = {
    checkConditions,
    getGpuInfo
};
