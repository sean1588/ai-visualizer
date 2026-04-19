# Proposed Architecture (MVP)

## High-level components
1. **Ingestion Layer**
   - Accept pasted JSON and uploaded CSV
   - Normalize into record arrays

2. **Schema Inference Engine**
   - Infer field paths, primitive types, optionality
   - Compute schema signature/hash
   - Emit compatibility report on subsequent uploads

3. **Parser Generator**
   - Build deterministic extraction rules from schema
   - Expose parser artifact for inspect/export

4. **Widget Recommendation Engine**
   - Map schema features to widgets from fixed library
   - Generate initial dashboard layout

5. **Dashboard Runtime**
   - Execute parser against current dataset
   - Bind parsed metrics/dimensions to widget configs

6. **Persistence Layer**
   - Store dashboard config object:
     - schema
     - parser
     - widget layout/config
   - Exclude raw dataset values from long-term storage

## Primary data model

```ts
type DashboardConfig = {
  id: string;
  schema: InferredSchema;
  parser: ParserSpec;
  widgets: WidgetConfig[];
  layout: LayoutSpec;
  createdAt: string;
  updatedAt: string;
};
```

## Schema compatibility strategy
- Exact match: auto-refresh
- Soft mismatch (optional fields missing): warn, continue when safe
- Hard mismatch (type conflict/core key missing): block refresh + show diagnostics

## Security & privacy posture
- Long-lived server storage excludes raw customer values
- Optional short-lived cache is explicitly time-bound and transparent
- Share links default to view-only

## Extensibility path
- Phase 2: add ingestion endpoint and periodic updates using same parser/schema contract
- Phase 3: add optional `.dashboard.md` override layer for visualization directives
