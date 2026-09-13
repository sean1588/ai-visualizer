import type { RenderedWidget, Row } from './types.ts';

function widgetRecord(widget: unknown): Record<string, unknown> | null {
  return widget && typeof widget === 'object' ? widget as Record<string, unknown> : null;
}

export function widgetMetric(widget: unknown): string | null {
  const record = widgetRecord(widget);
  const metric = record?.metric || record?.y;
  return typeof metric === 'string' ? metric : null;
}

export function widgetGroup(widget: unknown): string | null {
  const record = widgetRecord(widget);
  const group = record?.cat || record?.x;
  return typeof group === 'string' ? group : null;
}

export function inspectedColumn(widget: RenderedWidget): string | null {
  return widgetGroup(widget);
}

export function widgetFingerprint(widget: unknown): string {
  const record = widgetRecord(widget);
  if (!record?.type) return '';
  const type = String(record.type);
  if (type === 'kpi') {
    return `kpi:${record.metric || ''}:${record.aggregate || 'last'}:${record.format || 'auto'}:${record.label || record.title || ''}`;
  }
  if (type === 'line' || type === 'bar') {
    return `${type}:${String(record.x)}:${String(record.y)}:${record.aggregate || 'auto'}:${record.format || 'auto'}`;
  }
  if (type === 'donut' || type === 'statlist') {
    return `${type}:${String(record.cat)}:${String(record.metric)}:${record.aggregate || 'auto'}:${record.format || 'auto'}`;
  }
  if (type === 'countbar') return `countbar:${String(record.cat)}`;
  if (type === 'table') {
    return `table:${record.sort || ''}:${record.order || ''}:${record.limit || 10}`;
  }
  if (type === 'observations') {
    const observations = Array.isArray(record.observations) ? record.observations : [];
    return `observations:${observations.join('|')}`;
  }
  return type;
}

export function diffWidgets(
  oldWidgets: readonly unknown[],
  newWidgets: readonly unknown[],
): Set<string> {
  const oldFingerprints = new Set(oldWidgets.map(widgetFingerprint));
  const changed = new Set<string>();
  newWidgets.forEach(widget => {
    const fingerprint = widgetFingerprint(widget);
    if (!oldFingerprints.has(fingerprint)) changed.add(fingerprint);
  });
  return changed;
}

export function contributingRows(
  widget: RenderedWidget,
  selectedValue: unknown | null,
  rows: readonly Row[],
): Row[] {
  const group = widgetGroup(widget);
  const metric = widgetMetric(widget);
  return rows.filter(row => {
    if (
      selectedValue !== null
      && group
      && String(row[group] ?? '—') !== String(selectedValue)
    ) {
      return false;
    }
    return !metric
      || (typeof row[metric] === 'number' && Number.isFinite(row[metric]));
  });
}

export function hashString(value: unknown): number {
  let hash = 0;
  const text = String(value);
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
  }
  return Math.abs(hash);
}

export function widgetDisplayOrder(widgets: readonly { type: string }[]): number[] {
  const indices = widgets.map((_, index) => index);
  const observationsIndex = widgets.findIndex(widget => widget.type === 'observations');
  if (observationsIndex < 0) return indices;
  const withoutObservations = indices.filter(index => index !== observationsIndex);
  const first = withoutObservations[0];
  if (first === undefined || widgets[first].type !== 'kpi') return indices;
  let kpiRun = 0;
  while (kpiRun < withoutObservations.length && widgets[withoutObservations[kpiRun]].type === 'kpi') {
    kpiRun += 1;
  }
  return [...withoutObservations.slice(0, kpiRun), observationsIndex, ...withoutObservations.slice(kpiRun)];
}
