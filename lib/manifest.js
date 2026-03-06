import fs from 'fs';
import { log, logWarn } from './logger.js';

/**
 * Builds the final manifest object.
 */
export const buildManifest = (url, pins, boardName = '') => ({
  board: boardName,
  url,
  crawled_at: new Date().toISOString(),
  total: pins.length,
  pins,
});

/**
 * Writes manifest to disk as formatted JSON.
 */
export const saveManifest = (filePath, manifest) => {
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), 'utf8');
  log(`Manifest saved to ${filePath} (${manifest.total} pins)`);
};

/**
 * Loads a partial manifest from a previous interrupted run.
 * Returns an empty manifest if none exists.
 */
export const loadPartialManifest = (outPath) => {
  const partialPath = outPath + '.partial';

  if (!fs.existsSync(partialPath)) {
    return { pins: [] };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(partialPath, 'utf8'));
    logWarn(`Found partial manifest with ${raw.pins?.length ?? 0} pins — will resume from here`);
    return raw;
  } catch {
    logWarn('Partial manifest exists but could not be parsed — starting fresh');
    return { pins: [] };
  }
};
