import { createContext, useContext, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type SyntheticEvent } from 'react';

import {
  aggregateBy,
  chooseGroupMode,
  computeKpi,
  countBy,
  formatCompact,
  formatFull,
  hashString,
  humanize,
  inspectedColumn,
  metricValues,
  rowsForWidget,
  seriesBy,
  sortTableRows,
  widgetDisplayOrder,
  widgetFingerprint,
  type DashboardFilter,
  type DashboardRecipe,
  type GroupedWidget,
  type KpiComparison,
  type KpiGoalEvaluation,
  type KpiWidget,
  type ObservationsWidget,
  type RenderedWidget,
  type Row,
  type SchemaColumn,
  type SeriesWidget,
  type TableWidget,
} from './domain';

interface WidgetGridProps {
  recipe: DashboardRecipe;
  rows: Row[];
  allRows: Row[];
  filters: DashboardFilter[];
  schema: SchemaColumn[];
  changedWidgets: Set<string>;
  comparisons: KpiComparison[];
  goals: KpiGoalEvaluation[];
  excludeOutliers: boolean;
  onAssumptions: (index: number) => void;
  onInspect: (widget: RenderedWidget, selectedValue: unknown | null) => void;
  onFocusValue: (widget: RenderedWidget, value: unknown) => void;
  onRetry: () => void;
  onExportTable: (widget: TableWidget) => void;
  onCopyTable: (widget: TableWidget) => void;
  onEditWidget: (index: number, action: WidgetEditAction, payload?: string) => void;
  onChefWidget: (index: number) => void;
}

export type WidgetEditAction = 'move-up' | 'move-down' | 'resize' | 'duplicate' | 'remove' | 'rename' | 'move-to';

interface WidgetEditor {
  count: number;
  renamingIndex: number | null;
  setRenamingIndex: (index: number | null) => void;
  onEdit: (index: number, action: WidgetEditAction, payload?: string) => void;
  onChef: (index: number) => void;
}

interface WidgetDragState {
  from: number;
  over: number | null;
  before: boolean;
  axis: 'x' | 'y';
}

interface WidgetDnd {
  drag: WidgetDragState | null;
  onHandleDragStart: (index: number, event: DragEvent<HTMLElement>) => void;
  onHandleDragEnd: () => void;
  onCardDragOver: (index: number, event: DragEvent<HTMLDivElement>) => void;
  onCardDrop: (index: number, event: DragEvent<HTMLDivElement>) => void;
}

const WidgetEditorContext = createContext<WidgetEditor | null>(null);
const WidgetDndContext = createContext<WidgetDnd | null>(null);

function widgetLabel(widget: RenderedWidget): string {
  if (widget.type === 'kpi') return widget.label;
  if (widget.type === 'observations') return widget.title || 'What stood out';
  return widget.title || humanize(widget.type);
}

function dropInsertsBefore(event: { clientX: number; clientY: number }, target: HTMLElement): { before: boolean; axis: 'x' | 'y' } {
  const rect = target.getBoundingClientRect();
  const midX = rect.left + rect.width / 2;
  const midY = rect.top + rect.height / 2;
  const axis: 'x' | 'y' = Math.abs(event.clientX - midX) > Math.abs(event.clientY - midY) ? 'x' : 'y';
  const before = axis === 'x' ? event.clientX < midX : event.clientY < midY;
  return { before, axis };
}

function destinationIndex(from: number, target: number, before: boolean): number {
  let destination = before ? target : target + 1;
  if (from < destination) destination -= 1;
  return destination;
}

function widgetCardClass(base: string, index: number, drag: WidgetDragState | null): string {
  const extras = [
    drag?.from === index ? 'is-dragging' : '',
    drag?.over === index ? `drop-${drag.before ? 'before' : 'after'}-${drag.axis}` : '',
  ].filter(Boolean);
  return [base, ...extras].join(' ');
}

function selectedEqualsValue(widget: RenderedWidget, filters: readonly DashboardFilter[]): string | null {
  const column = inspectedColumn(widget);
  if (!column) return null;
  return filters.find(filter => filter.column === column && filter.operator === 'equals')?.value ?? null;
}

function groupIsSelected(value: unknown, selectedValue: string | null): boolean {
  return selectedValue != null && String(value).toLocaleLowerCase() === selectedValue.toLocaleLowerCase();
}

function chartGroupClass(base: string, value: unknown, selectedValue: string | null): string {
  if (selectedValue == null) return base;
  return `${base} ${groupIsSelected(value, selectedValue) ? 'is-selected' : 'is-dimmed'}`;
}

function chartGroupAttrs(widget: RenderedWidget, value: unknown, selectedValue: string | null) {
  const selected = groupIsSelected(value, selectedValue);
  return {
    'data-inspect-widget': widgetFingerprint(widget),
    'data-inspect-value': encodeURIComponent(String(value)),
    ...(selected ? { 'data-selected': 'true' } : {}),
    ...(selectedValue != null ? { 'aria-pressed': selected } : {}),
  };
}

function bindChartValue(
  widget: RenderedWidget,
  selectedValue: string | null,
  onFocusValue: (widget: RenderedWidget, value: unknown) => void,
  onInspect: (widget: RenderedWidget, selectedValue: unknown | null) => void,
) {
  return (value: unknown) => {
    if (selectedValue != null) onFocusValue(widget, value);
    else onInspect(widget, value);
  };
}

