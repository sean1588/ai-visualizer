import { metricValues } from './aggregation.ts';
import { formatCompact } from './formatting.ts';
import type {
  AlertEvaluation,
  DashboardRecipe,
  KpiAggregate,
  KpiWidget,
  ParseHealth,
  Row,
  SchemaColumn,
  ThresholdAlert,
} from './types.ts';
import type { DatasetComparison } from './recurring.ts';
import { contributingRows, widgetFingerprint } from './widgets.ts';

export interface ExecutiveBriefClaim {
  id: string;
  text: string;
  detail: string;
  supportingRows: number;
  widget: KpiWidget;
}

export interface ExecutiveBrief {
  title: string;
  summary: string;
  claims: ExecutiveBriefClaim[];
  health: string | null;
}

export function kpiNumericValue(
  metric: string,
  aggregate: KpiAggregate,
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
): number | null {
  const values = metricValues(metric, rows, schema);
  if (!values.length) return null;
  if (aggregate === 'count') return values.length;
  if (aggregate === 'sum') return values.reduce((sum, value) => sum + value, 0);
  if (aggregate === 'average') return values.reduce((sum, value) => sum + value, 0) / values.length;
  return values[values.length - 1];
}

export function evaluateAlerts(
  alerts: readonly ThresholdAlert[],
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
): AlertEvaluation[] {
  return alerts.map(alert => {
    const current = kpiNumericValue(alert.metric, alert.aggregate, rows, schema);
    return {
      ...alert,
      current,
      triggered: current !== null && (
        alert.operator === 'above'
          ? current > alert.threshold
          : current < alert.threshold
      ),
    };
  });
}

export function buildExecutiveBrief(
  recipe: DashboardRecipe,
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
  comparison: DatasetComparison | null,
  health: ParseHealth | null,
): ExecutiveBrief {
  const comparisons = new Map((comparison?.kpis || []).map(item => [item.fingerprint, item]));
  const claims = recipe.widgets.flatMap(widget => {
    if (widget.type !== 'kpi') return [];
    const aggregate = widget.aggregate || 'last';
    const current = kpiNumericValue(widget.metric, aggregate, rows, schema);
    if (current === null) return [];
    const fingerprint = widgetFingerprint(widget);
    const previous = comparisons.get(fingerprint);
    const formatted = formatCompact(current, widget.metric, widget.format, { rows, schema });
    const movement = previous?.percentChange === null || previous?.percentChange === undefined
      ? ''
      : `, ${previous.percentChange >= 0 ? 'up' : 'down'} ${Math.abs(previous.percentChange).toFixed(1)}% from the previous dataset`;
    return [{
      id: fingerprint,
      text: `${widget.label} is ${formatted}${movement}.`,
      detail: widget.rationale || `${aggregate} of ${widget.metric}`,
      supportingRows: contributingRows(widget, null, rows).length,
      widget,
    }];
  });
  const healthFlags = health?.issues.length || 0;
  return {
    title: `${recipe.title} — executive brief`,
    summary: `${claims.length} key metric${claims.length === 1 ? '' : 's'} across ${rows.length} row${rows.length === 1 ? '' : 's'}.`,
    claims,
    health: healthFlags
      ? `${healthFlags} data-health flag${healthFlags === 1 ? '' : 's'} should be reviewed alongside these claims.`
      : null,
  };
}

export function executiveBriefMarkdown(brief: ExecutiveBrief): string {
  const claims = brief.claims.map(claim =>
    `- **${claim.text}** ${claim.detail} ([${claim.supportingRows} supporting rows](#mise-widget-${encodeURIComponent(claim.id)}))`,
  );
  return [
    `# ${brief.title}`,
    '',
    brief.summary,
    '',
    '## Key metrics',
    '',
    ...claims,
    ...(brief.health ? ['', `> ${brief.health}`] : []),
    '',
    '_Generated locally by Mise. Verify linked claims against the contributing rows._',
  ].join('\n');
}
