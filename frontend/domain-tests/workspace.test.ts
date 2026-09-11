import assert from 'node:assert/strict';
import test from 'node:test';

import { deterministicRecipe, inferSchema, type Row } from '../src/domain/index.ts';
import { buildDashboardBundle, parseDashboardBundle } from '../src/workspace.ts';

test('dashboard backups preserve browser-local analysis state', () => {
  const rows: Row[] = [
    { month: '2026-01-01', segment: 'Enterprise', revenue: 100 },
    { month: '2026-02-01', segment: 'Enterprise', revenue: 140 },
  ];
  const schema = inferSchema(rows);
  const recipe = deterministicRecipe(rows, schema);
  const bundle = buildDashboardBundle({
    id: 'dashboard-1',
    title: recipe.title,
    rows,
    schema,
    recipe,
    dataSource: null,
    parseHealth: null,
    theme: 'marketing',
    filters: [{ id: 'filter-1', column: 'segment', operator: 'equals', value: 'Enterprise' }],
    savedViews: [{ id: 'view-1', name: 'Enterprise', filters: [{ id: 'filter-1', column: 'segment', operator: 'equals', value: 'Enterprise' }] }],
    kpiGoals: [],
    dashboardNotes: 'Review with finance.',
    savedAt: 1,
    cols: schema.length,
  });
  const restored = parseDashboardBundle(JSON.stringify(bundle));
  assert.equal(restored.id, 'dashboard-1');
  assert.equal(restored.theme, 'marketing');
  assert.equal(restored.filters?.[0].column, 'segment');
  assert.equal(restored.savedViews?.[0].name, 'Enterprise');
  assert.equal(restored.dashboardNotes, 'Review with finance.');
  assert.deepEqual(restored.rows, rows);
});

test('dashboard backup parser rejects unrelated JSON', () => {
  assert.throws(() => parseDashboardBundle('{"rows":[]}'), /not a supported Mise dashboard backup/);
  assert.throws(() => parseDashboardBundle('{nope'), /not valid JSON/);
});
