# Mise · follow-ups

_Things we deliberately did not build for v1, organized so we can pick them up later without losing the rationale. Last updated: 2026-05-02._

---

## Tier 1 — pre-launch polish

These should ship before showing the product to real users for the first time.

### 1.1 Empty Plates placeholder
When a fresh user lands and has no plates yet, the bottom of the empty card has dead space. Add a softer **"Your plates will live here"** placeholder — one line of mono-caps text, optional micro-icon. ~10 min.

### 1.2 Mobile gate or responsive pass
Marketing is fine; the prototype's 12-col grid + 420px chef panel + sticky topbar break under 768px. **Decision required:**
- (a) Ship desktop-only with a polite mobile gate: *"Mise is a desktop product. Pull up your laptop and meet us back here."*
- (b) Real responsive pass: stack widgets to 6/12 cols, dock chef as a bottom sheet, scrap sticky topbar
- 30-50% of marketing clicks come from mobile in our category — they need to land somewhere honest

### 1.3 Pricing copy on marketing
Right now silent on cost, which makes power users assume there's a catch. Add a small inline note in the footer or near the CTA: *"Free, forever, for personal use. No accounts. No data leaves your browser. If you want to embed this in a commercial product, [say hi]."* Honest, disarming, removes the friction. ~10 min.

### 1.4 Telemetry (privacy-respecting)
Currently zero visibility into what users do. Even one minimal event-pinger — `{event: 'rendered', widget_count: 8, chef_used: false, fallback: false}`, no PII, no data — would tell us:
- Do users actually use the chef? (the moat hypothesis lives or dies here)
- Where does the funnel break? (paste → render → save? Or paste → bounce?)
- Is the schema-inference fallback firing more than we expect?
- Probably 1h to wire up + a $5/mo Plausible or self-hosted endpoint

---

## Tier 2 — high-leverage product moves

Features that meaningfully change what Mise *is*, not just polish.

### 2.1 Live data refresh from a URL
The Notion doc's headline promise: "paste a public URL." Right now everything is one-shot.
- Paste a public CSV URL → Mise refetches it on dashboard load → bookmark = always-current dashboard
- Hardest part: CORS. Most public CSVs work; Google Sheets needs a proxy.
- Worth scoping into a separate doc before building. The "dashboard at a URL" pitch fulfilled.

### 2.2 Per-widget chef trigger
Right-click any widget → *"Tell the chef about this widget"* → opens chat with `[Donut: Revenue by region]` prefilled. Turns the chef from a chatbox into a real workspace primitive. ~2h.

### 2.3 Regenerate / "show me a different angle"
Currently identical inputs → identical recipe. That's bad for an AI product — variance is the *demo*. Add a "Regenerate" button next to the title that re-asks Claude with `temperature=0.7` and a "different angle" instruction. Three layouts side-by-side is more demoable than one good one. ~1h.

### 2.4 Public sharing — snapshots, not accounts
No accounts, no servers (the scope). But: an **"Export as a public URL"** option that uploads the standalone HTML to a free static host (Netlify Drop, GitHub Pages, generated data URL) and gives a shareable link.
- Scope: integrate one host, no auth on our side.
- Huge for word-of-mouth — people share dashboards way more than we'd think.
- Worth a separate scoping doc; CORS, rate limits, and abuse vectors all need thought.

### 2.5 Worked examples / template gallery
Empty state samples right now just paste data. Replace with 4-6 fully-rendered example dashboards: *Stripe payouts*, *GitHub repo health*, *Plausible analytics*, *SaaS MRR*, *Your Strava*, *NPS feedback*. Each loads as a finished plate. Users learn what Mise *can* do by seeing what it has done. ~3h.

### 2.6 "Why this layout?" on each widget
Every recipe widget already has a `rationale` from Claude (or a generated one in the fallback). Surface it: tiny `(?)` corner icon → hover/click → shows the one-line rationale. Demystifies the AI, builds trust. ~45 min.

---

## Tier 3 — when there's traction

Real product investments worth making once the product has visible demand.

### 3.1 Accounts + paid tier
Only relevant once the product is well-received and there's a clear pull. The architecture for "no accounts" was right for v1 — *don't earn the right to ask for an account until you've earned the right.*

When that day comes, the unlock is:
- **Save plates server-side** (across browsers/devices) — not "publish," just sync
- **Larger Claude budgets** (we're hitting per-user rate limits sooner than expected)
- **Private data sources** (paste an API URL with auth, we hit it server-side)
- **Branded export themes** (a dashboard with your colors / logo for client work)

Pricing thoughts (for later): free tier stays generous (current product, 100% browser-local). Paid tier $8-12/mo for sync + larger budgets. Team tier $20/seat for multi-user. *Don't build any of this until the demand is screaming for it.*

### 3.2 Embed mode
Strip the topbar/chef chrome, expose a `?embed=1` URL flag → renders just the dashboard, full-bleed. People will want this for blog posts and internal docs.

### 3.3 LLM-agnostic backend
Currently Claude-only via `window.claude.complete`. For v2 of the real product, the recipe planner should be LLM-agnostic: same prompt schema, swap the provider. Hedges against rate-limit / pricing risk. Not urgent but a 1-day refactor when we get there.

---

## Tier 4 — design debt

Small things we'll regret if we don't write down.

- **Undo is per-message, not chained** — clicking undo on chef edit #3 leaves edits #4 and #5 visible-but-undone in history. Probably fine; revisit if users complain.
- **No "redo"** — if you undo and want to redo, you have to re-type. Cheap to add (~20 min) but unclear if anyone needs it.
- **The validator silently drops invalid widgets** — if Claude hallucinates a column, the widget vanishes with no message. Should we tell the user? *("Skipped a widget — the chef referenced a column that doesn't exist.")*
- **Recents are unbounded by storage size, only by count (12)** — a power user with huge datasets will hit `localStorage` quota. Saving rows in IndexedDB instead would lift the cap.
- **No widget reordering by drag** — once Claude lays out the recipe, you can't drag widgets around. Chef can do it via "move X to top," but direct-manipulation is more satisfying. Probably v1.5.
- **Observations widget is not editable** — the chef can replace it but you can't tweak a single line. Edge case; revisit if anyone asks.

---

## Strategic / non-product

### 5.1 Domain
- Buy `mise.app` (preferred), `getmise.com`, `mise.so`, `usemise.com` as backups.
- Twitter/Bluesky handle: `@mise` (taken; try `@usemise` or `@mise_app`)

### 5.2 SEO landing
A one-pager at `mise.app/what-is-mise` titled literally **"What is Mise?"** answering "why is it called Mise" and "what does it do" in plain English. Helps with the disambiguation problem (Mise the build tool, *mise-en-scène*, French verb conjugations).

### 5.3 GitHub repo
Open source the project under MIT. *Some of the trust comes from being able to read the code that's reading your data.* Repo with clean README, the `notes/` folder published as docs, and a "How does Mise actually work?" essay.

### 5.4 First press
Don't pitch outlets. Post the demo video on Twitter, post on Hacker News with a "Show HN" title, drop in r/dataisbeautiful and r/SideProject. If something hits, *then* pitch the people who covered competitors. Don't waste the first impression on a cold pitch.

---

_Pull the most important 3-5 of these into a real GitHub project board when the product is ready to ship._
