// Offline smoke test: starts the server over stdio WITHOUT a token, lists the tools,
// and checks that a call fails with a clear "APIFY_TOKEN is not set" error.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const server = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const env = { ...process.env };
delete env.APIFY_TOKEN;
delete env.APIFY_API_TOKEN;

const client = new Client({ name: "kanto-smoke", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], env, stderr: "ignore" }));

const { tools } = await client.listTools();
console.log(`tools/list -> ${tools.length} tools`);
for (const t of tools) {
  console.log(`  ${t.name}  params: ${Object.keys(t.inputSchema.properties).join(", ")}  required: ${(t.inputSchema.required || []).join(", ")}`);
}
const expected = ["extract_video_frames", "video_to_llm_context", "detect_video_scenes", "upscale_image", "video_to_slides", "video_ocr", "transcribe_douyin_videos", "search_1688_products"];
if (tools.length !== expected.length) throw new Error(`expected ${expected.length} tools, got ${tools.length}`);
for (const n of expected) if (!tools.some((t) => t.name === n)) throw new Error(`tool missing: ${n}`);
// comingSoon flag <-> COMING SOON notice in the description and "(coming soon)" in the title, one to one
const { actors } = JSON.parse(readFileSync(new URL("../actors.config.json", import.meta.url), "utf8"));
for (const a of actors) {
  const t = tools.find((x) => x.name === a.tool);
  const marked = t.description.startsWith("COMING SOON:") && /\(coming soon\)$/.test(t.title || "");
  if (!!a.comingSoon !== marked) throw new Error(`${a.tool}: comingSoon=${!!a.comingSoon} but marked=${marked}`);
  if (a.fixedInput) for (const k of Object.keys(a.fixedInput)) if (t.inputSchema.properties[k]) throw new Error(`${a.tool}: fixed input ${k} exposed`);
}
console.log(`coming soon: ${actors.filter((a) => a.comingSoon).map((a) => a.tool).join(", ") || "none"}`);
for (const t of tools) {
  if (!/\$0\.\d+ per /.test(t.description)) throw new Error(`${t.name}: description has no price`);
  if (!t.inputSchema.properties.maxTotalChargeUsd) throw new Error(`${t.name}: no maxTotalChargeUsd param`);
}

const r = await client.callTool({ name: tools[0].name, arguments: { videoUrls: ["https://example.com/v.mp4"] } });
console.log(`no-token call -> isError=${r.isError}: ${r.content[0].text.slice(0, 90)}...`);
if (!r.isError || !/APIFY_TOKEN is not set/.test(r.content[0].text)) throw new Error("missing-token error not raised");

const rejected = (r) => !!r.thrown || (!!r.isError && !/APIFY_TOKEN is not set/.test(r.content[0].text));
const bad = await client.callTool({ name: tools[0].name, arguments: { videoUrls: [] } }).catch((e) => ({ thrown: e.message }));
console.log(`empty-videoUrls validation -> ${JSON.stringify(bad).slice(0, 120)}`);
if (!rejected(bad)) throw new Error("empty urls accepted");

// Enum validation on a string[] param and on a string param. With no token set, a call that passes
// validation fails with "APIFY_TOKEN is not set", so that message means validation did NOT reject it.
const badFmt = await client.callTool({ name: "extract_video_frames", arguments: { videoUrls: ["https://example.com/v.mp4"], imageFormat: "gif" } }).catch((e) => ({ thrown: e.message }));
console.log(`bad-enum string validation -> ${JSON.stringify(badFmt).slice(0, 120)}`);
if (!rejected(badFmt)) throw new Error("imageFormat enum not enforced");
const badN = await client.callTool({ name: "video_to_llm_context", arguments: { videoUrls: ["https://example.com/v.mp4"], maxKeyframes: 500 } }).catch((e) => ({ thrown: e.message }));
console.log(`out-of-range integer validation -> ${JSON.stringify(badN).slice(0, 120)}`);
if (!rejected(badN)) throw new Error("maxKeyframes maximum not enforced");
const badArr = await client.callTool({ name: "detect_video_scenes", arguments: { videoUrls: "https://example.com/v.mp4" } }).catch((e) => ({ thrown: e.message }));
console.log(`string-instead-of-array validation -> ${JSON.stringify(badArr).slice(0, 120)}`);
if (!rejected(badArr)) throw new Error("videoUrls array type not enforced");

await client.close();
console.log("SMOKE OK");
