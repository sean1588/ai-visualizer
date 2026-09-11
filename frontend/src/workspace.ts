import type { RecentDashboard } from './storage';

export interface DashboardBundle {
  kind: 'mise-dashboard-bundle';
  version: 1;
  exportedAt: string;
  dashboard: RecentDashboard;
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('That backup is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('That file is not a Mise dashboard backup.');
  const bundle = parsed as Partial<DashboardBundle>;
  const dashboard = bundle.dashboard as Partial<RecentDashboard> | undefined;
  if (
    bundle.kind !== 'mise-dashboard-bundle'
    || bundle.version !== 1
    || !dashboard
    || !Array.isArray(dashboard.rows)
    || !dashboard.recipe
    || !Array.isArray(dashboard.recipe.widgets)
  ) {
    throw new Error('That file is not a supported Mise dashboard backup.');
  }
  return {
    ...dashboard,
    id: typeof dashboard.id === 'string' ? dashboard.id : `d_${Date.now().toString(36)}`,
    title: typeof dashboard.title === 'string' ? dashboard.title : dashboard.recipe.title || 'Imported dashboard',
    rows: dashboard.rows,
    schema: Array.isArray(dashboard.schema) ? dashboard.schema : [],
    recipe: dashboard.recipe,
    dataSource: dashboard.dataSource || null,
    parseHealth: dashboard.parseHealth || null,
    savedAt: Number.isFinite(dashboard.savedAt) ? Number(dashboard.savedAt) : Date.now(),
    cols: Number.isFinite(dashboard.cols) ? Number(dashboard.cols) : 0,
  };
}
