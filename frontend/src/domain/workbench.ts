import { kpiNumericValue } from './insights.ts';
import type {
  ColumnType,
  DashboardRecipe,
  KpiAggregate,
  KpiWidget,
  Row,
  SchemaColumn,
} from './types.ts';
import { widgetFingerprint } from './widgets.ts';

export type FilterOperator = 'equals' | 'contains' | 'at-least' | 'at-most' | 'after' | 'before';

export interface DashboardFilter {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string;
}

export interface SavedDashboardView {
  id: string;
  name: string;
  filters: DashboardFilter[];
}

export interface KpiGoal {
  id: string;
  widgetFingerprint: string;
  label: string;
  metric: string;
  aggregate: KpiAggregate;
  direction: 'at-least' | 'at-most';
  target: number;
}

export interface KpiGoalEvaluation extends KpiGoal {
  current: number | null;
  variance: number | null;
  progress: number | null;
  met: boolean;
}

export interface SensitiveColumnFinding {
  column: string;
  kind: 'personal' | 'credential';
  reasons: string[];
  matchingRows: number;
}

export interface CorrelationInsight {
  left: string;
  right: string;
  coefficient: number;
  strength: 'moderate' | 'strong';
}

export interface FollowUpQuestion {
  id: string;
  label: string;
  prompt: string;
  reason: string;
}

const OPERATOR_TYPES: Record<ColumnType, FilterOperator[]> = {
  number: ['at-least', 'at-most', 'equals'],
  date: ['after', 'before', 'equals'],
  category: ['equals', 'contains'],
  string: ['contains', 'equals'],
  object: ['contains'],
};

export function filterOperators(column: SchemaColumn | undefined): FilterOperator[] {
  return column ? OPERATOR_TYPES[column.type] : ['contains'];
}

function comparableValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function matchesFilter(row: Row, filter: DashboardFilter, schema: readonly SchemaColumn[]): boolean {
  const value = row[filter.column];
  const column = schema.find(candidate => candidate.name === filter.column);
  if (!column) return true;
  if (filter.operator === 'contains') {
    return comparableValue(value).toLocaleLowerCase().includes(filter.value.toLocaleLowerCase());
  }
  if (filter.operator === 'equals') {
    if (column.type === 'number') return Number(value) === Number(filter.value);
    return comparableValue(value).toLocaleLowerCase() === filter.value.toLocaleLowerCase();
  }
  if (filter.operator === 'at-least' || filter.operator === 'at-most') {
    const current = Number(value);
    const target = Number(filter.value);
    if (!Number.isFinite(current) || !Number.isFinite(target)) return false;
    return filter.operator === 'at-least' ? current >= target : current <= target;
  }
  const current = Date.parse(comparableValue(value));
  const target = Date.parse(filter.value);
  if (!Number.isFinite(current) || !Number.isFinite(target)) return false;
  return filter.operator === 'after' ? current >= target : current <= target;
}

export function applyDashboardFilters(
  rows: readonly Row[],
  filters: readonly DashboardFilter[],
  schema: readonly SchemaColumn[],
): Row[] {
  if (!filters.length) return [...rows];
  return rows.filter(row => filters.every(filter => matchesFilter(row, filter, schema)));
}

export function evaluateKpiGoals(
  goals: readonly KpiGoal[],
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
): KpiGoalEvaluation[] {
  return goals.map(goal => {
    const current = kpiNumericValue(goal.metric, goal.aggregate, rows, schema);
    const variance = current === null ? null : current - goal.target;
    const progress = current === null || goal.target === 0
      ? null
      : Math.max(0, Math.min(200, Math.abs(current / goal.target) * 100));
    return {
      ...goal,
      current,
      variance,
      progress,
      met: current !== null && (
        goal.direction === 'at-least'
          ? current >= goal.target
          : current <= goal.target
      ),
    };
  });
}

const PERSONAL_NAME = /(^|[_.\s-])(email|e-mail|phone|mobile|ssn|social[_.\s-]?security|first[_.\s-]?name|last[_.\s-]?name|full[_.\s-]?name|customer[_.\s-]?name|address|postcode|postal|zip|ip[_.\s-]?address|customer[_.\s-]?id|user[_.\s-]?id)($|[_.\s-])/i;
const CREDENTIAL_NAME = /(^|[_.\s-])(password|passwd|secret|token|api[_.\s-]?key|access[_.\s-]?key)($|[_.\s-])/i;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_VALUE = /^\+?[\d\s().-]{9,18}$/;

