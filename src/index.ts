#!/usr/bin/env node
/**
 * kanto-labs-mcp - MCP server exposing Kanto Labs' Apify actors as tools.
 *
 * Every tool call runs an actor on the Apify platform with the USER's own token
 * (env APIFY_TOKEN), so the actor's pay-per-event price is billed to the user's
 * Apify account. The tool list is data-driven from actors.config.json.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------- config types

type ParamType = "string" | "integer" | "number" | "boolean" | "string[]";

interface ParamSpec {
  type: ParamType;
  description: string;
  required?: boolean;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  enum?: string[];
}

export interface ActorSpec {
  tool: string;
  title: string;
  actorId: string; // "username/actor-name"
  chargeEvent: string;
  priceUsdPerResult: number;
  resultNoun: string;
  description: string;
  params: Record<string, ParamSpec>;
  countFrom?: string; // array param whose length = number of charged results
  countMultiplier?: string; // integer param multiplying that count (crawls)
  summary: string;
  errorSummary: string;
  omitFields?: string[];
  itemNoun?: string; // what one result item is, when it differs from the charged unit (e.g. "video" vs "frame")
  chargeCountField?: string; // numeric item field = charged events in that item (default 1 per successful item)
  itemPriceRules?: { when: Record<string, string | number | boolean>; priceUsd: number }[]; // first match wins
  defaults?: Record<string, unknown>; // actor input defaults applied when the caller omits the param
  fixedInput?: Record<string, unknown>; // actor input always sent and not exposed as a param (e.g. {"mode": "trending"})
  comingSoon?: boolean; // actor not public on the Apify Store yet: tool is listed with a notice, 404s explained
  shortDescription?: string; // one sentence for manifest.json / README (scripts/sync-meta.mjs)
  priceText?: string; // human price for manifest.json / README, e.g. "$0.003 per domain"
}

export const COMING_SOON_NOTE =
  "COMING SOON: this Kanto Labs actor is not public on the Apify Store yet. Until it is, calls return an " +
  "'actor not yet public' error and nothing is charged.";

const here = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(resolve(here, "..", "package.json"), "utf8")) as {
  name: string;
  version: string;
};

const API_BASE = (process.env.APIFY_API_BASE_URL || "https://api.apify.com").replace(/\/+$/, "");
const DEFAULT_MAX_CHARGE_USD = numEnv("KANTO_MAX_CHARGE_USD", 1.0);
const DEFAULT_TIMEOUT_SECS = Math.min(300, Math.max(10, numEnv("KANTO_TIMEOUT_SECS", 280)));
const MAX_TEXT_CHARS = Math.max(1000, numEnv("KANTO_MAX_TEXT_CHARS", 100_000));
const ACTOR_START_USD = 0.00005; // Apify's synthetic apify-actor-start event, per GB (min 1)

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadActors(path?: string): ActorSpec[] {
  const p = path || process.env.KANTO_ACTORS_CONFIG || resolve(here, "..", "actors.config.json");
  const cfg = JSON.parse(readFileSync(p, "utf8")) as { actors: ActorSpec[] };
  if (!Array.isArray(cfg.actors) || cfg.actors.length === 0) {
    throw new Error(`No actors defined in ${p}`);
  }
  const seen = new Set<string>();
  for (const a of cfg.actors) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(a.tool)) throw new Error(`Invalid tool name: ${a.tool}`);
    if (seen.has(a.tool)) throw new Error(`Duplicate tool name: ${a.tool}`);
    if (!/^[^/\s]+\/[^/\s]+$/.test(a.actorId)) throw new Error(`actorId must be "user/name": ${a.actorId}`);
    seen.add(a.tool);
  }
  return cfg.actors;
}

// ---------------------------------------------------------------- schema build

function zodFor(spec: ParamSpec): z.ZodTypeAny {
  let t: z.ZodTypeAny;
  switch (spec.type) {
    case "string":
      t = spec.enum?.length ? z.enum(spec.enum as [string, ...string[]]) : z.string().min(1);
      break;
    case "integer":
    case "number": {
      let n = spec.type === "integer" ? z.number().int() : z.number();
      if (spec.minimum !== undefined) n = n.min(spec.minimum);
      if (spec.maximum !== undefined) n = n.max(spec.maximum);
      t = n;
      break;
    }
    case "boolean":
      t = z.boolean();
      break;
    case "string[]": {
      let arr = spec.enum?.length ? z.array(z.enum(spec.enum as [string, ...string[]])) : z.array(z.string().min(1));
      if (spec.minItems !== undefined) arr = arr.min(spec.minItems);
      if (spec.maxItems !== undefined) arr = arr.max(spec.maxItems);
      t = arr;
      break;
    }
    default:
      throw new Error(`Unsupported param type: ${(spec as ParamSpec).type}`);
  }
  t = t.describe(spec.description);
  return spec.required ? t : t.optional();
}

const COMMON_PARAMS = {
  maxTotalChargeUsd: z
    .number()
    .positive()
    .max(1000)
    .optional()
    .describe(
      `Hard spending cap for this call in USD, enforced by Apify: the run stops once it has charged this much. Default ${DEFAULT_MAX_CHARGE_USD} (server setting KANTO_MAX_CHARGE_USD).`,
    ),
  timeoutSecs: z
    .number()
    .int()
    .min(10)
    .max(300)
    .optional()
    .describe(
      `Give up after this many seconds (max 300, Apify's limit for synchronous runs). Default ${DEFAULT_TIMEOUT_SECS}. For big batches, split the input into several calls.`,
    ),
};

// ---------------------------------------------------------------- helpers

function getPath(item: Record<string, unknown>, path: string): unknown {
  let v: unknown = item;
  for (const part of path.split(".")) {
    if (!v || typeof v !== "object") return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}

function fill(template: string, item: Record<string, unknown>): string {
  return template.replace(/\{([^{}|]+)(\|join)?\}/g, (_m, keys: string, join?: string) => {
    for (const key of keys.split(",").map((k) => k.trim())) {
      const v = getPath(item, key);
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) {
        if (v.length === 0) return "none";
        const shown = v.slice(0, 15).map(String).join(", ");
        return join && v.length > 15 ? `${shown}, +${v.length - 15} more` : shown;
      }
      if (typeof v === "object") return JSON.stringify(v).slice(0, 200);
      return String(v);
    }
    return "?";
  });
}

function compact(value: unknown, omit: Set<string>, depth = 0): unknown {
  if (typeof value === "string") {
    return value.length > MAX_TEXT_CHARS
      ? `${value.slice(0, MAX_TEXT_CHARS)}\n...[truncated ${value.length - MAX_TEXT_CHARS} of ${value.length} chars; raise KANTO_MAX_TEXT_CHARS to get more]`
      : value;
  }
  if (Array.isArray(value)) return value.map((v) => compact(v, omit, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (depth === 0 && omit.has(k)) continue;
      if (v === null || v === undefined || v === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = compact(v, omit, depth + 1);
    }
    return out;
  }
  return value;
}

function usd(n: number): string {
  return `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
}

class ToolError extends Error {}

function explainHttpError(status: number, body: string, actor: ActorSpec, timeoutSecs: number): string {
  let type = "";
  let message = body.slice(0, 500);
  try {
    const j = JSON.parse(body) as { error?: { type?: string; message?: string } };
    if (j.error) {
      type = j.error.type || "";
      message = j.error.message || message;
    }
  } catch {
    /* body was not JSON */
  }
  const store = `https://apify.com/${actor.actorId}`;
  switch (status) {
    case 401:
      return `Apify rejected the token (401 ${type}). Check APIFY_TOKEN: copy it again from https://console.apify.com/settings/integrations.`;
    case 402:
      return `Apify refused the run for billing reasons (402 ${type}): ${message}. Top up or upgrade at https://console.apify.com/billing.`;
    case 403:
      return `Apify denied access (403 ${type}): ${message}.`;
    case 404:
      if (actor.comingSoon) {
        return `Actor ${actor.actorId} is not public on the Apify Store yet (launching soon), so Apify answered 404 ${type}. Nothing was charged. Try again once ${store} is live, or use another tool.`;
      }
      return `Actor ${actor.actorId} was not found (404 ${type}). It may have been renamed; see ${store}.`;
    case 408:
      return `The ${actor.actorId} run did not finish within ${timeoutSecs}s (Apify's synchronous limit is 300s). Retry with fewer inputs per call. Items already processed may have been charged.`;
    case 429:
      return `Apify rate limit hit (429). Wait a few seconds and retry.`;
    default:
      if (/run-failed|run-timed-out|run-aborted/.test(type) || status === 400) {
        return `The ${actor.actorId} run did not succeed (${status} ${type}): ${message}`;
      }
      return `Apify API error ${status} ${type}: ${message}`;
  }
}

