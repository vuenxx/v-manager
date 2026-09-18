'use strict';

/**
 * exeApiDetector.js — Oyun .exe'sinin grafik API'sini ve bit genişliğini tespit eder
 *
 * Neden gerekli: ReShade gibi proxy DLL ile çalışan modlar, oyunun kullandığı API'ye
 * göre farklı isimle kopyalanmak zorunda (dxgi.dll / d3d9.dll / opengl32.dll ...) ve
 * 32/64 bit için farklı dosya kullanıyor (ReShade32.dll / ReShade64.dll).
 *
 * Yöntem — güvenilirlik sırasına göre katmanlı:
 *   1. PE başlığı → bit genişliği (KESİN)
 *   2. PE import / delay-import tablosu → statik bağlanan API'ler (çok güçlü)
 *   3. Exe içinde ham string taraması → LoadLibrary ile dinamik yüklenenler (orta)
 *   4. Oyun klasöründeki dosyalar ve motor izleri (UE/Unity) → ipucu (zayıf-orta)
 *   5. Yol/dosya adı ipuçları ("x64_dx12", "dx11") → ipucu (zayıf)
 *
 * Tek bir katman yeterli değil: UE oyunları d3d11/d3d12/opengl'i birlikte linkler,
 * Witcher 3 gibi oyunlar ise hiçbirini statik linklemez. Bu yüzden sonuç "kesin
 * cevap" değil, **puanlanmış sıralı liste**; UI bunu ön seçim olarak gösterir,
 * kullanıcı değiştirebilir.
 */

const fs = require('fs');
const path = require('path');

const TAG = '[EXE_API]';

/** Bilinen API'ler ve onları ele veren DLL/string parçaları */
const API_SIGNATURES = {
    d3d12: { dlls: ['d3d12.dll', 'd3d12core.dll'], label: 'DirectX 12' },
    d3d11: { dlls: ['d3d11.dll', 'd3dx11', 'd3dcompiler_4'], label: 'DirectX 11' },
    d3d10: { dlls: ['d3d10.dll', 'd3d10_1.dll', 'd3dx10'], label: 'DirectX 10' },
    d3d9: { dlls: ['d3d9.dll', 'd3dx9'], label: 'DirectX 9' },
    d3d8: { dlls: ['d3d8.dll'], label: 'DirectX 8' },
    ddraw: { dlls: ['ddraw.dll'], label: 'DirectDraw (DX7 ve öncesi)' },
    opengl: { dlls: ['opengl32.dll'], label: 'OpenGL' },
    vulkan: { dlls: ['vulkan-1.dll'], label: 'Vulkan' },
    dxgi: { dlls: ['dxgi.dll'], label: 'DXGI (DX10/11/12 ortak)' }
};

/**
 * ReShade'in (ve benzeri proxy modların) API'ye göre kullanması gereken DLL adı.
 * DX10/11/12 için ReShade'in kendi kurulumu da dxgi.dll kullanır — üçünde de çalışır.
 */
const API_TO_PROXY_DLL = {
    d3d12: 'dxgi.dll',
    d3d11: 'dxgi.dll',
    d3d10: 'dxgi.dll',
    dxgi: 'dxgi.dll',
    d3d9: 'd3d9.dll',
    d3d8: 'd3d8.dll',
    ddraw: 'ddraw.dll',
    opengl: 'opengl32.dll',
    vulkan: null            // Vulkan'da ReShade katman (layer) olarak kurulur, yanına DLL konmaz
};

// ─────────────────────────────────────────────────────────────────────────────
// PE ayrıştırma
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PE başlığını okur: mimari + import edilen DLL adları.
 * @returns {{ arch: 'x86'|'x64'|'arm64'|string, imports: string[] }}
 */
