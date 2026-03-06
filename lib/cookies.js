import fs from 'fs';
import { log, logWarn } from './logger.js';

/**
 * Loads cookies from a JSON file exported by the "Cookie-Editor" browser extension
 * (https://cookie-editor.com). Supports both the array format and the
 * { [name]: { value, ... } } object format some exporters produce.
 *
 * Playwright expects cookies in the shape:
 *   { name, value, domain, path, secure, httpOnly, sameSite, expires }
 */
export const loadCookies = (filePath) => {
  if (!fs.existsSync(filePath)) {
    logWarn(`Cookie file not found at ${filePath} — skipping`);
    return [];
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    logWarn(`Failed to parse ${filePath} — skipping cookies`);
    return [];
  }

  // Normalize to array
  const list = Array.isArray(raw) ? raw : Object.values(raw);

  return list
    .filter((c) => c.name && c.value)
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain ?? '.pinterest.com',
      path: c.path ?? '/',
      secure: c.secure ?? true,
      httpOnly: c.httpOnly ?? false,
      sameSite: normalizeSameSite(c.sameSite),
      // expires: -1 means session cookie; some exporters use 'expirationDate'
      expires: c.expires ?? c.expirationDate ?? -1,
    }));
};

const normalizeSameSite = (val) => {
  if (!val) return 'None';
  const v = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
  return ['Strict', 'Lax', 'None'].includes(v) ? v : 'None';
};
