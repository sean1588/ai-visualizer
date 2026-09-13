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

### Browser-local insight tools

- Before/after dataset comparison with a local metric diff.
- Threshold alerts evaluated while an HTTP dashboard is open.
- A Markdown executive brief whose claims link back to metrics and rows.
- A recipe inspector showing source, transformations, assumptions, and widgets.
- Google Sheets and other public-data conveniences built on the HTTP source.
- Embed mode for self-contained exports.
- Brand palettes and export themes.

### Analysis workbench

- Dashboard-wide focus filters update every widget without changing the recipe.
- Saved views preserve reusable filter combinations with each plate.
- KPI goals show target progress and update against the current focused view.
- Dashboard context notes keep decisions and caveats beside the analysis.
- Column profiles expose ranges, medians, distributions, and date coverage.
- A local relationship finder surfaces strong numeric correlations as leads.
- A privacy scan flags likely personal data and credential fields locally.
- Schema-aware follow-up questions can be handed to The Chef for refinement.
- Presentation mode removes editing chrome for reviews and screen sharing.
- Portable dashboard backups restore rows, recipes, views, goals, notes, and theme.

### Action hierarchy

- One action table describes every document-level action once; header menus,
  keyboard shortcuts, and the command palette read from it.
- The dashboard header shows a save-state pill, compact undo/redo only when
  history exists, Data and Export menus, and Present; the landing page shows
  only the wordmark and breadcrumb.
- HTTP-only actions such as Refresh data and Alerts are omitted for local
  datasets instead of rendered disabled.
- The dashboard head keeps a single Analyze button; the executive brief and
  recipe inspector became workbench tabs and the theme picker moved to Notes.
- Cmd/Ctrl+K opens a command palette that reaches every action and workbench
  tab; Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, `/`, `P`, and Escape work on the dashboard.
- Each widget card keeps a single `⋯` menu for view rows, assumptions, rationale,
  rename, layout, Chef, and table export; meta stays as muted text.
- Observations render after the leading KPI run and collapse past two notes so
  KPI values stay above the fold.
- Widget titles and the dashboard title rename inline (double-click, Enter, or
  F2); empty titles revert and the change is undoable.
- Widgets reorder by dragging a handle on fine pointers; keyboard users keep
  Move earlier/later. Touch hides the handle and keeps the `⋯` trigger at 44px.
- Clicking a chart value opens the row inspector with Focus dashboard on
  `{column} = {value}`; that path writes one equals filter per column so another
  bar click moves focus instead of stacking contradictory rules.
- Active filters render as dismissible chips in the dashboard head (`Focused · n
  of N rows`); chip text stays visible in presentation mode while × and Clear all
  hide with the rest of the chrome.
- Chef empty-state suggestions and a Try next row after a successful reply come
  from schema-aware `buildFollowUpQuestions`, including prompts grounded in the
  actual donut, table, KPI, and observations widgets on the plate.

## Architecture boundaries

### Paid and collaborative capabilities

These require a different custody model and should not be incremental additions
to the current browser-local architecture:

- Cross-device sync and hosted dashboards.
- Private authenticated data sources.
- Background refresh and server-side alerting.
- Workspaces, permissions, audit logs, SSO, and compliance controls.

## Completed engineering foundation

### Correctness and evaluation

- Turn the manual evaluation corpus into repeatable tests.
- Add deterministic assertions for facts, aggregation, and schema drift.
- Evaluate live model layout quality separately from renderer correctness.
- Surface rejected model widgets instead of silently dropping them.

### Maintainability

- Continue extracting feature components when the concepts have independent
  state or behavior; avoid wrappers that only reduce line count.
- Keep direct controls and AI edits on one canonical recipe contract.
- Keep IndexedDB migration gated on observable local-storage quota failures.

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

Minimal first-party events contain no row data, field names, URLs, or free text.
They measure the ingest-to-render funnel, fallback rate, assumption edits, chart
inspection, Chef use, recurring refresh, and export type.

## Explicitly deferred

- Mandatory onboarding tours.
- Voice input.
- A template marketplace.
- Full BI-style query building.
- Hosted sharing as a shortcut around self-contained export.
- XLSX ingestion until product usage shows spreadsheet files are a material
  entry path.