export function scanSensitiveColumns(
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
): SensitiveColumnFinding[] {
  return schema.flatMap(column => {
    const reasons: string[] = [];
    let kind: SensitiveColumnFinding['kind'] = 'personal';
    if (CREDENTIAL_NAME.test(column.name)) {
      reasons.push('field name suggests a credential or secret');
      kind = 'credential';
    } else if (PERSONAL_NAME.test(column.name)) {
      reasons.push('field name suggests personal data');
    }
    let matchingRows = 0;
    for (const row of rows.slice(0, 500)) {
      const value = comparableValue(row[column.name]).trim();
      if (!value) continue;
      if (EMAIL_VALUE.test(value)) {
        matchingRows++;
        if (!reasons.includes('values resemble email addresses')) reasons.push('values resemble email addresses');
      } else if (column.type !== 'number' && PHONE_VALUE.test(value)) {
        matchingRows++;
        if (!reasons.includes('values resemble phone numbers')) reasons.push('values resemble phone numbers');
      }
    }
    if (!reasons.length) return [];
    return [{ column: column.name, kind, reasons, matchingRows }];
  });
}

function pearson(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 3) return null;
  const leftMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const rightMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  let numerator = 0;
  let leftSquare = 0;
  let rightSquare = 0;
  for (const [left, right] of pairs) {
    const leftDelta = left - leftMean;
    const rightDelta = right - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquare += leftDelta ** 2;
    rightSquare += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftSquare * rightSquare);
  return denominator ? numerator / denominator : null;
}

export function findCorrelations(
  rows: readonly Row[],
  schema: readonly SchemaColumn[],
  minimum = 0.5,
): CorrelationInsight[] {
  const numbers = schema.filter(column => column.type === 'number').slice(0, 12);
  const insights: CorrelationInsight[] = [];
  for (let leftIndex = 0; leftIndex < numbers.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < numbers.length; rightIndex++) {
      const left = numbers[leftIndex].name;
      const right = numbers[rightIndex].name;
      const pairs = rows.flatMap(row => {
        const leftValue = row[left];
        const rightValue = row[right];
        return typeof leftValue === 'number'
          && Number.isFinite(leftValue)
          && typeof rightValue === 'number'
          && Number.isFinite(rightValue)
          ? [[leftValue, rightValue] as [number, number]]
          : [];
      });
      const coefficient = pearson(pairs);
      if (coefficient === null || Math.abs(coefficient) < minimum) continue;
      insights.push({
        left,
        right,
        coefficient,
        strength: Math.abs(coefficient) >= 0.8 ? 'strong' : 'moderate',
      });
    }
  }
  return insights
    .sort((first, second) => Math.abs(second.coefficient) - Math.abs(first.coefficient))
    .slice(0, 8);
}

export function buildFollowUpQuestions(
  recipe: DashboardRecipe,
  schema: readonly SchemaColumn[],
): FollowUpQuestion[] {
  const date = schema.find(column => column.type === 'date');
  const category = schema.find(column => column.type === 'category');
  const numbers = schema.filter(column => column.type === 'number');
  const primary = numbers[0];
  const secondary = numbers[1];
  const questions: FollowUpQuestion[] = [];
  if (date && primary) {
    questions.push({
      id: 'trend',
      label: `How is ${primary.name} changing?`,
      prompt: `Emphasize the trend in ${primary.name} over ${date.name}, including the latest direction.`,
      reason: 'A time field and numeric metric are available.',
    });
  }
  if (category && primary) {
    questions.push({
      id: 'segments',
      label: `Which ${category.name} leads?`,
      prompt: `Compare ${primary.name} across ${category.name}, sorted from highest to lowest.`,
      reason: 'A segment can explain where the metric comes from.',
    });
  }
  if (primary && secondary) {
    questions.push({
      id: 'relationship',
      label: `Do ${primary.name} and ${secondary.name} move together?`,
      prompt: `Add views that make the relationship between ${primary.name} and ${secondary.name} easy to assess.`,
      reason: 'Two numeric measures can reveal a useful relationship.',
    });
  }
  const table = recipe.widgets.find(widget => widget.type === 'table');
  if (table && primary) {
    questions.push({
      id: 'top-records',
      label: `What are the top ${primary.name} rows?`,
      prompt: `Sort the table by ${primary.name} descending and show the top 10 rows.`,
      reason: 'The dashboard already includes row-level detail.',
    });
  }
  return questions.slice(0, 4);
}

export function kpiGoalsFromRecipe(recipe: DashboardRecipe): KpiWidget[] {
  return recipe.widgets.filter((widget): widget is KpiWidget => widget.type === 'kpi');
}

export function goalForWidget(
  goals: readonly KpiGoalEvaluation[],
  widget: KpiWidget,
): KpiGoalEvaluation | undefined {
  return goals.find(goal => goal.widgetFingerprint === widgetFingerprint(widget));
}
