import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { BehaviorEvent } from '../lib/supabase';

type HeatmapProps = {
  landingPageId: string;
};

export const Heatmap: React.FC<HeatmapProps> = ({ landingPageId }) => {
  const [events, setEvents] = useState<BehaviorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [maxClicks, setMaxClicks] = useState(0);

  useEffect(() => {
    loadHeatmapData();
  }, [landingPageId]);

  const loadHeatmapData = async () => {
    try {
      const data = await api.getHeatmapData(landingPageId);
      setEvents(data);

      const clickCounts: { [key: string]: number } = {};
      data.forEach((event) => {
        if (event.coordinates) {
          const key = `${Math.round((event.coordinates as any).x / 50)}-${Math.round((event.coordinates as any).y / 50)}`;
          clickCounts[key] = (clickCounts[key] || 0) + 1;
        }
      });

      setMaxClicks(Math.max(...Object.values(clickCounts), 1));
    } catch (error) {
      console.error('Error loading heatmap:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="text-slate-600 mt-4">Carregando heatmap...</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
        <p className="text-slate-600">Nenhum dado de cliques disponível ainda</p>
      </div>
    );
  }

  const clickCounts: { [key: string]: { count: number; x: number; y: number }[] } = {};
  events.forEach((event) => {
    if (event.coordinates) {
      const coords = event.coordinates as any;
      const x = Math.round(coords.x / 50) * 50;
      const y = Math.round(coords.y / 50) * 50;
      const key = `${x}-${y}`;

      if (!clickCounts[key]) {
        clickCounts[key] = [];
      }
      clickCounts[key].push({ count: 1, x: coords.x, y: coords.y });
    }
  });

  const aggregatedClicks = Object.entries(clickCounts).map(([key, clicks]) => {
    const [x, y] = key.split('-').map(Number);
    return {
      x,
      y,
      count: clicks.length,
      intensity: clicks.length / maxClicks
    };
  });

  const getColor = (intensity: number) => {
    if (intensity > 0.7) return 'rgba(220, 38, 38, 0.7)';
    if (intensity > 0.4) return 'rgba(249, 115, 22, 0.6)';
    if (intensity > 0.2) return 'rgba(234, 179, 8, 0.5)';
    return 'rgba(59, 130, 246, 0.4)';
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Mapa de Calor de Cliques</h2>
        <p className="text-sm text-slate-600">
          Total de {events.length} cliques registrados
        </p>
      </div>

      <div className="mb-6 flex items-center gap-4">
        <span className="text-sm text-slate-600">Intensidade:</span>
        <div className="flex items-center gap-2">
          <div className="w-12 h-6 rounded" style={{ backgroundColor: 'rgba(59, 130, 246, 0.4)' }}></div>
          <span className="text-xs text-slate-500">Baixa</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-12 h-6 rounded" style={{ backgroundColor: 'rgba(234, 179, 8, 0.5)' }}></div>
          <span className="text-xs text-slate-500">Média</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-12 h-6 rounded" style={{ backgroundColor: 'rgba(249, 115, 22, 0.6)' }}></div>
          <span className="text-xs text-slate-500">Alta</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-12 h-6 rounded" style={{ backgroundColor: 'rgba(220, 38, 38, 0.7)' }}></div>
          <span className="text-xs text-slate-500">Muito Alta</span>
        </div>
      </div>

      <div className="relative bg-slate-50 rounded-lg overflow-hidden" style={{ height: '600px' }}>
        <svg className="w-full h-full">
          {aggregatedClicks.map((click, index) => (
            <g key={index}>
              <circle
                cx={click.x}
                cy={click.y}
                r={30 + (click.intensity * 40)}
                fill={getColor(click.intensity)}
                opacity={0.6}
              />
              <text
                x={click.x}
                y={click.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="text-xs font-bold fill-white"
              >
                {click.count}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-50 rounded-lg p-4">
          <p className="text-sm text-slate-600 mb-1">Total de Cliques</p>
          <p className="text-2xl font-bold text-slate-900">{events.length}</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-4">
          <p className="text-sm text-slate-600 mb-1">Áreas Clicadas</p>
          <p className="text-2xl font-bold text-slate-900">{aggregatedClicks.length}</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-4">
          <p className="text-sm text-slate-600 mb-1">Cliques/Área (Média)</p>
          <p className="text-2xl font-bold text-slate-900">
            {(events.length / Math.max(aggregatedClicks.length, 1)).toFixed(1)}
          </p>
        </div>
        <div className="bg-slate-50 rounded-lg p-4">
          <p className="text-sm text-slate-600 mb-1">Área Mais Clicada</p>
          <p className="text-2xl font-bold text-slate-900">{maxClicks} cliques</p>
        </div>
      </div>
    </div>
  );
};
