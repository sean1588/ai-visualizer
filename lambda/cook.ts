// Mise · /api/cook — stateless LLM proxy.
// Receives { prompt, kind } from the browser, forwards to an OpenAI-compatible
// endpoint via @sean.holung/minicode-sdk, returns { text }.
//
// Logs are intentionally metadata-only. User prompts and row samples are sent
// to the configured model provider for inference, but we do not persist them
// in Lambda logs.

import {
  OpenAICompatibleModelClient,
  OutputValidationError,
  type OutputSchema,
} from "@sean.holung/minicode-sdk";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

type CookRequest = {
  prompt?: unknown;
  kind?: unknown;
  temperature?: unknown;
  url?: unknown;
  version?: unknown;
  event?: unknown;
  properties?: unknown;
};

type LambdaEvent = {
  requestContext?: { http?: { method?: string; sourceIp?: string } };
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
};

type LambdaResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const MAX_PROMPT_CHARS = 32_000;
const MAX_FETCH_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 15_000;

function logEvent(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ component: "cook", ...fields }));
}

const json = (statusCode: number, body: unknown, extra: Record<string, string> = {}): LambdaResponse => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...extra,
  },
  body: JSON.stringify(body),
});

function requestPath(event: LambdaEvent): string {
  const e = event as LambdaEvent & { rawPath?: string; path?: string };
  return e.rawPath || e.path || "";
}

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0" || h === "::1") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  const private172 = h.match(/^172\.(\d+)\./);
  if (private172) {
    const n = Number(private172[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

type AddressResolver = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

export function isBlockedAddress(input: string): boolean {
  const address = input.replace(/^\[|\]$/g, "").toLowerCase();
  if (address.includes(".")) {
    const mapped = address.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    const value = mapped || address;
    if (isIP(value) !== 4) return true;
    const [a, b] = value.split(".").map(Number);
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19 || b === 51))
      || (a === 203 && b === 0)
      || a >= 224;
  }
  if (isIP(address) !== 6) return true;
  return address === "::"
    || address === "::1"
    || address.startsWith("fc")
    || address.startsWith("fd")
    || /^fe[89ab]/.test(address)
    || address.startsWith("ff")
    || address.startsWith("2001:db8");
}

export async function assertPublicUrl(
  url: URL,
  resolver: AddressResolver = lookup,
): Promise<void> {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || isBlockedHost(url.hostname)) {
    throw new Error("unsupported_url");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new Error("unsupported_url");
    return;
  }
  const addresses = await resolver(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(result => isBlockedAddress(result.address))) {
    throw new Error("unsupported_url");
  }
}

