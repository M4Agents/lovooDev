import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { supabase } from '../lib/supabase';
import { useLeadPermissions } from '../hooks/useLeadPermissions';
import { useAccessControl } from '../hooks/useAccessControl';
import { usePlanLeadStats } from '../hooks/usePlanLeadStats';
import { PlanLeadLimitBanner } from '../components/PlanLeadLimitBanner';
import { PeriodFilter } from '../components/PeriodFilter';
import type { PeriodFilter as PeriodFilterType } from '../types/analytics';
import { LeadModal } from '../components/LeadModal';
import { LeadViewModal } from '../components/LeadViewModal';
import { CustomFieldsModal } from '../components/CustomFieldsModal';
import { ImportLeadsModal } from '../components/ImportLeadsModal';
import { DuplicateNotifications, DuplicateNotification } from '../components/DuplicateNotifications';
import { DuplicateMergeModal } from '../components/DuplicateMergeModal';
import { TagsManagementModal } from '../components/TagsManagementModal';
import { BulkAssignModal } from '../components/BulkAssignModal';
import { BulkMergeModal } from '../components/BulkMergeModal';
import { LeadTableColumnCustomizer } from '../components/LeadTableColumnCustomizer';
import { useLeadTablePreferences } from '../hooks/useLeadTablePreferences';
import { useAvailableTags } from '../hooks/useAvailableTags';
import { chatApi } from '../services/chat/chatApi';
import {
  Users,
  Plus,
  Search,
  Filter,
  Upload,
  Settings,
  Eye,
  Edit,
  Trash2,
  Phone,
  Mail,
  Calendar,
  User,
  Download,
  ChevronDown,
  FileText,
  FileSpreadsheet,
  Tag,
  ArrowDownUp,
  X,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  Clock
} from 'lucide-react';
import { exportToCSV, exportToExcel, prepareLeadsForExport, generateExportFilename } from '../utils/export';
import { Avatar } from '../components/Avatar';
import { TagBadge } from '../components/TagBadge';
import type { Tag as LeadTag } from '../types/tags';

interface Lead {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  origin: string;
  status: string;
  interest?: string;
  responsible_user_id?: string;
  visitor_id?: string;
  record_type?: string;
  created_at: string;
  updated_at: string;
  last_contact_at?: string;
  tags?: LeadTag[];
  /** TRUE quando o lead foi criado acima do limite max_leads do plano. Dados sensíveis são mascarados. */
  is_over_plan?: boolean;
  lead_custom_values?: Array<{
    field_id: string;
    value: string;
    lead_custom_fields: {
      field_name: string;
      field_label: string;
      field_type: string;
    };
  }>;
}


interface LeadStats {
  totalLeads: number;
  totalEntries: number;
}

const LEADS_PER_PAGE = 100;

const getPageNumbers = (current: number, total: number): (number | '...')[] => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total]);
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.add(i);
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: (number | '...')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('...');
    result.push(sorted[i]);
  }
  return result;
};

// =====================================================
// Helper: valor de campo personalizado para um lead
// =====================================================
function getCustomFieldValue(
  lead: Lead,
  fieldId: string
): string | null {
  return lead.lead_custom_values?.find((v) => v.field_id === fieldId)?.value ?? null
}

