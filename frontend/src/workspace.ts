import type {
  DashboardFilter,
  DashboardRecipe,
  DashboardTheme,
  DataAuditEntry,
  DataSource,
  KpiGoal,
  SavedDashboardView,
  SchemaOverrides,
  ThresholdAlert,
} from './domain';
import { applyRecipeToRows } from './domain/recipes';
import { applySchemaOverrides, inferSchema } from './domain/schema';
import { widgetFingerprint } from './domain/widgets';
import type { RecentDashboard } from './storage';

export interface DashboardBundle {
  kind: 'mise-dashboard-bundle';
  version: 1;
  exportedAt: string;
  dashboard: RecentDashboard;
}

const MAX_SOURCE_LENGTH = 25_000_000;
const MAX_ROWS = 100_000;
const MAX_COLUMNS = 200;
const THEMES = new Set<DashboardTheme>(['mise', 'ink', 'ocean', 'plum', 'marketing']);
const FILTER_OPERATORS = new Set(['equals', 'contains', 'at-least', 'at-most', 'after', 'before']);
const KPI_AGGREGATES = new Set(['count', 'sum', 'average', 'last']);
const COLUMN_TYPES = new Set(['string', 'category', 'number', 'date', 'object']);
const WIDGET_TYPES = new Set(['kpi', 'line', 'bar', 'donut', 'statlist', 'countbar', 'table', 'observations']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function shortString(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function safeTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function sanitizeFilter(value: unknown, index: number): DashboardFilter | null {
  if (!isRecord(value)) return null;
  const column = shortString(value.column, 200);
  const filterValue = typeof value.value === 'string' ? value.value.slice(0, 500) : null;
  if (!column || filterValue === null || !FILTER_OPERATORS.has(String(value.operator))) return null;
  return {
    id: shortString(value.id, 100) || `filter_${index}`,
    column,
    operator: value.operator as DashboardFilter['operator'],
    value: filterValue,
  };
}

function sanitizeFilters(value: unknown): DashboardFilter[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((filter, index) => {
    const sanitized = sanitizeFilter(filter, index);
    return sanitized ? [sanitized] : [];
  });
}

function sanitizeViews(value: unknown): SavedDashboardView[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).flatMap((view, index) => {
    if (!isRecord(view)) return [];
    const name = shortString(view.name, 80);
    if (!name) return [];
    return [{
      id: shortString(view.id, 100) || `view_${index}`,
      name,
      filters: sanitizeFilters(view.filters),
    }];
  });
}

function sanitizeGoals(value: unknown): KpiGoal[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((goal, index) => {
    if (!isRecord(goal)) return [];
    const widgetFingerprint = shortString(goal.widgetFingerprint, 500);
    const label = shortString(goal.label, 120);
    const metric = shortString(goal.metric, 200);
    const target = typeof goal.target === 'number' ? goal.target : Number.NaN;
    if (
      !widgetFingerprint
      || !label
      || !metric
      || !Number.isFinite(target)
      || !KPI_AGGREGATES.has(String(goal.aggregate))
      || (goal.direction !== 'at-least' && goal.direction !== 'at-most')
    ) return [];
    return [{
      id: shortString(goal.id, 100) || `goal_${index}`,
      widgetFingerprint,
      label,
      metric,
      aggregate: goal.aggregate as KpiGoal['aggregate'],
      direction: goal.direction,
      target,
    }];
  });
}

function sanitizeAlerts(value: unknown): ThresholdAlert[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((alert, index) => {
    if (!isRecord(alert)) return [];
    const widgetFingerprint = shortString(alert.widgetFingerprint, 500);
    const label = shortString(alert.label, 120);
    const metric = shortString(alert.metric, 200);
    const threshold = typeof alert.threshold === 'number' ? alert.threshold : Number.NaN;
    if (
      !widgetFingerprint
      || !label
      || !metric
      || !Number.isFinite(threshold)
      || !KPI_AGGREGATES.has(String(alert.aggregate))
      || (alert.operator !== 'above' && alert.operator !== 'below')
    ) return [];
    return [{
      id: shortString(alert.id, 100) || `alert_${index}`,
      widgetFingerprint,
      label,
      metric,
      aggregate: alert.aggregate as ThresholdAlert['aggregate'],
      operator: alert.operator,
      threshold,
    }];
  });
}

function sanitizeSchemaOverrides(value: unknown): SchemaOverrides {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([column, type]) =>
    column.length <= 200 && COLUMN_TYPES.has(String(type)) ? [[column, type]] : [],
  )) as SchemaOverrides;
}

