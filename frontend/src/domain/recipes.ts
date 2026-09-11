import {
  aggregateBy,
  chooseGroupMode,
  metricValues,
} from './aggregation.ts';
import {
  formatCompact,
  formatNumber,
  humanize,
  normalizeFormat,
} from './formatting.ts';
import { iqrBounds } from './schema.ts';
import { normalizeTableFields } from './table.ts';
import type {
  CanonicalWidget,
  DashboardRecipe,
  DataSource,
  GroupAggregate,
  KpiAggregate,
  NumberFormat,
  RecipePayload,
  RenderedWidget,
  Row,
  SchemaColumn,
  WidgetSpan,
} from './types.ts';

const VALID_WIDGET_TYPES = new Set(['kpi', 'line', 'bar', 'donut', 'statlist', 'countbar', 'table']);
const VALID_SPANS = new Set([3, 4, 6, 8, 12]);
const VALID_GROUP_AGGREGATES = new Set(['sum', 'average', 'last']);
const KPI_AGGREGATES = new Set(['last', 'sum', 'average', 'count']);
const COORDINATE_COLUMNS = new Set(['lat', 'latitude', 'lon', 'lng', 'long', 'longitude']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function widgetSpan(value: unknown, type: unknown): WidgetSpan {
  const span = Number(value);
  if (VALID_SPANS.has(span)) return span as WidgetSpan;
  if (type === 'kpi') return 3;
  if (type === 'table') return 12;
  return 6;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function isCoordinateColumn(name: unknown): boolean {
  return COORDINATE_COLUMNS.has(String(name || '').trim().toLowerCase());
}

export function isMeaningfulMetricColumn(column: SchemaColumn | undefined): boolean {
  return column?.type === 'number' && !isCoordinateColumn(column.name);
}

export function hasUsefulChartOpportunity(schema: readonly SchemaColumn[]): boolean {
  return schema.some(isMeaningfulMetricColumn)
    || schema.some(column => column.type === 'category');
}

export function isTableOnlyRecipe(widgets: readonly unknown[]): boolean {
  const rendered = widgets
    .map(asRecord)
    .filter((widget): widget is Record<string, unknown> => !!widget && widget.type !== 'observations');
  return rendered.length > 0 && rendered.every(widget => widget.type === 'table');
}

export function normalizeKpiAggregate(value: unknown, title = ''): KpiAggregate {
  const explicit = String(value || '').toLowerCase();
  if (KPI_AGGREGATES.has(explicit)) return explicit as KpiAggregate;
  const normalizedTitle = String(title || '').toLowerCase();
  if (/\b(total|sum|gross|overall)\b/.test(normalizedTitle)) return 'sum';
  if (/\b(avg|average|mean)\b/.test(normalizedTitle)) return 'average';
  if (/\b(count|records|rows|number of)\b/.test(normalizedTitle)) return 'count';
  return 'last';
}

export function normalizeGroupAggregate(
  value: unknown,
  rows: readonly Row[],
  group: string,
  metric: string,
  schema: readonly SchemaColumn[] = [],
): GroupAggregate {
  const aggregate = String(value || '').toLowerCase();
  return VALID_GROUP_AGGREGATES.has(aggregate)
    ? aggregate as GroupAggregate
    : chooseGroupMode(rows, group, metric, schema);
}

export interface KpiResult {
  value: string;
  delta: number | null;
  excludedOutlier: boolean;
}

export interface KpiOptions {
  excludeOutliers?: boolean;
  rows?: readonly Row[];
  schema?: readonly SchemaColumn[];
}

function kpiLastSeries(values: readonly number[], excludeOutliers = true): { values: number[]; excludedOutlier: boolean } {
  if (!excludeOutliers || values.length < 8) return { values: [...values], excludedOutlier: false };
  const last = values[values.length - 1];
  const restBounds = iqrBounds(values.slice(0, -1));
  if (!restBounds || (last >= restBounds.lo && last <= restBounds.hi)) {
    return { values: [...values], excludedOutlier: false };
  }
  return { values: values.slice(0, -1), excludedOutlier: true };
}

export function computeKpiNumericFromValues(
  values: readonly number[],
  aggregate: KpiAggregate = 'last',
  options: Pick<KpiOptions, 'excludeOutliers'> = {},
): number | null {
  if (!values.length) return null;
  if (aggregate === 'count') return values.length;
  if (aggregate === 'sum') return values.reduce((sum, value) => sum + value, 0);
  if (aggregate === 'average') return values.reduce((sum, value) => sum + value, 0) / values.length;
  const series = kpiLastSeries(values, options.excludeOutliers ?? true).values;
  return series[series.length - 1] ?? null;
}

export function computeKpiNumeric(
  columnName: string,
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
  aggregate: KpiAggregate = 'last',
  options: Pick<KpiOptions, 'excludeOutliers'> = {},
): number | null {
  return computeKpiNumericFromValues(metricValues(columnName, rows, schema), aggregate, options);
}

export function computeKpiFromValues(
  values: readonly number[],
  aggregate: KpiAggregate = 'last',
  columnName?: string,
  format: NumberFormat = 'auto',
  options: KpiOptions = {},
): KpiResult {
  if (!values.length) return { value: '—', delta: null, excludedOutlier: false };
  const render = (value: number): string =>
    formatNumber(value, columnName, format, { rows: options.rows, schema: options.schema });
  if (aggregate === 'count') {
    return { value: render(values.length), delta: null, excludedOutlier: false };
  }
  if (aggregate === 'sum') {
    return {
      value: render(values.reduce((sum, value) => sum + value, 0)),
      delta: null,
      excludedOutlier: false,
    };
  }
  if (aggregate === 'average') {
    return {
      value: render(values.reduce((sum, value) => sum + value, 0) / values.length),
      delta: null,
      excludedOutlier: false,
    };
  }
  const { values: series, excludedOutlier } = kpiLastSeries(values, options.excludeOutliers ?? true);
  const last = series[series.length - 1];
  const previous = series[series.length - 2] ?? last;
  const delta = previous ? ((last - previous) / Math.abs(previous)) * 100 : 0;
  return { value: render(last), delta, excludedOutlier };
}

export function computeKpi(
  columnName: string,
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
  aggregate: KpiAggregate = 'last',
  format: NumberFormat = 'auto',
  options: Pick<KpiOptions, 'excludeOutliers'> = {},
): KpiResult {
  return computeKpiFromValues(
    metricValues(columnName, rows, schema),
    aggregate,
    columnName,
    format,
    { ...options, rows, schema },
  );
}

export function parseAndValidateRecipe(
  raw: string,
  schema: readonly SchemaColumn[],
  rows: readonly Row[],
  options: Pick<KpiOptions, 'excludeOutliers'> = {},
): DashboardRecipe | null {
  if (!raw || typeof raw !== 'string') return null;
  let text = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const object = asRecord(parsed);
  if (!object || !Array.isArray(object.widgets)) return null;

  const columnNames = new Set(schema.map(column => column.name));
  const typeByColumn = new Map(schema.map(column => [column.name, column.type]));
  const isMetric = (name: unknown): name is string =>
    typeof name === 'string'
    && columnNames.has(name)
    && typeByColumn.get(name) === 'number'
    && !isCoordinateColumn(name);
  const isDate = (name: unknown): name is string =>
    typeof name === 'string' && columnNames.has(name) && typeByColumn.get(name) === 'date';
  const isGroup = (name: unknown): name is string =>
    typeof name === 'string' && columnNames.has(name) && typeByColumn.get(name) !== 'number';
  const validated: RenderedWidget[] = [];

  for (const candidate of object.widgets) {
    const widget = asRecord(candidate);
    if (!widget || !VALID_WIDGET_TYPES.has(String(widget.type))) continue;
    const type = String(widget.type);
    const span = widgetSpan(widget.span, type);
    const fields = asRecord(widget.fields) || {};
    if (type === 'kpi' && !isMetric(fields.metric)) continue;
    if (type === 'line' && (!isDate(fields.x) || !isMetric(fields.y))) continue;
    if (type === 'bar' && (!columnNames.has(String(fields.x)) || !isMetric(fields.y))) continue;
    if ((type === 'donut' || type === 'statlist') && (!isGroup(fields.cat) || !isMetric(fields.metric))) continue;
    if (type === 'countbar' && !isGroup(fields.cat)) continue;

    if (type === 'kpi') {
      const metric = fields.metric as string;
      const aggregate = normalizeKpiAggregate(fields.aggregate, stringField(widget.title));
      const computed = computeKpiFromValues(
        metricValues(metric, rows, schema),
        aggregate,
        metric,
        'auto',
        { ...options, rows, schema },
      );
      validated.push({
        type: 'kpi',
        span,
        label: stringField(widget.title) || humanize(metric),
        metric,
        value: computed.value,
        delta: computed.delta,
        aggregate,
        format: normalizeFormat(fields.format),
        rationale: stringField(widget.rationale),
        excludedOutlier: computed.excludedOutlier,
        sparkCol: aggregate === 'last' ? metric : null,
      });
      continue;
    }
    if (type === 'line' || type === 'bar') {
      const x = fields.x as string;
      const y = fields.y as string;
      validated.push({
        type,
        span,
        title: stringField(widget.title) || `${humanize(y)} by ${humanize(x)}`,
        x,
        y,
        aggregate: normalizeGroupAggregate(fields.aggregate, rows, x, y, schema),
        format: normalizeFormat(fields.format),
        rationale: stringField(widget.rationale),
      });
      continue;
    }
    if (type === 'donut' || type === 'statlist') {
      const category = fields.cat as string;
      const metric = fields.metric as string;
      validated.push({
        type,
        span,
        title: stringField(widget.title) || `${humanize(metric)} by ${humanize(category)}`,
        cat: category,
        metric,
        aggregate: normalizeGroupAggregate(fields.aggregate, rows, category, metric, schema),
        format: normalizeFormat(fields.format),
        rationale: stringField(widget.rationale),
      });
      continue;
    }
    if (type === 'countbar') {
      const category = fields.cat as string;
      validated.push({
        type: 'countbar',
        span,
        title: stringField(widget.title) || `Records by ${humanize(category)}`,
        cat: category,
      });
      continue;
    }
    if (type === 'table') {
      validated.push({
        type: 'table',
        span: 12,
        title: stringField(widget.title) || 'Raw rows',
        ...normalizeTableFields(fields, stringField(widget.title), schema),
      });
    }
  }
  if (!validated.length) return null;
  const tables = validated.filter(widget => widget.type === 'table').slice(0, 1);
  const others = validated.filter(widget => widget.type !== 'table');
  const finalWidgets: RenderedWidget[] = [...others, ...tables];
  const rejectedWidgets = Math.max(0, object.widgets.length - finalWidgets.length);
  const observations = Array.isArray(object.observations)
    ? object.observations
      .filter((observation): observation is string =>
        typeof observation === 'string' && !!observation.trim(),
      )
      .slice(0, 3)
    : [];
  if (observations.length) {
    finalWidgets.unshift({ type: 'observations', span: 12, observations });
  }
  const suppliedTitle = typeof object.title === 'string' ? object.title.trim() : '';
  const title = suppliedTitle
    ? suppliedTitle.replace(/^["']|["']$/g, '').slice(0, 60)
    : 'Untitled dashboard';
  return { title, widgets: finalWidgets, ...(rejectedWidgets ? { rejectedWidgets } : {}) };
}

export function deterministicRecipe(
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
): DashboardRecipe {
  const dateColumn = schema.find(column => column.type === 'date');
  const numericColumns = schema.filter(isMeaningfulMetricColumn);
  const categoryColumns = schema.filter(column => column.type === 'category');
  const textColumns = schema.filter(column => column.type === 'string');
  const widgets: RenderedWidget[] = [];

  if (!numericColumns.length) {
    const breakdown = categoryColumns[0]
      || schema.find(column =>
        column.unique > 1
        && column.unique <= Math.max(20, Math.ceil(rows.length * 0.75)),
      );
    const entity = textColumns.find(column => column.unique === rows.length) || schema[0];
    const observations = [
      `${rows.length} records across ${schema.length} columns.`,
      breakdown
        ? `${humanize(breakdown.name)} has ${breakdown.unique} distinct value${breakdown.unique === 1 ? '' : 's'}.`
        : '',
      entity ? `${humanize(entity.name)} appears to identify each record.` : '',
    ].filter(Boolean);
    if (observations.length) {
      widgets.push({ type: 'observations', span: 12, observations: observations.slice(0, 3) });
    }
    if (breakdown) {
      widgets.push({
        type: 'countbar',
        span: 6,
        title: `Records by ${humanize(breakdown.name)}`,
        cat: breakdown.name,
      });
    }
    widgets.push({
      type: 'table',
      span: 12,
      title: 'Rows',
      ...normalizeTableFields({ limit: 10 }, 'Rows', schema),
    });
    return { title: 'Entity Overview', widgets };
  }

  const kpiColumns = numericColumns.slice(0, 4);
  kpiColumns.forEach(column => {
    const values = metricValues(column.name, rows, schema);
    const last = values[values.length - 1] ?? 0;
    const previous = values[values.length - 2] ?? last;
    const delta = previous ? ((last - previous) / Math.abs(previous)) * 100 : 0;
    widgets.push({
      type: 'kpi',
      span: (12 / Math.min(4, kpiColumns.length)) as WidgetSpan,
      label: humanize(column.name),
      metric: column.name,
      value: formatCompact(last),
      delta,
      sparkCol: dateColumn ? column.name : null,
    });
  });

  if (dateColumn && numericColumns.length) {
    widgets.push({
      type: 'line',
      span: numericColumns.length > 1 ? 8 : 12,
      title: `${humanize(numericColumns[0].name)} over time`,
      x: dateColumn.name,
      y: numericColumns[0].name,
    });
    if (numericColumns.length > 1) {
      widgets.push({
        type: 'bar',
        span: 4,
        title: humanize(numericColumns[1].name),
        x: dateColumn.name,
        y: numericColumns[1].name,
      });
    }
  }

  if (categoryColumns.length && numericColumns.length) {
    const category = categoryColumns[0];
    const metric = numericColumns[0];
    const grouped = aggregateBy(rows, category.name, metric.name, undefined, schema);
    if (grouped.length >= 2 && grouped.length <= 12) {
      widgets.push({
        type: 'donut',
        span: 6,
        title: `${humanize(metric.name)} by ${humanize(category.name)}`,
        cat: category.name,
        metric: metric.name,
      });
      widgets.push({
        type: 'statlist',
        span: 6,
        title: `${humanize(category.name)} breakdown`,
        cat: category.name,
        metric: metric.name,
      });
    }
  }

  numericColumns.slice(2, 4).forEach(column => {
    widgets.push({
      type: 'bar',
      span: 6,
      title: humanize(column.name) + (dateColumn ? ' over time' : ''),
      x: dateColumn ? dateColumn.name : (categoryColumns[0]?.name || schema[0].name),
      y: column.name,
    });
  });
  widgets.push({
    type: 'table',
    span: 12,
    title: 'Raw rows',
    ...normalizeTableFields({ limit: 10 }, 'Raw rows', schema),
  });
  return { title: 'Untitled dashboard', widgets };
}

export function inferMetricFromLabel(
  label: unknown,
  schema: readonly SchemaColumn[],
): string | null {
  if (!label) return null;
  const normalized = String(label).toLowerCase().replace(/[^a-z0-9]/g, '');
  const match = schema.find(column =>
    column.type === 'number'
    && humanize(column.name).toLowerCase().replace(/[^a-z0-9]/g, '') === normalized,
  );
  return match?.name || null;
}

export function toCanonicalWidget(
  candidate: unknown,
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
): CanonicalWidget | null {
  const widget = asRecord(candidate);
  if (!widget) return null;
  const type = String(widget.type || '');
  const fields = asRecord(widget.fields) || {};
  const span = widgetSpan(widget.span, type);
  if (type === 'observations') {
    return {
      type: 'observations',
      span: 12,
      title: stringField(widget.title) || 'What stood out',
      observations: Array.isArray(widget.observations)
        ? widget.observations.filter((value): value is string => typeof value === 'string')
        : [],
    };
  }
  if (type === 'kpi') {
    const metric = stringField(fields.metric)
      || stringField(widget.metric)
      || inferMetricFromLabel(widget.label || widget.title, schema);
    if (!metric) return null;
    const aggregate = normalizeKpiAggregate(
      fields.aggregate || widget.aggregate,
      stringField(widget.title || widget.label),
    );
    return {
      type: 'kpi',
      span,
      title: stringField(widget.title || widget.label) || humanize(metric),
      rationale: stringField(widget.rationale),
      fields: {
        metric,
        aggregate,
        format: normalizeFormat(fields.format || widget.format),
        ...(widget.sparkCol ? { spark: String(widget.sparkCol) } : {}),
      },
    };
  }
  if (type === 'line' || type === 'bar') {
    const x = stringField(fields.x) || stringField(widget.x);
    const y = stringField(fields.y) || stringField(widget.y);
    if (!x || !y) return null;
    return {
      type,
      span,
      title: stringField(widget.title) || `${humanize(y)} by ${humanize(x)}`,
      rationale: stringField(widget.rationale),
      fields: {
        x,
        y,
        aggregate: normalizeGroupAggregate(fields.aggregate || widget.aggregate, rows, x, y, schema),
        format: normalizeFormat(fields.format || widget.format),
      },
    };
  }
  if (type === 'donut' || type === 'statlist') {
    const category = stringField(fields.cat) || stringField(widget.cat);
    const metric = stringField(fields.metric) || stringField(widget.metric);
    if (!category || !metric) return null;
    return {
      type,
      span,
      title: stringField(widget.title) || `${humanize(metric)} by ${humanize(category)}`,
      rationale: stringField(widget.rationale),
      fields: {
        cat: category,
        metric,
        aggregate: normalizeGroupAggregate(
          fields.aggregate || widget.aggregate,
          rows,
          category,
          metric,
          schema,
        ),
        format: normalizeFormat(fields.format || widget.format),
      },
    };
  }
  if (type === 'countbar') {
    const category = stringField(fields.cat) || stringField(widget.cat);
    if (!category) return null;
    return {
      type: 'countbar',
      span,
      title: stringField(widget.title) || `Records by ${humanize(category)}`,
      fields: { cat: category },
    };
  }
  if (type === 'table') {
    const tableFields = normalizeTableFields({
      limit: widget.limit || fields.limit,
      sort: widget.sort || fields.sort,
      order: widget.order || fields.order,
    }, stringField(widget.title), schema);
    return {
      type: 'table',
      span: 12,
      title: stringField(widget.title) || 'Raw rows',
      fields: tableFields,
    };
  }
  return null;
}

export function toCanonicalWidgets(
  widgets: readonly unknown[],
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
): CanonicalWidget[] {
  return widgets
    .map(widget => toCanonicalWidget(widget, rows, schema))
    .filter((widget): widget is CanonicalWidget => widget !== null);
}

export function widgetIdentity(widget: unknown): string {
  const record = asRecord(widget);
  if (!record?.type) return '';
  const title = String(record.title || record.label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  return `${String(record.type)}:${title}`;
}

export function repairCanonicalWidgets(
  widgets: readonly unknown[],
  currentWidgets: readonly unknown[],
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
): unknown[] {
  const currentByIdentity = new Map(
    toCanonicalWidgets(currentWidgets, rows, schema).map(widget => [widgetIdentity(widget), widget]),
  );
  return widgets.map(widget => {
    const record = asRecord(widget);
    if (!record) return widget;
    const canonical = toCanonicalWidget(record, rows, schema);
    if (canonical) return canonical;
    const match = currentByIdentity.get(widgetIdentity(record));
    if (!match) return widget;
    return {
      ...match,
      ...record,
      fields: record.fields || ('fields' in match ? match.fields : undefined),
    };
  });
}

export interface ValidatedRecipe {
  widgets: RenderedWidget[];
  dropped: number;
}

export function validateRecipe(
  parsed: unknown,
  schema: readonly SchemaColumn[],
  rows: readonly Row[],
  options: Pick<KpiOptions, 'excludeOutliers'> = {},
): ValidatedRecipe {
  const object = asRecord(parsed);
  const candidates = Array.isArray(object?.widgets) ? object.widgets : [];
  const columnNames = new Set(schema.map(column => column.name));
  const typeByColumn = new Map(schema.map(column => [column.name, column.type]));
  const hasColumn = (name: unknown): name is string =>
    typeof name === 'string' && columnNames.has(name);
  const isNumberColumn = (name: unknown): name is string =>
    hasColumn(name) && typeByColumn.get(name) === 'number';
  const isDateColumn = (name: unknown): name is string =>
    hasColumn(name) && typeByColumn.get(name) === 'date';
  const isGroupColumn = (name: unknown): name is string =>
    hasColumn(name) && typeByColumn.get(name) !== 'number';
  const validTypes = new Set([
    'kpi',
    'line',
    'bar',
    'donut',
    'statlist',
    'countbar',
    'table',
    'observations',
  ]);
  const widgets: RenderedWidget[] = [];
  let dropped = 0;

  for (const candidate of candidates) {
    const widget = asRecord(candidate);
    if (!widget || !validTypes.has(String(widget.type))) {
      dropped++;
      continue;
    }
    const type = String(widget.type);
    const span = widgetSpan(widget.span, type);
    const canonical = toCanonicalWidget(widget, rows, schema);
    const fields = canonical && 'fields' in canonical
      ? canonical.fields as unknown as Record<string, unknown>
      : asRecord(widget.fields) || {};
    if (type === 'kpi') {
      if (!isNumberColumn(fields.metric)) {
        dropped++;
        continue;
      }
      const aggregate = normalizeKpiAggregate(fields.aggregate, stringField(widget.title || canonical?.title));
      const format = normalizeFormat(fields.format);
      const kpi = computeKpi(fields.metric, rows, schema, aggregate, format, options);
      widgets.push({
        type: 'kpi',
        span,
        label: stringField(widget.title || canonical?.title) || humanize(fields.metric),
        title: stringField(widget.title || canonical?.title) || undefined,
        metric: fields.metric,
        value: kpi.value,
        delta: kpi.delta,
        aggregate,
        format,
        rationale: stringField(widget.rationale)
          || (canonical && 'rationale' in canonical ? canonical.rationale || '' : ''),
        excludedOutlier: kpi.excludedOutlier,
        sparkCol: aggregate === 'last' ? fields.metric : null,
      });
    } else if (type === 'line' || type === 'bar') {
      if (!hasColumn(fields.x) || !isNumberColumn(fields.y)) {
        dropped++;
        continue;
      }
      if (type === 'line' && !isDateColumn(fields.x)) {
        dropped++;
        continue;
      }
      widgets.push({
        type,
        span,
        title: stringField(widget.title) || humanize(fields.y),
        x: fields.x,
        y: fields.y,
        aggregate: normalizeGroupAggregate(fields.aggregate, rows, fields.x, fields.y, schema),
        format: normalizeFormat(fields.format),
        rationale: stringField(widget.rationale)
          || (canonical && 'rationale' in canonical ? canonical.rationale || '' : ''),
      });
    } else if (type === 'donut' || type === 'statlist') {
      if (!isGroupColumn(fields.cat) || !isNumberColumn(fields.metric)) {
        dropped++;
        continue;
      }
      widgets.push({
        type,
        span,
        title: stringField(widget.title) || humanize(fields.metric),
        cat: fields.cat,
        metric: fields.metric,
        aggregate: normalizeGroupAggregate(fields.aggregate, rows, fields.cat, fields.metric, schema),
        format: normalizeFormat(fields.format),
        rationale: stringField(widget.rationale)
          || (canonical && 'rationale' in canonical ? canonical.rationale || '' : ''),
      });
    } else if (type === 'countbar') {
      if (!isGroupColumn(fields.cat)) {
        dropped++;
        continue;
      }
      widgets.push({
        type: 'countbar',
        span,
        title: stringField(widget.title) || `Records by ${humanize(fields.cat)}`,
        cat: fields.cat,
      });
    } else if (type === 'table') {
      widgets.push({
        type: 'table',
        span: 12,
        title: stringField(widget.title) || 'Raw rows',
        ...normalizeTableFields(fields, stringField(widget.title || canonical?.title), schema),
      });
    } else if (type === 'observations') {
      const observations = Array.isArray(widget.observations)
        ? widget.observations
          .filter((value): value is string => typeof value === 'string' && !!value.trim())
          .slice(0, 3)
        : [];
      if (!observations.length) {
        dropped++;
        continue;
      }
      widgets.push({
        type: 'observations',
        span: 12,
        title: stringField(widget.title) || 'What we noticed',
        observations,
      });
    }
  }
  const tables = widgets.filter(widget => widget.type === 'table').slice(0, 1);
  const others = widgets.filter(widget => widget.type !== 'table');
  return { widgets: [...others, ...tables], dropped };
}

export function applyRecipeToRows(
  recipe: DashboardRecipe<unknown>,
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
  options: {
    title?: string;
    dataSource?: DataSource | null;
    excludeOutliers?: boolean;
  } = {},
): DashboardRecipe {
  const recipeWidgets = Array.isArray(recipe?.widgets) ? recipe.widgets : [];
  const canonical = toCanonicalWidgets(
    recipeWidgets.filter(widget => asRecord(widget)?.type !== 'observations'),
    rows,
    schema,
  );
  const validated = validateRecipe({ widgets: canonical }, schema, rows, options);
  const widgets = validated.widgets.length
    ? validated.widgets
    : deterministicRecipe(rows, schema).widgets;
  const observations = recipeWidgets
    .map(asRecord)
    .find(widget => widget?.type === 'observations');
  if (observations && Array.isArray(observations.observations) && observations.observations.length) {
    widgets.unshift({
      type: 'observations',
      span: 12,
      observations: observations.observations
        .filter((value): value is string => typeof value === 'string')
        .slice(0, 3),
    });
  }
  return {
    title: recipe?.title || options.title || 'Untitled dashboard',
    widgets,
    fallback: false,
    dataSource: options.dataSource || null,
  };
}

export const rehydrateRecipeForRows = applyRecipeToRows;

export function buildRecipePayload(input: {
  recipe: DashboardRecipe;
  schema: readonly SchemaColumn[];
  rows: readonly Row[];
  dataSource?: DataSource | null;
  generatedAt: string;
}): RecipePayload {
  return {
    title: input.recipe.title,
    schema: input.schema,
    widgets: toCanonicalWidgets(input.recipe.widgets, input.rows, input.schema),
    rowCount: input.rows.length,
    dataSource: input.dataSource || null,
    generatedAt: input.generatedAt,
    generator: 'Mise v0.6',
  };
}
