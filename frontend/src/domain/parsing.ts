import type { DataAuditEntry, IncomingHealth, Row } from './types.ts';

export interface CsvRecords {
  records: string[][];
  droppedBlank: number;
}

export type IncomingData =
  | { kind: 'recipe'; recipe: Record<string, unknown> }
  | { kind: 'rows'; rows: Row[]; health: IncomingHealth };

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isRecipePayload(value: unknown): value is Record<string, unknown> & { widgets: unknown[] } {
  return isPlainObject(value) && Array.isArray(value.widgets);
}

export function looksLikeDate(value: unknown): boolean {
  const text = String(value).trim();
  return /^\d{4}-\d{2}(-\d{2})?/.test(text)
    || /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text);
}

export function coerceCell(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || typeof value === 'object') return value;
  const text = String(value).trim();
  if (text === '') return null;
  const number = Number(text);
  return !Number.isNaN(number) ? number : text;
}

export function flattenOneLevel(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const flattened: Record<string, unknown> = {};
  for (const [key, cell] of Object.entries(value)) {
    if (cell && typeof cell === 'object' && !Array.isArray(cell)) {
      for (const [nestedKey, nestedValue] of Object.entries(cell)) {
        flattened[`${key}.${nestedKey}`] = nestedValue;
      }
    } else {
      flattened[key] = cell;
    }
  }
  return flattened;
}

export function flattenRows(rows: readonly unknown[]): Row[] {
  return rows.map(row => {
    const flat = flattenOneLevel(row);
    const coerced: Row = {};
    for (const [key, value] of Object.entries(flat as Record<string, unknown>)) {
      coerced[key] = coerceCell(value) as Row[string];
    }
    return coerced;
  });
}

export function parseJsonRecords(value: unknown): Row[] {
  if (Array.isArray(value)) {
    if (!value.length) throw new Error('JSON array is empty — need at least one row.');
    if (typeof value[0] !== 'object' || value[0] === null) {
      throw new Error('JSON array must contain row objects, not primitives.');
    }
    return flattenRows(value);
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      const candidate = value[key];
      if (Array.isArray(candidate) && candidate.length && typeof candidate[0] === 'object') {
        return flattenRows(candidate);
      }
    }
    throw new Error(
      'This looks like a single JSON object, not a table of rows. Mise needs an array of records — or a CSV with a header and at least one data row.',
    );
  }
  throw new Error("JSON parsed but isn't a row array or object.");
}

export function parseCsvRecords(text: string): CsvRecords {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  let index = 0;
  let droppedBlank = 0;

  const pushField = (): void => {
    record.push(field);
    field = '';
  };
  const pushRecord = (): void => {
    const meaningful = record.some(cell => String(cell).trim() !== '');
    if (!meaningful) {
      droppedBlank++;
      record = [];
      return;
    }
    records.push(record);
    record = [];
  };

  while (index < source.length) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index++;
        continue;
      }
      field += character;
      index++;
      continue;
    }
    if (character === '"') {
      quoted = true;
      index++;
      continue;
    }
    if (character === ',') {
      pushField();
      index++;
      continue;
    }
    if (character === '\r') {
      index++;
      continue;
    }
    if (character === '\n') {
      pushField();
      pushRecord();
      index++;
      continue;
    }
    field += character;
    index++;
  }
  pushField();
  if (record.length && record.some(cell => String(cell).trim() !== '')) pushRecord();

  if (quoted) throw new Error('CSV has an unclosed quote — check the last quoted field.');
  return { records, droppedBlank };
}

export function splitCsv(line: string): string[] {
  return parseCsvRecords(line).records[0] || [];
}

export function rowsFromCsvRecords(records: readonly string[][], droppedBlank = 0): {
  rows: Row[];
  dropped: number;
  irregularRows: number;
  audit: DataAuditEntry[];
} {
  if (records.length < 2) throw new Error('Need at least a header row and one data row.');
  const declaredColumns = records[0].length;
  const columnCount = Math.max(declaredColumns, ...records.slice(1).map(cells => cells.length));
  const headers = Array.from({ length: columnCount }, (_, index) =>
    String(records[0][index] || '').trim() || `column_${index + 1}`,
  );
  const rows: Row[] = [];
  let dropped = droppedBlank;
  let irregularRows = 0;

  for (const cells of records.slice(1)) {
    if (cells.every(cell => String(cell).trim() === '')) {
      dropped++;
      continue;
    }
    if (cells.length !== declaredColumns) irregularRows++;
    const row: Row = {};
    headers.forEach((header, index) => {
      row[header] = coerceCell(cells[index]) as Row[string];
    });
    if (Object.values(row).every(value => value === null || value === '')) {
      dropped++;
      continue;
    }
    rows.push(row);
  }
  if (!rows.length) throw new Error('Need at least a header row and one data row.');
  const audit: DataAuditEntry[] = [];
  if (dropped) {
    audit.push({
      action: 'dropped-empty-rows',
      detail: `${dropped} empty row${dropped === 1 ? ' was' : 's were'} ignored during CSV parsing.`,
    });
  }
  if (irregularRows) {
    audit.push({
      action: 'kept-irregular-rows',
      detail: `${irregularRows} row${irregularRows === 1 ? ' had' : 's had'} a different field count; missing cells were kept empty and extra fields were preserved.`,
    });
  }
  return { rows, dropped, irregularRows, audit };
}

export function incomingKind(text: string): IncomingData {
  const trimmed = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new Error('Nothing to parse — paste JSON or CSV.');
  const looksJson = trimmed[0] === '{' || trimmed[0] === '[';
  if (looksJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`That looks like JSON but didn't parse: ${message}`);
    }
    if (isRecipePayload(parsed)) return { kind: 'recipe', recipe: parsed };
    const rows = parseJsonRecords(parsed);
    return {
      kind: 'rows',
      rows,
      health: { rowsParsed: rows.length, rowsDropped: 0, format: 'json' },
    };
  }
  const { records, droppedBlank } = parseCsvRecords(trimmed);
  const { rows, dropped, irregularRows, audit } = rowsFromCsvRecords(records, droppedBlank);
  return {
    kind: 'rows',
    rows,
    health: {
      rowsParsed: rows.length,
      rowsDropped: dropped,
      format: 'csv',
      ...(irregularRows ? { irregularRows } : {}),
      ...(audit.length ? { audit } : {}),
    },
  };
}

export function parseInput(text: string): Row[] {
  const incoming = incomingKind(text);
  if (incoming.kind === 'recipe') {
    throw new Error('That file is a Mise recipe. Drop it on the empty plate to load the layout, then add data.');
  }
  return incoming.rows;
}
