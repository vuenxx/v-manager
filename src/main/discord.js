const { BrowserWindow } = require('electron');
const config = require('./config');

let RPC;
try {
    RPC = require('discord-rpc');
} catch (e) {
    console.error('[Discord RPC] Failed to load discord-rpc module:', e.message);
}

let rpcClient = null;
let reconnectTimeout = null;
let backoffIndex = 0;
const BACKOFF_DELAYS = [5000, 10000, 20000, 30000]; // 5s, 10s, 20s, 30s...

let lastPresenceString = '';
const startTime = Date.now();

// Constant configuration parameters
const CLIENT_ID = '1519739544478417026';

const TRANSLATIONS = {
    tr: {
        details: 'Mod Yöneticisi',
        buttonLabel: 'Web Sitesi'
    },
    en: {
        details: 'Mod Manager',
        buttonLabel: 'Web Site'
    }
};

function sendIpcToWindows(channel, payload) {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0 && !wins[0].webContents.isDestroyed()) {
        wins[0].webContents.send(channel, payload);
    }
}

function initDiscordRpc() {
    if (!RPC) {
        console.error('[Discord RPC] Cannot initialize: discord-rpc module is not loaded.');
        return;
    }

    const settings = config.getSettings();
    if (!settings.discordRpcEnabled) {
        shutdownDiscordRpc();
        return;
    }

    if (rpcClient) {
        shutdownDiscordRpc();
    }

    console.log(`[Discord RPC] Connecting with Client ID: ${CLIENT_ID}...`);
    rpcClient = new RPC.Client({ transport: 'ipc' });

    rpcClient.on('ready', () => {
        console.log(`[Discord RPC] Connected as ${rpcClient.user.username}`);
        backoffIndex = 0; // Reset backoff index on successful connection
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
        setPresence();
    });

    rpcClient.on('disconnected', () => {
        console.log('[Discord RPC] Disconnected from Discord.');
        handleReconnect();
    });

    rpcClient.login({ clientId: CLIENT_ID }).catch(err => {
        console.error(`[Discord RPC] Connection attempt failed: ${err.message}`);

        // Notify frontend if connection fails
        if (err.message.includes('RPC_CONNECTION_TIMEOUT') || err.message.includes('COULD_NOT_CONNECT') || err.message.includes('ENOENT')) {
            handleReconnect();
        } else {
            sendIpcToWindows('discord-rpc-error', `Discord RPC Bağlantı Hatası: ${err.message}`);
            handleReconnect();
        }
    });
}

function handleReconnect() {
    shutdownDiscordRpc();

    const settings = config.getSettings();
    if (!settings.discordRpcEnabled) return;

    const delay = BACKOFF_DELAYS[backoffIndex] || 30000;
    console.log(`[Discord RPC] Retrying connection in ${delay / 1000}s...`);

    if (backoffIndex < BACKOFF_DELAYS.length - 1) {
        backoffIndex++;
    }

    reconnectTimeout = setTimeout(() => {
        initDiscordRpc();
    }, delay);
}

function setPresence() {
    if (!rpcClient) return;

    const settings = config.getSettings();
    const lang = settings.language || 'tr';
    const text = TRANSLATIONS[lang] || TRANSLATIONS['tr'];

    // 1. Build presence object
    const presence = {
        details: text.details,
        state: 'V-Manager',
        largeImageKey: 'vmanager_logo',
        largeImageText: 'V-Manager',
        startTimestamp: startTime,
        buttons: [
            {
                label: text.buttonLabel,
                url: 'https://vuenxx.com/v-manager'
            }
        ]
    };

    // 2. Deduplicate (Cache check)
    const presenceString = JSON.stringify(presence);

    if (presenceString === lastPresenceString) {
        return; // Cache hit, identical presence
    }

    lastPresenceString = presenceString;

    rpcClient.setActivity(presence)
        .then(() => {
            console.log('[Discord RPC] Presence updated successfully.');
        })
        .catch(err => {
            console.error(`[Discord RPC] Failed to set activity: ${err.message}`);
        });
}

function shutdownDiscordRpc() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    if (rpcClient) {
        try {
            rpcClient.clearActivity();
            rpcClient.removeAllListeners();
            rpcClient.destroy();
        } catch (err) {
            console.error('[Discord RPC] Error while destroying client:', err.message);
        }
        rpcClient = null;
        console.log('[Discord RPC] Shut down and cleaned resources.');
    }

    lastPresenceString = '';
}

module.exports = {
    initDiscordRpc,
    setPresence,
    shutdownDiscordRpc
};
