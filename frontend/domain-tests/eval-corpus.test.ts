import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import {
  buildParseHealth,
  deterministicRecipe,
  incomingKind,
  inferSchema,
  isCoordinateColumn,
} from '../src/domain/index.ts';

interface EvalManifestEntry {
  id: string;
  path: string;
  shape: string;
}

const root = new URL('../../eval-datasets/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')) as EvalManifestEntry[];

for (const entry of manifest) {
  test(`evaluation corpus: ${entry.id}`, () => {
    const startedAt = performance.now();
    const incoming = incomingKind(readFileSync(new URL(entry.path, root), 'utf8'));
    assert.equal(incoming.kind, 'rows');
    if (incoming.kind !== 'rows') return;
    const schema = inferSchema(incoming.rows);
    const health = buildParseHealth(incoming.rows, schema, incoming.health);
    const first = deterministicRecipe(incoming.rows, schema);
    const second = deterministicRecipe(incoming.rows, schema);

    assert.deepEqual(first, second);
    assert.ok(incoming.rows.length > 0);
    assert.ok(schema.length > 0);
    assert.ok(first.widgets.length > 0);
    assert.ok(first.widgets.some(widget => widget.type === 'table'));
    assert.equal(JSON.stringify(first).includes('undefined'), false);
    assert.equal(health.rowsParsed, incoming.rows.length);
    first.widgets.filter(widget => widget.type === 'kpi').forEach(widget => {
      assert.equal(isCoordinateColumn(widget.metric), false);
    });
    if (schema.some(column => column.type === 'date') && schema.some(column => column.type === 'number' && !isCoordinateColumn(column.name))) {
      assert.ok(first.widgets.some(widget => widget.type === 'line' || widget.type === 'bar'));
    }
    assert.ok(performance.now() - startedAt < 2_000, `${entry.id} exceeded the deterministic 2s evaluation budget`);
  });
}
