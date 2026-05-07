// Mise · /api/cook — stateless LLM proxy.
// Receives { prompt, kind } from the browser, forwards to an OpenAI-compatible
// endpoint, returns { text }. Never logs prompt or response content — only
// metadata (method, kind, status, duration, upstream status, error reason).

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

// Single-line structured log. Stays out of CloudWatch's free-text noise so
// queries can filter on fields. Privacy rule: never include prompt or
// upstream response body fields here.
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

// Per-instance LRU rate limit. Crude (resets on cold start, doesn't share across
// concurrent Lambdas) but provides basic abuse control without extra infra.
// Replace with WAF + KV/Dynamo when traffic justifies it.
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
  const ip = xff.split(",")[0].trim() || event.requestContext?.http?.sourceIp || "unknown";
  const limit = rateLimit(ip);
  if (!limit.allowed) {
    logEvent({ event: "rejected", reason: "rate_limited", retryAfter: limit.retryAfter, status: 429, ms: Date.now() - t0 });
    return json(429, { error: "rate_limited", retryAfter: limit.retryAfter }, {
      "retry-after": String(limit.retryAfter),
    });
  }

  let payload: CookRequest;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf-8") : (event.body || "");
    payload = JSON.parse(raw || "{}");
  } catch {
    logEvent({ event: "rejected", reason: "invalid_json", status: 400, ms: Date.now() - t0 });
    return json(400, { error: "invalid_json" });
  }

  const kind = typeof payload.kind === "string" ? payload.kind : "unknown";
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    logEvent({ event: "rejected", reason: "invalid_prompt", kind, promptLen: prompt.length, status: 400, ms: Date.now() - t0 });
    return json(400, { error: "invalid_prompt" });
  }
  const temperature = typeof payload.temperature === "number" ? payload.temperature : 0.0;

  const baseURL = process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1";
  const model = process.env.LLM_MODEL || "moonshotai/kimi-k2.6";
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) {
    logEvent({ event: "error", reason: "missing_api_key", status: 500, ms: Date.now() - t0 });
    return json(500, { error: "missing_api_key" });
  }

  const referer = process.env.OPENROUTER_REFERER || "https://app.mise.seanholung.com";
  const appTitle = process.env.OPENROUTER_TITLE || "Mise";

  logEvent({ event: "upstream_start", kind, model, promptLen: prompt.length });

  const upstreamT0 = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        // OpenRouter attribution headers (ignored by other OpenAI-compatible providers).
        "http-referer": referer,
        "x-title": appTitle,
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : "unknown";
    logEvent({ event: "error", reason: "upstream_unreachable", upstreamMs: Date.now() - upstreamT0, status: 502, ms: Date.now() - t0, err });
    return json(502, { error: "upstream_unreachable" });
  }
  const upstreamMs = Date.now() - upstreamT0;

  if (!upstream.ok) {
    // Surface a generic error; do not echo upstream body (may contain prompt fragments).
    logEvent({ event: "error", reason: "upstream", upstreamStatus: upstream.status, upstreamMs, status: 502, ms: Date.now() - t0 });
    return json(502, { error: "upstream", status: upstream.status });
  }

  let upstreamJson: any;
  try {
    upstreamJson = await upstream.json();
  } catch {
    logEvent({ event: "error", reason: "upstream_bad_json", upstreamStatus: upstream.status, upstreamMs, status: 502, ms: Date.now() - t0 });
    return json(502, { error: "upstream_bad_json" });
  }
  const text: string = upstreamJson?.choices?.[0]?.message?.content || "";
  const usage = upstreamJson?.usage || {};
  logEvent({
    event: "ok",
    kind,
    model,
    upstreamStatus: upstream.status,
    upstreamMs,
    promptLen: prompt.length,
    responseLen: text.length,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    status: 200,
    ms: Date.now() - t0,
  });
  return json(200, { text });
};
