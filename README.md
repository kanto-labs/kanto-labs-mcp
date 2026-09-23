# Kanto Labs MCP server

<!-- tools:start -->
An [MCP](https://modelcontextprotocol.io) server that gives AI assistants (Claude, Cursor, VS Code Copilot and any other MCP client) 14 web, data and media tools, backed by Kanto Labs' actors on the [Apify Store](https://apify.com/kantolabs):

| Tool | What it does | Price |
|---|---|---|
| `detect_website_tech_stack` | Detect the technologies a website runs on: CMS, ecommerce, frameworks, analytics, CDN, hosting (7,600+ fingerprints). | **$0.003** per website |
| `convert_document_to_markdown` | Convert PDF, DOCX, PPTX, XLSX, EPUB, HTML and more from a URL to Markdown, with page/word counts and optional RAG chunks. | **$0.004** per document |
| `audit_website_seo` | On-page SEO audit: 0-100 score and prioritized issues, robots.txt, sitemap, llms.txt and AI-crawler checks, optional broken links and crawl. | **$0.004** per page |
| `extract_text_from_image` | OCR text from images, screenshots, photos and scanned PDFs, in reading order with confidence and optional line boxes. | **$0.003** per image or PDF page ($0.008 with quality "accurate") |
| `lookup_domain` | Domain RDAP/WHOIS, DNS records, SSL certificate expiry and SPF/DKIM/DMARC email security grade. | **$0.003** per domain |
| `extract_video_frames` (coming soon) | Extract scene-change or evenly spaced frames from video files, with public image links, timestamps and a free contact sheet. | **$0.002** per frame |
| `download_images` (coming soon) | Download every image from web pages or image links, de-duplicated and filtered, with public download URLs. | **$0.002** per image |
| `check_domain_authority` (coming soon) | 0-100 domain authority from the open Common Crawl web graph (133M domains): web rank, PageRank rank, top-% percentile and monthly trend. | **$0.001** per domain scored (unranked domains free) |
| `enrich_company` (coming soon) | Company profile from a domain or name: logo, description, social profiles, app links and key pages, plus industry, HQ, founding year, employees, revenue and ticker from Wikidata. | **$0.003** per company enriched |
| `upscale_image` (coming soon) | Upscale images 2x or 4x with Real-ESRGAN (photo or anime model), transparency kept, with public download links. | **$0.01** per image ($0.06 per large image with allowLargeImages) |
| `get_topic_trends` (coming soon) | Interest over time for topics on a shared 0-100 scale (a Google Trends alternative) from official Wikipedia pageviews since 2015: peak, trend, spikes and interest by language. | **$0.003** per topic |
| `get_trending_topics` (coming soon) | The most-read topics of a day per country or Wikipedia language edition, with views and a one-line description. | **$0.0005** per trending article |
| `check_website_traffic_rank` (coming soon) | Website popularity from real Chrome user data (CrUX): global rank tier, tier in 40 countries, top countries and monthly trend, plus Majestic rank and referring subnets. | **$0.002** per domain ranked (unranked domains free) |
| `search_free_images` (coming soon) | Search freely licensed images on Wikimedia Commons, with license, author and a ready-to-paste attribution line; filter by license, size, orientation and format. | **$0.001** per image |

Failed or unreachable inputs are **not charged**.

> **Coming soon:** `extract_video_frames`, `download_images`, `check_domain_authority`, `enrich_company`, `upscale_image`, `get_topic_trends`, `get_trending_topics`, `check_website_traffic_rank`, `search_free_images` are listed already, but their actors are not yet public on the Apify Store; until they are, calls to them return an "actor not yet public" error (nothing is charged).
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

- "What is stripe.com built with? And shopify.com?"
- "Convert https://arxiv.org/pdf/1706.03762 to Markdown and summarize section 3."
- "Audit the SEO of https://example.com and list the three most important fixes."
- "Crawl up to 20 pages of example.com, check broken links, keep it under $0.10."
- "Read the text on this receipt: https://example.com/receipt.jpg - what is the total?"
- "OCR this scanned Japanese PDF with the accurate model, first 5 pages only."
- "When do stripe.com and shopify.com expire, who is their registrar, and do they have DMARC set up?"
- "Is kanto-example-name.com still available to register?"
- "Pull 8 frames from https://media.w3.org/2010/05/sintel/trailer.mp4 and describe what happens in the video."
- "Download all product images wider than 300 px from https://books.toscrape.com/ as WEBP."
- "Which of these link-building prospects has the highest domain authority: example-blog.com, another-site.org, third-site.net?"
- "Enrich hubspot.com, Siemens and canva.com: industry, HQ, employees, logo and LinkedIn page."
- "Upscale https://example.com/product-small.jpg 4x as PNG."
- "Compare interest in ChatGPT, Gemini and Claude over the past 12 months. Which is growing?"
- "What were people in Japan and Germany reading about yesterday?"
- "How popular are zalando.de and allegro.pl, and in which countries?"
- "Find 10 landscape photos of the Eiffel Tower at night that need no attribution."

## Tool parameters

All tools also accept:

| Parameter | Meaning |
|---|---|
| `maxTotalChargeUsd` | Spending cap for this call in USD (default `KANTO_MAX_CHARGE_USD`, else 1.00). |
| `timeoutSecs` | Give up after this many seconds (10-300, default 280). Apify's synchronous runs are limited to 300 s, so split big batches. |

<!-- params:start -->
`detect_website_tech_stack`: `urls` (required), `minConfidence`, `includeDescriptions`.
`convert_document_to_markdown`: `documentUrls` (required), `chunkSize`, `chunkOverlap`, `includeMarkdown`, `maxFileSizeMb`.
`audit_website_seo`: `urls` (required), `maxPagesPerSite`, `checkBrokenLinks`, `maxLinksToCheckPerPage`.
`extract_text_from_image`: `sources` (required), `quality` (`fast`/`accurate`), `includeLines` (default false here), `minConfidence` (`0.3`/`0.4`/`0.5`/`0.6`/`0.7`/`0.8`), `pdfMode` (`auto`/`ocr`), `maxPdfPages`, `pdfDpi`.
`lookup_domain`: `domains` (required), `includeWhois`, `includeDns`, `includeSsl`, `includeEmailSecurity`.
`extract_video_frames`: `videoUrls` (required), `mode` (`auto`/`scenes`/`count`/`interval`), `frameCount`, `intervalSeconds`, `maxFramesPerVideo`, `sceneThreshold` (`0.15`/`0.2`/`0.3`/`0.4`/`0.5`), `imageFormat` (`jpg`/`png`/`webp`), `maxWidth`, `contactSheet`.
`download_images`: `urls` (required), `maxImagesPerPage`, `minWidth`, `minHeight`, `minFileSizeKb`, `allowedFormats`, `includeSvg`, `includeCssBackgrounds`, `includeIcons`, `convertTo` (`original`/`jpg`/`png`/`webp`), `maxDimension`, `dedupe`.
`check_domain_authority`: `domains` (required).
`enrich_company`: `companies` (required), `includeWebsite`, `includeWikidata`, `maxConcurrency`.
`upscale_image`: `imageUrls` (required), `scale` (`4`/`2`), `model` (`general`/`anime`), `outputFormat` (`jpeg`/`png`/`webp`), `quality`, `allowLargeImages`.
`get_topic_trends`: `keywords` (required), `language`, `timeRange` (`past7Days`/`past30Days`/`past90Days`/`past12Months`/`past5Years`/`all`/`custom`), `startDate`, `endDate`, `granularity` (`auto`/`daily`/`weekly`/`monthly`), `includeRedirects`, `includeLanguages`, `maxLanguages`, `platform` (`all-access`/`desktop`/`mobile-web`/`mobile-app`).
`get_trending_topics`: `trendingCountries`, `trendingProjects`, `trendingDate`, `maxTrending`, `platform` (`all-access`/`desktop`/`mobile-web`/`mobile-app`).
`check_website_traffic_rank`: `domains` (required), `includeCountries`.
`search_free_images`: `queries` (required), `maxResultsPerQuery`, `license` (`any`/`commercialNoShareAlike`/`noAttribution`), `minWidth`, `minHeight`, `orientation` (`any`/`landscape`/`portrait`/`square`), `fileTypes`, `thumbnailWidth`, `excludeRestricted`, `language`.
<!-- params:end -->

Each call returns two text blocks: a short human-readable summary (results, failures, cost) and compact JSON with every result item (empty fields dropped, very long text truncated at `KANTO_MAX_TEXT_CHARS`).

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `APIFY_TOKEN` | - (required) | Your Apify API token. `APIFY_API_TOKEN` is accepted too. |
| `KANTO_MAX_CHARGE_USD` | `1.00` | Default spending cap per call. |
| `KANTO_TIMEOUT_SECS` | `280` | Default timeout per call (max 300). |
| `KANTO_MAX_TEXT_CHARS` | `100000` | Truncate any single text field (e.g. a long document's Markdown) beyond this. |
| `KANTO_ACTORS_CONFIG` | bundled file | Path to an alternative `actors.config.json`. |

## Adding actors

Tools are generated from [`actors.config.json`](actors.config.json): the Apify actor ID, the tool description, typed parameters, price (with optional per-result price rules and a per-result charge count for actors that bill several events per row), input defaults, and a one-line summary template. Adding an actor is a config entry, no code. `comingSoon: true` marks an actor that is not public on the Apify Store yet (the tool is listed with a notice and a 404 is explained); `fixedInput` pins actor input for a tool (one actor can back several tools). `npm run build` regenerates the tool table above and `manifest.json` from the config.

## Development

```bash
npm install
npm run build
npm test                                   # offline: lists tools, checks the missing-token error
APIFY_TOKEN=... npm run test:live          # one tiny real call per tool (about $0.04)
npx @modelcontextprotocol/inspector node dist/index.js   # interactive inspector
npm run bundle                             # builds build/kanto-labs-mcp.mcpb
```

## Privacy

The server runs on your machine and talks only to `api.apify.com`. The URLs and domains you pass are processed by the actors on Apify; see each actor's page on the Apify Store. Your token is sent only to Apify and is never logged.

## License

MIT - see [LICENSE](LICENSE).
