import { metricValues } from './aggregation.ts';
import type {
  DashboardRecipe,
  DataSource,
  KpiAggregate,
  KpiWidget,
  NumberFormat,
  Row,
  SchemaColumn,
} from './types.ts';
import { widgetFingerprint } from './widgets.ts';

export type RefreshCadenceMinutes = 0 | 5 | 15 | 60;
export type SourceFreshnessStatus = 'fresh' | 'stale' | 'error';

export interface SnapshotMetric {
  count: number;
  sum: number;
  average: number;
  last: number;
}

export interface DatasetSnapshot {
  capturedAt: number;
  rowCount: number;
  schema: Array<Pick<SchemaColumn, 'name' | 'type'>>;
  metrics: Record<string, SnapshotMetric>;
}

export interface SchemaTypeChange {
  name: string;
  before: SchemaColumn['type'];
  after: SchemaColumn['type'];
}

export interface SchemaDrift {
  added: string[];
  removed: string[];
  changed: SchemaTypeChange[];
}

export interface KpiComparison {
  fingerprint: string;
  label: string;
  metric: string;
  aggregate: KpiAggregate;
  format: NumberFormat;
  previous: number;
  current: number;
  absoluteChange: number;
  percentChange: number | null;
}

export interface DatasetComparison {
  previousCapturedAt: number;
  rowDelta: number;
  schema: SchemaDrift;
  kpis: KpiComparison[];
}

export interface SourceFreshness {
  status: SourceFreshnessStatus;
  fetchedAt: number | null;
  nextRefreshAt: number | null;
  error: string | null;
}

function metricAggregate(metric: SnapshotMetric, aggregate: KpiAggregate): number {
  if (aggregate === 'count') return metric.count;
  return metric[aggregate];
}

function currentMetric(
  widget: KpiWidget,
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
): number | null {
  const values = metricValues(widget.metric, rows, schema);
  if (!values.length) return null;
  if (widget.aggregate === 'count') return values.length;
  if (widget.aggregate === 'sum') return values.reduce((sum, value) => sum + value, 0);
  if (widget.aggregate === 'average') {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  return values[values.length - 1];
}

export function captureDatasetSnapshot(
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
  capturedAt: number = Date.now(),
): DatasetSnapshot {
  const metrics: Record<string, SnapshotMetric> = {};
  schema.filter(column => column.type === 'number').forEach(column => {
    const values = metricValues(column.name, rows, schema);
    if (!values.length) return;
    const sum = values.reduce((total, value) => total + value, 0);
    metrics[column.name] = {
      count: values.length,
      sum,
      average: sum / values.length,
      last: values[values.length - 1],
    };
  });
  return {
    capturedAt,
    rowCount: rows.length,
    schema: schema.map(column => ({ name: column.name, type: column.type })),
    metrics,
  };
}

export function compareDatasets(
  previous: DatasetSnapshot,
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
  recipe: DashboardRecipe,
): DatasetComparison {
  const previousTypes = new Map(previous.schema.map(column => [column.name, column.type]));
  const currentTypes = new Map(schema.map(column => [column.name, column.type]));
  const added = schema
    .filter(column => !previousTypes.has(column.name))
    .map(column => column.name);
  const removed = previous.schema
    .filter(column => !currentTypes.has(column.name))
    .map(column => column.name);
  const changed = schema.flatMap(column => {
    const before = previousTypes.get(column.name);
    return before && before !== column.type
      ? [{ name: column.name, before, after: column.type }]
      : [];
  });
  const kpis = recipe.widgets.flatMap(widget => {
    if (widget.type !== 'kpi') return [];
    const previousMetric = previous.metrics[widget.metric];
    const current = currentMetric(widget, rows, schema);
    if (!previousMetric || current === null) return [];
    const aggregate = widget.aggregate || 'last';
    const prior = metricAggregate(previousMetric, aggregate);
    const absoluteChange = current - prior;
    return [{
      fingerprint: widgetFingerprint(widget),
      label: widget.label,
      metric: widget.metric,
      aggregate,
      format: widget.format || 'auto',
      previous: prior,
      current,
      absoluteChange,
      percentChange: prior === 0 ? null : (absoluteChange / Math.abs(prior)) * 100,
    }];
  });
  return {
    previousCapturedAt: previous.capturedAt,
    rowDelta: rows.length - previous.rowCount,
    schema: { added, removed, changed },
    kpis,
  };
}

export function refreshCadence(source: DataSource | null): RefreshCadenceMinutes {
  const value = Number(source?.refreshMinutes);
  return value === 5 || value === 15 || value === 60 ? value : 0;
}

function sourceTime(source: DataSource, key: 'fetchedAt' | 'lastAttemptAt'): number | null {
  const value = source[key];
  const timestamp = typeof value === 'string' || typeof value === 'number'
    ? new Date(value).getTime()
    : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function sourceFreshness(
  source: DataSource,
  now: number = Date.now(),
  fallbackFetchedAt: number | null = null,
): SourceFreshness {
  const fetchedAt = sourceTime(source, 'fetchedAt') ?? fallbackFetchedAt;
  const lastAttemptAt = sourceTime(source, 'lastAttemptAt');
  const error = typeof source.lastError === 'string' && source.lastError
    ? source.lastError
    : null;
  const cadence = refreshCadence(source);
  const refreshBase = Math.max(fetchedAt || 0, lastAttemptAt || 0) || null;
  const nextRefreshAt = cadence && refreshBase
    ? refreshBase + cadence * 60_000
    : null;
  const staleAt = fetchedAt === null
    ? null
    : fetchedAt + (cadence || 1440) * 60_000;
  return {
    status: error ? 'error' : staleAt !== null && now >= staleAt ? 'stale' : 'fresh',
    fetchedAt,
    nextRefreshAt,
    error,
  };
}
