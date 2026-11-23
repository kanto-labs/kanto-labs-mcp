// Offline mock-API test: points the server at a local fake Apify API (APIFY_API_BASE_URL) with a dummy token,
// then checks input forwarding, per-row price rules (large-image price, frameCount charging), extra charge
// events (audio minutes, clips) and the 404 message. No network, no real token.
import http from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const replies = {
  "ai-image-upscaler": [
    { imageUrl: "https://x/a.jpg", width: 300, height: 200, outputWidth: 1200, outputHeight: 800, model: "general", chargedAs: "image-upscaled", outputUrl: "https://x/a4.jpg" },
    { imageUrl: "https://x/b.jpg", width: 1600, height: 900, outputWidth: 6400, outputHeight: 3600, model: "general", chargedAs: "large-image-upscaled", outputUrl: "https://x/b4.jpg" },
  ],
  "video-frame-extractor": [
    { fileName: "v.mp4", frameCount: 4, durationSeconds: 10, width: 640, height: 360, contactSheetUrl: "https://x/cs.jpg" },
    { videoUrl: "https://bad", error: "Download failed" },
  ],
  "video-to-llm-context": [
    { fileName: "webinar.mp4", status: "ok", durationSeconds: 600, width: 1280, height: 720, sceneCount: 12, billedKeyframes: 12, billedAudioMinutes: 10, gridImageUrl: "https://x/grid.jpg", error: null },
    { fileName: "silent.mp4", status: "ok", durationSeconds: 300, width: 1280, height: 720, sceneCount: 3, billedKeyframes: 3, billedAudioMinutes: 0, gridImageUrl: "https://x/grid2.jpg", error: null },
    { videoUrl: "https://bad", status: "failed", billedKeyframes: 0, billedAudioMinutes: 0, error: "Download failed" },
  ],
  "video-scene-detection": [
    { fileName: "ad.mp4", status: "ok", durationSeconds: 600, shotCount: 60, hardCutCount: 58, dissolveCount: 2, fadeCount: 0, cutsPerMinute: 5.9, billedMinutes: 10, billedClips: 60, edlUrl: "https://x/a.edl", shotSheetImageUrl: "https://x/s.jpg" },
  ],
  "video-to-slides": [
    { type: "slide", fileName: "lecture.mp4", slideIndex: 1, timecode: "00:00:05.000", durationSeconds: 40, imageUrl: "https://x/s1.jpg", text: "Intro" },
    { type: "slide", fileName: "lecture.mp4", slideIndex: 2, timecode: "00:00:45.000", durationSeconds: 60, imageUrl: "https://x/s2.jpg", text: "Agenda" },
    { type: "video", fileName: "lecture.mp4", status: "ok", durationSeconds: 600, slideCount: 15, billedMinutes: 10, pdfUrl: "https://x/deck.pdf", error: null },
    { type: "video", videoUrl: "https://bad", status: "failed", slideCount: 0, billedMinutes: 0, error: "Download failed" },
  ],
  "video-ocr": [
    { type: "text", fileName: "ad.mp4", segmentIndex: 1, text: "SUMMER SALE", timecode: "00:00:01.000", endTimecode: "00:00:04.000", position: "middle" },
    { type: "video", fileName: "ad.mp4", status: "ok", segmentCount: 1, framesWithText: 24, srtUrl: "https://x/a.srt", error: null },
    { type: "video", fileName: "interview.mp4", status: "no-text", segmentCount: 0, framesWithText: 0, srtUrl: null, error: null },
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
    if (b.includes("404.mp4")) {
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

let json, text;
// large-image price rule
({ json } = await call("upscale_image", { imageUrls: ["https://x/a.jpg", "https://x/b.jpg"], allowLargeImages: true }));
expect(Math.abs(json.estimatedChargeUsd - 0.07005) < 1e-9, `upscaler: $0.01 + $0.06 (+ start) = $0.07005 (got ${json.estimatedChargeUsd})`);

// video frameCount charging; failed rows are free
({ json } = await call("extract_video_frames", { videoUrls: ["https://x/v.mp4", "https://bad"], frameCount: 4 }));
expect(json.chargedResults === 4 && Math.abs(json.estimatedChargeUsd - 0.00805) < 1e-9, `video: 4 frames charged (got ${json.chargedResults}, ${json.estimatedChargeUsd})`);

// two-event pricing: keyframes + audio minutes (failed row free)
({ json, text } = await call("video_to_llm_context", { videoUrls: ["https://x/webinar.mp4", "https://x/silent.mp4", "https://bad"] }));
expect(json.chargedResults === 15 && Math.abs(json.estimatedChargeUsd - (15 * 0.002 + 10 * 0.008 + 0.00005)) < 1e-9,
  `llm context: 15 keyframes + 10 audio min = $0.11005 (got ${json.chargedResults}, ${json.estimatedChargeUsd})`);
expect(/2 video\(s\) succeeded, 1 failed, 15 keyframe\(s\) charged/.test(text) && /\+ \$0\.0080 per audio minute/.test(text), `llm context summary: ${text.split("\n")[0].slice(0, 160)}`);

// video minutes + clips
({ json } = await call("detect_video_scenes", { videoUrls: ["https://x/ad.mp4"], splitClips: true }));
expect(JSON.parse(last.body).splitClips === true, `scenes: forwarded ${last.body}`);
expect(json.chargedResults === 10 && Math.abs(json.estimatedChargeUsd - (10 * 0.018 + 60 * 0.002 + 0.00005)) < 1e-9,
  `scenes: 10 min + 60 clips = $0.30005 (got ${json.chargedResults}, ${json.estimatedChargeUsd})`);

// slides: slide rows are not charged themselves; the video row carries slideCount + billedMinutes (failed row free)
({ json, text } = await call("video_to_slides", { videoUrls: ["https://x/lecture.mp4", "https://bad"] }));
expect(json.chargedResults === 15 && Math.abs(json.estimatedChargeUsd - (15 * 0.004 + 10 * 0.001 + 0.00005)) < 1e-9,
  `slides: 15 slides + 10 video min = $0.07005 (got ${json.chargedResults}, ${json.estimatedChargeUsd})`);
expect(/- slide 2 of lecture\.mp4 at 00:00:45\.000/.test(text) && /lecture\.mp4: ok, 15 slides .*PDF https:\/\/x\/deck\.pdf/.test(text) && !/\?/.test(text.split("\n").slice(1).join("\n")),
  `slides per-row summaries: ${text.split("\n").slice(1, 4).join(" | ").slice(0, 200)}`);

// video OCR: only frames with text are charged; videoUrls defaults to [] (so the actor never falls back to its paid sample)
({ json, text } = await call("video_ocr", { frameUrls: ["https://x/f-0001-000001000ms.jpg"] }));
const ocrIn = JSON.parse(last.body);
expect(Array.isArray(ocrIn.videoUrls) && ocrIn.videoUrls.length === 0 && ocrIn.frameUrls.length === 1, `ocr: frames-only input ${last.body}`);
expect(json.chargedResults === 24 && Math.abs(json.estimatedChargeUsd - (24 * 0.002 + 0.00005)) < 1e-9,
  `ocr: 24 frames with text = $0.04805 (got ${json.chargedResults}, ${json.estimatedChargeUsd})`);
expect(/- 00:00:01\.000 - 00:00:04\.000 \[middle\] SUMMER SALE/.test(text) && /interview\.mp4: no on-screen text found \(free\)/.test(text),
  `ocr per-row summaries: ${text.split("\n").slice(1, 4).join(" | ").slice(0, 200)}`);

// actor answering 404 -> explained as not found
({ text } = await call("detect_video_scenes", { videoUrls: ["https://x/404.mp4"] }));
expect(/was not found \(404/.test(text), `404: ${text.slice(0, 100)}...`);

await client.close();
srv.close();
if (fails) { console.error(`${fails} mock check(s) failed`); process.exit(1); }
console.log("MOCK OK");
