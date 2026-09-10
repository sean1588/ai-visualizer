import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateBy,
  applyRecipeToRows,
  buildDataProfile,
  buildParseHealth,
  buildRecipePayload,
  chooseGroupMode,
  computeKpiFromValues,
  contributingRows,
  deterministicRecipe,
  diffWidgets,
  formatCompact,
  formatFull,
  incomingKind,
  inferSchema,
  parseAndValidateRecipe,
  parseCsvRecords,
  parseJsonRecords,
  seriesBy,
  sortTableRows,
  toCanonicalWidgets,
  validateRecipe,
  widgetFingerprint,
  type DashboardRecipe,
  type Row,
  type SchemaColumn,
} from '../src/domain/index.ts';

test('CSV parsing handles BOMs, quoted delimiters, newlines, escapes, and blank records', () => {
  const source = '\uFEFFname,amount,note\n"A, Inc",42,"line one\nline two"\n\nB,7,"said ""hi"""\n';
  const parsed = parseCsvRecords(source);
  assert.equal(parsed.droppedBlank, 1);
  assert.deepEqual(parsed.records, [
    ['name', 'amount', 'note'],
    ['A, Inc', '42', 'line one\nline two'],
    ['B', '7', 'said "hi"'],
  ]);

  const incoming = incomingKind(source);
  assert.equal(incoming.kind, 'rows');
  if (incoming.kind === 'rows') {
    assert.deepEqual(incoming.rows, [
      { name: 'A, Inc', amount: 42, note: 'line one\nline two' },
      { name: 'B', amount: 7, note: 'said "hi"' },
    ]);
    assert.deepEqual(incoming.health, { rowsParsed: 2, rowsDropped: 1, format: 'csv' });
  }
});

test('JSON parsing finds record arrays and flattens exactly one object level', () => {
  const rows = parseJsonRecords({
    metadata: { ignored: true },
    data: [
      {
        id: '7',
        active: true,
        customer: { name: 'Ada', score: '9' },
        tags: ['a'],
        nested: { deeper: { value: 1 } },
      },
    ],
  });
  assert.deepEqual(rows, [{
    id: 7,
    active: true,
    'customer.name': 'Ada',
    'customer.score': 9,
    tags: ['a'],
    'nested.deeper': { value: 1 },
  }]);
});

test('schema inference and parse health preserve ratio and outlier heuristics', () => {
  const rows: Row[] = Array.from({ length: 8 }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    segment: index % 2 ? 'pro' : 'free',
    churn_rate: index / 100,
    amount: index === 7 ? 1000 : 10 + index,
  }));
  const schema = inferSchema(rows);
  assert.equal(schema.find(column => column.name === 'date')?.type, 'date');
  assert.equal(schema.find(column => column.name === 'segment')?.type, 'category');
  assert.equal(schema.find(column => column.name === 'churn_rate')?.asPercent, true);
  assert.equal(schema.find(column => column.name === 'amount')?.type, 'number');

  const healthSchema: SchemaColumn[] = [
    ...schema.filter(column => column.name !== 'date'),
    { name: 'raw_date', type: 'string', stat: '8 unique', unique: 8, asPercent: false },
  ];
  const healthRows = rows.map((row, index) => ({
    ...row,
    raw_date: index < 6 ? `Sep ${index + 1}` : `unknown ${index}`,
  }));
  const health = buildParseHealth(healthRows, healthSchema, {
    rowsParsed: 8,
    rowsDropped: 2,
    format: 'csv',
  });
  assert.equal(health.datesUnparsed, 6);
  assert.equal(health.outlierCount, 1);
  assert.equal(health.rowsDropped, 2);
});

test('profiles use the complete row set and collapse repeated time ticks', () => {
  const rows: Row[] = [
    { month: '2026-01-01', revenue: 10, plan: 'free' },
    { month: '2026-01-01', revenue: 20, plan: 'pro' },
    { month: '2026-02-01', revenue: 40, plan: 'pro' },
  ];
  const schema = inferSchema(rows);
  const profile = buildDataProfile(rows, schema);
  assert.equal(profile.rowCount, 3);
  assert.equal(profile.timeColumn, 'month');
  const revenue = profile.facts.find(fact => fact.column === 'revenue');
  assert.equal(revenue?.type, 'number');
  if (revenue?.type === 'number') {
    assert.equal(revenue.sum, 70);
    assert.deepEqual(revenue.trend, {
      points: 2,
      first: 30,
      last: 40,
      absoluteChange: 10,
      percentChange: 33.3333,
      lowest: 30,
      highest: 40,
    });
  }
});

