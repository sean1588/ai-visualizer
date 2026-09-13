export type ProductEvent =
  | 'ingest_started'
  | 'dashboard_rendered'
  | 'assumption_edited'
  | 'chart_inspected'
  | 'focus_from_chart'
  | 'chef_edit'
  | 'recurring_refresh'
  | 'export_created'
  | 'health_action'
  | 'direct_edit';

type PropertyValue = string | number | boolean;

const ALLOWED_PROPERTIES: Record<ProductEvent, Set<string>> = {
  ingest_started: new Set(['source']),
  dashboard_rendered: new Set(['source', 'fallback', 'widgets']),
  assumption_edited: new Set(['widgetType']),
  chart_inspected: new Set(['widgetType']),
  focus_from_chart: new Set(['widgetType']),
  chef_edit: new Set(['scope', 'success']),
  recurring_refresh: new Set(['result', 'triggered']),
  export_created: new Set(['type']),
  health_action: new Set(['action']),
  direct_edit: new Set(['action']),
};

function safeValue(value: unknown): PropertyValue | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(-1_000_000, Math.min(1_000_000, value));
  if (typeof value === 'string' && /^[a-z0-9_-]{1,32}$/i.test(value)) return value;
  return null;
}

export function track(event: ProductEvent, properties: Record<string, unknown> = {}): void {
  try {
    if (localStorage.getItem('mise.telemetry.disabled') === '1') return;
    const allowed = ALLOWED_PROPERTIES[event];
    const safeProperties = Object.fromEntries(Object.entries(properties).flatMap(([key, value]) => {
      const safe = safeValue(value);
      return allowed.has(key) && safe !== null ? [[key, safe]] : [];
    }));
    void fetch('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, event, properties: safeProperties }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    return;
  }
}
