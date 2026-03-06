#!/usr/bin/env node

/**
 * crawl.js — Pinterest board crawler
 *
 * Usage:
 *   node crawl.js --url <board_url> [options]
 *
 * Options:
 *   --url         Pinterest board URL (required)
 *   --cookies     Path to cookies.json (default: ./cookies.json)
 *   --out         Output manifest path — if omitted, auto-named from the URL
 *                 e.g. https://pinterest.com/tom_meke/ideas → manifest-ideas.json
 *   --headless    Run headless (default: false, shows browser)
 *   --upload      Enable cloud upload after crawl (default: false)
 *   --provider    Cloud provider: r2 | s3 (required if --upload)
 */

import { chromium } from 'playwright';
import fs from 'fs';
import { parseArgs } from './lib/args.js';
import { log, logError } from './lib/logger.js';
import { loadCookies } from './lib/cookies.js';
import { buildManifest, loadPartialManifest, saveManifest } from './lib/manifest.js';
import { scrollBoard } from './lib/scroller.js';
import { interceptPins } from './lib/interceptor.js';
import { uploadManifest } from './lib/upload.js';

const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--disable-gpu',
  '--window-size=1440,900',
  '--lang=en-US,en',
];

/**
 * Derives a manifest filename from the board URL.
 * https://pinterest.com/tom_meke/ideas/ → manifest-ideas.json
 */
const manifestNameFromUrl = (url) => {
  const parts = new URL(url).pathname.replace(/\/$/, '').split('/').filter(Boolean);
  const boardSlug = parts[parts.length - 1] ?? 'board';
  return `manifest-${boardSlug}.json`;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.url) {
    logError('--url is required. Example: node crawl.js --url https://pinterest.com/user/board');
    process.exit(1);
  }

  const cookiesPath = args.cookies ?? './cookies.json';
  const outPath = args.out ?? manifestNameFromUrl(args.url);
  const headless = args.headless === 'true' || args.headless === true;
  const enableUpload = args.upload === 'true' || args.upload === true;
  const uploadProvider = args.provider ?? null;

  log(`Board URL  : ${args.url}`);
  log(`Cookies    : ${cookiesPath}`);
  log(`Output     : ${outPath}`);
  log(`Headless   : ${headless}`);
  log(`Upload     : ${enableUpload ? `yes (${uploadProvider})` : 'no'}`);
  log('');

  const partial = loadPartialManifest(outPath);
  const seenIds = new Set(partial.pins.map((p) => p.pin_id));
  log(
    partial.pins.length > 0
      ? `Resuming from partial manifest — ${partial.pins.length} pins already collected`
      : 'Starting fresh crawl'
  );

  // Shared stop signal — set by interceptor when Pinterest signals end of board,
  // checked by scroller so it stops instead of running forever
  const stopSignal = { done: false };

  const browser = await chromium.launch({
    headless,
    args: STEALTH_ARGS,
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'Europe/Amsterdam',
  });

  const cookies = loadCookies(cookiesPath);
  if (cookies.length > 0) {
    await context.addCookies(cookies);
    log(`Loaded ${cookies.length} cookies`);
  } else {
    log('No cookies loaded — will crawl as guest (public boards only)');
  }

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const collectedPins = [...partial.pins];

  const onPinBatch = (pins) => {
    let added = 0;
    for (const pin of pins) {
      if (!seenIds.has(pin.pin_id)) {
        seenIds.add(pin.pin_id);
        collectedPins.push(pin);
        added++;
      }
    }
    if (added > 0) {
      log(`  +${added} pins (total: ${collectedPins.length})`);
      saveManifest(outPath + '.partial', buildManifest(args.url, collectedPins));
    }
  };

  await interceptPins(page, onPinBatch, stopSignal);

  log(`\nNavigating to ${args.url}`);
  await page.goto(args.url, { waitUntil: 'networkidle', timeout: 30_000 });

  const boardName = await page.title().then((t) => t.replace(' | Pinterest', '').trim());
  log(`Board name : "${boardName}"\n`);

  await scrollBoard(page, stopSignal);

  await page.waitForTimeout(2000);
  await browser.close();

  const manifest = buildManifest(args.url, collectedPins, boardName);
  saveManifest(outPath, manifest);

  const partialPath = outPath + '.partial';
  if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);

  log(`\nDone. ${collectedPins.length} pins saved to ${outPath}`);

  if (enableUpload) {
    if (!uploadProvider) {
      logError('--provider is required when using --upload (r2 or s3)');
      process.exit(1);
    }
    log(`\nUploading manifest to ${uploadProvider}...`);
    await uploadManifest(manifest, uploadProvider, outPath);
  }
}

main().catch((err) => {
  logError(err.message);
  process.exit(1);
});
