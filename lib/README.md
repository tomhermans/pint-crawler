# pinterest-crawler

Crawls a Pinterest board by driving a real browser (Playwright), intercepting Pinterest's internal JSON API as you scroll, and writing a `manifest.json` of all pins — including full-resolution image URLs.

---

## How it works

Pinterest lazy-loads pins via XHR requests to `/resource/BoardFeedResource/get/` as the page scrolls. Instead of scraping the DOM, this tool intercepts those JSON responses directly — it's faster, more reliable, and doesn't break when Pinterest tweaks its markup.

The browser scrolls in randomized increments with randomized delays to mimic human behavior. Stealth args are applied to avoid automation detection.

---

## Setup

### 1. Install dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Export your Pinterest cookies (for private boards)

Install the [Cookie-Editor](https://cookie-editor.com) browser extension, log into Pinterest, then export your cookies as JSON. Save the file as `cookies.json` in this directory.

> Skip this step if you only need public boards.

### 3. Run the crawler

```bash
node crawl.js --url https://www.pinterest.com/yourusername/your-board-name/
```

---

## Options

| Flag          | Default          | Description                                      |
|---------------|------------------|--------------------------------------------------|
| `--url`       | *(required)*     | Full URL of the Pinterest board                  |
| `--cookies`   | `./cookies.json` | Path to exported cookies file                    |
| `--out`       | `./manifest.json`| Output path for the manifest                     |
| `--headless`  | `false`          | Run browser headlessly (no visible window)       |
| `--upload`    | `false`          | Upload manifest to cloud after crawl             |
| `--provider`  | —                | `r2` or `s3` (required when `--upload` is set)   |

---

## Output

`manifest.json`:

```json
{
  "board": "My Inspiration Board",
  "url": "https://www.pinterest.com/user/board/",
  "crawled_at": "2026-03-06T14:00:00.000Z",
  "total": 847,
  "pins": [
    {
      "pin_id": "123456789",
      "image_url": "https://i.pinimg.com/originals/xx/yy/zz/image.jpg",
      "title": "Beautiful chair",
      "description": "Mid-century modern lounge chair",
      "source_url": "https://example.com/product/chair",
      "dominant_color": "#c4a882",
      "section": "Furniture",
      "created_at": "2024-01-15T10:30:00"
    }
  ]
}
```

---

## Resume support

If the crawl is interrupted, a `manifest.json.partial` file is written after every batch. Re-running the same command will pick up from where it left off, skipping already-collected pin IDs.

---

## Cloud upload (optional)

The upload subroutine is behind a flag and **disabled by default**. To enable it:

### 1. Install the optional dependencies

```bash
npm install @aws-sdk/client-s3 dotenv
```

### 2. Create a `.env` file

**For Cloudflare R2:**
```env
CLOUD_BUCKET_NAME=your-bucket-name
CLOUD_ACCOUNT_ID=your-cloudflare-account-id
CLOUD_ACCESS_KEY=your-r2-access-key-id
CLOUD_SECRET_KEY=your-r2-secret-access-key
CLOUD_KEY_PREFIX=boards
```

**For AWS S3:**
```env
CLOUD_BUCKET_NAME=your-bucket-name
CLOUD_REGION=eu-west-1
CLOUD_ACCESS_KEY=your-access-key-id
CLOUD_SECRET_KEY=your-secret-access-key
CLOUD_KEY_PREFIX=boards
```

### 3. Uncomment the SDK code in `lib/upload.js`

Follow the comments in that file — it's clearly marked.

### 4. Run with the upload flag

```bash
node crawl.js --url https://www.pinterest.com/user/board/ --upload --provider r2
```

The manifest will be uploaded to: `boards/{board-slug}/manifest.json`

---

## Project structure

```
pinterest-crawler/
├── crawl.js              # Entry point
├── lib/
│   ├── args.js           # CLI argument parser
│   ├── cookies.js        # Cookie loader + normalizer
│   ├── interceptor.js    # Network response interceptor
│   ├── manifest.js       # Manifest builder + file I/O
│   ├── scroller.js       # Human-like scroll loop
│   ├── logger.js         # Timestamped console output
│   └── upload.js         # Cloud upload subroutine (disabled by default)
├── cookies.json          # Your exported Pinterest cookies (you provide this)
├── .env                  # Cloud credentials (you provide this, only if uploading)
└── package.json
```