export async function fetchPublicUrl(
  initialUrl: URL,
  signal: AbortSignal,
  resolver: AddressResolver = lookup,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let url = initialUrl;
  for (let redirects = 0; redirects <= 5; redirects++) {
    await assertPublicUrl(url, resolver);
    const response = await fetcher(url, {
      method: "GET",
      headers: { accept: "application/json,text/csv,text/plain;q=0.9,*/*;q=0.1" },
      redirect: "manual",
      signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("redirect_without_location");
    url = new URL(location, url);
  }
  throw new Error("too_many_redirects");
}

async function readLimitedResponse(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_FETCH_BYTES) {
      await reader.cancel();
      throw new Error("response_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(c => Buffer.from(c))).toString("utf-8");
}

async function handleFetchData(payload: CookRequest, t0: number): Promise<LambdaResponse> {
  const rawUrl = typeof payload.url === "string" ? payload.url.trim() : "";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    logEvent({ event: "fetch_rejected", reason: "invalid_url", status: 400, ms: Date.now() - t0 });
    return json(400, { error: "invalid_url" });
  }
  if (!["http:", "https:"].includes(url.protocol) || isBlockedHost(url.hostname)) {
    logEvent({ event: "fetch_rejected", reason: "unsupported_url", status: 400, host: url.hostname, ms: Date.now() - t0 });
    return json(400, { error: "unsupported_url" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    logEvent({ event: "fetch_start", host: url.hostname });
    const res = await fetchPublicUrl(url, controller.signal);
    const contentType = res.headers.get("content-type") || "";
    const text = await readLimitedResponse(res);
    if (!res.ok) {
      logEvent({ event: "fetch_error", reason: "upstream_status", upstreamStatus: res.status, status: 502, ms: Date.now() - t0 });
      return json(502, { error: "fetch_failed", status: res.status, detail: text.slice(0, 500) });
    }
    logEvent({ event: "fetch_ok", status: 200, bytes: Buffer.byteLength(text), contentType, ms: Date.now() - t0 });
    return json(200, { text, contentType, finalUrl: res.url });
  } catch (e) {
    const err = e instanceof Error ? e.message : "unknown";
    const reason = err === "response_too_large"
      ? "response_too_large"
      : err === "unsupported_url" ? "unsupported_url" : "fetch_failed";
    const status = reason === "response_too_large" ? 413 : reason === "unsupported_url" ? 400 : 502;
    logEvent({ event: "fetch_error", reason, err, status, ms: Date.now() - t0 });
    return json(status, { error: reason });
  } finally {
    clearTimeout(timeout);
  }
}

// Per-instance LRU rate limit. Crude (resets on cold start, doesn't share
// across concurrent Lambdas) but provides basic abuse control without extra
// infra. Replace with WAF + KV/Dynamo when traffic justifies it.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1h
const RATE_LIMIT_PER_WINDOW = 30;

function rateLimit(ip: string, maximum = RATE_LIMIT_PER_WINDOW): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const b = rateBuckets.get(ip);
  if (!b || b.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }
  if (b.count >= maximum) {
    return { allowed: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count++;
  return { allowed: true, retryAfter: 0 };
}

let rateLimitClient: DynamoDBClient | undefined;

async function sharedRateLimit(ip: string, maximum = RATE_LIMIT_PER_WINDOW): Promise<{ allowed: boolean; retryAfter: number }> {
  const tableName = process.env.RATE_LIMIT_TABLE;
  if (!tableName) return rateLimit(ip, maximum);
  const now = Date.now();
  const windowStart = Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
  const resetAt = windowStart + RATE_WINDOW_MS;
  rateLimitClient ||= new DynamoDBClient({});
  try {
    await rateLimitClient.send(new UpdateItemCommand({
      TableName: tableName,
      Key: { bucketKey: { S: `${ip}:${windowStart}` } },
      UpdateExpression: "SET #count = if_not_exists(#count, :zero) + :one, expiresAt = :expires",
      ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
      ExpressionAttributeNames: { "#count": "requestCount" },
      ExpressionAttributeValues: {
        ":zero": { N: "0" },
        ":one": { N: "1" },
        ":limit": { N: String(maximum) },
        ":expires": { N: String(Math.ceil(resetAt / 1000) + 3600) },
      },
    }));
    return { allowed: true, retryAfter: 0 };
  } catch (error) {
    if (error && typeof error === "object" && (error as { name?: string }).name === "ConditionalCheckFailedException") {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
    }
    throw error;
  }
}

// Strict JSON Schema (draft 2020-12) for the recipe. Per-widget oneOf
// enforces the right `fields` shape per type; additionalProperties:false
// rejects hallucinated keys like "subtitle" or per-widget "observation".
// gpt-5.4-mini handles tool-calling cleanly; revisit on K2.6 only after
// the SDK adds reasoning:{exclude:true} or we move K2.6 off this path.
const widgetBase = {
  span: { enum: [3, 4, 6, 8, 12] },
  title: { type: "string" },
  rationale: { type: "string" },
};
const widgetCommonRequired = ["type", "span", "title", "fields"];

const RECIPE_SCHEMA: OutputSchema = {
  name: "deliver_recipe",
  description: "Deliver the dashboard recipe as a single structured payload. Call this tool exactly once.",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", minLength: 1 },
      widgets: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              properties: {
                ...widgetBase,
                type: { const: "kpi" },
                fields: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    metric: { type: "string", description: "Numeric column name to aggregate." },
                    aggregate: { enum: ["last", "sum", "average", "count"], description: "How to summarize the numeric column." },
                    spark: { type: "string", description: "Optional date column for the sparkline." },
                    format: { enum: ["auto", "number", "currency", "percent"], description: "How to display the metric." },
                  },
                  required: ["metric"],
                },
              },
              required: widgetCommonRequired,
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                ...widgetBase,
                type: { const: "line" },
                fields: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    x: { type: "string", description: "Date column." },
                    y: { type: "string", description: "Numeric column." },
                    aggregate: { enum: ["sum", "average", "last"], description: "How to combine repeated x values." },
                    format: { enum: ["auto", "number", "currency", "percent"], description: "How to display the metric." },
                  },
                  required: ["x", "y"],
                },
              },
              required: widgetCommonRequired,
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                ...widgetBase,
                type: { const: "bar" },
                fields: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    x: { type: "string", description: "Date or category column." },
                    y: { type: "string", description: "Numeric column." },
                    aggregate: { enum: ["sum", "average", "last"], description: "How to combine repeated x values." },
                    format: { enum: ["auto", "number", "currency", "percent"], description: "How to display the metric." },
                  },
                  required: ["x", "y"],
                },
              },
              required: widgetCommonRequired,
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                ...widgetBase,
                type: { const: "donut" },
                fields: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    cat: { type: "string", description: "Category column." },
                    metric: { type: "string", description: "Numeric column to aggregate per category." },
                    aggregate: { enum: ["sum", "average", "last"], description: "How to combine category values." },
                    format: { enum: ["auto", "number", "currency", "percent"], description: "How to display the metric." },
                  },
                  required: ["cat", "metric"],
                },
              },
              required: widgetCommonRequired,
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                ...widgetBase,
                type: { const: "statlist" },
                fields: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    cat: { type: "string", description: "Category column." },
                    metric: { type: "string", description: "Numeric column to aggregate per category." },
                    aggregate: { enum: ["sum", "average", "last"], description: "How to combine category values." },
                    format: { enum: ["auto", "number", "currency", "percent"], description: "How to display the metric." },
                  },
                  required: ["cat", "metric"],
                },
              },
              required: widgetCommonRequired,
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                ...widgetBase,
                type: { const: "countbar" },
                fields: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    cat: { type: "string", description: "Category column to count records by." },
                  },
                  required: ["cat"],
                },
              },
              required: widgetCommonRequired,
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                ...widgetBase,
                type: { const: "table" },
                fields: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    limit: { type: "integer", minimum: 1, maximum: 100 },
                    sort: { type: "string", description: "Optional column to sort by." },
                    order: { enum: ["asc", "desc"], description: "Sort direction." },
                  },
                },
              },
              required: ["type", "span", "title"],
            },
          ],
        },
      },
      observations: {
        type: "array",
        maxItems: 3,
        items: { type: "string", minLength: 1 },
      },
    },
    required: ["title", "widgets"],
  },
};

