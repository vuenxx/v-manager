'use strict';

/**
 * vlss5Manager.js — VLSS5 (github.com/vuenxx/VLSS5) kurulum/güncelleme yöneticisi
 *
 * VLSS5, RTX kartlarda "pencere yöntemi" ile DLSS5 (Neural Rendering) çalıştıran
 * bağımsız bir program. V-Manager onu %APPDATA%/v-manager/vlss5/ altına kurar.
 *
 * Çalışması için NVIDIA sürücüsünden gelen telifli `nvngx_dlssnr.dll` dosyası
 * gerekir; bu dosya dağıtılamaz, kullanıcının kendi makinesinden gelmelidir
 * (sürükle-bırak, dosya seçici veya DriverStore taraması).
 *
 * Tasarım notu: kurulu olup olmadığı ASLA state dosyasından okunmaz, her zaman
 * diskten (`inspectInstallDir`) tespit edilir — kullanıcı klasörü silerse UI doğru
 * davranır. State dosyası yalnızca "hangi sürüm kuruldu" bilgisini tutar.
 */

const fs = require('fs');
const path = require('path');
const { shell, BrowserWindow } = require('electron');
const { spawn } = require('child_process');

const config = require('../../config');
const utils = require('../../utils');
const githubFetcher = require('../core/githubFetcher');
const archive = require('../core/archive');

const TAG = '[VLSS5]';

const VLSS5_ID = 'vlss5';                    // releaseCache dosya adı
const VLSS5_REPO = 'vuenxx/VLSS5';
const GITHUB_URL = 'https://github.com/vuenxx/VLSS5';
// Sıra önemli: önce ada göre spesifik glob, sonra genel. Zip ileride yayınlanırsa
// hiçbir kod değişmeden desteklenir.
const ASSET_GLOB = ['VLSS5*.rar', 'VLSS5*.zip', '*.rar', '*.zip'];
const EXE_NAME = 'VLSS5.exe';
const MODEL_DLL = 'nvngx_dlssnr.dll';        // kullanıcının sağlayacağı telifli model
const FORWARDER_DLL = 'nvngx.dll_dlssnr.dll'; // arşivden gelen yönlendirici (model DEĞİL)
const MIN_MODEL_DLL_SIZE = 100 * 1024;       // 100 KB — yanlış dosya filtresi

// Aynı anda tek kurulum/güncelleme (toolsManager.activeProcess deseni)
let activeOperation = null;
let operationStartedAt = 0;

// Kapatma kilidi için üst sınır: ağ takılırsa uygulama süresiz kapanamaz hale
// gelmemeli. Süre aşılırsa kilit bırakılır; yarım kalan iş zaten bir sonraki
// açılışta `checkForUpdatesOnStartup` tarafından onarılır.
const BUSY_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Kurulum/güncelleme sürüyor mu? Pencere kapatma guard'ı bunu kullanır
 * (src/main/window.js → 'close' handler).
 */
function isBusy() {
    if (activeOperation === null) return false;
    if (Date.now() - operationStartedAt > BUSY_LOCK_TIMEOUT_MS) {
        console.warn(`${TAG} İşlem ${Math.round(BUSY_LOCK_TIMEOUT_MS / 60000)} dakikadır sürüyor, kapatma kilidi bırakıldı.`);
        return false;
    }
    return true;
}

/**
 * Renderer'a olay yayını. Arka plan güncellemesinde IPC 'event' nesnesi olmadığı
 * için tüm pencerelere gönderilir.
 */
