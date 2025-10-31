import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { TrendingUp, Users, MousePointer, Target, Activity } from 'lucide-react';

type DashboardStats = {
  totalPages: number;
  totalVisitors: number;
  totalConversions: number;
  avgEngagementScore: number;
};

export const Dashboard: React.FC = () => {
  const { company } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, [company]);

  const loadStats = async () => {
    if (!company) return;

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

  const conversionRate = stats && stats.totalVisitors > 0
    ? ((stats.totalConversions / stats.totalVisitors) * 100).toFixed(2)
    : '0.00';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-600 mt-1">Visão geral das suas métricas</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-blue-100 rounded-lg">
              <TrendingUp className="w-6 h-6 text-blue-600" />
            </div>
          </div>
          <p className="text-sm font-medium text-slate-600 mb-1">Landing Pages</p>
          <p className="text-3xl font-bold text-slate-900">{stats?.totalPages || 0}</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-emerald-100 rounded-lg">
              <Users className="w-6 h-6 text-emerald-600" />
            </div>
          </div>
          <p className="text-sm font-medium text-slate-600 mb-1">Total de Visitantes</p>
          <p className="text-3xl font-bold text-slate-900">{stats?.totalVisitors || 0}</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-green-100 rounded-lg">
              <Target className="w-6 h-6 text-green-600" />
            </div>
          </div>
          <p className="text-sm font-medium text-slate-600 mb-1">Conversões</p>
          <p className="text-3xl font-bold text-slate-900">{stats?.totalConversions || 0}</p>
          <p className="text-xs text-slate-500 mt-2">Taxa: {conversionRate}%</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-orange-100 rounded-lg">
              <Activity className="w-6 h-6 text-orange-600" />
            </div>
          </div>
          <p className="text-sm font-medium text-slate-600 mb-1">Engagement Médio</p>
          <p className="text-3xl font-bold text-slate-900">{stats?.avgEngagementScore || 0}</p>
          <p className="text-xs text-slate-500 mt-2">de 10.0</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Informações da Empresa</h2>
          <div className="space-y-3">
            <div>
              <p className="text-sm text-slate-600">Nome</p>
              <p className="text-base font-medium text-slate-900">{company?.name}</p>
            </div>
            <div>
              <p className="text-sm text-slate-600">Plano</p>
              <p className="text-base font-medium text-slate-900 capitalize">{company?.plan}</p>
            </div>
            <div>
              <p className="text-sm text-slate-600">Status</p>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                company?.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {company?.status === 'active' ? 'Ativo' : 'Inativo'}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl shadow-sm p-6 text-white">
          <h2 className="text-lg font-semibold mb-4">Comece Agora</h2>
          <p className="text-blue-100 mb-6">
            Configure sua primeira landing page e comece a coletar dados comportamentais dos seus visitantes.
          </p>
          <a
            href="/landing-pages"
            className="inline-flex items-center gap-2 bg-white text-blue-600 px-4 py-2 rounded-lg font-medium hover:bg-blue-50 transition-colors"
          >
            <MousePointer className="w-4 h-4" />
            Criar Landing Page
          </a>
        </div>
      </div>
    </div>
  );
};
