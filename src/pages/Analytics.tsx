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
  }, [id]);

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Analytics</h1>
          <p className="text-slate-600 mt-1">Análise detalhada do comportamento dos visitantes</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('overview')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              viewMode === 'overview'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setViewMode('heatmap')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              viewMode === 'heatmap'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Heatmap
          </button>
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
              </div>
              <p className="text-sm font-medium text-slate-600 mb-1">Total Visitantes</p>
              <p className="text-3xl font-bold text-slate-900">{data.totalVisitors}</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-green-100 rounded-lg">
                  <Target className="w-6 h-6 text-green-600" />
                </div>
              </div>
              <p className="text-sm font-medium text-slate-600 mb-1">Conversões</p>
              <p className="text-3xl font-bold text-slate-900">{data.totalConversions}</p>
              <p className="text-xs text-slate-500 mt-2">Taxa: {data.conversionRate.toFixed(2)}%</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-orange-100 rounded-lg">
                  <TrendingUp className="w-6 h-6 text-orange-600" />
                </div>
              </div>
              <p className="text-sm font-medium text-slate-600 mb-1">Engagement Médio</p>
              <p className="text-3xl font-bold text-slate-900">{avgEngagement.toFixed(2)}</p>
              <p className="text-xs text-slate-500 mt-2">de 10.0</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-purple-100 rounded-lg">
                  <Clock className="w-6 h-6 text-purple-600" />
                </div>
              </div>
              <p className="text-sm font-medium text-slate-600 mb-1">Tempo Médio p/ Converter</p>
              <p className="text-3xl font-bold text-slate-900">{Math.round(avgTimeToConvert)}s</p>
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
      ) : (
        <Heatmap landingPageId={id!} />
      )}
    </div>
  );
};
