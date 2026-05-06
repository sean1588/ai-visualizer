# Mise · architecture

_How the app is built, where it runs, and why. Last updated: 2026-05-02._

---

## TL;DR

- **Two products, two stacks, two subdomains.**
- `mise.app` → Hugo static marketing site
- `app.mise.app` → vanilla JS web app + serverless LLM proxy
- This split is intentional and should be preserved.

---

## Stack decisions

### Marketing site → Hugo
- Static markdown content, multiple pages incoming (`/blog`, `/changelog`, `/what-is-mise`, `/legal`)
- SEO matters; SSG is correct
- Familiar tooling (other sites in the same stack)
- Output is plain HTML/CSS — copy our Fraunces/IBM Plex Mono styles directly from `marketing.html`

### App → Vanilla HTML/CSS/JS
- Single-page in spirit; client-side state, file parsing in-browser, no SSR benefit
- No framework needed for what we're doing — DOM is small (~3 stages, ~7 widget renderers, the chef panel)
- Faster to load, easier to handoff, easier to debug
- One bundle, one deploy

### What we are explicitly NOT doing
- **Not Next.js** for the app. Adds build complexity, RSC boundary surface, route handlers we don't need. We have one URL.
- **Not React** for the app. The DOM is small; vanilla is faster to write and debug at this scale.
- **Not a monorepo.** Two separate repos keeps deploys, dependencies, and concerns clean.

---

## Repo split

```
mise-marketing/     ← Hugo site → mise.app
  content/
    _index.md
    blog/
    changelog/
  layouts/
  static/

mise-app/           ← vanilla web app → app.mise.app
  public/
    index.html      ← entry point (rename from prototype.html)
    app.js          ← rename from prototype-app.js
    samples/
  api/
    cook.ts         ← serverless LLM proxy (see notes/backend.md)
  notes/            ← carry over the v1-scope, vocabulary, etc
  README.md
```

The dev should not need to think about a monorepo, packages, or workspace tooling.

---

## Deployment

### `mise.app` (marketing)
Cloudflare Pages or Netlify pointing at `mise-marketing/`. Auto-deploy on push to `main`. Standard Hugo build.

### `app.mise.app` (app)
**Recommended:** Cloudflare Pages + Functions.
- Static assets from `public/` deploy directly
- The single `/api/cook` endpoint deploys as a Function
- Env vars (`LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`) set in the Pages dashboard
- One deploy unit, one platform, one bill

Vercel works equally well; pick whichever the dev is fluent in.

### DNS
- `mise.app` → marketing
- `app.mise.app` → app
- The marketing CTA buttons link directly to `app.mise.app`

---

## Why split, not consolidate

We could put both behind one Next.js app on one domain. We are deliberately not doing that:

1. **Iteration speed.** Marketing needs frequent copy tweaks; app needs careful product changes. Different cadences should be different deploys.
2. **Failure isolation.** A bug in the chef can't take down the landing page. A typo in marketing can't break the app.
3. **Stack honesty.** Hugo is the right tool for a content site; vanilla JS is the right tool for a small SPA. Don't pick one to satisfy both.
4. **Cognitive load on the dev.** Two simple things are easier to work on than one complex thing.
5. **Open source path.** The app is what we open-source eventually (trust through transparency). The marketing site stays private. Splitting now makes that trivial later.

---

## Mobile

The current prototype is desktop-only. **Pre-launch we want a real responsive pass**, not a gate. Notes:

- Marketing site already collapses well — keep checking on each Hugo template change
- App needs:
  - Topbar simplifies on mobile (hamburger for export buttons, mark stays)
  - 12-col grid → stacked widgets at <768px
  - Chef panel becomes a bottom sheet (slide up from bottom, full-width)
  - Drop zone reflows; paste textarea remains full-width
  - Notes textarea collapses by default with a "+ add notes" expander

Capture as `notes/mobile.md` once the dev is in. Do not ship without it.

---

## Performance budgets

The app should feel instant. Targets:

- **First paint** < 500ms on a fast 3G connection
- **Time to interactive** < 1s
- **Total JS** < 80kb gzipped (currently we're under because no framework)
- **No external scripts** beyond Google Fonts (which is async, doesn't block render)
- **No analytics SDK.** If we add telemetry, it's a 200-byte fetch to our own endpoint — no Google Analytics, no Segment.

---

## Browser support

Modern evergreen only: Chrome, Firefox, Safari, Edge — last 2 versions. We use:
- CSS custom properties
- `oklch()` color (Chrome 111+, Safari 15.4+, Firefox 113+ — all 2023)
- ES2022 JS features (top-level await, structuredClone, etc.)

If a user shows up on IE11 or an old Android Browser, they get a polite "please use a modern browser" page. We don't ship transpilation or polyfills for this.

---

## State persistence

- **localStorage** for plates (saved dashboards) and chef history
- Key: `mise_recents_v1` for plates, scoped by version so future schema changes don't corrupt old data
- **No IndexedDB** in v1 — localStorage's 5-10MB limit handles ~12 plates of typical size. Migrate when we hit complaints (see followups Tier 4).
- **No cookies, no sessionStorage, no service workers.** Privacy story stays simple: *"data lives in this browser tab."*

---

## Security notes

- The LLM proxy never logs prompt content beyond hashed token counts (for billing reconciliation)
- CORS on the proxy: only `app.mise.app` origin allowed in production
- CSP header on the app: tight allowlist, no `unsafe-inline` (move all inline `<script>` to external files for the production build)
- Sample data must not include any PII or anything resembling real customer data

---

## What changes between prototype and v1 production

| Concern | Prototype | Production |
|---|---|---|
| LLM call | `window.claude.complete()` | `fetch('/api/cook')` |
| Files | `prototype.html`, `prototype-app.js` | `index.html`, `app.js` |
| Env config | None | `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL` |
| Hosting | Local preview | Cloudflare Pages + Function |
| Domain | None | `app.mise.app` (app) + `mise.app` (marketing) |
| Mobile | Desktop only | Responsive |
| Telemetry | None | Optional minimal event ping (see followups Tier 1.4) |

The prototype's *structure* survives. The dev's job is mostly: rename, replace one function (LLM call), wire up the proxy, deploy, and pass the mobile pass.

---

_If the dev wants to deviate from any of this, fine — but they should write down why before starting. Defaults exist to prevent good intentions from becoming bad rewrites._
