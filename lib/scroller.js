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
  const MAX_STUCK = 4;

  while (true) {
    // Check stop signal first — interceptor already confirmed end of board
    if (stopSignal.done) {
      log('  Stop signal received — scroll complete');
      break;
    }

    const delta = randomBetween(500, 950);
    await page.evaluate((d) => window.scrollBy(0, d), delta);
    await sleep(randomBetween(1200, 2800));

    // Check again after the delay — signal may have arrived during the wait
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

      await sleep(randomBetween(2500, 4000));
    } else {
      stuckCount = 0;
      lastHeight = currentHeight;
    }
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
