import { looksLikeDate } from './parsing.ts';
import type {
  AggregatePoint,
  GroupAggregate,
  Row,
  SchemaColumn,
  SeriesPoint,
} from './types.ts';

export function looksLikeLevelMetric(name: string): boolean {
  return /(mrr|arr|nrr|crr|balance|accounts|headcount|price|rate|ratio|stock|aum)/i.test(String(name || ''));
}

export function looksLikeRateMetric(name: string): boolean {
  return /(pct|percent|percentage|churn|nrr|crr|rate|ratio)/i.test(String(name || ''));
}

export function groupKeyIsTime(
  rows: readonly Row[],
  key: string,
  schema: readonly SchemaColumn[] = [],
): boolean {
  if (schema.find(column => column.name === key)?.type === 'date') return true;
  const values = rows.map(row => row[key]).filter(value => value != null && value !== '');
  return values.length > 0 && values.every(looksLikeDate);
}

export function keyCounts(rows: readonly Row[], key: string): Map<string, number> {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const value = String(row[key] ?? '—');
    seen.set(value, (seen.get(value) || 0) + 1);
  }
  return seen;
}

export function chooseGroupMode(
  rows: readonly Row[],
  groupKey: string,
  metricKey: string,
  schema: readonly SchemaColumn[] = [],
): GroupAggregate {
  const repeats = [...keyCounts(rows, groupKey).values()].some(count => count > 1);
  if (repeats && groupKeyIsTime(rows, groupKey, schema)) {
    return looksLikeRateMetric(metricKey) ? 'average' : 'sum';
  }
  return repeats && looksLikeLevelMetric(metricKey) ? 'last' : 'sum';
}

export function groupValues(
  rows: readonly Row[],
  groupKey: string,
  metricKey: string,
  mode?: GroupAggregate,
  schema: readonly SchemaColumn[] = [],
): Map<string, number> {
  const resolved = mode || chooseGroupMode(rows, groupKey, metricKey, schema);
  const values = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[groupKey] ?? '—');
    const value = typeof row[metricKey] === 'number' ? row[metricKey] : 0;
    if (resolved === 'last') {
      values.set(key, value);
    } else {
      values.set(key, (values.get(key) ?? 0) + value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  if (resolved === 'average') {
    for (const [key, sum] of values) values.set(key, sum / (counts.get(key) || 1));
  }
  return values;
}

export function aggregateBy(
  rows: readonly Row[],
  groupKey: string,
  metricKey: string,
  mode?: GroupAggregate,
  schema: readonly SchemaColumn[] = [],
): AggregatePoint[] {
  return [...groupValues(rows, groupKey, metricKey, mode, schema).entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((left, right) => right.value - left.value);
}

export function seriesBy(
  rows: readonly Row[],
  xKey: string,
  yKey: string,
  mode?: GroupAggregate,
  schema: readonly SchemaColumn[] = [],
): SeriesPoint[] {
  const repeats = [...keyCounts(rows, xKey).values()].some(count => count > 1);
  if (!repeats) {
    return rows
      .map(row => ({ x: row[xKey], y: row[yKey] }))
      .filter((point): point is SeriesPoint => typeof point.y === 'number');
  }
  return [...groupValues(rows, xKey, yKey, mode, schema).entries()]
    .map(([x, y]) => ({ x, y }));
}

export function findTimeColumn(
  schema: readonly SchemaColumn[],
  rows: readonly Row[],
): SchemaColumn | null {
  return schema.find(column => column.type === 'date')
    || schema.find(column => groupKeyIsTime(rows, column.name, schema))
    || null;
}

export function metricValues(
  columnName: string,
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
  mode?: GroupAggregate,
): number[] {
  const timeColumn = findTimeColumn(schema, rows);
  if (timeColumn) {
    return seriesBy(rows, timeColumn.name, columnName, mode, schema)
      .map(point => point.y)
      .filter(value => typeof value === 'number');
  }
  return rows
    .map(row => row[columnName])
    .filter((value): value is number => typeof value === 'number');
}

export function countBy(rows: readonly Row[], categoryKey: string): AggregatePoint[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[categoryKey] ?? '—');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((left, right) => right.value - left.value || left.key.localeCompare(right.key));
}
