'use strict';

/**
 * license.js
 * Offline HWID-based license verification using Ed25519 (Node built-in crypto).
 * - Reads machine ID via node-machine-id
 * - Verifies activation code signature with the embedded public key
 * - Persists license data encrypted with Electron safeStorage
 */

const crypto = require('crypto');
const path = require('path');
const { app, safeStorage } = require('electron');
const fs = require('fs');
const { machineId } = require('node-machine-id');

// ---------------------------------------------------------------------------
// Public key (Ed25519) — generated once via tools/generator.js --keygen
// Replace this placeholder with your real public key after running --keygen.
// ---------------------------------------------------------------------------
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAp1gFogAqqXh5c/eh8pGFGyyL9ng++AvmHcb81XMxaIE=
-----END PUBLIC KEY-----`;

// Path to the encrypted license file on disk
const LICENSE_FILE = path.join(app.getPath('userData'), 'license.dat');

// Set to true to bypass key verification (e.g. for open-source / public release)
const LICENSE_BYPASS = true;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a deterministic JSON string for the payload.
 * Key order is ALWAYS: { hwid, issuedAt, expiresAt }
 * This must match generator.js exactly.
 */
function serializePayload(hwid, issuedAt, expiresAt) {
    return JSON.stringify({ hwid, issuedAt, expiresAt });
}

/**
 * Returns the current machine's unique ID (raw, not hashed).
 */
async function getMachineId() {
    return await machineId(true);
}

// ---------------------------------------------------------------------------
// Core verification
// ---------------------------------------------------------------------------

/**
 * Verifies an activation code against the embedded public key and the given HWID.
 *
 * Activation code format (produced by generator.js):
 *   base64url(payloadJson) + '.' + base64(ed25519Signature)
 *
 * @param {string} activationCode  - Activation code string from generator.js
 * @param {string} hwid            - Current machine's HWID
 * @returns {{ valid: boolean, payload: object|null, error: string|null }}
 */
function verifyActivationCode(activationCode, hwid) {
    try {
        const parts = activationCode.trim().split('.');
        if (parts.length !== 2) {
            return { valid: false, payload: null, error: 'Geçersiz aktivasyon kodu formatı.' };
        }

        let payloadJson;
        try {
            payloadJson = Buffer.from(parts[0], 'base64url').toString('utf8');
        } catch {
            return { valid: false, payload: null, error: 'Aktivasyon kodu çözülemedi (payload).' };
        }

        let payload;
        try {
            payload = JSON.parse(payloadJson);
        } catch {
            return { valid: false, payload: null, error: 'Aktivasyon kodu içeriği geçersiz (JSON parse).' };
        }

        const signature = Buffer.from(parts[1], 'base64');

        // Validate payload structure
        // If expiresAt is undefined, it's an old key format - reject it.
        if (!payload.hwid || !payload.issuedAt || payload.expiresAt === undefined) {
            return { valid: false, payload: null, error: 'Eski veya geçersiz aktivasyon kodu formatı.' };
        }

        // HWID must match this machine
        if (payload.hwid !== hwid) {
            return { valid: false, payload: null, error: 'Bu aktivasyon kodu başka bir makineye ait.' };
        }

        // Reconstruct the exact serialized string that was signed (deterministic key order)
        const serialized = serializePayload(payload.hwid, payload.issuedAt, payload.expiresAt);

        // Verify Ed25519 signature using Node built-in crypto
        const isValid = crypto.verify(
            null,
            Buffer.from(serialized, 'utf8'),
            PUBLIC_KEY_PEM,
            signature
        );

        if (!isValid) {
            return { valid: false, payload: null, error: 'İmza doğrulaması başarısız. Aktivasyon kodu geçersiz.' };
        }

        // Check expiration
        if (payload.expiresAt !== null) {
            const expTime = new Date(payload.expiresAt).getTime();
            if (isNaN(expTime)) {
                return { valid: false, payload: null, error: 'Geçersiz son kullanma tarihi formatı.' };
            }
            if (Date.now() > expTime) {
                return { valid: false, payload: null, error: 'Aktivasyon kodunun süresi dolmuş.' };
            }
        }

        return { valid: true, payload, error: null };

    } catch (err) {
        return { valid: false, payload: null, error: `Doğrulama hatası: ${err.message}` };
    }
}

// ---------------------------------------------------------------------------
// Persistence (safeStorage)
// ---------------------------------------------------------------------------

function saveLicense(activationCode, hwid, originalSavedAt = null) {
    const data = JSON.stringify({
        activationCode,
        hwid,
        savedAt: originalSavedAt || Date.now(),
        lastCheckedAt: Date.now()
    });

    if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(data);
        fs.writeFileSync(LICENSE_FILE, encrypted);
    } else {
        // Fallback if OS keychain unavailable (e.g. headless env)
        fs.writeFileSync(LICENSE_FILE, Buffer.from(data).toString('base64'));
    }
}

function loadLicense() {
    if (!fs.existsSync(LICENSE_FILE)) return null;
    try {
        const raw = fs.readFileSync(LICENSE_FILE);

        if (safeStorage.isEncryptionAvailable()) {
            const decrypted = safeStorage.decryptString(raw);
            return JSON.parse(decrypted);
        } else {
            return JSON.parse(Buffer.from(raw.toString(), 'base64').toString('utf8'));
        }
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks whether this machine is currently activated.
 * @returns {Promise<{ activated: boolean, hwid: string, error?: string }>}
 */
async function checkLicense() {
    if (LICENSE_BYPASS) {
        let hwid = 'BYPASS';
        try {
            hwid = await getMachineId();
        } catch (e) {
            // Ignore HWID error if machineId fails in bypass mode
        }
        return { activated: true, hwid };
    }

    const hwid = await getMachineId();
    const saved = loadLicense();

    if (!saved) {
        return { activated: false, hwid, error: 'Lisans bulunamadı.' };
    }

    // Extra guard: stored HWID must match current HWID (catches machine transfer)
    if (saved.hwid !== hwid) {
        return { activated: false, hwid, error: 'Makine kimliği uyuşmuyor. Yeniden aktivasyon gerekiyor.' };
    }

    // Re-verify the stored activation code against the current HWID
    const result = verifyActivationCode(saved.activationCode, hwid);
    if (!result.valid) {
        return { activated: false, hwid, error: result.error };
    }

    // Anti-rollback clock tampering protection
    const now = Date.now();

    // 1. Current time cannot be before activation code issue date
    if (result.payload && result.payload.issuedAt) {
        const issuedTime = new Date(result.payload.issuedAt).getTime();
        if (!isNaN(issuedTime) && now < issuedTime) {
            return { activated: false, hwid, error: 'Sistem saati geri alınmış. Lütfen saatinizi düzeltin.' };
        }
    }

    // 2. Current time cannot be before last checked time (stored in license file)
    if (saved.lastCheckedAt) {
        const lastCheckedTime = parseInt(saved.lastCheckedAt, 10);
        if (!isNaN(lastCheckedTime) && now < lastCheckedTime) {
            return { activated: false, hwid, error: 'Sistem saati geri alınmış. Lütfen saatinizi düzeltin.' };
        }
    }

    // Update lastCheckedAt to protect against rollback in the future
    try {
        saveLicense(saved.activationCode, hwid, saved.savedAt);
    } catch (e) {
        // Ignore write error if it happens, but fail/log gracefully
    }

    return { activated: true, hwid };
}

/**
 * Attempts to activate with the given activation code.
 * Saves to disk on success.
 * @param {string} activationCode
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function activate(activationCode) {
    if (LICENSE_BYPASS) {
        return { success: true };
    }

    const hwid = await getMachineId();
    const result = verifyActivationCode(activationCode, hwid);

    if (!result.valid) {
        return { success: false, error: result.error };
    }

    saveLicense(activationCode, hwid);
    return { success: true };
}

module.exports = { checkLicense, activate, getMachineId };
