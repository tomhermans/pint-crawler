import { log } from './logger.js';

/**
 * Scrolls the page in randomized increments with randomized delays.
 * Stops when either:
 *   - stopSignal.done is set to true by the interceptor (clean end of board)
 *   - The page height hasn't grown for MAX_STUCK consecutive checks (fallback)
 *
 * @param {import('playwright').Page} page
 * @param {{ done: boolean }} stopSignal
 */
export const scrollBoard = async (page, stopSignal) => {
  log('Starting scroll...');

  let lastHeight = 0;
  let stuckCount = 0;
  let scrollStep = 0;

  // How many consecutive no-growth checks before giving up.
  // Higher = more patient on large boards where Pinterest occasionally
  // pauses between batches. 8 gives ~32-48s of waiting at progressive delays.
  const MAX_STUCK = 8;

  while (true) {
    if (stopSignal.done) {
      log('  Stop signal received — scroll complete');
      break;
    }

    // Scroll in human-like increments. Larger delta = faster on big boards,
    // but too large risks skipping Pinterest's lazy-load trigger zone.
    const delta = randomBetween(600, 1100);
    await page.evaluate((d) => window.scrollBy(0, d), delta);

    // Delay between scrolls. Pinterest needs time to fire XHRs and render.
    // Wide range looks human and avoids rate-limit pattern detection.
    await sleep(randomBetween(1200, 2800));

    if (stopSignal.done) {
      log('  Stop signal received — scroll complete');
      break;
    }

    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    const scrollY = await page.evaluate(() => window.scrollY);
    const windowHeight = await page.evaluate(() => window.innerHeight);
    const distanceFromBottom = currentHeight - scrollY - windowHeight;

    scrollStep++;

    if (scrollStep % 5 === 0) {
      log(`  Scroll step ${scrollStep} — page height: ${currentHeight}px, ~${distanceFromBottom}px from bottom`);
    }

    if (currentHeight === lastHeight) {
      stuckCount++;
      log(`  No new content (stuck ${stuckCount}/${MAX_STUCK})`);

      if (stuckCount >= MAX_STUCK) {
        log('  Page stopped growing — assuming end of board');
        break;
      }

      // Progressively longer waits — gives Pinterest time to recover
      // from a slow batch response before we give up.
      const stuckDelay = Math.min(3000 + stuckCount * 1000, 8000);
      await sleep(stuckDelay + randomBetween(0, 1000));
    } else {
      stuckCount = 0;
      lastHeight = currentHeight;
    }
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
