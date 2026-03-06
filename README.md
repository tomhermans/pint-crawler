# pinterest-crawler

A two-script toolkit for backing up Pinterest boards locally. The crawler drives a real browser to collect every pin's image URL into a manifest file. The downloader reads that manifest and saves every image to a local folder. No third-party services, no accounts, no limits.

---

## Requirements

- Node.js 20 or higher
- A Pinterest account (for private boards — public boards work without logging in)

---

## Installation

```bash
npm install
npx playwright install chromium
```

---

## Quick start

```bash
# 1. Crawl a board
node crawl.js --url https://www.pinterest.com/youruser/your-board/

# 2. Download everything in the manifest it produced
node download.js --manifest manifest-your-board.json
```

Images land in `./downloads/your-board/`.

---

## crawl.js

Scrolls a Pinterest board in a real browser, intercepts the pin data as it loads, and writes a `manifest-{boardname}.json` file containing every pin's image URL and metadata.

### Usage

```bash
node crawl.js --url <board_url> [options]
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--url` | *(required)* | Full Pinterest board URL |
| `--cookies` | `./cookies.json` | Path to exported session cookies |
| `--out` | auto from URL | Override the output filename |
| `--headless` | `false` | Hide the browser window |
| `--upload` | `false` | Upload manifest to cloud after crawl |
| `--provider` | — | `r2` or `s3` — required when `--upload` is set |

### Auto-naming

The manifest filename is derived from the board URL automatically:

```
https://www.pinterest.com/username/ideas/  →  manifest-ideas.json
https://www.pinterest.com/username/travel/ →  manifest-travel.json
```

You can override this with `--out` if you want a custom name.

### Private boards

