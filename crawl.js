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

const RESOLUTION_PREFERENCE = ['originals', '1200x', '736x', '600x', '474x', '236x'];

const resolveImageUrl = (pin) => {
  const images = pin?.images ?? {};
  for (const key of RESOLUTION_PREFERENCE) {
    if (images[key]?.url) return images[key].url;
  }
  return null;
};

const manifestNameFromUrl = (url) => {
  const parts = new URL(url).pathname.replace(/\/$/, '').split('/').filter(Boolean);
  const boardSlug = parts[parts.length - 1] ?? 'board';
  return `manifest-${boardSlug}.json`;
};

const pinFromRaw = (p) => ({
  pin_id: String(p.id),
  image_url: resolveImageUrl(p),
  title: p.title ?? '',
  description: p.description ?? '',
  source_url: p.link ?? '',
  dominant_color: p.dominant_color ?? '',
  section: p.board_section?.title ?? null,
  created_at: p.created_at ?? null,
});

/**
 * Extracts pins AND board metadata from the inline bootstrap JSON.
 * Returns { pins, boardId, boardUrl, nextBookmark }
 */
const extractBootstrap = async (page) => {
  try {
    return await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const text = script.textContent ?? '';
        if (!text.includes('BoardFeedResource')) continue;

        let json;
        try {
          json = JSON.parse(text);
        } catch (_) {
          continue;
        }

        const boardFeed =
          json?.initialReduxState?.resources?.BoardFeedResource ??
          json?.initialReduxState?.BoardFeedResource ??
          json?.resources?.BoardFeedResource ??
          null;

        if (!boardFeed) continue;

        for (const entry of Object.values(boardFeed)) {
          const data = Array.isArray(entry?.data) ? entry.data
            : Array.isArray(entry?.data?.data) ? entry.data.data
            : null;

          if (!data || data.length === 0) continue;

          // Grab board metadata from first pin
          const firstPin = data.find((p) => p?.board);
          const boardId = firstPin?.board?.id ?? null;
          const boardUrl = firstPin?.board?.url ?? null;
          const nextBookmark = entry?.nextBookmark ?? null;

          const pins = data
            .filter((p) => p?.id && p?.type === 'pin')
            .map((p) => {
              const images = p.images ?? {};
              const res = ['originals', '1200x', '736x', '600x', '474x', '236x'];
              let image_url = null;
              for (const r of res) {
                if (images[r]?.url) { image_url = images[r].url; break; }
              }
              return {
                pin_id: String(p.id),
                image_url,
                title: p.title ?? '',
                description: p.description ?? '',
                source_url: p.link ?? '',
                dominant_color: p.dominant_color ?? '',
                section: p.board_section?.title ?? null,
                created_at: p.created_at ?? null,
              };
            })
            .filter((p) => p.image_url);

          return { pins, boardId, boardUrl, nextBookmark };
        }
      }
      return { pins: [], boardId: null, boardUrl: null, nextBookmark: null };
    });
  } catch (_) {
    return { pins: [], boardId: null, boardUrl: null, nextBookmark: null };
  }
};

/**
 * Fetches remaining pin pages directly via Pinterest's API using
 * the board ID and cursor bookmark from the bootstrap data.
 * This catches any pins that scroll-based XHR interception misses.
 */
const fetchRemainingPages = async (page, boardId, boardUrl, bookmark, onPinBatch) => {
  if (!boardId || !bookmark || bookmark === '-end-') return;

  let cursor = bookmark;
  let page_num = 0;

  while (cursor && cursor !== '-end-') {
    page_num++;
    const params = new URLSearchParams({
      source_url: boardUrl,
      data: JSON.stringify({
        options: {
          board_id: boardId,
          board_url: boardUrl,
          currentFilter: -1,
          field_set_key: 'react_grid_pin',
          filter_section_pins: true,
          sort: 'default',
          layout: 'default',
          page_size: 25,
          redux_normalize_feed: true,
          bookmarks: [cursor],
        },
        context: {},
      }),
    });

    const apiUrl = `https://www.pinterest.com/resource/BoardFeedResource/get/?${params}`;

    try {
      const json = await page.evaluate(async (url) => {
        const res = await fetch(url, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          credentials: 'include',
        });
        return res.json();
      }, apiUrl);

      const data = json?.resource_response?.data;
      if (!Array.isArray(data) || data.length === 0) break;

      const pins = data
        .filter((p) => p?.id && p?.type === 'pin')
        .map(pinFromRaw)
        .filter((p) => p.image_url);

      if (pins.length > 0) {
        log(`  API page ${page_num}: +${pins.length} pins`);
        onPinBatch(pins);
      }

      cursor = json?.resource_response?.bookmark ?? null;
      if (!cursor || cursor === '-end-') break;

      // Polite delay between API calls
      await page.waitForTimeout(800 + Math.random() * 400);
    } catch (err) {
      log(`  API page ${page_num}: fetch failed — ${err.message}`);
      break;
    }
  }
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

  const stopSignal = { done: false };

  const browser = await chromium.launch({ headless, args: STEALTH_ARGS });

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
  await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const boardName = await page.title().then((t) => t.replace(' | Pinterest', '').trim());
  log(`Board name : "${boardName}"\n`);

  // Extract pins and cursor from the inline bootstrap blob
  const { pins: bootstrapPins, boardId, boardUrl, nextBookmark } = await extractBootstrap(page);

  if (bootstrapPins.length > 0) {
    log(`  Bootstrap: found ${bootstrapPins.length} pins (bookmark: ${nextBookmark === '-end-' ? '-end-' : 'has more'})`);
    onPinBatch(bootstrapPins);
  } else {
    log(`  Bootstrap: no pins found in page HTML`);
  }

  // If bootstrap has a non-end bookmark, fetch remaining pages via API directly.
  // This is more reliable than scroll-based XHR interception for small/medium boards.
  if (nextBookmark && nextBookmark !== '-end-') {
    log(`  Fetching remaining pages via API...`);
    await fetchRemainingPages(page, boardId, boardUrl, nextBookmark, onPinBatch);
  }

  // Also scroll to catch any pins the API approach might miss (large boards, sections, etc.)
  await page.waitForTimeout(500);
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
