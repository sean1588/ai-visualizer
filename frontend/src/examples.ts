import { SAMPLES } from './samples';
import type { DashboardRecipe, Row } from './domain';

export interface ExamplePlate {
  id: string;
  title: string;
  category: string;
  description: string;
  noteExample: string;
  chefExample: string;
  rows: Row[];
  recipe: DashboardRecipe<unknown>;
}

export const EXAMPLE_PLATES: ExamplePlate[] = [
  {
    id: 'saas',
    title: 'SaaS metrics',
    category: 'Recurring metrics',
    description: 'MRR, acquisition, churn, and NPS across a year.',
    noteExample: 'Treat MRR as the primary metric and call out churn above 18.',
    chefExample: 'Make MRR the hero and move churn beside it.',
    rows: SAMPLES.saas,
    recipe: {
      title: 'SaaS Growth Review',
      widgets: [
        { type: 'observations', span: 12, title: 'What stood out', rationale: 'A short evidence-backed brief makes the operating story scannable.', observations: ['MRR reaches $102.4k in December after rising throughout the year.', 'New customers finish at 184 while NPS improves to 61.', 'Churn reaches its yearly high of 22 in December.'] },
        { type: 'kpi', span: 3, title: 'Current MRR', rationale: 'The latest recurring revenue is the primary operating metric.', fields: { metric: 'mrr', aggregate: 'last', format: 'currency' } },
        { type: 'kpi', span: 3, title: 'New Customers', rationale: 'Acquisition volume explains part of recurring revenue growth.', fields: { metric: 'new_customers', aggregate: 'last', format: 'number' } },
        { type: 'kpi', span: 3, title: 'Churn', rationale: 'Latest churn is paired with growth to expose retention risk.', fields: { metric: 'churn', aggregate: 'last', format: 'number' } },
        { type: 'kpi', span: 3, title: 'NPS', rationale: 'NPS provides a customer-sentiment counterpoint to financial metrics.', fields: { metric: 'nps', aggregate: 'last', format: 'number' } },
        { type: 'line', span: 8, title: 'MRR Trend', rationale: 'The full time series shows whether revenue growth is sustained.', fields: { x: 'month', y: 'mrr', aggregate: 'last', format: 'currency' } },
        { type: 'bar', span: 4, title: 'Monthly churn', rationale: 'Bars make unusually high churn periods easy to spot.', fields: { x: 'month', y: 'churn', aggregate: 'last', format: 'number' } },
        { type: 'table', span: 12, title: 'Monthly metrics', rationale: 'The source table supports exact comparisons and export.', fields: { limit: 12, sort: 'month', order: 'asc' } },
      ],
    },
  },
  {
    id: 'payments',
    title: 'Payments operations',
    category: 'Payments',
    description: 'Payouts, fees, refunds, net receipts, and status.',
    noteExample: 'Prioritize net cash received and flag pending payouts.',
    chefExample: 'Show refunds as a percentage of payouts.',
    rows: SAMPLES.stripe,
    recipe: {
      title: 'Payments Operations',
      widgets: [
        { type: 'kpi', span: 4, title: 'Net received', rationale: 'Summed net receipts show cash delivered after fees and refunds.', fields: { metric: 'net', aggregate: 'sum', format: 'currency' } },
        { type: 'kpi', span: 4, title: 'Fees', rationale: 'Total fees quantify payment-processing cost.', fields: { metric: 'fees', aggregate: 'sum', format: 'currency' } },
        { type: 'kpi', span: 4, title: 'Refunds', rationale: 'Refund volume is the main deduction beyond fees.', fields: { metric: 'refunds', aggregate: 'sum', format: 'currency' } },
        { type: 'line', span: 8, title: 'Net receipts', rationale: 'Weekly net receipts reveal cash-flow direction and volatility.', fields: { x: 'date', y: 'net', aggregate: 'sum', format: 'currency' } },
        { type: 'donut', span: 4, title: 'Payouts by status', rationale: 'Status grouping separates settled and pending payout value.', fields: { cat: 'status', metric: 'payout', aggregate: 'sum', format: 'currency' } },
        { type: 'table', span: 12, title: 'Payout ledger', rationale: 'The ledger preserves exact payout-level details.', fields: { limit: 12, sort: 'date', order: 'desc' } },
      ],
    },
  },
  {
    id: 'public-api',
    title: 'Open-source portfolio',
    category: 'Public API',
    description: 'Repository activity shaped like a public API response.',
    noteExample: 'Use stars as reach and open issues as maintenance load.',
    chefExample: 'Rank the table by stars and show only the top five.',
    rows: [
      { repository: 'atlas', language: 'TypeScript', stars: 8420, forks: 712, open_issues: 84 },
      { repository: 'relay', language: 'Go', stars: 6190, forks: 488, open_issues: 31 },
      { repository: 'canvas', language: 'TypeScript', stars: 4740, forks: 396, open_issues: 57 },
      { repository: 'beacon', language: 'Python', stars: 3810, forks: 522, open_issues: 22 },
      { repository: 'harbor', language: 'Go', stars: 2950, forks: 281, open_issues: 46 },
      { repository: 'ledger', language: 'Rust', stars: 1880, forks: 164, open_issues: 13 },
    ],
    recipe: {
      title: 'Open-source Portfolio',
      widgets: [
        { type: 'kpi', span: 4, title: 'Total stars', rationale: 'Stars provide a directional measure of portfolio reach.', fields: { metric: 'stars', aggregate: 'sum', format: 'number' } },
        { type: 'kpi', span: 4, title: 'Total forks', rationale: 'Forks indicate active reuse beyond passive interest.', fields: { metric: 'forks', aggregate: 'sum', format: 'number' } },
        { type: 'kpi', span: 4, title: 'Open issues', rationale: 'Open issues approximate the current maintenance queue.', fields: { metric: 'open_issues', aggregate: 'sum', format: 'number' } },
        { type: 'bar', span: 6, title: 'Stars by repository', rationale: 'Repository ranking makes reach concentration visible.', fields: { x: 'repository', y: 'stars', aggregate: 'sum', format: 'number' } },
        { type: 'statlist', span: 6, title: 'Stars by language', rationale: 'Language totals show where community interest is concentrated.', fields: { cat: 'language', metric: 'stars', aggregate: 'sum', format: 'number' } },
        { type: 'table', span: 12, title: 'Repositories', rationale: 'Exact repository metrics support prioritization.', fields: { limit: 10, sort: 'stars', order: 'desc' } },
      ],
    },
  },
  {
    id: 'entities',
    title: 'Customer portfolio',
    category: 'Entities',
    description: 'Account health, ownership, plan, and annual value.',
    noteExample: 'Center enterprise risk and accounts without an owner.',
    chefExample: 'Replace the plan chart with account value by owner.',
    rows: [
      { account: 'Northstar', owner: 'Ava', plan: 'Enterprise', health: 'At risk', arr: 180000 },
      { account: 'Juniper', owner: 'Bea', plan: 'Growth', health: 'Healthy', arr: 72000 },
      { account: 'Keystone', owner: 'Ava', plan: 'Enterprise', health: 'Healthy', arr: 225000 },
      { account: 'Meridian', owner: 'Chen', plan: 'Growth', health: 'Watch', arr: 64000 },
      { account: 'Orchard', owner: null, plan: 'Starter', health: 'At risk', arr: 18000 },
      { account: 'Pioneer', owner: 'Chen', plan: 'Enterprise', health: 'Watch', arr: 142000 },
      { account: 'Quartz', owner: 'Bea', plan: 'Starter', health: 'Healthy', arr: 24000 },
    ],
    recipe: {
      title: 'Customer Portfolio',
      widgets: [
        { type: 'kpi', span: 4, title: 'Portfolio ARR', rationale: 'Total annual value sets the commercial scale of the portfolio.', fields: { metric: 'arr', aggregate: 'sum', format: 'currency' } },
        { type: 'countbar', span: 4, title: 'Accounts by health', rationale: 'Health distribution surfaces the concentration of customer risk.', fields: { cat: 'health' } },
        { type: 'donut', span: 4, title: 'ARR by plan', rationale: 'Plan mix shows which segment carries annual value.', fields: { cat: 'plan', metric: 'arr', aggregate: 'sum', format: 'currency' } },
        { type: 'statlist', span: 6, title: 'ARR by owner', rationale: 'Owner-level value supports workload and risk review.', fields: { cat: 'owner', metric: 'arr', aggregate: 'sum', format: 'currency' } },
        { type: 'table', span: 12, title: 'Account roster', rationale: 'The account roster keeps health findings traceable to entities.', fields: { limit: 10, sort: 'arr', order: 'desc' } },
      ],
    },
  },
  {
    id: 'messy',
    title: 'Messy revenue import',
    category: 'Data health',
    description: 'Missing values, repeated dates, and mixed date formats.',
    noteExample: 'Keep missing values visible and focus on segment totals.',
    chefExample: 'Add a table sorted by revenue and limit it to five rows.',
    rows: [
      { period: '2026-01-01', segment: 'SMB', revenue: 24000, owner: 'Ava' },
      { period: '2026-01-01', segment: 'Enterprise', revenue: 68000, owner: 'Bea' },
      { period: '2026-02-01', segment: 'SMB', revenue: null, owner: 'Ava' },
      { period: 'Feb 2026', segment: 'Enterprise', revenue: 72000, owner: 'Bea' },
      { period: 'unknown', segment: 'Mid-market', revenue: 41000, owner: null },
      { period: '2026-03-01', segment: 'SMB', revenue: 27000, owner: 'Ava' },
    ],
    recipe: {
      title: 'Messy Revenue Import',
      widgets: [
        { type: 'kpi', span: 4, title: 'Captured revenue', rationale: 'The sum uses every valid revenue value while missing cells stay visible.', fields: { metric: 'revenue', aggregate: 'sum', format: 'currency' } },
        { type: 'bar', span: 8, title: 'Revenue by segment', rationale: 'Segment aggregation remains useful despite inconsistent time values.', fields: { x: 'segment', y: 'revenue', aggregate: 'sum', format: 'currency' } },
        { type: 'table', span: 12, title: 'Imported rows', rationale: 'The raw table makes each missing or inconsistent value inspectable.', fields: { limit: 10, sort: 'revenue', order: 'desc' } },
      ],
    },
  },
];
