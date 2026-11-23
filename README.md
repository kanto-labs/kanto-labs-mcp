# Kanto Labs MCP server

<!-- tools:start -->
An [MCP](https://modelcontextprotocol.io) server that gives AI assistants (Claude, Cursor, VS Code Copilot and any other MCP client) 8 video and image tools, backed by Kanto Labs' actors on the [Apify Store](https://apify.com/kantolabs):

| Tool | What it does | Price |
|---|---|---|
| `extract_video_frames` | Extract scene-change or evenly spaced frames from video files, with public image links, timestamps and a free contact sheet. | **$0.002** per frame |
| `video_to_llm_context` | Turn a video file into AI-readable context: scene list, one keyframe per scene, Whisper transcript per scene and a ready-to-paste text block. | **$0.002** per keyframe + $0.008 per audio minute |
| `detect_video_scenes` | Detect every shot in a video file: cut, dissolve and fade timecodes, keyframes, a shot sheet and CSV/JSON/EDL files, optional clips. | **$0.018** per video minute (+ $0.002 per clip with splitClips) |
| `upscale_image` | Upscale images 2x or 4x with Real-ESRGAN (photo or anime model), transparency kept, with public download links. | **$0.01** per image ($0.06 per large image with allowLargeImages) |
| `video_to_slides` | Extract every unique slide from lecture, webinar and screen-recording files as images with timestamps, slide text (OCR) and one PDF. | **$0.004** per slide + $0.001 per video minute |
| `video_ocr` | Extract on-screen text from video files (burned-in subtitles, captions, hook text, lower-thirds, slide text) as timed segments with a transcript and SRT/VTT. | **$0.002** per frame with text |
| `transcribe_douyin_videos` | Transcribe public Douyin (抖音) videos to punctuated Chinese text with timed segments, SRT/VTT subtitles and video metadata. | **$0.004** per transcript + $0.003 per extra minute |
| `search_1688_products` | Search 1688.com (China wholesale) by keyword, photo or link: CNY/USD prices, MOQ, price tiers, SKUs and supplier badges. | **$0.0009** per product + $0.001 per product page + $0.0005 per image match |

Failed or unreachable inputs are **not charged**.
<!-- tools:end -->

## How billing works

The server is free and open source (MIT). Each tool call runs the matching actor on Apify with **your own Apify API token**, so the actor's pay-per-event price is billed to your Apify account (Apify's free plan includes monthly credit). There is no Kanto Labs account, key or subscription.

Every call carries a spending cap: `maxTotalChargeUsd` (default **$1.00**, change it with the `KANTO_MAX_CHARGE_USD` env var or per call). Apify stops the run once it has charged that much, so an assistant cannot run up a large bill by accident. Each result states what the call cost.

## Setup

1. Get an Apify API token: sign up at [apify.com](https://apify.com), then **Settings -> API & Integrations** ([console.apify.com/settings/integrations](https://console.apify.com/settings/integrations)).
2. Add the server to your client (Node.js 18.17+ required; `npx` downloads and builds it from GitHub on first run).

### Claude Desktop

Edit `claude_desktop_config.json` (Settings -> Developer -> Edit Config):

```json
{
  "mcpServers": {
    "kanto-labs": {
      "command": "npx",
      "args": ["-y", "github:kanto-labs/kanto-labs-mcp"],
      "env": { "APIFY_TOKEN": "apify_api_your_token_here" }
    }
  }
}
```

Or install the one-click bundle `kanto-labs-mcp.mcpb` from the [Releases page](https://github.com/kanto-labs/kanto-labs-mcp/releases): double-click it and paste your token when asked.

### Claude Code

```bash
claude mcp add kanto-labs -e APIFY_TOKEN=apify_api_your_token_here -- npx -y github:kanto-labs/kanto-labs-mcp
```

### Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "kanto-labs": {
      "command": "npx",
      "args": ["-y", "github:kanto-labs/kanto-labs-mcp"],
      "env": { "APIFY_TOKEN": "apify_api_your_token_here" }
    }
  }
}
```

### VS Code (GitHub Copilot agent mode)

`.vscode/mcp.json` - the token is asked for once and stored securely:

```json
{
  "inputs": [
    { "type": "promptString", "id": "apify_token", "description": "Apify API token", "password": true }
  ],
  "servers": {
    "kanto-labs": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:kanto-labs/kanto-labs-mcp"],
      "env": { "APIFY_TOKEN": "${input:apify_token}" }
    }
  }
}
```

### Windsurf, Cline, Zed and others

Any client that launches stdio servers works: command `npx`, args `-y github:kanto-labs/kanto-labs-mcp`, env `APIFY_TOKEN`.

> **Windows:** if your client reports `spawn npx ENOENT`, use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "github:kanto-labs/kanto-labs-mcp"]`.

## Example prompts

- "Pull 8 frames from https://media.w3.org/2010/05/sintel/trailer.mp4 and describe what happens in the video."
- "Summarize this webinar recording scene by scene: https://example.com/webinar.mp4"
- "Turn https://example.com/demo.mp4 into chapters with timestamps, using the transcript and keyframes."
- "How many shots does this ad have, and how fast is it cut? https://example.com/ad.mp4"
- "Give me an EDL of every cut in https://example.com/edit.mp4 and split it into one clip per shot."
- "Upscale https://example.com/product-small.jpg 4x as PNG."
- "Get the slides of this lecture recording as a PDF, with the text of each slide: https://example.com/lecture.mp4"
- "Read the burned-in subtitles of https://example.com/clip.mp4 and give me an SRT file."

