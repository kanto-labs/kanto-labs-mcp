// Keeps manifest.json, server.json and README.md in step with actors.config.json and package.json:
//   - manifest.json / server.json version  <- package.json version
//   - manifest.json tools + long_description <- actors.config.json (shortDescription, priceText, comingSoon)
//   - README.md between <!-- tools:start/end --> and <!-- params:start/end --> <- actors.config.json
// Runs as part of `npm run build` and `npm run bundle`. `--check` only reports (exit 1 if anything is stale).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const read = (f) => readFileSync(resolve(root, f), "utf8");
const pkg = JSON.parse(read("package.json"));
const { actors } = JSON.parse(read("actors.config.json"));
for (const a of actors) {
  if (!a.shortDescription || !a.priceText) throw new Error(`${a.tool}: shortDescription and priceText are required`);
}
const soon = actors.filter((a) => a.comingSoon);
const stale = [];

function put(file, text) {
  if (read(file) === text) return;
  stale.push(file);
  if (!check) writeFileSync(resolve(root, file), text);
}

// ---- manifest.json
const manifest = JSON.parse(read("manifest.json"));
manifest.version = pkg.version;
manifest.tools = actors.map((a) => ({
  name: a.tool,
  description: `${a.shortDescription} ${a.priceText}.${a.comingSoon ? " (Coming soon.)" : ""}`,
}));
manifest.long_description =
  `${actors.length} tools backed by Kanto Labs' pay-per-event actors on Apify. ` +
  actors.map((a) => `${a.tool} (${a.priceText}${a.comingSoon ? ", coming soon" : ""}): ${a.shortDescription}`).join(" ") +
  " Runs are billed to your own Apify account; failures are free and every call has a spending cap." +
  (soon.length ? " Tools marked coming soon call actors that are not public on the Apify Store yet; until they are, they return a clear error and nothing is charged." : "");
put("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

// ---- server.json
const server = JSON.parse(read("server.json"));
server.version = pkg.version;
for (const p of server.packages) if (p.identifier === pkg.name) p.version = pkg.version;
put("server.json", JSON.stringify(server, null, 2) + "\n");

// ---- README.md
const mark = (a) => `\`${a.tool}\`${a.comingSoon ? " (coming soon)" : ""}`;
const toolsBlock = [
  `An [MCP](https://modelcontextprotocol.io) server that gives AI assistants (Claude, Cursor, VS Code Copilot and any other MCP client) ${actors.length} web, data and media tools, backed by Kanto Labs' actors on the [Apify Store](https://apify.com/kantolabs):`,
  "",
  "| Tool | What it does | Price |",
  "|---|---|---|",
  ...actors.map((a) => `| ${mark(a)} | ${a.shortDescription} | ${a.priceText.replace(/^(\$[\d.]+)/, "**$1**")} |`),
  "",
  "Failed or unreachable inputs are **not charged**.",
  ...(soon.length
    ? ["", `> **Coming soon:** ${soon.map((a) => `\`${a.tool}\``).join(", ")} are listed already, but their actors are not yet public on the Apify Store; until they are, calls to them return an "actor not yet public" error (nothing is charged).`]
    : []),
].join("\n");
const paramsBlock = actors
  .map((a) => {
    const ps = Object.entries(a.params).map(([k, p]) => {
      const notes = [];
      if (p.required) notes.push("required");
      if (p.enum && p.type === "string") notes.push(p.enum.map((e) => `\`${e}\``).join("/"));
      if (a.defaults && a.defaults[k] !== undefined) notes.push(`default ${JSON.stringify(a.defaults[k])} here`);
      return `\`${k}\`${notes.length ? ` (${notes.join("; ")})` : ""}`;
    });
    return `\`${a.tool}\`: ${ps.join(", ")}.`;
  })
  .join("\n");

let readme = read("README.md").replace(/\r\n/g, "\n");
for (const [name, block] of [["tools", toolsBlock], ["params", paramsBlock]]) {
  const re = new RegExp(`(<!-- ${name}:start -->\\n)[\\s\\S]*?(\\n<!-- ${name}:end -->)`);
  if (!re.test(readme)) throw new Error(`README.md has no <!-- ${name}:start --> / <!-- ${name}:end --> markers`);
  readme = readme.replace(re, (_m, a, b) => a + block + b);
}
put("README.md", readme);

console.log(
  `sync-meta: v${pkg.version}, ${actors.length} tools (${soon.length} coming soon: ${soon.map((a) => a.tool).join(", ") || "none"}); ` +
    (stale.length ? `${check ? "STALE" : "updated"}: ${stale.join(", ")}` : "all in sync"),
);
if (check && stale.length) process.exit(1);
