// Live test: one tiny real call per tool. Costs about $0.05 on the token's Apify account for all of them.
// Pass tool names (comma-separated) as the first argument to run only those. Tools marked comingSoon in
// actors.config.json are skipped unless named explicitly (their actors are still private).
// Token comes from APIFY_TOKEN, or from the file named by APIFY_TOKEN_FILE. It is never printed.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const token = process.env.APIFY_TOKEN || (process.env.APIFY_TOKEN_FILE && readFileSync(process.env.APIFY_TOKEN_FILE, "utf8").trim());
if (!token) throw new Error("Set APIFY_TOKEN or APIFY_TOKEN_FILE");

const server = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const client = new Client({ name: "kanto-live", version: "1.0.0" });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [server], env: { ...process.env, APIFY_TOKEN: token }, stderr: "inherit",
}));

const calls = [
  ["extract_video_frames", { videoUrls: ["https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4"], mode: "count", frameCount: 4, maxTotalChargeUsd: 0.05 }],
  ["video_to_llm_context", { videoUrls: ["https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4"], maxKeyframes: 3, maxTotalChargeUsd: 0.05 }],
  ["detect_video_scenes", { videoUrls: ["https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4"], maxTotalChargeUsd: 0.05 }],
  ["upscale_image", { imageUrls: ["https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fronalpstock_big.jpg/330px-Fronalpstock_big.jpg"], scale: "2", maxTotalChargeUsd: 0.05 }],
  ["transcribe_douyin_videos", { videoUrls: ["https://www.douyin.com/video/7681665941524877011"], maxTotalChargeUsd: 0.05 }],
  ["search_1688_products", { keywords: ["phone case"], maxItemsPerKeyword: 3, maxTotalChargeUsd: 0.05 }],
];
const soon = new Set(JSON.parse(readFileSync(new URL("../actors.config.json", import.meta.url), "utf8")).actors
  .filter((a) => a.comingSoon).map((a) => a.tool));
const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
let failures = 0;
for (const [name, args] of calls) {
  if (only && !only.has(name)) continue;
  if (!only && soon.has(name)) { console.log(`
=== ${name}: skipped (comingSoon)`); continue; }
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== ${name} (${secs}s) isError=${!!r.isError}`);
  console.log(r.content[0].text);
  if (r.content[1]) {
    const j = JSON.parse(r.content[1].text);
    const first = j.items[0] || {};
    console.log(`JSON: ${r.content[1].text.length} chars, item keys: ${Object.keys(first).join(", ")}`);
  }
  if (r.isError) failures++;
}
await client.close();
if (failures) { console.error(`${failures} live call(s) failed`); process.exit(1); }
console.log("\nLIVE OK");