function parsePe(filePath) {
    const fd = fs.openSync(filePath, 'r');
    try {
        const fileSize = fs.fstatSync(fd).size;
        const readAt = (offset, len) => {
            if (offset < 0 || offset >= fileSize) throw new Error('PE: geçersiz ofset');
            const buf = Buffer.alloc(Math.min(len, fileSize - offset));
            fs.readSync(fd, buf, 0, buf.length, offset);
            return buf;
        };

        const dos = readAt(0, 64);
        if (dos.toString('latin1', 0, 2) !== 'MZ') throw new Error('MZ imzası yok (PE dosyası değil)');
        const peOffset = dos.readUInt32LE(0x3c);

        const coff = readAt(peOffset, 24);
        if (coff.toString('latin1', 0, 4) !== 'PE\0\0') throw new Error('PE imzası yok');

        const machine = coff.readUInt16LE(4);
        const numSections = coff.readUInt16LE(6);
        const optSize = coff.readUInt16LE(20);

        const arch = machine === 0x8664 ? 'x64'
            : machine === 0x14c ? 'x86'
                : machine === 0xaa64 ? 'arm64'
                    : `unknown(0x${machine.toString(16)})`;

        const imports = [];

        if (optSize > 0) {
            const opt = readAt(peOffset + 24, optSize);
            const magic = opt.readUInt16LE(0);
            const isPe32Plus = magic === 0x20b;
            const ddOffset = isPe32Plus ? 112 : 96;

            if (opt.length >= ddOffset + 8 * 14) {
                const importRva = opt.readUInt32LE(ddOffset + 8 * 1);    // Import Table
                const delayRva = opt.readUInt32LE(ddOffset + 8 * 13);    // Delay Import

                // Bölüm tablosu → RVA'dan dosya ofsetine çevirme
                const sections = [];
                const secBase = peOffset + 24 + optSize;
                for (let i = 0; i < numSections; i++) {
                    const s = readAt(secBase + i * 40, 40);
                    if (s.length < 40) break;
                    sections.push({
                        vaddr: s.readUInt32LE(12),
                        vsize: s.readUInt32LE(8),
                        raw: s.readUInt32LE(20),
                        rawSize: s.readUInt32LE(16)
                    });
                }

                const rvaToOffset = (rva) => {
                    for (const s of sections) {
                        const span = Math.max(s.vsize, s.rawSize);
                        if (rva >= s.vaddr && rva < s.vaddr + span) return s.raw + (rva - s.vaddr);
                    }
                    return null;
                };

                const readCString = (offset, max = 128) => {
                    if (offset === null || offset < 0 || offset >= fileSize) return '';
                    const buf = readAt(offset, max);
                    const end = buf.indexOf(0);
                    return buf.toString('latin1', 0, end === -1 ? buf.length : end);
                };

                const readImportDir = (rva, entrySize, nameFieldOffset) => {
                    const off = rvaToOffset(rva);
                    if (off === null) return;
                    for (let i = 0; i < 1024; i++) {
                        let entry;
                        try {
                            entry = readAt(off + i * entrySize, entrySize);
                        } catch (e) { break; }
                        if (entry.length < entrySize || entry.every(b => b === 0)) break;
                        const nameRva = entry.readUInt32LE(nameFieldOffset);
                        if (!nameRva) continue;
                        const name = readCString(rvaToOffset(nameRva));
                        if (name) imports.push(name.toLowerCase());
                    }
                };

                if (importRva) readImportDir(importRva, 20, 12);   // IMAGE_IMPORT_DESCRIPTOR.Name
                if (delayRva) readImportDir(delayRva, 32, 4);      // ImgDelayDescr.rvaDLLName
            }
        }

        return { arch, imports };
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * Exe içinde ham string araması — dinamik (LoadLibrary) yüklenen API'leri yakalar.
 * Büyük exe'lerde parça parça okunur, aranan tüm ifadeler bulununca erken çıkılır.
 */
function scanStrings(filePath, needles, maxBytes = 96 * 1024 * 1024) {
    const found = new Set();
    let fd;
    try {
        fd = fs.openSync(filePath, 'r');
        const size = Math.min(fs.fstatSync(fd).size, maxBytes);
        const CHUNK = 4 * 1024 * 1024;
        const OVERLAP = 64;                     // sınıra denk gelen isimler kaçmasın
        let tail = Buffer.alloc(0);

        for (let pos = 0; pos < size; pos += CHUNK) {
            const len = Math.min(CHUNK, size - pos);
            const buf = Buffer.alloc(len);
            fs.readSync(fd, buf, 0, len, pos);
            const hay = Buffer.concat([tail, buf]).toString('latin1').toLowerCase();
            for (const n of needles) {
                if (!found.has(n) && hay.includes(n)) found.add(n);
            }
            if (found.size === needles.length) break;
            tail = buf.subarray(Math.max(0, buf.length - OVERLAP));
        }
    } catch (e) {
        console.warn(`${TAG} String taraması başarısız: ${e.message}`);
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
    return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// Motor / klasör / yol ipuçları
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Oyun klasöründeki dosyalardan motor ve API ipuçları çıkarır.
 * UE ve Unity oyunları API'yi çalışma anında seçtiği için exe taraması yetersiz kalır.
 */
function collectFolderHints(exePath) {
    const hints = { apis: {}, engine: null, notes: [] };
    const dir = path.dirname(exePath);

    let files = [];
    try {
        files = fs.readdirSync(dir).map(f => f.toLowerCase());
    } catch (e) {
        return hints;
    }

    // Oyun klasöründe API DLL'i duruyorsa güçlü ipucu
    for (const [api, sig] of Object.entries(API_SIGNATURES)) {
        if (sig.dlls.some(d => files.includes(d))) {
            hints.apis[api] = (hints.apis[api] || 0) + 4;
            hints.notes.push(`klasörde ${api} DLL'i var`);
        }
    }

    // Unreal Engine: <Oyun>/Binaries/Win64/<Oyun>-Win64-Shipping.exe
    const lowPath = exePath.toLowerCase();
    if (/-win64-shipping\.exe$/.test(lowPath) || /[\\/]binaries[\\/]win(64|32)[\\/]/.test(lowPath)) {
        hints.engine = 'unreal';
        // UE4/UE5 varsayılanı DX11/DX12; ikisi de linklenir, DX12 modern varsayılan
        hints.apis.d3d12 = (hints.apis.d3d12 || 0) + 3;
        hints.apis.d3d11 = (hints.apis.d3d11 || 0) + 2;
        hints.notes.push('Unreal Engine tespit edildi');
    }

    // Unity: UnityPlayer.dll + <Oyun>_Data/
    if (files.includes('unityplayer.dll') || files.some(f => f.endsWith('_data'))) {
        hints.engine = hints.engine || 'unity';
        hints.apis.d3d11 = (hints.apis.d3d11 || 0) + 3;
        hints.notes.push('Unity tespit edildi');

        // boot.config içinde seçili API yazabiliyor
        try {
            const dataDir = files.find(f => f.endsWith('_data'));
            if (dataDir) {
                const bootPath = path.join(dir, dataDir, 'boot.config');
                if (fs.existsSync(bootPath)) {
                    const boot = fs.readFileSync(bootPath, 'utf-8').toLowerCase();
                    if (boot.includes('gfx-enable-gfx-jobs') || boot.includes('vulkan')) {
                        if (boot.includes('vulkan')) {
                            hints.apis.vulkan = (hints.apis.vulkan || 0) + 4;
                            hints.notes.push('Unity boot.config → Vulkan');
                        }
                    }
                }
            }
        } catch (e) { /* yoksay */ }
    }

    // Yol/dosya adı ipuçları: "x64_dx12", "dx11", "_vulkan" gibi
    const pathHints = [
        [/dx12|d3d12|directx12/, 'd3d12'],
        [/dx11|d3d11|directx11/, 'd3d11'],
        [/dx10|d3d10/, 'd3d10'],
        [/dx9|d3d9|directx9/, 'd3d9'],
        [/vulkan|_vk\b/, 'vulkan'],
        [/opengl|_gl\b/, 'opengl']
    ];
    for (const [re, api] of pathHints) {
        if (re.test(lowPath)) {
            hints.apis[api] = (hints.apis[api] || 0) + 5;
            hints.notes.push(`yol adında ${api} geçiyor`);
        }
    }

    return hints;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ana tespit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bir oyun exe'sini analiz eder.
 *
 * @param {string} exePath
 * @returns {Promise<{
 *   success: boolean, error?: string,
 *   exePath: string, arch: 'x86'|'x64'|string, is64Bit: boolean,
 *   detected: Array<{ api: string, label: string, score: number, confidence: 'high'|'medium'|'low' }>,
 *   recommendedApi: string|null, recommendedProxyDll: string|null,
 *   engine: string|null, imports: string[], notes: string[]
 * }>}
 */
async function detectApi(exePath) {
    const base = {
        success: false, exePath, arch: 'unknown', is64Bit: true,
        detected: [], recommendedApi: null, recommendedProxyDll: null,
        engine: null, imports: [], notes: []
    };

    if (!exePath || !fs.existsSync(exePath)) {
        return { ...base, error: 'Exe dosyası bulunamadı.' };
    }
    if (fs.statSync(exePath).isDirectory()) {
        return { ...base, error: 'Klasör verildi, exe bekleniyordu.' };
    }

    let pe;
    try {
        pe = parsePe(exePath);
    } catch (e) {
        return { ...base, error: `PE okunamadı: ${e.message}` };
    }

    const allNeedles = [...new Set(Object.values(API_SIGNATURES).flatMap(s => s.dlls))];
    const strings = scanStrings(exePath, allNeedles);
    const folder = collectFolderHints(exePath);

    // Puanlama: import (10) > klasör/yol ipucu (4-5) > string (3)
    const scores = {};
    const addScore = (api, points) => { scores[api] = (scores[api] || 0) + points; };

    for (const [api, sig] of Object.entries(API_SIGNATURES)) {
        for (const dll of sig.dlls) {
            if (pe.imports.some(i => i.includes(dll))) addScore(api, 10);
            else if (strings.has(dll)) addScore(api, 3);
        }
    }
    for (const [api, points] of Object.entries(folder.apis)) addScore(api, points);

    // dxgi tek başına API değil; DX10/11/12'nin ortak katmanı. Hangisinin
    // kullanıldığı belirsizse dxgi zaten doğru proxy adını verir, o yüzden
    // d3d10/11/12 hiç bulunmadıysa dxgi'yi yükseltmiyoruz ama listede tutuyoruz.
    const ranked = Object.entries(scores)
        .map(([api, score]) => ({
            api,
            label: API_SIGNATURES[api] ? API_SIGNATURES[api].label : api,
            score,
            confidence: score >= 10 ? 'high' : score >= 5 ? 'medium' : 'low'
        }))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            // Eşitlikte modern API önde (UE gibi hepsini linkleyen motorlar için)
            const order = ['d3d12', 'd3d11', 'vulkan', 'dxgi', 'd3d10', 'opengl', 'd3d9', 'd3d8', 'ddraw'];
            return order.indexOf(a.api) - order.indexOf(b.api);
        });

    const top = ranked.find(r => r.api !== 'dxgi') || ranked[0] || null;
    const recommendedApi = top ? top.api : null;

    return {
        success: true,
        exePath,
        arch: pe.arch,
        is64Bit: pe.arch !== 'x86',
        detected: ranked,
        recommendedApi,
        recommendedProxyDll: recommendedApi ? (API_TO_PROXY_DLL[recommendedApi] || null) : null,
        engine: folder.engine,
        imports: pe.imports.filter(i => allNeedles.some(n => i.includes(n))),
        notes: folder.notes
    };
}

/** API kimliğinden proxy DLL adını döndürür (manifest `apiTargeting` kullanır). */
function getProxyDllForApi(api) {
    if (!api) return null;
    return API_TO_PROXY_DLL[String(api).toLowerCase()] || null;
}

/** UI'da listelenecek seçenekler — kullanıcı otomatik tespiti değiştirebilsin diye */
function getApiOptions() {
    return Object.entries(API_SIGNATURES).map(([api, sig]) => ({
        api,
        label: sig.label,
        proxyDll: API_TO_PROXY_DLL[api] || null
    }));
}

module.exports = {
    detectApi,
    getProxyDllForApi,
    getApiOptions,
    parsePe,
    API_SIGNATURES,
    API_TO_PROXY_DLL
};
