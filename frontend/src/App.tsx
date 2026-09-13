import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
  applyDashboardFilters,
  applySchemaOverrides,
  applyRecipeToRows,
  buildDataProfile,
  buildExecutiveBrief,
  buildParseHealth,
  buildRecipePayload,
  captureDatasetSnapshot,
  compareDatasets,
  computeKpiFromValues,
  contributingRows,
  csvEscape,
  deterministicRecipe,
  diffWidgets,
  evaluateAlerts,
  evaluateKpiGoals,
  flattenRows,
  formatCompact,
  formatFull,
  hasUsefulChartOpportunity,
  humanize,
  incomingKind,
  inferSchema,
  isRecipePayload,
  isTableOnlyRecipe,
  metricValues,
  normalizeTableFields,
  normalizePublicDataUrl,
  parseAndValidateRecipe,
  parseCsvRecords,
  parseInput,
  refreshCadence,
  repairCanonicalWidgets,
  seriesBy,
  sortTableRows,
  sourceFreshness,
  splitCsv,
  validateRecipe,
  widgetFingerprint,
  type DashboardRecipe,
  type DashboardFilter,
  type DashboardTheme,
  type DataAuditEntry,
  type DataHealthIssue,
  type DataSource,
  type DatasetComparison,
  type DatasetSnapshot,
  type NumberFormat,
  type KpiGoal,
  type RenderedWidget,
  type Row,
  type SchemaColumn,
  type SavedDashboardView,
  type TableWidget,
  type ThresholdAlert,
} from './domain';
import { buildDashboardActions, MOD_KEY, type DashboardAction } from './actions';
import AnalysisWorkbench from './AnalysisWorkbench';
import CommandPalette from './CommandPalette';
import DataHealthDialog from './DataHealth';
import ExampleGallery from './ExampleGallery';
import { EXAMPLE_PLATES, type ExamplePlate } from './examples';
import { AlertsDialog } from './InsightsDialogs';
import Menu from './Menu';
import { buildChefPrompt, buildPrompt } from './prompts';
import { complete, fetchRemoteData } from './services';
import { buildRecipeLink, buildStandaloneHtml, decodeRecipeFragment } from './sharing';
import { appReducer, createInitialState, initialSteps, type AppState, type ChefMessage, type LoadingStep, type RecipeRevision, type WorkbenchTab } from './state';
import { clearRecents, loadRecents, migrateLegacyStorage, relativeTime, saveRecent, type RecentDashboard } from './storage';
import { track } from './telemetry';
import WidgetGrid, { InlineRename, type WidgetEditAction } from './WidgetGrid';
import { buildDashboardBundle, parseDashboardBundle } from './workspace';

declare global {
  interface Window {
    html2canvas?: typeof import('html2canvas')['default'];
    reset?: () => void;
    __mise?: Record<string, unknown>;
  }
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

function cloneRecipe(recipe: DashboardRecipe): DashboardRecipe {
  return structuredClone(recipe);
}

function recipeRevision(recipe: DashboardRecipe, label: string): RecipeRevision {
  return { recipe: cloneRecipe(recipe), label, at: Date.now() };
}

function appendRecipeHistory(
  state: AppState,
  recipe: DashboardRecipe,
  label: string,
): Pick<AppState, 'recipeHistory' | 'recipeHistoryIndex'> {
  const previous = state.recipeHistory.slice(0, state.recipeHistoryIndex + 1);
  const recipeHistory = [...previous, recipeRevision(recipe, label)].slice(-20);
  return { recipeHistory, recipeHistoryIndex: recipeHistory.length - 1 };
}

function stampAudit(entries: readonly DataAuditEntry[] = [], at: number = Date.now()): DataAuditEntry[] {
  return entries.map(entry => ({ ...entry, at: entry.at || at }));
}

function hasHttpSource(source: DataSource | null): boolean {
  return source?.type === 'http' && typeof source.url === 'string' && !!source.url;
}

function exportFilename(base: string, extension: string): string {
  const slug = String(base || 'dashboard').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dashboard';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${slug}-${timestamp}.${extension}`;
}

function downloadFile(name: string, blob: Blob): string {
  if (!blob?.size) throw new Error('Export produced an empty file.');
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    anchor.remove();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

function pageCssText(): string {
  return Array.from(document.styleSheets).map(sheet => {
    try {
      return Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n');
    } catch {
      return '';
    }
  }).join('\n');
}

function parseModelObject(raw: string): Record<string, unknown> {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (match) text = match[0];
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid model response.');
  return parsed as Record<string, unknown>;
}

async function planRecipe(rows: Row[], schema: SchemaColumn[], notes: string): Promise<DashboardRecipe> {
  try {
    const raw = await Promise.race([
      complete(buildPrompt(rows, schema, notes), 'plan'),
      new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('timeout')), 55000)),
    ]);
    const recipe = parseAndValidateRecipe(raw, schema, rows);
    if (recipe?.widgets.length && !(isTableOnlyRecipe(recipe.widgets) && hasUsefulChartOpportunity(schema))) return recipe;
    console.warn('[recipe] AI response did not validate, falling back', raw);
  } catch (error) {
    console.warn('[recipe] AI call failed, falling back to deterministic planner:', error instanceof Error ? error.message : error);
  }
  return { ...deterministicRecipe(rows, schema), fallback: true };
}

function tableTransformLabel(widget: TableWidget): string {
  const parts: string[] = [];
  if (widget.sort) parts.push(`sort: ${widget.sort} ${widget.order || 'desc'}`);
  if (widget.limit) parts.push(`limit ${widget.limit}`);
  return parts.join(' · ');
}

function statusLabel(state: AppState): { text: string; saved: boolean } {
  if (state.statusMessage) return { text: state.statusMessage, saved: !state.statusError };
  if (state.refreshing) return { text: 'Refreshing…', saved: false };
  if (hasHttpSource(state.dataSource)) {
    const freshness = sourceFreshness(state.dataSource as DataSource, Date.now(), state.updatedAt);
    if (freshness.status === 'error') return { text: 'Refresh failed', saved: false };
    if (freshness.status === 'stale') return { text: 'Stale · refresh available', saved: false };
  }
  if (state.id && state.updatedAt) return { text: `Saved in this browser · ${relativeTime(state.updatedAt)}`, saved: true };
  return { text: 'Not saved yet', saved: false };
}

function signedCount(value: number, noun: string): string {
  if (value === 0) return `No ${noun} change`;
  return `${value > 0 ? '+' : ''}${value} ${noun}`;
}

