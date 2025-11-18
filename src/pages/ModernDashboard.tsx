import React, { useEffect, useState } from 'react';
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
  const { user, company, isImpersonating, refreshCompany } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Analytics state (only for super admin)
  const defaultPeriod = useDefaultPeriod();
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodFilterType>(defaultPeriod);
  const [autoRefresh, setAutoRefresh] = useState(false);
  
  // Analytics data hook - only for super admin
  const shouldLoadAnalytics = company?.is_super_admin && company?.company_type === 'parent';
  const { 
    data: analyticsData, 
    loading: analyticsLoading, 
    error: analyticsError,
    refresh: refreshAnalytics 
  } = useAnalytics(
    shouldLoadAnalytics ? selectedPeriod : { ...defaultPeriod, startDate: undefined, endDate: undefined }, 
    { 
      autoRefresh: shouldLoadAnalytics ? autoRefresh : false, 
      refreshInterval: 30000 
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
                       'Empresa Impersonada';
    
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Dashboard - {companyName}</h1>
            <p className="text-sm text-gray-500 mt-1">
              Visualizando dados da empresa filha
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          <MetricCard
            title="Landing Pages"
            value={0}
            subtitle="Páginas desta empresa"
            icon={<TrendingUp className="w-6 h-6" />}
            color="blue"
          />

          <MetricCard
            title="Total de Visitantes"
            value={0}
            subtitle="Visitantes únicos"
            icon={<Users className="w-6 h-6" />}
            color="green"
          />

          <MetricCard
            title="Conversões"
            value={0}
            subtitle="Taxa: 0%"
            icon={<Target className="w-6 h-6" />}
            color="purple"
          />

          <MetricCard
            title="Engagement Médio"
            value={0}
            subtitle="de 10.0"
            icon={<Activity className="w-6 h-6" />}
            color="orange"
          />
        </div>

        <Card>
          <div className="text-center py-12">
            <Building2 className="w-12 h-12 text-blue-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Dashboard da Empresa Filha</h3>
            <p className="text-gray-600 mb-4">
              Você está visualizando o dashboard de <strong>{companyName}</strong>
            </p>
            <p className="text-sm text-gray-500 mb-4">
              Este é um ambiente isolado com dados específicos desta empresa.
            </p>
            
            <div className="flex gap-2 justify-center">
              <Button 
                variant="secondary"
                onClick={async () => await refreshCompany()}
              >
                Recarregar Empresa
              </Button>
              <Button onClick={() => window.location.reload()}>
                Recarregar Página
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="flex items-center justify-center h-64">
        <Card className="text-center max-w-md">
          <div className="text-red-600 mb-4 text-4xl">⚠️</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Empresa não encontrada</h3>
          <p className="text-gray-600 mb-4">Não foi possível carregar os dados da sua empresa.</p>
          <div className="space-y-3">
            <p className="text-sm text-gray-500">User ID: {user?.id}</p>
            <p className="text-sm text-gray-500">
              Impersonating: {localStorage.getItem('lovoo_crm_impersonating')}
            </p>
            <p className="text-sm text-gray-500">
              Company ID: {localStorage.getItem('lovoo_crm_impersonated_company_id')}
            </p>
            <div className="flex gap-2 justify-center">
              <Button onClick={() => window.location.reload()}>
                Recarregar Página
              </Button>
              <Button 
                variant="secondary"
                onClick={async () => await refreshCompany()}
              >
                Recarregar Empresa
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
                Limpar e Voltar ao Super Admin
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
            {company?.is_super_admin ? 'Dashboard da Plataforma' : 'Dashboard'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {company?.is_super_admin 
              ? 'Visão geral de toda a plataforma M4 Track' 
              : 'Visão geral das suas métricas'
            }
          </p>
        </div>
        <Button 
          variant="outline" 
          icon={<Eye className="w-4 h-4" />}
          onClick={() => window.open('/analytics', '_blank')}
        >
          Ver Relatório Completo
        </Button>
      </div>

      {/* Metrics Grid */}
      <div className={`grid grid-cols-1 md:grid-cols-2 ${company?.is_super_admin ? 'xl:grid-cols-3' : 'xl:grid-cols-4'} gap-6`}>
        {/* Métricas para empresas normais */}
        {!company?.is_super_admin && (
          <>
            <MetricCard
              title="Landing Pages"
              value={stats?.totalPages || 0}
              subtitle="Páginas ativas"
              icon={<TrendingUp className="w-6 h-6" />}
              color="blue"
            />

            <MetricCard
              title="Total de Visitantes"
              value={stats?.totalVisitors || 0}
              subtitle="Visitantes únicos"
              icon={<Users className="w-6 h-6" />}
              color="green"
              trend={{
                value: "+12.5%",
                isPositive: true
              }}
            />

            <MetricCard
              title="Conversões"
              value={stats?.totalConversions || 0}
              subtitle={`Taxa: ${conversionRate}%`}
              icon={<Target className="w-6 h-6" />}
              color="purple"
              trend={{
                value: `${conversionRate}%`,
                isPositive: parseFloat(conversionRate) > 0
              }}
            />

            <MetricCard
              title="Engagement Médio"
              value={stats?.avgEngagementScore || 0}
              subtitle="de 10.0"
              icon={<Activity className="w-6 h-6" />}
              color="orange"
            />
          </>
        )}

        {/* Métricas exclusivas para Super Admin (Empresa Pai) */}
        {company?.is_super_admin && (
          <>
            <MetricCard
              title="Empresas Clientes"
              value={stats?.totalCompanies || 0}
              subtitle="Total da plataforma"
              icon={<Building2 className="w-6 h-6" />}
              color="purple"
            />
            
            <MetricCard
              title="Total de Usuários"
              value={stats?.totalUsers || 0}
              subtitle="Usuários cadastrados"
              icon={<Users className="w-6 h-6" />}
              color="green"
            />
            
            <MetricCard
              title="Instâncias Ativas"
              value={stats?.activeInstances || 0}
              subtitle="WhatsApp conectados"
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
            <h2 className="text-xl font-semibold text-gray-900">Analytics Avançados</h2>
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
                title="Crescimento de Empresas no Período"
                height={250}
              />
            )}

            {/* Plan Distribution Chart */}
            {analyticsData && (
              <SimplePieChart
                data={analyticsData.companiesByPlan}
                title="Distribuição por Planos"
              />
            )}
          </div>

          {/* Plan Details */}
          {analyticsData && analyticsData.companiesByPlan.length > 0 && (
            <Card>
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Detalhes dos Planos
                </h3>
                <PlanDistributionMini data={analyticsData} />
              </div>
            </Card>
          )}

          {/* Error State */}
          {analyticsError && (
            <Card className="border-red-200 bg-red-50">
              <div className="p-6 text-center">
                <div className="text-red-600 mb-2">⚠️ Erro ao carregar analytics</div>
                <p className="text-sm text-red-700 mb-4">{analyticsError}</p>
                <Button 
                  variant="outline" 
                  onClick={refreshAnalytics}
                  className="border-red-300 text-red-700 hover:bg-red-100"
                >
                  Tentar Novamente
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
            <h3 className="text-lg font-semibold text-gray-900">Informações da Empresa</h3>
            <div className={`w-3 h-3 rounded-full ${company?.status === 'active' ? 'bg-green-400' : 'bg-red-400'}`} />
          </div>
          
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-500">Nome</p>
              <p className="text-base font-medium text-gray-900">{company?.name}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Plano</p>
              <div className="flex items-center gap-2">
                <span className="text-base font-medium text-gray-900 capitalize">{company?.plan}</span>
                {company?.plan === 'enterprise' && (
                  <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
                    Premium
                  </span>
                )}
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
                company?.status === 'active' 
                  ? 'bg-green-100 text-green-700' 
                  : 'bg-red-100 text-red-700'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  company?.status === 'active' ? 'bg-green-400' : 'bg-red-400'
                }`} />
                {company?.status === 'active' ? 'Ativo' : 'Inativo'}
              </span>
            </div>
            {company?.domain && (
              <div>
                <p className="text-sm text-gray-500">Domínio</p>
                <p className="text-base font-medium text-gray-900">{company.domain}</p>
              </div>
            )}
          </div>
        </Card>

        {/* Quick Actions */}
        <Card className="xl:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">Ações Rápidas</h3>
            <ArrowUpRight className="w-5 h-5 text-gray-400" />
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Button 
              variant="outline" 
              className="justify-start h-auto p-4"
              onClick={() => window.location.href = '/landing-pages'}
            >
              <div className="text-left">
                <div className="font-medium">Nova Landing Page</div>
                <div className="text-sm text-gray-500">Criar página para tracking</div>
              </div>
            </Button>

            {company?.is_super_admin && (
              <Button 
                variant="outline" 
                className="justify-start h-auto p-4"
                onClick={() => window.location.href = '/companies'}
              >
                <div className="text-left">
                  <div className="font-medium">Gerenciar Empresas</div>
                  <div className="text-sm text-gray-500">Adicionar nova empresa</div>
                </div>
              </Button>
            )}

            <Button 
              variant="outline" 
              className="justify-start h-auto p-4"
              onClick={() => window.location.href = '/settings'}
            >
              <div className="text-left">
                <div className="font-medium">Configurações</div>
                <div className="text-sm text-gray-500">Webhooks e API keys</div>
              </div>
            </Button>

            <Button 
              variant="outline" 
              className="justify-start h-auto p-4"
              onClick={() => window.open('https://docs.m4track.com', '_blank')}
            >
              <div className="text-left">
                <div className="font-medium">Documentação</div>
                <div className="text-sm text-gray-500">Guias e API docs</div>
              </div>
            </Button>
          </div>
        </Card>
      </div>

      {/* Recent Activity Placeholder */}
      <Card>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Atividade Recente</h3>
          <Button variant="ghost" size="sm">Ver Todas</Button>
        </div>
        
        <div className="text-center py-12">
          <Activity className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h4 className="text-lg font-medium text-gray-900 mb-2">Nenhuma atividade recente</h4>
          <p className="text-gray-500">
            Quando houver visitantes e conversões, elas aparecerão aqui.
          </p>
        </div>
      </Card>
    </div>
  );
};