const SYSTEM_PROMPT_PLAN = "You are Mise, an editorial dashboard designer. Read the user message — it contains the data shape and any guidance — and deliver the layout via the deliver_recipe tool. Call deliver_recipe exactly once with a complete recipe; do not write prose.";

const recipeSchemaObject = RECIPE_SCHEMA.schema as any;
const recipeWidgetItems = recipeSchemaObject.properties.widgets.items.oneOf as Record<string, unknown>[];
const chefRecipeWidgetItems = recipeWidgetItems.map(item => ({
  ...item,
  additionalProperties: true,
}));
const OBSERVATIONS_WIDGET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { const: "observations" },
    span: { const: 12 },
    title: { type: "string" },
    observations: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "string", minLength: 1 },
    },
  },
  required: ["type", "span", "title", "observations"],
};

const CHEF_RECIPE_SCHEMA: OutputSchema = {
  name: "deliver_chef_recipe",
  description: "Deliver the edited dashboard recipe as a single structured payload. Call this tool exactly once.",
  schema: {
    ...recipeSchemaObject,
    properties: {
      ...recipeSchemaObject.properties,
      reply: { type: "string", minLength: 1 },
      changes: {
        type: "array",
        maxItems: 6,
        items: { type: "string", minLength: 1 },
      },
      widgets: {
        ...recipeSchemaObject.properties.widgets,
        maxItems: 10,
        items: {
          oneOf: [...chefRecipeWidgetItems, OBSERVATIONS_WIDGET_SCHEMA],
        },
      },
    },
    required: ["title", "reply", "changes", "widgets"],
  },
};

const SYSTEM_PROMPT_CHEF = "You are The Chef, an editorial dashboard editor. Read the user message and deliver the edited recipe via the deliver_chef_recipe tool. Call deliver_chef_recipe exactly once with a complete recipe; do not write prose.";

