import { createContext, useContext, type MouseEvent } from 'react';

import {
  aggregateBy,
  chooseGroupMode,
  computeKpi,
  countBy,
  formatCompact,
  formatFull,
  hashString,
  humanize,
  metricValues,
  seriesBy,
  sortTableRows,
  widgetFingerprint,
  type DashboardRecipe,
  type GroupedWidget,
  type KpiComparison,
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
  schema: SchemaColumn[];
  changedWidgets: Set<string>;
  comparisons: KpiComparison[];
  excludeOutliers: boolean;
  onAssumptions: (index: number) => void;
  onInspect: (widget: RenderedWidget, selectedValue: unknown | null) => void;
  onRetry: () => void;
  onExportTable: (widget: TableWidget) => void;
  onCopyTable: (widget: TableWidget) => void;
  onEditWidget: (index: number, action: WidgetEditAction) => void;
  onChefWidget: (index: number) => void;
}

export type WidgetEditAction = 'move-up' | 'move-down' | 'resize' | 'duplicate' | 'remove';

interface WidgetEditor {
  count: number;
  onEdit: (index: number, action: WidgetEditAction) => void;
  onChef: (index: number) => void;
}

const WidgetEditorContext = createContext<WidgetEditor | null>(null);

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
}: {
  widget: RenderedWidget;
  index: number;
  meta?: string;
  inspect?: boolean;
  onAssumptions: (index: number) => void;
  onInspect: (widget: RenderedWidget, selectedValue: unknown | null) => void;
}) {
  const assumptions = assumptionText(widget);
  const editor = useContext(WidgetEditorContext);
  const edit = (action: WidgetEditAction, event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.closest('details')?.removeAttribute('open');
    editor?.onEdit(index, action);
  };
  return (
    <div className="w-actions">
      {meta && <span className="meta">{meta}</span>}
      {inspect && (
        <button type="button" className="widget-action" data-inspect-widget={widgetFingerprint(widget)} onClick={() => onInspect(widget, null)}>
          View rows
        </button>
      )}
      {assumptions && (
        <button
          type="button"
          className="assumption-chip"
          data-edit-assumptions={widgetFingerprint(widget)}
          title={widget.rationale}
          onClick={() => onAssumptions(index)}
        >
          {assumptions}
        </button>
      )}
      {widget.rationale && (
        <details className="widget-rationale">
          <summary>Why this?</summary>
          <p>{widget.rationale}</p>
        </details>
      )}
      {editor && (
        <details className="widget-edit">
          <summary>Edit</summary>
          <div className="widget-edit-menu">
            <button type="button" disabled={index === 0} onClick={event => edit('move-up', event)}>Move earlier</button>
            <button type="button" disabled={index === editor.count - 1} onClick={event => edit('move-down', event)}>Move later</button>
            <button type="button" disabled={widget.type === 'table' || widget.type === 'observations'} onClick={event => edit('resize', event)}>Resize · {widget.span}/12</button>
            <button type="button" onClick={event => edit('duplicate', event)}>Duplicate</button>
            <button type="button" disabled={editor.count === 1} onClick={event => edit('remove', event)}>Remove</button>
            <button type="button" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); editor.onChef(index); }}>Ask the Chef</button>
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

function KpiCard({
  widget,
  index,
  rows,
  schema,
  comparison,
  excludeOutliers,
  onAssumptions,
  onInspect,
}: {
  widget: KpiWidget;
  index: number;
  rows: Row[];
  schema: SchemaColumn[];
  comparison?: KpiComparison;
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
  return (
    <div className={`w w-kpi${changed ? ' has-data-change' : ''}`} style={{ gridColumn: `span ${widget.span}` }}>
      <div className="kpi-top">
        <div className="label">{widget.label}</div>
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
      {computed.excludedOutlier && (
        <div className="transform-chip" title="Last tick looked like an outlier, so the KPI uses the previous in-range value.">
          excl. outlier
        </div>
      )}
      {spark.length > 1 && <div className="kpi-spark"><Sparkline values={spark} /></div>}
    </div>
  );
}

function ObservationsCard({ widget }: { widget: ObservationsWidget }) {
  return (
    <div className="w w-obs" style={{ gridColumn: `span ${widget.span}` }}>
      <div className="w-hd">
        <h3>What stood out</h3>
        <span className="meta">computed profile · {widget.observations.length} note{widget.observations.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="obs-list">
        {widget.observations.map((observation, index) => (
          <li className="obs-item" key={`${index}-${observation}`}>
            <span className="obs-num">{String(index + 1).padStart(2, '0')}</span>
            <span className="obs-text">{observation}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DonutCard({
  widget,
  index,
  rows,
  schema,
  onAssumptions,
  onInspect,
}: {
  widget: GroupedWidget;
  index: number;
  rows: Row[];
  schema: SchemaColumn[];
  onAssumptions: (index: number) => void;
  onInspect: (widget: RenderedWidget, selectedValue: unknown | null) => void;
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
  return (
    <div className="w w-donut" style={{ gridColumn: `span ${widget.span}` }}>
      <div className="w-hd">
        <h3>{widget.title}</h3>
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
                className="chart-hit"
                role="button"
                tabIndex={0}
                data-inspect-widget={widgetFingerprint(widget)}
                data-inspect-value={encodeURIComponent(item.key)}
                d={path}
                fill={colors[dataIndex % colors.length]}
                opacity="0.9"
                onClick={() => onInspect(widget, item.key)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') onInspect(widget, item.key);
                }}
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
                className="legend-button"
                data-inspect-widget={widgetFingerprint(widget)}
                data-inspect-value={encodeURIComponent(item.key)}
                onClick={() => onInspect(widget, item.key)}
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
  onAssumptions,
  onInspect,
}: {
  widget: GroupedWidget;
  index: number;
  rows: Row[];
  schema: SchemaColumn[];
  onAssumptions: (index: number) => void;
  onInspect: (widget: RenderedWidget, selectedValue: unknown | null) => void;
}) {
  const data = aggregateBy(rows, widget.cat, widget.metric, widget.aggregate, schema);
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  return (
    <div className="w w-statlist" style={{ gridColumn: `span ${widget.span}` }}>
      <div className="w-hd">
        <h3>{widget.title}</h3>
        <WidgetActions widget={widget} index={index} meta={`${data.length} groups`} onAssumptions={onAssumptions} onInspect={onInspect} />
      </div>
      <ul className="sl">
        {data.map(item => (
          <li key={item.key}>
            <div className="sl-row">
              <button type="button" className="statlist-key" data-inspect-widget={widgetFingerprint(widget)} data-inspect-value={encodeURIComponent(item.key)} onClick={() => onInspect(widget, item.key)}>
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
  onAssumptions,
  onInspect,
}: {
  widget: Extract<RenderedWidget, { type: 'countbar' }>;
  index: number;
  rows: Row[];
  onAssumptions: (index: number) => void;
  onInspect: (widget: RenderedWidget, selectedValue: unknown | null) => void;
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
  return (
    <div className="w w-chart" style={{ gridColumn: `span ${widget.span}` }}>
      <div className="w-hd">
        <h3>{widget.title}</h3>
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
              className="chart-hit"
              role="button"
              tabIndex={0}
              data-inspect-widget={widgetFingerprint(widget)}
              data-inspect-value={encodeURIComponent(item.key)}
              x={x}
              y={y}
              width={barWidth * 0.7}
              height={height - paddingBottom - y}
              fill="var(--accent-2)"
              opacity="0.85"
              onClick={() => onInspect(widget, item.key)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') onInspect(widget, item.key);
              }}
            >
              <title>{item.key}: {item.value.toLocaleString()} rows</title>
            </rect>
          );
        })}
        {data.map((item, dataIndex) => <text key={item.key} className="axis-tick" x={paddingLeft + dataIndex * barWidth + barWidth / 2} y={height - 12} textAnchor="middle">{item.key.slice(0, 10)}</text>)}
      </svg>
      <ChartDataTable title={widget.title} columns={[humanize(widget.cat), 'Rows']} rows={data.map(item => [item.key, item.value])} />
    </div>
  );
}

function SeriesCard({
  widget,
  index,
  rows,
  schema,
  onAssumptions,
  onInspect,
}: {
  widget: SeriesWidget;
  index: number;
  rows: Row[];
  schema: SchemaColumn[];
  onAssumptions: (index: number) => void;
  onInspect: (widget: RenderedWidget, selectedValue: unknown | null) => void;
}) {
  const xType = schema.find(column => column.name === widget.x)?.type;
  const aggregateCategories = widget.type === 'bar' && (xType === 'category' || xType === 'string');
  const data = aggregateCategories
    ? aggregateBy(rows, widget.x, widget.y, widget.aggregate, schema).slice(0, 12).map(item => ({ x: item.key, y: item.value }))
    : seriesBy(rows, widget.x, widget.y, widget.aggregate, schema);
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
    <div className="w w-chart" style={{ gridColumn: `span ${widget.span}` }}>
      <div className="w-hd">
        <h3>{widget.title}</h3>
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
            {data.map((item, dataIndex) => (
              <circle
                key={`${String(item.x)}-${dataIndex}`}
                className="chart-hit"
                role="button"
                tabIndex={0}
                data-inspect-widget={widgetFingerprint(widget)}
                data-inspect-value={encodeURIComponent(String(item.x))}
                cx={xAt(dataIndex)}
                cy={yScale(item.y)}
                r="3.5"
                fill="var(--bg-elev)"
                stroke="var(--accent)"
                strokeWidth="1.25"
                onClick={() => onInspect(widget, item.x)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') onInspect(widget, item.x);
                }}
              >
                <title>{String(item.x)}: {String(formatFull(item.y, widget.y, widget.format, { rows, schema }))}</title>
              </circle>
            ))}
          </>
        ) : data.map((item, dataIndex) => {
          const y = yScale(item.y);
          return (
            <rect
              key={`${String(item.x)}-${dataIndex}`}
              className="chart-hit"
              role="button"
              tabIndex={0}
              data-inspect-widget={widgetFingerprint(widget)}
              data-inspect-value={encodeURIComponent(String(item.x))}
              x={paddingLeft + dataIndex * xStep + xStep * 0.15}
              y={y}
              width={xStep * 0.7}
              height={height - paddingBottom - y}
              fill={color}
              opacity="0.85"
              onClick={() => onInspect(widget, item.x)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') onInspect(widget, item.x);
              }}
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
  const fingerprint = widgetFingerprint(widget);
  return (
    <div className={`w w-table${fallback ? ' is-fallback' : ''}`} style={{ gridColumn: `span ${widget.span}` }}>
      <div className="w-hd">
        <h3>{widget.title}</h3>
        <WidgetActions widget={widget} index={index} inspect={false} meta={`${rows.length} rows · showing ${shown.length}`} onAssumptions={onAssumptions} onInspect={onInspect} />
      </div>
      <div className="table-toolbar">
        {transform && <span className="transform-chip" title="Chef transform applied to this table">{transform}</span>}
        <button type="button" className="btn btn-ghost table-export-btn" data-export-csv={fingerprint} onClick={() => onExport(widget)}>CSV ↓</button>
        <button type="button" className="btn btn-ghost table-export-btn" data-copy-md={fingerprint} onClick={() => onCopy(widget)}>Copy MD</button>
      </div>
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
  schema,
  changedWidgets,
  comparisons,
  excludeOutliers,
  onAssumptions,
  onInspect,
  onRetry,
  onExportTable,
  onCopyTable,
  onEditWidget,
  onChefWidget,
}: WidgetGridProps) {
  const comparisonsByWidget = new Map(comparisons.map(comparison => [comparison.fingerprint, comparison]));
  return (
    <WidgetEditorContext.Provider value={{ count: recipe.widgets.length, onEdit: onEditWidget, onChef: onChefWidget }}>
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
      {recipe.widgets.map((widget, index) => {
        const fingerprint = widgetFingerprint(widget);
        const className = changedWidgets.has(fingerprint) ? 'is-changed' : '';
        let content = null;
        if (widget.type === 'kpi') content = <KpiCard widget={widget} index={index} rows={rows} schema={schema} comparison={comparisonsByWidget.get(fingerprint)} excludeOutliers={excludeOutliers} onAssumptions={onAssumptions} onInspect={onInspect} />;
        else if (widget.type === 'observations') content = <ObservationsCard widget={widget} />;
        else if (widget.type === 'donut') content = <DonutCard widget={widget} index={index} rows={rows} schema={schema} onAssumptions={onAssumptions} onInspect={onInspect} />;
        else if (widget.type === 'statlist') content = <StatListCard widget={widget} index={index} rows={rows} schema={schema} onAssumptions={onAssumptions} onInspect={onInspect} />;
        else if (widget.type === 'countbar') content = <CountBarCard widget={widget} index={index} rows={rows} onAssumptions={onAssumptions} onInspect={onInspect} />;
        else if (widget.type === 'line' || widget.type === 'bar') content = <SeriesCard widget={widget} index={index} rows={rows} schema={schema} onAssumptions={onAssumptions} onInspect={onInspect} />;
        else if (widget.type === 'table') content = <TableCard widget={widget} index={index} rows={rows} schema={schema} fallback={!!recipe.fallback} onAssumptions={onAssumptions} onInspect={onInspect} onExport={onExportTable} onCopy={onCopyTable} />;
        return <div key={`${fingerprint}-${index}`} data-fp={fingerprint} className={className} style={{ display: 'contents' }}>{content}</div>;
      })}
      </div>
    </WidgetEditorContext.Provider>
  );
}