function useWidgetCard(index: number) {
  const dnd = useContext(WidgetDndContext);
  return {
    className: (base: string) => widgetCardClass(base, index, dnd?.drag ?? null),
    props: {
      'data-widget-index': index,
      onDragOver: (event: DragEvent<HTMLDivElement>) => dnd?.onCardDragOver(index, event),
      onDrop: (event: DragEvent<HTMLDivElement>) => dnd?.onCardDrop(index, event),
    },
  };
}

export function InlineRename({
  value,
  as: Tag = 'h3',
  id,
  className,
  editing: editingProp,
  onEditingChange,
  onCommit,
}: {
  value: string;
  as?: 'h1' | 'h3' | 'div';
  id?: string;
  className?: string;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onCommit: (value: string) => void;
}) {
  const [internal, setInternal] = useState(false);
  const [draft, setDraft] = useState(value);
  const skipBlur = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editing = editingProp ?? internal;
  const setEditing = (next: boolean) => {
    if (onEditingChange) onEditingChange(next);
    else setInternal(next);
  };

  useEffect(() => {
    if (!editing) {
      setDraft(value);
      skipBlur.current = false;
    }
  }, [editing, value]);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === value) return;
    onCommit(next);
  };
  const cancel = () => {
    skipBlur.current = true;
    setDraft(value);
    setEditing(false);
  };
  const start = () => setEditing(true);

  if (editing) {
    return (
      <input
        ref={inputRef}
        id={id}
        className={['inline-rename-input', className].filter(Boolean).join(' ')}
        aria-label={`Rename ${value}`}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => {
          if (skipBlur.current) {
            skipBlur.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
        }}
      />
    );
  }

  return (
    <Tag
      id={id}
      className={className}
      tabIndex={0}
      onDoubleClick={start}
      onKeyDown={event => {
        if (event.key === 'F2' || event.key === 'Enter') {
          event.preventDefault();
          start();
        }
      }}
    >
      {value}
    </Tag>
  );
}

function WidgetTitle({ widget, index }: { widget: RenderedWidget; index: number }) {
  const editor = useContext(WidgetEditorContext);
  const value = widgetLabel(widget);
  return (
    <InlineRename
      as={widget.type === 'kpi' ? 'div' : 'h3'}
      className={widget.type === 'kpi' ? 'label' : undefined}
      value={value}
      editing={editor?.renamingIndex === index}
      onEditingChange={next => editor?.setRenamingIndex(next ? index : null)}
      onCommit={next => editor?.onEdit(index, 'rename', next)}
    />
  );
}

function assumptionText(widget: RenderedWidget): string {
  if (widget.type === 'kpi') return `${widget.aggregate || 'last'} · ${widget.metric} · ${widget.format || 'auto'}`;
  if (widget.type === 'line' || widget.type === 'bar') {
    return `${widget.aggregate || 'auto'} ${widget.y} by ${widget.x} · ${widget.format || 'auto'}`;
  }
  if (widget.type === 'donut' || widget.type === 'statlist') {
    return `${widget.aggregate || 'auto'} ${widget.metric} by ${widget.cat} · ${widget.format || 'auto'}`;
  }
  if (widget.type === 'countbar') return `count by ${widget.cat}`;
  if (widget.type === 'table') return tableTransformLabel(widget) || `first ${widget.limit || 10} rows`;
  return '';
}

function tableTransformLabel(widget: TableWidget): string {
  const parts: string[] = [];
  if (widget.sort) parts.push(`sort: ${widget.sort} ${widget.order || 'desc'}`);
  if (widget.limit) parts.push(`limit ${widget.limit}`);
  return parts.join(' · ');
}

