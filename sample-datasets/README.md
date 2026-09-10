# Synthetic business datasets

These deterministic datasets exercise Mise with data shaped like recurring work
for product managers and business analysts. Every dataset is synthetic: names,
identifiers, amounts, and outcomes do not describe real people or companies.

The directory is separate from `eval-datasets/`:

- `sample-datasets/` contains larger, generated business scenarios for manual
  product testing, performance checks, demos, and exploratory evaluation.
- `eval-datasets/` contains smaller regression fixtures with explicit renderer
  expectations.

## Included datasets

| Dataset | Grain | Primary analysis |
|---|---|---|
| `product-usage-weekly` | One account per week | Adoption, activation, retention, expansion, churn, and segment performance |
| `ecommerce-orders` | One order | Revenue, margin, product mix, campaigns, discounts, refunds, and fulfillment |
| `support-tickets` | One support ticket | SLA performance, resolution time, CSAT, escalations, issue mix, and support capacity |

Each dataset has equivalent `.csv` and `.json` files. `manifest.json` records row
counts, column counts, byte sizes, and SHA-256 digests.

## Regenerate

The generator uses only the Python standard library and a fixed seed:

```bash
python3 sample-datasets/generate.py
```

To prove the committed artifacts match the generator:

```bash
python3 sample-datasets/generate.py --check
```

The check regenerates everything in a temporary directory and performs byte-for-
byte comparisons. Change the seed, schemas, distributions, or row counts in
`generate.py`, regenerate, and commit the script and artifacts together.

## Testing with Mise

Upload either representation through the app's file picker or drag it onto the
empty plate. Useful checks include:

- The CSV and JSON versions produce equivalent schemas and dashboard metrics.
- Date fields become time axes rather than categories.
- IDs do not become KPIs.
- Rates render as percentages and `_usd` fields render as currency.
- Repeated date/category rows use the intended sum, average, or last-value
  aggregation.
- Null survey, campaign, resolution, and fulfillment values do not break
  profiling or rendering.
- The contributing-row inspector remains responsive on the larger files.
