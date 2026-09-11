# Mise product roadmap

_Captured 2026-09-10 after reviewing the live product and repository._

## Product direction

Mise should become the most trustworthy way to turn a small tabular dataset
into an explorable, reusable dashboard without becoming a data warehouse.

The sequence matters:

1. Make every claim traceable to locally computed facts.
2. Let people inspect and correct Mise's assumptions.
3. Make every visualization explorable.
4. Make successful dashboards reusable for recurring work.
5. Improve sharing without weakening the browser-local privacy model.

Accounts, hosted collaboration, and marketplaces stay deferred until repeated
use demonstrates that server-side custody is worth the security and operational
cost.

## Completed

### Local analytical profile

Compute descriptive statistics, trends, missingness, and category distributions
in the browser. Give the model that profile rather than sampled raw rows. The
model remains responsible for editorial layout; arithmetic remains deterministic.

This improves both correctness and privacy:

- Observations can cite facts calculated across the complete dataset.
- Unrepresentative sample rows cannot distort conclusions.
- Raw row combinations no longer leave the browser during planning or Chef edits.

Aggregate category labels may still be included in the profile when useful.
The UI and privacy copy should therefore promise "no raw rows sent," not "no
values sent."

### Visible, editable assumptions

Every analytical widget should state the field, aggregation, grouping, and
format it uses. These assumptions should be editable without an AI round trip.
The direct controls and The Chef must mutate the same recipe representation.

### Chart exploration

Charts provide exact-value tooltips, keyboard-accessible points, interactive
legends, and a shared source-row inspector. A user can move from any visual
claim to the rows that produced it.

### Delivery freshness

Static app responses require browser revalidation while CloudFront retains its
optimized edge cache. Normal refreshes therefore pick up invalidated deployments
without requiring users to empty their browser cache.

### React and TypeScript foundation

The frontend uses Vite, React, and strict TypeScript. Parsing, profiling,
aggregation, recipes, formatting, and table behavior live in pure domain
modules; the application reducer and components own interactive state. Vite
emits content-hashed assets, and the PNG renderer is bundled as a lazy chunk.

### Recurring-report mode

- Replace a dashboard's data while preserving its recipe.
- Compare the current dataset with the previous local snapshot.
- Highlight changed metrics and schema drift.
- Add manual and while-open refresh cadences for HTTP sources.
- Show fetched-at time and stale/error state.

### No-custody sharing

- Export a self-contained interactive HTML dashboard.
- Share recipe-only links encoded in the URL fragment.
- Keep PNG, recipe JSON, table CSV, and Markdown exports.
- Keep hosted links deferred until retention, abuse, and deletion are defined.

### Data health

- Explain malformed and dropped rows.
- Surface missing values, duplicate time keys, inconsistent dates, and outliers.
- Offer corrections only when ambiguity exists; do not add a confirmation gate
  to clean datasets.
- Preserve an audit trail of ignored rows and user overrides.

## Next

### First-run discovery

- Replace raw-data sample chips with a small gallery of completed plates.
- Include examples for recurring SaaS metrics, payments, public APIs, entities,
  and messy data.
- Teach Notes and The Chef through contextual examples rather than a mandatory
  product tour.

### Editing

- Add direct widget resizing, movement, duplication, and removal.
- Add redo and a compact recipe history.
- Add per-widget Chef entry with the widget already in context.
- Explain why Mise selected each widget using the existing rationale field.

## Later

### New product ideas

- Before/after dataset comparison with a local metric diff.
- Threshold alerts evaluated while an HTTP dashboard is open.
- A Markdown executive brief whose claims link back to metrics and rows.
- A recipe inspector showing source, transformations, assumptions, and widgets.
- XLSX ingestion when usage shows spreadsheet files are a material entry path.
- Google Sheets and other public-data conveniences built on the HTTP source.
- Embed mode for self-contained exports.
- Brand palettes and export themes.

### Paid and collaborative capabilities

These require a different custody model and should not be incremental additions
to the current browser-local architecture:

- Cross-device sync and hosted dashboards.
- Private authenticated data sources.
- Background refresh and server-side alerting.
- Workspaces, permissions, audit logs, SSO, and compliance controls.

## Engineering foundation

### Correctness and evaluation

- Turn the manual evaluation corpus into repeatable tests.
- Add deterministic assertions for facts, aggregation, and schema drift.
- Evaluate live model layout quality separately from renderer correctness.
- Surface rejected model widgets instead of silently dropping them.

### Maintainability

- Continue extracting feature components when the concepts have independent
  state or behavior; avoid wrappers that only reduce line count.
- Keep direct controls and AI edits on one canonical recipe contract.
- Move larger saved rows from `localStorage` to IndexedDB when quota failures
  become observable.

### Security and resilience

- Test Lambda request validation, rate limiting, upstream failures, and URL fetch.
- Resolve and validate remote addresses and every redirect to prevent SSRF.
- Replace per-instance rate limiting with a shared control before promoting URL
  ingestion broadly.
- Add CSP and other production response headers.

### Accessibility

- Give charts text summaries and tabular alternatives.
- Make chart points, legends, saved plates, and the wordmark keyboard accessible.
- Add visible focus states, dialog focus management, and live status announcements.
- Verify contrast and touch targets rather than relying on visual inspection.

### Product learning

Add minimal first-party events that contain no row data, field names, URLs, or
free text. Measure the ingest-to-render funnel, fallback rate, assumption edits,
chart inspection, Chef use, recurring refresh, and export type.

## Explicitly deferred

- Mandatory onboarding tours.
- Voice input.
- A template marketplace.
- Full BI-style query building.
- Hosted sharing as a shortcut around self-contained export.
