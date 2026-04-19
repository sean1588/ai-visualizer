# Product Spec: AI Dashboard Creator (Phase 1 MVP)

## One-sentence concept
An AI-powered tool that turns pasted JSON/CSV into a live, shareable dashboard in seconds.

## Target user
- Non-technical and semi-technical users
- Ops leads, PMs, analysts, founders, marketers
- Users with access to data exports but no engineering bandwidth for BI setup

## Core value proposition
- Zero setup
- No SQL
- No schema modeling by hand
- No BI license gate for initial value
- Useful first dashboard in seconds

## Key differentiator: schema-based repeatability
When data is uploaded, the system stores:
1. Inferred schema
2. Generated parser
3. Widget layout and configuration

The system does **not** store source data values by default.

A new upload with the same schema shape refreshes values while preserving layout and widget settings.

## Locked decisions
1. **Schema-only storage** for persisted dashboard configuration
2. **Short-lived cache** for last uploaded file (24–48h target, temporary UX optimization)
3. **Fixed widget library** in MVP (no free-form AI-generated chart code)
4. **Product naming** deferred until after MVP scope lock

## Phase 1 MVP scope
### In scope
- Upload JSON or CSV (paste, drag-and-drop)
- Schema/type inference
- AI-selected starting widget set and layout
- Edit controls: add/remove/reorder widgets, switch type, rename labels
- Save dashboard (`schema + parser + layout`)
- Re-upload same-shape file to refresh values
- Schema drift warnings for missing/changed fields
- Shareable view-only URL
- Parser inspect/export for trust and power users

### Out of scope
- Persistent API endpoint ingestion (Phase 2)
- Prompt/markdown rendering directives (Phase 3)
- Cross-file joins/transforms
- Real-time streaming
- Team auth/permissions
- White-label/embed
- Arbitrary custom user code widgets
- Warehouse/database connectors

## MVP widget library
- KPI card
- Line chart (time series)
- Bar chart
- Stacked bar chart
- Table (sortable/filterable)
- Pie/donut (guardrails, sparse usage)
- Heatmap
- Geo map (lat/lng or country/state autodetect)
- Grouped category breakdown (treemap or grouped bar)

## UX flow
1. Landing page with paste/upload CTA
2. Loading state: "Analyzing structure…"
3. AI-generated dashboard appears
4. Inline editing and drag reorder
5. Save dashboard and receive shareable link
6. Later: upload same-shape file and refresh values

## Privacy/trust positioning
- "We never store your data values, only schema and layout." 
- Parser export and inspect mode supports user trust.
- Any temporary raw-file cache must be explicitly labeled and time-bounded.

## Open questions to resolve before build freeze
1. Data cleaning policy for mixed/null/messy fields
2. MVP max file size (recommend: 10MB initial)
3. Cache location and TTL default (recommend: client-side IndexedDB, 24h)
4. Save model in MVP: anonymous magic-link vs sign-in required
5. Widget edit UX for low-technical users (discoverability + safe defaults)
6. Messaging line that communicates schema-refresh value in <3 seconds
