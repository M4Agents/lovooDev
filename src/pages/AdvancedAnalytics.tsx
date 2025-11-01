import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import { 
  Users, Target, Clock, Calendar, Download, RefreshCw, 
  Smartphone, Monitor, UserCheck, MapPin, Languages, Eye, 
  MousePointer, TrendingUp
} from 'lucide-react';
import { Heatmap } from '../components/Heatmap';

type DateRange = {
  start: string;
  end: string;
  label: string;
};

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
};

const DATE_RANGES: DateRange[] = [
  { start: '0', end: '0', label: 'Hoje' },
  { start: '1', end: '1', label: 'Ontem' },
  { start: '7', end: '0', label: 'Últimos 7 dias' },
  { start: '30', end: '0', label: 'Últimos 30 dias' },
  { start: '90', end: '0', label: 'Últimos 90 dias' },
];

export const AdvancedAnalytics: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRange, setSelectedRange] = useState<DateRange>(DATE_RANGES[2]);
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [viewMode, setViewMode] = useState<'overview' | 'heatmap' | 'conversions'>('overview');

  useEffect(() => {
    loadAnalytics();
    
    let interval: NodeJS.Timeout;
    if (autoRefresh) {
      interval = setInterval(() => {
        loadAnalytics();
      }, 60000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [id, selectedRange, customRange, showCustomRange]);

  const loadAnalytics = async () => {
    if (!id) return;

    try {
      setLoading(true);
      
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
      setData(analyticsData);
    } catch (error) {
      console.error('Error loading professional analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="ml-4 text-slate-600">Carregando Analytics Pro...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-600">Erro ao carregar analytics profissional</p>
      </div>
    );
  }

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
          
          {/* Seletor de Data Elegante */}
          <div className="relative">
            <button
              onClick={() => setShowCustomRange(!showCustomRange)}
              className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 min-w-[200px] justify-between"
            >
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                <span>{selectedRange.label}</span>
              </div>
              <svg className={`w-4 h-4 transition-transform ${showCustomRange ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {showCustomRange && (
              <div className="absolute top-full left-0 mt-2 w-80 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
                <div className="p-4">
                  <div className="space-y-2">
                    {DATE_RANGES.map((range) => (
                      <button
                        key={range.label}
                        onClick={() => {
                          setSelectedRange(range);
                          setShowCustomRange(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                          selectedRange.label === range.label
                            ? 'bg-blue-50 text-blue-700 font-medium'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {range.label}
                      </button>
                    ))}
                    
                    <hr className="my-2" />
                    
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-slate-700">Período Personalizado</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Data de início</label>
                          <input
                            type="date"
                            value={customRange.start}
                            onChange={(e) => setCustomRange(prev => ({ ...prev, start: e.target.value }))}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Data de término</label>
                          <input
                            type="date"
                            value={customRange.end}
                            onChange={(e) => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (customRange.start && customRange.end) {
                            setSelectedRange({ start: customRange.start, end: customRange.end, label: 'Personalizado' });
                            setShowCustomRange(false);
                          }
                        }}
                        disabled={!customRange.start || !customRange.end}
                        className="w-full px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                      >
                        Aplicar Período
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
            
          {/* Controles */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-3 py-2 text-sm rounded-lg font-medium transition-colors flex items-center gap-2 ${
                autoRefresh
                  ? 'bg-green-100 text-green-700'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} />
              Auto-refresh
            </button>
            
            <button
              onClick={() => {
                if (!data) return;
                const csvData = [
                  ['Métrica', 'Valor'],
                  ['Total de Visitantes', data.totalVisitors],
                  ['Visitantes Únicos', data.uniqueVisitors],
                  ['Visitantes Recorrentes', data.returningVisitors],
                  ['Novos Visitantes', data.newVisitors],
                  ['Taxa de Conversão (%)', data.conversionRate],
                ];
                const csv = csvData.map(row => row.join(',')).join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `analytics-${selectedRange.label.toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`;
                a.click();
                window.URL.revokeObjectURL(url);
              }}
              className="px-3 py-2 text-sm rounded-lg font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Exportar
            </button>
          </div>
        </div>
      </div>

      {/* Conteúdo baseado na view selecionada */}
      {viewMode === 'overview' ? (
        <>
          {/* Métricas Principais */}
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

          {/* Segmentações */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Smartphone className="w-5 h-5" />
                Dispositivos
              </h2>
              <div className="space-y-4">
                {Object.entries(data.deviceBreakdown).map(([device, count]) => {
                  const percentage = (count / data.totalVisitors) * 100;
                  const icon = device === 'mobile' ? <Smartphone className="w-4 h-4" /> : 
                              device === 'tablet' ? <Monitor className="w-4 h-4" /> : 
                              <Monitor className="w-4 h-4" />;
                  
                  return (
                    <div key={device} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {icon}
                          <span className="text-sm font-medium text-slate-700 capitalize">{device}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-semibold text-slate-900">{count}</span>
                          <span className="text-xs text-slate-500 ml-2">({percentage.toFixed(1)}%)</span>
                        </div>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            device === 'mobile' ? 'bg-blue-600' : 
                            device === 'tablet' ? 'bg-green-600' : 'bg-purple-600'
                          }`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Eye className="w-5 h-5" />
                Origem do Tráfego
              </h2>
              <div className="space-y-4">
                {Object.entries(data.referrerBreakdown).slice(0, 5).map(([referrer, count]) => {
                  const percentage = (count / data.totalVisitors) * 100;
                  const displayName = referrer === 'direct' ? 'Direto' : referrer;
                  
                  return (
                    <div key={referrer} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700">{displayName}</span>
                        <div className="text-right">
                          <span className="text-sm font-semibold text-slate-900">{count}</span>
                          <span className="text-xs text-slate-500 ml-2">({percentage.toFixed(1)}%)</span>
                        </div>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2">
                        <div
                          className="bg-orange-600 h-2 rounded-full transition-all"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Tabela de Visitantes */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Eye className="w-5 h-5" />
                Visitantes para Remarketing
              </h2>
              <span className="text-sm text-slate-600">
                {data.visitors.length} visitantes
              </span>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Visitor ID</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Tipo</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Dispositivo</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Origem</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Data e Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {data.visitors.slice(0, 20).map((visitor) => {
                    const isReturning = visitor.visitor_id ? 
                      data.visitors.filter(v => v.visitor_id === visitor.visitor_id).length > 1 : false;
                    
                    return (
                      <tr key={visitor.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-3 px-4 text-sm font-mono text-slate-600">
                          {visitor.visitor_id ? visitor.visitor_id.substring(0, 8) + '...' : 'N/A'}
                        </td>
                        <td className="py-3 px-4 text-sm">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            isReturning ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                          }`}>
                            {isReturning ? 'Recorrente' : 'Novo'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600 capitalize">
                          {visitor.device_type}
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600">
                          {visitor.referrer === 'direct' ? 'Direto' : visitor.referrer || 'N/A'}
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600">
                          {new Date(visitor.created_at).toLocaleString('pt-BR', {
                            timeZone: 'America/Sao_Paulo',
                            day: '2-digit',
                            month: '2-digit', 
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
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
