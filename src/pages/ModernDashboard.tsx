import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { MetricCard, Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { TrendingUp, Users, Target, Activity, Building2, ArrowUpRight, Eye, MessageSquare } from 'lucide-react';
import { PeriodFilter } from '../components/PeriodFilter';
import { AnalyticsCards, PlanDistributionMini } from '../components/AnalyticsCards';
import { SimpleBarChart, SimplePieChart } from '../components/SimpleChart';
import { useAnalytics, useDefaultPeriod } from '../hooks/useAnalytics';
import { PeriodFilter as PeriodFilterType } from '../types/analytics';

type DashboardStats = {
  totalPages: number;
  totalVisitors: number;
  totalConversions: number;
  avgEngagementScore: number;
  totalCompanies?: number;
  totalUsers?: number;
  activeInstances?: number;
};

export const ModernDashboard: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const { user, company, currentRole, isImpersonating, isLoadingCompany, refreshCompany } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Analytics state (only for super admin)
  const defaultPeriod = useDefaultPeriod();
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodFilterType>(defaultPeriod);
  const [autoRefresh, setAutoRefresh] = useState(false);
  
  // Analytics data hook - only for super admin
  const shouldLoadAnalytics = currentRole === 'super_admin' && company?.company_type === 'parent';
  const { 
    data: analyticsData, 
    loading: analyticsLoading, 
    error: analyticsError,
    refresh: refreshAnalytics 
  } = useAnalytics(
    shouldLoadAnalytics ? selectedPeriod : { ...defaultPeriod, startDate: undefined, endDate: undefined }, 
    { 
      autoRefresh: shouldLoadAnalytics ? autoRefresh : false, 
      refreshInterval: 30000,
      companyId: shouldLoadAnalytics ? company?.id : undefined
    }
  );

  useEffect(() => {
    loadStats();
  }, [company]);

  const loadStats = async () => {
    if (!company) {
      setLoading(false);
      return;
    }

    try {
      const data = await api.getDashboardStats(company.id);
      setStats(data);
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Se estiver impersonando mas empresa não carregou, mostrar dashboard básico
  if (!company && isImpersonating) {
    const impersonatedCompanyId = localStorage.getItem('lovoo_crm_impersonated_company_id');
    const companyName = impersonatedCompanyId === 'b41a807e-6694-46c2-9f78-1246131c7220' ? 'Vox2you Tatuapé' : 
                       impersonatedCompanyId === 'c4f8d5e7-7c46-4836-aa86-f699f0a9139a' ? 'Instituto da Construção - Campo Limpo' : 
                       t('impersonation.fallbackCompanyName');
    
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              {t('impersonation.pageTitle', { name: companyName })}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {t('impersonation.subtitleViewingChild')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          <MetricCard
            title={t('metrics.landingPages')}
            value={0}
            subtitle={t('metrics.pagesOfCompany')}
            icon={<TrendingUp className="w-6 h-6" />}
            color="blue"
          />

          <MetricCard
            title={t('metrics.totalVisitors')}
            value={0}
            subtitle={t('metrics.uniqueVisitors')}
            icon={<Users className="w-6 h-6" />}
            color="green"
          />

          <MetricCard
            title={t('metrics.conversions')}
            value={0}
            subtitle={t('metrics.conversionRate', { rate: '0' })}
            icon={<Target className="w-6 h-6" />}
            color="purple"
          />

          <MetricCard
            title={t('metrics.avgEngagement')}
            value={0}
            subtitle={t('metrics.engagementScale')}
            icon={<Activity className="w-6 h-6" />}
            color="orange"
          />
        </div>

        <Card>
          <div className="text-center py-12">
            <Building2 className="w-12 h-12 text-blue-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {t('impersonation.childDashboardCard.title')}
            </h3>
            <p className="text-gray-600 mb-4">
              {t('impersonation.childDashboardCard.descriptionPrefix')}{' '}
              <strong>{companyName}</strong>
            </p>
            <p className="text-sm text-gray-500 mb-4">
              {t('impersonation.childDashboardCard.note')}
            </p>
            
            <div className="flex gap-2 justify-center">
              <Button 
                variant="secondary"
                onClick={async () => await refreshCompany()}
              >
                {t('impersonation.actions.reloadCompany')}
              </Button>
              <Button onClick={() => window.location.reload()}>
                {t('impersonation.actions.reloadPage')}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // Mostrar loading enquanto a empresa está sendo carregada
  if (isLoadingCompany) {
    return (
      <div className="flex items-center justify-center h-64">
        <Card className="text-center max-w-md">
          <div className="text-blue-600 mb-4 text-4xl">⏳</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('loadingCompany.title')}</h3>
          <p className="text-gray-600 mb-4">{t('loadingCompany.description')}</p>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </Card>
      </div>
    );
  }

  // Só mostrar erro se não estiver loading e não tiver empresa
  if (!company) {
    return (
      <div className="flex items-center justify-center h-64">
        <Card className="text-center max-w-md">
          <div className="text-red-600 mb-4 text-4xl">⚠️</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('errorNoCompany.title')}</h3>
          <p className="text-gray-600 mb-4">{t('errorNoCompany.description')}</p>
          <div className="space-y-3">
            <p className="text-sm text-gray-500">{t('errorNoCompany.debugUserId', { id: user?.id ?? '' })}</p>
            <p className="text-sm text-gray-500">
              {t('errorNoCompany.debugImpersonating', { value: localStorage.getItem('lovoo_crm_impersonating') ?? '' })}
            </p>
            <p className="text-sm text-gray-500">
              {t('errorNoCompany.debugCompanyId', { value: localStorage.getItem('lovoo_crm_impersonated_company_id') ?? '' })}
            </p>
            <div className="flex gap-2 justify-center">
              <Button onClick={() => window.location.reload()}>
                {t('errorNoCompany.reloadPage')}
              </Button>
              <Button 
                variant="secondary"
                onClick={async () => await refreshCompany()}
              >
                {t('errorNoCompany.reloadCompany')}
              </Button>
              <Button 
                variant="danger"
                onClick={async () => {
                  // Limpar localStorage e voltar ao super admin
                  localStorage.removeItem('lovoo_crm_impersonating');
                  localStorage.removeItem('lovoo_crm_impersonated_company_id');
                  localStorage.removeItem('lovoo_crm_original_user');
                  window.location.reload();
                }}
              >
                {t('errorNoCompany.clearAndReturnSuperAdmin')}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const conversionRate = stats && stats.totalVisitors > 0
    ? ((stats.totalConversions / stats.totalVisitors) * 100).toFixed(2)
    : '0.00';

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {currentRole === 'super_admin' ? t('header.titlePlatform') : t('header.titleDefault')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {currentRole === 'super_admin' 
              ? t('header.subtitlePlatform')
              : t('header.subtitleTenant')
            }
          </p>
        </div>
        <Button 
          variant="outline" 
          icon={<Eye className="w-4 h-4" />}
          onClick={() => window.open('/analytics', '_blank')}
        >
          {t('header.fullReportLink')}
        </Button>
      </div>

      {/* Metrics Grid */}
      <div className={`grid grid-cols-1 md:grid-cols-2 ${currentRole === 'super_admin' ? 'xl:grid-cols-3' : 'xl:grid-cols-4'} gap-6`}>
        {/* Métricas para empresas normais */}
        {currentRole !== 'super_admin' && (
          <>
            <MetricCard
              title={t('metrics.landingPages')}
              value={stats?.totalPages || 0}
              subtitle={t('metrics.activePages')}
              icon={<TrendingUp className="w-6 h-6" />}
              color="blue"
            />

            <MetricCard
              title={t('metrics.totalVisitors')}
              value={stats?.totalVisitors || 0}
              subtitle={t('metrics.uniqueVisitors')}
              icon={<Users className="w-6 h-6" />}
              color="green"
              trend={{
                value: "+12.5%",
                isPositive: true
              }}
            />

            <MetricCard
              title={t('metrics.conversions')}
              value={stats?.totalConversions || 0}
              subtitle={t('metrics.conversionRate', { rate: conversionRate })}
              icon={<Target className="w-6 h-6" />}
              color="purple"
              trend={{
                value: `${conversionRate}%`,
                isPositive: parseFloat(conversionRate) > 0
              }}
            />

            <MetricCard
              title={t('metrics.avgEngagement')}
              value={stats?.avgEngagementScore || 0}
              subtitle={t('metrics.engagementScale')}
              icon={<Activity className="w-6 h-6" />}
              color="orange"
            />
          </>
        )}

        {/* Métricas exclusivas para Super Admin (Empresa Pai) */}
        {currentRole === 'super_admin' && (
          <>
            <MetricCard
              title={t('metrics.clientCompanies')}
              value={stats?.totalCompanies || 0}
              subtitle={t('metrics.platformTotal')}
              icon={<Building2 className="w-6 h-6" />}
              color="purple"
            />
            
            <MetricCard
              title={t('metrics.totalUsers')}
              value={stats?.totalUsers || 0}
              subtitle={t('metrics.registeredUsers')}
              icon={<Users className="w-6 h-6" />}
              color="green"
            />
            
            <MetricCard
              title={t('metrics.activeInstances')}
              value={stats?.activeInstances || 0}
              subtitle={t('metrics.whatsappConnected')}
              icon={<MessageSquare className="w-6 h-6" />}
              color="blue"
            />
          </>
        )}
      </div>

      {/* Analytics Section - Only for Super Admin */}
      {shouldLoadAnalytics && (
        <div className="space-y-6">
          {/* Period Filter */}
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">{t('analyticsAdvanced.sectionTitle')}</h2>
            <PeriodFilter
              selectedPeriod={selectedPeriod}
              onPeriodChange={setSelectedPeriod}
              autoRefresh={autoRefresh}
              onAutoRefreshToggle={setAutoRefresh}
            />
          </div>

          {/* Analytics Cards */}
          {analyticsData && (
            <AnalyticsCards data={analyticsData} loading={analyticsLoading} />
          )}

          {/* Charts Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Growth Chart */}
            {analyticsData && (
              <SimpleBarChart
                data={analyticsData.growthData}
                title={t('analyticsAdvanced.growthChartTitle')}
                height={250}
              />
            )}

            {/* Plan Distribution Chart */}
            {analyticsData && (
              <SimplePieChart
                data={analyticsData.companiesByPlan}
                title={t('analyticsAdvanced.planDistributionChartTitle')}
              />
            )}
          </div>

          {/* Plan Details */}
          {analyticsData && analyticsData.companiesByPlan.length > 0 && (
            <Card>
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  {t('analyticsAdvanced.planDetailsTitle')}
                </h3>
                <PlanDistributionMini data={analyticsData} />
              </div>
            </Card>
          )}

          {/* Error State */}
          {analyticsError && (
            <Card className="border-red-200 bg-red-50">
              <div className="p-6 text-center">
                <div className="text-red-600 mb-2">{t('analyticsAdvanced.loadErrorTitle')}</div>
                <p className="text-sm text-red-700 mb-4">{analyticsError}</p>
                <Button 
                  variant="outline" 
                  onClick={refreshAnalytics}
                  className="border-red-300 text-red-700 hover:bg-red-100"
                >
                  {t('analyticsAdvanced.retry')}
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Company Info */}
        <Card className="xl:col-span-1">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">{t('companyInfo.title')}</h3>
            <div className={`w-3 h-3 rounded-full ${company?.status === 'active' ? 'bg-green-400' : 'bg-red-400'}`} />
          </div>
          
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-500">{t('companyInfo.fieldName')}</p>
              <p className="text-base font-medium text-gray-900">{company?.name}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">{t('companyInfo.fieldPlan')}</p>
              <div className="flex items-center gap-2">
                <span className="text-base font-medium text-gray-900 capitalize">{company?.plan}</span>
                {company?.plan === 'enterprise' && (
                  <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
                    {t('companyInfo.badgePremium')}
                  </span>
                )}
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-500">{t('companyInfo.fieldStatus')}</p>
              <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
                company?.status === 'active' 
                  ? 'bg-green-100 text-green-700' 
                  : 'bg-red-100 text-red-700'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  company?.status === 'active' ? 'bg-green-400' : 'bg-red-400'
                }`} />
                {company?.status === 'active' ? t('companyInfo.statusActive') : t('companyInfo.statusInactive')}
              </span>
            </div>
            {company?.domain && (
              <div>
                <p className="text-sm text-gray-500">{t('companyInfo.fieldDomain')}</p>
                <p className="text-base font-medium text-gray-900">{company.domain}</p>
              </div>
            )}
          </div>
        </Card>

        {/* Quick Actions */}
        <Card className="xl:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">{t('quickActions.title')}</h3>
            <ArrowUpRight className="w-5 h-5 text-gray-400" />
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Button 
              variant="outline" 
              className="justify-start h-auto p-4"
              onClick={() => window.location.href = '/landing-pages'}
            >
              <div className="text-left">
                <div className="font-medium">{t('quickActions.newLanding.title')}</div>
                <div className="text-sm text-gray-500">{t('quickActions.newLanding.subtitle')}</div>
              </div>
            </Button>

            {currentRole === 'super_admin' && (
              <Button 
                variant="outline" 
                className="justify-start h-auto p-4"
                onClick={() => window.location.href = '/companies'}
              >
                <div className="text-left">
                  <div className="font-medium">{t('quickActions.manageCompanies.title')}</div>
                  <div className="text-sm text-gray-500">{t('quickActions.manageCompanies.subtitle')}</div>
                </div>
              </Button>
            )}

            <Button 
              variant="outline" 
              className="justify-start h-auto p-4"
              onClick={() => window.location.href = '/settings'}
            >
              <div className="text-left">
                <div className="font-medium">{t('quickActions.settings.title')}</div>
                <div className="text-sm text-gray-500">{t('quickActions.settings.subtitle')}</div>
              </div>
            </Button>

            <Button 
              variant="outline" 
              className="justify-start h-auto p-4"
              onClick={() => window.open('https://docs.m4track.com', '_blank')}
            >
              <div className="text-left">
                <div className="font-medium">{t('quickActions.documentation.title')}</div>
                <div className="text-sm text-gray-500">{t('quickActions.documentation.subtitle')}</div>
              </div>
            </Button>
          </div>
        </Card>
      </div>

      {/* Recent Activity Placeholder */}
      <Card>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">{t('recentActivity.title')}</h3>
          <Button variant="ghost" size="sm">{t('recentActivity.viewAll')}</Button>
        </div>
        
        <div className="text-center py-12">
          <Activity className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h4 className="text-lg font-medium text-gray-900 mb-2">{t('recentActivity.emptyTitle')}</h4>
          <p className="text-gray-500">
            {t('recentActivity.emptyDescription')}
          </p>
        </div>
      </Card>
    </div>
  );
};
