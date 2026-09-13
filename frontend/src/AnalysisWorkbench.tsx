import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  buildDataProfile,
  buildFollowUpQuestions,
  evaluateKpiGoals,
  filterOperators,
  findCorrelations,
  formatCompact,
  humanize,
  kpiGoalsFromRecipe,
  scanSensitiveColumns,
  widgetFingerprint,
  type DashboardFilter,
  type DashboardRecipe,
  type DashboardTheme,
  type DataSource,
  type ExecutiveBrief,
  type FilterOperator,
  type KpiGoal,
  type KpiWidget,
  type ParseHealth,
  type Row,
  type SavedDashboardView,
  type SchemaColumn,
  type SchemaOverrides,
} from './domain';
import { CloseButton, ExecutiveBriefPanel, RecipeInspectorPanel, useDialog } from './InsightsDialogs';
import type { WorkbenchTab } from './state';
import { parseDashboardBundle } from './workspace';

const TABS: WorkbenchTab[] = ['focus', 'goals', 'discover', 'brief', 'recipe', 'notes'];

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  equals: 'equals',
  contains: 'contains',
  'at-least': 'at least',
  'at-most': 'at most',
  after: 'on or after',
  before: 'on or before',
};

function profileDetail(fact: ReturnType<typeof buildDataProfile>['facts'][number]): string {
  if (fact.type === 'number') {
    return `range ${fact.min ?? '—'}–${fact.max ?? '—'} · median ${fact.median ?? '—'} · average ${fact.average ?? '—'}`;
  }
  if (fact.type === 'category') {
    return fact.topValues.slice(0, 3).map(value => `${value.value} (${value.count})`).join(' · ');
  }
  if (fact.type === 'date') return `${String(fact.first ?? '—')} → ${String(fact.last ?? '—')} · ${fact.unique} unique`;
  return fact.type;
}

