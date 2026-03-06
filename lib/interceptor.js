import { log, logWarn } from './logger.js';

const FEED_RESOURCE_PATTERN = /BoardFeedResource\/get/;

/**
 * Registers a response interceptor on the page.
 * Calls onPinBatch(pins[]) whenever a new batch arrives.
 * Sets stopSignal.done = true when Pinterest signals end of board.
 *
 * @param {import('playwright').Page} page
 * @param {(pins: object[]) => void} onPinBatch
 * @param {{ done: boolean }} stopSignal  - shared object checked by scroller
 */
export const interceptPins = async (page, onPinBatch, stopSignal) => {
  page.on('response', async (response) => {
    const url = response.url();
    if (!FEED_RESOURCE_PATTERN.test(url)) return;

    let json;
    try {
      json = await response.json();
    } catch {
      return;
    }

    const pins = extractPins(json);
    if (pins.length > 0) onPinBatch(pins);

    // Pinterest sets bookmark to '-end-' or omits it when there are no more pins
    const bookmark = json?.resource_response?.bookmark;
    if (bookmark === '-end-' || (bookmark == null && pins.length === 0)) {
      log('  → End of board detected — stopping scroll');
      stopSignal.done = true;
    }
  });
};

const extractPins = (json) => {
  const data = json?.resource_response?.data;
  if (!Array.isArray(data)) return [];

  const pins = [];

  for (const item of data) {
    // Items are pins directly — no nested .pin wrapper in board feed responses
    const pin = item;

    // id can be numeric string OR alphanumeric (e.g. "A9lhbwAQgCYIpLTZKEomDKE")
    if (!pin?.id || pin.type !== "pin") continue;

    pins.push({
      pin_id: String(pin.id),
      image_url: resolveImageUrl(pin),
      title: pin.title ?? "",
      description: pin.description ?? "",
      source_url: pin.link ?? "",
      dominant_color: pin.dominant_color ?? "",
      section: pin.board_section?.title ?? null,
      created_at: pin.created_at ?? null,
    });
  }

  return pins;
};

const RESOLUTION_PREFERENCE = ['originals', '1200x', '736x', '600x', '474x', '236x'];

const resolveImageUrl = (pin) => {
  const images = pin?.images;
  if (!images) return null;

  for (const key of RESOLUTION_PREFERENCE) {
    if (images[key]?.url) return images[key].url;
  }

  const fallback = Object.values(images).find((v) => v?.url);
  if (fallback) return fallback.url;

  logWarn(`No image URL found for pin ${pin.id}`);
  return null;
};
