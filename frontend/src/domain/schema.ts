import { formatCompact } from './formatting.ts';
import { isPlainObject, looksLikeDate } from './parsing.ts';
import type {
  ColumnType,
  IncomingHealth,
  ParseHealth,
  Row,
  SchemaColumn,
} from './types.ts';

export function columnLooksLikeRatio(name: string, values: readonly number[]): boolean {
  if (!values.length || !values.every(value => value >= 0 && value <= 2)) return false;
  const normalized = String(name || '').toLowerCase();
  if (/(pct|percent|percentage|churn|nrr|crr|rate|ratio)/.test(normalized)) return true;
  const allIntegers = values.every(Number.isInteger);
  if (allIntegers && values.every(value => value <= 2)) return false;
  return values.some(value => !Number.isInteger(value));
}

export function inferSchema(rows: readonly Row[]): SchemaColumn[] {
  if (!rows.length) return [];
  return Object.keys(rows[0]).map(name => {
    const values = rows
      .map(row => row[name])
      .filter(value => value !== null && value !== undefined && value !== '');
    let type: ColumnType = 'string';
    if (values.length && values.every(isPlainObject)) type = 'object';
    else if (values.length && values.every(Array.isArray)) type = 'object';
    else if (values.length && values.every(value => typeof value === 'number')) type = 'number';
    else if (values.length && values.every(looksLikeDate)) type = 'date';
    const unique = new Set(values.map(value =>
      isPlainObject(value) || Array.isArray(value) ? JSON.stringify(value) : String(value),
    )).size;
    if (
      type === 'string'
      && unique <= Math.min(20, Math.max(8, Math.ceil(values.length * 0.6)))
    ) {
      type = 'category';
    }
    const numericValues = type === 'number' ? values as number[] : [];
    const asPercent = type === 'number' && columnLooksLikeRatio(name, numericValues);
    let stat: string;
    if (type === 'number') {
      const minimum = Math.min(...numericValues);
      const maximum = Math.max(...numericValues);
      stat = `${formatCompact(minimum, name, 'auto', { rows })} – ${formatCompact(maximum, name, 'auto', { rows })}`;
    } else if (type === 'date') {
      stat = `${String(values[0])} → ${String(values[values.length - 1])}`;
    } else if (type === 'object') {
      stat = 'nested';
    } else {
      stat = `${unique} unique`;
    }
    return { name, type, stat, unique, asPercent };
  });
}

export interface IqrBounds {
  lo: number;
  hi: number;
}

export function iqrBounds(values: readonly number[]): IqrBounds | null {
  if (values.length < 4) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const quantile = (fraction: number): number => {
    const index = (sorted.length - 1) * fraction;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
  };
  const firstQuartile = quantile(0.25);
  const thirdQuartile = quantile(0.75);
  const range = thirdQuartile - firstQuartile;
  return {
    lo: firstQuartile - 1.5 * range,
    hi: thirdQuartile + 1.5 * range,
  };
}

export function buildParseHealth(
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
  incomingHealth: Partial<IncomingHealth> = {},
): ParseHealth {
  const datesUnparsed = schema
    .filter(column => column.type === 'string' || column.type === 'category')
    .reduce((count, column) => {
      const hits = rows.filter(row =>
        row[column.name] != null
        && row[column.name] !== ''
        && looksLikeDate(row[column.name]),
      ).length;
      return count + (hits >= Math.max(2, Math.ceil(rows.length * 0.5)) ? hits : 0);
    }, 0);
  let outlierCount = 0;
  for (const column of schema.filter(item => item.type === 'number')) {
    const values = rows
      .map(row => row[column.name])
      .filter((value): value is number => typeof value === 'number');
    const bounds = iqrBounds(values);
    if (!bounds) continue;
    outlierCount += values.filter(value => value < bounds.lo || value > bounds.hi).length;
  }
  return {
    rowsParsed: incomingHealth.rowsParsed ?? rows.length,
    rowsDropped: incomingHealth.rowsDropped ?? 0,
    datesUnparsed,
    outlierCount,
    format: incomingHealth.format || 'unknown',
  };
}