function sanitizeAudit(value: unknown): DataAuditEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-100).flatMap(entry => {
    if (!isRecord(entry)) return [];
    const action = shortString(entry.action, 100);
    const detail = shortString(entry.detail, 1000);
    if (!action || !detail) return [];
    return [{ action, detail, ...(typeof entry.at === 'number' && Number.isFinite(entry.at) ? { at: entry.at } : {}) }];
  });
}

function sanitizeDataSource(value: unknown): DataSource | null {
  if (!isRecord(value) || value.type !== 'http' || typeof value.url !== 'string') return null;
  try {
    const url = new URL(value.url);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
    return { type: 'http', url: url.toString(), refreshMinutes: 0 };
  } catch {
    return null;
  }
}

function validWidget(value: unknown): boolean {
  if (!isRecord(value) || !WIDGET_TYPES.has(String(value.type))) return false;
  if (value.type === 'kpi') return typeof value.metric === 'string';
  if (value.type === 'line' || value.type === 'bar') return typeof value.x === 'string' && typeof value.y === 'string';
  if (value.type === 'donut' || value.type === 'statlist') return typeof value.cat === 'string' && typeof value.metric === 'string';
  if (value.type === 'countbar') return typeof value.cat === 'string';
  if (value.type === 'table') return typeof value.limit === 'number' && Number.isFinite(value.limit);
  return Array.isArray(value.observations) && value.observations.every(observation => typeof observation === 'string');
}

function assertRestorableState(dashboard: Record<string, unknown>): void {
  const filters = dashboard.filters;
  if (filters !== undefined) {
    if (!Array.isArray(filters) || filters.length > 50 || sanitizeFilters(filters).length !== filters.length) {
      throw new Error('That backup contains invalid focus filters.');
    }
  }
  const views = dashboard.savedViews;
  if (views !== undefined) {
    if (!Array.isArray(views) || views.length > 30 || sanitizeViews(views).length !== views.length) {
      throw new Error('That backup contains invalid saved views.');
    }
    for (const view of views) {
      if (!isRecord(view) || !Array.isArray(view.filters) || sanitizeFilters(view.filters).length !== view.filters.length) {
        throw new Error('That backup contains invalid saved-view filters.');
      }
    }
  }
  const goals = dashboard.kpiGoals;
  if (goals !== undefined && (!Array.isArray(goals) || goals.length > 50 || sanitizeGoals(goals).length !== goals.length)) {
    throw new Error('That backup contains invalid KPI goals.');
  }
  const alerts = dashboard.alerts;
  if (alerts !== undefined && (!Array.isArray(alerts) || alerts.length > 50 || sanitizeAlerts(alerts).length !== alerts.length)) {
    throw new Error('That backup contains invalid alerts.');
  }
  if (dashboard.dashboardNotes !== undefined && (typeof dashboard.dashboardNotes !== 'string' || dashboard.dashboardNotes.length > 4000)) {
    throw new Error('That backup contains invalid dashboard context.');
  }
  if (dashboard.theme !== undefined && !THEMES.has(dashboard.theme as DashboardTheme)) {
    throw new Error('That backup contains an unsupported theme.');
  }
  if (dashboard.dataSource !== undefined && dashboard.dataSource !== null && !sanitizeDataSource(dashboard.dataSource)) {
    throw new Error('That backup contains an unsupported data source.');
  }
  if (dashboard.schemaOverrides !== undefined) {
    if (!isRecord(dashboard.schemaOverrides) || Object.keys(sanitizeSchemaOverrides(dashboard.schemaOverrides)).length !== Object.keys(dashboard.schemaOverrides).length) {
      throw new Error('That backup contains invalid schema overrides.');
    }
  }
  if (dashboard.dataAudit !== undefined) {
    if (!Array.isArray(dashboard.dataAudit) || dashboard.dataAudit.length > 100 || sanitizeAudit(dashboard.dataAudit).length !== dashboard.dataAudit.length) {
      throw new Error('That backup contains an invalid audit trail.');
    }
  }
  if (!isRecord(dashboard.recipe) || !Array.isArray(dashboard.recipe.widgets) || dashboard.recipe.widgets.length > 100 || !dashboard.recipe.widgets.every(validWidget)) {
    throw new Error('That backup contains an invalid dashboard recipe.');
  }
}

