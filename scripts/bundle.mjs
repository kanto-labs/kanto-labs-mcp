// Builds build/kanto-labs-mcp.mcpb (MCP Bundle: one-click install in Claude Desktop, and the format
// Smithery accepts for stdio servers). Stages dist + production dependencies only, then runs mcpb pack.
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const stage = resolve(root, "build", "mcpb");
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit" });

run("npx tsc");
run("node scripts/sync-meta.mjs");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const f of ["dist", "actors.config.json", "manifest.json", "package.json", "package-lock.json", "README.md", "LICENSE"]) {
  cpSync(resolve(root, f), resolve(stage, f), { recursive: true });
}
run("npm ci --omit=dev --ignore-scripts --no-audit --no-fund", stage);
run(`npx mcpb pack "${stage}" "${resolve(root, "build", "kanto-labs-mcp.mcpb")}"`);
