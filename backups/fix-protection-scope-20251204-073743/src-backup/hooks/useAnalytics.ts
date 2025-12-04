import { useState, useEffect, useCallback } from 'react';
import { AnalyticsData, PeriodFilter, PREDEFINED_PERIODS } from '../types/analytics';
import { api } from '../services/api';

interface UseAnalyticsOptions {
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
  companyId?: string; // Company ID for analytics data
}

export const useAnalytics = (
  period: PeriodFilter,
  options: UseAnalyticsOptions = {}
) => {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { autoRefresh = false, refreshInterval = 30000, companyId } = options;

  const fetchAnalytics = useCallback(async () => {
    try {
      setError(null);
      
      if (!period.startDate || !period.endDate) {
        setData(null);
        setLoading(false);
        return;
      }

      const analyticsData = await api.getAnalyticsData(period, companyId);
      setData(analyticsData);
    } catch (err) {
      console.error('Error fetching analytics:', err);
      const errorMessage = err instanceof Error ? err.message : 'Erro ao carregar dados de analytics';
      setError(errorMessage);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period, companyId]);

  // Initial load and when period changes
  useEffect(() => {
    setLoading(true);
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Auto refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchAnalytics();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchAnalytics]);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchAnalytics();
  }, [fetchAnalytics]);

  return {
    data,
    loading,
    error,
    refresh
  };
};

// Helper hook to get default period (last 30 days)
export const useDefaultPeriod = (): PeriodFilter => {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 30);

  return {
    ...PREDEFINED_PERIODS['30days'],
    startDate,
    endDate: now
  };
};
