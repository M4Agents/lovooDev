import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import { 
  Users, Target, Clock, Calendar, 
  Download, RefreshCw, Globe, Smartphone, Monitor,
  UserCheck, MapPin, Languages, Eye
} from 'lucide-react';

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

export const ProfessionalAnalytics: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRange, setSelectedRange] = useState<DateRange>(DATE_RANGES[2]); // 7 dias
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    loadAnalytics();
    
    let interval: NodeJS.Timeout;
    if (autoRefresh) {
      interval = setInterval(() => {
        loadAnalytics();
      }, 60000); // Refresh a cada minuto
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [id, selectedRange, customRange]);

  const loadAnalytics = async () => {
    if (!id) return;

    try {
      setLoading(true);
      console.log('Loading professional analytics for:', id);
      
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
      console.log('Professional analytics data:', analyticsData);
      setData(analyticsData);
    } catch (error) {
      console.error('Error loading professional analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportData = () => {
    if (!data) return;
    
    const csvData = [
      ['Métrica', 'Valor'],
      ['Total de Visitantes', data.totalVisitors],
      ['Visitantes Únicos', data.uniqueVisitors],
      ['Visitantes Recorrentes', data.returningVisitors],
      ['Novos Visitantes', data.newVisitors],
      ['Total de Sessões', data.totalSessions],
      ['Duração Média da Sessão (s)', data.avgSessionDuration],
      ['Taxa de Rejeição (%)', data.bounceRate],
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
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="ml-4 text-slate-600">Carregando analytics profissional...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-600">Erro ao carregar analytics</p>
        <button 
          onClick={loadAnalytics}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Tentar Novamente
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header com Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Analytics Profissional</h1>
            <p className="text-slate-600 mt-1">Análise avançada com filtros de data e segmentação para remarketing</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            {/* Filtros de Data Rápidos */}
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
                onClick={exportData}
                className="px-3 py-2 text-sm rounded-lg font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Exportar
              </button>
            </div>
          </div>
        </div>
      </div>

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

      {/* Gráficos e Segmentação */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Dispositivos */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Smartphone className="w-5 h-5" />
            Segmentação por Dispositivo
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

        {/* Origem do Tráfego */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Origem do Tráfego
          </h2>
          <div className="space-y-4">
            {Object.entries(data.referrerBreakdown).slice(0, 5).map(([referrer, count]) => {
              const percentage = (count / data.totalVisitors) * 100;
              const displayName = referrer === 'direct' ? 'Direto' : 
                                 referrer.includes('google') ? 'Google' :
                                 referrer.includes('facebook') ? 'Facebook' :
                                 referrer.includes('instagram') ? 'Instagram' :
                                 new URL(referrer).hostname;
              
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

        {/* Geolocalização */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            Geolocalização (Timezone)
          </h2>
          <div className="space-y-3">
            {Object.entries(data.timezoneBreakdown).slice(0, 5).map(([timezone, count]) => {
              const percentage = (count / data.totalVisitors) * 100;
              const region = timezone.split('/')[1]?.replace('_', ' ') || timezone;
              
              return (
                <div key={timezone} className="flex items-center justify-between">
                  <span className="text-sm text-slate-700">{region}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{count}</span>
                    <div className="w-16 bg-slate-200 rounded-full h-2">
                      <div
                        className="bg-green-600 h-2 rounded-full"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Idiomas */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Languages className="w-5 h-5" />
            Idiomas dos Visitantes
          </h2>
          <div className="space-y-3">
            {Object.entries(data.languageBreakdown).slice(0, 5).map(([language, count]) => {
              const percentage = (count / data.totalVisitors) * 100;
              const langName = language === 'pt-BR' ? 'Português (BR)' :
                              language === 'en-US' ? 'Inglês (US)' :
                              language === 'es-ES' ? 'Espanhol' :
                              language;
              
              return (
                <div key={language} className="flex items-center justify-between">
                  <span className="text-sm text-slate-700">{langName}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{count}</span>
                    <div className="w-16 bg-slate-200 rounded-full h-2">
                      <div
                        className="bg-purple-600 h-2 rounded-full"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tabela de Visitantes Detalhada */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Eye className="w-5 h-5" />
            Visitantes Detalhados para Remarketing
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">
              {data.visitors.length} visitantes encontrados
            </span>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Visitor ID</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Tipo</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Dispositivo</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Localização</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Origem</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Data/Hora</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.visitors.slice(0, 50).map((visitor) => {
                const isReturning = data.visitors.filter(v => v.visitor_id === visitor.visitor_id).length > 1;
                const hasConverted = data.conversions.some(c => c.visitor_id === visitor.visitor_id);
                
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
                      {visitor.timezone ? visitor.timezone.split('/')[1]?.replace('_', ' ') : 'N/A'}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {visitor.referrer === 'direct' ? 'Direto' : 
                       visitor.referrer ? new URL(visitor.referrer).hostname : 'N/A'}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {new Date(visitor.created_at).toLocaleString('pt-BR')}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        hasConverted ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {hasConverted ? 'Convertido' : 'Visitante'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
