import type { Row } from './domain';

export const SAMPLES: Record<string, Row[]> = {
  saas: [
    { month: 'Jan', mrr: 42000, new_customers: 84, churn: 12, nps: 38 },
    { month: 'Feb', mrr: 46500, new_customers: 91, churn: 14, nps: 41 },
    { month: 'Mar', mrr: 51200, new_customers: 102, churn: 11, nps: 44 },
    { month: 'Apr', mrr: 54800, new_customers: 96, churn: 18, nps: 42 },
    { month: 'May', mrr: 60100, new_customers: 118, churn: 13, nps: 47 },
    { month: 'Jun', mrr: 64900, new_customers: 124, churn: 15, nps: 49 },
    { month: 'Jul', mrr: 71200, new_customers: 138, churn: 16, nps: 52 },
    { month: 'Aug', mrr: 76800, new_customers: 142, churn: 14, nps: 54 },
    { month: 'Sep', mrr: 82300, new_customers: 151, churn: 17, nps: 53 },
    { month: 'Oct', mrr: 88100, new_customers: 159, churn: 19, nps: 56 },
    { month: 'Nov', mrr: 94500, new_customers: 168, churn: 18, nps: 58 },
    { month: 'Dec', mrr: 102400, new_customers: 184, churn: 22, nps: 61 },
  ],
  stripe: [
    { date: '2024-11-01', payout: 12450.32, fees: 384.21, refunds: 220, net: 11846.11, status: 'paid' },
    { date: '2024-11-08', payout: 14820.55, fees: 442.18, refunds: 95.5, net: 14282.87, status: 'paid' },
    { date: '2024-11-15', payout: 11203.41, fees: 336.1, refunds: 410, net: 10457.31, status: 'paid' },
    { date: '2024-11-22', payout: 16904.78, fees: 507.14, refunds: 0, net: 16397.64, status: 'paid' },
    { date: '2024-11-29', payout: 18221.09, fees: 546.63, refunds: 180, net: 17494.46, status: 'paid' },
    { date: '2024-12-06', payout: 21105.42, fees: 633.16, refunds: 64, net: 20408.26, status: 'paid' },
    { date: '2024-12-13', payout: 19872.18, fees: 596.16, refunds: 290, net: 18986.02, status: 'paid' },
    { date: '2024-12-20', payout: 24530.91, fees: 735.93, refunds: 120, net: 23674.98, status: 'paid' },
    { date: '2024-12-27', payout: 28102.44, fees: 843.07, refunds: 0, net: 27259.37, status: 'pending' },
  ],
};

export const SAMPLE_TITLES: Record<string, string> = {
  saas: 'SaaS growth · 12 months',
  stripe: 'Stripe payouts · Q4',
};
