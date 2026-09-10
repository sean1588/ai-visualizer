import { isPlainObject } from './parsing.ts';
import type { Row, SchemaColumn, TableOptions } from './types.ts';

export interface TableFieldInput {
  limit?: unknown;
  sort?: unknown;
  orderBy?: unknown;
  order?: unknown;
  dir?: unknown;
}

export function slugColumn(name: unknown): string {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function findColumnByLabel(
  label: unknown,
  schema: readonly SchemaColumn[],
): SchemaColumn | null {
  const needle = slugColumn(label);
  if (!needle) return null;
  return schema.find(column => slugColumn(column.name) === needle)
    || schema.find(column =>
      needle.includes(slugColumn(column.name)) || slugColumn(column.name).includes(needle),
    )
    || null;
}

export function normalizeTableFields(
  fields: TableFieldInput = {},
  title = '',
  schema: readonly SchemaColumn[] = [],
): TableOptions {
  let limit = Number(fields.limit);
  let sort: unknown = fields.sort || fields.orderBy || null;
  let order = String(fields.order || fields.dir || '').toLowerCase();
  const titleText = String(title || '');
  const topMatch = titleText.match(/top\s+(\d+)/i);
  if (topMatch) limit = Number(topMatch[1]);
  if (!Number.isFinite(limit) || limit <= 0) limit = 10;
  limit = Math.min(500, Math.max(1, Math.round(limit)));
  if (!sort) {
    const byMatch = titleText.match(/\bby\s+(.+?)$/i);
    if (byMatch) {
      const column = findColumnByLabel(byMatch[1], schema);
      if (column) sort = column.name;
    }
  } else {
    const column = findColumnByLabel(sort, schema)
      || schema.find(candidate => candidate.name === sort);
    sort = column?.name || null;
  }
  if (order !== 'asc' && order !== 'desc') {
    order = /bottom|lowest|ascending|\basc\b/i.test(titleText) ? 'asc' : 'desc';
  }
  return sort
    ? { limit, sort: String(sort), order: order as 'asc' | 'desc' }
    : { limit };
}

export function sortTableRows(
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
  options: Partial<TableOptions> = {},
): Row[] {
  const sorted = [...rows];
  if (options.sort) {
    const direction = options.order === 'asc' ? 1 : -1;
    const column = schema.find(candidate => candidate.name === options.sort);
    sorted.sort((left, right) => {
      const leftValue = left[options.sort as string];
      const rightValue = right[options.sort as string];
      if (leftValue == null && rightValue == null) return 0;
      if (leftValue == null) return 1;
      if (rightValue == null) return -1;
      if (
        column?.type === 'number'
        || (typeof leftValue === 'number' && typeof rightValue === 'number')
      ) {
        return ((leftValue as number) - (rightValue as number)) * direction;
      }
      return String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true }) * direction;
    });
  }
  return sorted.slice(0, options.limit || 10);
}

export function csvEscape(value: unknown): string {
  let normalized = value;
  if (isPlainObject(normalized) || Array.isArray(normalized)) {
    try {
      normalized = JSON.stringify(normalized);
    } catch {
      normalized = '{…}';
    }
  }
  const text = normalized == null ? '' : String(normalized);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
