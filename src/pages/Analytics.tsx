import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import { Users, Target, TrendingUp, Clock, MousePointer } from 'lucide-react';
import { Heatmap } from '../components/Heatmap';

type AnalyticsData = {
  conversions: any[];
  visitors: any[];
  totalVisitors: number;
  totalConversions: number;
  conversionRate: number;
};

export const Analytics: React.FC = () => {
  const { t } = useTranslation('analytics');
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'overview' | 'heatmap'>('overview');

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
      console.log('Loading analytics for landing page ID:', id);
      const analyticsData = await api.getAnalytics(id);
      console.log('Analytics data received:', analyticsData);
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
        <p className="text-slate-600">{t('error.loadFailed')}</p>
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
          <h1 className="text-3xl font-bold text-slate-900">{t('page.title')}</h1>
          <p className="text-slate-600 mt-1">{t('page.subtitle')}</p>
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
            {t('tabs.overview')}
          </button>
          <button
            onClick={() => setViewMode('heatmap')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              viewMode === 'heatmap'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {t('tabs.heatmap')}
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
              <p className="text-sm font-medium text-slate-600 mb-1">{t('kpis.totalVisitors')}</p>
              <p className="text-3xl font-bold text-slate-900">{data.totalVisitors}</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-green-100 rounded-lg">
                  <Target className="w-6 h-6 text-green-600" />
                </div>
              </div>
              <p className="text-sm font-medium text-slate-600 mb-1">{t('kpis.conversions')}</p>
              <p className="text-3xl font-bold text-slate-900">{data.totalConversions}</p>
              <p className="text-xs text-slate-500 mt-2">
                {t('kpis.rateLine', { rate: data.conversionRate.toFixed(2) })}
              </p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-orange-100 rounded-lg">
                  <TrendingUp className="w-6 h-6 text-orange-600" />
                </div>
              </div>
              <p className="text-sm font-medium text-slate-600 mb-1">{t('kpis.engagementAvg')}</p>
              <p className="text-3xl font-bold text-slate-900">{avgEngagement.toFixed(2)}</p>
              <p className="text-xs text-slate-500 mt-2">{t('kpis.engagementScale')}</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-purple-100 rounded-lg">
                  <Clock className="w-6 h-6 text-purple-600" />
                </div>
              </div>
              <p className="text-sm font-medium text-slate-600 mb-1">{t('kpis.avgTimeToConvert')}</p>
              <p className="text-3xl font-bold text-slate-900">
                {Math.round(avgTimeToConvert)}{t('kpis.secondsSuffix')}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <MousePointer className="w-5 h-5" />
                {t('sections.devices')}
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
              <h2 className="text-lg font-semibold text-slate-900 mb-4">{t('sections.recentConversions')}</h2>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {data.conversions.length === 0 ? (
                  <p className="text-slate-600 text-sm">{t('conversions.none')}</p>
                ) : (
                  data.conversions.slice(0, 10).map((conversion) => (
                    <div key={conversion.id} className="border-l-4 border-green-500 pl-3 py-2">
                      <p className="text-sm font-medium text-slate-900">
                        {conversion.form_data?.name || conversion.form_data?.email || t('conversions.fallbackName')}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-600">
                          {t('conversions.scoreLine', { score: conversion.engagement_score })}
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
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{t('sections.behaviorDetails')}</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">{t('table.headers.visitor')}</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">{t('table.headers.device')}</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">{t('table.headers.duration')}</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">{t('table.headers.scroll')}</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">{t('table.headers.clicks')}</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">{t('table.headers.score')}</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">{t('table.headers.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.conversions.map((conversion) => {
                    const summary = conversion.behavior_summary || {};
                    return (
                      <tr key={conversion.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-3 px-4 text-sm text-slate-900">
                          {conversion.form_data?.email?.substring(0, 20) || t('table.notAvailable')}
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600 capitalize">
                          {summary.device_type || t('table.notAvailable')}
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600">
                          {summary.session_duration
                            ? `${summary.session_duration}${t('kpis.secondsSuffix')}`
                            : t('table.notAvailable')}
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600">
                          {summary.scroll_depth || t('table.notAvailable')}
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
                            {t('table.statusConverted')}
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