function broadcast(channel, payload) {
    try {
        if (!BrowserWindow || typeof BrowserWindow.getAllWindows !== 'function') return;
        for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
                win.webContents.send(channel, payload);
            }
        }
    } catch (e) {
        // Pencere yokken (çok erken açılış / test ortamı) sessizce geç —
        // bildirim gönderememek güncellemeyi durdurmamalı
        console.warn(`${TAG} Bildirim gönderilemedi (${channel}): ${e.message}`);
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────────────────────
// State dosyası
// ─────────────────────────────────────────────────────────────────────────────

function readState() {
    try {
        const f = config.VLSS5_STATE_FILE;
        if (fs.existsSync(f)) {
            return JSON.parse(fs.readFileSync(f, 'utf-8')) || {};
        }
    } catch (e) {
        console.error(`${TAG} State okunamadı:`, e.message);
    }
    return {};
}

function writeState(state) {
    try {
        config.atomicWriteFile(config.VLSS5_STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
        console.error(`${TAG} State yazılamadı:`, e.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Disk durumu
// ─────────────────────────────────────────────────────────────────────────────

/** Kurulum klasörünü tarar. State'e güvenmez, diske bakar. */
function inspectInstallDir() {
    const dir = config.vlss5Path;
    const result = {
        dir,
        exeExists: false, exePath: null,
        dllExists: false, dllPath: null,
        forwarderExists: false,
        files: []
    };

    try {
        result.files = fs.readdirSync(dir);
    } catch (e) {
        return result;
    }

    for (const name of result.files) {
        const low = name.toLowerCase();
        if (low === EXE_NAME.toLowerCase()) {
            result.exeExists = true;
            result.exePath = path.join(dir, name);
        } else if (low === MODEL_DLL.toLowerCase()) {
            result.dllExists = true;
            result.dllPath = path.join(dir, name);
        } else if (low === FORWARDER_DLL.toLowerCase()) {
            result.forwarderExists = true;
        }
    }

    return result;
}

/** GPU bilgisi — NVIDIA değilse UI sarı uyarı gösterir (engelleme yok). */
async function getGpuHint() {
    try {
        const conditionChecker = require('../core/conditionChecker');
        const gpu = await conditionChecker.getGpuInfo();
        return {
            gpuName: gpu.name || null,
            gpuSupported: gpu.vendor === 'nvidia'
        };
    } catch (e) {
        return { gpuName: null, gpuSupported: true };
    }
}

/**
 * Tam durum. Ağ hatasında bile yerel durum döner (latest* alanları null olur).
 * @param {{ forceRefresh?: boolean }} opts
 */
async function getStatus(opts = {}) {
    const insp = inspectInstallDir();
    const state = readState();
    const gpu = await getGpuHint();

    const installedVersion = insp.exeExists ? (state.installedVersion || null) : null;

    let latestTag = null;
    let latestAssetName = null;
    let latestSize = null;
    let publishedAt = null;
    let releaseError = null;
    let fromStaleCache = false;

    try {
        const res = await githubFetcher.fetchReleases(VLSS5_ID, VLSS5_REPO, {
            assetFilter: ASSET_GLOB,
            maxReleases: 5,
            forceRefresh: !!opts.forceRefresh
        });

        if (res.error) {
            releaseError = res.error;
        } else {
            fromStaleCache = !!res.fromStaleCache;
            const latest = githubFetcher.findRelease(res.releases || [], 'latest');
            if (latest) {
                latestTag = latest.tag;
                latestAssetName = latest.assetName;
                latestSize = latest.size;
                publishedAt = latest.publishedAt;
            }
        }
    } catch (e) {
        releaseError = e.message;
    }

    // Sürüm karşılaştırması yalnızca TAG üzerinde yapılır — asset adı ("VLSS5.0.4.rar")
    // compareVersions'ın rakam süzgecinden geçerse yanlış sonuç verir.
    let hasUpdate = false;
    if (insp.exeExists && latestTag) {
        hasUpdate = !installedVersion || utils.compareVersions(latestTag, installedVersion) > 0;
    }

    const isInstalled = insp.exeExists;
    const hasModelDll = insp.dllExists;
    const isReady = isInstalled && hasModelDll;

    let uiState = 'not-installed';
    if (isInstalled) {
        if (hasUpdate) uiState = 'update-available';
        else if (!hasModelDll) uiState = 'missing-dll';
        else uiState = 'installed';
    }

    return {
        installDir: insp.dir,
        isInstalled,
        installedVersion,
        hasModelDll,
        hasForwarder: insp.forwarderExists,
        isReady,
        latestVersion: latestTag,
        latestTag,
        latestAssetName,
        latestSize,
        publishedAt,
        hasUpdate,
        releaseError,
        fromStaleCache,
        gpuName: gpu.gpuName,
        gpuSupported: gpu.gpuSupported,
        githubUrl: GITHUB_URL,
        state: uiState
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Kurulum / güncelleme
// ─────────────────────────────────────────────────────────────────────────────

function emitProgress(event, payload) {
    // IPC çağrısından geldiyse yalnızca o pencereye, arka plan güncellemesinde
    // (event yok) açık tüm pencerelere gönderilir.
    if (event && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('vlss5-progress', payload);
        return;
    }
    broadcast('vlss5-progress', payload);
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

/** Arşivin ilk baytlarına bakarak bozuk/yarım indirmeyi yakalar. */
function verifyArchiveSignature(filePath) {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buf = Buffer.alloc(8);
        fs.readSync(fd, buf, 0, 8, 0);
        const isRar = buf.slice(0, 4).toString('latin1') === 'Rar!';
        const isZip = buf.slice(0, 2).toString('latin1') === 'PK';
        const is7z = buf.slice(0, 2).toString('hex') === '377a';
        return isRar || isZip || is7z;
    } finally {
        fs.closeSync(fd);
    }
}

/** VLSS5.exe şu anda çalışıyor mu? */
async function isAppRunning() {
    try {
        return await utils.isGameRunning(EXE_NAME);
    } catch (e) {
        return false;
    }
}

/**
 * Çalışan VLSS5.exe'yi kapatır. Önce nazik kapatma (WM_CLOSE), yanıt vermezse zorla.
 * @returns {Promise<{ closed: boolean, forced: boolean }>}
 */
async function closeRunningApp() {
    const runTaskkill = (args) => new Promise((resolve) => {
        const proc = spawn('taskkill.exe', args, { shell: false });
        proc.on('error', () => resolve(false));
        proc.on('close', () => resolve(true));
    });

    // 1. Nazik kapatma
    await runTaskkill(['/IM', EXE_NAME]);
    for (let i = 0; i < 12; i++) {           // ~6 sn
        await sleep(500);
        if (!(await isAppRunning())) return { closed: true, forced: false };
    }

    // 2. Zorla kapat
    console.warn(`${TAG} VLSS5 nazikçe kapanmadı, zorla kapatılıyor.`);
    await runTaskkill(['/F', '/IM', EXE_NAME]);
    for (let i = 0; i < 8; i++) {            // ~4 sn
        await sleep(500);
        if (!(await isAppRunning())) return { closed: true, forced: true };
    }

    return { closed: false, forced: true };
}

/**
 * Staging klasörünü temizler. Zorla kapatma sonrası kalan yarım .part dosyaları,
 * bozuk arşivler ve yarım çıkarılmış klasörler burada kalır.
 */
function clearStaging() {
    try {
        const dir = config.vlss5UpdatePath;
        for (const entry of fs.readdirSync(dir)) {
            fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
        }
    } catch (e) {
        console.warn(`${TAG} Staging temizlenemedi: ${e.message}`);
    }
}

/** Klasör ağacında belirli bir dosyayı arar (zip ileride klasörlü gelebilir). */
function findFileRecursive(rootDir, targetNameLow, depth = 0) {
    if (depth > 4) return null;
    let entries;
    try {
        entries = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch (e) {
        return null;
    }

    for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase() === targetNameLow) {
            return path.join(rootDir, entry.name);
        }
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const found = findFileRecursive(path.join(rootDir, entry.name), targetNameLow, depth + 1);
            if (found) return found;
        }
    }
    return null;
}

/**
 * VLSS5'i kurar veya günceller.
 *
 * Dayanıklılık: indirme/çıkarma kalıcı bir staging klasöründe yapılır
 * (`userData/vlss5-update`) ve her aşama `vlss5-state.json` → `pendingUpdate`
 * alanına yazılır. Uygulama zorla kapatılırsa bir sonraki açılışta
 * `repairPendingUpdate()` kaldığı yerden temizleyip tamamlar.
 *
 * @param {Electron.IpcMainInvokeEvent|null} event  ilerleme yayını için (yoksa broadcast)
 * @param {{ tag?: string, autoCloseRunningApp?: boolean, silent?: boolean }} opts
 */
async function install(event, opts = {}) {
    if (activeOperation) {
        return { success: false, errorCode: 'BUSY', error: 'Başka bir VLSS5 işlemi devam ediyor.' };
    }
    activeOperation = 'install';
    operationStartedAt = Date.now();

    const installDir = config.vlss5Path;
    const stagingDir = config.vlss5UpdatePath;
    const extractDir = path.join(stagingDir, 'extracted');

    const markPhase = (phase, extra = {}) => {
        const prev = readState();
        writeState({
            ...prev,
            pendingUpdate: { ...(prev.pendingUpdate || {}), phase, updatedAt: Date.now(), ...extra }
        });
    };

    try {
        // ── 1. Sürüm bilgisi ──────────────────────────────────────────────
        emitProgress(event, { phase: 'fetch', percent: 0, text: '' });
        const res = await githubFetcher.fetchReleases(VLSS5_ID, VLSS5_REPO, {
            assetFilter: ASSET_GLOB,
            maxReleases: 5,
            forceRefresh: true
        });
        if (res.error && (!res.releases || res.releases.length === 0)) {
            return { success: false, error: res.error };
        }
        const release = githubFetcher.findRelease(res.releases || [], opts.tag || 'latest');
        if (!release || !release.downloadUrl) {
            return { success: false, error: 'VLSS5 sürümü bulunamadı.' };
        }

        const assetName = release.assetName || 'vlss5-download';
        markPhase('start', { tag: release.tag, assetName, startedAt: Date.now() });

        // ── 2. VLSS5 çalışıyor mu? ────────────────────────────────────────
        if (await isAppRunning()) {
            if (!opts.autoCloseRunningApp) {
                return {
                    success: false,
                    errorCode: 'RUNNING',
                    error: 'VLSS5 şu anda çalışıyor. Lütfen programı kapatıp tekrar deneyin.'
                };
            }
            // Kullanıcıya haber ver, sonra kapat
            broadcast('vlss5-update-event', { type: 'closing-app' });
            const closeResult = await closeRunningApp();
            if (!closeResult.closed) {
                return {
                    success: false,
                    errorCode: 'RUNNING',
                    error: 'VLSS5 kapatılamadı. Lütfen elle kapatıp tekrar deneyin.'
                };
            }
            console.log(`${TAG} Güncelleme için VLSS5 kapatıldı${closeResult.forced ? ' (zorla)' : ''}.`);
        }

        // ── 3. Dosya kilidi testi — exe üzerine yazılabiliyor mu? ──────────
        const insp = inspectInstallDir();
        if (insp.exeExists) {
            const probe = insp.exePath + '.old';
            try {
                fs.renameSync(insp.exePath, probe);
                fs.renameSync(probe, insp.exePath);
            } catch (e) {
                if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') {
                    return {
                        success: false,
                        errorCode: 'RUNNING',
                        error: 'VLSS5 dosyaları kilitli. Lütfen programı kapatıp tekrar deneyin.'
                    };
                }
                throw e;
            }
        }

        // ── 4. İndir (atomik: .part → tamamlanınca rename) ────────────────
        if (!fs.existsSync(stagingDir)) fs.mkdirSync(stagingDir, { recursive: true });
        const archivePath = path.join(stagingDir, assetName);
        const partPath = archivePath + '.part';

        // Önceki denemeden sağlam bir arşiv kaldıysa tekrar indirme
        let needsDownload = true;
        if (fs.existsSync(archivePath)) {
            const sizeOk = !release.size || Math.abs(fs.statSync(archivePath).size - release.size) <= 1024;
            if (sizeOk && verifyArchiveSignature(archivePath)) {
                console.log(`${TAG} Önceki indirme sağlam, tekrar indirilmiyor: ${assetName}`);
                needsDownload = false;
            } else {
                fs.rmSync(archivePath, { force: true });
            }
        }
        // Yarım kalan .part her zaman atılır (Range devamı desteklenmiyor)
        fs.rmSync(partPath, { force: true });

        if (needsDownload) {
            markPhase('download', { tag: release.tag, assetName });
            emitProgress(event, { phase: 'download', percent: 0, text: '' });

            const downloaded = await githubFetcher.downloadAsset(
                release.downloadUrl,
                stagingDir,
                assetName + '.part',
                (percent, dl, total) => {
                    emitProgress(event, {
                        phase: 'download',
                        percent,
                        text: total ? `${mb(dl)} / ${mb(total)} MB` : `${mb(dl)} MB`
                    });
                }
            );

            // Bütünlük: boyut + arşiv imzası
            if (release.size && downloaded.size && Math.abs(downloaded.size - release.size) > 1024) {
                fs.rmSync(partPath, { force: true });
                return { success: false, errorCode: 'CORRUPT', error: 'İndirilen dosya eksik görünüyor. Lütfen tekrar deneyin.' };
            }
            if (!verifyArchiveSignature(downloaded.path)) {
                fs.rmSync(partPath, { force: true });
                return { success: false, errorCode: 'CORRUPT', error: 'İndirilen dosya geçerli bir arşiv değil. Lütfen tekrar deneyin.' };
            }

            // Doğrulandı → atomik olarak nihai ada al
            fs.renameSync(partPath, archivePath);
        }

        // ── 5. Arşivi aç ──────────────────────────────────────────────────
        markPhase('extract', { tag: release.tag, assetName });
        emitProgress(event, { phase: 'extract', percent: 0, text: '' });
        fs.rmSync(extractDir, { recursive: true, force: true });   // yarım kalmış çıkarma
        fs.mkdirSync(extractDir, { recursive: true });
        await archive.extractArchive(archivePath, extractDir);

        // ── 6. Dosyaları yerleştir ────────────────────────────────────────
        markPhase('install', { tag: release.tag, assetName });
        emitProgress(event, { phase: 'install', percent: 0, text: '' });

        const stagedExe = findFileRecursive(extractDir, EXE_NAME.toLowerCase());
        if (!stagedExe) {
            return { success: false, error: `Arşivde ${EXE_NAME} bulunamadı.` };
        }
        const sourceRoot = path.dirname(stagedExe);

        if (!fs.existsSync(installDir)) fs.mkdirSync(installDir, { recursive: true });

        let copied = 0;
        const entries = fs.readdirSync(sourceRoot, { withFileTypes: true });
        for (const entry of entries) {
            const src = path.join(sourceRoot, entry.name);
            const dst = path.join(installDir, entry.name);

            // Kullanıcının koyduğu model DLL'i güncelleme sırasında EZME
            if (entry.isFile() && entry.name.toLowerCase() === MODEL_DLL.toLowerCase() && fs.existsSync(dst)) {
                continue;
            }

            if (entry.isDirectory()) {
                fs.cpSync(src, dst, { recursive: true, force: true });
            } else {
                fs.copyFileSync(src, dst);
            }
            copied++;
        }

        // ── 7. Antivirüs kontrolü ─────────────────────────────────────────
        const finalExe = path.join(installDir, EXE_NAME);
        if (!fs.existsSync(finalExe)) {
            return {
                success: false,
                errorCode: 'AV_BLOCKED',
                error: 'Kurulum tamamlandı ama VLSS5.exe bulunamıyor. Antivirüsünüz dosyayı engellemiş olabilir.'
            };
        }

        // ── 8. State — pendingUpdate temizlenir (işlem tamamlandı) ─────────
        const prev = readState();
        delete prev.pendingUpdate;
        writeState({
            ...prev,
            installedVersion: release.tag,
            installedTag: release.tag,
            installedAt: Date.now(),
            assetName: release.assetName || null,
            exePath: finalExe
        });

        clearStaging();

        console.log(`${TAG} Kurulum tamamlandı: ${release.tag} (${copied} öğe)`);
        emitProgress(event, { phase: 'done', percent: 100, text: '' });

        const status = await getStatus();
        return { success: true, version: release.tag, status };

    } catch (err) {
        console.error(`${TAG} Kurulum hatası:`, err);
        emitProgress(event, { phase: 'error', percent: 0, text: err.message });
        return { success: false, error: err.message };
    } finally {
        activeOperation = null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// nvngx_dlssnr.dll (kullanıcı sağlar)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kullanıcının verdiği model DLL'ini kurulum klasörüne kopyalar.
 * @param {string} sourcePath
 */
async function setModelDll(sourcePath) {
    try {
        if (!sourcePath || !fs.existsSync(sourcePath)) {
            return { success: false, errorCode: 'NOT_FOUND', error: 'Dosya bulunamadı.' };
        }

        const baseName = path.basename(sourcePath);
        if (baseName.toLowerCase() !== MODEL_DLL.toLowerCase()) {
            return {
                success: false,
                errorCode: 'BAD_NAME',
                error: `Yalnızca ${MODEL_DLL} kabul edilir. Verilen: ${baseName}`
            };
        }

        const stat = fs.statSync(sourcePath);
        if (!stat.isFile() || stat.size < MIN_MODEL_DLL_SIZE) {
            return { success: false, errorCode: 'TOO_SMALL', error: 'Bu dosya geçerli bir DLSS modeli gibi görünmüyor.' };
        }

        const dir = config.vlss5Path;
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, MODEL_DLL);

        if (path.resolve(sourcePath).toLowerCase() !== path.resolve(dest).toLowerCase()) {
            fs.copyFileSync(sourcePath, dest);
        }

        writeState({ ...readState(), dllAddedAt: Date.now() });
        console.log(`${TAG} Model DLL yerleştirildi: ${dest}`);

        return { success: true, status: await getStatus() };
    } catch (err) {
        console.error(`${TAG} setModelDll hatası:`, err);
        return { success: false, errorCode: 'COPY_FAILED', error: err.message };
    }
}

/**
 * NVIDIA sürücü deposunda (DriverStore) nvngx_dlssnr.dll arar.
 * Kullanıcının kendi makinesindeki kendi sürücü dosyası kopyalanır —
 * hiçbir şey indirilmez veya dağıtılmaz.
 */
async function findModelDllInDriverStore() {
    const roots = [
        path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'DriverStore', 'FileRepository'),
        path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
    ];

    const candidates = [];

    for (const root of roots) {
        try {
            if (!fs.existsSync(root)) continue;

            // System32 kökünde doğrudan dosya olabilir
            const direct = path.join(root, MODEL_DLL);
            if (fs.existsSync(direct)) {
                candidates.push({ path: direct, mtime: fs.statSync(direct).mtimeMs });
                continue;
            }

            const dirs = fs.readdirSync(root, { withFileTypes: true })
                .filter(d => d.isDirectory() && /^nv/i.test(d.name));

            for (const d of dirs) {
                const p = path.join(root, d.name, MODEL_DLL);
                try {
                    if (fs.existsSync(p)) {
                        candidates.push({ path: p, mtime: fs.statSync(p).mtimeMs });
                    }
                } catch (e) { /* erişilemeyen klasörü atla */ }
            }
        } catch (e) {
            console.warn(`${TAG} DriverStore taranamadı (${root}): ${e.message}`);
        }
    }

    if (candidates.length === 0) {
        return { found: false };
    }

    candidates.sort((a, b) => b.mtime - a.mtime);
    const best = candidates[0];
    console.log(`${TAG} DriverStore'da model bulundu: ${best.path}`);

    const copyResult = await setModelDll(best.path);
    return { found: true, path: best.path, ...copyResult };
}

// ─────────────────────────────────────────────────────────────────────────────
// Başlatma / klasör / kaldırma
// ─────────────────────────────────────────────────────────────────────────────

/** VLSS5.exe'yi başlatır (toolsManager.launchTool deseni: önce shell.openPath, sonra PowerShell). */
async function launch() {
    const insp = inspectInstallDir();
    if (!insp.exeExists) {
        return { success: false, errorCode: 'NOT_INSTALLED', error: 'VLSS5 kurulu değil.' };
    }

    const warning = insp.dllExists ? undefined : 'MISSING_DLL';

    try {
        // shell.openPath → ShellExecuteEx; UAC yükseltme istemini doğru gösterir
        const err = await shell.openPath(insp.exePath);
        if (!err) {
            return { success: true, method: 'shell.openPath', path: insp.exePath, warning };
        }
        console.warn(`${TAG} shell.openPath başarısız: ${err}, PowerShell deneniyor`);
    } catch (e) {
        console.warn(`${TAG} shell.openPath istisnası: ${e.message}`);
    }

    try {
        const escaped = insp.exePath.replace(/'/g, "''");
        const child = spawn('powershell.exe', [
            '-NoProfile', '-Command', `Start-Process -FilePath '${escaped}'`
        ], { detached: true, stdio: 'ignore' });
        child.unref();
        return { success: true, method: 'powershell', path: insp.exePath, warning };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function openInstallFolder() {
    try {
        const dir = config.vlss5Path;
        const err = await shell.openPath(dir);
        if (err) return { success: false, error: err };
        return { success: true, path: dir };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/** Kurulum klasörünü tamamen siler (kullanıcının model DLL'i de gider). */
async function uninstall() {
    if (activeOperation) {
        return { success: false, errorCode: 'BUSY', error: 'Başka bir VLSS5 işlemi devam ediyor.' };
    }
    activeOperation = 'uninstall';
    operationStartedAt = Date.now();
    try {
        const dir = config.vlss5Path;
        fs.rmSync(dir, { recursive: true, force: true });
        writeState({});
        console.log(`${TAG} Kaldırıldı: ${dir}`);
        return { success: true, status: await getStatus() };
    } catch (err) {
        console.error(`${TAG} Kaldırma hatası:`, err);
        if (err.code === 'EBUSY' || err.code === 'EPERM') {
            return { success: false, errorCode: 'RUNNING', error: 'VLSS5 şu anda çalışıyor. Lütfen programı kapatıp tekrar deneyin.' };
        }
        return { success: false, error: err.message };
    } finally {
        activeOperation = null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Otomatik güncelleme + onarım
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Yarım kalmış bir güncelleme var mı? (uygulama zorla kapatıldıysa)
 * State'teki `pendingUpdate` işareti + diskteki kurulum karşılaştırılır.
 */
function inspectPendingUpdate() {
    const state = readState();
    const pending = state.pendingUpdate;
    const insp = inspectInstallDir();

    if (!pending) {
        // İşaret yok ama kurulum bozuksa (state kurulu diyor, exe yok) yine onarılmalı
        const brokenInstall = !!state.installedVersion && !insp.exeExists;
        return { needsRepair: brokenInstall, reason: brokenInstall ? 'missing-exe' : null, pending: null };
    }

    return {
        needsRepair: true,
        reason: `pending-${pending.phase || 'unknown'}`,
        pending
    };
}

/**
 * Açılışta çağrılır:
 *   1. Yarım kalan güncellemeyi onarır (staging temizlenir, kurulum tamamlanır)
 *   2. Yeni sürüm varsa arka planda indirip kurar
 *
 * Kullanıcıya haber verme işini renderer yapar; buradan `vlss5-update-event`
 * kanalına olaylar yayınlanır.
 *
 * @param {{ autoUpdate?: boolean }} opts
 */
async function checkForUpdatesOnStartup(opts = {}) {
    const autoUpdate = opts.autoUpdate !== false;

    try {
        const repair = inspectPendingUpdate();
        const insp = inspectInstallDir();

        // Kurulu değilse ve yarım iş de yoksa yapacak bir şey yok
        if (!insp.exeExists && !repair.needsRepair) {
            return { checked: false, reason: 'not-installed' };
        }

        // Hiç kurulmamışken yarıda kalan İLK kurulum: kullanıcı "Kur" demiş ama iş
        // tamamlanmamış. Bunu kendiliğinden kurmak istenmeyen davranış olur —
        // yalnızca artıklar temizlenir, kurulum kullanıcının kararına bırakılır.
        const state = readState();
        if (repair.needsRepair && !state.installedVersion && !insp.exeExists) {
            console.log(`${TAG} Tamamlanmamış ilk kurulum artıkları temizleniyor.`);
            const cleaned = readState();
            delete cleaned.pendingUpdate;
            writeState(cleaned);
            clearStaging();
            return { checked: false, reason: 'abandoned-first-install' };
        }

        if (repair.needsRepair) {
            console.log(`${TAG} Yarım kalmış işlem tespit edildi (${repair.reason}), onarılıyor...`);
            // Yarım .part / bozuk çıkarma artıkları atılır; sağlam arşiv varsa
            // install() onu yeniden indirmeden kullanır.
            const stagingDir = config.vlss5UpdatePath;
            try {
                for (const entry of fs.readdirSync(stagingDir)) {
                    if (entry.endsWith('.part') || entry === 'extracted') {
                        fs.rmSync(path.join(stagingDir, entry), { recursive: true, force: true });
                    }
                }
            } catch (e) { /* yoksay */ }

            broadcast('vlss5-update-event', { type: 'repairing', reason: repair.reason });
            const result = await install(null, { autoCloseRunningApp: true, silent: true });

            broadcast('vlss5-update-event', {
                type: result.success ? 'finished' : 'failed',
                repaired: true,
                version: result.version || null,
                error: result.success ? null : (result.error || null),
                errorCode: result.success ? null : (result.errorCode || null)
            });
            return { checked: true, repaired: true, ...result };
        }

        // Normal güncelleme kontrolü
        const status = await getStatus({ forceRefresh: true });
        if (!status.hasUpdate) {
            return { checked: true, hasUpdate: false, status };
        }

        console.log(`${TAG} Yeni sürüm bulundu: ${status.installedVersion || '?'} → ${status.latestTag}`);
        if (!autoUpdate) {
            broadcast('vlss5-update-event', { type: 'available', version: status.latestTag });
            return { checked: true, hasUpdate: true, status };
        }

        broadcast('vlss5-update-event', {
            type: 'started',
            version: status.latestTag,
            fromVersion: status.installedVersion || null
        });

        const result = await install(null, { autoCloseRunningApp: true, silent: true });

        broadcast('vlss5-update-event', {
            type: result.success ? 'finished' : 'failed',
            version: result.version || status.latestTag,
            error: result.success ? null : (result.error || null),
            errorCode: result.success ? null : (result.errorCode || null)
        });

        return { checked: true, hasUpdate: true, ...result };

    } catch (err) {
        console.error(`${TAG} Açılış güncelleme kontrolü hatası:`, err);
        broadcast('vlss5-update-event', { type: 'failed', error: err.message });
        return { checked: false, error: err.message };
    }
}

/**
 * "Güncellemeleri kontrol et" butonu — sürümü tazeler, güncelleme varsa kurar.
 * @param {Electron.IpcMainInvokeEvent} event
 */
async function checkForUpdatesManual(event) {
    if (activeOperation) {
        return { success: false, errorCode: 'BUSY', error: 'Başka bir VLSS5 işlemi devam ediyor.' };
    }

    const status = await getStatus({ forceRefresh: true });

    if (!status.isInstalled) {
        return { success: true, hasUpdate: false, notInstalled: true, status };
    }
    if (!status.hasUpdate) {
        return { success: true, hasUpdate: false, upToDate: true, status };
    }

    broadcast('vlss5-update-event', {
        type: 'started',
        version: status.latestTag,
        fromVersion: status.installedVersion || null,
        manual: true
    });

    const result = await install(event, { autoCloseRunningApp: true });

    broadcast('vlss5-update-event', {
        type: result.success ? 'finished' : 'failed',
        version: result.version || status.latestTag,
        manual: true,
        error: result.success ? null : (result.error || null),
        errorCode: result.success ? null : (result.errorCode || null)
    });

    return { ...result, hasUpdate: true };
}

module.exports = {
    getStatus,
    install,
    checkForUpdatesOnStartup,
    checkForUpdatesManual,
    inspectPendingUpdate,
    isBusy,
    isAppRunning,
    closeRunningApp,
    launch,
    setModelDll,
    findModelDllInDriverStore,
    openInstallFolder,
    uninstall,
    inspectInstallDir,
    VLSS5_REPO,
    GITHUB_URL,
    MODEL_DLL,
    EXE_NAME
};
