import { useEffect, useRef, type FormEvent } from 'react';

import {
  executiveBriefMarkdown,
  formatCompact,
  widgetFingerprint,
  type AlertEvaluation,
  type DashboardRecipe,
  type DataSource,
  type ExecutiveBrief,
  type KpiWidget,
  type ParseHealth,
  type Row,
  type SchemaColumn,
  type SchemaOverrides,
  type ThresholdAlert,
} from './domain';

export function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && ref.current && !ref.current.open) ref.current.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return ref;
}

export function CloseButton({ onClose }: { onClose: () => void }) {
  return <button className="dialog-close" type="button" aria-label="Close" onClick={onClose}>×</button>;
}

function widgetAssumptions(widget: DashboardRecipe['widgets'][number]): string {
  if (widget.type === 'kpi') return `${widget.aggregate || 'last'} ${widget.metric} · ${widget.format || 'auto'}`;
  if (widget.type === 'line' || widget.type === 'bar') return `${widget.aggregate || 'auto'} ${widget.y} by ${widget.x} · ${widget.format || 'auto'}`;
  if (widget.type === 'donut' || widget.type === 'statlist') return `${widget.aggregate || 'auto'} ${widget.metric} by ${widget.cat} · ${widget.format || 'auto'}`;
  if (widget.type === 'countbar') return `count rows by ${widget.cat}`;
  if (widget.type === 'table') return `${widget.sort ? `sort ${widget.sort} ${widget.order || 'desc'} · ` : ''}limit ${widget.limit}`;
  if (widget.type === 'observations') return `${widget.observations.length} profile observations`;
  return widget.type;
}

