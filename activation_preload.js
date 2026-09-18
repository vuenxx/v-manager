'use strict';

/**
 * activation_preload.js
 * Preload script for the activation window.
 * Exposes only the minimum required IPC functions via contextBridge.
 * contextIsolation: true, nodeIntegration: false
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('activationAPI', {
    /**
     * Get the current machine's HWID to display to the user.
     * @returns {Promise<string>}
     */
    getHwid: () => ipcRenderer.invoke('license:get-hwid'),

    /**
     * Get the last license status check result.
     * @returns {Promise<{ activated: boolean, hwid: string, error?: string }>}
     */
    getStatus: () => ipcRenderer.invoke('license:get-status'),

    /**
     * Submit an activation code for verification.
     * @param {string} code
     * @returns {Promise<{ success: boolean, error?: string }>}
     */
    activate: (code) => ipcRenderer.invoke('license:activate', code),

    /** Pencereyi küçült (özel başlık çubuğu). */
    minimizeWindow: () => ipcRenderer.invoke('activation:minimize'),

    /** Pencereyi kapat (özel başlık çubuğu). */
    closeWindow: () => ipcRenderer.invoke('activation:close'),
});