test('grouping selects sum, average, or last and series collapse repeated keys', () => {
  const rows: Row[] = [
    { day: '2026-01-01', team: 'A', revenue: 10, churn_rate: 0.1, mrr: 100 },
    { day: '2026-01-01', team: 'A', revenue: 20, churn_rate: 0.3, mrr: 110 },
    { day: '2026-01-02', team: 'B', revenue: 7, churn_rate: 0.2, mrr: 90 },
  ];
  const schema = inferSchema(rows);
  assert.equal(chooseGroupMode(rows, 'day', 'revenue', schema), 'sum');
  assert.equal(chooseGroupMode(rows, 'day', 'churn_rate', schema), 'average');
  assert.equal(chooseGroupMode(rows, 'team', 'mrr', schema), 'last');
  assert.deepEqual(seriesBy(rows, 'day', 'revenue', undefined, schema), [
    { x: '2026-01-01', y: 30 },
    { x: '2026-01-02', y: 7 },
  ]);
  assert.deepEqual(aggregateBy(rows, 'team', 'mrr', undefined, schema), [
    { key: 'A', value: 110 },
    { key: 'B', value: 90 },
  ]);
});

test('number formatting honors explicit and inferred percent and currency formats', () => {
  const rows: Row[] = [{ churn_rate: 0.125, net: -1250.5 }];
  const schema = inferSchema(rows);
  assert.equal(formatCompact(0.125, 'churn_rate', 'auto', { rows, schema }), '12.5%');
  assert.equal(formatCompact(-1250.5, 'net', 'auto', { rows, schema }), '-$1.3k');
  assert.equal(formatCompact(1200, 'net', 'number', { rows, schema }), '1.2k');
  assert.equal(formatFull(-1250.5, 'net', 'currency', { rows, schema }), '-$1,250.5');
});

test('planner recipe parsing validates fields, computes KPIs, and moves one table last', () => {
  const rows: Row[] = [
    { date: '2026-01-01', region: 'west', revenue: 10, lat: 40 },
    { date: '2026-01-02', region: 'east', revenue: 15, lat: 41 },
  ];
  const schema = inferSchema(rows);
  const raw = `Here is the recipe:
    \`\`\`json
    {
      "title": "\\"Revenue view\\"",
      "observations": ["Revenue ends at 15."],
      "widgets": [
        {"type":"table","span":6,"title":"Top 1 by revenue","fields":{"limit":1}},
        {"type":"kpi","span":5,"title":"Total revenue","fields":{"metric":"revenue","aggregate":"sum"}},
        {"type":"kpi","span":3,"title":"Latitude","fields":{"metric":"lat"}},
        {"type":"line","span":8,"fields":{"x":"date","y":"revenue"}}
      ]
    }
    \`\`\``;
  const recipe = parseAndValidateRecipe(raw, schema, rows);
  assert.ok(recipe);
  assert.equal(recipe.title, 'Revenue view');
  assert.deepEqual(recipe.widgets.map(widget => widget.type), ['observations', 'kpi', 'line', 'table']);
  assert.equal(recipe.widgets[1].span, 3);
  assert.equal(recipe.widgets[3].type === 'table' && recipe.widgets[3].sort, 'revenue');
});

test('canonical normalization and validation share explicit row and schema context', () => {
  const rows: Row[] = [
    { date: '2026-01-01', segment: 'A', mrr: 100 },
    { date: '2026-01-02', segment: 'B', mrr: 120 },
  ];
  const schema = inferSchema(rows);
  const canonical = toCanonicalWidgets([
    {
      type: 'kpi',
      span: 3,
      label: 'Mrr',
      metric: 'mrr',
      aggregate: 'last',
      format: 'currency',
    },
    { type: 'bar', span: 6, title: 'MRR by segment', x: 'segment', y: 'mrr' },
  ], rows, schema);
  assert.equal(canonical[0].type, 'kpi');
  assert.equal(canonical[0].type === 'kpi' && canonical[0].fields.metric, 'mrr');

  const validated = validateRecipe({ widgets: canonical }, schema, rows);
  assert.equal(validated.dropped, 0);
  assert.equal(validated.widgets[0].type === 'kpi' && validated.widgets[0].value, '$120');
  assert.equal(validated.widgets[1].type === 'bar' && validated.widgets[1].aggregate, 'sum');
});

