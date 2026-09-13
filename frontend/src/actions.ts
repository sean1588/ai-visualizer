import type { WorkbenchTab } from './state';

export type ActionGroup = 'data' | 'export' | 'view' | 'history' | 'analyze';

export interface DashboardAction {
  id: string;
  label: string;
  group: ActionGroup;
  hint?: string;
  shortcut?: string;
  visible: boolean;
  enabled: boolean;
  run: () => void;
  // Legacy DOM id for controls that predate the action table; the default is `action-<id>`.
  elementId?: string;
  attention?: boolean;
}

export interface DashboardActionContext {
  hasRecipe: boolean;
  hasHttpSource: boolean;
  refreshing: boolean;
  historyIndex: number;
  historyLength: number;
  healthIssueCount: number | null;
  alertCount: number;
  triggeredAlerts: number;
  replaceData: () => void;
  refresh: () => void;
  openDataHealth: () => void;
  openAlerts: () => void;
  exportPng: () => void;
  exportHtml: () => void;
  exportRecipe: () => void;
  copyRecipeLink: () => void;
  exportBackup: () => void;
  present: () => void;
  openWorkbench: (tab: WorkbenchTab) => void;
  openChef: () => void;
  undo: () => void;
  redo: () => void;
}

export const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';

export const ACTION_GROUP_LABELS: Record<ActionGroup, string> = {
  data: 'Data',
  export: 'Export',
  view: 'View',
  history: 'History',
  analyze: 'Analyze',
};

export const WORKBENCH_TABS: WorkbenchTab[] = ['focus', 'goals', 'discover', 'brief', 'recipe', 'notes'];

export const WORKBENCH_TAB_LABELS: Record<WorkbenchTab, string> = {
  focus: 'Focus filters',
  goals: 'Goals',
  discover: 'Discover',
  brief: 'Executive brief',
  recipe: 'Recipe',
  notes: 'Notes & backup',
};

export function actionElementId(action: DashboardAction): string {
  return action.elementId ?? `action-${action.id}`;
}

export function buildDashboardActions(ctx: DashboardActionContext): DashboardAction[] {
  const ready = ctx.hasRecipe;
  const hasHistory = ready && ctx.historyLength > 1;
  const flags = ctx.healthIssueCount ?? 0;
  const healthLabel = `Data health · ${flags ? `${flags} flag${flags === 1 ? '' : 's'}` : 'clean'}`;
  return [
    { id: 'replace-data', elementId: 'replace-data-btn', group: 'data', label: 'Replace data', hint: 'Apply new CSV or JSON rows to this dashboard recipe', visible: ready, enabled: ready, run: ctx.replaceData },
    { id: 'refresh', elementId: 'refresh-btn', group: 'data', label: ctx.refreshing ? 'Refreshing…' : 'Refresh data', hint: 'Fetch fresh rows from the saved HTTP source', visible: ready && ctx.hasHttpSource, enabled: !ctx.refreshing, run: ctx.refresh },
    { id: 'data-health', group: 'data', label: healthLabel, hint: 'Review parse warnings, corrections, and the audit trail', visible: ready && ctx.healthIssueCount !== null, enabled: true, run: ctx.openDataHealth, attention: flags > 0 },
    { id: 'alerts', elementId: 'open-alerts', group: 'data', label: `Alerts · ${ctx.triggeredAlerts || ctx.alertCount}`, hint: 'Configure thresholds evaluated after while-open refreshes', visible: ready && ctx.hasHttpSource, enabled: true, run: ctx.openAlerts, attention: ctx.triggeredAlerts > 0 },
    { id: 'export-png', elementId: 'export-btn', group: 'export', label: 'Export PNG', hint: 'Download the dashboard as an image', visible: ready, enabled: ready, run: ctx.exportPng },
    { id: 'export-html', elementId: 'export-html-btn', group: 'export', label: 'Interactive HTML', hint: 'Self-contained file · supports ?embed or #embed mode', visible: ready, enabled: ready, run: ctx.exportHtml },
    { id: 'export-recipe', elementId: 'export-recipe-btn', group: 'export', label: 'Recipe JSON', hint: 'Download the layout recipe as JSON', visible: ready, enabled: ready, run: ctx.exportRecipe },
    { id: 'copy-link', elementId: 'share-recipe-link', group: 'export', label: 'Copy recipe link', hint: 'Recipe-only link · no rows leave the browser', visible: ready, enabled: ready, run: ctx.copyRecipeLink },
    { id: 'backup', group: 'export', label: 'Backup (.mise.json)', hint: 'Rows, recipe, filters, goals, notes, and theme in one file', visible: ready, enabled: ready, run: ctx.exportBackup },
    { id: 'present', elementId: 'presentation-mode', group: 'view', label: 'Present', shortcut: 'P', hint: 'Hide editing chrome for reviews and screen sharing', visible: ready, enabled: ready, run: ctx.present },
    { id: 'analyze', elementId: 'open-workbench', group: 'view', label: 'Analyze', hint: 'Open filters, goals, notes, and the recipe', visible: ready, enabled: ready, run: () => ctx.openWorkbench('focus') },
    { id: 'chef', group: 'view', label: 'Talk to the Chef', shortcut: '/', hint: 'Ask for layout changes in plain language', visible: ready, enabled: ready, run: ctx.openChef },
    { id: 'undo', elementId: 'recipe-undo', group: 'history', label: 'Undo', shortcut: `${MOD_KEY}Z`, hint: 'Step back through recipe revisions', visible: hasHistory, enabled: ctx.historyIndex > 0, run: ctx.undo },
    { id: 'redo', elementId: 'recipe-redo', group: 'history', label: 'Redo', shortcut: `⇧${MOD_KEY}Z`, hint: 'Step forward through recipe revisions', visible: hasHistory, enabled: ctx.historyIndex < ctx.historyLength - 1, run: ctx.redo },
    ...WORKBENCH_TABS.map((tab): DashboardAction => ({
      id: `workbench-${tab}`,
      group: 'analyze',
      label: WORKBENCH_TAB_LABELS[tab],
      hint: 'Opens Analyze',
      visible: ready,
      enabled: ready,
      run: () => ctx.openWorkbench(tab),
    })),
  ];
}