const PRODUCT_EVENTS = new Set([
  "ingest_started",
  "dashboard_rendered",
  "assumption_edited",
  "chart_inspected",
  "chef_edit",
  "recurring_refresh",
  "export_created",
  "health_action",
  "direct_edit",
]);
const PRODUCT_PROPERTY_KEYS = new Set([
  "source",
  "fallback",
  "widgets",
  "widgetType",
  "scope",
  "success",
  "result",
  "triggered",
  "type",
  "action",
]);
const PRODUCT_PROPERTY_VALUES = new Set([
  "file", "paste", "http", "example", "recipe",
  "kpi", "line", "bar", "donut", "statlist", "countbar", "table", "observations",
  "dashboard", "widget", "success", "error",
  "png", "html", "csv", "markdown", "brief", "link",
  "move-up", "move-down", "resize", "duplicate", "remove",
  "treat-as-date", "include-outliers", "acknowledge",
]);

function handleProductEvent(payload: CookRequest, t0: number): LambdaResponse {
  const event = typeof payload.event === "string" ? payload.event : "";
  const properties = payload.properties && typeof payload.properties === "object" && !Array.isArray(payload.properties)
    ? payload.properties as Record<string, unknown>
    : {};
  const validProperties = Object.entries(properties).every(([key, value]) =>
    PRODUCT_PROPERTY_KEYS.has(key)
    && (
      typeof value === "boolean"
      || (typeof value === "number" && Number.isFinite(value))
      || (typeof value === "string" && PRODUCT_PROPERTY_VALUES.has(value))
    ),
  );
  if (payload.version !== 1 || !PRODUCT_EVENTS.has(event) || !validProperties) {
    return json(400, { error: "invalid_event" });
  }
  logEvent({ event: "product_event", productEvent: event, properties, status: 204, ms: Date.now() - t0 });
  return { statusCode: 204, headers: { "cache-control": "no-store" }, body: "" };
}

// Module-scope client; reused across warm invocations.
let modelClient: OpenAICompatibleModelClient | undefined;
function getClient(baseUrl: string, apiKey: string, timeoutSeconds: number): OpenAICompatibleModelClient {
  if (!modelClient) {
    modelClient = new OpenAICompatibleModelClient({
      baseUrl,
      apiKey,
      timeoutSeconds,
    });
  }
  return modelClient;
}

