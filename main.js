'use strict';

/**
 * main.js — Application entry point
 *
 * Loads the main application module from src/main/index.js.
 * Fallbacks to .jsc bytecode if .js is unavailable.
 */

const path = require('path');
const fs   = require('fs');

// stdout/stderr'in karşı tarafı kapanırsa (uygulama bir boruya yazacak şekilde
// başlatılıp o süreç sonlanırsa, ör. `npm start | head`, veya terminal kapatılırsa)
// sonraki her console.log EPIPE fırlatır ve Electron "A JavaScript error occurred
// in the main process" diyaloğunu gösterir. Log yazmak uygulamayı çökertmemeli.
const IGNORED_STREAM_ERRORS = ['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END'];

// 1) Asenkron yol: stream 'error' event'i
for (const stream of [process.stdout, process.stderr]) {
    if (stream && typeof stream.on === 'function') {
        stream.on('error', (err) => {
            if (err && IGNORED_STREAM_ERRORS.includes(err.code)) return;
            // Diğer stream hataları yutulmasın ama süreç de düşmesin
            try { process.emitWarning(err); } catch (e) { /* yoksay */ }
        });
    }
}

// 2) Senkron yol: console.* çağrısının kendisi fırlatabiliyor
//    (yalnızca yukarıdaki kodlar yutulur; gerçek hatalar aynen yükselir)
for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    const original = console[method];
    if (typeof original !== 'function') continue;
    console[method] = function (...args) {
        try {
            return original.apply(console, args);
        } catch (err) {
            if (err && IGNORED_STREAM_ERRORS.includes(err.code)) return undefined;
            throw err;
        }
    };
}

const jsEntry  = path.resolve(__dirname, 'src', 'main', 'index.js');
const jscEntry = path.resolve(__dirname, 'build-tmp', 'src', 'main', 'index.jsc');

if (fs.existsSync(jsEntry)) {
    require(jsEntry);
} else if (fs.existsSync(jscEntry)) {
    const bytenode = require('bytenode');
    require(jscEntry);
} else {
    require('./src/main/index');
}
