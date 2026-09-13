import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateBy,
  applyDashboardFilters,
  applySchemaOverrides,
  applyRecipeToRows,
  buildDataProfile,
  buildExecutiveBrief,
  buildFollowUpQuestions,
  buildParseHealth,
  buildRecipePayload,
  captureDatasetSnapshot,
  chooseGroupMode,
  compareDatasets,
  computeKpiFromValues,
  contributingRows,
  deterministicRecipe,
  diffWidgets,
  evaluateAlerts,
  evaluateKpiGoals,
  executiveBriefMarkdown,
  findCorrelations,
  formatCompact,
  formatFull,
  incomingKind,
  inferSchema,
  normalizePublicDataUrl,
  parseAndValidateRecipe,
  parseCsvRecords,
  parseJsonRecords,
  refreshCadence,
  scanSensitiveColumns,
  seriesBy,
  sortTableRows,
  sourceFreshness,
  toCanonicalWidgets,
  validateRecipe,
  widgetFingerprint,
  widgetDisplayOrder,
  type DashboardFilter,
  type DashboardRecipe,
  type KpiGoal,
  type Row,
  type SchemaColumn,
} from '../src/domain/index.ts';
import {
  buildRecipeLink,
  buildStandaloneHtml,
  decodeRecipeFragment,
  encodeRecipeFragment,
} from '../src/sharing.ts';

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
    assert.deepEqual(incoming.health, {
      rowsParsed: 2,
      rowsDropped: 1,
      format: 'csv',
      audit: [{
        action: 'dropped-empty-rows',
        detail: '1 empty row was ignored during CSV parsing.',
      }],
    });
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
  assert.equal(health.datesUnparsed, 2);
  assert.equal(health.outlierCount, 1);
  assert.equal(health.rowsDropped, 2);
  assert.ok(health.issues.some(issue => issue.kind === 'inconsistent-dates'));
  assert.ok(health.issues.some(issue => issue.kind === 'outliers'));
});