test('fallback recipes are deterministic for metric and entity datasets', () => {
  const metricRows: Row[] = [
    { date: '2026-01-01', mrr: 10 },
    { date: '2026-02-01', mrr: 20 },
  ];
  const first = deterministicRecipe(metricRows, inferSchema(metricRows));
  const second = deterministicRecipe(metricRows, inferSchema(metricRows));
  assert.deepEqual(first, second);
  assert.deepEqual(first.widgets.map(widget => widget.type), ['kpi', 'line', 'table']);

  const entityRows: Row[] = [{ name: 'A', status: 'ok' }, { name: 'B', status: 'pending' }];
  const entity = deterministicRecipe(entityRows, inferSchema(entityRows));
  assert.equal(entity.title, 'Entity Overview');
  assert.equal(entity.widgets.at(-1)?.type, 'table');
});

test('table sorting keeps nulls last and applies numeric-aware text ordering', () => {
  const rows: Row[] = [
    { rank: 2, label: 'item 10' },
    { rank: null, label: 'item 1' },
    { rank: 10, label: 'item 2' },
  ];
  const schema = inferSchema(rows);
  assert.deepEqual(
    sortTableRows(rows, schema, { sort: 'rank', order: 'desc', limit: 3 }).map(row => row.rank),
    [10, 2, null],
  );
  assert.deepEqual(
    sortTableRows(rows, schema, { sort: 'label', order: 'asc', limit: 3 }).map(row => row.label),
    ['item 1', 'item 2', 'item 10'],
  );
});

test('widget fingerprints, diffs, and contributing rows preserve selection semantics', () => {
  const widget = {
    type: 'donut' as const,
    span: 6 as const,
    title: 'Revenue by region',
    cat: 'region',
    metric: 'revenue',
    aggregate: 'sum' as const,
    format: 'currency' as const,
  };
  assert.equal(widgetFingerprint(widget), 'donut:region:revenue:sum:currency');
  assert.deepEqual(
    [...diffWidgets([widget], [{ ...widget, aggregate: 'average' }])],
    ['donut:region:revenue:average:currency'],
  );
  const rows: Row[] = [
    { region: 'west', revenue: 10 },
    { region: 'west', revenue: null },
    { region: 'east', revenue: 20 },
  ];
  assert.deepEqual(contributingRows(widget, 'west', rows), [{ region: 'west', revenue: 10 }]);
});

test('recipe payload construction is deterministic and rehydration is global-free', () => {
  const rows: Row[] = [
    { date: '2026-01-01', mrr: 100 },
    { date: '2026-02-01', mrr: 120 },
  ];
  const schema = inferSchema(rows);
  const recipe = deterministicRecipe(rows, schema);
  const generatedAt = '2026-09-10T20:00:00.000Z';
  const payload = buildRecipePayload({ recipe, schema, rows, generatedAt });
  assert.equal(payload.generatedAt, generatedAt);
  assert.equal(payload.rowCount, 2);
  assert.equal(payload.generator, 'Mise v0.6');
  assert.equal(payload.widgets[0].type, 'kpi');

  const imported: DashboardRecipe<unknown> = {
    title: 'Imported',
    widgets: payload.widgets,
  };
  const rehydrated = applyRecipeToRows(imported, rows, schema);
  assert.equal(rehydrated.title, 'Imported');
  assert.ok(rehydrated.widgets.length > 0);
});

test('last-value KPI exclusion remains configurable and only checks real series', () => {
  const values = [10, 11, 9, 10, 10, 11, 9, 1000];
  assert.deepEqual(computeKpiFromValues(values, 'last', 'value'), {
    value: '9',
    delta: -18.181818181818183,
    excludedOutlier: true,
  });
  assert.deepEqual(computeKpiFromValues(values, 'last', 'value', 'auto', {
    excludeOutliers: false,
  }), {
    value: '1k',
    delta: 11011.111111111111,
    excludedOutlier: false,
  });
});
