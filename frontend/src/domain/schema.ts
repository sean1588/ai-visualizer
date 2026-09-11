import { formatCompact } from './formatting.ts';
import { isPlainObject, looksLikeDate } from './parsing.ts';
import type {
  ColumnType,
  DataHealthIssue,
  IncomingHealth,
  ParseHealth,
  Row,
  SchemaColumn,
  SchemaOverrides,
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
  const names = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return names.map(name => {
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

export function applySchemaOverrides(
  schema: readonly SchemaColumn[],
  overrides: SchemaOverrides,
): SchemaColumn[] {
  return schema.map(column => {
    const type = overrides[column.name];
    return type
      ? { ...column, type, asPercent: type === 'number' && column.asPercent }
      : column;
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
  const issues: DataHealthIssue[] = [];
  const missingByColumn = schema.map(column => ({
    name: column.name,
    count: rows.filter(row =>
      row[column.name] === null
      || row[column.name] === undefined
      || row[column.name] === ''
    ).length,
  })).filter(item => item.count > 0);
  const missingValues = missingByColumn.reduce((sum, item) => sum + item.count, 0);
  if (incomingHealth.rowsDropped) {
    issues.push({
      id: 'dropped-rows',
      kind: 'dropped-rows',
      severity: 'info',
      title: 'Empty rows ignored',
      detail: `${incomingHealth.rowsDropped} empty row${incomingHealth.rowsDropped === 1 ? ' was' : 's were'} excluded while parsing.`,
      count: incomingHealth.rowsDropped,
      columns: [],
    });
  }
  if (incomingHealth.irregularRows) {
    issues.push({
      id: 'irregular-rows',
      kind: 'irregular-rows',
      severity: 'warning',
      title: 'Irregular CSV rows kept',
      detail: `${incomingHealth.irregularRows} row${incomingHealth.irregularRows === 1 ? ' has' : 's have'} a different field count. Missing cells remain empty and extra fields use generated column names.`,
      count: incomingHealth.irregularRows,
      columns: [],
    });
  }
  if (missingValues) {
    issues.push({
      id: 'missing-values',
      kind: 'missing-values',
      severity: 'warning',
      title: 'Missing values',
      detail: missingByColumn.map(item => `${item.name}: ${item.count}`).join(' · '),
      count: missingValues,
      columns: missingByColumn.map(item => item.name),
    });
  }
  const timeColumn = schema.find(column => column.type === 'date');
  let duplicateTimeKeys = 0;
  if (timeColumn) {
    const counts = new Map<string, number>();
    rows.forEach(row => {
      const value = row[timeColumn.name];
      if (value === null || value === undefined || value === '') return;
      const key = String(value);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    duplicateTimeKeys = [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    if (duplicateTimeKeys) {
      issues.push({
        id: `duplicate-time-${timeColumn.name}`,
        kind: 'duplicate-time-keys',
        severity: 'info',
        title: `Repeated ${timeColumn.name} values`,
        detail: `${duplicateTimeKeys} additional row${duplicateTimeKeys === 1 ? ' shares' : 's share'} a time key. This can be valid for segmented data.`,
        count: duplicateTimeKeys,
        columns: [timeColumn.name],
      });
    }
  }
  const inconsistentDates = schema.flatMap(column => {
    if (column.type !== 'string' && column.type !== 'category') return [];
    const values = rows
      .map(row => row[column.name])
      .filter(value => value !== null && value !== undefined && value !== '');
    const dateLike = values.filter(looksLikeDate).length;
    if (dateLike < 2 || dateLike === values.length) return [];
    return [{ name: column.name, invalid: values.length - dateLike, total: values.length }];
  });
  const datesUnparsed = inconsistentDates.reduce((sum, item) => sum + item.invalid, 0);
  inconsistentDates.forEach(item => {
    issues.push({
      id: `inconsistent-date-${item.name}`,
      kind: 'inconsistent-dates',
      severity: 'warning',
      title: `Mixed date values in ${item.name}`,
      detail: `${item.invalid} of ${item.total} non-empty values do not match the dominant date shape.`,
      count: item.invalid,
      columns: [item.name],
      correction: 'treat-as-date',
    });
  });
  let outlierCount = 0;
  const outliersByColumn: Array<{ name: string; count: number }> = [];
  for (const column of schema.filter(item => item.type === 'number')) {
    const values = rows
      .map(row => row[column.name])
      .filter((value): value is number => typeof value === 'number');
    const bounds = iqrBounds(values);
    if (!bounds) continue;
    const count = values.filter(value => value < bounds.lo || value > bounds.hi).length;
    if (count) outliersByColumn.push({ name: column.name, count });
    outlierCount += count;
  }
  if (outlierCount) {
    issues.push({
      id: 'outliers',
      kind: 'outliers',
      severity: 'info',
      title: 'Statistical outliers',
      detail: outliersByColumn.map(item => `${item.name}: ${item.count}`).join(' · '),
      count: outlierCount,
      columns: outliersByColumn.map(item => item.name),
      correction: 'include-outliers',
    });
  }
  return {
    rowsParsed: incomingHealth.rowsParsed ?? rows.length,
    rowsDropped: incomingHealth.rowsDropped ?? 0,
    irregularRows: incomingHealth.irregularRows,
    audit: incomingHealth.audit,
    datesUnparsed,
    outlierCount,
    missingValues,
    duplicateTimeKeys,
    issues,
    format: incomingHealth.format || 'unknown',
  };
}