Pinterest requires you to be logged in to access private boards. Export your session cookies from the browser while logged into Pinterest using the [Cookie-Editor](https://cookie-editor.com) extension (export as JSON), save the file as `cookies.json` in the project folder, and the crawler will use them automatically.

For public boards you can skip this entirely.

### Resume support

If the crawl is interrupted, a `manifest-{board}.json.partial` file is written to disk after every batch of pins. Re-running the same command will detect this file, skip all already-collected pin IDs, and continue from where it left off. The partial file is deleted once the crawl finishes cleanly.

### Output format

```json
{
  "board": "Ideas",
  "url": "https://www.pinterest.com/user/ideas/",
  "crawled_at": "2026-03-06T14:00:00.000Z",
  "total": 804,
  "pins": [
    {
      "pin_id": "123456789",
      "image_url": "https://i.pinimg.com/originals/xx/yy/zz/image.jpg",
      "title": "Beautiful chair",
      "description": "Mid-century modern lounge chair",
      "source_url": "https://example.com/chair",
      "dominant_color": "#c4a882",
      "section": "Furniture",
      "created_at": "2024-01-15T10:30:00"
    }
  ]
}
```

---

## download.js

Reads a manifest file and downloads every image to a local folder. Handles retries, skips already-downloaded files, and logs anything that failed.

### Usage

```bash
node download.js --manifest <manifest_file> [options]
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--manifest` | *(required)* | Path to manifest JSON |
| `--out` | auto from manifest name | Override the output folder |
| `--concurrency` | `5` | Parallel downloads at once |
| `--retries` | `3` | Retry attempts per failed image |

### Auto-naming

The download folder is derived from the manifest filename:

```
manifest-ideas.json   →  ./downloads/ideas/
manifest-travel.json  →  ./downloads/travel/
```

### Resume support

A hidden `.progress.json` file inside the download folder tracks which pin IDs have been successfully downloaded. Re-running the command skips anything already on disk. Safe to interrupt and restart at any point.

### Failure log

Any images that fail after all retries are written to `failed.json` inside the download folder. You can inspect this file to see what went wrong, then re-run the downloader — it will skip everything already downloaded and attempt the failures again.

### Image filenames

```
{pin_id}_{sanitized_title}.jpg
```

For example: `804762341234_Mid_century_modern_chair.jpg`. The pin ID prefix makes every filename unique and lets you look up the original pin at `pinterest.com/pin/{pin_id}` if needed.

---

## Cloud upload (optional)

The upload subroutine is built in but disabled by default. It activates only when you pass `--upload --provider r2|s3` to the crawl script. Until then it adds zero overhead.

### Setup

```bash
npm install @aws-sdk/client-s3 dotenv
```

Create a `.env` file in the project folder:

**Cloudflare R2** (recommended — no egress fees):
```env
CLOUD_BUCKET_NAME=your-bucket-name
CLOUD_ACCOUNT_ID=your-cloudflare-account-id
CLOUD_ACCESS_KEY=your-r2-access-key-id
CLOUD_SECRET_KEY=your-r2-secret-access-key
CLOUD_KEY_PREFIX=boards
```

**AWS S3:**
```env
CLOUD_BUCKET_NAME=your-bucket-name
CLOUD_REGION=eu-west-1
CLOUD_ACCESS_KEY=your-access-key-id
CLOUD_SECRET_KEY=your-secret-access-key
CLOUD_KEY_PREFIX=boards
```

Then open `lib/upload.js` and follow the comments — the SDK code is written but commented out, clearly marked for where to uncomment.

### Usage

```bash
node crawl.js --url https://www.pinterest.com/user/board/ --upload --provider r2
```

The manifest uploads to: `boards/{board-slug}/manifest.json` in your bucket.

---

## Project structure

```
pinterest-crawler/
├── crawl.js              # Crawl a board → manifest JSON
├── download.js           # Download images from manifest
├── lib/
│   ├── interceptor.js    # Network response interceptor (taps Pinterest's internal API)
│   ├── scroller.js       # Human-like scroll loop with stop signal
│   ├── manifest.js       # Manifest builder and file I/O
│   ├── cookies.js        # Cookie file loader and normalizer
│   ├── args.js           # CLI argument parser
│   ├── logger.js         # Timestamped console output
│   └── upload.js         # Cloud upload subroutine (disabled by default)
├── cookies.json          # Your exported Pinterest cookies (you provide this)
├── .env                  # Cloud credentials (only needed for upload)
└── package.json
```

---

## How it works

### Why a real browser?

Pinterest is a React app that renders nothing useful in raw HTML. All pin data is loaded dynamically as the user scrolls. A simple HTTP scraper would get an empty shell. Using Playwright (a browser automation library) means we're running a real Chromium browser — the same one you'd use normally — so Pinterest behaves exactly as it would for a human visitor.

### Network interception instead of DOM scraping

As you scroll a Pinterest board, the page fires XHR requests to an internal endpoint:

```
/resource/BoardFeedResource/get/
```

Each response is a JSON payload containing a batch of roughly 25 pins, fully detailed — image URLs at every available resolution, title, description, source link, board section, creation date. Rather than reading the rendered HTML (which is fragile and changes often), the crawler intercepts these raw JSON responses at the network level using Playwright's `page.on('response', ...)` hook. This is faster, more reliable, and doesn't break when Pinterest updates its markup.

### End-of-board detection

Pinterest includes a `bookmark` field in each `BoardFeedResource` response. While there are more pins to load, this is an opaque cursor string used to fetch the next page. When the board is exhausted, Pinterest sets it to the string `"-end-"`. The interceptor watches for this value and sets a shared stop signal, which the scroller checks at the top of every loop — so the browser stops scrolling within one or two steps of the last pin loading, rather than running forever.

### Human-like scrolling

Rather than jumping straight to the bottom of the page (which Pinterest's bot detection would flag), the scroller moves in randomized increments (500–950px) with randomized pauses between each step (1.2–2.8 seconds). These ranges are tuned to feel like someone casually browsing — fast enough to get through a large board in a reasonable time, slow enough to look human.

Additional stealth measures applied to the browser:

- `--disable-blink-features=AutomationControlled` removes the flag browsers set when controlled by automation
- `navigator.webdriver` is overridden via an init script so it returns `undefined` instead of `true`
- A realistic `User-Agent` and viewport are set to match a normal desktop Chrome session

### Image resolution

Pinterest stores each image at multiple resolutions under keys like `originals`, `1200x`, `736x`, `474x`, `236x`. The interceptor checks them in that order and takes the highest available. Most pins will have `originals` — the full uncompressed source image as uploaded by the pinner. Some older pins only go up to `736x`.

### Download pipeline

The downloader runs a fixed-concurrency queue — 5 parallel downloads by default — using a simple worker pool pattern built on native `Promise`. Each download streams directly to disk rather than buffering the whole image in memory, which matters for boards with thousands of large images.

Requests include a `Referer: https://www.pinterest.com/` header, which Pinterest's image CDN requires to serve files. Without it, requests return 403.

Failed downloads retry up to 3 times with linear backoff (1.5s, 3s, 4.5s). Anything still failing after all retries is logged to `failed.json` for inspection.
