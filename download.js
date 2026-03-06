#!/usr/bin/env node

/**
 * download.js — Pinterest board image downloader
 *
 * Reads a manifest produced by crawl.js and downloads every image
 * into a local folder named after the manifest file.
 *
 * Usage:
 *   node download.js --manifest manifest-ideas.json [options]
 *
 * Options:
 *   --manifest    Path to manifest JSON file (required)
 *   --out         Output folder (default: auto-named from manifest filename)
 *                 manifest-ideas.json → ./downloads/ideas/
 *   --concurrency Number of parallel downloads (default: 5)
 *   --retries     Max retries per image on failure (default: 3)
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { parseArgs } from './lib/args.js';
import { log, logError, logWarn } from './lib/logger.js';

// ---------------------------------------------------------------------------

const parseManifest = (filePath) => {
  if (!fs.existsSync(filePath)) {
    logError(`Manifest not found: ${filePath}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    logError(`Failed to parse manifest: ${filePath}`);
    process.exit(1);
  }
};

/**
 * Derives the output folder name from the manifest filename.
 * manifest-ideas.json → ./downloads/ideas
 * manifest-board-ideas.json → ./downloads/board-ideas
 */
const folderFromManifest = (manifestPath) => {
  const base = path.basename(manifestPath, '.json'); // e.g. "manifest-ideas"
  const slug = base.replace(/^manifest-?/, '') || 'board'; // e.g. "ideas"
  return path.join('./downloads', slug);
};

/**
 * Loads progress file — a JSON array of already-downloaded pin IDs.
 */
const loadProgress = (progressPath) => {
  if (!fs.existsSync(progressPath)) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(progressPath, 'utf8')));
  } catch {
    return new Set();
  }
};

const saveProgress = (progressPath, downloadedIds) => {
  fs.writeFileSync(progressPath, JSON.stringify([...downloadedIds], null, 2));
};

/**
 * Sanitizes a string for use in a filename.
 * Strips special chars, collapses spaces, truncates to 60 chars.
 */
const sanitizeFilename = (str) =>
  (str ?? '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60)
    .replace(/^_+|_+$/g, '');

/**
 * Derives a filename for a pin.
 * Format: {pin_id}_{sanitized_title}.{ext}
 * Falls back to just {pin_id}.jpg if no title.
 */
const pinFilename = (pin) => {
  const ext = extFromUrl(pin.image_url) ?? 'jpg';
  const title = sanitizeFilename(pin.title);
  return title ? `${pin.pin_id}_${title}.${ext}` : `${pin.pin_id}.${ext}`;
};

const extFromUrl = (url) => {
  if (!url) return null;
  const match = url.split('?')[0].match(/\.(\w{2,4})$/);
  return match ? match[1].toLowerCase() : null;
};

/**
 * Downloads a single URL to a local file path.
 * Follows redirects. Returns a promise that resolves on success.
 */
const downloadFile = (url, destPath) =>
  new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;

    const request = proto.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Referer: 'https://www.pinterest.com/',
        },
      },
      (res) => {
        // Follow redirects (Pinterest sometimes redirects image URLs)
        if (res.statusCode === 301 || res.statusCode === 302) {
          downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }

        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }
    );

    request.on('error', reject);
    request.setTimeout(15_000, () => {
      request.destroy();
      reject(new Error(`Timeout downloading ${url}`));
    });
  });

/**
 * Downloads a single pin with retries and exponential backoff.
 */
const downloadPin = async (pin, destDir, maxRetries) => {
  if (!pin.image_url) {
    logWarn(`Pin ${pin.pin_id} has no image URL — skipping`);
    return { status: 'skipped', pin_id: pin.pin_id };
  }

  const filename = pinFilename(pin);
  const destPath = path.join(destDir, filename);

  // Skip if already exists on disk (e.g. from a previous interrupted run)
  if (fs.existsSync(destPath)) {
    return { status: 'exists', pin_id: pin.pin_id };
  }

  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await downloadFile(pin.image_url, destPath);
      return { status: 'ok', pin_id: pin.pin_id, filename };
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        const wait = attempt * 1500; // 1.5s, 3s, 4.5s ...
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  return { status: 'failed', pin_id: pin.pin_id, error: lastErr?.message };
};

/**
 * Runs tasks with a max concurrency limit.
 * tasks: array of () => Promise
 */
const withConcurrency = async (tasks, limit, onResult) => {
  const queue = [...tasks];
  const workers = Array.from({ length: limit }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      const result = await task();
      onResult(result);
    }
  });
  await Promise.all(workers);
};

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.manifest) {
    logError('--manifest is required. Example: node download.js --manifest manifest-ideas.json');
    process.exit(1);
  }

  const manifestPath = args.manifest;
  const outDir = args.out ?? folderFromManifest(manifestPath);
  const concurrency = parseInt(args.concurrency ?? '5', 10);
  const maxRetries = parseInt(args.retries ?? '3', 10);
  const progressPath = path.join(outDir, '.progress.json');

  const manifest = parseManifest(manifestPath);
  const pins = manifest.pins ?? [];

  if (pins.length === 0) {
    log('Manifest contains no pins — nothing to download');
    process.exit(0);
  }

  // Create output folder
  fs.mkdirSync(outDir, { recursive: true });

  // Load existing progress
  const downloadedIds = loadProgress(progressPath);
  const remaining = pins.filter((p) => !downloadedIds.has(p.pin_id));

  log(`Manifest   : ${manifestPath}`);
  log(`Board      : ${manifest.board || '(unnamed)'}`);
  log(`Output     : ${outDir}`);
  log(`Total pins : ${pins.length}`);
  log(`Already done: ${downloadedIds.size}`);
  log(`To download: ${remaining.length}`);
  log(`Concurrency: ${concurrency}`);
  log('');

  if (remaining.length === 0) {
    log('All pins already downloaded.');
    process.exit(0);
  }

  // Stats
  let done = 0;
  let failed = 0;
  let skipped = 0;
  const failures = [];

  const tasks = remaining.map((pin) => async () => downloadPin(pin, outDir, maxRetries));

  const onResult = (result) => {
    done++;

    if (result.status === 'ok') {
      downloadedIds.add(result.pin_id);
      // Save progress every 10 downloads
      if (done % 10 === 0) saveProgress(progressPath, downloadedIds);
      if (done % 10 === 0 || done === remaining.length) {
        log(`  [${done}/${remaining.length}] downloaded`);
      }
    } else if (result.status === 'exists') {
      downloadedIds.add(result.pin_id);
      skipped++;
    } else if (result.status === 'skipped') {
      skipped++;
      logWarn(`  Skipped pin ${result.pin_id} (no image URL)`);
    } else {
      failed++;
      failures.push(result);
      logWarn(`  Failed pin ${result.pin_id}: ${result.error}`);
    }
  };

  await withConcurrency(tasks, concurrency, onResult);

  // Final progress save
  saveProgress(progressPath, downloadedIds);

  // Write failures file if any
  if (failures.length > 0) {
    const failPath = path.join(outDir, 'failed.json');
    fs.writeFileSync(failPath, JSON.stringify(failures, null, 2));
    logWarn(`\n${failures.length} failed downloads logged to ${failPath}`);
  }

  log(`\nDone.`);
  log(`  Downloaded : ${done - failed - skipped}`);
  log(`  Skipped    : ${skipped}`);
  log(`  Failed     : ${failed}`);
  log(`  Saved to   : ${outDir}`);
}

main().catch((err) => {
  logError(err.message);
  process.exit(1);
});