test('data health preserves irregular fields and reports missing, duplicate, and ambiguous values', () => {
  const incoming = incomingKind('date,revenue\n2026-01-01,10\n2026-01-01,20,west\nunknown,\n');
  assert.equal(incoming.kind, 'rows');
  if (incoming.kind !== 'rows') return;
  assert.equal(incoming.rows[1].column_3, 'west');
  assert.equal(incoming.health.irregularRows, 1);
  const schema = inferSchema(incoming.rows);
  assert.deepEqual(schema.map(column => column.name), ['date', 'revenue', 'column_3']);
  const health = buildParseHealth(incoming.rows, schema, incoming.health);
  assert.equal(health.missingValues, 3);
  assert.equal(health.duplicateTimeKeys, 0);
  assert.ok(health.issues.some(issue => issue.kind === 'irregular-rows'));
  assert.ok(health.issues.some(issue => issue.kind === 'missing-values'));
  const dateIssue = health.issues.find(issue => issue.kind === 'inconsistent-dates');
  assert.equal(dateIssue?.correction, 'treat-as-date');

  const overridden = applySchemaOverrides(schema, { date: 'date' });
  const corrected = buildParseHealth(incoming.rows, overridden, incoming.health);
  assert.equal(corrected.issues.some(issue => issue.kind === 'inconsistent-dates'), false);
  assert.equal(corrected.duplicateTimeKeys, 1);
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
  assert.equal(recipe.rejectedWidgets, 1);
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

test('recurring snapshots compare KPI values, row counts, and schema drift compactly', () => {
  const previousRows: Row[] = [
    { date: '2026-01-01', revenue: 10, customers: 2, legacy: 'yes' },
    { date: '2026-01-02', revenue: 20, customers: 3, legacy: 'no' },
  ];
  const previousSchema = inferSchema(previousRows);
  const snapshot = captureDatasetSnapshot(previousRows, previousSchema, 1_000);
  assert.equal('rows' in snapshot, false);
  assert.deepEqual(snapshot.metrics.revenue, {
    count: 2,
    sum: 30,
    average: 15,
    last: 20,
  });

  const currentRows: Row[] = [
    { date: '2026-02-01', revenue: 30, customers: 'small', margin: 0.2 },
    { date: '2026-02-02', revenue: 40, customers: 'large', margin: 0.3 },
    { date: '2026-02-03', revenue: 50, customers: 'large', margin: 0.4 },
  ];
  const currentSchema = inferSchema(currentRows);
  const recipe: DashboardRecipe = {
    title: 'Recurring revenue',
    widgets: [{
      type: 'kpi',
      span: 3,
      label: 'Revenue',
      metric: 'revenue',
      value: '120',
      delta: null,
      aggregate: 'sum',
      format: 'currency',
    }],
  };
  const comparison = compareDatasets(snapshot, currentRows, currentSchema, recipe);
  assert.equal(comparison.rowDelta, 1);
  assert.deepEqual(comparison.schema.added, ['margin']);
  assert.deepEqual(comparison.schema.removed, ['legacy']);
  assert.deepEqual(comparison.schema.changed, [{ name: 'customers', before: 'number', after: 'category' }]);
  assert.deepEqual(comparison.kpis[0], {
    fingerprint: 'kpi:revenue:sum:currency:Revenue',
    label: 'Revenue',
    metric: 'revenue',
    aggregate: 'sum',
    format: 'currency',
    previous: 30,
    current: 120,
    absoluteChange: 90,
    percentChange: 300,
  });
});

test('HTTP freshness uses persisted cadence, attempts, and errors', () => {
  const fetchedAt = '2026-09-11T00:00:00.000Z';
  const source = { type: 'http', fetchedAt, refreshMinutes: 15 };
  assert.equal(refreshCadence(source), 15);
  assert.deepEqual(sourceFreshness(source, Date.parse('2026-09-11T00:14:00.000Z')), {
    status: 'fresh',
    fetchedAt: Date.parse(fetchedAt),
    nextRefreshAt: Date.parse('2026-09-11T00:15:00.000Z'),
    error: null,
  });
  assert.equal(sourceFreshness(source, Date.parse('2026-09-11T00:15:00.000Z')).status, 'stale');
  assert.deepEqual(sourceFreshness({
    ...source,
    lastAttemptAt: '2026-09-11T00:16:00.000Z',
    lastError: 'upstream unavailable',
  }, Date.parse('2026-09-11T00:17:00.000Z')), {
    status: 'error',
    fetchedAt: Date.parse(fetchedAt),
    nextRefreshAt: Date.parse('2026-09-11T00:31:00.000Z'),
    error: 'upstream unavailable',
  });
});

test('executive briefs and threshold alerts share deterministic KPI values', () => {
  const rows: Row[] = [
    { month: '2026-01-01', revenue: 40 },
    { month: '2026-02-01', revenue: 60 },
  ];
  const schema = inferSchema(rows);
  const recipe: DashboardRecipe = {
    title: 'Revenue',
    widgets: [{
      type: 'kpi',
      span: 3,
      label: 'Total revenue',
      title: 'Total revenue',
      rationale: 'Total revenue summarizes the period.',
      metric: 'revenue',
      value: '100',
      delta: null,
      aggregate: 'sum',
      format: 'currency',
    }],
  };
  const alerts = evaluateAlerts([{
    id: 'a1',
    widgetFingerprint: widgetFingerprint(recipe.widgets[0]),
    label: 'Total revenue',
    metric: 'revenue',
    aggregate: 'sum',
    operator: 'above',
    threshold: 90,
  }], rows, schema);
  assert.equal(alerts[0].current, 100);
  assert.equal(alerts[0].triggered, true);

  const brief = buildExecutiveBrief(recipe, rows, schema, null, buildParseHealth(rows, schema));
  assert.equal(brief.claims[0].text, 'Total revenue is $100.');
  assert.equal(brief.claims[0].supportingRows, 2);
  assert.match(executiveBriefMarkdown(brief), /supporting rows.*#mise-widget-/);
});

test('public source URLs normalize Google Sheets and GitHub blob links only', () => {
  assert.equal(
    normalizePublicDataUrl('https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=42'),
    'https://docs.google.com/spreadsheets/d/sheet-id/export?format=csv&gid=42',
  );
  assert.equal(
    normalizePublicDataUrl('https://github.com/acme/data/blob/main/report.csv'),
    'https://raw.githubusercontent.com/acme/data/main/report.csv',
  );
  assert.equal(normalizePublicDataUrl('https://example.com/data.csv'), 'https://example.com/data.csv');
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

test('recipe links omit data sources and standalone exports embed an interactive local snapshot', () => {
  const rows: Row[] = [
    { date: '2026-01-01', customer: 'Ada', revenue: 100 },
    { date: '2026-02-01', customer: 'Lin', revenue: 120 },
  ];
  const schema = inferSchema(rows);
  const recipe = deterministicRecipe(rows, schema);
  recipe.widgets.unshift({
    type: 'observations',
    span: 12,
    observations: ['Revenue rose to 120.'],
  });
  const payload = buildRecipePayload({
    recipe,
    schema,
    rows,
    dataSource: { type: 'http', url: 'https://private.example/data.json' },
    generatedAt: '2026-09-11T00:00:00.000Z',
  });
  const fragment = encodeRecipeFragment(payload);
  const link = buildRecipeLink('https://app.example/#old', payload);
  const decoded = decodeRecipeFragment(`#recipe=${fragment}`);
  assert.ok(link.startsWith('https://app.example/#recipe='));
  assert.equal(link.includes('private.example'), false);
  assert.equal(decoded?.title, recipe.title);
  assert.equal(decoded?.widgets.some(widget => (widget as { type?: string }).type === 'observations'), false);

  const html = buildStandaloneHtml({
    title: recipe.title,
    dashboardHtml: '<section id="stage-dash" class="stage is-active"><button data-inspect-widget="kpi:revenue:last:auto:Revenue">View rows</button></section>',
    css: ':root{--bg:#fff}',
    rows,
    schema,
    recipe,
    theme: 'plum',
  });
  assert.match(html, /Interactive snapshot exported from Mise/);
  assert.match(html, /standalone-inspector/);
  assert.match(html, /data-inspect-widget/);
  assert.match(html, /body data-theme="plum"/);
  assert.match(html, /location\.hash==="#embed"/);
  assert.doesNotMatch(html, /private\.example/);
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

test('dashboard focus filters combine text, numeric, and date constraints', () => {
  const rows: Row[] = [
    { date: '2026-01-01', segment: 'Enterprise', revenue: 80 },
    { date: '2026-02-01', segment: 'Enterprise', revenue: 140 },
    { date: '2026-03-01', segment: 'Self serve', revenue: 200 },
  ];
  const schema = inferSchema(rows);
  const filters: DashboardFilter[] = [
    { id: 'segment', column: 'segment', operator: 'equals', value: 'enterprise' },
    { id: 'revenue', column: 'revenue', operator: 'at-least', value: '100' },
    { id: 'date', column: 'date', operator: 'after', value: '2026-02-01' },
  ];
  assert.deepEqual(applyDashboardFilters(rows, filters, schema), [rows[1]]);
  assert.deepEqual(applyDashboardFilters(rows, [], schema), rows);
});

test('workbench goals, privacy scan, relationships, and follow-ups are deterministic', () => {
  const rows: Row[] = [
    { date: '2026-01-01', segment: 'Free', revenue: 10, orders: 2, customer_email: 'ada@example.com' },
    { date: '2026-02-01', segment: 'Pro', revenue: 20, orders: 4, customer_email: 'lin@example.com' },
    { date: '2026-03-01', segment: 'Pro', revenue: 30, orders: 6, customer_email: 'sam@example.com' },
    { date: '2026-04-01', segment: 'Team', revenue: 40, orders: 8, customer_email: 'jo@example.com' },
    { date: '2026-05-01', segment: 'Team', revenue: 50, orders: 10, customer_email: 'max@example.com' },
    { date: '2026-06-01', segment: 'Pro', revenue: 60, orders: 12, customer_email: 'ivy@example.com' },
  ];
  const schema = inferSchema(rows);
  const recipe: DashboardRecipe = {
    title: 'Revenue',
    widgets: [
      { type: 'kpi', span: 3, label: 'Revenue', metric: 'revenue', value: '40', delta: null, aggregate: 'last' },
      { type: 'table', span: 12, title: 'Rows', limit: 10 },
    ],
  };
  const widget = recipe.widgets[0];
  assert.equal(widget.type, 'kpi');
  if (widget.type !== 'kpi') return;
  const goals: KpiGoal[] = [{
    id: 'goal',
    widgetFingerprint: widgetFingerprint(widget),
    label: widget.label,
    metric: widget.metric,
    aggregate: 'last',
    direction: 'at-least',
    target: 35,
  }];
  const evaluation = evaluateKpiGoals(goals, rows, schema)[0];
  assert.equal(evaluation.current, 60);
  assert.equal(evaluation.variance, 25);
  assert.equal(evaluation.met, true);

  const sensitive = scanSensitiveColumns(rows, schema);
  assert.equal(sensitive[0].column, 'customer_email');
  assert.equal(sensitive[0].matchingRows, 6);
  const correlations = findCorrelations(rows, schema);
  assert.deepEqual(correlations[0], {
    left: 'revenue',
    right: 'orders',
    coefficient: 1,
    strength: 'strong',
    observations: 6,
  });
  const questions = buildFollowUpQuestions(recipe, schema);
  assert.deepEqual(questions.map(question => question.id), ['trend', 'segments', 'relationship', 'top-records']);
});

test('focus filters distinguish missing zeroes and compare date calendar days', () => {
  const rows: Row[] = [
    { recorded_at: '2026-01-01T00:00:00Z', amount: null },
    { recorded_at: '2026-01-01T16:30:00Z', amount: 0 },
    { recorded_at: '2026-01-02T00:00:00Z', amount: 4 },
  ];
  const schema: SchemaColumn[] = [
    { name: 'recorded_at', type: 'date', stat: '3 dates', unique: 3, asPercent: false },
    { name: 'amount', type: 'number', stat: '2 values', unique: 2, asPercent: false },
  ];
  assert.deepEqual(applyDashboardFilters(rows, [{ id: 'zero', column: 'amount', operator: 'equals', value: '0' }], schema), [rows[1]]);
  assert.deepEqual(applyDashboardFilters(rows, [{ id: 'day', column: 'recorded_at', operator: 'equals', value: '2026-01-01' }], schema), rows.slice(0, 2));
});

test('goal evaluation shares last-point outlier policy and direction-aware progress', () => {
  const rows = [10, 11, 9, 10, 10, 11, 9, 1000].map(value => ({ value }));
  const schema = inferSchema(rows);
  const base = {
    id: 'goal',
    widgetFingerprint: 'value',
    label: 'Value',
    metric: 'value',
    aggregate: 'last' as const,
    target: 100,
  };
  const excluded = evaluateKpiGoals([{ ...base, direction: 'at-least' }], rows, schema, { excludeOutliers: true })[0];
  const included = evaluateKpiGoals([{ ...base, direction: 'at-least' }], rows, schema, { excludeOutliers: false })[0];
  assert.equal(excluded.current, 9);
  assert.equal(excluded.met, false);
  assert.equal(included.current, 1000);
  assert.equal(included.met, true);
  const atMost = evaluateKpiGoals([{ ...base, direction: 'at-most' }], [{ value: 10 }], schema)[0];
  assert.equal(atMost.met, true);
  assert.equal(atMost.progress, 100);
  const missedAtMost = evaluateKpiGoals([{ ...base, direction: 'at-most' }], [{ value: 150 }], schema)[0];
  assert.equal(missedAtMost.met, false);
  assert.equal(missedAtMost.progress, 50);
  const zeroTarget = evaluateKpiGoals([{ ...base, direction: 'at-least', target: 0 }], [{ value: -1 }], schema)[0];
  assert.equal(zeroTarget.progress, 0);
});

test('widget display order places observations after a leading KPI run', () => {
  assert.deepEqual(
    widgetDisplayOrder([
      { type: 'observations' },
      { type: 'kpi' },
      { type: 'kpi' },
      { type: 'line' },
      { type: 'table' },
    ]),
    [1, 2, 0, 3, 4],
  );
  assert.deepEqual(
    widgetDisplayOrder([
      { type: 'kpi' },
      { type: 'kpi' },
      { type: 'line' },
      { type: 'observations' },
    ]),
    [0, 1, 3, 2],
  );
  assert.deepEqual(
    widgetDisplayOrder([
      { type: 'line' },
      { type: 'observations' },
      { type: 'kpi' },
    ]),
    [0, 1, 2],
  );
  assert.deepEqual(
    widgetDisplayOrder([{ type: 'kpi' }, { type: 'line' }]),
    [0, 1],
  );
  assert.deepEqual(
    widgetDisplayOrder([
      { type: 'kpi' },
      { type: 'observations' },
      { type: 'kpi' },
      { type: 'line' },
    ]),
    [0, 2, 1, 3],
  );
});

test('privacy scan covers complete datasets and normalized camel-case names', () => {
  const rows: Row[] = Array.from({ length: 501 }, (_, index) => ({
    customerEmail: index === 500 ? 'last@example.com' : '',
    secretToken: index === 0 ? 'redacted' : '',
  }));
  const schema = inferSchema(rows);
  const findings = scanSensitiveColumns(rows, schema);
  assert.equal(findings.find(finding => finding.column === 'customerEmail')?.matchingRows, 1);
  assert.equal(findings.find(finding => finding.column === 'secretToken')?.kind, 'credential');
});