export const handler = async (event: LambdaEvent): Promise<LambdaResponse> => {
  const t0 = Date.now();
  const method = event.requestContext?.http?.method || "POST";
  const path = requestPath(event);

  if (method === "OPTIONS") {
    logEvent({ event: "preflight", method, ms: Date.now() - t0 });
    return { statusCode: 204, headers: { "cache-control": "no-store" }, body: "" };
  }
  if (method !== "POST") {
    logEvent({ event: "rejected", reason: "method_not_allowed", method, status: 405, ms: Date.now() - t0 });
    return json(405, { error: "method_not_allowed" });
  }

  const xff = event.headers?.["x-forwarded-for"] || event.headers?.["X-Forwarded-For"] || "";
  const ip = xff.split(",")[0]?.trim() || event.requestContext?.http?.sourceIp || "unknown";
  let limit: { allowed: boolean; retryAfter: number };
  try {
    const rateLimitKey = `${ip}:${path.endsWith("/api/events") ? "events" : "api"}`;
    limit = await sharedRateLimit(rateLimitKey, path.endsWith("/api/events") ? 120 : RATE_LIMIT_PER_WINDOW);
  } catch (error) {
    logEvent({ event: "error", reason: "rate_limit_unavailable", status: 503, ms: Date.now() - t0, err: error instanceof Error ? error.message : "unknown" });
    return json(503, { error: "temporarily_unavailable" });
  }
  if (!limit.allowed) {
    logEvent({ event: "rejected", reason: "rate_limited", retryAfter: limit.retryAfter, status: 429, ms: Date.now() - t0 });
    return json(429, { error: "rate_limited", retryAfter: limit.retryAfter }, {
      "retry-after": String(limit.retryAfter),
    });
  }

  let payload: CookRequest;
  let raw = "";
  try {
    raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf-8") : (event.body || "");
    payload = JSON.parse(raw || "{}");
  } catch (e) {
    const err = e instanceof Error ? e.message : "unknown";
    logEvent({ event: "rejected", reason: "invalid_json", status: 400, ms: Date.now() - t0, err, bodyLen: raw.length });
    return json(400, { error: "invalid_json" });
  }

  if (path.endsWith("/api/fetch-data")) {
    return handleFetchData(payload, t0);
  }
  if (path.endsWith("/api/events")) {
    return handleProductEvent(payload, t0);
  }

  const kind = typeof payload.kind === "string" ? payload.kind : "unknown";
  logEvent({ event: "request_received", method, ip, kind });

  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (!["plan", "chef"].includes(kind) || !prompt || prompt.length > MAX_PROMPT_CHARS) {
    logEvent({ event: "rejected", reason: "invalid_prompt", kind, promptLen: prompt.length, status: 400, ms: Date.now() - t0 });
    return json(400, { error: !["plan", "chef"].includes(kind) ? "invalid_kind" : "invalid_prompt" });
  }

  const baseURL = process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1";
  const model = process.env.LLM_MODEL || "openai/gpt-5.6-luna";
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) {
    logEvent({ event: "error", reason: "missing_api_key", status: 500, ms: Date.now() - t0 });
    return json(500, { error: "missing_api_key" });
  }

  const isPlan = kind === "plan";
  const system = isPlan ? SYSTEM_PROMPT_PLAN : SYSTEM_PROMPT_CHEF;
  const outputSchema = isPlan ? RECIPE_SCHEMA : (kind === "chef" ? CHEF_RECIPE_SCHEMA : undefined);

  logEvent({
    event: "upstream_start",
    kind,
    model,
    baseURL,
    promptLen: prompt.length,
    structured: Boolean(outputSchema),
  });

  // Tight upstream timeout. The SDK retries up to 3× on timeouts/network
  // errors; with 25s per attempt we worst-case ~76s, inside the 90s Lambda
  // budget so a hang surfaces as a clean 502 instead of a hard kill.
  const client = getClient(baseURL, apiKey, 25);
  const upstreamT0 = Date.now();
  let response;
  let validationFallbackText: string | undefined;
  try {
    response = await client.chat({
      model,
      system,
      messages: [{ role: "user", content: prompt }],
      tools: [],
      maxTokens: 16384,
      outputSchema,
    });
  } catch (e) {
    const upstreamMs = Date.now() - upstreamT0;
    if (e instanceof OutputValidationError) {
      // Schema rejected the model's structured output. Surface the raw
      // payload as text so the client-side validator can take a
      // permissive pass (drops bad widgets, keeps good ones); if that
      // also fails, the client has its deterministic fallback recipe.
      // Log the validation errors so we can tighten the prompt.
      logEvent({
        event: "structured_output_invalid",
        kind,
        upstreamMs,
        ms: Date.now() - t0,
        validationErrors: e.errors,
        rawType: typeof e.raw,
      });
      validationFallbackText = typeof e.raw === "string"
        ? e.raw
        : JSON.stringify(e.raw);
    } else {
      const err = e instanceof Error ? e.message : "unknown";
      logEvent({
        event: "error",
        reason: "upstream_call_failed",
        kind,
        upstreamMs,
        status: 502,
        ms: Date.now() - t0,
        err,
      });
      return json(502, { error: "upstream", detail: err });
    }
  }
  const upstreamMs = Date.now() - upstreamT0;

  // Pick the response text in this priority:
  //   1. Schema-validated structured output (best — already a valid recipe)
  //   2. Model's raw structured output that failed validation (client tries
  //      its permissive parse before falling back)
  //   3. Model's raw text reply (for non-plan kinds, or when the model didn't
  //      use the synthetic tool at all)
  let text: string;
  if (response && response.output !== undefined) {
    text = JSON.stringify(response.output);
  } else if (validationFallbackText !== undefined) {
    text = validationFallbackText;
  } else if (response) {
    text = response.text;
  } else {
    text = "";
  }

  logEvent({
    event: "ok",
    kind,
    model,
    structured: Boolean(outputSchema),
    schemaValidated: Boolean(response?.output),
    fellBackToRaw: validationFallbackText !== undefined,
    upstreamMs,
    promptLen: prompt.length,
    responseLen: text.length,
    promptTokens: response?.usage?.inputTokens,
    completionTokens: response?.usage?.outputTokens,
    cachedInputTokens: response?.usage?.cachedInputTokens,
    status: 200,
    ms: Date.now() - t0,
  });
  return json(200, { text });
};