// ---------------------------------------------------------------- actor call

export async function runActor(actor: ActorSpec, args: Record<string, unknown>) {
  const token = (process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || "").trim();
  if (!token) {
    throw new ToolError(
      "APIFY_TOKEN is not set. Add your Apify API token to this MCP server's env config " +
        '(e.g. "env": {"APIFY_TOKEN": "apify_api_..."}). Get one free at https://console.apify.com/settings/integrations. ' +
        `Runs are billed to that Apify account (${usd(actor.priceUsdPerResult)} per ${actor.resultNoun}).`,
    );
  }

  const { maxTotalChargeUsd, timeoutSecs, ...input } = args as {
    maxTotalChargeUsd?: number;
    timeoutSecs?: number;
    [k: string]: unknown;
  };
  const cap = maxTotalChargeUsd ?? DEFAULT_MAX_CHARGE_USD;
  const timeout = timeoutSecs ?? DEFAULT_TIMEOUT_SECS;

  // Only forward parameters declared in the config (plus the tool's fixed input).
  const actorInput: Record<string, unknown> = { ...(actor.fixedInput || {}) };
  for (const key of Object.keys(actor.params)) {
    if (input[key] !== undefined) actorInput[key] = input[key];
    else if (actor.defaults && actor.defaults[key] !== undefined) actorInput[key] = actor.defaults[key];
  }

  let expected = 1;
  if (actor.countFrom && Array.isArray(actorInput[actor.countFrom])) {
    expected = (actorInput[actor.countFrom] as unknown[]).length;
  }
  if (actor.countMultiplier && typeof actorInput[actor.countMultiplier] === "number") {
    expected *= actorInput[actor.countMultiplier] as number;
  }
  const worstCase = expected * actor.priceUsdPerResult + ACTOR_START_USD;

  const url = new URL(`${API_BASE}/v2/acts/${actor.actorId.replace("/", "~")}/run-sync-get-dataset-items`);
  url.searchParams.set("timeout", String(timeout));
  url.searchParams.set("maxTotalChargeUsd", String(cap));
  url.searchParams.set("format", "json");
  url.searchParams.set("clean", "true");

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": `${PKG.name}/${PKG.version}`,
      },
      body: JSON.stringify(actorInput),
      signal: AbortSignal.timeout((timeout + 30) * 1000),
    });
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new ToolError(
        `No response from Apify within ${timeout + 30}s. The run may still be going; check https://console.apify.com/actors/runs. Retry with fewer inputs.`,
      );
    }
    const cause = (err as Error & { cause?: { message?: string } }).cause?.message;
    throw new ToolError(`Could not reach ${API_BASE}: ${err.message}${cause ? ` (${cause})` : ""}`);
  }

  const body = await res.text();
  if (!res.ok) throw new ToolError(explainHttpError(res.status, body, actor, timeout));

  let items: Record<string, unknown>[];
  try {
    const parsed = JSON.parse(body) as unknown;
    items = Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [parsed as Record<string, unknown>];
  } catch {
    throw new ToolError(`Apify returned a non-JSON response: ${body.slice(0, 300)}`);
  }

  const failed = items.filter((i) => i && i.error);
  const ok = items.length - failed.length;
  let charged = 0;
  let cost = ACTOR_START_USD;
  for (const i of items) {
    if (!i || i.error) continue;
    const n = actor.chargeCountField ? Number(getPath(i, actor.chargeCountField)) || 0 : 1;
    const rule = actor.itemPriceRules?.find((r) => Object.entries(r.when).every(([k, v]) => getPath(i, k) === v));
    const price = rule ? rule.priceUsd : actor.priceUsdPerResult;
    if (price > 0) charged += n; // a rule with priceUsd 0 marks a free row (e.g. an unranked domain)
    cost += n * price;
  }
  const itemNoun = actor.itemNoun || actor.resultNoun;
  const priceNote = actor.itemPriceRules?.some((r) => r.priceUsd > 0) ? "base price " : "";
  const lines = items.slice(0, 50).map((i) => "- " + fill(i.error ? actor.errorSummary : actor.summary, i));
  if (items.length > 50) lines.push(`- ...and ${items.length - 50} more`);

  const notes: string[] = [];
  if (items.length === 0) notes.push("The run finished but returned no results.");
  if (cost >= cap * 0.98 || (worstCase > cap && charged < expected)) {
    notes.push(`The ${usd(cap)} spending cap (maxTotalChargeUsd) may have stopped the run early; raise it to process more.`);
  }

  const summary = [
    `${actor.title}: ${ok} ${itemNoun}(s) succeeded, ${failed.length} failed` +
      (actor.chargeCountField || actor.itemPriceRules?.some((r) => r.priceUsd === 0)
        ? `, ${charged} ${actor.resultNoun}(s) charged. `
        : ". ") +
      `Estimated charge ${usd(cost)} to your Apify account (${priceNote}${usd(actor.priceUsdPerResult)} per ${actor.resultNoun}, failures free; cap ${usd(cap)}).`,
    ...lines,
    ...notes,
  ].join("\n");

  const omit = new Set(actor.omitFields || []);
  const result = {
    actor: actor.actorId,
    succeeded: ok,
    chargedResults: charged,
    failed: failed.length,
    estimatedChargeUsd: Number(cost.toFixed(5)),
    maxTotalChargeUsd: cap,
    items: items.map((i) => compact(i, omit)),
  };
  return { summary, json: JSON.stringify(result) };
}

