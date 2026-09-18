'use strict';

function createLogger(moduleId) {
    const logs = [];

    function getTimestamp() {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        return `[${h}:${m}:${s}]`;
    }

    function logEntry(level, symbol, message) {
        const timestamp = getTimestamp();
        const formatted = `${timestamp} [${moduleId}] ${symbol} ${message}`;
        
        logs.push({ timestamp, level, message });
        
        if (level === 'error') {
            console.error(formatted);
        } else if (level === 'warn') {
            console.warn(formatted);
        } else {
            console.log(formatted);
        }
    }

    return {
        step: (message) => logEntry('step', '✓', message),
        warn: (message) => logEntry('warn', '⚠', message),
        error: (message) => logEntry('error', '✗', message),
        getLog: () => [...logs],
        clear: () => { logs.length = 0; }
    };
}

module.exports = {
    createLogger
};