export function RecipeInspectorPanel({
  recipe,
  schema,
  dataSource,
  parseHealth,
  schemaOverrides,
  excludeOutliers,
}: {
  recipe: DashboardRecipe | null;
  schema: SchemaColumn[];
  dataSource: DataSource | null;
  parseHealth: ParseHealth | null;
  schemaOverrides: SchemaOverrides;
  excludeOutliers: boolean;
}) {
  if (!recipe) return <section id="recipe-inspector" className="workbench-section"><p>Open a dashboard to inspect its recipe.</p></section>;
  return (
    <section id="recipe-inspector" className="workbench-section insight-panel">
      <div className="workbench-intro"><div><span className="eyebrow">Recipe inspector</span><h3>{recipe.title}</h3></div></div>
      <div>
        <div className="recipe-source">
          <span className="eyebrow">Source</span>
          <strong>{dataSource?.type === 'http' ? 'HTTP data' : 'Browser-local data'}</strong>
          {typeof dataSource?.url === 'string' && <code>{dataSource.url}</code>}
        </div>
        <div className="recipe-transformations">
          <span className="eyebrow">Transformations and policies</span>
          <ul>
            <li>{parseHealth?.format || 'unknown'} parser · {parseHealth?.rowsDropped || 0} dropped rows</li>
            <li>{excludeOutliers ? 'Last-point outlier exclusion enabled' : 'All outliers included'}</li>
            {Object.entries(schemaOverrides).map(([column, type]) => <li key={column}>{column} treated as {type}</li>)}
          </ul>
        </div>
        <div className="recipe-schema">
          <span className="eyebrow">Schema</span>
          <div>{schema.map(column => <code key={column.name}>{column.name} <b>{column.type}</b></code>)}</div>
        </div>
        <div id="recipe-widget-list" className="recipe-widget-list">
          {recipe.widgets.map((widget, index) => (
            <article key={`${widgetFingerprint(widget)}-${index}`}>
              <span className="recipe-widget-number">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h3>{widget.title || ('label' in widget ? widget.label : widget.type)}</h3>
                <code>{widget.type} · span {widget.span}/12 · {widgetAssumptions(widget)}</code>
                <p>{widget.rationale || 'No rationale supplied.'}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ExecutiveBriefPanel({
  brief,
  onInspect,
  onCopy,
}: {
  brief: ExecutiveBrief | null;
  onInspect: (widget: KpiWidget) => void;
  onCopy: (markdown: string) => void;
}) {
  if (!brief) return <section id="executive-brief" className="workbench-section"><p>Open a dashboard to read its brief.</p></section>;
  return (
    <section id="executive-brief" className="workbench-section insight-panel">
      <div className="workbench-intro">
        <div><span className="eyebrow">Executive brief</span><h3>{brief.title}</h3></div>
        <button id="copy-brief" type="button" className="btn btn-primary" onClick={() => onCopy(executiveBriefMarkdown(brief))}>Copy Markdown</button>
      </div>
      <div>
        <p className="brief-summary">{brief.summary}</p>
        <div id="brief-claims" className="brief-claims">
          {brief.claims.map(claim => (
            <article id={`mise-widget-${encodeURIComponent(claim.id)}`} key={claim.id}>
              <h3>{claim.text}</h3>
              <p>{claim.detail}</p>
              <button type="button" className="widget-action" onClick={() => onInspect(claim.widget)}>View {claim.supportingRows} supporting rows</button>
            </article>
          ))}
        </div>
        {brief.health && <p className="brief-health">{brief.health}</p>}
      </div>
    </section>
  );
}

export function AlertsDialog({
  open,
  recipe,
  rows,
  schema,
  evaluations,
  onClose,
  onAdd,
  onRemove,
}: {
  open: boolean;
  recipe: DashboardRecipe | null;
  rows: Row[];
  schema: SchemaColumn[];
  evaluations: AlertEvaluation[];
  onClose: () => void;
  onAdd: (alert: ThresholdAlert) => void;
  onRemove: (id: string) => void;
}) {
  const ref = useDialog(open);
  const kpis = recipe?.widgets.filter((widget): widget is KpiWidget => widget.type === 'kpi') || [];
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const widget = kpis.find(candidate => widgetFingerprint(candidate) === values.widget);
    const threshold = Number(values.threshold);
    if (!widget || !Number.isFinite(threshold)) return;
    onAdd({
      id: `alert_${Date.now().toString(36)}`,
      widgetFingerprint: widgetFingerprint(widget),
      label: widget.label,
      metric: widget.metric,
      aggregate: widget.aggregate || 'last',
      operator: values.operator === 'below' ? 'below' : 'above',
      threshold,
    });
    event.currentTarget.reset();
  };
  return (
    <dialog id="alerts-dialog" className="mise-dialog insight-dialog" ref={ref} onClose={onClose}>
      <div className="dialog-head">
        <div><div className="eyebrow eyebrow-accent">While-open alerts</div><h2>Local metric thresholds</h2></div>
        <CloseButton onClose={() => ref.current?.close()} />
      </div>
      <div className="dialog-body">
        <p className="dialog-copy">Alerts are evaluated in this browser after refreshes. Closing the dashboard stops them.</p>
        <form id="alert-form" className="alert-form" onSubmit={submit}>
          <label><span>Metric</span><select name="widget" required>{kpis.map(widget => <option value={widgetFingerprint(widget)} key={widgetFingerprint(widget)}>{widget.label}</option>)}</select></label>
          <label><span>Condition</span><select name="operator"><option value="above">Above</option><option value="below">Below</option></select></label>
          <label><span>Threshold</span><input name="threshold" type="number" step="any" required /></label>
          <button type="submit" className="btn btn-primary" disabled={!kpis.length}>Add alert</button>
        </form>
        <div id="alert-list" className="alert-list">
          {evaluations.length === 0 && <p>No thresholds configured.</p>}
          {evaluations.map(alert => (
            <article className={alert.triggered ? 'triggered' : ''} key={alert.id}>
              <span className="alert-state">{alert.triggered ? 'Triggered' : 'Watching'}</span>
              <div><strong>{alert.label} {alert.operator} {formatCompact(alert.threshold, alert.metric, 'auto', { rows, schema })}</strong><small>Current · {alert.current === null ? '—' : formatCompact(alert.current, alert.metric, 'auto', { rows, schema })}</small></div>
              <button type="button" aria-label={`Remove ${alert.label} alert`} onClick={() => onRemove(alert.id)}>×</button>
            </article>
          ))}
        </div>
      </div>
    </dialog>
  );
}
