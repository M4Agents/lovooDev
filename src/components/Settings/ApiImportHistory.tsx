import React, { useState, useCallback, useEffect } from 'react';
import {
  History,
  RefreshCw,
  Search,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface ImportHistoryRow {
  id: string | number;
  status: string;
  payload_summary?: { name?: string; email?: string; phone?: string };
  external_reference?: string;
  error_message?: string;
  created_at: string;
}

interface HistoryState {
  data: ImportHistoryRow[];
  loading: boolean;
  error: string | null;
  page: number;
  hasMore: boolean;
  filters: { status: string; search: string; dateFrom: string; dateTo: string };
}

interface ApiImportHistoryProps {
  companyId: string;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  success:          { label: 'Sucesso',      className: 'bg-green-100 text-green-700' },
  duplicate:        { label: 'Duplicata',    className: 'bg-yellow-100 text-yellow-700' },
  error:            { label: 'Erro',         className: 'bg-red-100 text-red-700' },
  rate_limited:     { label: 'Rate limited', className: 'bg-orange-100 text-orange-700' },
  plan_limit:       { label: 'Limite plano', className: 'bg-purple-100 text-purple-700' },
  validation_error: { label: 'Validação',    className: 'bg-slate-100 text-slate-700' },
};

const INITIAL_FILTERS = { status: '', search: '', dateFrom: '', dateTo: '' };

export const ApiImportHistory: React.FC<ApiImportHistoryProps> = ({ companyId }) => {
  const [history, setHistory] = useState<HistoryState>({
    data: [],
    loading: false,
    error: null,
    page: 1,
    hasMore: false,
    filters: INITIAL_FILTERS,
  });

  const fetchHistory = useCallback(async (
    page = 1,
    filters = history.filters,
  ) => {
    if (!companyId) return;
    setHistory(prev => ({ ...prev, loading: true, error: null }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Sessão expirada');

      const params = new URLSearchParams({
        company_id: companyId,
        page: String(page),
        per_page: '20',
      });
      if (filters.status)   params.set('status',    filters.status);
      if (filters.dateFrom) params.set('date_from', filters.dateFrom);
      if (filters.dateTo)   params.set('date_to',   filters.dateTo);
      if (filters.search)   params.set('search',    filters.search.trim().slice(0, 100));

      const res = await fetch(`/api/leads/import-events?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const json = await res.json();
      setHistory(prev => ({
        ...prev,
        loading: false,
        data:    json.data ?? [],
        page:    json.pagination?.page ?? page,
        hasMore: json.pagination?.has_more ?? false,
        filters,
      }));
    } catch (err: any) {
      setHistory(prev => ({
        ...prev,
        loading: false,
        error: err.message ?? 'Erro ao carregar histórico',
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useEffect(() => {
    fetchHistory(1, INITIAL_FILTERS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const updateFilter = (key: keyof typeof INITIAL_FILTERS, value: string) => {
    const f = { ...history.filters, [key]: value };
    setHistory(prev => ({ ...prev, filters: f }));
    if (key !== 'search') fetchHistory(1, f);
  };

  return (
    <div>
      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-teal-100 rounded-lg">
            <History className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Logs de Importação</h2>
            <p className="text-sm text-slate-500">
              Tentativas de importação via API — sucesso, duplicatas e erros
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchHistory(1, history.filters)}
          className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          title="Atualizar"
        >
          <RefreshCw className={`w-4 h-4 ${history.loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Nome, email ou telefone"
            value={history.filters.search}
            onChange={e => updateFilter('search', e.target.value)}
            onKeyDown={e => e.key === 'Enter' && fetchHistory(1, history.filters)}
            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-300"
          />
        </div>
        <select
          value={history.filters.status}
          onChange={e => updateFilter('status', e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300"
        >
          <option value="">Todos os status</option>
          <option value="success">Sucesso</option>
          <option value="duplicate">Duplicata</option>
          <option value="error">Erro</option>
          <option value="rate_limited">Rate limited</option>
          <option value="plan_limit">Limite do plano</option>
          <option value="validation_error">Validação</option>
        </select>
        <input
          type="date"
          value={history.filters.dateFrom}
          onChange={e => updateFilter('dateFrom', e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300"
        />
        <input
          type="date"
          value={history.filters.dateTo}
          onChange={e => updateFilter('dateTo', e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300"
        />
      </div>

      {/* Erro */}
      {history.error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg mb-4 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {history.error}
        </div>
      )}

      {/* Tabela */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
              <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Lead</th>
              <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Referência</th>
              <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Mensagem de erro</th>
              <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Data/hora</th>
            </tr>
          </thead>
          <tbody>
            {history.loading && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-slate-400 text-sm">
                  <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Carregando...
                </td>
              </tr>
            )}
            {!history.loading && history.data.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-slate-400 text-sm">
                  Nenhum registro encontrado para os filtros selecionados.
                </td>
              </tr>
            )}
            {!history.loading && history.data.map((row) => {
              const sc = STATUS_CONFIG[row.status] ?? { label: row.status, className: 'bg-slate-100 text-slate-600' };
              const summary = row.payload_summary ?? {};
              const leadLabel = [summary.name, summary.email, summary.phone].filter(Boolean).join(' · ') || '—';
              return (
                <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="py-2.5 px-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${sc.className}`}>
                      {row.status === 'success' || row.status === 'duplicate'
                        ? <CheckCircle2 className="w-3 h-3" />
                        : <AlertCircle className="w-3 h-3" />}
                      {sc.label}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-700 max-w-[200px] truncate" title={leadLabel}>{leadLabel}</td>
                  <td className="py-2.5 px-3 text-slate-500 text-xs">{row.external_reference ?? '—'}</td>
                  <td className="py-2.5 px-3 text-slate-500 text-xs max-w-[200px] truncate" title={row.error_message ?? ''}>
                    {row.error_message ?? '—'}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400 text-xs whitespace-nowrap">
                    {new Date(row.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {(history.page > 1 || history.hasMore) && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
          <button
            disabled={history.page <= 1 || history.loading}
            onClick={() => fetchHistory(history.page - 1, history.filters)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Anterior
          </button>
          <span className="text-sm text-slate-500">Página {history.page}</span>
          <button
            disabled={!history.hasMore || history.loading}
            onClick={() => fetchHistory(history.page + 1, history.filters)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Próxima <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
