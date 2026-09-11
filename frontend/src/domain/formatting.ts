import { isPlainObject } from './parsing.ts';
import type { NumberFormat, ObjectCell, Row, SchemaColumn } from './types.ts';

export interface FormatContext {
  rows?: readonly Row[];
  schema?: readonly SchemaColumn[];
}

const VALID_FORMATS = new Set<NumberFormat>(['auto', 'number', 'currency', 'percent']);

export function normalizeFormat(value: unknown): NumberFormat {
  const format = String(value || 'auto').toLowerCase() as NumberFormat;
  return VALID_FORMATS.has(format) ? format : 'auto';
}

export function humanize(value: unknown): string {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\./g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

export function columnPrefersPercent(
  columnName: string | undefined,
  schema: readonly SchemaColumn[] = [],
): boolean {
  return !!schema.find(column => column.name === columnName)?.asPercent;
}

export function columnPrefersCurrency(columnName?: string): boolean {
  return !!(
    columnName
    && /(^|[._])(usd|amount|revenue|mrr|arr|price|cost|fee|fees|payout|net|gross)([._]|$)/i.test(columnName)
  );
}

export function columnUsesRatioScale(
  columnName: string | undefined,
  context: FormatContext = {},
): boolean {
  if (columnName && columnPrefersPercent(columnName, context.schema)) return true;
  const values = (context.rows || [])
    .map(row => columnName ? row[columnName] : undefined)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length > 0 && values.every(value => Math.abs(value) <= 2);
}

export function withCurrencySymbol(value: string): string {
  return value.startsWith('-') ? `-$${value.slice(1)}` : `$${value}`;
}

export function formatScaled(value: number, divisor: number, suffix: string): string {
  return (value / divisor).toFixed(1).replace(/\.0$/, '') + suffix;
}

export function formatCompact(
  value: number,
  columnName?: string,
  requestedFormat: NumberFormat | string = 'auto',
  context: FormatContext = {},
): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const format = normalizeFormat(requestedFormat);
  const isPercent = format === 'percent'
    || (
      format === 'auto'
      && (
        columnPrefersPercent(columnName, context.schema)
        || !!(
          columnName
          && /(pct|percent|churn|nrr|crr|rate|ratio)/i.test(columnName)
          && value >= 0
          && value <= 2
        )
      )
    );
  if (isPercent) {
    const shouldScale = columnUsesRatioScale(columnName, context)
      || (!context.rows && Math.abs(value) <= 2);
    const percent = value * (shouldScale ? 100 : 1);
    const digits = Math.abs(percent) >= 10 ? 1 : 2;
    return percent.toFixed(digits).replace(/\.0+$/, '') + '%';
  }

  const absolute = Math.abs(value);
  let formatted: string;
  if (absolute >= 1e12 || (absolute >= 1e9 && absolute / 1e9 >= 999.95)) {
    formatted = formatScaled(value, 1e12, 'T');
  } else if (absolute >= 1e9) {
    formatted = formatScaled(value, 1e9, 'B');
  } else if (absolute >= 1e6) {
    formatted = formatScaled(value, 1e6, 'M');
  } else if (absolute >= 1e3) {
    formatted = formatScaled(value, 1e3, 'k');
  } else if (absolute >= 100) {
    formatted = value.toFixed(0);
  } else if (Number.isInteger(value)) {
    formatted = String(value);
  } else {
    formatted = value.toFixed(2);
  }
  const isCurrency = format === 'currency' || (format === 'auto' && columnPrefersCurrency(columnName));
  return isCurrency ? withCurrencySymbol(formatted) : formatted;
}

export function formatFull(
  value: unknown,
  columnName?: string,
  requestedFormat: NumberFormat | string = 'auto',
  context: FormatContext = {},
): string | ObjectCell {
  if (isPlainObject(value) || Array.isArray(value)) return value;
  if (typeof value !== 'number') return String(value ?? '—');
  const format = normalizeFormat(requestedFormat);
  if (
    format === 'percent'
    || (
      format === 'auto'
      && (
        columnPrefersPercent(columnName, context.schema)
        || !!(
          columnName
          && /(pct|percent|churn|nrr|crr|rate|ratio)/i.test(columnName)
          && value >= 0
          && value <= 2
        )
      )
    )
  ) {
    return formatCompact(value, columnName, format, context);
  }
  const formatted = Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const isCurrency = format === 'currency' || (format === 'auto' && columnPrefersCurrency(columnName));
  return isCurrency ? withCurrencySymbol(formatted) : formatted;
}

export function formatNumber(
  value: number,
  columnName?: string,
  format: NumberFormat | string = 'auto',
  context: FormatContext = {},
): string {
  return formatCompact(value, columnName, format, context);
}