export default function AnalysisWorkbench({
  open,
  initialTab = 'focus',
  rows,
  allRows,
  schema,
  recipe,
  filters,
  savedViews,
  kpiGoals,
  dashboardNotes,
  excludeOutliers,
  theme,
  brief,
  dataSource,
  parseHealth,
  schemaOverrides,
  onClose,
  onFilters,
  onSavedViews,
  onKpiGoals,
  onDashboardNotes,
  onPrompt,
  onExport,
  onImport,
  onTheme,
  onInspectBrief,
  onCopyBrief,
}: {
  open: boolean;
  initialTab?: WorkbenchTab;
  rows: Row[];
  allRows: Row[];
  schema: SchemaColumn[];
  recipe: DashboardRecipe | null;
  filters: DashboardFilter[];
  savedViews: SavedDashboardView[];
  kpiGoals: KpiGoal[];
  dashboardNotes: string;
  excludeOutliers: boolean;
  theme: DashboardTheme;
  brief: ExecutiveBrief | null;
  dataSource: DataSource | null;
  parseHealth: ParseHealth | null;
  schemaOverrides: SchemaOverrides;
  onClose: () => void;
  onFilters: (filters: DashboardFilter[]) => void;
  onSavedViews: (views: SavedDashboardView[]) => void;
  onKpiGoals: (goals: KpiGoal[]) => void;
  onDashboardNotes: (notes: string) => void;
  onPrompt: (prompt: string) => void;
  onExport: () => void;
  onImport: (source: string) => string | null;
  onTheme: (theme: DashboardTheme) => void;
  onInspectBrief: (widget: KpiWidget) => void;
  onCopyBrief: (markdown: string) => void;
}) {
  const ref = useDialog(open);
  const importRef = useRef<HTMLInputElement>(null);
  const importErrorRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<WorkbenchTab>(initialTab);
  const [columnName, setColumnName] = useState(schema[0]?.name || '');
  const [operator, setOperator] = useState<FilterOperator>(filterOperators(schema[0])[0]);
  const [notesDraft, setNotesDraft] = useState(dashboardNotes);
  const [importError, setImportError] = useState('');
  const [pendingImport, setPendingImport] = useState<{ source: string; title: string; rows: number; savedAt: number } | null>(null);
  const profile = useMemo(() => buildDataProfile(rows, schema), [rows, schema]);
  const privacyFindings = useMemo(() => scanSensitiveColumns(allRows, schema), [allRows, schema]);
  const correlations = useMemo(() => findCorrelations(rows, schema), [rows, schema]);
  const followUps = useMemo(() => recipe ? buildFollowUpQuestions(recipe, schema) : [], [recipe, schema]);
  const goalWidgets = useMemo(() => recipe ? kpiGoalsFromRecipe(recipe) : [], [recipe]);
  const goalEvaluations = useMemo(
    () => evaluateKpiGoals(kpiGoals, rows, schema, { excludeOutliers }),
    [excludeOutliers, kpiGoals, rows, schema],
  );
  const selectedColumn = schema.find(column => column.name === columnName);
  const operators = useMemo(() => filterOperators(selectedColumn), [selectedColumn]);

  useEffect(() => {
    if (open) setNotesDraft(dashboardNotes);
  }, [dashboardNotes, open]);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => {
    if (open) window.setTimeout(() => ref.current?.querySelector<HTMLButtonElement>('.workbench-tabs button.active')?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (importError) importErrorRef.current?.focus();
  }, [importError]);

  useEffect(() => {
    if (pendingImport) window.setTimeout(() => document.getElementById('confirm-dashboard-restore')?.focus(), 0);
  }, [pendingImport]);

  useEffect(() => {
    if (!selectedColumn && schema[0]) {
      setColumnName(schema[0].name);
      setOperator(filterOperators(schema[0])[0]);
    } else if (!operators.includes(operator)) {
      setOperator(operators[0]);
    }
  }, [operator, operators, schema, selectedColumn]);

  const addFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    if (!values.column || !values.value.trim()) return;
    onFilters([...filters, {
      id: `filter_${Date.now().toString(36)}`,
      column: values.column,
      operator: values.operator as FilterOperator,
      value: values.value.trim(),
    }]);
    event.currentTarget.reset();
  };

  const saveView = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    if (!values.name.trim() || !filters.length) return;
    onSavedViews([...savedViews, {
      id: `view_${Date.now().toString(36)}`,
      name: values.name.trim(),
      filters: filters.map(filter => ({ ...filter })),
    }]);
    event.currentTarget.reset();
  };

  const saveGoal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const widget = goalWidgets.find(candidate => widgetFingerprint(candidate) === values.widget);
    const target = Number(values.target);
    if (!widget || !Number.isFinite(target)) return;
    const goal: KpiGoal = {
      id: `goal_${Date.now().toString(36)}`,
      widgetFingerprint: widgetFingerprint(widget),
      label: widget.label,
      metric: widget.metric,
      aggregate: widget.aggregate || 'last',
      direction: values.direction === 'at-most' ? 'at-most' : 'at-least',
      target,
    };
    onKpiGoals([...kpiGoals.filter(candidate => candidate.widgetFingerprint !== goal.widgetFingerprint), goal]);
    event.currentTarget.reset();
  };

  return (
    <dialog id="analysis-workbench" className="mise-dialog workbench-dialog" ref={ref} aria-labelledby="workbench-title" onClose={onClose}>
      <div className="dialog-head">
        <div><div className="eyebrow eyebrow-accent">Analysis workbench</div><h2 id="workbench-title">Explore without changing the recipe.</h2></div>
        <CloseButton onClose={() => ref.current?.close()} />
      </div>
      <nav className="workbench-tabs" aria-label="Analysis tools">
        {TABS.map(value => (
          <button type="button" className={tab === value ? 'active' : ''} aria-pressed={tab === value} onClick={() => setTab(value)} key={value}>{value === 'notes' ? 'Notes & backup' : humanize(value)}</button>
        ))}
      </nav>
      <div className="dialog-body workbench-body">
        {tab === 'focus' && (
          <section className="workbench-section">
            <div className="workbench-intro"><div role="status" aria-live="polite"><span className="eyebrow">Focus filters</span><h3>{rows.length} of {allRows.length} rows in view</h3></div><button type="button" className="btn btn-ghost" disabled={!filters.length} onClick={() => onFilters([])}>Clear filters</button></div>
            <form id="focus-filter-form" className="workbench-form" onSubmit={addFilter}>
              <label><span>Column</span><select name="column" value={columnName} onChange={event => setColumnName(event.target.value)}>{schema.map(column => <option value={column.name} key={column.name}>{humanize(column.name)}</option>)}</select></label>
              <label><span>Rule</span><select name="operator" value={operator} onChange={event => setOperator(event.target.value as FilterOperator)}>{operators.map(value => <option value={value} key={value}>{OPERATOR_LABELS[value]}</option>)}</select></label>
              <label><span>Value</span><input name="value" type={selectedColumn?.type === 'number' ? 'number' : selectedColumn?.type === 'date' ? 'date' : 'text'} step="any" required /></label>
              <button type="submit" className="btn btn-primary">Add filter</button>
            </form>
            <div id="active-filter-list" className="active-filter-list">
              {!filters.length && <p>No filters active. Every widget uses the complete dataset.</p>}
              {filters.map(filter => <button type="button" key={filter.id} onClick={() => onFilters(filters.filter(candidate => candidate.id !== filter.id))}>{humanize(filter.column)} {OPERATOR_LABELS[filter.operator]} “{filter.value}” <span>×</span></button>)}
            </div>
            <div className="saved-view-panel">
              <div><span className="eyebrow">Saved views</span><p>Keep useful slices with this plate.</p></div>
              <form id="save-view-form" onSubmit={saveView}><label><span>View name</span><input name="name" placeholder="e.g. Enterprise only" required /></label><button type="submit" className="btn btn-ghost" disabled={!filters.length}>Save current view</button></form>
              <div id="saved-view-list">{savedViews.map(view => <article key={view.id}><button type="button" onClick={() => onFilters(view.filters.map(filter => ({ ...filter })))}><strong>{view.name}</strong><small>{view.filters.length} filter{view.filters.length === 1 ? '' : 's'}</small></button><button type="button" aria-label={`Delete ${view.name}`} onClick={() => onSavedViews(savedViews.filter(candidate => candidate.id !== view.id))}>×</button></article>)}</div>
            </div>
          </section>
        )}

        {tab === 'goals' && (
          <section className="workbench-section">
            <div className="workbench-intro"><div><span className="eyebrow">KPI goals</span><h3>Turn metrics into decisions.</h3></div></div>
            <form id="kpi-goal-form" className="workbench-form" onSubmit={saveGoal}>
              <label><span>Metric</span><select name="widget">{goalWidgets.map(widget => <option value={widgetFingerprint(widget)} key={widgetFingerprint(widget)}>{widget.label}</option>)}</select></label>
              <label><span>Goal</span><select name="direction"><option value="at-least">At least</option><option value="at-most">At most</option></select></label>
              <label><span>Target</span><input name="target" type="number" step="any" required /></label>
              <button type="submit" className="btn btn-primary" disabled={!goalWidgets.length}>Set goal</button>
            </form>
            <div id="kpi-goal-list" className="goal-list">
              {!goalEvaluations.length && <p>No goals yet. Goals stay local and update with filters or refreshed data.</p>}
              {goalEvaluations.map(goal => <article className={goal.met ? 'met' : ''} key={goal.id}><span>{goal.met ? 'Met' : 'Tracking'}</span><div><strong>{goal.label} {goal.direction === 'at-least' ? '≥' : '≤'} {formatCompact(goal.target, goal.metric)}</strong><small>Current · {goal.current === null ? '—' : formatCompact(goal.current, goal.metric)} · variance {goal.variance === null ? '—' : formatCompact(goal.variance, goal.metric)}</small></div><button type="button" aria-label={`Remove ${goal.label} goal`} onClick={() => onKpiGoals(kpiGoals.filter(candidate => candidate.id !== goal.id))}>×</button></article>)}
            </div>
          </section>
        )}

        {tab === 'discover' && (
          <section className="workbench-section discover-grid">
            <article className="discover-panel column-profile-panel">
              <span className="eyebrow">Column profiles · focused view</span>
              <h3>Know the shape before trusting the chart.</h3>
              <div id="column-profile-list">{profile.facts.map(fact => <div key={fact.column}><strong>{humanize(fact.column)}</strong><span>{fact.type}</span><small>{profileDetail(fact)}</small></div>)}</div>
            </article>
            <article className="discover-panel">
              <span className="eyebrow">Relationship finder · focused view</span>
              <h3>Strong numeric movement, found locally.</h3>
              <div id="correlation-list">{correlations.length ? correlations.map(item => <div key={`${item.left}-${item.right}`}><strong>{humanize(item.left)} ↔ {humanize(item.right)}</strong><span>{item.coefficient > 0 ? '+' : ''}{item.coefficient.toFixed(2)} · {item.strength} · n={item.observations}</span></div>) : <p>No moderate correlations with at least five complete observations were found in this view.</p>}</div>
              <small>Correlation is a lead to investigate, not evidence of causation.</small>
            </article>
            <article className="discover-panel">
              <span className="eyebrow">Privacy scan · full dataset</span>
              <h3>Potential sensitive fields stay visible to you.</h3>
              <small>Scanned all {allRows.length.toLocaleString()} rows locally.</small>
              <div id="privacy-finding-list">{privacyFindings.length ? privacyFindings.map(finding => <div className={finding.kind} key={finding.column}><strong>{humanize(finding.column)}</strong><span>{finding.kind}</span><small>{finding.reasons.join(' · ')}{finding.matchingRows ? ` · ${finding.matchingRows} matching rows` : ''}</small></div>) : <p>No obvious personal or credential fields detected.</p>}</div>
            </article>
            <article className="discover-panel">
              <span className="eyebrow">Suggested follow-ups</span>
              <h3>Useful next questions from this schema.</h3>
              <div id="follow-up-list">{followUps.map(question => <button type="button" key={question.id} onClick={() => onPrompt(question.prompt)}><strong>{question.label}</strong><small>{question.reason}</small></button>)}</div>
            </article>
          </section>
        )}

        {tab === 'brief' && <ExecutiveBriefPanel brief={brief} onInspect={onInspectBrief} onCopy={onCopyBrief} />}

        {tab === 'recipe' && (
          <RecipeInspectorPanel
            recipe={recipe}
            schema={schema}
            dataSource={dataSource}
            parseHealth={parseHealth}
            schemaOverrides={schemaOverrides}
            excludeOutliers={excludeOutliers}
          />
        )}

        {tab === 'notes' && (
          <section className="workbench-section notes-backup-grid">
            <article>
              <span className="eyebrow">Dashboard context</span>
              <h3>Leave the “why” beside the “what.”</h3>
              <label className="workbench-field"><span>Context note</span><textarea id="dashboard-notes" value={notesDraft} maxLength={4000} placeholder="Decision context, caveats, owners, or next steps…" onChange={event => setNotesDraft(event.target.value)} /></label>
              <button type="button" className="btn btn-primary" onClick={() => onDashboardNotes(notesDraft.trim())}>Save context</button>
            </article>
            <article>
              <span className="eyebrow">Portable backup</span>
              <h3>Move the whole working plate.</h3>
              <p>Backups contain the rows, recipe, filters, goals, notes, source settings, and theme. Nothing is uploaded.</p>
              <div className="dialog-actions"><button id="export-dashboard-bundle" type="button" className="btn btn-ghost" onClick={onExport}>Download backup</button><button id="import-dashboard-bundle" type="button" className="btn btn-ghost" onClick={() => importRef.current?.click()}>Restore backup</button></div>
              {pendingImport && <div id="backup-preview" className="backup-preview" role="status" aria-live="polite"><strong>{pendingImport.title}</strong><span>{pendingImport.rows.toLocaleString()} rows · saved {new Date(pendingImport.savedAt).toLocaleString()}</span><button id="confirm-dashboard-restore" type="button" className="btn btn-primary" onClick={() => {
                const error = onImport(pendingImport.source);
                if (error) {
                  setImportError(error);
                  return;
                }
                setPendingImport(null);
                setImportError('');
              }}>Restore this backup</button></div>}
              {importError && <div id="backup-import-error" className="dialog-error" role="alert" tabIndex={-1} ref={importErrorRef}>{importError}</div>}
              <input id="dashboard-bundle-input" ref={importRef} type="file" accept=".mise.json,.json,application/json" hidden onChange={event => {
                const file = event.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const source = String(reader.result || '');
                  try {
                    const dashboard = parseDashboardBundle(source);
                    setPendingImport({ source, title: dashboard.title, rows: dashboard.rows.length, savedAt: dashboard.savedAt });
                    setImportError('');
                  } catch (error) {
                    setPendingImport(null);
                    setImportError(error instanceof Error ? error.message : 'Could not read that backup.');
                  }
                };
                reader.readAsText(file);
                event.currentTarget.value = '';
              }} />
            </article>
            <article className="theme-article">
              <span className="eyebrow">Appearance</span>
              <h3>Pick the palette for this plate.</h3>
              <label className="theme-picker"><span>Theme</span><select id="theme-picker" value={theme} onChange={event => onTheme(event.target.value as DashboardTheme)}><option value="mise">Mise</option><option value="ink">Ink</option><option value="ocean">Ocean</option><option value="plum">Plum</option><option value="marketing">Marketing site</option></select></label>
            </article>
          </section>
        )}
      </div>
    </dialog>
  );
}
