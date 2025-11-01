import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import { 
  Users, Target, TrendingUp, Clock, MousePointer, Calendar, 
  Download, RefreshCw, Globe, Smartphone, Monitor,
  UserCheck, MapPin, Languages, Eye
} from 'lucide-react';
import { Heatmap } from '../components/Heatmap';

type AnalyticsData = {
  totalVisitors: number;
  uniqueVisitors: number;
  returningVisitors: number;
  newVisitors: number;
  totalSessions: number;
  avgSessionDuration: number;
  bounceRate: number;
  conversionRate: number;
  deviceBreakdown: Record<string, number>;
  referrerBreakdown: Record<string, number>;
  timezoneBreakdown: Record<string, number>;
  languageBreakdown: Record<string, number>;
  hourlyBreakdown: Record<string, number>;
  dailyBreakdown: Record<string, number>;
  visitors: any[];
  conversions: any[];
  totalConversions?: number; // Para compatibilidade
};

type DateRange = {
  start: string;
  end: string;
  label: string;
};

const DATE_RANGES: DateRange[] = [
  { start: '0', end: '0', label: 'Hoje' },
  { start: '1', end: '1', label: 'Ontem' },
  { start: '7', end: '0', label: 'Últimos 7 dias' },
  { start: '30', end: '0', label: 'Últimos 30 dias' },
  { start: '90', end: '0', label: 'Últimos 90 dias' },
];

