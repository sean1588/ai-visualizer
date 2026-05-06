# Mise · backend & LLM strategy

_The AI-call architecture. Decisions made; rationale captured. Last updated: 2026-05-02._

---

## TL;DR

- **Provider for v1:** OpenAI-compatible (we'll wire to OpenAI directly initially; can target any compat endpoint — Together, Groq, Fireworks).
- **Adapter:** thin `llm.ts` module with one method, `complete(prompt: string, opts?) → Promise<string>`. Swap providers via env var, no app changes.
- **Where the call lives:** server-side. A single serverless function (Cloudflare Worker, Vercel Edge Function, or a small Node service). The API key never reaches the browser.
- **Anthropic-readiness:** the adapter has both an OpenAI client and an Anthropic client; provider chosen by `LLM_PROVIDER` env var. Adding a new provider = ~50 lines.

---

## Why OpenAI-compatible (and not Anthropic native)

Three reasons, in order of importance:

1. **The OpenAI Chat Completions shape is the lingua franca.** Together, Groq, Fireworks, vLLM, OpenRouter, Mistral's API, DeepSeek, and dozens of self-hosted runtimes all speak it. Picking it as our default means we can sub providers freely without rewriting prompts or response parsing.
2. **Cost and latency optionality.** If Mise gets traction and Claude rate limits bite, we want to fall back to a cheaper/faster provider for some users without a rewrite. OpenAI-compatible buys us that for free.
3. **Anthropic is a one-line addition, not a rewrite.** Their API differs only slightly (system prompt as a top-level field, not a message; messages array shape). The adapter handles both.

We are *not* picking OpenAI because we think their model is better. The recipe-planning prompt works well on Claude Haiku, GPT-4o-mini, and Llama 3.1 70B with no changes. Pick whichever is cheapest at launch; sub later.

---

## The adapter

```ts
// llm.ts — provider-agnostic LLM client.
// Usage: const text = await complete("paste me your prompt");

type LLMOpts = {
  maxTokens?: number;       // default 1024
  temperature?: number;     // default 0.0 for recipe planning, higher for "regenerate"
  system?: string;          // optional system prompt
};

export async function complete(prompt: string, opts: LLMOpts = {}): Promise<string> {
  const provider = process.env.LLM_PROVIDER || "openai";  // "openai" | "anthropic"
  const maxTokens = opts.maxTokens ?? 1024;
  const temperature = opts.temperature ?? 0.0;

  if (provider === "anthropic") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || "claude-haiku-4-5",
        max_tokens: maxTokens,
        temperature,
        system: opts.system,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return j.content?.[0]?.text || "";
  }

  // Default: OpenAI-compatible
  const baseURL = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
  const r = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.LLM_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || "gpt-4o-mini",
      max_tokens: maxTokens,
      temperature,
      messages: [
        ...(opts.system ? [{ role: "system", content: opts.system }] : []),
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content || "";
}
```

That's the entire adapter. ~60 lines total. It deliberately hides streaming and tool-use because we don't need them yet.

---

## The proxy endpoint

The app calls **our** endpoint, not the LLM provider directly. Two reasons:

1. **API key safety.** Browsers can't hold the key — it'd be public.
2. **Rate limiting + abuse control.** We can throttle per IP, refuse oversized prompts, log token usage. None of which we can do client-side.

Suggested shape — a single POST endpoint, stateless:

```
POST /api/cook
Content-Type: application/json

{
  "prompt": "<the full chef or planner prompt>",
  "kind": "plan" | "chef",       // for telemetry / different limits
  "temperature": 0.0
}

→ 200 { "text": "..." }
→ 429 { "error": "rate_limited", "retryAfter": 60 }
→ 502 { "error": "upstream", "detail": "..." }
```

**Recommended host:** Cloudflare Workers. Free tier covers our launch. Cold-start-free, edge-deployed, the env var story is clean. Vercel Edge Functions and AWS Lambda are fine alternatives.

**Rate limiting:** start with 30 requests / IP / hour using Cloudflare's built-in KV-backed counter. Tune from telemetry. Chef calls are likely ~3-5× more frequent than plan calls per session.

**No persistence on the proxy.** No logs of prompts, no logs of responses beyond what's needed for billing reconciliation. This must remain true to keep the marketing claim "nothing is stored" honest. Document in the privacy policy.

---

## What changes in the app code

The current prototype calls:

```js
const raw = await window.claude.complete(prompt);
```

For production, replace `window.claude.complete` with a single fetch to our proxy:

```js
async function complete(prompt) {
  const r = await fetch("/api/cook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, kind: "chef" }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `HTTP ${r.status}`);
  }
  const j = await r.json();
  return j.text;
}
```

Two call sites to update: `planRecipe` (in `prototype-app.js`) and `chefSubmit`. Five-minute change.

---

## Costs (rough)

Assuming `gpt-4o-mini` at $0.15/M input + $0.60/M output:

- **Per recipe plan**: ~3k input tokens (schema + sample rows) + ~1k output tokens = ~$0.0015
- **Per chef edit**: ~4k input tokens (schema + current recipe + request) + ~1k output tokens = ~$0.002

A typical session (1 plan + 3 chef edits) ≈ $0.0075. **133 sessions per dollar.** Even at 10,000 sessions / month launch, that's $75/mo of LLM cost — easily covered by goodwill while we figure out monetization.

If we move to Claude Haiku (current `claude-haiku-4-5` pricing TBD), expect ~3-5× higher, still trivial.

---

## Open questions for the dev

- **Streaming.** Do we want to stream the chef reply for a "the chef is typing…" effect? Adds complexity (SSE on the proxy, EventSource on the client) but feels more alive. **Recommendation:** ship without streaming. If telemetry shows the chef wait is hurting engagement, add later.
- **Local model option.** Some power users will want to run Ollama / llama.cpp locally and skip our proxy. A `?llm=http://localhost:11434/v1` query-param escape hatch (defaulting to our proxy) is cute but expands the attack surface. **Recommendation:** v2.
- **Server-side caching.** Same prompt → same recipe (with `temp=0`). Cache layer keyed on `hash(prompt)` would cut costs ~30% and speed responses on warm paths. **Recommendation:** v1.5, after we have telemetry on hit rates.

---

_Pre-launch checklist: env vars set in proxy host, rate limiting active, error responses formatted as JSON, privacy policy live, abuse runbook drafted (what we do if someone tries to use our proxy as a free LLM gateway)._
