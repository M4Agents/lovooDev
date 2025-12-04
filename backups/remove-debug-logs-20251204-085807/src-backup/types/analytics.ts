export type PeriodType = 'today' | 'yesterday' | '7days' | '30days' | '90days' | 'custom';

export interface PeriodFilter {
  type: PeriodType;
  startDate?: Date;
  endDate?: Date;
  label: string;
}

export interface PlanDistribution {
  plan: string;
  count: number;
  percentage: number;
  color: string;
}

export interface CompanyGrowth {
  date: string;
  count: number;
  cumulative: number;
}

export interface PeriodComparison {
  current: number;
  previous: number;
  growth: number;
  growthPercentage: number;
}

export interface AnalyticsData {
  newCompaniesCount: number;
  companiesByPlan: PlanDistribution[];
  topPlans: PlanDistribution[];
  growthData: CompanyGrowth[];
  periodComparison: PeriodComparison;
  totalRevenue?: number;
  averageDailyGrowth: number;
}

export interface AnalyticsFilters {
  period: PeriodFilter;
  refreshInterval?: number;
}

// Predefined periods
export const PREDEFINED_PERIODS: Record<PeriodType, Omit<PeriodFilter, 'startDate' | 'endDate'>> = {
  today: {
    type: 'today',
    label: 'Hoje'
  },
  yesterday: {
    type: 'yesterday',
    label: 'Ontem'
  },
  '7days': {
    type: '7days',
    label: 'Últimos 7 dias'
  },
  '30days': {
    type: '30days',
    label: 'Últimos 30 dias'
  },
  '90days': {
    type: '90days',
    label: 'Últimos 90 dias'
  },
  custom: {
    type: 'custom',
    label: 'Período Personalizado'
  }
};

// Plan colors for charts
export const PLAN_COLORS: Record<string, string> = {
  basic: '#3B82F6',    // blue
  pro: '#10B981',      // green
  enterprise: '#8B5CF6', // purple
  start: '#F59E0B',    // amber
  professional: '#EF4444' // red
};
