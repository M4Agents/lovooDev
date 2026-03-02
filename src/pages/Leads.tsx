import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { LeadModal } from '../components/LeadModal';
import { LeadViewModal } from '../components/LeadViewModal';
import { CustomFieldsModal } from '../components/CustomFieldsModal';
import { ImportLeadsModal } from '../components/ImportLeadsModal';
import { DuplicateNotifications } from '../components/DuplicateNotifications';
import { DuplicateMergeModal } from '../components/DuplicateMergeModal';
import { TagsManagementModal } from '../components/TagsManagementModal';
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
  Building,
  ExternalLink,
  Download,
  ChevronDown,
  FileText,
  FileSpreadsheet,
  Tag
} from 'lucide-react';
import { exportToCSV, exportToExcel, prepareLeadsForExport, generateExportFilename } from '../utils/export';

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
  record_type?: string;  // NOVO: Tipo de registro
  created_at: string;
  updated_at: string;
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
  leadsThisMonth: number;
  statusBreakdown: Record<string, number>;
  originBreakdown: Record<string, number>;
  conversionRate: number;
}

export const Leads: React.FC = () => {
  const { company } = useAuth();
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

  // NOVOS ESTADOS PARA FILTROS AVANÇADOS
  const [nameFilter, setNameFilter] = useState('');
  const [phoneFilter, setPhoneFilter] = useState('');
  const [emailFilter, setEmailFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);


  useEffect(() => {
    if (company?.id) {
      loadData();
    }
  }, [company?.id]);

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

  const loadData = async () => {
    if (!company?.id) return;
    
    try {
      setLoading(true);
      const [leadsData, statsData] = await Promise.all([
        api.getLeads(company.id, {
          search: searchTerm,
          status: statusFilter || undefined,
          origin: originFilter || undefined,
          limit: 100
        }),
        api.getLeadStats(company.id)
      ]);
      
      setLeads(leadsData);
      setStats(statsData);

      // Carregar fotos dos leads a partir do telefone (se houver)
      const phones = Array.from(new Set(
        leadsData
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
    loadData();
  };

  // NOVAS FUNÇÕES PARA FILTROS AVANÇADOS
  const getDateRange = (filter: string, start: string, end: string) => {
    const now = new Date();
    
    switch (filter) {
      case 'hoje':
        const today = new Date();
        return {
          start: new Date(today.setHours(0, 0, 0, 0)).toISOString(),
          end: new Date(today.setHours(23, 59, 59, 999)).toISOString()
        };
      case 'ontem':
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        return {
          start: new Date(yesterday.setHours(0, 0, 0, 0)).toISOString(),
          end: new Date(yesterday.setHours(23, 59, 59, 999)).toISOString()
        };
      case '7dias':
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        return {
          start: sevenDaysAgo.toISOString(),
          end: new Date().toISOString()
        };
      case '30dias':
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return {
          start: thirtyDaysAgo.toISOString(),
          end: new Date().toISOString()
        };
      case 'personalizado':
        return start && end ? {
          start: new Date(start + 'T00:00:00').toISOString(),
          end: new Date(end + 'T23:59:59').toISOString()
        } : null;
      default:
        return null;
    }
  };

  const applyAdvancedFilters = async () => {
    if (!company?.id) return;
    
    try {
      setLoading(true);
      const dateRange = getDateRange(dateFilter, startDate, endDate);
      
      const [leadsData, statsData] = await Promise.all([
        api.getLeads(company.id, {
          search: searchTerm,
          name: nameFilter,
          phone: phoneFilter,
          email: emailFilter,
          status: statusFilter || undefined,
          origin: originFilter || undefined,
          dateRange: dateRange || undefined,
          limit: 100
        }),
        api.getLeadStats(company.id)
      ]);
      
      setLeads(leadsData);
      setStats(statsData);
    } catch (error) {
      console.error('Error applying advanced filters:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setNameFilter('');
    setPhoneFilter('');
    setEmailFilter('');
    setStatusFilter('');
    setOriginFilter('');
    setDateFilter('');
    setStartDate('');
    setEndDate('');
    loadData();
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

  const getOriginColor = (origin: string) => {
    switch (origin) {
      case 'landing_page': return 'bg-purple-100 text-purple-800';
      case 'whatsapp': return 'bg-green-100 text-green-800';
      case 'manual': return 'bg-blue-100 text-blue-800';
      case 'import': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getRecordTypeColor = (recordType: string) => {
    switch (recordType) {
      case 'Lead': return 'bg-blue-100 text-blue-800';
      case 'Oportunidade': return 'bg-orange-100 text-orange-800';
      case 'Cliente Ativo': return 'bg-green-100 text-green-800';
      case 'Cliente Inativo': return 'bg-yellow-100 text-yellow-800';
      case 'Ex-cliente': return 'bg-red-100 text-red-800';
      case 'Parceiro': return 'bg-purple-100 text-purple-800';
      case 'Fornecedor': return 'bg-amber-100 text-amber-800';
      default: return 'bg-blue-100 text-blue-800'; // Fallback para Lead
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
    // Recarregar dados para refletir mudanças
    loadData();
  };

  const handleCloseMergeModal = () => {
    setShowMergeModal(false);
    setSelectedDuplicateNotification(null);
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
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Importar
          </button>
          
          {/* Dropdown de Exportação */}
          <div className="relative">
            <button
              onClick={(event) => {
                event.stopPropagation(); // Impede que o event listener feche o dropdown
                console.log('🔍 DEBUG: Botão Exportar clicado!');
                console.log('🔍 DEBUG: showExportDropdown atual:', showExportDropdown);
                console.log('🔍 DEBUG: exportLoading atual:', exportLoading);
                console.log('🔍 DEBUG: setShowExportDropdown função:', typeof setShowExportDropdown);
                setShowExportDropdown(!showExportDropdown);
                console.log('🔍 DEBUG: Novo valor deveria ser:', !showExportDropdown);
              }}
              disabled={exportLoading}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {exportLoading ? 'Exportando...' : 'Exportar'}
              <ChevronDown className="w-4 h-4" />
            </button>
            
            {(() => {
              if (showExportDropdown) {
                console.log('🔍 DEBUG: Dropdown sendo renderizado!');
              }
              return showExportDropdown && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
                  <div className="bg-yellow-100 p-2 text-xs text-yellow-800">
                    DEBUG: Dropdown visível
                  </div>
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
              );
            })()}
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

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total de Leads</p>
                <p className="text-2xl font-bold text-gray-900">{stats.totalLeads}</p>
              </div>
              <Users className="w-8 h-8 text-blue-600" />
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Este Mês</p>
                <p className="text-2xl font-bold text-gray-900">{stats.leadsThisMonth}</p>
              </div>
              <Calendar className="w-8 h-8 text-green-600" />
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Taxa de Conversão</p>
                <p className="text-2xl font-bold text-gray-900">{stats.conversionRate.toFixed(1)}%</p>
              </div>
              <Building className="w-8 h-8 text-purple-600" />
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Convertidos</p>
                <p className="text-2xl font-bold text-gray-900">{stats.statusBreakdown['convertido'] || 0}</p>
              </div>
              <ExternalLink className="w-8 h-8 text-orange-600" />
            </div>
          </div>
        </div>
      )}

      {/* Notificações de Duplicatas */}
      <DuplicateNotifications onMergeRequest={handleMergeRequest} />

      {/* Filters */}
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        {/* Header dos Filtros */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
          <h3 className="text-lg font-medium text-gray-900">Filtros de Pesquisa</h3>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="flex items-center gap-2 px-3 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-sm font-medium transition-colors"
            >
              <Filter className="w-4 h-4" />
              {showAdvancedFilters ? 'Filtros Simples' : 'Filtros Avançados'}
            </button>
            <button
              onClick={clearAllFilters}
              className="px-3 py-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg text-sm transition-colors"
            >
              Limpar Filtros
            </button>
          </div>
        </div>

        {/* Filtros Básicos (sempre visíveis) */}
        <div className="flex flex-col md:flex-row gap-4 mb-4">
          <div className="flex-1">
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
          
          <div className="flex gap-3">
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
            </select>
            
            <button
              onClick={handleSearch}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Filter className="w-4 h-4" />
              Filtrar
            </button>
          </div>
        </div>

        {/* Filtros Avançados (condicionalmente visíveis) */}
        {showAdvancedFilters && (
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-3">Filtros Específicos</h4>
            
            {/* Linha 1: Filtros específicos por campo */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome
                </label>
                <input
                  type="text"
                  placeholder="Buscar por nome específico..."
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Telefone
                </label>
                <input
                  type="text"
                  placeholder="Buscar por telefone..."
                  value={phoneFilter}
                  onChange={(e) => setPhoneFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="text"
                  placeholder="Buscar por email..."
                  value={emailFilter}
                  onChange={(e) => setEmailFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Linha 2: Filtros de período */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Período
                </label>
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Qualquer período</option>
                  <option value="hoje">Hoje</option>
                  <option value="ontem">Ontem</option>
                  <option value="7dias">Últimos 7 dias</option>
                  <option value="30dias">Últimos 30 dias</option>
                  <option value="personalizado">Período personalizado</option>
                </select>
              </div>
              
              {dateFilter === 'personalizado' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Data Inicial
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Data Final
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </>
              )}
              
              <div className="flex items-end">
                <button
                  onClick={applyAdvancedFilters}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Search className="w-4 h-4 inline mr-2" />
                  Aplicar Filtros
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Leads Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Lead
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contato
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tipo de Registro
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Origem
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Data
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10">
                        {(() => {
                          const phoneKey = lead.phone ? lead.phone.replace(/\D/g, '') : '';
                          const photoUrl = phoneKey ? leadPhotos[phoneKey] : undefined;
                          if (photoUrl) {
                            return (
                              <img
                                src={photoUrl}
                                alt={lead.name}
                                className="h-10 w-10 rounded-full object-cover"
                              />
                            );
                          }
                          return (
                            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                              <User className="w-5 h-5 text-blue-600" />
                            </div>
                          );
                        })()}
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{lead.name}</div>
                        {lead.interest && (
                          <div className="text-sm text-gray-500">{lead.interest}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="space-y-1">
                      {lead.email && (
                        <div className="flex items-center text-sm text-gray-900">
                          <Mail className="w-4 h-4 mr-2 text-gray-400" />
                          {lead.email}
                        </div>
                      )}
                      {lead.phone && (
                        <div className="flex items-center text-sm text-gray-900">
                          <Phone className="w-4 h-4 mr-2 text-gray-400" />
                          {lead.phone}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(lead.status)}`}>
                      {lead.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getRecordTypeColor(lead.record_type || 'Lead')}`}>
                      {lead.record_type || 'Lead'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getOriginColor(lead.origin)}`}>
                      {lead.origin.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(lead.created_at)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleViewLead(lead)}
                        className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50"
                        title="Ver detalhes"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleEditLead(lead)}
                        className="text-green-600 hover:text-green-900 p-1 rounded hover:bg-green-50"
                        title="Editar"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteLead(lead.id)}
                        className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50"
                        title="Excluir"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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
        onClose={() => {
          setShowViewModal(false);
        }}
        lead={selectedLead}
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
    </div>
  );
};
