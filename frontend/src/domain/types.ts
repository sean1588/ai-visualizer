export type PrimitiveCell = string | number | boolean | null;
export type ObjectCell = Record<string, unknown> | unknown[];
export type CellValue = PrimitiveCell | ObjectCell;
export type Row = Record<string, CellValue | undefined>;

export type ColumnType = 'string' | 'category' | 'number' | 'date' | 'object';

export interface SchemaColumn {
  name: string;
  type: ColumnType;
  stat: string;
  unique: number;
  asPercent: boolean;
}

export type InputFormat = 'csv' | 'json' | 'unknown';

export interface IncomingHealth {
  rowsParsed: number;
  rowsDropped: number;
  format: InputFormat;
  irregularRows?: number;
  audit?: DataAuditEntry[];
}

export interface ParseHealth extends IncomingHealth {
  datesUnparsed: number;
  outlierCount: number;
  missingValues: number;
  duplicateTimeKeys: number;
  issues: DataHealthIssue[];
}

export type DataHealthIssueKind =
  | 'dropped-rows'
  | 'irregular-rows'
  | 'missing-values'
  | 'duplicate-time-keys'
  | 'inconsistent-dates'
  | 'outliers';

export interface DataHealthIssue {
  id: string;
  kind: DataHealthIssueKind;
  severity: 'info' | 'warning';
  title: string;
  detail: string;
  count: number;
  columns: string[];
  correction?: 'treat-as-date' | 'include-outliers';
}

export interface DataAuditEntry {
  at?: number;
  action: string;
  detail: string;
}

export type SchemaOverrides = Record<string, ColumnType>;
export type DashboardTheme = 'mise' | 'ink' | 'ocean' | 'plum';

export interface ThresholdAlert {
  id: string;
  widgetFingerprint: string;
  label: string;
  metric: string;
  aggregate: KpiAggregate;
  operator: 'above' | 'below';
  threshold: number;
}

export interface AlertEvaluation extends ThresholdAlert {
  current: number | null;
  triggered: boolean;
}

export type WidgetSpan = 3 | 4 | 6 | 8 | 12;
export type NumberFormat = 'auto' | 'number' | 'currency' | 'percent';
export type GroupAggregate = 'sum' | 'average' | 'last';
export type KpiAggregate = GroupAggregate | 'count';

interface CanonicalBase {
  span: WidgetSpan;
  title: string;
  rationale?: string;
}

export interface CanonicalKpiWidget extends CanonicalBase {
  type: 'kpi';
  fields: {
    metric: string;
    aggregate: KpiAggregate;
    format: NumberFormat;
    spark?: string;
  };
}

export interface CanonicalSeriesWidget extends CanonicalBase {
  type: 'line' | 'bar';
  fields: {
    x: string;
    y: string;
    aggregate: GroupAggregate;
    format: NumberFormat;
  };
}

export interface CanonicalGroupedWidget extends CanonicalBase {
  type: 'donut' | 'statlist';
  fields: {
    cat: string;
    metric: string;
    aggregate: GroupAggregate;
    format: NumberFormat;
  };
}

export interface CanonicalCountBarWidget extends CanonicalBase {
  type: 'countbar';
  fields: { cat: string };
}

export interface CanonicalTableWidget extends CanonicalBase {
  type: 'table';
  span: 12;
  fields: TableOptions;
}

export interface CanonicalObservationsWidget extends CanonicalBase {
  type: 'observations';
  span: 12;
  observations: string[];
}

export type CanonicalWidget =
  | CanonicalKpiWidget
  | CanonicalSeriesWidget
  | CanonicalGroupedWidget
  | CanonicalCountBarWidget
  | CanonicalTableWidget
  | CanonicalObservationsWidget;

interface RenderedBase {
  span: WidgetSpan;
  title?: string;
  rationale?: string;
}

export interface KpiWidget extends RenderedBase {
  type: 'kpi';
  label: string;
  metric: string;
  value: string;
  delta: number | null;
  aggregate?: KpiAggregate;
  format?: NumberFormat;
  excludedOutlier?: boolean;
  sparkCol?: string | null;
}

export interface SeriesWidget extends RenderedBase {
  type: 'line' | 'bar';
  title: string;
  x: string;
  y: string;
  aggregate?: GroupAggregate;
  format?: NumberFormat;
}

export interface GroupedWidget extends RenderedBase {
  type: 'donut' | 'statlist';
  title: string;
  cat: string;
  metric: string;
  aggregate?: GroupAggregate;
  format?: NumberFormat;
}

export interface CountBarWidget extends RenderedBase {
  type: 'countbar';
  title: string;
  cat: string;
}

export interface TableOptions {
  limit: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface TableWidget extends RenderedBase, TableOptions {
  type: 'table';
  span: 12;
  title: string;
}

export interface ObservationsWidget extends RenderedBase {
  type: 'observations';
  span: 12;
  title?: string;
  observations: string[];
}

export type RenderedWidget =
  | KpiWidget
  | SeriesWidget
  | GroupedWidget
  | CountBarWidget
  | TableWidget
  | ObservationsWidget;

export interface DashboardRecipe<W = RenderedWidget> {
  title: string;
  widgets: W[];
  fallback?: boolean;
  dataSource?: DataSource | null;
}

export interface DataSource {
  type: string;
  [key: string]: unknown;
}

export interface RecipePayload {
  title: string;
  schema: readonly SchemaColumn[];
  widgets: CanonicalWidget[];
  rowCount: number;
  dataSource: DataSource | null;
  generatedAt: string;
  generator: 'Mise v0.6';
}

export interface AggregatePoint {
  key: string;
  value: number;
}

export interface SeriesPoint {
  x: CellValue | undefined;
  y: number;
}
