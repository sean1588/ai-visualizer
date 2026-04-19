# AI Visualizer

AI Visualizer is an AI-powered dashboard generator for non-technical and semi-technical users.

Paste JSON or upload CSV, and get a useful dashboard in seconds.

## Core promise

**Copy, paste, go.**

The product bridges the gap between:
- "I have data"
- "I have a shareable dashboard"

without requiring SQL, data modeling, or BI tooling setup.

## Why this exists

Many PMs, analysts, marketers, founders, and ops leads can obtain data exports, but cannot quickly turn that data into dashboards without engineering support.

## MVP focus

The MVP is designed around **schema-bound repeatability**:
- The app analyzes uploaded data shape.
- It generates a parser for that shape.
- It saves dashboard state as `{schema + parser + widget layout}`.
- A future file with the same shape can refresh the dashboard values instantly.

This makes dashboards reusable templates, not one-off generated charts.

## Planned docs

- `docs/product-spec.md` — product requirements, constraints, and UX principles.
- `docs/mvp-plan.md` — implementation phases and acceptance criteria.
- `docs/architecture.md` — technical architecture for schema inference, parser generation, and rendering.
