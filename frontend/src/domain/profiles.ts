import { countBy, findTimeColumn, seriesBy } from './aggregation.ts';
import type { Row, SchemaColumn } from './types.ts';

export interface NumericTrendProfile {
  points: number;
  first: number | null;
  last: number | null;
  absoluteChange: number | null;
  percentChange: number | null;
  lowest: number | null;
  highest: number | null;
}

export interface NumericProfile {
  min: number | null;
  max: number | null;
  sum: number | null;
  average: number | null;
  median: number | null;
  trend?: NumericTrendProfile;
}

export type ColumnFact =
  | ({ column: string; type: 'number' } & NumericProfile)
  | {
      column: string;
      type: 'category';
      topValues: Array<{ value: string; count: number }>;
    }
  | {
      column: string;
      type: 'date';
      first: unknown;
      last: unknown;
      unique: number;
    }
  | {
      column: string;
      type: Exclude<SchemaColumn['type'], 'number' | 'category' | 'date'>;
    };

export interface DataProfile {
  rowCount: number;
  columnCount: number;
  timeColumn: string | null;
  columns: Array<{
    name: string;
    type: SchemaColumn['type'];
    unique: number;
    missing: number;
    inferredFormat?: 'percent';
  }>;
  facts: ColumnFact[];
  omittedFactColumns: number;
}

export function profileNumber(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Number(value.toPrecision(6));
}

export function numericProfile(
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
  column: SchemaColumn,
  timeColumn: SchemaColumn | null,
): NumericProfile | null {
  const values = rows
    .map(row => row[column.name])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  const profile: NumericProfile = {
    min: profileNumber(sorted[0]),
    max: profileNumber(sorted[sorted.length - 1]),
    sum: profileNumber(values.reduce((sum, value) => sum + value, 0)),
    average: profileNumber(values.reduce((sum, value) => sum + value, 0) / values.length),
    median: profileNumber(median),
  };
  if (timeColumn) {
    const series = seriesBy(rows, timeColumn.name, column.name, undefined, schema);
    if (series.length > 1) {
      const first = series[0].y;
      const last = series[series.length - 1].y;
      profile.trend = {
        points: series.length,
        first: profileNumber(first),
        last: profileNumber(last),
        absoluteChange: profileNumber(last - first),
        percentChange: first ? profileNumber(((last - first) / Math.abs(first)) * 100) : null,
        lowest: profileNumber(Math.min(...series.map(point => point.y))),
        highest: profileNumber(Math.max(...series.map(point => point.y))),
      };
    }
  }
  return profile;
}

export function buildDataProfile(
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
): DataProfile {
  const timeColumn = findTimeColumn(schema, rows);
  const columns = schema.map(column => ({
    name: column.name,
    type: column.type,
    unique: column.unique,
    missing: rows.length - rows.filter(row =>
      row[column.name] !== null
      && row[column.name] !== undefined
      && row[column.name] !== '',
    ).length,
    ...(column.asPercent ? { inferredFormat: 'percent' as const } : {}),
  }));
  const facts = schema.slice(0, 24).map((column): ColumnFact => {
    if (column.type === 'number') {
      const profile = numericProfile(rows, schema, column, timeColumn);
      return {
        column: column.name,
        type: 'number',
        min: profile?.min ?? null,
        max: profile?.max ?? null,
        sum: profile?.sum ?? null,
        average: profile?.average ?? null,
        median: profile?.median ?? null,
        ...(profile?.trend ? { trend: profile.trend } : {}),
      };
    }
    if (column.type === 'category') {
      return {
        column: column.name,
        type: 'category',
        topValues: countBy(rows, column.name)
          .slice(0, 8)
          .map(item => ({ value: item.key, count: item.value })),
      };
    }
    if (column.type === 'date') {
      const values = rows.map(row => row[column.name]).filter(Boolean);
      return {
        column: column.name,
        type: 'date',
        first: values[0] ?? null,
        last: values[values.length - 1] ?? null,
        unique: new Set(values.map(String)).size,
      };
    }
    return { column: column.name, type: column.type };
  });
  return {
    rowCount: rows.length,
    columnCount: schema.length,
    timeColumn: timeColumn?.name || null,
    columns,
    facts,
    omittedFactColumns: Math.max(0, schema.length - facts.length),
  };
}
