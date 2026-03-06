const ts = () => new Date().toISOString().slice(11, 19); // HH:MM:SS

export const log = (msg) => console.log(`[${ts()}] ${msg}`);
export const logError = (msg) => console.error(`[${ts()}] ERROR: ${msg}`);
export const logWarn = (msg) => console.warn(`[${ts()}] WARN:  ${msg}`);
