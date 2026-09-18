const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Whitelist of valid compression algorithms (M-01: algorithm validation)
const VALID_ALGORITHMS = ['XPRESS4K', 'XPRESS8K', 'XPRESS16K', 'LZX'];

/**
 * Native Windows Compression Wrapper
 * Interfaces with compact.exe to provide transparent file-system compression
 */
class WindowsCompressor {
    constructor() {
        this.activeProcesses = new Map();
    }

    /**
     * Compresses a folder using specified algorithm
     * @param {string} folderPath - Target folder
     * @param {string} algorithm - XPRESS4K, XPRESS8K, XPRESS16K, LZX
     * @param {Object} options - Additional options (recursion, etc)
     * @returns {Promise<Object>} - Results and logs
     */
    async compress(folderPath, algorithm = 'XPRESS4K', options = {}, onProgress = null) {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(folderPath)) {
                return reject(new Error('ERR_FOLDER_NOT_FOUND'));
            }

            // M-01: Validate algorithm against whitelist to prevent command injection
            const algoUpper = String(algorithm).toUpperCase();
            if (!VALID_ALGORITHMS.includes(algoUpper)) {
                return reject(new Error('ERR_INVALID_ALGORITHM'));
            }

            const algoFlag = `/EXE:${algoUpper}`;

            // Basic flags: /C (compress), /S (recurse), /A (hidden/system files), /I (ignore errors), /EXE (WOF)
            const args = ['/C', '/S', '/A', '/I', algoFlag, '*'];

            // H-01: Use chcp 65001 to force UTF-8 output from compact.exe
            // M-02: Use cmd.exe with shell:false for safe argument passing
            const proc = spawn('cmd.exe', ['/c', 'chcp 65001 >nul && compact.exe', ...args], {
                cwd: folderPath,
                shell: false
            });

            this.activeProcesses.set(folderPath, proc);

            let output = '';
            let errorOutput = '';

            proc.stdout.on('data', (data) => {
                const chunk = data.toString('utf8');
                output += chunk;

                if (onProgress) {
                    this._parseProgress(chunk, onProgress);
                }
            });

            proc.stderr.on('data', (data) => {
                errorOutput += data.toString('utf8');
            });

            // C-03: Handle spawn errors so the Promise never hangs
            proc.on('error', (err) => {
                this.activeProcesses.delete(folderPath);
                reject(new Error('ERR_SPAWN_FAILED: ' + err.message));
            });

