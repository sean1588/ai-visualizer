# Mise · v1 scope decisions

_Captured 2026-04-27 during the D-supporting-screens design pass._

## The product, in one sentence

> **Paste data or a public URL. Get a dashboard. In your browser. We hold the schema, not the rows.**

## The architecture

A **thin stateless service** that does one thing: takes the *shape* of incoming data and returns a layout recipe (which widgets, in what order, with which fields). All rendering and refresh happens in the browser. We don't have a database for user data.

```
   browser                       inference service (stateless)
   ┌──────────────────┐          ┌──────────────────────────┐
   │ paste / drop     │          │  schema → widget layout  │
   │       │          │          │  (Claude / agent)        │
   │       ▼          │  shape   │                          │
   │ infer locally ───┼─────────▶│  no logging of rows      │
   │       │          │  recipe  │  no storage              │
   │       ◀──────────┼──────────│                          │
   │       ▼          │          └──────────────────────────┘
   │ render + poll    │
   │       ▼          │
   │ export as HTML   │
   └──────────────────┘
```

## v1 scope — IN

- **Doorway 01 · Snapshot** — drag-drop / paste a CSV / JSON / XLSX. Schema inferred, widgets laid out, dashboard renders client-side.
- **Doorway 02 · Live URL** — paste a public GET endpoint. Browser polls on cadence (1m / 5m / 1h / 1d / on view). Re-renders on response.
- **Recent (this browser)** — localStorage-backed handle list. No accounts. Honest about being browser-local.
- **Export to self-contained HTML** — the share story. Dashboard becomes a file you can email, host, or commit.
- **Inference service** — small backend that decides widget layout from data shape. Sees rows once, doesn't log them, doesn't store them.

## v1 scope — OUT (decided, with rationale)

| Cut | Why | Possible later |
|---|---|---|
| **POST endpoint** ("write to us") | Stateful service, retention, GDPR, abuse. Don't earn the right to ask users for it until the mise proves useful. | v2 — add as toggle on Doorway 02. |
| **Markdown source** (`.dashboard.md`) | Either a YAML config in markdown's clothing (small persona, big surface) or a fundamentally different product (live narrative reports). Distraction in v1. | v2 — explore as **narrative reports** (prose with live embedded widgets), not as config. |
| **Save & share** (saved dashboards behind URLs we host) | Accounts, auth, sessions, encryption, audit, ToS, SOC2 conversations. Implies custodianship of sensitive data. | v2+ — only after demand is proven, and only with proper data infra. |
| **Account system** | Same as above. No accounts = no breach surface. | When Save & share returns. |
| **Workspaces / collaboration** | Compounds the account problem. Not the wedge. | v2+. |

## Trust / privacy pillar

This is the marketing differentiator that falls out of the architecture:

> **We see your data once, for a few seconds, to design the dashboard — then forget it. There's no *my dashboards* page hiding your data on our servers, because there are no servers holding your data.**

Surfaces explicitly on:
- Marketing landing — privacy pillar block + manifesto
- Empty state — "Schema inferred locally · nothing leaves your browser until you save"
- Endpoint setup — "We hold the schema, not the rows"
- Export modal — "Nothing was uploaded. Closing this tab without exporting deletes the dashboard."
- Recent page — "in this browser · not on our servers"

## Persistence & monetization shape

**v1 — local persistence, free.** Dashboard state lives in `localStorage`:
- File handle / data digest (so we can re-render without re-asking)
- Stream config (URL, cadence, last response)
- Layout overrides (any user reordering / resizing of widgets)
- "Recent" list is just the keyed handles in localStorage

Costs us only the inference calls. Free tier isn't crippled — it's *complete*.

**v2 — hosted, paid.** When and only when v1 demand is proven, the paid tier opens up the things that genuinely cost money to do right:

| v2 capability | Why it's paid |
|---|---|
| Hosted dashboards (real URLs) | Storage + auth + uptime |
| POST endpoints (writeable) | Stateful service + retention + abuse mitigation |
| Workspaces / sharing | Permissioning, audit, support burden |
| Scheduled polling (tab-closed) | Real backend cron, egress costs |
| SSO / SOC2 posture | Compliance work, sellable to enterprise |

Honest pricing story: *"v1 is free because it costs us almost nothing. v2 costs because we're now the custodian of your data, and that costs real money to do right."*

## The AI contract

The whole product hinges on Claude doing the layout decision. The deterministic planner exists *only* as a safety net for when the model is unreachable.

### Prompt shape

**Inputs:**
- Schema: `[{name, type, sample_values, unique_count, min, max}]`
- Row count: N
- Sample rows: 5–10 representative rows (first, middle, last for time-series; random for everything else)
- User notes (optional): freeform text from the Notes box on the empty state

**Output (strict JSON):**
```json
{
  "title": "string, 2-6 words",
  "widgets": [
    {
      "type": "kpi | line | bar | donut | statlist | table",
      "span": 3 | 4 | 6 | 8 | 12,
      "title": "string",
      "fields": { "x": "col", "y": "col" } | { "cat": "col", "metric": "col" } | ...,
      "rationale": "one sentence — why this widget for this data"
    }
  ],
  "observations": [
    "Up to 3 short data-driven sentences (e.g. 'Revenue grew 142% but churn doubled.')"
  ]
}
```

### Validation pipeline (every Claude response)

1. **Strip code fences** — Claude often wraps JSON in ```` ```json ... ``` ````
2. **Extract JSON** — first `{` to matching `}` if there's surrounding prose
3. **Schema validate** — drop unknown widget types, drop widgets pointing at columns that don't exist, clamp `span` to `[3, 4, 6, 8, 12]`
4. **Sanity check** — at least one widget must remain. If not → fall back to deterministic planner with a small banner: *"Couldn't reach AI — showing a default layout."*

### Prompt-injection hygiene (TODO before public launch)

User-supplied data and Notes both flow into the prompt. Mitigations needed:
- **Wrap in clearly-fenced blocks** — `<USER_DATA>...</USER_DATA>`, `<USER_NOTES>...</USER_NOTES>` — and tell the model in the system prompt to treat their contents as data, not instructions.
- **Cap notes length** — 1000 chars in v1, prevents prompt-stuffing.
- **Strip obvious injection patterns** in the client (instructions like "ignore previous instructions") — defense in depth, not the main barrier.
- **Server-side: rate-limit per IP** — caps blast radius if injection succeeds.
- **Don't echo Claude's response in the dashboard chrome** — observations render as static text in their own widget; never as `innerHTML` of trusted UI surfaces.

This isn't a v1 ship blocker (the demo audience is friendly), but it ships with the public launch.

## Open questions

- **What's the inference service's exact contract?** Does it take a sample of rows? A schema-only digest computed locally? Probably the latter for the strongest privacy promise — design the local schema-inference step to be a real one.
- **Cadence honesty for Doorway 02** — if the user closes the tab, the polling stops. We should be explicit about that ("polls while the dashboard is open"). v1 is not a monitoring service.
- **Exported HTML for live-URL dashboards** — does it bake in the last response, or keep polling on open? Two output modes: *Self-contained HTML* (snapshot-baked) and *HTML + live URL* (polls on open). Already reflected in the Export modal.