function RecurringReportSummary({
  state,
  comparison,
  now,
  onCadence,
}: {
  state: AppState;
  comparison: DatasetComparison | null;
  now: number;
  onCadence: (minutes: number) => void;
}) {
  const isHttp = hasHttpSource(state.dataSource);
  const freshness = isHttp
    ? sourceFreshness(state.dataSource as DataSource, now, state.updatedAt)
    : null;
  const drift = comparison?.schema;
  const driftCount = drift
    ? drift.added.length + drift.removed.length + drift.changed.length
    : 0;
  return (
    <div id="recurring-report" className="recurring-report">
      <div className="source-freshness">
        <div>
          <span className={`freshness-mark ${freshness?.status || 'local'}`} />
          <span className="source-freshness-label">
            {isHttp ? `HTTP source · ${freshness?.status || 'fresh'}` : 'Local dataset'}
          </span>
          <span className="source-freshness-time">
            {freshness?.fetchedAt
              ? `Fetched ${relativeTime(freshness.fetchedAt)}`
              : state.updatedAt ? `Updated ${relativeTime(state.updatedAt)}` : 'Not updated yet'}
          </span>
        </div>
        {isHttp && (
          <label className="refresh-cadence">
            <span>While open</span>
            <select
              id="refresh-cadence"
              value={refreshCadence(state.dataSource)}
              onChange={event => onCadence(Number(event.target.value))}
            >
              <option value="0">Manual</option>
              <option value="5">Every 5 min</option>
              <option value="15">Every 15 min</option>
              <option value="60">Every hour</option>
            </select>
          </label>
        )}
      </div>
      {freshness?.error && <div id="refresh-error" className="source-error">Last refresh failed · {freshness.error}</div>}
      {comparison && (
        <div id="dataset-comparison" className="dataset-comparison">
          <div className="comparison-heading">
            <div><span className="eyebrow eyebrow-accent">Since previous data</span><strong>{relativeTime(comparison.previousCapturedAt)}</strong></div>
            <span className="comparison-row-delta">{signedCount(comparison.rowDelta, 'rows')}</span>
          </div>
          {comparison.kpis.length > 0 && (
            <div className="comparison-kpis">
              {comparison.kpis.map(kpi => (
                <div className="comparison-kpi" key={kpi.fingerprint}>
                  <span>{kpi.label}</span>
                  <strong>{formatCompact(kpi.current, kpi.metric, kpi.format, { rows: state.rows, schema: state.schema })}</strong>
                  <small className={kpi.absoluteChange < 0 ? 'neg' : ''}>
                    {kpi.absoluteChange > 0 ? '+' : ''}
                    {formatCompact(kpi.absoluteChange, kpi.metric, kpi.format, { rows: state.rows, schema: state.schema })}
                    {kpi.percentChange === null ? '' : ` · ${kpi.percentChange > 0 ? '+' : ''}${kpi.percentChange.toFixed(1)}%`}
                  </small>
                </div>
              ))}
            </div>
          )}
          <div className={`schema-drift ${driftCount ? 'has-drift' : ''}`}>
            <span className="schema-drift-label">{driftCount ? `${driftCount} schema change${driftCount === 1 ? '' : 's'}` : 'Schema unchanged'}</span>
            {driftCount > 0 && drift && (
              <span className="schema-drift-detail">
                {[
                  drift.added.length ? `added ${drift.added.join(', ')}` : '',
                  drift.removed.length ? `removed ${drift.removed.join(', ')}` : '',
                  ...drift.changed.map(item => `${item.name}: ${item.before} → ${item.after}`),
                ].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTableValue(value: unknown, column: SchemaColumn, rows: Row[], schema: SchemaColumn[]): string {
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '{…}';
    }
  }
  if (column.type === 'number') return String(formatFull(value, column.name, 'auto', { rows, schema }));
  return String(value ?? '—');
}

function AssumptionsDialog({
  state,
  onClose,
  onApply,
}: {
  state: AppState;
  onClose: () => void;
  onApply: (widget: RenderedWidget) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const index = state.assumptionsWidgetIndex;
  const widget = index === null ? null : state.recipe?.widgets[index] || null;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (widget && dialog && !dialog.open) {
      dialog.showModal();
      window.setTimeout(() => dialog.querySelector<HTMLElement>('select,input')?.focus(), 0);
    }
  }, [widget]);
  if (!widget) return null;
  const numeric = state.schema.filter(column => column.type === 'number' && !/^(lat|latitude|lon|lng|long|longitude)$/i.test(column.name));
  const groups = state.schema.filter(column => column.type !== 'number');
  const dates = state.schema.filter(column => column.type === 'date');
  const optionList = (columns: SchemaColumn[], empty?: string) => (
    <>
      {empty && <option value="">{empty}</option>}
      {columns.map(column => <option key={column.name} value={column.name}>{humanize(column.name)}</option>)}
    </>
  );
  const field = (name: string, label: string, content: React.ReactNode, defaultValue?: string | number) => (
    <label className="assumption-field">
      <span>{label}</span>
      <select name={name} defaultValue={defaultValue}>{content}</select>
    </label>
  );
  const formatOptions = (
    <>
      <option value="auto">Auto</option>
      <option value="number">Number</option>
      <option value="currency">Currency ($)</option>
      <option value="percent">Percent</option>
    </>
  );
  const aggregateOptions = (
    <>
      <option value="sum">Sum</option>
      <option value="average">Average</option>
      <option value="last">Last</option>
    </>
  );
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const type = values.type || widget.type;
    let fields: Record<string, unknown>;
    if (type === 'kpi') fields = { metric: values.metric, aggregate: values.aggregate, format: values.format };
    else if (type === 'line' || type === 'bar') fields = { x: values.group, y: values.metric, aggregate: values.aggregate, format: values.format };
    else if (type === 'donut' || type === 'statlist') fields = { cat: values.group, metric: values.metric, aggregate: values.aggregate, format: values.format };
    else if (type === 'countbar') fields = { cat: values.group };
    else fields = { sort: values.sort, order: values.order, limit: Number(values.limit) || 10 };
    const candidate = {
      type,
      span: widget.span,
      title: widget.title || ('label' in widget ? widget.label : ''),
      rationale: widget.rationale || '',
      fields,
    };
    const validated = validateRecipe({ widgets: [candidate] }, state.schema, state.rows);
    if (validated.widgets[0]) onApply(validated.widgets[0]);
  };
  return (
    <dialog id="assumptions-dialog" className="mise-dialog" ref={dialogRef} onClose={onClose}>
      <form id="assumptions-form" method="dialog" onSubmit={handleSubmit}>
        <div className="dialog-head">
          <div><div className="eyebrow eyebrow-accent">Widget assumptions</div><h2 id="assumptions-title">{widget.title || ('label' in widget ? widget.label : humanize(widget.type))}</h2></div>
          <button id="assumptions-cancel" className="dialog-close" type="button" aria-label="Close" onClick={() => dialogRef.current?.close()}>×</button>
        </div>
        <div className="dialog-body">
          <p className="dialog-copy">These controls update the recipe locally. The Chef is not called.</p>
          <div id="assumptions-fields" className="assumptions-grid" key={widgetFingerprint(widget)}>
            {widget.type === 'kpi' && <>
              {field('metric', 'Metric', optionList(numeric), widget.metric)}
              {field('aggregate', 'Aggregation', <><option value="last">Last</option><option value="sum">Sum</option><option value="average">Average</option><option value="count">Count</option></>, widget.aggregate || 'last')}
              {field('format', 'Display format', formatOptions, widget.format || 'auto')}
            </>}
            {(widget.type === 'line' || widget.type === 'bar') && <>
              {field('type', 'Chart type', <>{state.schema.some(column => column.name === widget.x && column.type === 'date') && <option value="line">Line</option>}<option value="bar">Bar</option></>, widget.type)}
              {field('group', 'X / group field', optionList(widget.type === 'line' ? dates : groups), widget.x)}
              {field('metric', 'Metric', optionList(numeric), widget.y)}
              {field('aggregate', 'Aggregation', aggregateOptions, widget.aggregate)}
              {field('format', 'Display format', formatOptions, widget.format || 'auto')}
            </>}
            {(widget.type === 'donut' || widget.type === 'statlist') && <>
              {field('type', 'Chart type', <><option value="donut">Donut</option><option value="statlist">Ranked list</option></>, widget.type)}
              {field('group', 'Group field', optionList(groups), widget.cat)}
              {field('metric', 'Metric', optionList(numeric), widget.metric)}
              {field('aggregate', 'Aggregation', aggregateOptions, widget.aggregate)}
              {field('format', 'Display format', formatOptions, widget.format || 'auto')}
            </>}
            {widget.type === 'countbar' && field('group', 'Count rows by', optionList(groups), widget.cat)}
            {widget.type === 'table' && <>
              {field('sort', 'Sort field', optionList(state.schema, 'Original row order'), widget.sort || '')}
              {field('order', 'Sort order', <><option value="desc">Descending</option><option value="asc">Ascending</option></>, widget.order || 'desc')}
              <label className="assumption-field"><span>Row limit</span><input name="limit" type="number" min="1" max="100" defaultValue={widget.limit || 10} /></label>
            </>}
          </div>
          <div id="assumptions-error" className="dialog-error" role="alert" />
          <div className="dialog-actions">
            <button id="assumptions-secondary-cancel" type="button" className="btn btn-ghost" onClick={() => dialogRef.current?.close()}>Cancel</button>
            <button type="submit" className="btn btn-primary">Apply assumptions</button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

function InspectorDialog({ state, onClose }: { state: AppState; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<string | null>(null);
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const inspector = state.inspector;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (inspector && dialog && !dialog.open) {
      setQuery('');
      setSort(null);
      setOrder('asc');
      dialog.showModal();
      window.setTimeout(() => dialog.querySelector<HTMLElement>('#inspector-search')?.focus(), 0);
    }
  }, [inspector]);
  const filteredRows = useMemo(() => {
    if (!inspector) return [];
    let rows = [...inspector.rows];
    if (query.trim()) {
      const needle = query.toLowerCase();
      rows = rows.filter(row => state.schema.some(column => String(row[column.name] ?? '').toLowerCase().includes(needle)));
    }
    if (sort) {
      const column = state.schema.find(candidate => candidate.name === sort);
      rows.sort((left, right) => {
        const leftValue = left[sort];
        const rightValue = right[sort];
        const direction = order === 'asc' ? 1 : -1;
        if (column?.type === 'number') return ((Number(leftValue) || 0) - (Number(rightValue) || 0)) * direction;
        return String(leftValue ?? '').localeCompare(String(rightValue ?? ''), undefined, { numeric: true }) * direction;
      });
    }
    return rows;
  }, [inspector, order, query, sort, state.schema]);
  if (!inspector) return null;
  const visible = filteredRows.slice(0, 200);
  const widgetTitle = inspector.widget.title || ('label' in inspector.widget ? inspector.widget.label : 'Widget');
  return (
    <dialog id="inspector-dialog" className="mise-dialog" ref={dialogRef} onClose={onClose}>
      <div className="dialog-head">
        <div><div className="eyebrow eyebrow-accent">Contributing data</div><h2 id="inspector-title">{widgetTitle} · {inspector.selectedValue === null ? 'source rows' : String(inspector.selectedValue)}</h2></div>
        <button id="inspector-close" className="dialog-close" type="button" aria-label="Close" onClick={() => dialogRef.current?.close()}>×</button>
      </div>
      <div className="dialog-body">
        <div className="inspector-toolbar">
          <input id="inspector-search" className="inspector-search" type="search" aria-label="Filter contributing rows" placeholder="Filter these rows…" value={query} onChange={event => setQuery(event.target.value)} />
          <span id="inspector-meta" className="eyebrow">{filteredRows.length} matching row{filteredRows.length === 1 ? '' : 's'}{filteredRows.length > visible.length ? ' · first 200 shown' : ''}</span>
        </div>
        <div className="inspector-table-wrap">
          <table id="inspector-table" className="inspector-table">
            <thead><tr>{state.schema.map(column => <th key={column.name} className={column.type === 'number' ? 'num' : ''}><button type="button" data-inspector-sort={column.name} onClick={() => { if (sort === column.name) setOrder(current => current === 'asc' ? 'desc' : 'asc'); else { setSort(column.name); setOrder('asc'); } }}>{humanize(column.name)}</button></th>)}</tr></thead>
            <tbody>{visible.map((row, rowIndex) => <tr key={rowIndex}>{state.schema.map(column => <td key={column.name} className={column.type === 'number' ? 'num' : ''}>{formatTableValue(row[column.name], column, state.rows, state.schema)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
    </dialog>
  );
}

function App() {
  const [state, dispatch] = useReducer(appReducer, undefined, () => {
    migrateLegacyStorage();
    return createInitialState(loadRecents());
  });
  const stateRef = useRef(state);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const presentationReturnFocus = useRef<HTMLElement | null>(null);
  const statusTimer = useRef<number | null>(null);
  const refreshInFlight = useRef(false);
  const [pasteText, setPasteText] = useState('');
  const [httpUrl, setHttpUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [fileName, setFileName] = useState('no file selected');
  const [chefInput, setChefInput] = useState('');
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const loadLinkedRecipe = () => {
      const linkedRecipe = decodeRecipeFragment(window.location.hash);
      if (!linkedRecipe) return;
      setPasteText('');
      setChefInput('');
      dispatch({
        type: 'patch',
        value: {
          stage: 'empty',
          rows: [],
          schema: [],
          recipe: null,
          id: null,
          dataSource: null,
          parseHealth: null,
          previousSnapshot: null,
          pendingRecipe: linkedRecipe,
          error: `Shared recipe ready: ${linkedRecipe.title || 'untitled'}. Add CSV or JSON data to render it without another AI call.`,
          chefOpen: false,
          chefHistory: [],
          chefWidgetIndex: null,
          recipeHistory: [],
          recipeHistoryIndex: -1,
          alerts: [],
          theme: 'mise',
          alertsOpen: false,
          filters: [],
          savedViews: [],
          kpiGoals: [],
          dashboardNotes: '',
          workbenchOpen: false,
          presentationMode: false,
        },
      });
    };
    loadLinkedRecipe();
    window.addEventListener('hashchange', loadLinkedRecipe);
    return () => window.removeEventListener('hashchange', loadLinkedRecipe);
  }, []);

  useEffect(() => {
    if (state.stage !== 'dash') return;
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [state.stage]);

  useEffect(() => {
    document.body.dataset.theme = state.theme;
  }, [state.theme]);

  useEffect(() => {
    document.body.classList.toggle('presentation-mode', state.presentationMode);
    if (!state.presentationMode) return;
    const focusTimer = window.setTimeout(() => document.getElementById('exit-presentation')?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      window.setTimeout(() => presentationReturnFocus.current?.isConnected && presentationReturnFocus.current.focus(), 0);
    };
  }, [state.presentationMode]);

  const flashStatus = useCallback((message: string, error = false) => {
    if (statusTimer.current) window.clearTimeout(statusTimer.current);
    dispatch({ type: 'patch', value: { statusMessage: message, statusError: error } });
    statusTimer.current = window.setTimeout(() => {
      dispatch({ type: 'patch', value: { statusMessage: null, statusError: false } });
      statusTimer.current = null;
    }, 2200);
  }, []);

  const persistSnapshot = useCallback((snapshot: {
    rows: Row[];
    schema: SchemaColumn[];
    recipe: DashboardRecipe;
    dataSource: DataSource | null;
    parseHealth: AppState['parseHealth'];
    schemaOverrides?: AppState['schemaOverrides'];
    dataAudit?: DataAuditEntry[];
    alerts?: ThresholdAlert[];
    theme?: DashboardTheme;
    filters?: DashboardFilter[];
    savedViews?: SavedDashboardView[];
    kpiGoals?: KpiGoal[];
    dashboardNotes?: string;
    previousSnapshot: DatasetSnapshot | null;
    updatedAt: number;
    id?: string | null;
  }) => {
    const id = snapshot.id || `d_${Date.now().toString(36)}`;
    const recents = saveRecent({
      id,
      title: snapshot.recipe.title,
      rows: snapshot.rows,
      schema: snapshot.schema,
      recipe: snapshot.recipe,
      dataSource: snapshot.dataSource,
      parseHealth: snapshot.parseHealth,
      schemaOverrides: snapshot.schemaOverrides ?? stateRef.current.schemaOverrides,
      dataAudit: snapshot.dataAudit ?? stateRef.current.dataAudit,
      alerts: snapshot.alerts ?? stateRef.current.alerts,
      theme: snapshot.theme ?? stateRef.current.theme,
      filters: snapshot.filters ?? stateRef.current.filters,
      savedViews: snapshot.savedViews ?? stateRef.current.savedViews,
      kpiGoals: snapshot.kpiGoals ?? stateRef.current.kpiGoals,
      dashboardNotes: snapshot.dashboardNotes ?? stateRef.current.dashboardNotes,
      previousSnapshot: snapshot.previousSnapshot,
      updatedAt: snapshot.updatedAt,
      savedAt: Date.now(),
      cols: snapshot.schema.length,
    });
    dispatch({ type: 'patch', value: { id, recents } });
  }, []);

  const reset = useCallback(() => {
    setPasteText('');
    setHttpUrl('');
    setNotes('');
    setFileName('no file selected');
    setChefInput('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (replacementInputRef.current) replacementInputRef.current.value = '';
    dispatch({ type: 'reset', recents: loadRecents() });
  }, []);

  const runPipeline = useCallback(async (
    rawText: string,
    dataSource: DataSource | null = null,
    options: { recipe?: DashboardRecipe<unknown>; notes?: string; source?: 'file' | 'paste' | 'http' | 'example' | 'recipe' } = {},
  ) => {
    let incoming;
    try {
      incoming = incomingKind(rawText);
    } catch (error) {
      dispatch({ type: 'patch', value: { error: error instanceof Error ? error.message : String(error) } });
      return;
    }
    if (incoming.kind === 'recipe') {
      const currentPaste = pasteText.trim();
      if (currentPaste) {
        await runPipeline(currentPaste, null, { recipe: incoming.recipe as unknown as DashboardRecipe<unknown>, notes });
      } else {
        const recipe = incoming.recipe as unknown as DashboardRecipe<unknown>;
        dispatch({ type: 'patch', value: { pendingRecipe: recipe, error: `Recipe loaded: ${recipe.title || 'untitled'}. Drop or paste data to cook it — the AI will not be asked again.` } });
        flashStatus('Recipe ready — add data');
      }
      return;
    }
    const rows = incoming.rows;
    const ingestSource = options.source || (dataSource?.type === 'http' ? 'http' : options.recipe ? 'recipe' : 'paste');
    track('ingest_started', { source: ingestSource });
    dispatch({
      type: 'patch',
      value: {
        stage: 'loading',
        rows,
        sourceText: rawText,
        dataSource,
        notes: options.notes ?? notes,
        error: '',
        chefHistory: [],
        chefOpen: false,
        chefWidgetIndex: null,
        loadingSteps: { ...initialSteps },
        loadingLabel: `data · ${rows.length} rows · ${Object.keys(rows[0]).length} cols`,
      },
    });
    dispatch({ type: 'step', step: 'parse', status: 'active' });
    await wait(80);
    dispatch({ type: 'step', step: 'parse', status: 'done' });
    dispatch({ type: 'step', step: 'infer', status: 'active' });
    const schemaOverrides = {};
    const schema = applySchemaOverrides(inferSchema(rows), schemaOverrides);
    const dataAudit = stampAudit(incoming.health.audit);
    const parseHealth = buildParseHealth(rows, schema, incoming.health);
    await wait(80);
    dispatch({ type: 'patch', value: { schema, parseHealth } });
    dispatch({ type: 'step', step: 'infer', status: 'done' });
    dispatch({ type: 'step', step: 'layout', status: 'active' });
    const preset = options.recipe || stateRef.current.pendingRecipe;
    const recipe = preset
      ? applyRecipeToRows(preset, rows, schema, { dataSource })
      : await planRecipe(rows, schema, options.notes ?? notes);
    const updatedAt = Date.now();
    dispatch({ type: 'step', step: 'layout', status: 'done' });
    dispatch({ type: 'step', step: 'render', status: 'active' });
    await wait(80);
    dispatch({ type: 'step', step: 'render', status: 'done' });
    dispatch({
      type: 'patch',
      value: {
        stage: 'dash',
        rows,
        schema,
        recipe,
        dataSource,
        parseHealth,
        schemaOverrides,
        dataAudit,
        previousSnapshot: null,
        updatedAt,
        pendingRecipe: null,
        id: null,
        changedWidgets: new Set(),
        recipeHistory: [recipeRevision(recipe, 'Initial dashboard')],
        recipeHistoryIndex: 0,
        filters: [],
        savedViews: [],
        kpiGoals: [],
        dashboardNotes: options.notes ?? notes,
        workbenchOpen: false,
        presentationMode: false,
        statusMessage: null,
        statusError: false,
      },
    });
    persistSnapshot({
      rows,
      schema,
      recipe,
      dataSource,
      parseHealth,
      schemaOverrides,
      dataAudit,
      filters: [],
      savedViews: [],
      kpiGoals: [],
      dashboardNotes: options.notes ?? notes,
      previousSnapshot: null,
      updatedAt,
    });
    track('dashboard_rendered', { source: ingestSource, fallback: !!recipe.fallback, widgets: recipe.widgets.length });
  }, [flashStatus, notes, pasteText, persistSnapshot]);

  const openExample = useCallback((example: ExamplePlate) => {
    const text = JSON.stringify(example.rows, null, 2);
    setPasteText(text);
    setNotes(example.noteExample);
    dispatch({ type: 'patch', value: { title: example.title } });
    void runPipeline(text, null, { recipe: example.recipe, notes: example.noteExample, source: 'example' });
  }, [runPipeline]);

  const useExampleNote = useCallback((note: string) => {
    setNotes(note);
    document.getElementById('notes')?.focus();
  }, []);

  const ingestFile = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      let incoming;
      try {
        incoming = incomingKind(text);
      } catch {
        incoming = null;
      }
      if (incoming?.kind === 'recipe') void runPipeline(text);
      else {
        setPasteText(text);
        void runPipeline(text, null, { source: 'file' });
      }
    };
    reader.onerror = () => dispatch({ type: 'patch', value: { error: 'Could not read that file.' } });
    reader.readAsText(file);
  }, [runPipeline]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (stateRef.current.stage !== 'empty') return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const text = event.clipboardData?.getData('text') || '';
      if (text.trim().length >= 10) setPasteText(text);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const commitRecipeChange = useCallback((
    recipe: DashboardRecipe,
    label: string,
    value: Partial<AppState> = {},
  ) => {
    const current = stateRef.current;
    const history = appendRecipeHistory(current, recipe, label);
    dispatch({ type: 'patch', value: { ...value, recipe, ...history } });
    persistSnapshot({
      rows: current.rows,
      schema: current.schema,
      recipe,
      dataSource: current.dataSource,
      parseHealth: current.parseHealth,
      previousSnapshot: current.previousSnapshot,
      updatedAt: current.updatedAt || Date.now(),
      id: current.id,
    });
  }, [persistSnapshot]);

  const retryAi = useCallback(async () => {
    const current = stateRef.current;
    if (!current.rows.length || !current.schema.length) return;
    flashStatus('Asking the model again…');
    const recipe = await planRecipe(current.rows, current.schema, current.notes);
    commitRecipeChange(recipe, 'AI layout retry', { stage: 'dash' });
  }, [commitRecipeChange, flashStatus]);

  const applyDataUpdate = useCallback((rawText: string, dataSource: DataSource | null) => {
    const current = stateRef.current;
    if (!current.recipe || !current.rows.length || !current.schema.length) {
      throw new Error('Open a dashboard before replacing its data.');
    }
    const incoming = incomingKind(rawText);
    if (incoming.kind !== 'rows') throw new Error('Choose CSV or JSON row data, not a recipe.');
    const rows = incoming.rows;
    const schema = applySchemaOverrides(inferSchema(rows), current.schemaOverrides);
    const dataAudit = [
      ...current.dataAudit,
      ...stampAudit(incoming.health.audit),
    ];
    const parseHealth = buildParseHealth(rows, schema, incoming.health);
    const previousSnapshot = captureDatasetSnapshot(
      current.rows,
      current.schema,
      current.updatedAt || Date.now(),
    );
    const recipe = applyRecipeToRows(current.recipe, rows, schema, {
      dataSource,
      excludeOutliers: current.excludeOutliers,
    });
    const updatedAt = Date.now();
    dispatch({
      type: 'patch',
      value: {
        rows,
        schema,
        recipe,
        dataSource,
        sourceText: rawText,
        parseHealth,
        dataAudit,
        previousSnapshot,
        updatedAt,
        statusMessage: null,
        statusError: false,
        chefHistory: [],
        chefWidgetIndex: null,
        recipeHistory: [recipeRevision(recipe, 'Data replaced')],
        recipeHistoryIndex: 0,
      },
    });
    persistSnapshot({
      rows,
      schema,
      recipe,
      dataSource,
      parseHealth,
      schemaOverrides: current.schemaOverrides,
      dataAudit,
      previousSnapshot,
      updatedAt,
      id: current.id,
    });
    setClock(updatedAt);
    return {
      rowCount: rows.length,
      triggeredAlerts: evaluateAlerts(current.alerts, rows, schema).filter(alert => alert.triggered).length,
    };
  }, [persistSnapshot]);

  const runHttp = useCallback(async () => {
    const url = normalizePublicDataUrl(httpUrl);
    if (!url) {
      dispatch({ type: 'patch', value: { error: 'Enter an HTTP or HTTPS URL to fetch.' } });
      return;
    }
    try {
      flashStatus('Fetching data…');
      const fetched = await fetchRemoteData(url);
      setPasteText(fetched.text);
      setHttpUrl(fetched.finalUrl);
      const fetchedAt = new Date().toISOString();
      await runPipeline(fetched.text, {
        type: 'http',
        url: fetched.finalUrl,
        contentType: fetched.contentType,
        fetchedAt,
        lastAttemptAt: fetchedAt,
        lastError: null,
        refreshMinutes: 0,
      });
    } catch (error) {
      dispatch({ type: 'patch', value: { error: `Could not fetch URL: ${error instanceof Error ? error.message : String(error)}` } });
      flashStatus('Fetch failed', true);
    }
  }, [flashStatus, httpUrl, runPipeline]);

  const refreshDashboard = useCallback(async () => {
    const current = stateRef.current;
    if (!hasHttpSource(current.dataSource) || !current.recipe || refreshInFlight.current) return;
    refreshInFlight.current = true;
    dispatch({ type: 'patch', value: { refreshing: true } });
    try {
      flashStatus('Refreshing data…');
      const fetched = await fetchRemoteData(String(current.dataSource?.url));
      const attemptedAt = new Date().toISOString();
      const dataSource: DataSource = {
        ...current.dataSource,
        type: 'http',
        url: fetched.finalUrl,
        contentType: fetched.contentType,
        fetchedAt: attemptedAt,
        lastAttemptAt: attemptedAt,
        lastError: null,
      };
      const result = applyDataUpdate(fetched.text, dataSource);
      track('recurring_refresh', { result: 'success', triggered: result.triggeredAlerts > 0 });
      flashStatus(result.triggeredAlerts ? `${result.triggeredAlerts} threshold alert${result.triggeredAlerts === 1 ? '' : 's'} triggered` : `Refreshed ${result.rowCount} rows`, result.triggeredAlerts > 0);
    } catch (error) {
      console.warn('[refresh] failed', error);
      const latest = stateRef.current;
      const message = error instanceof Error ? error.message : String(error);
      const dataSource: DataSource = {
        ...(latest.dataSource || current.dataSource),
        type: 'http',
        lastAttemptAt: new Date().toISOString(),
        lastError: message,
      };
      dispatch({ type: 'patch', value: { dataSource } });
      persistSnapshot({
        rows: latest.rows,
        schema: latest.schema,
        recipe: latest.recipe as DashboardRecipe,
        dataSource,
        parseHealth: latest.parseHealth,
        previousSnapshot: latest.previousSnapshot,
        updatedAt: latest.updatedAt || Date.now(),
        id: latest.id,
      });
      track('recurring_refresh', { result: 'error', triggered: false });
      flashStatus('Refresh failed', true);
    } finally {
      refreshInFlight.current = false;
      dispatch({ type: 'patch', value: { refreshing: false } });
      setClock(Date.now());
    }
  }, [applyDataUpdate, flashStatus, persistSnapshot]);

  const replaceDashboardData = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      try {
        const result = applyDataUpdate(text, null);
        setPasteText(text);
        flashStatus(`Replaced data · ${result.rowCount} rows`);
      } catch (error) {
        flashStatus(error instanceof Error ? error.message : 'Could not replace data', true);
      } finally {
        if (replacementInputRef.current) replacementInputRef.current.value = '';
      }
    };
    reader.onerror = () => flashStatus('Could not read that file', true);
    reader.readAsText(file);
  }, [applyDataUpdate, flashStatus]);

  const setRefreshCadence = useCallback((minutes: number) => {
    const current = stateRef.current;
    if (!hasHttpSource(current.dataSource) || !current.recipe) return;
    const refreshMinutes = minutes === 5 || minutes === 15 || minutes === 60 ? minutes : 0;
    const dataSource: DataSource = { ...current.dataSource, type: 'http', refreshMinutes };
    dispatch({ type: 'patch', value: { dataSource } });
    persistSnapshot({
      rows: current.rows,
      schema: current.schema,
      recipe: current.recipe,
      dataSource,
      parseHealth: current.parseHealth,
      previousSnapshot: current.previousSnapshot,
      updatedAt: current.updatedAt || Date.now(),
      id: current.id,
    });
    setClock(Date.now());
    flashStatus(refreshMinutes ? `Auto-refresh every ${refreshMinutes} min` : 'Auto-refresh off');
  }, [flashStatus, persistSnapshot]);

  useEffect(() => {
    if (state.stage !== 'dash' || state.refreshing || !hasHttpSource(state.dataSource)) return;
    const freshness = sourceFreshness(state.dataSource as DataSource, Date.now(), state.updatedAt);
    if (!freshness.nextRefreshAt) return;
    const delay = Math.max(1000, freshness.nextRefreshAt - Date.now());
    const timer = window.setTimeout(() => void refreshDashboard(), delay);
    return () => window.clearTimeout(timer);
  }, [refreshDashboard, state.dataSource, state.refreshing, state.stage, state.updatedAt]);

  const exportRecipe = useCallback(() => {
    const current = stateRef.current;
    if (!current.recipe) return;
    try {
      const payload = buildRecipePayload({
        recipe: current.recipe,
        schema: current.schema,
        rows: current.rows,
        dataSource: current.dataSource,
        generatedAt: new Date().toISOString(),
      });
      downloadFile(exportFilename(current.recipe.title, 'recipe.json'), new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      track('export_created', { type: 'recipe' });
      flashStatus('Recipe exported');
    } catch (error) {
      flashStatus(error instanceof Error ? error.message : 'Recipe export failed', true);
    }
  }, [flashStatus]);

  const copyRecipeLink = useCallback(async () => {
    const current = stateRef.current;
    if (!current.recipe) return;
    try {
      const payload = buildRecipePayload({
        recipe: current.recipe,
        schema: current.schema,
        rows: current.rows,
        dataSource: null,
        generatedAt: new Date().toISOString(),
      });
      const link = buildRecipeLink(`${window.location.origin}${window.location.pathname}`, payload);
      await navigator.clipboard.writeText(link);
      track('export_created', { type: 'link' });
      flashStatus('Recipe link copied');
    } catch (error) {
      flashStatus(error instanceof Error ? error.message : 'Could not copy recipe link', true);
    }
  }, [flashStatus]);

  const exportStandalone = useCallback(() => {
    const current = stateRef.current;
    const dashboard = document.getElementById('stage-dash');
    if (!current.recipe || !dashboard) return;
    try {
      const clone = dashboard.cloneNode(true) as HTMLElement;
      clone.classList.add('is-active');
      clone.querySelector('#recurring-report')?.remove();
      clone.querySelector('.dash-actions')?.remove();
      clone.querySelector('.recipe-history')?.remove();
      clone.querySelectorAll('.widget-action,.assumption-chip,.widget-edit,.widget-menu,.widget-drag-handle,.table-export-btn,.retry-ai-btn,#data-health-btn').forEach(element => element.remove());
      const html = buildStandaloneHtml({
        title: current.recipe.title,
        dashboardHtml: clone.outerHTML,
        css: pageCssText(),
        rows: applyDashboardFilters(current.rows, current.filters, current.schema),
        schema: current.schema,
        recipe: current.recipe,
        theme: current.theme,
      });
      downloadFile(exportFilename(current.recipe.title, 'html'), new Blob([html], { type: 'text/html;charset=utf-8' }));
      track('export_created', { type: 'html' });
      flashStatus('Interactive HTML exported');
    } catch (error) {
      flashStatus(error instanceof Error ? error.message : 'HTML export failed', true);
    }
  }, [flashStatus]);

  const exportPng = useCallback(async () => {
    const current = stateRef.current;
    if (!current.recipe) return;
    const dashboard = document.getElementById('stage-dash');
    if (!dashboard) return;
    try {
      const renderer = window.html2canvas || (await import('html2canvas')).default;
      const canvas = await renderer(dashboard, {
        backgroundColor: getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#f5f2ec',
        scale: Math.min(2, window.devicePixelRatio || 1),
        useCORS: true,
        logging: false,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: dashboard.scrollHeight,
      });
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encode failed')), 'image/png');
      });
      downloadFile(exportFilename(current.recipe.title, 'png'), blob);
      track('export_created', { type: 'png' });
      flashStatus('PNG exported');
    } catch (error) {
      console.warn('[export] PNG export failed', error);
      flashStatus(error instanceof Error ? error.message : 'Export failed', true);
    }
  }, [flashStatus]);

  const exportTable = useCallback((widget: TableWidget) => {
    const current = stateRef.current;
    const focused = applyDashboardFilters(current.rows, current.filters, current.schema);
    const rows = sortTableRows(focused, current.schema, widget);
    const header = current.schema.map(column => csvEscape(column.name)).join(',');
    const body = rows.map(row => current.schema.map(column => csvEscape(row[column.name])).join(',')).join('\n');
    downloadFile(exportFilename('table', 'csv'), new Blob([`${header}\n${body}\n`], { type: 'text/csv;charset=utf-8' }));
    track('export_created', { type: 'csv' });
    flashStatus('CSV exported');
  }, [flashStatus]);

  const copyTable = useCallback(async (widget: TableWidget) => {
    const current = stateRef.current;
    const focused = applyDashboardFilters(current.rows, current.filters, current.schema);
    const rows = sortTableRows(focused, current.schema, widget);
    const header = `| ${current.schema.map(column => humanize(column.name)).join(' | ')} |`;
    const separator = `| ${current.schema.map(() => '---').join(' | ')} |`;
    const body = rows.map(row => `| ${current.schema.map(column => {
      const value = row[column.name];
      return value && typeof value === 'object' ? '{…}' : String(value ?? '');
    }).join(' | ')} |`).join('\n');
    try {
      await navigator.clipboard.writeText([header, separator, body].join('\n'));
      track('export_created', { type: 'markdown' });
      flashStatus('Copied markdown');
    } catch {
      flashStatus('Copy failed', true);
    }
  }, [flashStatus]);

  const applyAssumption = useCallback((widget: RenderedWidget) => {
    const current = stateRef.current;
    const index = current.assumptionsWidgetIndex;
    if (!current.recipe || index === null) return;
    const recipe = { ...current.recipe, widgets: current.recipe.widgets.map((candidate, candidateIndex) => candidateIndex === index ? widget : candidate) };
    commitRecipeChange(recipe, `Updated ${widget.title || ('label' in widget ? widget.label : humanize(widget.type))}`, { assumptionsWidgetIndex: null });
    track('assumption_edited', { widgetType: widget.type });
    flashStatus('Assumptions updated');
  }, [commitRecipeChange, flashStatus]);

  const editWidget = useCallback((index: number, action: WidgetEditAction, payload?: string) => {
    const current = stateRef.current;
    if (!current.recipe) return;
    const widgets = [...current.recipe.widgets];
    const widget = widgets[index];
    if (!widget) return;
    const title = widget.title || ('label' in widget ? widget.label : humanize(widget.type));
    let label = `Edited ${title}`;
    if (action === 'rename') {
      const next = payload?.trim() || '';
      if (!next || next === title) return;
      widgets[index] = widget.type === 'kpi' ? { ...widget, title: next, label: next } : { ...widget, title: next };
      label = `Renamed ${title} to ${next}`;
    } else if (action === 'move-to') {
      const destination = Number(payload);
      if (!Number.isInteger(destination) || destination < 0 || destination >= widgets.length || destination === index) return;
      const [moved] = widgets.splice(index, 1);
      widgets.splice(destination, 0, moved);
      label = `Moved ${title}`;
    } else if (action === 'move-up' || action === 'move-down') {
      const destination = index + (action === 'move-up' ? -1 : 1);
      if (destination < 0 || destination >= widgets.length) return;
      [widgets[index], widgets[destination]] = [widgets[destination], widgets[index]];
      label = `Moved ${title}`;
    } else if (action === 'resize') {
      if (widget.type === 'table' || widget.type === 'observations') return;
      const spans = [3, 4, 6, 8, 12] as const;
      const spanIndex = spans.indexOf(widget.span as typeof spans[number]);
      const span = spans[(spanIndex + 1) % spans.length];
      widgets[index] = { ...widget, span } as RenderedWidget;
      label = `Resized ${title} to ${span}/12`;
    } else if (action === 'duplicate') {
      const duplicate = cloneRecipe({ title: '', widgets: [widget] }).widgets[0];
      if ('label' in duplicate) duplicate.label = `${title} copy`;
      duplicate.title = `${title} copy`;
      widgets.splice(index + 1, 0, duplicate);
      label = `Duplicated ${title}`;
    } else {
      if (widgets.length === 1) {
        flashStatus('A dashboard needs at least one widget', true);
        return;
      }
      widgets.splice(index, 1);
      label = `Removed ${title}`;
    }
    const recipe = { ...current.recipe, widgets };
    commitRecipeChange(recipe, label, { changedWidgets: new Set(widgets.map(widgetFingerprint)) });
    track('direct_edit', { action });
    window.setTimeout(() => dispatch({ type: 'patch', value: { changedWidgets: new Set() } }), 1200);
    flashStatus(label);
  }, [commitRecipeChange, flashStatus]);

  const renameDashboard = useCallback((title: string) => {
    const current = stateRef.current;
    if (!current.recipe) return;
    const next = title.trim();
    if (!next || next === current.recipe.title) return;
    const label = `Renamed ${current.recipe.title} to ${next}`;
    commitRecipeChange({ ...current.recipe, title: next }, label);
    flashStatus(label);
  }, [commitRecipeChange, flashStatus]);

  const navigateRecipeHistory = useCallback((offset: -1 | 1) => {
    const current = stateRef.current;
    if (!current.recipe) return;
    const index = current.recipeHistoryIndex + offset;
    const revision = current.recipeHistory[index];
    if (!revision) return;
    const recipe = cloneRecipe(revision.recipe);
    dispatch({
      type: 'patch',
      value: {
        recipe,
        recipeHistoryIndex: index,
        changedWidgets: new Set(recipe.widgets.map(widgetFingerprint)),
      },
    });
    persistSnapshot({
      rows: current.rows,
      schema: current.schema,
      recipe,
      dataSource: current.dataSource,
      parseHealth: current.parseHealth,
      previousSnapshot: current.previousSnapshot,
      updatedAt: current.updatedAt || Date.now(),
      id: current.id,
    });
    window.setTimeout(() => dispatch({ type: 'patch', value: { changedWidgets: new Set() } }), 1200);
    flashStatus(`${offset < 0 ? 'Undo' : 'Redo'} · ${revision.label}`);
  }, [flashStatus, persistSnapshot]);

  const openChefForWidget = useCallback((index: number) => {
    dispatch({ type: 'patch', value: { chefOpen: true, chefWidgetIndex: index } });
    window.setTimeout(() => document.getElementById('chef-input')?.focus(), 0);
  }, []);

  const openChef = useCallback(() => {
    dispatch({ type: 'patch', value: { chefOpen: true, chefWidgetIndex: null } });
    window.setTimeout(() => document.getElementById('chef-input')?.focus(), 0);
  }, []);

  const openWorkbench = useCallback((tab: WorkbenchTab) => {
    dispatch({ type: 'patch', value: { workbenchOpen: true, workbenchTab: tab } });
  }, []);

  const togglePresentation = useCallback(() => {
    const current = stateRef.current;
    if (!current.recipe) return;
    if (!current.presentationMode) {
      presentationReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    dispatch({ type: 'patch', value: { presentationMode: !current.presentationMode } });
  }, []);

  const updateAlerts = useCallback((alerts: ThresholdAlert[]) => {
    const current = stateRef.current;
    if (!current.recipe) return;
    dispatch({ type: 'patch', value: { alerts } });
    persistSnapshot({
      rows: current.rows,
      schema: current.schema,
      recipe: current.recipe,
      dataSource: current.dataSource,
      parseHealth: current.parseHealth,
      alerts,
      previousSnapshot: current.previousSnapshot,
      updatedAt: current.updatedAt || Date.now(),
      id: current.id,
    });
  }, [persistSnapshot]);

  const setDashboardTheme = useCallback((theme: DashboardTheme) => {
    const current = stateRef.current;
    if (!current.recipe) return;
    dispatch({ type: 'patch', value: { theme } });
    persistSnapshot({
      rows: current.rows,
      schema: current.schema,
      recipe: current.recipe,
      dataSource: current.dataSource,
      parseHealth: current.parseHealth,
      theme,
      previousSnapshot: current.previousSnapshot,
      updatedAt: current.updatedAt || Date.now(),
      id: current.id,
    });
    flashStatus(`${theme === 'mise' ? 'Mise' : humanize(theme)} theme applied`);
  }, [flashStatus, persistSnapshot]);

  const updateWorkbench = useCallback((value: Partial<Pick<AppState, 'filters' | 'savedViews' | 'kpiGoals' | 'dashboardNotes'>>) => {
    const current = stateRef.current;
    if (!current.recipe) return;
    dispatch({ type: 'patch', value });
    persistSnapshot({
      rows: current.rows,
      schema: current.schema,
      recipe: current.recipe,
      dataSource: current.dataSource,
      parseHealth: current.parseHealth,
      previousSnapshot: current.previousSnapshot,
      updatedAt: current.updatedAt || Date.now(),
      id: current.id,
      ...value,
    });
  }, [persistSnapshot]);

  const copyExecutiveBrief = useCallback(async (markdown: string) => {
    try {
      await navigator.clipboard.writeText(markdown);
      track('export_created', { type: 'brief' });
      flashStatus('Executive brief copied');
    } catch {
      flashStatus('Could not copy brief', true);
    }
  }, [flashStatus]);

  const updateHealthIssue = useCallback((issue: DataHealthIssue, correct: boolean) => {
    const current = stateRef.current;
    if (!current.recipe || !current.parseHealth) return;
    let schemaOverrides = current.schemaOverrides;
    let schema = current.schema;
    let excludeOutliers = current.excludeOutliers;
    let action = 'acknowledged-health-warning';
    let detail = `${issue.title}: ${issue.detail}`;
    if (correct && issue.correction === 'treat-as-date' && issue.columns[0]) {
      schemaOverrides = { ...current.schemaOverrides, [issue.columns[0]]: 'date' };
      schema = applySchemaOverrides(inferSchema(current.rows), schemaOverrides);
      action = 'schema-override';
      detail = `Treat ${issue.columns[0]} as a date column.`;
    } else if (correct && issue.correction === 'include-outliers') {
      excludeOutliers = false;
      action = 'outlier-override';
      detail = 'Include statistical outliers in KPI calculations.';
    }
    const dataAudit = [...current.dataAudit, { at: Date.now(), action, detail }];
    const parseHealth = buildParseHealth(current.rows, schema, current.parseHealth);
    const recipe = applyRecipeToRows(current.recipe, current.rows, schema, {
      dataSource: current.dataSource,
      excludeOutliers,
    });
    dispatch({
      type: 'patch',
      value: {
        schema,
        schemaOverrides,
        excludeOutliers,
        dataAudit,
        parseHealth,
        recipe,
      },
    });
    persistSnapshot({
      rows: current.rows,
      schema,
      recipe,
      dataSource: current.dataSource,
      parseHealth,
      schemaOverrides,
      dataAudit,
      previousSnapshot: current.previousSnapshot,
      updatedAt: current.updatedAt || Date.now(),
      id: current.id,
    });
    track('health_action', {
      action: correct
        ? issue.correction === 'treat-as-date' ? 'treat-as-date' : 'include-outliers'
        : 'acknowledge',
    });
    flashStatus(correct ? 'Data assumption updated' : 'Health warning acknowledged');
  }, [flashStatus, persistSnapshot]);

  const openInspector = useCallback((widget: RenderedWidget, selectedValue: unknown | null) => {
    const current = stateRef.current;
    const rows = applyDashboardFilters(current.rows, current.filters, current.schema);
    dispatch({ type: 'patch', value: { inspector: { widget, selectedValue, rows: contributingRows(widget, selectedValue, rows) } } });
    track('chart_inspected', { widgetType: widget.type });
  }, []);

  const submitChef = useCallback(async (request: string) => {
    const text = request.trim();
    const current = stateRef.current;
    if (!text || current.chefThinking || !current.recipe) return;
    const userMessage: ChefMessage = { role: 'user', content: text };
    const history = [...current.chefHistory, userMessage];
    dispatch({ type: 'patch', value: { chefHistory: history, chefThinking: true } });
    try {
      const raw = await complete(buildChefPrompt(text, current.recipe, current.rows, current.schema, current.chefWidgetIndex), 'chef');
      const parsed = parseModelObject(raw);
      if (!Array.isArray(parsed.widgets)) throw new Error('The chef returned no widgets. Try rephrasing.');
      const repaired = repairCanonicalWidgets(parsed.widgets, current.recipe.widgets, current.rows, current.schema);
      const validated = validateRecipe({ ...parsed, widgets: repaired }, current.schema, current.rows, { excludeOutliers: current.excludeOutliers });
      if (repaired.length > 1 && validated.dropped > 0 && validated.widgets.length < Math.ceil(repaired.length * 0.75)) {
        throw new Error('The chef returned an incomplete recipe. Try that edit again.');
      }
      if (!validated.widgets.length) throw new Error('No valid widgets in the reply. Try rephrasing.');
      const previousRecipe = cloneRecipe(current.recipe);
      const recipe = {
        title: typeof parsed.title === 'string' ? parsed.title : current.recipe.title,
        widgets: validated.widgets,
        fallback: false,
        rejectedWidgets: Math.max(validated.dropped, repaired.length - validated.widgets.length) || undefined,
      };
      const chefMessage: ChefMessage = {
        role: 'chef',
        content: typeof parsed.reply === 'string' ? parsed.reply : 'Done.',
        changes: Array.isArray(parsed.changes) ? parsed.changes.filter((value): value is string => typeof value === 'string').slice(0, 6) : [],
        previousRecipe,
      };
      const target = current.chefWidgetIndex === null ? 'dashboard' : current.recipe.widgets[current.chefWidgetIndex];
      const targetLabel = typeof target === 'string'
        ? target
        : target?.title || (target && 'label' in target ? target.label : 'widget');
      dispatch({
        type: 'patch',
        value: {
          recipe,
          chefHistory: [...history, chefMessage],
          chefThinking: false,
          changedWidgets: diffWidgets(current.recipe.widgets, validated.widgets),
          ...appendRecipeHistory(current, recipe, `Chef edited ${targetLabel}`),
        },
      });
      persistSnapshot({
        rows: current.rows,
        schema: current.schema,
        recipe,
        dataSource: current.dataSource,
        parseHealth: current.parseHealth,
        previousSnapshot: current.previousSnapshot,
        updatedAt: current.updatedAt || Date.now(),
        id: current.id,
      });
      track('chef_edit', { scope: current.chefWidgetIndex === null ? 'dashboard' : 'widget', success: true });
      window.setTimeout(() => dispatch({ type: 'patch', value: { changedWidgets: new Set() } }), 1700);
    } catch (error) {
      track('chef_edit', { scope: current.chefWidgetIndex === null ? 'dashboard' : 'widget', success: false });
      dispatch({
        type: 'patch',
        value: {
          chefHistory: [...history, { role: 'error', content: error instanceof SyntaxError ? 'Couldn’t parse the chef’s reply. Try rephrasing.' : error instanceof Error ? error.message : 'Something went wrong.' }],
          chefThinking: false,
        },
      });
    }
  }, [persistSnapshot]);

  const undoChef = useCallback((historyIndex: number) => {
    const current = stateRef.current;
    const message = current.chefHistory[historyIndex];
    if (!message?.previousRecipe || message.undone) return;
    const history = current.chefHistory.map((candidate, index) =>
      index >= historyIndex && candidate.role === 'chef' && candidate.previousRecipe ? { ...candidate, undone: true } : candidate,
    );
    const recipe = message.previousRecipe;
    commitRecipeChange(recipe, 'Undid Chef edit', { chefHistory: history, changedWidgets: new Set(recipe.widgets.map(widgetFingerprint)) });
  }, [commitRecipeChange]);

  const restoreRecent = useCallback((recent: RecentDashboard) => {
    setPasteText('');
    setChefInput('');
    const schemaOverrides = recent.schemaOverrides && typeof recent.schemaOverrides === 'object' && !Array.isArray(recent.schemaOverrides)
      ? recent.schemaOverrides
      : {};
    const schema = applySchemaOverrides(inferSchema(recent.rows), schemaOverrides);
    const parseHealth = buildParseHealth(
      recent.rows,
      schema,
      recent.parseHealth || { rowsParsed: recent.rows.length, rowsDropped: 0, format: 'unknown' },
    );
    dispatch({
      type: 'patch',
      value: {
        stage: 'dash',
        rows: recent.rows,
        schema,
        recipe: recent.recipe,
        title: recent.title,
        id: recent.id,
        dataSource: recent.dataSource || null,
        parseHealth,
        schemaOverrides,
        dataAudit: Array.isArray(recent.dataAudit) ? recent.dataAudit : stampAudit(parseHealth.audit),
        alerts: Array.isArray(recent.alerts) ? recent.alerts : [],
        theme: recent.theme || 'mise',
        filters: Array.isArray(recent.filters) ? recent.filters : [],
        savedViews: Array.isArray(recent.savedViews) ? recent.savedViews : [],
        kpiGoals: Array.isArray(recent.kpiGoals) ? recent.kpiGoals : [],
        dashboardNotes: typeof recent.dashboardNotes === 'string' ? recent.dashboardNotes : '',
        workbenchOpen: false,
        presentationMode: false,
        previousSnapshot: recent.previousSnapshot || null,
        updatedAt: recent.updatedAt || recent.savedAt,
        chefHistory: [],
        chefOpen: false,
        chefWidgetIndex: null,
        recipeHistory: [recipeRevision(recent.recipe, 'Restored dashboard')],
        recipeHistoryIndex: 0,
        error: '',
      },
    });
  }, []);

  const exportDashboardBundle = useCallback(() => {
    const current = stateRef.current;
    if (!current.recipe) return;
    const dashboard: RecentDashboard = {
      id: current.id || `d_${Date.now().toString(36)}`,
      title: current.recipe.title,
      rows: current.rows,
      schema: current.schema,
      recipe: current.recipe,
      dataSource: current.dataSource,
      parseHealth: current.parseHealth,
      schemaOverrides: current.schemaOverrides,
      dataAudit: current.dataAudit,
      alerts: current.alerts,
      theme: current.theme,
      filters: current.filters,
      savedViews: current.savedViews,
      kpiGoals: current.kpiGoals,
      dashboardNotes: current.dashboardNotes,
      previousSnapshot: current.previousSnapshot,
      updatedAt: current.updatedAt || Date.now(),
      savedAt: Date.now(),
      cols: current.schema.length,
    };
    const bundle = buildDashboardBundle(dashboard);
    downloadFile(exportFilename(current.recipe.title, 'mise.json'), new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
    flashStatus('Dashboard backup exported');
  }, [flashStatus]);

  const importDashboardBundle = useCallback((source: string) => {
    try {
      const imported = parseDashboardBundle(source);
      const schemaOverrides = imported.schemaOverrides || {};
      const schema = applySchemaOverrides(inferSchema(imported.rows), schemaOverrides);
      const columns = new Set(schema.map(column => column.name));
      const filters = (imported.filters || []).filter(filter => columns.has(filter.column));
      const savedViews = (imported.savedViews || []).map(view => ({
        ...view,
        filters: view.filters.filter(filter => columns.has(filter.column)),
      }));
      const kpiGoals = (imported.kpiGoals || []).filter(goal => columns.has(goal.metric));
      const alerts = (imported.alerts || []).filter(alert => columns.has(alert.metric));
      const recipe = applyRecipeToRows(imported.recipe, imported.rows, schema, { dataSource: imported.dataSource });
      const dashboard: RecentDashboard = {
        ...imported,
        id: `d_${Date.now().toString(36)}`,
        title: recipe.title,
        schema,
        recipe,
        parseHealth: buildParseHealth(imported.rows, schema, imported.parseHealth || {
          rowsParsed: imported.rows.length,
          rowsDropped: 0,
          format: 'unknown',
        }),
        schemaOverrides,
        filters,
        savedViews,
        kpiGoals,
        alerts,
        savedAt: Date.now(),
        updatedAt: imported.updatedAt || Date.now(),
        cols: schema.length,
      };
      saveRecent(dashboard);
      restoreRecent(dashboard);
      dispatch({ type: 'patch', value: { recents: loadRecents(), workbenchOpen: false } });
      flashStatus('Dashboard backup restored');
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not restore that backup';
      flashStatus(message, true);
      return message;
    }
  }, [flashStatus, restoreRecent]);

  useEffect(() => {
    window.reset = reset;
    const bridge = {
      parseInput,
      incomingKind,
      splitCSV: splitCsv,
      parseCSVRecords: parseCsvRecords,
      flattenRows,
      inferSchema,
      buildPrompt,
      buildDataProfile,
      formatCompact,
      fmtCompact: (value: number, column?: string, format: NumberFormat = 'auto') => formatCompact(value, column, format, { rows: stateRef.current.rows, schema: stateRef.current.schema }),
      formatNum: (value: number, column?: string, format: NumberFormat = 'auto') => formatCompact(value, column, format, { rows: stateRef.current.rows, schema: stateRef.current.schema }),
      normalizeTableFields,
      sortedTableRows: (widget: TableWidget) => sortTableRows(stateRef.current.rows, stateRef.current.schema, widget),
      downloadFile,
      exportFilename,
      isRecipePayload,
      applyRecipeToRows: (recipe: DashboardRecipe<unknown>, schema: SchemaColumn[]) => applyRecipeToRows(recipe, stateRef.current.rows, schema),
      buildRecipePayload: () => stateRef.current.recipe ? buildRecipePayload({ recipe: stateRef.current.recipe, schema: stateRef.current.schema, rows: stateRef.current.rows, dataSource: stateRef.current.dataSource, generatedAt: new Date().toISOString() }) : null,
      tableTransformLabel,
      computeKPIFromValues: computeKpiFromValues,
      seriesBy,
      metricValues,
      hasHttpSource: () => hasHttpSource(stateRef.current.dataSource),
      chefBuildPrompt: (
        request: string,
        recipe: DashboardRecipe = stateRef.current.recipe as DashboardRecipe,
        rows: Row[] = stateRef.current.rows,
        schema: SchemaColumn[] = stateRef.current.schema,
      ) => recipe ? buildChefPrompt(request, recipe, rows, schema) : '',
      reset,
      get state() { return stateRef.current; },
    };
    window.__mise = bridge;
  }, [reset]);

  const focusedRows = useMemo(
    () => applyDashboardFilters(state.rows, state.filters, state.schema),
    [state.filters, state.rows, state.schema],
  );
  const comparison = useMemo(() => {
    if (!state.previousSnapshot || !state.recipe) return null;
    return compareDatasets(state.previousSnapshot, state.rows, state.schema, state.recipe);
  }, [state.previousSnapshot, state.recipe, state.rows, state.schema]);
  const executiveBrief = useMemo(() => {
    if (!state.recipe) return null;
    return buildExecutiveBrief(state.recipe, focusedRows, state.schema, state.filters.length ? null : comparison, state.parseHealth);
  }, [comparison, focusedRows, state.filters.length, state.parseHealth, state.recipe, state.schema]);
  const alertEvaluations = useMemo(
    () => evaluateAlerts(state.alerts, state.rows, state.schema),
    [state.alerts, state.rows, state.schema],
  );
  const kpiGoalEvaluations = useMemo(
    () => evaluateKpiGoals(state.kpiGoals, focusedRows, state.schema, { excludeOutliers: state.excludeOutliers }),
    [focusedRows, state.excludeOutliers, state.kpiGoals, state.schema],
  );
  const triggeredAlerts = alertEvaluations.filter(alert => alert.triggered).length;
  const health = state.parseHealth;
  const healthIssueCount = health?.issues.length || 0;
  const currentTitle = state.recipe?.title || state.title;
  const chefTarget = state.chefWidgetIndex === null ? null : state.recipe?.widgets[state.chefWidgetIndex] || null;
  const chefTargetLabel = chefTarget?.title || (chefTarget && 'label' in chefTarget ? chefTarget.label : null);
  const steps: Array<[LoadingStep, string]> = [['parse', 'Parse data'], ['infer', 'Infer schema'], ['layout', 'Propose layout'], ['render', 'Render dashboard']];
  const isHttp = hasHttpSource(state.dataSource);
  const dashboardActions = useMemo(() => buildDashboardActions({
    hasRecipe: !!state.recipe,
    hasHttpSource: isHttp,
    refreshing: state.refreshing,
    historyIndex: state.recipeHistoryIndex,
    historyLength: state.recipeHistory.length,
    healthIssueCount: health ? healthIssueCount : null,
    alertCount: state.alerts.length,
    triggeredAlerts,
    replaceData: () => replacementInputRef.current?.click(),
    refresh: () => void refreshDashboard(),
    openDataHealth: () => dispatch({ type: 'patch', value: { healthOpen: true } }),
    openAlerts: () => dispatch({ type: 'patch', value: { alertsOpen: true } }),
    exportPng: () => void exportPng(),
    exportHtml: exportStandalone,
    exportRecipe,
    copyRecipeLink: () => void copyRecipeLink(),
    exportBackup: exportDashboardBundle,
    present: togglePresentation,
    openWorkbench,
    openChef,
    undo: () => navigateRecipeHistory(-1),
    redo: () => navigateRecipeHistory(1),
  }), [copyRecipeLink, exportDashboardBundle, exportPng, exportRecipe, exportStandalone, health, healthIssueCount, isHttp, navigateRecipeHistory, openChef, openWorkbench, refreshDashboard, state.alerts.length, state.recipe, state.recipeHistory.length, state.recipeHistoryIndex, state.refreshing, togglePresentation, triggeredAlerts]);
  const actionsRef = useRef(dashboardActions);
  useEffect(() => {
    actionsRef.current = dashboardActions;
  }, [dashboardActions]);

  useEffect(() => {
    const runAction = (id: string) => {
      const action = actionsRef.current.find(candidate => candidate.id === id);
      if (action?.visible && action.enabled) action.run();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const current = stateRef.current;
      if (current.stage !== 'dash' || !current.recipe) return;
      const target = event.target;
      const editable = target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (event.key === 'Escape') {
        if (current.paletteOpen) {
          dispatch({ type: 'patch', value: { paletteOpen: false } });
          return;
        }
        const openMenu = document.querySelector<HTMLDetailsElement>('details.menu[open]');
        if (openMenu) {
          openMenu.removeAttribute('open');
          openMenu.querySelector<HTMLElement>('summary')?.focus();
          return;
        }
        if (current.workbenchOpen) {
          dispatch({ type: 'patch', value: { workbenchOpen: false } });
          return;
        }
        if (current.chefOpen) {
          dispatch({ type: 'patch', value: { chefOpen: false, chefWidgetIndex: null } });
          return;
        }
        if (current.presentationMode) dispatch({ type: 'patch', value: { presentationMode: false } });
        return;
      }
      if (modifier && key === 'k') {
        event.preventDefault();
        dispatch({ type: 'patch', value: { paletteOpen: !current.paletteOpen } });
        return;
      }
      if (editable) return;
      if (modifier && key === 'z') {
        event.preventDefault();
        runAction(event.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (modifier || event.altKey || document.querySelector('dialog[open]')) return;
      if (event.key === '/') {
        event.preventDefault();
        runAction('chef');
        return;
      }
      if (key === 'p' && !event.shiftKey) {
        event.preventDefault();
        runAction('present');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const actionById = (id: string): DashboardAction | undefined => dashboardActions.find(action => action.id === id);
  const undoAction = actionById('undo');
  const redoAction = actionById('redo');
  const presentAction = actionById('present');
  const analyzeAction = actionById('analyze');
  const showDashboardChrome = state.stage === 'dash' && !!state.recipe;
  const status = statusLabel(state);
  return (
    <>
      <header className="top">
        <div className="top-left">
          <button className="mark" type="button" aria-label="Start a new Mise dashboard" onClick={reset}><span className="mark-dot" /><span className="mark-name">Mise</span></button>
          <span className="crumb-sep">/</span>
          <span id="crumb" className="crumb-active">{state.stage === 'loading' ? 'Reading…' : state.stage === 'dash' ? currentTitle : 'New dashboard'}</span>
        </div>
        {showDashboardChrome && (
          <div className="top-right">
            <span id="status-pill" className="pill" role="status" aria-live="polite"><span className={`pill-dot ${status.saved ? 'active' : ''}`} />{status.text}</span>
            {undoAction?.visible && <button id="recipe-undo" className="btn btn-ghost btn-icon" type="button" aria-label="Undo" title={`Undo · ${undoAction.shortcut}`} disabled={!undoAction.enabled} onClick={undoAction.run}>↶</button>}
            {redoAction?.visible && <button id="recipe-redo" className="btn btn-ghost btn-icon" type="button" aria-label="Redo" title={`Redo · ${redoAction.shortcut}`} disabled={!redoAction.enabled} onClick={redoAction.run}>↷</button>}
            <Menu id="data-menu" label="Data" actions={dashboardActions.filter(action => action.group === 'data')} />
            <Menu id="export-menu" label="Export" actions={dashboardActions.filter(action => action.group === 'export')} />
            {presentAction?.visible && <button id="presentation-mode" className="btn btn-ghost" type="button" title={presentAction.hint} onClick={presentAction.run}>Present</button>}
            <kbd className="shortcut-hint" title="Command palette">{MOD_KEY}K</kbd>
          </div>
        )}
      </header>
      <input id="replacement-input" ref={replacementInputRef} type="file" accept=".csv,.json,.txt,application/json,text/csv,text/plain" hidden onChange={event => { const file = event.target.files?.[0]; if (file) replaceDashboardData(file); }} />
      {state.presentationMode && <button id="exit-presentation" className="btn btn-primary presentation-exit" type="button" onClick={() => dispatch({ type: 'patch', value: { presentationMode: false } })}>Exit presentation</button>}

      <section id="stage-empty" className={`stage ${state.stage === 'empty' ? 'is-active' : ''}`}>
        <div className="empty-body"><div className="empty-card">
          <div className="empty-eyebrow"><span className="eyebrow eyebrow-accent">A new dashboard</span></div>
          <h1>Drop a file. Or paste your data.</h1>
          <p className="lede">Mise profiles your data locally, sends computed facts for layout, and renders the dashboard right here in your browser. Raw rows are not sent.</p>
          <div
            id="drop"
            className="drop"
            onDragOver={event => { event.preventDefault(); event.currentTarget.classList.add('is-hover'); }}
            onDragLeave={event => event.currentTarget.classList.remove('is-hover')}
            onDrop={event => {
              event.preventDefault();
              event.currentTarget.classList.remove('is-hover');
              const file = event.dataTransfer.files[0];
              if (file) ingestFile(file);
            }}
          >
            <div className="drop-icon"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#1f1c16" strokeWidth="1.5"><path d="M11 14V4M11 4l-4 4M11 4l4 4M3 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg></div>
            <h3>Drop a file here</h3>
            <p>CSV, JSON, or a Mise recipe · or paste below</p>
            <div className="drop-cta-row">
              <button id="browse-btn" type="button" className="btn btn-ghost" onClick={() => fileInputRef.current?.click()}>Choose file…</button>
              <input id="file-input" ref={fileInputRef} type="file" accept=".csv,.json,.txt,.recipe.json,application/json,text/csv,text/plain" style={{ display: 'none' }} onChange={event => { const file = event.target.files?.[0]; if (file) ingestFile(file); }} />
              <span className="drop-cta-meta" id="file-name">{fileName}</span>
            </div>
            <div className="or"><span>or fetch</span></div>
            <div className="http-source">
              <input id="http-url" className="http-source-input" type="url" inputMode="url" placeholder="https://api.example.com/data.json" value={httpUrl} onChange={event => setHttpUrl(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void runHttp(); }} />
              <button id="fetch-url-btn" type="button" className="btn btn-ghost" onClick={() => void runHttp()}>Fetch URL</button>
              <div className="http-source-hint">GET endpoints returning JSON or CSV · Google Sheets share links and GitHub blob URLs are converted automatically · saved dashboards can refresh without asking the AI again.</div>
            </div>
            <div className="or"><span>or paste</span></div>
            <textarea id="paste" className="drop-paste" placeholder='Paste JSON or CSV — e.g. [{"month":"Jan","revenue":42000}, ...]' value={pasteText} onChange={event => setPasteText(event.target.value)} />
            <details className="notes-row" id="notes-details" open>
              <summary className="notes-label"><span className="notes-toggle-icon" aria-hidden="true">+</span><span className="notes-key">Notes</span><span className="notes-meta">optional · nudges the AI layout</span></summary>
              <textarea id="notes" className="drop-notes" maxLength={1000} placeholder="e.g. Treat 'plan' as the primary segment. Highlight churn over 5%." value={notes} onChange={event => setNotes(event.target.value)} />
            </details>
            <div className="drop-actions"><button id="render-btn" className="btn btn-primary btn-lg" onClick={() => void runPipeline(pasteText)}>Render dashboard →</button></div>
            <div className="drop-meta">Profile computed locally · aggregate facts sent once for inference · raw rows stay here</div>
            {state.pendingRecipe && <div id="pending-recipe" className="pending-recipe">Recipe ready: {state.pendingRecipe.title || 'untitled'} · drop data to apply</div>}
            {state.error && <div id="err" className="err" role="alert">{state.error}</div>}
          </div>
          {state.recents.length > 0 && <div id="recent-rail" className="recent-rail">
            <div className="recent-rail-hd"><span className="eyebrow">Your plates · in this browser</span><button id="recent-clear" className="recent-rail-clear" onClick={() => { if (confirm('Clear all your plates from this browser?')) { clearRecents(); dispatch({ type: 'patch', value: { recents: [] } }); } }}>Clear all</button></div>
            <div id="recent-list" className="recent-list">{state.recents.map(recent => <button type="button" className="recent-card" key={recent.id} data-id={recent.id} onClick={() => restoreRecent(recent)}><h4 className="recent-card-title">{recent.title || 'Untitled'}</h4><div className="recent-card-meta"><span>{recent.rows.length}r · {recent.cols}c{recent.dataSource?.type === 'http' ? ' · HTTP' : ''}</span><span>{relativeTime(recent.savedAt)}</span></div></button>)}</div>
          </div>}
          <div className="empty-foot"><div className="empty-foot-tip">tip — paste anywhere on the page <kbd>⌘V</kbd></div></div>
          <ExampleGallery examples={EXAMPLE_PLATES} onOpen={openExample} onUseNote={useExampleNote} />
          <footer className="site-foot"><span>Mise · browser-local dashboards</span><nav><a href="/docs/quickstart.html">Quickstart</a><a href="/docs/examples.html">Examples</a><a href="/docs/about.html">About</a><a href="/docs/contact.html">Contact</a></nav></footer>
        </div></div>
      </section>

      <section id="stage-loading" className={`stage ${state.stage === 'loading' ? 'is-active' : ''}`}>
        <div className="loading-body"><div className="loading-left">
          <div className="eyebrow eyebrow-accent" style={{ marginBottom: 14 }}>— Reading the data —</div>
          <h2 id="loading-title">We're getting to know your data.</h2>
          <p style={{ color: 'var(--fg-mute)', fontSize: 15, margin: '0 0 24px' }}>Profile first, layout second. We compute facts across the complete dataset, send those once, then forget them.</p>
          <div id="loading-file" className="file"><span id="loading-file-text">{state.loadingLabel}</span></div>
          <ul className="loading-steps" id="loading-steps" aria-live="polite">{steps.map(([step, label]) => { const status = state.loadingSteps[step]; return <li key={step} className={`loading-step step-${status === 'done' ? 'done' : status === 'active' ? 'active' : 'pending'}`} data-step={step}><span className="step-mark">{status === 'done' ? '✓' : ''}</span><span className="step-name">{label}</span><span className="step-meta">{status === 'active' ? 'running…' : status}</span></li>; })}</ul>
        </div><div className="loading-divider" /><div className="loading-right"><div className="schema-head"><h3>Inferred schema</h3><span id="schema-meta" className="eyebrow">{state.schema.length || '—'} columns</span></div><div id="schema-cols" className="schema-cols">{state.schema.map((column, index) => <div className="schema-col" key={column.name}><span className="schema-num">{String(index + 1).padStart(2, '0')}</span><span className="schema-name">{column.name}</span><span className="schema-type">{column.type}</span><span className="schema-stat" title={column.stat}>{column.stat}</span></div>)}</div></div></div>
      </section>

      <section id="stage-dash" className={`stage ${state.stage === 'dash' ? 'is-active' : ''}`}>
        {state.recipe && (
          <>
            <div className="dash-head">
              <div className="eyebrow eyebrow-accent">— Dashboard —</div>
              <InlineRename as="h1" id="dash-title" value={state.recipe.title} onCommit={renameDashboard} />
              <div id="dash-meta" className="dash-head-meta">
                {state.rows.length} rows · {state.schema.length} cols · updated {new Date(state.updatedAt || Date.now()).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
              {!!state.filters.length && <div id="focus-summary" className="focus-summary"><strong>Focused view</strong><span>{focusedRows.length} of {state.rows.length} rows · {state.filters.length} active filter{state.filters.length === 1 ? '' : 's'}</span><button type="button" onClick={() => updateWorkbench({ filters: [] })}>Clear</button></div>}
              {state.dashboardNotes && <p id="dashboard-context" className="dashboard-context">{state.dashboardNotes}</p>}
              {health && (
                <div id="dash-health" className="dash-health">
                  <span>{health.rowsParsed} row{health.rowsParsed === 1 ? '' : 's'} parsed · {health.rowsDropped} dropped</span>
                  <button id="data-health-btn" type="button" className={`health-summary ${healthIssueCount ? 'has-issues' : ''}`} onClick={() => dispatch({ type: 'patch', value: { healthOpen: true } })}>
                    Data health · {healthIssueCount ? `${healthIssueCount} flag${healthIssueCount === 1 ? '' : 's'}` : 'clean'}
                  </button>
                </div>
              )}
              <div className="dash-actions">
                {analyzeAction && <button id="open-workbench" type="button" className="btn btn-primary" title={analyzeAction.hint} onClick={analyzeAction.run}>Analyze</button>}
                {state.recipeHistory.length > 1 && (
                  <details className="recipe-history">
                    <summary>{state.recipeHistory.length} revisions</summary>
                    <ol>{state.recipeHistory.map((revision, index) => <li className={index === state.recipeHistoryIndex ? 'current' : ''} key={`${revision.at}-${index}`}>{revision.label}</li>)}</ol>
                  </details>
                )}
              </div>
            </div>
            <RecurringReportSummary state={state} comparison={state.filters.length ? null : comparison} now={clock} onCadence={setRefreshCadence} />
            {focusedRows.length ? <WidgetGrid
              recipe={state.recipe}
              rows={focusedRows}
              schema={state.schema}
              changedWidgets={state.changedWidgets}
              comparisons={state.filters.length ? [] : comparison?.kpis || []}
              goals={kpiGoalEvaluations}
              excludeOutliers={state.excludeOutliers}
              onAssumptions={index => dispatch({ type: 'patch', value: { assumptionsWidgetIndex: index } })}
              onInspect={openInspector}
              onRetry={() => void retryAi()}
              onExportTable={exportTable}
              onCopyTable={widget => void copyTable(widget)}
              onEditWidget={editWidget}
              onChefWidget={openChefForWidget}
            /> : <div id="focus-empty" className="focus-empty" role="status"><strong>No rows match this focused view.</strong><span>Clear or adjust a filter in the Analysis workbench to bring the dashboard back.</span><button type="button" className="btn btn-primary" onClick={() => updateWorkbench({ filters: [] })}>Clear filters</button></div>}
          </>
        )}
      </section>

      {state.stage === 'dash' && !state.chefOpen && <button id="chef-fab" className="chef-fab is-visible" type="button" onClick={() => dispatch({ type: 'patch', value: { chefOpen: true, chefWidgetIndex: null } })}><span className="chef-fab-glyph">M</span><span>Talk to the chef</span></button>}
      <aside id="chef-panel" className={`chef-panel ${state.chefOpen ? 'is-open' : ''}`} aria-label="The Chef">
        <div className="chef-hd"><div className="chef-hd-l"><span className="chef-hd-glyph">M</span><span className="chef-hd-name">The Chef</span>{chefTargetLabel && <span id="chef-target" className="chef-hd-tag">Editing · {chefTargetLabel}</span>}</div><button id="chef-close" className="chef-close" type="button" aria-label="Close" onClick={() => dispatch({ type: 'patch', value: { chefOpen: false, chefWidgetIndex: null } })}>×</button></div>
        <div id="chef-body" className="chef-body">
          {!state.chefHistory.length && !state.chefThinking && <div id="chef-empty" className="chef-empty"><div className="chef-empty-eyebrow">Tell the chef what to change</div><p className="chef-empty-title">"Swap the donut for a bar chart, sorted by month."</p><div className="chef-suggestions">{[['Swap the donut for a bar chart', 'Swap the donut for a bar chart'], ['Hide the observations widget', 'Hide the observations widget'], ['Make the first KPI the hero metric — full width, larger', 'Promote the first KPI to a hero — full width'], ['Sort the table by date, descending, and limit to 20 rows', 'Sort the table by date desc, top 20'], ['Show a top 10 table sorted by the primary numeric metric, descending', 'Top 10 by primary metric']].map(([prompt, label]) => <button key={prompt} className="chef-suggestion" data-prompt={prompt} onClick={() => void submitChef(prompt)}>{label}</button>)}</div></div>}
          <div id="chef-msgs" className="chef-msgs" aria-live="polite">{state.chefHistory.map((message, index) => message.role === 'user' ? <div className="chef-msg-user" key={index}>{message.content}</div> : message.role === 'error' ? <div className="chef-msg-error" role="alert" key={index}>{message.content}</div> : <div className={`chef-msg-chef ${message.undone ? 'is-undone' : ''}`} key={index}>"{message.content}"{message.previousRecipe && !message.undone && <button className="undo-btn" data-undo={index} type="button" onClick={() => undoChef(index)}>↶ Undo</button>}{message.changes?.length ? <span className="changes">{message.changes.join(' · ')}</span> : null}{message.undone && <span className="changes" style={{ color: 'var(--fg-mute)' }}>reverted</span>}</div>)}{state.chefThinking && <div className="chef-msg-thinking" role="status">tasting…</div>}</div>
        </div>
        <div className="chef-input-row"><textarea id="chef-input" className="chef-input" rows={1} placeholder={chefTargetLabel ? `Adjust ${chefTargetLabel}…` : 'Ask the chef to adjust…'} value={chefInput} onChange={event => setChefInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); const value = chefInput; setChefInput(''); void submitChef(value); } }} /><button id="chef-send" className="chef-send" type="button" disabled={!chefInput.trim() || state.chefThinking} onClick={() => { const value = chefInput; setChefInput(''); void submitChef(value); }}>Send</button></div>
      </aside>

      <CommandPalette open={state.paletteOpen} actions={dashboardActions} onClose={() => dispatch({ type: 'patch', value: { paletteOpen: false } })} />
      <AssumptionsDialog state={state} onClose={() => dispatch({ type: 'patch', value: { assumptionsWidgetIndex: null } })} onApply={applyAssumption} />
      <InspectorDialog state={state} onClose={() => dispatch({ type: 'patch', value: { inspector: null } })} />
      <DataHealthDialog
        open={state.healthOpen}
        health={state.parseHealth}
        audit={state.dataAudit}
        excludeOutliers={state.excludeOutliers}
        onClose={() => dispatch({ type: 'patch', value: { healthOpen: false } })}
        onCorrect={issue => updateHealthIssue(issue, true)}
        onIgnore={issue => updateHealthIssue(issue, false)}
      />
      <AlertsDialog
        open={state.alertsOpen}
        recipe={state.recipe}
        rows={state.rows}
        schema={state.schema}
        evaluations={alertEvaluations}
        onClose={() => dispatch({ type: 'patch', value: { alertsOpen: false } })}
        onAdd={alert => updateAlerts([...stateRef.current.alerts, alert])}
        onRemove={id => updateAlerts(stateRef.current.alerts.filter(alert => alert.id !== id))}
      />
      <AnalysisWorkbench
        open={state.workbenchOpen}
        initialTab={state.workbenchTab}
        rows={focusedRows}
        allRows={state.rows}
        schema={state.schema}
        recipe={state.recipe}
        filters={state.filters}
        savedViews={state.savedViews}
        kpiGoals={state.kpiGoals}
        dashboardNotes={state.dashboardNotes}
        excludeOutliers={state.excludeOutliers}
        theme={state.theme}
        brief={executiveBrief}
        dataSource={state.dataSource}
        parseHealth={state.parseHealth}
        schemaOverrides={state.schemaOverrides}
        onClose={() => dispatch({ type: 'patch', value: { workbenchOpen: false } })}
        onFilters={filters => updateWorkbench({ filters })}
        onSavedViews={savedViews => updateWorkbench({ savedViews })}
        onKpiGoals={kpiGoals => updateWorkbench({ kpiGoals })}
        onDashboardNotes={dashboardNotes => {
          updateWorkbench({ dashboardNotes });
          flashStatus('Dashboard context saved');
        }}
        onPrompt={prompt => {
          setChefInput(prompt);
          dispatch({ type: 'patch', value: { workbenchOpen: false, chefOpen: true, chefWidgetIndex: null } });
          window.setTimeout(() => document.getElementById('chef-input')?.focus(), 0);
        }}
        onExport={exportDashboardBundle}
        onImport={importDashboardBundle}
        onTheme={setDashboardTheme}
        onInspectBrief={widget => {
          dispatch({ type: 'patch', value: { workbenchOpen: false } });
          openInspector(widget, null);
        }}
        onCopyBrief={markdown => void copyExecutiveBrief(markdown)}
      />
    </>
  );
}

export default App;
