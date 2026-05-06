// Mise · /api/cook — stateless LLM proxy.
// Receives { prompt, kind } from the browser, forwards to an OpenAI-compatible
// endpoint, returns { text }. Never logs prompt or response content.

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
  const method = event.requestContext?.http?.method || "POST";
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: { "cache-control": "no-store" }, body: "" };
  }
  if (method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const xff = event.headers?.["x-forwarded-for"] || event.headers?.["X-Forwarded-For"] || "";
  const ip = xff.split(",")[0].trim() || event.requestContext?.http?.sourceIp || "unknown";
  const limit = rateLimit(ip);
  if (!limit.allowed) {
    return json(429, { error: "rate_limited", retryAfter: limit.retryAfter }, {
      "retry-after": String(limit.retryAfter),
    });
  }

  let payload: CookRequest;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf-8") : (event.body || "");
    payload = JSON.parse(raw || "{}");
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    return json(400, { error: "invalid_prompt" });
  }
  const temperature = typeof payload.temperature === "number" ? payload.temperature : 0.0;

  const baseURL = process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1";
  const model = process.env.LLM_MODEL || "moonshotai/kimi-k2.6";
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) {
    return json(500, { error: "missing_api_key" });
  }

  const referer = process.env.OPENROUTER_REFERER || "https://app.mise.seanholung.com";
  const appTitle = process.env.OPENROUTER_TITLE || "Mise";

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
    return json(502, { error: "upstream_unreachable" });
  }

  if (!upstream.ok) {
    // Surface a generic error; do not echo upstream body (may contain prompt fragments).
    return json(502, { error: "upstream", status: upstream.status });
  }

  let upstreamJson: any;
  try {
    upstreamJson = await upstream.json();
  } catch {
    return json(502, { error: "upstream_bad_json" });
  }
  const text: string = upstreamJson?.choices?.[0]?.message?.content || "";
  return json(200, { text });
};