// ---------------------------------------------------------------- server

export function buildServer(actors: ActorSpec[]): McpServer {
  const server = new McpServer({ name: PKG.name, version: PKG.version });
  for (const actor of actors) {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [name, spec] of Object.entries(actor.params)) shape[name] = zodFor(spec);
    Object.assign(shape, COMMON_PARAMS);

    const title = actor.comingSoon ? `${actor.title} (coming soon)` : actor.title;
    server.registerTool(
      actor.tool,
      {
        title,
        description:
          (actor.comingSoon ? COMING_SOON_NOTE + " " : "") +
          actor.description +
          ` Runs the Apify actor ${actor.actorId} with your APIFY_TOKEN; maxTotalChargeUsd caps the spend per call.`,
        inputSchema: shape,
        annotations: {
          title,
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const { summary, json } = await runActor(actor, args);
          return {
            content: [
              { type: "text" as const, text: summary },
              { type: "text" as const, text: json },
            ],
          };
        } catch (e) {
          const msg = e instanceof ToolError ? e.message : `Unexpected error: ${(e as Error).message}`;
          return { isError: true, content: [{ type: "text" as const, text: msg }] };
        }
      },
    );
  }
  return server;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(PKG.version);
    return;
  }
  const actors = loadActors();
  if (argv.includes("--list-tools")) {
    for (const a of actors) console.log(`${a.tool}\t${a.actorId}\t${usd(a.priceUsdPerResult)}/${a.resultNoun}${a.comingSoon ? " (coming soon)" : ""}`);
    return;
  }
  const server = buildServer(actors);
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol; diagnostics go to stderr only.
  console.error(
    `${PKG.name} ${PKG.version} ready: ${actors.length} tools` +
      (process.env.APIFY_TOKEN ? "" : " (warning: APIFY_TOKEN is not set)"),
  );
}

main().catch((e) => {
  console.error(`${PKG.name} failed to start: ${(e as Error).message}`);
  process.exit(1);
});
