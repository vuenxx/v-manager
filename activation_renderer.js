'use strict';

/**
 * activation_renderer.js
 * Client-side logic for the activation window.
 * Communicates with main process only through activationAPI (contextBridge).
 */

(async function () {
    const hwidDisplay = document.getElementById('hwid-display');
    const copyBtn     = document.getElementById('copy-btn');
    const codeInput   = document.getElementById('activation-code');
    const activateBtn = document.getElementById('activate-btn');
    const statusMsg   = document.getElementById('status-msg');

    // ── Load HWID & Status ──────────────────────────────────────────────────
    let currentHwid = '';
    try {
        currentHwid = await window.activationAPI.getHwid();
        hwidDisplay.textContent = currentHwid;
    } catch (e) {
        hwidDisplay.textContent = 'Hata: HWID alınamadı.';
    }

    try {
        const status = await window.activationAPI.getStatus();
        if (status && !status.activated && status.error) {
            showStatus(status.error, 'error');
        }
    } catch (e) {
        // Ignore errors fetching initial license check status
    }

    // ── Copy HWID button ───────────────────────────────────────────────────
    copyBtn.addEventListener('click', async () => {
        if (!currentHwid) return;
        try {
            await navigator.clipboard.writeText(currentHwid);
            copyBtn.textContent = 'Kopyalandı!';
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyBtn.textContent = 'Kopyala';
                copyBtn.classList.remove('copied');
            }, 2000);
        } catch {
            copyBtn.textContent = 'Hata';
        }
    });

    // ── Status helper ──────────────────────────────────────────────────────
    function showStatus(message, type /* 'error' | 'success' */) {
        statusMsg.textContent = message;
        statusMsg.className = `status show ${type}`;
    }

    function clearStatus() {
        statusMsg.className = 'status';
        statusMsg.textContent = '';
    }

    // ── Activate button ────────────────────────────────────────────────────
    activateBtn.addEventListener('click', async () => {
        const code = codeInput.value.trim();
        if (!code) {
            showStatus('Lütfen aktivasyon kodunu girin.', 'error');
            return;
        }

        clearStatus();
        activateBtn.disabled = true;
        activateBtn.textContent = 'Doğrulanıyor…';

        try {
            const result = await window.activationAPI.activate(code);
            if (result.success) {
                showStatus('Aktivasyon başarılı! Uygulama başlatılıyor…', 'success');
                activateBtn.textContent = '✓ Aktive Edildi';
                // Main process will open the main window and close this one
            } else {
                showStatus(result.error || 'Aktivasyon başarısız.', 'error');
                activateBtn.disabled = false;
                activateBtn.textContent = 'Aktive Et';
            }
        } catch (e) {
            showStatus(`Beklenmeyen hata: ${e.message}`, 'error');
            activateBtn.disabled = false;
            activateBtn.textContent = 'Aktive Et';
        }
    });

    // Pencere kontrolleri (ozel baslik cubugu)
    const minimizeBtn = document.getElementById('act-minimize-btn');
    const closeBtn = document.getElementById('act-close-btn');
    if (minimizeBtn && window.activationAPI && window.activationAPI.minimizeWindow) {
        minimizeBtn.addEventListener('click', () => window.activationAPI.minimizeWindow());
    }
    if (closeBtn && window.activationAPI && window.activationAPI.closeWindow) {
        closeBtn.addEventListener('click', () => window.activationAPI.closeWindow());
    }

    // Allow Enter key in textarea to trigger activation (Shift+Enter = newline)
    codeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            activateBtn.click();
        }
    });
}());
