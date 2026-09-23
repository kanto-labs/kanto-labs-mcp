// Offline mock-API test: points the server at a local fake Apify API (APIFY_API_BASE_URL) with a dummy token,
// then checks input forwarding (fixedInput, defaults), per-row price rules (free rows, large-image price,
// OCR accurate price, frameCount charging) and the "coming soon" 404 message. No network, no real token.
import http from "node:http";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const { actors } = JSON.parse(readFileSync(new URL("../actors.config.json", import.meta.url), "utf8"));

const replies = {
  "domain-authority-checker": [
    { input: "nytimes.com", domain: "nytimes.com", ranked: true, authorityScore: 91, authorityTier: "very high", harmonicCentralityRank: 62, topPercent: 0.00005, trend: "stable" },
    { input: "brand-new.example", domain: "brand-new.example", ranked: false, authorityScore: null, authorityScoreMax: 20, authorityTier: "very low" },
    { input: "not a domain", domain: null, ranked: false, error: "Not a valid domain name" },
  ],
  "ai-image-upscaler": [
    { imageUrl: "https://x/a.jpg", width: 300, height: 200, outputWidth: 1200, outputHeight: 800, model: "general", chargedAs: "image-upscaled", outputUrl: "https://x/a4.jpg" },
    { imageUrl: "https://x/b.jpg", width: 1600, height: 900, outputWidth: 6400, outputHeight: 3600, model: "general", chargedAs: "large-image-upscaled", outputUrl: "https://x/b4.jpg" },
  ],
  "wikipedia-trends": [
    { type: "trending", list: "country:US", date: "2026-09-21", rank: 1, article: "Example", viewsRoundedUp: 433900, description: "An example" },
    { type: "trending", list: "country:US", date: "2026-09-21", rank: 2, article: "Example 2", viewsRoundedUp: 255500 },
  ],
  "image-to-text-ocr": [
    { fileName: "a.png", page: 1, pageCount: 2, method: "ocr", quality: "accurate", charCount: 10, averageConfidence: 0.9 },
    { fileName: "a.pdf", page: 2, pageCount: 2, method: "pdf-text-layer", quality: "accurate", charCount: 5 },
  ],
  "video-frame-extractor": [
    { fileName: "v.mp4", frameCount: 4, durationSeconds: 10, width: 640, height: 360, contactSheetUrl: "https://x/cs.jpg" },
    { videoUrl: "https://bad", error: "Download failed" },
  ],
};
let last = { actor: "", body: "" };
const srv = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    const id = decodeURIComponent(req.url).split("~")[1].split("/")[0];
    last = { actor: id, body: b };
    res.setHeader("content-type", "application/json");
    if (id === "company-enrichment") {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { type: "record-not-found", message: "Actor was not found" } }));
      return;
    }
    res.end(JSON.stringify(replies[id] || []));
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));

const client = new Client({ name: "kanto-mock", version: "1.0.0" });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [server], stderr: "ignore",
  env: { ...process.env, APIFY_TOKEN: "mock-token-not-real", APIFY_API_BASE_URL: `http://127.0.0.1:${srv.address().port}` },
}));

let fails = 0;
const expect = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return { r, text: r.content[0].text, json: r.content[1] ? JSON.parse(r.content[1].text) : null };
};

// unranked domain row is free; invalid row is a failure (free)
let { json, text } = await call("check_domain_authority", { domains: ["nytimes.com", "brand-new.example", "not a domain"] });
expect(json.chargedResults === 1 && Math.abs(json.estimatedChargeUsd - 0.00105) < 1e-9, `domain authority: 1 charged, $0.00105 (got ${json.chargedResults}, ${json.estimatedChargeUsd})`);
expect(/2 domain\(s\) succeeded, 1 failed, 1 domain\(s\) charged/.test(text), "domain authority summary counts the free unranked row");

// large-image price rule
({ json } = await call("upscale_image", { imageUrls: ["https://x/a.jpg", "https://x/b.jpg"], allowLargeImages: true }));
expect(Math.abs(json.estimatedChargeUsd - 0.07005) < 1e-9, `upscaler: $0.01 + $0.06 (+ start) = $0.07005 (got ${json.estimatedChargeUsd})`);

// fixedInput: trending tool always sends mode=trending, and caller params are forwarded
({ json } = await call("get_trending_topics", { trendingCountries: ["US"], maxTrending: 2 }));
const sent = JSON.parse(last.body);
expect(last.actor === "wikipedia-trends" && sent.mode === "trending" && sent.maxTrending === 2, `trending: forwarded ${last.body}`);
expect(Math.abs(json.estimatedChargeUsd - 0.00105) < 1e-9, `trending: 2 x $0.0005 (+ start) = $0.00105 (got ${json.estimatedChargeUsd})`);
await call("get_topic_trends", { keywords: ["ChatGPT"] });
expect(JSON.parse(last.body).mode === "topics", `topics: forwarded ${last.body}`);

// existing behaviour still holds: OCR accurate price only on OCR rows, OCR includeLines default, video frameCount charging
({ json } = await call("extract_text_from_image", { sources: ["https://x/a.png"], quality: "accurate" }));
expect(JSON.parse(last.body).includeLines === false, "ocr: includeLines default false forwarded");
expect(Math.abs(json.estimatedChargeUsd - 0.01105) < 1e-9, `ocr: $0.008 + $0.003 (+ start) (got ${json.estimatedChargeUsd})`);
({ json } = await call("extract_video_frames", { videoUrls: ["https://x/v.mp4", "https://bad"], frameCount: 4 }));
expect(json.chargedResults === 4 && Math.abs(json.estimatedChargeUsd - 0.00805) < 1e-9, `video: 4 frames charged (got ${json.chargedResults}, ${json.estimatedChargeUsd})`);

// coming-soon actor answering 404 -> explained, not charged
const soonTool = actors.find((a) => a.actorId === "kantolabs/company-enrichment");
({ text } = await call("enrich_company", { companies: ["stripe.com"] }));
if (soonTool.comingSoon) expect(/not public on the Apify Store yet/.test(text) && /Nothing was charged/.test(text), `coming-soon 404: ${text.slice(0, 100)}...`);
else expect(/was not found \(404/.test(text), `live 404: ${text.slice(0, 100)}...`);

await client.close();
srv.close();
if (fails) { console.error(`${fails} mock check(s) failed`); process.exit(1); }
console.log("MOCK OK");
