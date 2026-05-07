// Mise · /api/cook — stateless LLM proxy.
// Receives { prompt, kind } from the browser, forwards to an OpenAI-compatible
// endpoint via @sean.holung/minicode-sdk, returns { text }.
//
// !! PRE-LAUNCH DIAGNOSTIC LOGGING !!
// Currently logs full prompt content and upstream responses for debugging
// while no real users are hitting the proxy. Before public launch, dial back
// to structured-only logs (no body content) to honor the "nothing leaves your
// browser except one stateless LLM call, never logged" privacy claim. Search
// for `// VERBOSE` markers below.

import {
  OpenAICompatibleModelClient,
  type OutputSchema,
} from "@sean.holung/minicode-sdk";

type CookRequest = {
  prompt?: unknown;
  kind?: unknown;
  temperature?: unknown;
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

// Per-instance LRU rate limit. Crude (resets on cold start, doesn't share
// across concurrent Lambdas) but provides basic abuse control without extra
// infra. Replace with WAF + KV/Dynamo when traffic justifies it.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1h
const RATE_LIMIT_PER_WINDOW = 30;

function rateLimit(ip: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const b = rateBuckets.get(ip);
  if (!b || b.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }
  if (b.count >= RATE_LIMIT_PER_WINDOW) {
    return { allowed: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count++;
  return { allowed: true, retryAfter: 0 };
}

// JSON Schema (draft 2020-12 subset) for the dashboard recipe the planner
// returns. The SDK validates the model's output against this and surfaces a
// structured `output` value, eliminating manual fence-stripping and ad-hoc
// JSON parsing in the proxy. The browser still does its own validation
// pass (checks columns exist, span sums, etc.) before rendering.
const RECIPE_SCHEMA: OutputSchema = {
  name: "deliver_recipe",
  description: "Deliver the dashboard recipe as a single structured payload. Call exactly once.",
  schema: {
    type: "object",
    properties: {
      title: { type: "string", minLength: 1 },
      widgets: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            type: { enum: ["kpi", "line", "bar", "donut", "statlist", "table", "observations"] },
            span: { enum: [3, 4, 6, 8, 12] },
            title: { type: "string" },
            fields: { type: "object" },
            rationale: { type: "string" },
            observations: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["type", "span", "title"],
        },
      },
      observations: {
        type: "array",
        maxItems: 3,
        items: { type: "string" },
      },
    },
    required: ["title", "widgets"],
  },
};

const SYSTEM_PROMPT_PLAN = "You are Mise, an editorial dashboard designer. Read the user message — it contains the data shape and any guidance — and deliver the layout via the deliver_recipe tool. Call deliver_recipe exactly once with a complete recipe; do not write prose.";

const SYSTEM_PROMPT_CHEF = "You are The Chef, an editorial dashboard editor. Apply the user's request to the current recipe and return the updated recipe as JSON, following the schema in the user message.";

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
  const limit = rateLimit(ip);
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
    logEvent({ event: "rejected", reason: "invalid_json", status: 400, ms: Date.now() - t0, err, rawBody: raw.slice(0, 4000) });
    return json(400, { error: "invalid_json" });
  }
  const kind = typeof payload.kind === "string" ? payload.kind : "unknown";
  // VERBOSE
  logEvent({ event: "request_received", method, ip, kind, body: payload });

  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    logEvent({ event: "rejected", reason: "invalid_prompt", kind, promptLen: prompt.length, status: 400, ms: Date.now() - t0 });
    return json(400, { error: "invalid_prompt" });
  }

  const baseURL = process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1";
  const model = process.env.LLM_MODEL || "moonshotai/kimi-k2.6";
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) {
    logEvent({ event: "error", reason: "missing_api_key", status: 500, ms: Date.now() - t0 });
    return json(500, { error: "missing_api_key" });
  }

  const isPlan = kind === "plan";
  const system = isPlan ? SYSTEM_PROMPT_PLAN : SYSTEM_PROMPT_CHEF;
  const outputSchema = isPlan ? RECIPE_SCHEMA : undefined;

  // VERBOSE
  logEvent({
    event: "upstream_start",
    kind,
    model,
    baseURL,
    promptLen: prompt.length,
    structured: Boolean(outputSchema),
  });

  const client = getClient(baseURL, apiKey, 50);
  const upstreamT0 = Date.now();
  let response;
  try {
    response = await client.chat({
      model,
      system,
      messages: [{ role: "user", content: prompt }],
      tools: [],
      maxTokens: 16384,
      reasoningEffort: "low",
      outputSchema,
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : "unknown";
    const upstreamMs = Date.now() - upstreamT0;
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
  const upstreamMs = Date.now() - upstreamT0;

  // For plan calls, the SDK validated the structured output for us — return
  // it as a JSON string so the existing client-side parser can consume it
  // unchanged. For chef calls (and anything else), return the model's text.
  const text = isPlan && response.output !== undefined
    ? JSON.stringify(response.output)
    : response.text;

  // VERBOSE
  logEvent({
    event: "ok",
    kind,
    model,
    structured: Boolean(outputSchema),
    upstreamMs,
    promptLen: prompt.length,
    responseLen: text.length,
    promptTokens: response.usage?.inputTokens,
    completionTokens: response.usage?.outputTokens,
    cachedInputTokens: response.usage?.cachedInputTokens,
    status: 200,
    ms: Date.now() - t0,
    output: response.output,
    rawText: response.text,
  });
  return json(200, { text });
};