export const Analytics: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'overview' | 'heatmap' | 'conversions'>('overview');
  const [selectedRange, setSelectedRange] = useState<DateRange>(DATE_RANGES[2]); // 7 dias
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [showCustomRange, setShowCustomRange] = useState(false);

  useEffect(() => {
    loadAnalytics();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      loadAnalytics();
    }, 30000);
    
    return () => clearInterval(interval);
  }, [id, selectedRange, customRange, showCustomRange]);

  const loadAnalytics = async () => {
    if (!id) return;

    try {
      console.log('Loading professional analytics for landing page ID:', id);
      
      // Determinar datas
      let startDate, endDate;
      if (showCustomRange && customRange.start && customRange.end) {
        startDate = customRange.start;
        endDate = customRange.end;
      } else {
        const now = new Date();
        const start = new Date(now);
        start.setDate(start.getDate() - parseInt(selectedRange.start));
        const end = new Date(now);
        end.setDate(end.getDate() - parseInt(selectedRange.end));
        
        startDate = start.toISOString().split('T')[0];
        endDate = end.toISOString().split('T')[0];
      }
      
      const analyticsData = await api.getProfessionalAnalytics(id, startDate, endDate);
      console.log('Professional analytics data received:', analyticsData);
      setData(analyticsData);
    } catch (error) {
      console.error('Error loading analytics:', error);
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

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-600">Erro ao carregar analytics</p>
      </div>
    );
  }

  const avgEngagement = data.conversions.length
    ? data.conversions.reduce((sum, c) => sum + (c.engagement_score || 0), 0) / data.conversions.length
    : 0;

  const avgTimeToConvert = data.conversions.length
    ? data.conversions.reduce((sum, c) => sum + (c.time_to_convert || 0), 0) / data.conversions.length
    : 0;

  const deviceBreakdown = data.visitors.reduce((acc: any, v) => {
    const device = v.device_type || 'unknown';
    acc[device] = (acc[device] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header com Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Analytics Pro</h1>
            <p className="text-slate-600 mt-1">Painel unificado com análises avançadas, heatmaps e conversões</p>
          </div>
          
          {/* Navegação entre views */}
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('overview')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                viewMode === 'overview'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              Overview
            </button>
            <button
              onClick={() => setViewMode('heatmap')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                viewMode === 'heatmap'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <MousePointer className="w-4 h-4" />
              Heatmap
            </button>
            <button
              onClick={() => setViewMode('conversions')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                viewMode === 'conversions'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Target className="w-4 h-4" />
              Conversões
            </button>
          </div>
          
          {/* Filtros de Data */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-2">
              {DATE_RANGES.map((range) => (
                <button
                  key={range.label}
                  onClick={() => {
                    setSelectedRange(range);
                    setShowCustomRange(false);
                  }}
                  className={`px-3 py-2 text-sm rounded-lg font-medium transition-colors ${
                    selectedRange.label === range.label && !showCustomRange
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {range.label}
                </button>
              ))}
            </div>
            
            {/* Período Customizado */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCustomRange(!showCustomRange)}
                className={`px-3 py-2 text-sm rounded-lg font-medium transition-colors flex items-center gap-2 ${
                  showCustomRange
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Calendar className="w-4 h-4" />
                Personalizado
              </button>
              
              {showCustomRange && (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={customRange.start}
                    onChange={(e) => setCustomRange(prev => ({ ...prev, start: e.target.value }))}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                  <span className="text-slate-500">até</span>
                  <input
                    type="date"
                    value={customRange.end}
                    onChange={(e) => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {viewMode === 'overview' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <Users className="w-6 h-6 text-blue-600" />
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">vs período anterior</p>
                  <p className="text-sm font-semibold text-green-600">+12.5%</p>
                </div>
              </div>
              <p className="text-sm font-medium text-slate-600 mb-1">Total de Visitantes</p>
              <p className="text-3xl font-bold text-slate-900">{data.totalVisitors.toLocaleString()}</p>
              <p className="text-xs text-slate-500 mt-2">Todas as sessões</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-green-100 rounded-lg">
                  <UserCheck className="w-6 h-6 text-green-600" />
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Taxa de retorno</p>
                  <p className="text-sm font-semibold text-blue-600">
                    {data.totalVisitors > 0 ? ((data.returningVisitors / data.totalVisitors) * 100).toFixed(1) : 0}%
                  </p>
                </div>
              </div>
              <p className="text-sm font-medium text-slate-600 mb-1">Visitantes Únicos</p>
              <p className="text-3xl font-bold text-slate-900">{data.uniqueVisitors.toLocaleString()}</p>
              <p className="text-xs text-slate-500 mt-2">
                {data.returningVisitors} recorrentes, {data.newVisitors} novos
              </p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-orange-100 rounded-lg">
                  <Clock className="w-6 h-6 text-orange-600" />
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Taxa de rejeição</p>
                  <p className="text-sm font-semibold text-red-600">{data.bounceRate.toFixed(1)}%</p>
                </div>
              </div>
              <p className="text-sm font-medium text-slate-600 mb-1">Duração Média</p>
              <p className="text-3xl font-bold text-slate-900">{Math.round(data.avgSessionDuration)}s</p>
              <p className="text-xs text-slate-500 mt-2">{data.totalSessions} sessões</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-purple-100 rounded-lg">
                  <Target className="w-6 h-6 text-purple-600" />
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Meta: 5%</p>
                  <p className={`text-sm font-semibold ${data.conversionRate >= 5 ? 'text-green-600' : 'text-orange-600'}`}>
                    {data.conversionRate >= 5 ? '✓' : '△'} {(data.conversionRate - 5).toFixed(1)}%
                  </p>
                </div>
              </div>
              <p className="text-sm font-medium text-slate-600 mb-1">Taxa de Conversão</p>
              <p className="text-3xl font-bold text-slate-900">{data.conversionRate.toFixed(2)}%</p>
              <p className="text-xs text-slate-500 mt-2">{data.conversions.length} conversões</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <MousePointer className="w-5 h-5" />
                Dispositivos
              </h2>
              <div className="space-y-3">
                {Object.entries(deviceBreakdown).map(([device, count]) => {
                  const percentage = ((count as number) / data.totalVisitors) * 100;
                  return (
                    <div key={device}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-slate-700 capitalize">{String(device)}</span>
                        <span className="text-sm text-slate-600">
                          {String(count)} ({percentage.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Conversões Recentes</h2>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {data.conversions.length === 0 ? (
                  <p className="text-slate-600 text-sm">Nenhuma conversão ainda</p>
                ) : (
                  data.conversions.slice(0, 10).map((conversion) => (
                    <div key={conversion.id} className="border-l-4 border-green-500 pl-3 py-2">
                      <p className="text-sm font-medium text-slate-900">
                        {conversion.form_data?.name || conversion.form_data?.email || 'Conversão'}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-600">
                          Score: {conversion.engagement_score}/10
                        </span>
                        <span className="text-xs text-slate-600">
                          {new Date(conversion.converted_at).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Detalhes Comportamentais</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Visitante</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Dispositivo</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Duração</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Scroll</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Cliques</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Score</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.conversions.map((conversion) => {
                    const summary = conversion.behavior_summary || {};
                    return (
                      <tr key={conversion.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-3 px-4 text-sm text-slate-900">
                          {conversion.form_data?.email?.substring(0, 20) || 'N/A'}
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600 capitalize">
                          {summary.device_type || 'N/A'}
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600">
                          {summary.session_duration ? `${summary.session_duration}s` : 'N/A'}
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600">
                          {summary.scroll_depth || 'N/A'}
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600">
                          {summary.total_clicks || 0}
                        </td>
                        <td className="py-3 px-4 text-sm">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            {conversion.engagement_score}/10
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            Convertido
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : viewMode === 'heatmap' ? (
        <Heatmap landingPageId={id!} />
      ) : (
        // Conversões
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Target className="w-5 h-5" />
            Conversões Detalhadas
          </h2>
          <div className="space-y-4">
            {data.conversions.length === 0 ? (
              <div className="text-center py-12">
                <Target className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <p className="text-slate-600">Nenhuma conversão registrada no período selecionado</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Lead</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Dispositivo</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Engagement</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Tempo p/ Converter</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.conversions.map((conversion) => (
                      <tr key={conversion.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-3 px-4 text-sm text-slate-900">
                          {conversion.form_data?.name || conversion.form_data?.email || 'Lead'}
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600 capitalize">
                          {conversion.behavior_summary?.device_type || 'N/A'}
                        </td>
                        <td className="py-3 px-4 text-sm">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            {conversion.engagement_score || 0}/10
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600">
                          {conversion.time_to_convert ? `${conversion.time_to_convert}s` : 'N/A'}
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600">
                          {new Date(conversion.converted_at).toLocaleString('pt-BR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