function WidgetActions({
  widget,
  index,
  meta,
  inspect = true,
  onAssumptions,
  onInspect,
  onExport,
  onCopy,
}: {
  widget: RenderedWidget;
  index: number;
  meta?: string;
  inspect?: boolean;
  onAssumptions: (index: number) => void;
  onInspect: (widget: RenderedWidget, selectedValue: unknown | null) => void;
  onExport?: (widget: TableWidget) => void;
  onCopy?: (widget: TableWidget) => void;
}) {
  const assumptions = assumptionText(widget);
  const editor = useContext(WidgetEditorContext);
  const dnd = useContext(WidgetDndContext);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const title = widgetLabel(widget);
  const triggerId = `widget-menu-${index}`;
  const fingerprint = widgetFingerprint(widget);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const details = menuRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.removeAttribute('open');
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const close = () => {
    const details = menuRef.current;
    if (!details) return;
    details.removeAttribute('open');
    details.querySelector<HTMLElement>('summary')?.focus();
  };
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open) return;
    document.querySelectorAll<HTMLDetailsElement>('details.menu[open]').forEach(other => {
      if (other !== event.currentTarget) other.removeAttribute('open');
    });
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDetailsElement>) => {
    const details = menuRef.current;
    if (!details?.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const buttons = Array.from(details.querySelectorAll<HTMLButtonElement>('.menu-list button:not(:disabled)'));
      if (!buttons.length) return;
      const index = buttons.findIndex(button => button === document.activeElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length].focus();
    }
  };
  const edit = (action: WidgetEditAction, payload?: string) => {
    close();
    editor?.onEdit(index, action, payload);
  };

  return (
    <div className="w-actions">
      {meta && <span className="meta">{meta}</span>}
      {editor && (
        <span
          className="widget-drag-handle"
          draggable
          aria-hidden="true"
          onDragStart={event => dnd?.onHandleDragStart(index, event)}
          onDragEnd={() => dnd?.onHandleDragEnd()}
        >
          ⋮⋮
        </span>
      )}
      {editor && (
        <details className="menu widget-menu" ref={menuRef} onToggle={handleToggle} onKeyDown={handleKeyDown}>
          <summary id={triggerId} className="widget-menu-trigger" aria-haspopup="menu" aria-label={`Widget actions for ${title}`}>⋯</summary>
          <div className="menu-list" role="menu" aria-labelledby={triggerId}>
            {inspect && (
              <button
                type="button"
                role="menuitem"
                data-inspect-widget={fingerprint}
                onClick={() => { close(); onInspect(widget, null); }}
              >
                View rows
              </button>
            )}
            {assumptions && (
              <button
                type="button"
                role="menuitem"
                data-edit-assumptions={fingerprint}
                title={widget.rationale}
                onClick={() => { close(); onAssumptions(index); }}
              >
                Assumptions · {assumptions}
              </button>
            )}
            {widget.rationale && (
              <details className="widget-rationale">
                <summary>Why this?</summary>
                <p>{widget.rationale}</p>
              </details>
            )}
            <button type="button" role="menuitem" data-widget-rename={fingerprint} onClick={() => { close(); editor.setRenamingIndex(index); }}>Rename…</button>
            <button type="button" role="menuitem" disabled={index === 0} onClick={() => edit('move-up')}>Move earlier</button>
            <button type="button" role="menuitem" disabled={index === editor.count - 1} onClick={() => edit('move-down')}>Move later</button>
            {widget.type !== 'table' && widget.type !== 'observations' && (
              <button type="button" role="menuitem" onClick={() => edit('resize')}>Resize · {widget.span}/12</button>
            )}
            <button type="button" role="menuitem" onClick={() => edit('duplicate')}>Duplicate</button>
            <button type="button" role="menuitem" disabled={editor.count === 1} onClick={() => edit('remove')}>Remove</button>
            <button type="button" role="menuitem" onClick={() => { close(); editor.onChef(index); }}>Ask the Chef</button>
            {widget.type === 'table' && onExport && (
              <button type="button" role="menuitem" data-export-csv={fingerprint} onClick={() => { close(); onExport(widget); }}>CSV ↓</button>
            )}
            {widget.type === 'table' && onCopy && (
              <button type="button" role="menuitem" data-copy-md={fingerprint} onClick={() => { close(); onCopy(widget); }}>Copy MD</button>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (!values.length) return null;
  const width = 100;
  const height = 28;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  const step = width / Math.max(1, values.length - 1);
  const points = values.map((value, index) =>
    `${(index * step).toFixed(1)},${(height - ((value - minimum) / span) * height).toFixed(1)}`,
  ).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" width="100%" height={height}>
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function ChartDataTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}) {
  return (
    <details className="chart-data-table">
      <summary>View chart data</summary>
      <div className="table-scroll">
        <table aria-label={`${title} chart data`}>
          <thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => <tr key={index}>{row.map((value, valueIndex) => <td key={valueIndex}>{value}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

function ChartKeyboardPoints({
  title,
  points,
  selectedValue = null,
  inspectWidget,
  onInspect,
}: {
  title: string;
  points: Array<{ label: string; value: unknown }>;
  selectedValue?: string | null;
  inspectWidget: RenderedWidget;
  onInspect: (value: unknown) => void;
}) {
  return (
    <div className="chart-keyboard-points" aria-label={`${title} interactive points`}>
      {points.map((point, index) => (
        <button
          className={chartGroupClass('chart-keyboard-point', point.value, selectedValue)}
          type="button"
          key={`${point.label}-${index}`}
          {...chartGroupAttrs(inspectWidget, point.value, selectedValue)}
          onClick={() => onInspect(point.value)}
        >
          Inspect {point.label}
        </button>
      ))}
    </div>
  );
}

function KpiCard({
  widget,
  index,
  rows,
  schema,
  comparison,
  goal,
  excludeOutliers,
  onAssumptions,
  onInspect,
}: {
  widget: KpiWidget;
  index: number;
  rows: Row[];
  schema: SchemaColumn[];
  comparison?: KpiComparison;
  goal?: KpiGoalEvaluation;
  excludeOutliers: boolean;
  onAssumptions: (index: number) => void;
  onInspect: (widget: RenderedWidget, selectedValue: unknown | null) => void;
}) {
  const computed = computeKpi(
    widget.metric,
    rows,
    schema,
    widget.aggregate,
    widget.format,
    { excludeOutliers },
  );
  const spark = widget.sparkCol ? metricValues(widget.sparkCol, rows, schema) : [];
  const changed = comparison && comparison.absoluteChange !== 0;
  const card = useWidgetCard(index);
  return (
    <div className={card.className(`w w-kpi${changed ? ' has-data-change' : ''}`)} style={{ gridColumn: `span ${widget.span}` }} {...card.props}>
      <div className="kpi-top">
        <WidgetTitle widget={widget} index={index} />
        <WidgetActions widget={widget} index={index} onAssumptions={onAssumptions} onInspect={onInspect} />
      </div>
      <div className="value">{computed.value}</div>
      {computed.delta !== null && (
        <div className={`delta ${computed.delta < 0 ? 'neg' : ''}`}>
          {computed.delta >= 0 ? '↑' : '↓'} {Math.abs(computed.delta).toFixed(1)}% vs previous row
        </div>
      )}
      {comparison && (
        <div className={`dataset-delta ${comparison.absoluteChange < 0 ? 'neg' : ''}`}>
          <strong>
            {comparison.absoluteChange > 0 ? '+' : ''}
            {formatCompact(comparison.absoluteChange, widget.metric, widget.format, { rows, schema })}
          </strong>
          {' '}vs previous dataset · was {formatCompact(comparison.previous, widget.metric, widget.format, { rows, schema })}
        </div>
      )}
      {goal && (
        <div className={`kpi-goal ${goal.met ? 'met' : ''}`}>
          <div><span>{goal.met ? 'Goal met' : 'Goal'}</span><strong>{goal.direction === 'at-least' ? '≥' : '≤'} {formatCompact(goal.target, widget.metric, widget.format, { rows, schema })}</strong></div>
          <div className="kpi-goal-track"><i style={{ width: `${Math.min(100, goal.progress || 0)}%` }} /></div>
        </div>
      )}
      {computed.excludedOutlier && (
        <div className="transform-chip" title="Last tick looked like an outlier, so the KPI uses the previous in-range value.">
          excl. outlier
        </div>
      )}
      {spark.length > 1 && <div className="kpi-spark"><Sparkline values={spark} /></div>}
    </div>
  );
}

function ObservationItem({ index, observation }: { index: number; observation: string }) {
  return (
    <li className="obs-item">
      <span className="obs-num">{String(index + 1).padStart(2, '0')}</span>
      <span className="obs-text">{observation}</span>
    </li>
  );
}

function ObservationsCard({
  widget,
  index,
  onAssumptions,
  onInspect,
}: {
  widget: ObservationsWidget;
  index: number;
  onAssumptions: (index: number) => void;
  onInspect: (widget: RenderedWidget, selectedValue: unknown | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const card = useWidgetCard(index);
  const collapse = widget.observations.length > 2;
  const visible = collapse ? widget.observations.slice(0, 2) : widget.observations;
  const extra = collapse ? widget.observations.slice(2) : [];
  return (
    <div className={card.className('w w-obs')} style={{ gridColumn: `span ${widget.span}` }} {...card.props}>
      <div className="w-hd">
        <WidgetTitle widget={widget} index={index} />
        <WidgetActions
          widget={widget}
          index={index}
          meta={`computed profile · ${widget.observations.length} note${widget.observations.length === 1 ? '' : 's'}`}
          onAssumptions={onAssumptions}
          onInspect={onInspect}
        />
      </div>
      <ul className="obs-list">
        {visible.map((observation, observationIndex) => (
          <ObservationItem key={`${observationIndex}-${observation}`} index={observationIndex} observation={observation} />
        ))}
      </ul>
      {extra.length > 0 && (
        <details className="obs-more" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
          <summary>Show all {widget.observations.length}</summary>
          <ul className="obs-list">
            {extra.map((observation, extraIndex) => (
              <ObservationItem key={`${extraIndex + 2}-${observation}`} index={extraIndex + 2} observation={observation} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function DonutCard({
  widget,
  index,
  rows,
  schema,
  selectedValue,
  onAssumptions,
  onInspect,
  onFocusValue,
}: {
  widget: GroupedWidget;
  index: number;
  rows: Row[];
  schema: SchemaColumn[];
  selectedValue: string | null;
  onAssumptions: (index: number) => void;
  onInspect: (widget: RenderedWidget, selectedValue: unknown | null) => void;
  onFocusValue: (widget: RenderedWidget, value: unknown) => void;
}) {
  const mode = widget.aggregate || chooseGroupMode(rows, widget.cat, widget.metric, schema);
  const data = aggregateBy(rows, widget.cat, widget.metric, mode, schema).slice(0, 8);
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  const colors = ['var(--accent)', 'var(--accent-2)', 'var(--accent-3)', 'var(--accent-4)', '#7a5a3a', '#6b4f6b', '#3a5a5a', '#5a3a3a'];
  const centerX = 90;
  const centerY = 90;
  const radius = 70;
  const innerRadius = 44;
  let accumulated = 0;
  const card = useWidgetCard(index);
  const onSelect = bindChartValue(widget, selectedValue, onFocusValue, onInspect);
  return (
    <div className={card.className('w w-donut')} style={{ gridColumn: `span ${widget.span}` }} {...card.props}>
      <div className="w-hd">
        <WidgetTitle widget={widget} index={index} />
        <WidgetActions
          widget={widget}
          index={index}
          meta={`donut · ${data.length}${mode === 'last' ? ' · last' : ''}`}
          onAssumptions={onAssumptions}
          onInspect={onInspect}
        />
      </div>
      <div className="donut-body">
        <svg viewBox="0 0 180 180" width="180" height="180" role="group" aria-label={`${widget.title}. ${data.length} categories totaling ${String(formatFull(total, widget.metric, widget.format, { rows, schema }))}.`}>
          {data.map((item, dataIndex) => {
            const fraction = item.value / total;
            const start = accumulated * Math.PI * 2 - Math.PI / 2;
            accumulated += fraction;
            const end = accumulated * Math.PI * 2 - Math.PI / 2;
            const large = fraction > 0.5 ? 1 : 0;
            const x1 = centerX + Math.cos(start) * radius;
            const y1 = centerY + Math.sin(start) * radius;
            const x2 = centerX + Math.cos(end) * radius;
            const y2 = centerY + Math.sin(end) * radius;
            const x3 = centerX + Math.cos(end) * innerRadius;
            const y3 = centerY + Math.sin(end) * innerRadius;
            const x4 = centerX + Math.cos(start) * innerRadius;
            const y4 = centerY + Math.sin(start) * innerRadius;
            const path = `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 ${large} 0 ${x4} ${y4} Z`;
            return (
              <path
                key={item.key}
                className={chartGroupClass('chart-hit', item.key, selectedValue)}
                {...chartGroupAttrs(widget, item.key, selectedValue)}
                d={path}
                fill={colors[dataIndex % colors.length]}
                opacity="0.9"
                onClick={() => onSelect(item.key)}
              >
                <title>{item.key}: {String(formatFull(item.value, widget.metric, widget.format, { rows, schema }))}</title>
              </path>
            );
          })}
          <text x={centerX} y={centerY - 2} textAnchor="middle" fontFamily="var(--font-display)" fontStyle="italic" fontSize="22" fill="var(--fg)">
            {formatCompact(total, widget.metric, widget.format, { rows, schema })}
          </text>
          <text x={centerX} y={centerY + 14} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9" fill="var(--fg-mute)" letterSpacing="1">TOTAL</text>
        </svg>
        <ul className="donut-legend">
          {data.map((item, dataIndex) => (
            <li key={item.key}>
              <button
                type="button"
                className={chartGroupClass('legend-button', item.key, selectedValue)}
                {...chartGroupAttrs(widget, item.key, selectedValue)}
                onClick={() => onSelect(item.key)}
              >
                <span className="dot" style={{ background: colors[dataIndex % colors.length] }} />
                <span className="k">{item.key}</span>
                <span className="v">{formatCompact(item.value, widget.metric, widget.format, { rows, schema })}</span>
                <span className="p">{(item.value / total * 100).toFixed(0)}%</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <ChartDataTable
        title={widget.title}
        columns={[humanize(widget.cat), humanize(widget.metric), 'Share']}
        rows={data.map(item => [
          item.key,
          String(formatFull(item.value, widget.metric, widget.format, { rows, schema })),
          `${(item.value / total * 100).toFixed(1)}%`,
        ])}
      />
    </div>
  );
}

function StatListCard({
  widget,
  index,
  rows,
  schema,
  selectedValue,
  onAssumptions,
  onInspect,
  onFocusValue,
}: {
  widget: GroupedWidget;
  index: number;
  rows: Row[];
  schema: SchemaColumn[];
  selectedValue: string | null;
  onAssumptions: (index: number) => void;
  onInspect: (widget: RenderedWidget, selectedValue: unknown | null) => void;
  onFocusValue: (widget: RenderedWidget, value: unknown) => void;
}) {
  const data = aggregateBy(rows, widget.cat, widget.metric, widget.aggregate, schema);
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  const card = useWidgetCard(index);
  const onSelect = bindChartValue(widget, selectedValue, onFocusValue, onInspect);
  return (
    <div className={card.className('w w-statlist')} style={{ gridColumn: `span ${widget.span}` }} {...card.props}>
      <div className="w-hd">
        <WidgetTitle widget={widget} index={index} />
        <WidgetActions widget={widget} index={index} meta={`${data.length} groups`} onAssumptions={onAssumptions} onInspect={onInspect} />
      </div>
      <ul className="sl">
        {data.map(item => (
          <li key={item.key}>
            <div className="sl-row">
              <button type="button" className={chartGroupClass('statlist-key', item.key, selectedValue)} {...chartGroupAttrs(widget, item.key, selectedValue)} onClick={() => onSelect(item.key)}>
                {item.key}
              </button>
              <span className="sl-val">{formatCompact(item.value, widget.metric, widget.format, { rows, schema })}</span>
            </div>
            <div className="sl-bar"><div className="sl-fill" style={{ width: `${(item.value / total * 100).toFixed(1)}%` }} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CountBarCard({
  widget,
  index,
  rows,
  selectedValue,
  onAssumptions,
  onInspect,
  onFocusValue,
}: {
  widget: Extract<RenderedWidget, { type: 'countbar' }>;
  index: number;
  rows: Row[];
  selectedValue: string | null;
  onAssumptions: (index: number) => void;
  onInspect: (widget: RenderedWidget, selectedValue: unknown | null) => void;
  onFocusValue: (widget: RenderedWidget, value: unknown) => void;
}) {
  const data = countBy(rows, widget.cat).slice(0, 12);
  const width = 400;
  const height = 200;
  const paddingLeft = 44;
  const paddingRight = 12;
  const paddingTop = 18;
  const paddingBottom = 34;
  const maximum = Math.max(...data.map(item => item.value), 1);
  const barWidth = (width - paddingLeft - paddingRight) / Math.max(data.length, 1);
  const yScale = (value: number) => height - paddingBottom - (value / maximum) * (height - paddingTop - paddingBottom);
  const card = useWidgetCard(index);
  const onSelect = bindChartValue(widget, selectedValue, onFocusValue, onInspect);
  return (
    <div className={card.className('w w-chart')} style={{ gridColumn: `span ${widget.span}` }} {...card.props}>
      <div className="w-hd">
        <WidgetTitle widget={widget} index={index} />
        <WidgetActions widget={widget} index={index} meta={`count · ${data.length}`} onAssumptions={onAssumptions} onInspect={onInspect} />
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="group" aria-label={`${widget.title}. Counts for ${data.length} categories.`}>
        {Array.from({ length: 4 }, (_, tick) => {
          const value = maximum * (tick / 3);
          const y = yScale(value);
          return <g key={tick}><line className="grid-line" x1={paddingLeft} x2={width - paddingRight} y1={y} y2={y} /><text className="axis-tick" x={paddingLeft - 6} y={y + 3} textAnchor="end">{formatCompact(value)}</text></g>;
        })}
        {data.map((item, dataIndex) => {
          const x = paddingLeft + dataIndex * barWidth + barWidth * 0.15;
          const y = yScale(item.value);
          return (
            <rect
              key={item.key}
              className={chartGroupClass('chart-hit', item.key, selectedValue)}
              {...chartGroupAttrs(widget, item.key, selectedValue)}
              x={x}
              y={y}
              width={barWidth * 0.7}
              height={height - paddingBottom - y}
              fill="var(--accent-2)"
              opacity="0.85"
              onClick={() => onSelect(item.key)}
            >
              <title>{item.key}: {item.value.toLocaleString()} rows</title>
            </rect>
          );
        })}
        {data.map((item, dataIndex) => <text key={item.key} className="axis-tick" x={paddingLeft + dataIndex * barWidth + barWidth / 2} y={height - 12} textAnchor="middle">{item.key.slice(0, 10)}</text>)}
      </svg>
      <ChartKeyboardPoints title={widget.title} points={data.map(item => ({ label: `${item.key}: ${item.value} rows`, value: item.key }))} selectedValue={selectedValue} inspectWidget={widget} onInspect={onSelect} />
      <ChartDataTable title={widget.title} columns={[humanize(widget.cat), 'Rows']} rows={data.map(item => [item.key, item.value])} />
    </div>
  );
}

function SeriesCard({
  widget,
  index,
  rows,
  schema,
  selectedValue,
  onAssumptions,
  onInspect,
  onFocusValue,
}: {
  widget: SeriesWidget;
  index: number;
  rows: Row[];
  schema: SchemaColumn[];
  selectedValue: string | null;
  onAssumptions: (index: number) => void;
  onInspect: (widget: RenderedWidget, selectedValue: unknown | null) => void;
  onFocusValue: (widget: RenderedWidget, value: unknown) => void;
}) {
  const xType = schema.find(column => column.name === widget.x)?.type;
  const aggregateCategories = widget.type === 'bar' && (xType === 'category' || xType === 'string');
  const data = aggregateCategories
    ? aggregateBy(rows, widget.x, widget.y, widget.aggregate, schema).slice(0, 12).map(item => ({ x: item.key, y: item.value }))
    : seriesBy(rows, widget.x, widget.y, widget.aggregate, schema);
  const card = useWidgetCard(index);
  const onSelect = bindChartValue(widget, selectedValue, onFocusValue, onInspect);
  if (!data.length) return null;
  const width = widget.type === 'line' ? 700 : 400;
  const height = 200;
  const paddingLeft = 44;
  const paddingRight = widget.type === 'line' ? 16 : 12;
  const paddingTop = 18;
  const paddingBottom = 28;
  const yValues = data.map(item => item.y);
  const maximum = Math.max(...yValues);
  const minimum = Math.min(0, Math.min(...yValues));
  const yScale = (value: number) => height - paddingBottom - ((value - minimum) / (maximum - minimum || 1)) * (height - paddingTop - paddingBottom);
  const colors = ['var(--accent-2)', 'var(--accent-3)', 'var(--accent-4)'];
  const color = colors[hashString(`${widget.title}:${widget.x}:${widget.y}`) % colors.length];
  const xStep = widget.type === 'line'
    ? (width - paddingLeft - paddingRight) / Math.max(1, data.length - 1)
    : (width - paddingLeft - paddingRight) / data.length;
  const xAt = (dataIndex: number) => widget.type === 'line'
    ? paddingLeft + dataIndex * xStep
    : paddingLeft + dataIndex * xStep + xStep / 2;
  const points = data.map((item, dataIndex) => `${xAt(dataIndex)},${yScale(item.y)}`).join(' ');
  const labelEvery = Math.ceil(data.length / (widget.type === 'line' ? 8 : 6));
  const meta = `${widget.type} · ${data.length}${widget.type === 'line' ? ' pts' : aggregateCategories ? ' groups' : ''}`;
  return (
    <div className={card.className('w w-chart')} style={{ gridColumn: `span ${widget.span}` }} {...card.props}>
      <div className="w-hd">
        <WidgetTitle widget={widget} index={index} />
        <WidgetActions widget={widget} index={index} meta={meta} onAssumptions={onAssumptions} onInspect={onInspect} />
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={widget.span >= 12 ? 'tall' : ''} role="group" aria-label={`${widget.title}. ${data.length} ${widget.type === 'line' ? 'points' : 'bars'} from ${String(data[0].x)} to ${String(data[data.length - 1].x)}.`}>
        {Array.from({ length: widget.type === 'line' ? 5 : 4 }, (_, tick) => {
          const denominator = widget.type === 'line' ? 4 : 3;
          const value = minimum + (maximum - minimum) * (tick / denominator);
          const y = yScale(value);
          return <g key={tick}><line className="grid-line" x1={paddingLeft} x2={width - paddingRight} y1={y} y2={y} /><text className="axis-tick" x={paddingLeft - 6} y={y + 3} textAnchor="end">{formatCompact(value, widget.y, widget.format, { rows, schema })}</text></g>;
        })}
        {widget.type === 'line' ? (
          <>
            <polygon points={`${paddingLeft},${height - paddingBottom} ${points} ${xAt(data.length - 1)},${height - paddingBottom}`} fill="rgba(138,51,36,0.08)" />
            <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinejoin="round" />
            {data.map((item, dataIndex) => {
              const selected = groupIsSelected(item.x, selectedValue);
              return (
              <circle
                key={`${String(item.x)}-${dataIndex}`}
                className={chartGroupClass('chart-hit', item.x, selectedValue)}
                {...chartGroupAttrs(widget, item.x, selectedValue)}
                cx={xAt(dataIndex)}
                cy={yScale(item.y)}
                r={selected ? 5 : 3.5}
                fill={selected ? 'var(--accent)' : 'var(--bg-elev)'}
                stroke="var(--accent)"
                strokeWidth={selected ? 1.75 : 1.25}
                onClick={() => onSelect(item.x)}
              >
                <title>{String(item.x)}: {String(formatFull(item.y, widget.y, widget.format, { rows, schema }))}</title>
              </circle>
              );
            })}
          </>
        ) : data.map((item, dataIndex) => {
          const y = yScale(item.y);
          return (
            <rect
              key={`${String(item.x)}-${dataIndex}`}
              className={chartGroupClass('chart-hit', item.x, selectedValue)}
              {...chartGroupAttrs(widget, item.x, selectedValue)}
              x={paddingLeft + dataIndex * xStep + xStep * 0.15}
              y={y}
              width={xStep * 0.7}
              height={height - paddingBottom - y}
              fill={color}
              opacity="0.85"
              onClick={() => onSelect(item.x)}
            >
              <title>{String(item.x)}: {String(formatFull(item.y, widget.y, widget.format, { rows, schema }))}</title>
            </rect>
          );
        })}
        {data.filter((_, dataIndex) => dataIndex % labelEvery === 0).map(item => {
          const dataIndex = data.indexOf(item);
          return <text key={`${String(item.x)}-${dataIndex}`} className="axis-tick" x={xAt(dataIndex)} y={height - 10} textAnchor="middle">{String(item.x).slice(0, 7)}</text>;
        })}
      </svg>
      <ChartKeyboardPoints
        title={widget.title}
        points={data.map(item => ({
          label: `${String(item.x)}: ${String(formatFull(item.y, widget.y, widget.format, { rows, schema }))}`,
          value: item.x,
        }))}
        selectedValue={selectedValue}
        inspectWidget={widget}
        onInspect={onSelect}
      />
      <ChartDataTable
        title={widget.title}
        columns={[humanize(widget.x), humanize(widget.y)]}
        rows={data.map(item => [String(item.x), String(formatFull(item.y, widget.y, widget.format, { rows, schema }))])}
      />
    </div>
  );
}

function displayCell(value: unknown, column: SchemaColumn, rows: Row[], schema: SchemaColumn[]) {
  if (value && typeof value === 'object') {
    let serialized = '';
    try {
      serialized = JSON.stringify(value);
    } catch {
      serialized = '{…}';
    }
    return <span className="obj-chip" title={serialized}>{'{…}'}</span>;
  }
  if (column.type === 'number') return String(formatFull(value, column.name, 'auto', { rows, schema }));
  return String(value ?? '—');
}

function TableCard({
  widget,
  index,
  rows,
  schema,
  fallback,
  onAssumptions,
  onInspect,
  onExport,
  onCopy,
}: {
  widget: TableWidget;
  index: number;
  rows: Row[];
  schema: SchemaColumn[];
  fallback: boolean;
  onAssumptions: (index: number) => void;
  onInspect: (widget: RenderedWidget, selectedValue: unknown | null) => void;
  onExport: (widget: TableWidget) => void;
  onCopy: (widget: TableWidget) => void;
}) {
  const shown = sortTableRows(rows, schema, widget);
  const transform = tableTransformLabel(widget);
  const card = useWidgetCard(index);
  return (
    <div className={card.className(`w w-table${fallback ? ' is-fallback' : ''}`)} style={{ gridColumn: `span ${widget.span}` }} {...card.props}>
      <div className="w-hd">
        <WidgetTitle widget={widget} index={index} />
        <WidgetActions widget={widget} index={index} inspect={false} meta={`${rows.length} rows · showing ${shown.length}`} onAssumptions={onAssumptions} onInspect={onInspect} onExport={onExport} onCopy={onCopy} />
      </div>
      {transform && (
        <div className="table-toolbar">
          <span className="transform-chip" title="Chef transform applied to this table">{transform}</span>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead><tr>{schema.map(column => <th key={column.name} className={column.type === 'number' ? 'num' : ''}>{humanize(column.name)}</th>)}</tr></thead>
          <tbody>
            {shown.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {schema.map(column => <td key={column.name} className={column.type === 'number' ? 'num' : ''}>{displayCell(row[column.name], column, rows, schema)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function WidgetGrid({
  recipe,
  rows,
  allRows,
  filters,
  schema,
  changedWidgets,
  comparisons,
  goals,
  excludeOutliers,
  onAssumptions,
  onInspect,
  onFocusValue,
  onRetry,
  onExportTable,
  onCopyTable,
  onEditWidget,
  onChefWidget,
}: WidgetGridProps) {
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [drag, setDrag] = useState<WidgetDragState | null>(null);
  const dragRef = useRef<WidgetDragState | null>(null);
  dragRef.current = drag;
  const comparisonsByWidget = new Map(comparisons.map(comparison => [comparison.fingerprint, comparison]));
  const goalsByWidget = new Map(goals.map(goal => [goal.widgetFingerprint, goal]));
  const order = widgetDisplayOrder(recipe.widgets);
  const rowsByFingerprint = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const widget of recipe.widgets) {
      const fingerprint = widgetFingerprint(widget);
      if (!map.has(fingerprint)) map.set(fingerprint, rowsForWidget(widget, allRows, filters, schema));
    }
    return map;
  }, [allRows, filters, recipe.widgets, schema]);
  const dnd: WidgetDnd = {
    drag,
    onHandleDragStart: (index, event) => {
      event.dataTransfer.setData('text/plain', String(index));
      event.dataTransfer.effectAllowed = 'move';
      setDrag({ from: index, over: null, before: true, axis: 'x' });
    },
    onHandleDragEnd: () => setDrag(null),
    onCardDragOver: (index, event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const { before, axis } = dropInsertsBefore(event, event.currentTarget);
      setDrag(current => {
        if (!current) return current;
        if (current.over === index && current.before === before && current.axis === axis) return current;
        return { ...current, over: index, before, axis };
      });
    },
    onCardDrop: (index, event) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData('text/plain');
      const transferred = raw === '' ? Number.NaN : Number(raw);
      const from = Number.isInteger(transferred) ? transferred : dragRef.current?.from;
      const { before } = dropInsertsBefore(event, event.currentTarget);
      setDrag(null);
      if (from == null || !Number.isInteger(from)) return;
      const destination = destinationIndex(from, index, before);
      if (destination === from) return;
      onEditWidget(from, 'move-to', String(destination));
    },
  };
  return (
    <WidgetEditorContext.Provider value={{ count: recipe.widgets.length, renamingIndex, setRenamingIndex, onEdit: onEditWidget, onChef: onChefWidget }}>
      <WidgetDndContext.Provider value={dnd}>
      <div id="dash-grid" className="dash-grid">
      {recipe.fallback && (
        <div className="w w-banner" style={{ gridColumn: 'span 12' }}>
          <span className="banner-eyebrow">⚠ Couldn’t reach the AI</span>
          <span className="banner-msg">Showing a default layout based on your schema. Notes were kept — try again for an AI-designed dashboard.</span>
          <button type="button" className="btn btn-ghost retry-ai-btn" id="retry-ai-btn" onClick={onRetry}>Try again</button>
        </div>
      )}
      {!!recipe.rejectedWidgets && (
        <div id="rejected-widgets-banner" className="w w-banner w-banner-rejected" style={{ gridColumn: 'span 12' }}>
          <span className="banner-eyebrow">Recipe repaired</span>
          <span className="banner-msg">{recipe.rejectedWidgets} invalid model widget{recipe.rejectedWidgets === 1 ? ' was' : 's were'} rejected. The remaining dashboard uses only fields supported by this dataset.</span>
        </div>
      )}
      {order.map(index => {
        const widget = recipe.widgets[index];
        const fingerprint = widgetFingerprint(widget);
        const className = changedWidgets.has(fingerprint) ? 'is-changed' : '';
        const widgetRows = rowsByFingerprint.get(fingerprint) ?? rows;
        const selectedValue = selectedEqualsValue(widget, filters);
        let content = null;
        if (widget.type === 'kpi') content = <KpiCard widget={widget} index={index} rows={widgetRows} schema={schema} comparison={comparisonsByWidget.get(fingerprint)} goal={goalsByWidget.get(fingerprint)} excludeOutliers={excludeOutliers} onAssumptions={onAssumptions} onInspect={onInspect} />;
        else if (widget.type === 'observations') content = <ObservationsCard widget={widget} index={index} onAssumptions={onAssumptions} onInspect={onInspect} />;
        else if (widget.type === 'donut') content = <DonutCard widget={widget} index={index} rows={widgetRows} schema={schema} selectedValue={selectedValue} onAssumptions={onAssumptions} onInspect={onInspect} onFocusValue={onFocusValue} />;
        else if (widget.type === 'statlist') content = <StatListCard widget={widget} index={index} rows={widgetRows} schema={schema} selectedValue={selectedValue} onAssumptions={onAssumptions} onInspect={onInspect} onFocusValue={onFocusValue} />;
        else if (widget.type === 'countbar') content = <CountBarCard widget={widget} index={index} rows={widgetRows} selectedValue={selectedValue} onAssumptions={onAssumptions} onInspect={onInspect} onFocusValue={onFocusValue} />;
        else if (widget.type === 'line' || widget.type === 'bar') content = <SeriesCard widget={widget} index={index} rows={widgetRows} schema={schema} selectedValue={selectedValue} onAssumptions={onAssumptions} onInspect={onInspect} onFocusValue={onFocusValue} />;
        else if (widget.type === 'table') content = <TableCard widget={widget} index={index} rows={widgetRows} schema={schema} fallback={!!recipe.fallback} onAssumptions={onAssumptions} onInspect={onInspect} onExport={onExportTable} onCopy={onCopyTable} />;
        return <div key={`${fingerprint}-${index}`} data-fp={fingerprint} className={className} style={{ display: 'contents' }}>{content}</div>;
      })}
      </div>
      </WidgetDndContext.Provider>
    </WidgetEditorContext.Provider>
  );
}
