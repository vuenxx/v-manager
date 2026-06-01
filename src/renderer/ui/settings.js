import { showInfoModal } from './modals/info.js';

const path = window._nodePath; // Not available — we use string ops

// ── Kullanıcı Oyun Yolları Tablosu ───────────────────────────────────────────

export async function renderUserGamesUI() {
    window.electronAPI.logToMain('renderUserGamesUI starting...');
    const listEl = document.getElementById('user-games-list');
    if (!listEl) {
        window.electronAPI.logToMain('ERROR: user-games-list element not found!');
        return;
    }
    listEl.innerHTML = '';

    try {
        const data = await window.electronAPI.getUserGames();
        const keys = Object.keys(data);
        window.electronAPI.logToMain(`renderUserGamesUI: Found ${keys.length} keys`);

        if (keys.length === 0) {
            listEl.innerHTML = `
                <tr>
                    <td colspan="4" style="padding: 20px; text-align: center; color: var(--text-secondary);">
                        Henüz kullanıcı tanımlı oyun yolu bulunmuyor.
                    </td>
                </tr>
            `;
            return;
        }

        keys.forEach(normKey => {
            const info = data[normKey];
            const displayName = info.display_name || normKey;
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
            tr.style.transition = 'background 0.2s';

            tr.innerHTML = `
                <td style="padding: 12px; font-weight: 600;">${displayName}</td>
                <td style="padding: 12px; font-family: monospace; font-size: 12px; color: var(--text-secondary); word-break: break-all;">${info.game_root || '-'}</td>
                <td style="padding: 12px; font-family: monospace; font-size: 12px; color: var(--text-secondary); word-break: break-all;">${info.exe_path || '-'}</td>
                <td style="padding: 12px; text-align: right;">
                    <button class="blacklist-remove-btn delete-user-game-btn" data-key="${normKey}" style="padding: 4px 10px; font-size: 12px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; border-radius: 4px; cursor: pointer; transition: background 0.2s;">Sil</button>
                </td>
            `;

            const deleteBtn = tr.querySelector('.delete-user-game-btn');
            deleteBtn.addEventListener('click', async () => {
                await window.electronAPI.deleteUserGame(normKey);
                renderUserGamesUI();
            });

            listEl.appendChild(tr);
        });
        window.electronAPI.logToMain('renderUserGamesUI: UI updated successfully');
    } catch (e) {
        window.electronAPI.logToMain(`ERROR in renderUserGamesUI: ${e.message}`);
        console.error("Load user games failed", e);
    }
}

// ── Geliştirici Oyunları (Salt Okunur) Tablosu ───────────────────────────────

async function renderDeveloperGamesUI() {
    const listEl = document.getElementById('dev-games-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    try {
        const data = await window.electronAPI.getDeveloperGames();
        const keys = Object.keys(data);

        if (keys.length === 0) {
            listEl.innerHTML = `<tr><td colspan="3" style="padding: 12px; color: var(--text-secondary); text-align: center;">Geliştirici oyun tanımı bulunamadı.</td></tr>`;
            return;
        }

        keys.forEach(normKey => {
            const info = data[normKey];
            const compatibility = info.compatibility || 'green';
            const tooltipText = compatibility === 'green'
                ? 'DLSS Enabler ve Optiscaler bu oyun ile tam uyumludur.'
                : 'Bu oyuna sadece Optiscaler uyumludur.';

            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
            tr.innerHTML = `
                <td style="padding: 10px; font-weight: 500; color: var(--text-secondary);">${normKey}</td>
                <td style="padding: 10px; font-family: monospace; font-size: 12px; color: var(--accent-color);">${info.exe_relative_path || '-'}</td>
                <td style="padding: 10px; text-align: center;">
                    <div class="settings-verified-badge" style="display: inline-block; cursor: pointer; position: relative;">
                        <img src="icons/verified_${compatibility}.png" style="width: 18px; height: 18px; vertical-align: middle;" />
                    </div>
                </td>
            `;

            // Hover events for tooltip in settings table
            const badge = tr.querySelector('.settings-verified-badge');
            if (badge) {
                badge.addEventListener('mouseenter', () => {
                    const tooltip = document.getElementById('global-tooltip');
                    if (tooltip) {
                        tooltip.textContent = tooltipText;
                        tooltip.style.display = 'block';

                        const rect = badge.getBoundingClientRect();
                        const tooltipRect = tooltip.getBoundingClientRect();

                        let top = rect.top - tooltipRect.height - 8;
                        let left = rect.left + (rect.width - tooltipRect.width) / 2;

                        if (left < 10) left = 10;
                        if (top < 10) top = rect.bottom + 8; // fallback below

                        tooltip.style.top = `${top}px`;
                        tooltip.style.left = `${left}px`;
                    }
                });

                badge.addEventListener('mouseleave', () => {
                    const tooltip = document.getElementById('global-tooltip');
                    if (tooltip) {
                        tooltip.style.display = 'none';
                    }
                });
            }

            listEl.appendChild(tr);
        });
    } catch (e) {
        console.error("Load developer games failed", e);
    }
}

// ── Auto-fill EXE yolunu developer-games.json'dan doldur ─────────────────────

/**
 * Verilen game_root ve gameName ile developer-games.json'dan exe_relative_path
 * alınır ve tam exe yolu döndürülür. Yoksa null döner.
 */
