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
const expected = ["detect_website_tech_stack", "convert_document_to_markdown", "audit_website_seo",
  "extract_text_from_image", "lookup_domain", "extract_video_frames", "download_images",
  "check_domain_authority", "enrich_company", "upscale_image", "get_topic_trends", "get_trending_topics",
  "check_website_traffic_rank", "search_free_images"];
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

const r = await client.callTool({ name: tools[0].name, arguments: { urls: ["example.com"] } });
console.log(`no-token call -> isError=${r.isError}: ${r.content[0].text.slice(0, 90)}...`);
if (!r.isError || !/APIFY_TOKEN is not set/.test(r.content[0].text)) throw new Error("missing-token error not raised");

const rejected = (r) => !!r.thrown || (!!r.isError && !/APIFY_TOKEN is not set/.test(r.content[0].text));
const bad = await client.callTool({ name: tools[0].name, arguments: { urls: [] } }).catch((e) => ({ thrown: e.message }));
console.log(`empty-urls validation -> ${JSON.stringify(bad).slice(0, 120)}`);
if (!rejected(bad)) throw new Error("empty urls accepted");

// Enum validation on a string[] param and on a string param. With no token set, a call that passes
// validation fails with "APIFY_TOKEN is not set", so that message means validation did NOT reject it.
const badFmt = await client.callTool({ name: "download_images", arguments: { urls: ["https://example.com"], allowedFormats: ["exe"] } }).catch((e) => ({ thrown: e.message }));
console.log(`bad-enum string[] validation -> ${JSON.stringify(badFmt).slice(0, 120)}`);
if (!rejected(badFmt)) throw new Error("allowedFormats enum not enforced");
const badQ = await client.callTool({ name: "extract_text_from_image", arguments: { sources: ["https://example.com/a.png"], quality: "best" } }).catch((e) => ({ thrown: e.message }));
console.log(`bad-enum string validation -> ${JSON.stringify(badQ).slice(0, 120)}`);
if (!rejected(badQ)) throw new Error("quality enum not enforced");

await client.close();
console.log("SMOKE OK");
