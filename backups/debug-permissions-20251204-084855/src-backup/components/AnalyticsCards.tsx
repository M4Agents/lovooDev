import React from 'react';
import { TrendingUp, TrendingDown, Building2, Crown, BarChart3 } from 'lucide-react';
import { AnalyticsData } from '../types/analytics';
import { Card } from './ui/Card';

interface AnalyticsCardsProps {
  data: AnalyticsData;
  loading?: boolean;
}

export const AnalyticsCards: React.FC<AnalyticsCardsProps> = ({ data, loading = false }) => {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        {[...Array(4)].map((_, index) => (
          <Card key={index} className="animate-pulse">
            <div className="p-6">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-3"></div>
              <div className="h-8 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-2/3"></div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  const { periodComparison, averageDailyGrowth, companiesByPlan, topPlans } = data;
  const isGrowthPositive = periodComparison.growthPercentage > 0;
  const topPlan = topPlans[0];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
      {/* New Companies Card */}
      <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-blue-500 rounded-lg">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
              isGrowthPositive 
                ? 'bg-green-100 text-green-700' 
                : 'bg-red-100 text-red-700'
            }`}>
              {isGrowthPositive ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              {Math.abs(periodComparison.growthPercentage)}%
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="text-2xl font-bold text-gray-900">
              {data.newCompaniesCount}
            </h3>
            <p className="text-sm text-gray-600">Novas Empresas</p>
            <p className="text-xs text-gray-500">
              {periodComparison.growth > 0 ? '+' : ''}{periodComparison.growth} vs período anterior
            </p>
          </div>
        </div>
      </Card>

      {/* Average Daily Growth Card */}
      <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-green-500 rounded-lg">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
              Média
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="text-2xl font-bold text-gray-900">
              {averageDailyGrowth}
            </h3>
            <p className="text-sm text-gray-600">Empresas/Dia</p>
            <p className="text-xs text-gray-500">
              Crescimento médio diário
            </p>
          </div>
        </div>
      </Card>

      {/* Top Plan Card */}
      <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-purple-500 rounded-lg">
              <Crown className="w-5 h-5 text-white" />
            </div>
            <div className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
              Top Plan
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="text-2xl font-bold text-gray-900 capitalize">
              {topPlan?.plan || 'N/A'}
            </h3>
            <p className="text-sm text-gray-600">Plano Mais Popular</p>
            <p className="text-xs text-gray-500">
              {topPlan?.count || 0} empresas ({topPlan?.percentage || 0}%)
            </p>
          </div>
        </div>
      </Card>

      {/* Plan Distribution Card */}
      <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-orange-500 rounded-lg">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div className="px-2 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-medium">
              Planos
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="text-2xl font-bold text-gray-900">
              {companiesByPlan.length}
            </h3>
            <p className="text-sm text-gray-600">Tipos de Plano</p>
            <p className="text-xs text-gray-500">
              Distribuição ativa
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};

// Mini chart component for plan distribution
export const PlanDistributionMini: React.FC<{ data: AnalyticsData }> = ({ data }) => {
  const { companiesByPlan } = data;
  const total = companiesByPlan.reduce((sum, plan) => sum + plan.count, 0);

  if (total === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Nenhum dado disponível</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {companiesByPlan.slice(0, 5).map((plan) => (
        <div key={plan.plan} className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div 
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: plan.color }}
            />
            <span className="text-sm font-medium text-gray-700 capitalize">
              {plan.plan}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">
              {plan.count}
            </span>
            <span className="text-xs text-gray-500 min-w-[40px] text-right">
              {plan.percentage}%
            </span>
          </div>
        </div>
      ))}
      
      {companiesByPlan.length > 5 && (
        <div className="text-xs text-gray-500 text-center pt-2 border-t">
          +{companiesByPlan.length - 5} outros planos
        </div>
      )}
    </div>
  );
};