async function tryAutoFillExePath(gameRoot, gameName) {
    if (!gameRoot || !gameName) return null;
    try {
        const devGames = await window.electronAPI.getDeveloperGames();
        // Normalize: kebab-case
        const normKey = gameName
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .trim()
            .replace(/\s+/g, '-');

        if (devGames[normKey] && devGames[normKey].exe_relative_path) {
            const relPath = devGames[normKey].exe_relative_path.replace(/\//g, '\\');
            return gameRoot.replace(/\\/g, '/').replace(/\/$/, '').replace(/\//g, '\\') + '\\' + relPath;
        }
    } catch (e) {
        console.error('tryAutoFillExePath error:', e);
    }
    return null;
}

// ── Ayarlar Dinleyicileri ────────────────────────────────────────────────────

export function initSettingsListeners() {
    window.electronAPI.logToMain('initSettingsListeners starting...');

    // Initial render
    renderUserGamesUI();

    // ── Add user game ────────────────────────────────────────────────────────
    const addBtn = document.getElementById('ug-add-btn');
    const nameInp = document.getElementById('ug-game-name');
    const rootInp = document.getElementById('ug-game-root');
    const exeInp = document.getElementById('ug-exe-path');
    const exeHint = document.getElementById('ug-exe-hint');
    const browseBtn = document.getElementById('ug-browse-root-btn');

    // Browse for game_root
    if (browseBtn) {
        browseBtn.addEventListener('click', async () => {
            const folder = await window.electronAPI.selectFolder();
            if (!folder) return;
            rootInp.value = folder;

            // If game name is filled, try auto-fill exe path
            const gameName = nameInp.value.trim();
            if (gameName) {
                const autoExe = await tryAutoFillExePath(folder, gameName);
                if (autoExe) {
                    exeInp.value = autoExe;
                    if (exeHint) exeHint.style.display = 'inline';
                } else {
                    if (exeHint) exeHint.style.display = 'none';
                }
            }
        });
    }

    // When game name changes and game_root is set, try auto-fill
    if (nameInp) {
        let autoFillTimer = null;
        nameInp.addEventListener('input', () => {
            clearTimeout(autoFillTimer);
            autoFillTimer = setTimeout(async () => {
                const gameRoot = rootInp ? rootInp.value.trim() : '';
                const gameName = nameInp.value.trim();
                if (gameRoot && gameName) {
                    const autoExe = await tryAutoFillExePath(gameRoot, gameName);
                    if (autoExe) {
                        exeInp.value = autoExe;
                        if (exeHint) exeHint.style.display = 'inline';
                    } else {
                        if (exeHint) exeHint.style.display = 'none';
                    }
                }
            }, 400);
        });
    }

    // Browse for exe_path
    const browseExeBtn = document.getElementById('ug-browse-exe-btn');
    if (browseExeBtn) {
        browseExeBtn.addEventListener('click', async () => {
            const selected = await window.electronAPI.selectExe();
            if (selected && exeInp) {
                exeInp.value = selected;
                if (exeHint) exeHint.style.display = 'none'; // user chose manually
            }
        });
    }

    // Save
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            window.electronAPI.logToMain('Add user game button clicked');
            const gameName = nameInp ? nameInp.value.trim() : '';
            const gameRoot = rootInp ? rootInp.value.trim() : '';
            const exePath = exeInp ? exeInp.value.trim() : '';

            if (!gameName || !gameRoot) {
                showInfoModal("Hata", "Lütfen Oyun Adı ve Ana Klasör alanlarını doldurun!", true);
                return;
            }

            try {
                await window.electronAPI.saveUserGame({
                    gameName,
                    gameRoot,
                    exePath: exePath || gameRoot
                });

                // Clear inputs
                if (nameInp) nameInp.value = '';
                if (rootInp) rootInp.value = '';
                if (exeInp) exeInp.value = '';
                if (exeHint) exeHint.style.display = 'none';

                renderUserGamesUI();
                showInfoModal("Başarılı", `🎉 "${gameName}" için kullanıcı yolu başarıyla kaydedildi!`);
            } catch (e) {
                window.electronAPI.logToMain(`ERROR in saveUserGame: ${e.message}`);
                showInfoModal("Hata", "Yol kaydedilirken hata oluştu: " + e.message, true);
            }
        });
    }

    // ── Developer games toggle ───────────────────────────────────────────────
    const toggleDevBtn = document.getElementById('toggle-dev-games-btn');
    const devContainer = document.getElementById('dev-games-container');
    let devLoaded = false;

    if (toggleDevBtn && devContainer) {
        toggleDevBtn.addEventListener('click', async () => {
            const isVisible = devContainer.style.display !== 'none';
            if (isVisible) {
                devContainer.style.display = 'none';
                toggleDevBtn.textContent = 'Listeyi Göster';
            } else {
                devContainer.style.display = 'block';
                toggleDevBtn.textContent = 'Listeyi Gizle';
                if (!devLoaded) {
                    await renderDeveloperGamesUI();
                    devLoaded = true;
                }
            }
        });
    }

    // ── Refresh table whenever user navigates to settings tab ────────────────
    document.addEventListener('tab-activated', (e) => {
        if (e.detail && e.detail.tabId === 'settings-tab') {
            renderUserGamesUI();
        }
    });

    window.electronAPI.logToMain('initSettingsListeners: Done');
}