export function buildDashboardBundle(dashboard: RecentDashboard): DashboardBundle {
  return {
    kind: 'mise-dashboard-bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    dashboard,
  };
}

export function parseDashboardBundle(source: string): RecentDashboard {
  if (source.length > MAX_SOURCE_LENGTH) throw new Error('That backup is too large to restore in this browser.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('That backup is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('That file is not a Mise dashboard backup.');
  const bundle = parsed as Partial<DashboardBundle>;
  const dashboard = bundle.dashboard;
  if (
    bundle.kind !== 'mise-dashboard-bundle'
    || bundle.version !== 1
    || !isRecord(dashboard)
    || !Array.isArray(dashboard.rows)
    || !isRecord(dashboard.recipe)
    || !Array.isArray(dashboard.recipe.widgets)
  ) {
    throw new Error('That file is not a supported Mise dashboard backup.');
  }
  if (!dashboard.rows.length) throw new Error('That backup does not contain any rows.');
  if (dashboard.rows.length > MAX_ROWS) throw new Error(`That backup exceeds the ${MAX_ROWS.toLocaleString()} row restore limit.`);
  assertRestorableState(dashboard);
  const rows = dashboard.rows.map(row => {
    if (!isRecord(row)) throw new Error('That backup contains an invalid row.');
    if (Object.keys(row).length > MAX_COLUMNS) throw new Error(`A backup row exceeds the ${MAX_COLUMNS} column restore limit.`);
    return row as RecentDashboard['rows'][number];
  });
  const now = Date.now();
  const recipe: DashboardRecipe = {
    title: shortString(dashboard.recipe.title, 160) || 'Imported dashboard',
    widgets: dashboard.recipe.widgets.slice(0, 100) as DashboardRecipe['widgets'],
  };
  const schemaOverrides = sanitizeSchemaOverrides(dashboard.schemaOverrides);
  const inferredSchema = applySchemaOverrides(inferSchema(rows), schemaOverrides);
  const restoredRecipe = applyRecipeToRows(recipe, rows, inferredSchema, { dataSource: sanitizeDataSource(dashboard.dataSource) });
  const importedFingerprints = recipe.widgets.map(widgetFingerprint);
  const restoredFingerprints = restoredRecipe.widgets.map(widgetFingerprint);
  if (
    importedFingerprints.length !== restoredFingerprints.length
    || importedFingerprints.some((fingerprint, index) => fingerprint !== restoredFingerprints[index])
  ) {
    throw new Error('That backup recipe is not compatible with its saved rows.');
  }
  const theme = THEMES.has(dashboard.theme as DashboardTheme) ? dashboard.theme as DashboardTheme : 'mise';
  return {
    id: shortString(dashboard.id, 100) || `d_${now.toString(36)}`,
    title: shortString(dashboard.title, 160) || shortString(recipe.title, 160) || 'Imported dashboard',
    rows,
    schema: [],
    recipe,
    dataSource: sanitizeDataSource(dashboard.dataSource),
    parseHealth: null,
    schemaOverrides,
    dataAudit: sanitizeAudit(dashboard.dataAudit),
    alerts: sanitizeAlerts(dashboard.alerts),
    theme,
    filters: sanitizeFilters(dashboard.filters),
    savedViews: sanitizeViews(dashboard.savedViews),
    kpiGoals: sanitizeGoals(dashboard.kpiGoals),
    dashboardNotes: typeof dashboard.dashboardNotes === 'string' ? dashboard.dashboardNotes.slice(0, 4000) : '',
    previousSnapshot: null,
    updatedAt: safeTimestamp(dashboard.updatedAt, now),
    savedAt: safeTimestamp(dashboard.savedAt, now),
    cols: 0,
  };
}
