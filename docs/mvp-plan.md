# MVP Implementation Plan

## Guiding principle
Optimize for a magical first-run experience while keeping implementation deterministic and debuggable.

## Milestone 1: Data intake + schema engine
### Deliverables
- JSON/CSV upload and paste parser
- Canonical internal tabular/record representation
- Schema inference service:
  - key discovery
  - scalar type inference
  - nested object flattening strategy
  - array handling rules
- Schema version hash for repeatability checks

### Acceptance criteria
- User can paste/upload valid JSON/CSV and get parsed records.
- System generates deterministic schema output for the same input shape.
- Invalid inputs produce clear errors.

## Milestone 2: AI suggestion + widget mapping
### Deliverables
- Heuristic + model-assisted visualization recommender
- Fixed widget registry with typed config contracts
- Layout generation (initial grid placement)

### Acceptance criteria
- Given representative datasets, system generates at least 3 meaningful widgets.
- No unsupported widget types can be produced.
- Rendering works without code generation.

## Milestone 3: Dashboard editor
### Deliverables
- Add/remove/reorder widgets
- Switch widget type while preserving compatible bindings
- Rename titles and labels

### Acceptance criteria
- Editor changes persist in dashboard config.
- Undo/rollback for destructive widget changes (minimum one-step).

## Milestone 4: Save/share/re-upload
### Deliverables
- Persist dashboard config as schema+parser+layout
- View-only share link
- Re-upload flow with schema compatibility validation
- Drift diagnostics (missing keys/type mismatches)

### Acceptance criteria
- Same-shape upload refreshes values successfully.
- Incompatible uploads show actionable warnings.

## Milestone 5: Trust and power-user affordances
### Deliverables
- Parser inspect panel
- Parser export (JSON or code artifact)
- Privacy messaging in product copy

### Acceptance criteria
- User can inspect parser logic for mapped fields.
- Export action works in one click.

## Technical guardrails
- No arbitrary runtime chart code generation in MVP.
- Data values not persisted in long-lived backend storage.
- All rendering must use typed widget contracts.

## Suggested non-functional baselines
- First dashboard render target: under 3 seconds for <=10MB files on typical broadband
- Error messages understandable by non-technical users
- Share links stable and idempotent