            proc.on('close', (code) => {
                this.activeProcesses.delete(folderPath);
                if (code === 0 || code === 1) { // 1 often indicates some files couldn't be compressed which is fine
                    resolve({
                        success: true,
                        log: output,
                        code: code
                    });
                } else {
                    // H-11: Use error codes instead of hardcoded Turkish messages
                    reject(new Error(`ERR_COMPRESS_FAILED:${code}`));
                }
            });
        });
    }

    /**
     * Uncompresses a folder
     */
    // L-01: Fix new Promise(async) anti-pattern — use async function directly
    async uncompress(folderPath, onProgress = null) {
        if (!fs.existsSync(folderPath)) {
            throw new Error('ERR_FOLDER_NOT_FOUND');
        }

        // We need to run two passes to be thorough:
        // 1. Uncompress WOF (EXE) compressed files
        // 2. Uncompress standard NTFS compressed files
        if (onProgress) onProgress('WOF sıkıştırması geri alınıyor...');
        await this._runCompact(folderPath, ['/U', '/S', '/A', '/I', '/EXE', '*'], onProgress);

        if (onProgress) onProgress('NTFS sıkıştırması geri alınıyor...');
        const finalResult = await this._runCompact(folderPath, ['/U', '/S', '/A', '/I', '*'], onProgress);

        return finalResult;
    }

    /**
     * Helper to run compact.exe and handle its lifecycle
     */
    async _runCompact(folderPath, args, onProgress) {
        return new Promise((resolve, reject) => {
            // H-01: Force UTF-8 via chcp 65001; M-02: shell:false with cmd.exe
            const proc = spawn('cmd.exe', ['/c', 'chcp 65001 >nul && compact.exe', ...args], {
                cwd: folderPath,
                shell: false
            });

            this.activeProcesses.set(folderPath, proc);

            let output = '';
            let errorOutput = '';

            proc.stdout.on('data', (data) => {
                const chunk = data.toString('utf8');
                output += chunk;
                if (onProgress) this._parseProgress(chunk, onProgress);
            });

            proc.stderr.on('data', (data) => {
                errorOutput += data.toString('utf8');
            });

            // C-03: Handle spawn errors
            proc.on('error', (err) => {
                this.activeProcesses.delete(folderPath);
                reject(new Error('ERR_SPAWN_FAILED: ' + err.message));
            });

            proc.on('close', (code) => {
                this.activeProcesses.delete(folderPath);
                if (code === 0 || code === 1) {
                    resolve({ success: true, log: output, code: code });
                } else {
                    // H-11: Error codes
                    reject(new Error(`ERR_COMPACT_FAILED:${code}`));
                }
            });
        });
    }


    _parseProgress(text, callback) {
        // H-02: Support both \r and \n line endings from compact.exe
        const lines = text.split(/\r?\n|\r/).filter(l => l.trim().length > 0);
        if (lines.length > 0) {
            callback(lines[lines.length - 1].trim());
        }
    }



    /**
     * Checks the compression state of a folder
     * @param {string} folderPath 
     * @returns {Promise<Object>}
     */
    async getCompressionState(folderPath) {
        // M-05: Also reject on errors instead of silently returning defaults
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(folderPath)) return resolve({ isCompressed: false, ratio: '1.0' });

            // H-01: Force UTF-8 via chcp 65001; M-02: shell:false with cmd.exe
            const proc = spawn('cmd.exe', ['/c', 'chcp 65001 >nul && compact.exe /S /A /I'], {
                cwd: folderPath,
                shell: false
            });

            let output = '';
            proc.stdout.on('data', (data) => output += data.toString('utf8'));

            // C-03: Handle spawn errors in getCompressionState too
            proc.on('error', (err) => {
                reject(new Error('ERR_SPAWN_FAILED: ' + err.message));
            });

            // We only care about the last 500 characters for the summary
            proc.on('close', () => {
                const summary = output.slice(-1000); // Get end of output

                // Match pattern: [Number] : [Number] = [Number] to/unto 1
                // We use [\d.,\s]+ to account for thousands separators (dot or comma or space)
                const ratioMatch = summary.match(/([\d.,\s]+)\s?:\s?([\d.,\s]+)\s?=\s?([\d.,]+)\s?(?:to|\/|unto|:)\s?1/i);

                let isCompressed = false;
                let ratioValue = 1.0;

                if (ratioMatch) {
                    const beforeStr = ratioMatch[1].replace(/[.,\s]/g, '');
                    const afterStr = ratioMatch[2].replace(/[.,\s]/g, '');
                    const ratioStr = ratioMatch[3].replace(',', '.');

                    const before = parseInt(beforeStr);
                    const after = parseInt(afterStr);
                    ratioValue = parseFloat(ratioStr);

                    if (after < before || ratioValue > 1.0) {
                        isCompressed = true;
                    }
                } else {
                    // Fallback to searching for any compressed files mention
                    const filesCompressedMatch = summary.match(/(\d+)\s+(?:files|dosya|fichiers|dateien)/i);
                    if (filesCompressedMatch && parseInt(filesCompressedMatch[1]) > 0) {
                        isCompressed = true;
                    }
                }

                resolve({
                    isCompressed: isCompressed,
                    ratio: ratioValue.toFixed(1),
                    raw: summary
                });
            });
        });
    }
}

module.exports = new WindowsCompressor();
