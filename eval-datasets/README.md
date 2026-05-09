# Mise Eval Datasets

This directory is a manual and automated evaluation corpus for Mise. These files
are intentionally not wired into the app UI or bundled as product samples. They
exist so we can upload realistic datasets, inspect the dashboards Mise produces,
and catch regressions in widget choice, labels, layout, and fallback behavior.

## How to Use

1. Open the deployed app or a local static build.
2. Upload one dataset from `raw/`.
3. Check the rendered dashboard against the expectations in `manifest.json`.
4. Save screenshots or notes under `notes/` when something looks wrong.

## Current Coverage

- Time-series metrics: stocks and Seattle weather.
- Mixed metrics and categories: cars, barley, messy SaaS.
- Entity/location datasets: local airports and Vega airports.
- Larger, high-cardinality data: movies.

## Sources

- Vega Datasets: https://github.com/vega/vega-datasets
- Local airports fixture: user-provided `airports.json` copied from Downloads for regression testing.
- Generated messy SaaS fixture: synthetic data created for this repository.