export const Leads: React.FC = () => {
  const { company, user } = useAuth();
  const { canViewLead, canEditLead, canDeleteLead, isRestrictedToOwnLeads } = useLeadPermissions();
  const { canImportLeads, canEditAllLeads } = useAccessControl();
  const { leadStats } = usePlanLeadStats(company?.id);

  // Deep-link do Dashboard: /leads?lead_id=xxx
  // TODO: auto-abertura do modal de lead aguarda padronização de IDs.
  //   O Dashboard retorna lead_id como UUID (string) via api/dashboard/leads.ts,
  //   mas esta página carrega leads com id numérico (Lead.id: number).
  //   Quando os IDs forem padronizados, implementar:
  //     const target = leads.find(l => String(l.id) === highlightLeadId)
  //     if (target) { setSelectedLead(target); setShowViewModal(true) }
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightLeadId = searchParams.get('lead_id') ?? null
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [originFilter, setOriginFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showCustomFieldsModal, setShowCustomFieldsModal] = useState(false);
  const [showTagsModal, setShowTagsModal] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedDuplicateNotification, setSelectedDuplicateNotification] = useState<any>(null);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [leadPhotos, setLeadPhotos] = useState<Record<string, string>>({});
  
  // NOVOS ESTADOS PARA EXPORTAÇÃO
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  // Filtro de período
  const [period, setPeriod] = useState<PeriodFilterType>({ type: 'all', label: 'Todo período' });

  // Paginação
  const [currentPage, setCurrentPage] = useState(1);
  const [totalLeads, setTotalLeads] = useState(0);

  // Filtro de responsável
  const [responsibleFilter, setResponsibleFilter] = useState('');
  const [companyUsers, setCompanyUsers] = useState<any[]>([]);

  // Seleção em lote (atribuição)
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(new Set());
  const [showBulkAssignModal, setShowBulkAssignModal] = useState(false);
  const [bulkAssignLoading, setBulkAssignLoading] = useState(false);

  // Mesclagem em lote (duplicatas)
  const [bulkMergeNotifications, setBulkMergeNotifications] = useState<DuplicateNotification[]>([]);
  const [showBulkMergeModal, setShowBulkMergeModal] = useState(false);
  const [notificationsKey, setNotificationsKey] = useState(0);

  // Campos personalizados (para customizador de colunas)
  const [customFields, setCustomFields] = useState<any[]>([]);

  // Preferências de colunas visíveis
  const { allColumns, visibleColumns, toggleColumn, resetToDefault, isAtLimit } =
    useLeadTablePreferences({
      companyId: company?.id,
      userId: user?.id,
      customFields,
    });


  // Filtro de tags (AND)
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const { tags: availableTags } = useAvailableTags(company?.id);


  useEffect(() => {
    if (company?.id) {
      setCurrentPage(1);
      loadData({ page: 1 });
      loadCompanyUsers();
    }
  }, [company?.id, period]);

  // Carregar campos personalizados (independente do carregamento dos leads)
  useEffect(() => {
    if (!company?.id) return;
    api.getCustomFields(company.id)
      .then((fields) => setCustomFields(fields))
      .catch(() => setCustomFields([]));
  }, [company?.id]);

  // Carregar usuários da empresa
  const loadCompanyUsers = async () => {
    if (!company?.id) return;
    
    try {
      const { data, error } = await supabase
        .rpc('get_company_users_with_details', {
          p_company_id: company.id
        });
      
      if (error) throw error;
      setCompanyUsers(data || []);
    } catch (error) {
      console.error('Error loading company users:', error);
      setCompanyUsers([]);
    }
  };

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Só fecha se clicar fora do container do dropdown
      if (showExportDropdown && !target.closest('.relative')) {
        setShowExportDropdown(false);
      }
    };

    if (showExportDropdown) {
      document.addEventListener('click', handleClickOutside);
    }
    
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showExportDropdown]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(event.target as Node)) {
        setTagDropdownOpen(false);
      }
    };
    if (tagDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [tagDropdownOpen]);

  const periodToDateRange = (p: PeriodFilterType) =>
    p.startDate && p.endDate
      ? { start: p.startDate.toISOString(), end: p.endDate.toISOString() }
      : undefined;

  const loadData = async (overrides?: { tagIds?: string[], page?: number }) => {
    if (!company?.id) return;
    
    try {
      setLoading(true);
      setSelectedLeadIds(new Set());
      const dateRange = periodToDateRange(period);
      const effectiveTagIds = overrides?.tagIds ?? tagFilter;
      const page = overrides?.page ?? currentPage;
      const offset = (page - 1) * LEADS_PER_PAGE;

      const [leadsResult, statsData] = await Promise.all([
        api.getLeads(company.id, {
          search: searchTerm,
          status: statusFilter || undefined,
          origin: originFilter || undefined,
          responsible_user_id: responsibleFilter || undefined,
          dateRange,
          tag_ids: effectiveTagIds.length > 0 ? effectiveTagIds : undefined,
          limit: LEADS_PER_PAGE,
          offset: offset > 0 ? offset : undefined,
        }),
        api.getLeadStats(company.id, dateRange, effectiveTagIds.length > 0 ? effectiveTagIds : undefined)
      ]);
      
      setLeads(leadsResult.data);
      setTotalLeads(leadsResult.total);
      setStats(statsData);

      // Carregar fotos dos leads a partir do telefone (se houver)
      const phones = Array.from(new Set(
        leadsResult.data
          .map((lead) => lead.phone)
          .filter((phone): phone is string => !!phone)
      ));

      const missingPhones = phones
        .map((p) => p.replace(/\D/g, ''))
        .filter((phone) => phone && !leadPhotos[phone]);

      missingPhones.forEach(async (rawPhone) => {
        try {
          const phoneDigits = rawPhone.replace(/\D/g, '');
          if (!phoneDigits) return;

          const contact = await chatApi.getContactInfo(company.id, phoneDigits);
          if (contact?.profile_picture_url) {
            setLeadPhotos((prev) => {
              if (prev[phoneDigits]) return prev;
              return { ...prev, [phoneDigits]: contact.profile_picture_url };
            });
          }
        } catch (error) {
          console.error('Erro ao carregar foto do lead na lista de Leads:', error);
        }
      });
    } catch (error) {
      console.error('Error loading leads data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setCurrentPage(1);
    loadData({ page: 1 });
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setStatusFilter('');
    setOriginFilter('');
    setResponsibleFilter('');
    setTagFilter([]);
    setPeriod({ type: 'all', label: 'Todo período' });
    setCurrentPage(1);
    loadData({ tagIds: [], page: 1 });
  };

  const addTagFilter = (tagId: string) => {
    const newFilter = [...tagFilter, tagId];
    setTagFilter(newFilter);
    setTagDropdownOpen(false);
    setCurrentPage(1);
    loadData({ tagIds: newFilter, page: 1 });
  };

  const removeTagFilter = (tagId: string) => {
    const newFilter = tagFilter.filter(id => id !== tagId);
    setTagFilter(newFilter);
    setCurrentPage(1);
    loadData({ tagIds: newFilter, page: 1 });
  };

  const handleCreateLead = () => {
    setSelectedLead(null);
    setShowCreateModal(true);
  };

  const handleEditLead = (lead: Lead) => {
    setSelectedLead(lead);
    setShowEditModal(true);
  };

  const handleViewLead = (lead: Lead) => {
    setSelectedLead(lead);
    setShowViewModal(true);
  };

  const handleDeleteLead = async (leadId: number) => {
    if (!confirm('Tem certeza que deseja excluir este lead?')) return;
    
    try {
      await api.deleteLead(leadId);
      await loadData();
    } catch (error) {
      console.error('Error deleting lead:', error);
      alert('Erro ao excluir lead');
    }
  };

  const handleBulkAssign = async (responsibleUserId: string | null) => {
    if (!company?.id) return;

    // Validação: se não for null, o usuário deve existir em companyUsers
    if (responsibleUserId !== null) {
      const exists = companyUsers.some((u) => u.user_id === responsibleUserId);
      if (!exists) {
        toast.error('Usuário selecionado não encontrado na empresa.');
        return;
      }
    }

    setBulkAssignLoading(true);
    try {
      const ids = Array.from(selectedLeadIds);
      const result = await api.bulkAssignLeads(ids, responsibleUserId, company.id);

      if (result.updated === result.requested) {
        toast.success(`${result.updated} lead${result.updated !== 1 ? 's' : ''} atualizado${result.updated !== 1 ? 's' : ''} com sucesso.`);
      } else if (result.updated > 0) {
        toast(`${result.updated} de ${result.requested} leads atualizados. Alguns leads podem não ter sido alterados por restrições de acesso.`, {
          icon: '⚠️',
        });
      } else {
        toast.error('Nenhum lead foi atualizado. Verifique suas permissões.');
      }

      setShowBulkAssignModal(false);
      await loadData();
    } catch (error: any) {
      toast.error(error?.message ?? 'Erro ao atribuir responsável. Tente novamente.');
    } finally {
      setBulkAssignLoading(false);
    }
  };

  // NOVAS FUNÇÕES DE EXPORTAÇÃO
  const handleExport = async (format: 'csv' | 'excel') => {
    if (!company?.id) return;
    
    setExportLoading(true);
    setShowExportDropdown(false);
    
    try {
      // Buscar leads com campos personalizados
      const leadsData = await api.exportLeads(company.id);
      
      if (!leadsData || leadsData.length === 0) {
        alert('Nenhum lead encontrado para exportar');
        return;
      }
      
      // Processar dados para exportação
      const processedData = prepareLeadsForExport(leadsData);
      
      // Gerar nome do arquivo
      const filename = generateExportFilename('leads');
      
      // Exportar no formato escolhido
      if (format === 'csv') {
        exportToCSV(processedData, filename);
      } else {
        await exportToExcel(processedData, filename);
      }
      
      // Feedback de sucesso
      const count = processedData.length;
      alert(`${count} lead${count !== 1 ? 's' : ''} exportado${count !== 1 ? 's' : ''} com sucesso!`);
      
    } catch (error) {
      console.error('Error exporting leads:', error);
      alert('Erro ao exportar leads. Tente novamente.');
    } finally {
      setExportLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'novo': return 'bg-blue-100 text-blue-800';
      case 'em_qualificacao': return 'bg-yellow-100 text-yellow-800';
      case 'convertido': return 'bg-green-100 text-green-800';
      case 'perdido': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getOriginLabel = (origin: string) => {
    switch (origin) {
      case 'landing_page':          return 'Landing Page';
      case 'whatsapp':              return 'WhatsApp';
      case 'manual':                return 'Manual';
      case 'import':                return 'Importação';
      case 'api':                   return 'API Externa';
      case 'webhook_ultra_simples': return 'Webhook';
      default: return origin;
    }
  };

  const getOriginColor = (origin: string) => {
    switch (origin) {
      case 'landing_page':          return 'bg-purple-100 text-purple-800';
      case 'whatsapp':              return 'bg-green-100 text-green-800';
      case 'manual':                return 'bg-blue-100 text-blue-800';
      case 'import':                return 'bg-orange-100 text-orange-800';
      case 'webhook_ultra_simples': return 'bg-indigo-100 text-indigo-800';
      default:                      return 'bg-gray-100 text-gray-800';
    }
  };


  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Funções para controle de duplicatas
  const handleMergeRequest = (notification: any) => {
    setSelectedDuplicateNotification(notification);
    setShowMergeModal(true);
  };

  const handleMergeComplete = () => {
    setShowMergeModal(false);
    setSelectedDuplicateNotification(null);
    // Incrementa notificationsKey para forçar remount e reload do painel de duplicatas
    setNotificationsKey((k) => k + 1);
    loadData();
  };

  const handleCloseMergeModal = () => {
    setShowMergeModal(false);
    setSelectedDuplicateNotification(null);
  };

  // Handlers para mesclagem em lote
  const handleBulkMergeRequest = (notifications: DuplicateNotification[]) => {
    if (notifications.length === 0) return;
    setBulkMergeNotifications(notifications);
    setShowBulkMergeModal(true);
  };

  const handleBulkMergeComplete = () => {
    setShowBulkMergeModal(false);
    setBulkMergeNotifications([]);
    // Incrementa notificationsKey para forçar remount e reload do painel de duplicatas
    setNotificationsKey((k) => k + 1);
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Banner de contexto — visível quando navegado a partir do Dashboard */}
      {highlightLeadId && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 flex items-center justify-between">
          <p className="text-xs text-blue-700">
            Navegado a partir do Dashboard — use a busca para localizar o lead.
          </p>
          <button
            className="text-xs text-blue-500 hover:text-blue-700 underline ml-4"
            onClick={() => {
              const next = new URLSearchParams(searchParams)
              next.delete('lead_id')
              setSearchParams(next)
            }}
          >
            Limpar
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-8 h-8 text-blue-600" />
            Leads
          </h1>
          <p className="text-gray-600 mt-1">
            Gerencie seus leads e prospects
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCustomFieldsModal(true)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Settings className="w-4 h-4" />
            Campos Personalizados
          </button>
          <button
            onClick={() => setShowTagsModal(true)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Tag className="w-4 h-4" />
            Tags
          </button>
          {canImportLeads && (
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Upload className="w-4 h-4" />
              Importar
            </button>
          )}
          
          {/* Dropdown de Exportação */}
          <div className="relative">
            <button
              onClick={(event) => {
                event.stopPropagation();
                setShowExportDropdown(!showExportDropdown);
              }}
              disabled={exportLoading}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {exportLoading ? 'Exportando...' : 'Exportar'}
              <ChevronDown className="w-4 h-4" />
            </button>

            {showExportDropdown && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
                <button
                  onClick={() => handleExport('csv')}
                  disabled={exportLoading}
                  className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                >
                  <FileText className="w-4 h-4" />
                  Exportar CSV
                </button>
                <button
                  onClick={() => handleExport('excel')}
                  disabled={exportLoading}
                  className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Exportar Excel
                </button>
              </div>
            )}
          </div>
          
          <button
            onClick={handleCreateLead}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Novo Lead
          </button>
        </div>
      </div>

      {/* Alerta de limite de leads do plano */}
      <PlanLeadLimitBanner leadStats={leadStats} />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card: Total de Leads */}
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total de Leads</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">
                {stats ? stats.totalLeads : '—'}
              </p>
              <p className="text-xs text-gray-400 mt-1">Identidades únicas no sistema</p>
            </div>
            <Users className="w-10 h-10 text-blue-600 opacity-80" />
          </div>
        </div>

        {/* Card: Entradas de Leads */}
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">Entradas de Leads</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">
                {stats ? stats.totalEntries : '—'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {period.label} · Inclui novos leads e reentradas
              </p>
            </div>
            <ArrowDownUp className="w-10 h-10 text-green-600 opacity-80 flex-shrink-0 ml-4" />
          </div>
        </div>
      </div>

      {/* Notificações de Duplicatas */}
      <DuplicateNotifications
        key={notificationsKey}
        onMergeRequest={handleMergeRequest}
        onBulkMergeRequest={handleBulkMergeRequest}
      />

      {/* Filtros */}
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
          <h3 className="text-lg font-medium text-gray-900">Filtros de Pesquisa</h3>
          <button
            onClick={clearAllFilters}
            className="px-3 py-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg text-sm transition-colors"
          >
            Limpar Filtros
          </button>
        </div>

        {/* Busca geral */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Buscar por nome, email ou telefone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Status · Origem · Responsável · Período · Filtrar */}
        <div className="flex flex-wrap gap-3 items-center">
          <PeriodFilter
            selectedPeriod={period}
            onPeriodChange={setPeriod}
            showAll
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Todos os Status</option>
            <option value="novo">Novo</option>
            <option value="em_qualificacao">Em Qualificação</option>
            <option value="convertido">Convertido</option>
            <option value="perdido">Perdido</option>
          </select>

          <select
            value={originFilter}
            onChange={(e) => setOriginFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Todas as Origens</option>
            <option value="landing_page">Landing Page</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="manual">Manual</option>
            <option value="import">Importação</option>
            <option value="webhook_ultra_simples">Webhook</option>
          </select>

          {/* Dropdown de responsável: oculto para usuários restritos aos próprios leads */}
          {!isRestrictedToOwnLeads() && (
          <select
            value={responsibleFilter}
            onChange={(e) => setResponsibleFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Todos os Responsáveis</option>
            <option value="unassigned">Sem responsável</option>
            {companyUsers.map(user => (
              <option key={user.id} value={user.user_id ?? user.id}>
                {user.display_name || user.email}
              </option>
            ))}
          </select>
          )}

          <button
            onClick={handleSearch}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Filter className="w-4 h-4" />
            Filtrar
          </button>
        </div>

        {/* Indicador visual: restrição de leads por responsável ativa */}
        {isRestrictedToOwnLeads() && (
          <div className="mt-2 flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 w-fit">
            <Filter className="w-3.5 h-3.5 shrink-0" />
            Visualizando apenas leads atribuídos a você
          </div>
        )}

        {/* Filtro por Tags (AND) */}
        {availableTags.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-500 whitespace-nowrap flex items-center gap-1">
              <Tag className="w-3.5 h-3.5" />
              Tags:
            </span>

            {tagFilter.map(tagId => {
              const tag = availableTags.find(t => t.id === tagId);
              if (!tag) return null;
              return (
                <span
                  key={tagId}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{ backgroundColor: `${tag.color}22`, color: tag.color, border: `1px solid ${tag.color}66` }}
                >
                  {tag.name}
                  <button onClick={() => removeTagFilter(tagId)} className="ml-0.5 hover:opacity-70 transition-opacity">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}

            {availableTags.some(t => !tagFilter.includes(t.id)) && (
              <div className="relative" ref={tagDropdownRef}>
                <button
                  onClick={() => setTagDropdownOpen(prev => !prev)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs border border-dashed border-gray-300 rounded-full text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  {tagFilter.length === 0 ? 'Filtrar por tag' : 'Adicionar tag'}
                </button>

                {tagDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px] max-h-48 overflow-y-auto">
                    {availableTags
                      .filter(t => !tagFilter.includes(t.id))
                      .map(tag => (
                        <button
                          key={tag.id}
                          onClick={() => addTagFilter(tag.id)}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2 transition-colors"
                        >
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                          <span className="truncate">{tag.name}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}

            {tagFilter.length > 1 && (
              <span className="text-xs text-gray-400 italic">
                (mostrando leads com todas as {tagFilter.length} tags)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Leads Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* Cabeçalho da tabela com customizador de colunas */}
        <div className="flex items-center justify-end px-4 py-2 border-b border-gray-100 bg-gray-50">
          <LeadTableColumnCustomizer
            visibleColumns={visibleColumns}
            allColumns={allColumns}
            onToggle={toggleColumn}
            onReset={resetToDefault}
            isAtLimit={isAtLimit}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                {canEditAllLeads && (
                  <th className="pl-4 pr-2 py-2 w-8">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      checked={leads.length > 0 && leads.every((l) => selectedLeadIds.has(l.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedLeadIds(new Set(leads.map((l) => l.id)));
                        } else {
                          setSelectedLeadIds(new Set());
                        }
                      }}
                      title={leads.length > 0 && leads.every((l) => selectedLeadIds.has(l.id)) ? 'Desmarcar todos' : 'Selecionar todos'}
                    />
                  </th>
                )}
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Lead
                </th>
                {visibleColumns.includes('contato') && (
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Contato
                  </th>
                )}
                {visibleColumns.includes('status') && (
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                )}
                {visibleColumns.includes('origem') && (
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Origem
                  </th>
                )}
                {visibleColumns.includes('responsavel') && (
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Responsável
                  </th>
                )}
                {visibleColumns.includes('tags') && (
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tags
                  </th>
                )}
                {visibleColumns.includes('data') && (
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Data
                  </th>
                )}
                {visibleColumns.includes('interesse') && (
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Interesse
                  </th>
                )}
                {visibleColumns.includes('ultimo_contato') && (
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Último Contato
                  </th>
                )}
                {/* Colunas de campos personalizados */}
                {allColumns
                  .filter((col) => col.isCustom && visibleColumns.includes(col.id))
                  .map((col) => (
                    <th key={col.id} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {col.label}
                    </th>
                  ))
                }
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {leads.map((lead) => (
                <tr
                  key={lead.id}
                  className={`hover:bg-gray-50 ${selectedLeadIds.has(lead.id) ? 'bg-blue-50' : ''}`}
                >
                  {canEditAllLeads && (
                    <td className="pl-4 pr-2 py-2 w-8 align-middle">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        checked={selectedLeadIds.has(lead.id)}
                        onChange={(e) => {
                          setSelectedLeadIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(lead.id);
                            else next.delete(lead.id);
                            return next;
                          });
                        }}
                      />
                    </td>
                  )}
                  <td className="px-4 py-2 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-7 w-7">
                        <Avatar
                          src={lead.phone ? leadPhotos[lead.phone.replace(/\D/g, '')] : undefined}
                          alt={lead.name}
                          size="sm"
                        />
                      </div>
                      <div className="ml-3">
                        <div className="text-sm font-medium text-gray-900">{lead.name}</div>
                        {lead.interest && (
                          <div className="text-xs text-gray-400">{lead.interest}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  {visibleColumns.includes('contato') && (
                    <td className="px-4 py-2 whitespace-nowrap">
                      {lead.is_over_plan ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-600">
                            Restrito
                          </span>
                          <span className="text-xs text-gray-400 italic">Dados ocultos</span>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          {lead.email && (
                            <div className="flex items-center text-xs text-gray-700">
                              <Mail className="w-3 h-3 mr-1.5 text-gray-400 flex-shrink-0" />
                              {lead.email}
                            </div>
                          )}
                          {lead.phone && (
                            <div className="flex items-center text-xs text-gray-700">
                              <Phone className="w-3 h-3 mr-1.5 text-gray-400 flex-shrink-0" />
                              {lead.phone}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                  {visibleColumns.includes('status') && (
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${getStatusColor(lead.status)}`}>
                        {lead.status.replace('_', ' ')}
                      </span>
                    </td>
                  )}
                  {visibleColumns.includes('origem') && (
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${getOriginColor(lead.origin)}`}>
                        {getOriginLabel(lead.origin)}
                      </span>
                    </td>
                  )}
                  {visibleColumns.includes('responsavel') && (
                    <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-500 max-w-[140px] truncate">
                      {(() => {
                        const responsibleUser = companyUsers.find(u => u.user_id === lead.responsible_user_id);
                        return responsibleUser ? (responsibleUser.display_name || responsibleUser.email) : '-';
                      })()}
                    </td>
                  )}
                  {visibleColumns.includes('tags') && (
                    <td className="px-4 py-2">
                      {lead.tags && lead.tags.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          {lead.tags.slice(0, 4).map(tag => (
                            <span
                              key={tag.id}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-full text-[10px] font-medium"
                              title={tag.name}
                            >
                              <Tag className="w-2.5 h-2.5 flex-shrink-0" />
                              {tag.name}
                            </span>
                          ))}
                          {lead.tags.length > 4 && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-500"
                              title={lead.tags.slice(4).map(t => t.name).join(', ')}
                            >
                              +{lead.tags.length - 4}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  )}
                  {visibleColumns.includes('data') && (
                    <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-500">
                      {formatDate(lead.created_at)}
                    </td>
                  )}
                  {visibleColumns.includes('interesse') && (
                    <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-600 max-w-[140px] truncate">
                      {lead.interest || <span className="text-gray-300">—</span>}
                    </td>
                  )}
                  {visibleColumns.includes('ultimo_contato') && (
                    <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-500">
                      {lead.last_contact_at ? (
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          {formatDate(lead.last_contact_at)}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  )}
                  {/* Células de campos personalizados */}
                  {allColumns
                    .filter((col) => col.isCustom && visibleColumns.includes(col.id))
                    .map((col) => {
                      const value = getCustomFieldValue(lead, col.fieldId!)
                      return (
                        <td key={col.id} className="px-4 py-2 whitespace-nowrap">
                          {value
                            ? <span className="text-xs text-gray-700 block max-w-[120px] truncate" title={value}>{value}</span>
                            : <span className="text-gray-300">—</span>
                          }
                        </td>
                      )
                    })
                  }
                  <td className="px-4 py-2 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleViewLead(lead)}
                        className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50"
                        title="Ver detalhes"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {canEditLead(lead) && (
                        <button
                          onClick={() => handleEditLead(lead)}
                          className="text-green-600 hover:text-green-900 p-1 rounded hover:bg-green-50"
                          title="Editar"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      )}
                      {canDeleteLead() && (
                        <button
                          onClick={() => handleDeleteLead(lead.id)}
                          className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50"
                          title="Excluir"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {leads.length === 0 && (
            <div className="text-center py-12">
              <Users className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">Nenhum lead encontrado</h3>
              <p className="mt-1 text-sm text-gray-500">
                Comece criando um novo lead ou importando uma lista.
              </p>
              <div className="mt-6">
                <button
                  onClick={handleCreateLead}
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Novo Lead
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Barra flutuante de seleção em lote */}
        {selectedLeadIds.size > 0 && canEditAllLeads && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 bg-gray-900 text-white rounded-xl shadow-2xl ring-1 ring-white/10">
            <span className="text-sm font-medium">
              {selectedLeadIds.size} lead{selectedLeadIds.size !== 1 ? 's' : ''} selecionado{selectedLeadIds.size !== 1 ? 's' : ''}
            </span>
            <button
              onClick={() => setShowBulkAssignModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
            >
              <UserCheck className="w-4 h-4" />
              Atribuir responsável
            </button>
            <button
              onClick={() => setSelectedLeadIds(new Set())}
              className="flex items-center gap-1 px-2 py-1.5 text-gray-300 hover:text-white hover:bg-white/10 rounded-lg text-sm transition-colors"
              title="Limpar seleção"
            >
              <X className="w-4 h-4" />
              Limpar
            </button>
          </div>
        )}

        {/* Paginação */}
        {totalLeads > LEADS_PER_PAGE && (() => {
          const totalPages = Math.ceil(totalLeads / LEADS_PER_PAGE);
          const startRecord = (currentPage - 1) * LEADS_PER_PAGE + 1;
          const endRecord = Math.min(currentPage * LEADS_PER_PAGE, totalLeads);
          const handlePageChange = (page: number) => {
            setCurrentPage(page);
            loadData({ page });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          };
          return (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
              <p className="text-sm text-gray-600">
                Mostrando <span className="font-medium">{startRecord}</span>–<span className="font-medium">{endRecord}</span> de <span className="font-medium">{totalLeads}</span> leads
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Página anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {getPageNumbers(currentPage, totalPages).map((page, idx) =>
                  page === '...' ? (
                    <span key={`ellipsis-${idx}`} className="px-2 py-1 text-sm text-gray-400 select-none">…</span>
                  ) : (
                    <button
                      key={page}
                      onClick={() => handlePageChange(page as number)}
                      className={`min-w-[32px] px-2 py-1 rounded-md text-sm transition-colors ${
                        page === currentPage
                          ? 'bg-blue-600 text-white font-medium'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {page}
                    </button>
                  )
                )}
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Próxima página"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Modais Funcionais */}
      <LeadModal
        isOpen={showCreateModal || showEditModal}
        onClose={() => {
          if (showCreateModal) {
            setShowCreateModal(false);
            setSelectedLead(null);
          }
          if (showEditModal) {
            setShowEditModal(false);
            setSelectedLead(null);
          }
        }}
        lead={selectedLead}
        onSave={loadData}
      />

      <LeadViewModal
        isOpen={showViewModal}
        onClose={() => setShowViewModal(false)}
        lead={selectedLead}
        companyUsers={companyUsers}
        onEdit={(lead) => {
          setSelectedLead(lead);
          setShowViewModal(false);
          setShowEditModal(true);
        }}
      />

      <CustomFieldsModal
        isOpen={showCustomFieldsModal}
        onClose={() => setShowCustomFieldsModal(false)}
        onSave={loadData}
      />

      <TagsManagementModal
        isOpen={showTagsModal}
        onClose={() => setShowTagsModal(false)}
        onTagsChange={loadData}
      />

      <ImportLeadsModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImportComplete={loadData}
      />

      {/* Modal de Mesclagem de Duplicatas */}
      {showMergeModal && selectedDuplicateNotification && (
        <DuplicateMergeModal
          notification={selectedDuplicateNotification}
          onClose={handleCloseMergeModal}
          onMergeComplete={handleMergeComplete}
        />
      )}

      {/* Modal de Atribuição em Lote */}
      <BulkAssignModal
        isOpen={showBulkAssignModal}
        onClose={() => setShowBulkAssignModal(false)}
        onConfirm={handleBulkAssign}
        selectedCount={selectedLeadIds.size}
        companyUsers={companyUsers}
        loading={bulkAssignLoading}
      />

      {/* Modal de Mesclagem em Lote */}
      <BulkMergeModal
        isOpen={showBulkMergeModal}
        onClose={() => setShowBulkMergeModal(false)}
        onMergeComplete={handleBulkMergeComplete}
        notifications={bulkMergeNotifications}
      />
    </div>
  );
};