## Tool parameters

All tools also accept:

| Parameter | Meaning |
|---|---|
| `maxTotalChargeUsd` | Spending cap for this call in USD (default `KANTO_MAX_CHARGE_USD`, else 1.00). |
| `timeoutSecs` | Give up after this many seconds (10-300, default 280). Apify's synchronous runs are limited to 300 s, so split big batches. |

<!-- params:start -->
`extract_video_frames`: `videoUrls` (required), `mode` (`auto`/`scenes`/`count`/`interval`), `frameCount`, `intervalSeconds`, `maxFramesPerVideo`, `sceneThreshold` (`0.15`/`0.2`/`0.3`/`0.4`/`0.5`), `imageFormat` (`jpg`/`png`/`webp`), `maxWidth`, `contactSheet`.
`video_to_llm_context`: `videoUrls` (required), `maxKeyframes`, `transcribe`, `language`, `sceneThreshold` (`0.15`/`0.2`/`0.3`/`0.4`/`0.5`), `gridImage`, `includeImageUrlsInContext`, `keyframeMaxWidth`, `imageFormat` (`jpg`/`png`/`webp`), `maxDurationMinutes`.
`detect_video_scenes`: `videoUrls` (required), `threshold`, `minShotSeconds`, `detectDissolves`, `keyframes`, `shotSheetImage`, `splitClips`, `maxClips`, `maxDurationMinutes`.
`upscale_image`: `imageUrls` (required), `scale` (`4`/`2`), `model` (`general`/`anime`), `outputFormat` (`jpeg`/`png`/`webp`), `quality`, `allowLargeImages`.
`video_to_slides`: `videoUrls` (required), `sensitivity` (`low`/`medium`/`high`), `minSlideSeconds`, `ocr`, `ocrLanguage` (`en`/`latin`/`cyrillic`/`korean`/`arabic`/`devanagari`/`greek`/`thai`), `outputPdf`, `contactSheet`, `imageFormat` (`jpg`/`png`/`webp`), `maxWidth`, `maxSlidesPerVideo`, `maxVideoMinutes`.
`video_ocr`: `videoUrls` (default [] here), `frameUrls`, `datasetId`, `sampleIntervalSeconds`, `ocrLanguage` (`en`/`latin`/`cyrillic`/`korean`/`arabic`/`devanagari`/`greek`/`thai`), `textRegion` (`full`/`bottom`/`top`), `minConfidence`, `minTextLength`, `maxFramesPerVideo`, `maxVideoMinutes`.
`transcribe_douyin_videos`: `videoUrls` (default [] here), `collectionUrls`, `maxVideosPerSource`, `maxVideoMinutes`.
`search_1688_products`: `keywords`, `productUrls`, `imageUrls`, `maxResultsPerImage`, `maxItemsPerKeyword` (default 20 here), `includeDetails`, `sortBy` (`relevance`/`sales`/`priceAsc`/`priceDesc`), `minPrice`, `maxPrice`, `province`, `supplierType` (`any`/`manufacturer`/`factoryVerified`/`superFactory`), `excludeAds`.
<!-- params:end -->

Each call returns two text blocks: a short human-readable summary (results, failures, cost) and compact JSON with every result item (empty fields dropped, very long text truncated at `KANTO_MAX_TEXT_CHARS`).

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `APIFY_TOKEN` | - (required) | Your Apify API token. `APIFY_API_TOKEN` is accepted too. |
| `KANTO_MAX_CHARGE_USD` | `1.00` | Default spending cap per call. |
| `KANTO_TIMEOUT_SECS` | `280` | Default timeout per call (max 300). |
| `KANTO_MAX_TEXT_CHARS` | `100000` | Truncate any single text field (e.g. a long transcript) beyond this. |
| `KANTO_ACTORS_CONFIG` | bundled file | Path to an alternative `actors.config.json`. |

## Adding actors

Tools are generated from [`actors.config.json`](actors.config.json): the Apify actor ID, the tool description, typed parameters, price (with optional per-result price rules, a per-result charge count for actors that bill several events per row, and extra charge events such as audio minutes or clips), input defaults, and a one-line summary template. Adding an actor is a config entry, no code. `comingSoon: true` marks an actor that is not public on the Apify Store yet (the tool is listed with a notice and a 404 is explained); `fixedInput` pins actor input for a tool (one actor can back several tools). `npm run build` regenerates the tool table above and `manifest.json` from the config.

## Development

```bash
npm install
npm run build
npm test                                   # offline: lists tools, checks the missing-token error
APIFY_TOKEN=... npm run test:live          # one tiny real call per tool (about $0.05)
npx @modelcontextprotocol/inspector node dist/index.js   # interactive inspector
npm run bundle                             # builds build/kanto-labs-mcp.mcpb
```

## Privacy

The server runs on your machine and talks only to `api.apify.com`. The URLs you pass are processed by the actors on Apify; see each actor's page on the Apify Store. Your token is sent only to Apify and is never logged.

## License

MIT - see [LICENSE](LICENSE).
