import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { Company } from '../lib/supabase';
import { validateCNPJ, validateEmail, validateURL, validateCEP, validatePhone } from '../utils/validators';
import { maskCNPJ, maskCEP, maskPhone, BRAZILIAN_STATES } from '../utils/masks';
import { fetchCEPData, isValidCEPForSearch, formatAddress } from '../utils/cep';
import { Plus, Building2, Users, TrendingUp, Trash2, Edit2, UserCog, LogIn, Key, Mail, Building, MapPin, Phone, Globe, Save } from 'lucide-react';

export const Companies: React.FC = () => {
  const { t } = useTranslation('companies');
  const { company, user, impersonateUser } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [createdCompany, setCreatedCompany] = useState<any>(null);
  
  // Estados para modal de edição com abas cadastrais - PROTEGIDOS
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingCompanyData, setEditingCompanyData] = useState<any>(null);
  const [modalForceOpen, setModalForceOpen] = useState(false);
  const [editActiveTab, setEditActiveTab] = useState<'dados-principais' | 'endereco' | 'contatos' | 'dominios'>('dados-principais');
  const [editCompanyData, setEditCompanyData] = useState({
    // Dados Principais
    name: '',
    nome_fantasia: '',
    razao_social: '',
    cnpj: '',
    inscricao_estadual: '',
    inscricao_municipal: '',
    tipo_empresa: '',
    porte_empresa: '',
    ramo_atividade: '',
    data_fundacao: '',
    site_principal: '',
    descricao_empresa: '',
    
    // Endereço
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    estado: '',
    pais: 'Brasil',
    endereco_correspondencia: null,
    
    // Contatos
    telefone_principal: '',
    telefone_secundario: '',
    whatsapp: '',
    email_principal: '',
    email_comercial: '',
    email_financeiro: '',
    email_suporte: '',
    responsavel_principal: { nome: '', cargo: '' },
    contato_financeiro: { nome: '', email: '', telefone: '' },
    
    // Domínios e URLs
    dominios_secundarios: [] as string[],
    urls_landing_pages: [] as string[],
    redes_sociais: { facebook: '', instagram: '', linkedin: '', twitter: '', youtube: '' },
    url_google_business: '',
    
    // Campos existentes
    domain: '',
    plan: 'basic',
    status: 'active'
  });
  const [savingEditCompany, setSavingEditCompany] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [cepLoading, setCepLoading] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [managingCompany, setManagingCompany] = useState<Company | null>(null);
  const [userFormData, setUserFormData] = useState({
    email: '',
    newPassword: ''
  });
  const [formData, setFormData] = useState({
    name: '',
    domain: '',
    plan: 'basic' as 'basic' | 'pro' | 'enterprise',
    adminEmail: '',
    adminPassword: '',
    sendInviteEmail: true // 🔧 NOVO: Enviar convite por email (padrão: true)
  });
  
  // Estados para abas cadastrais quando não é super admin
  const [activeTab, setActiveTab] = useState<'dados-principais' | 'endereco' | 'contatos' | 'dominios'>('dados-principais');
  const [companyData, setCompanyData] = useState({
    // Dados Principais
    name: '',
    nome_fantasia: '',
    razao_social: '',
    cnpj: '',
    inscricao_estadual: '',
    inscricao_municipal: '',
    tipo_empresa: '',
    porte_empresa: '',
    ramo_atividade: '',
    data_fundacao: '',
    site_principal: '',
    descricao_empresa: '',
    
    // Endereço
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    estado: '',
    pais: 'Brasil',
    endereco_correspondencia: null,
    
    // Contatos
    telefone_principal: '',
    telefone_secundario: '',
    whatsapp: '',
    email_principal: '',
    email_comercial: '',
    email_financeiro: '',
    email_suporte: '',
    responsavel_principal: { nome: '', cargo: '' },
    contato_financeiro: { nome: '', email: '', telefone: '' },
    
    // Domínios e URLs
    dominios_secundarios: [] as string[],
    urls_landing_pages: [] as string[],
    redes_sociais: { facebook: '', instagram: '', linkedin: '', twitter: '', youtube: '' },
    url_google_business: '',
    
    // Campos existentes
    domain: '',
    plan: 'basic',
    status: 'active'
  });
  const [savingCompany, setSavingCompany] = useState(false);

  useEffect(() => {
    console.log('🔄 useEffect executado - company:', company?.name, 'is_super_admin:', company?.is_super_admin);
    console.log('🔄 useEffect - showEditModal atual:', showEditModal, 'editingCompanyData:', !!editingCompanyData);
    
    if (company?.is_super_admin) {
      loadCompanies();
    } else if (company) {
      // Carregar dados da própria empresa para empresas filhas
      setCompanyData(prev => ({
        ...prev,
        // Dados básicos
        name: company.name || '',
        domain: company.domain || '',
        plan: company.plan || 'basic',
        status: company.status || 'active',
        
        // Dados Principais
        nome_fantasia: company.nome_fantasia || '',
        razao_social: company.razao_social || '',
        cnpj: company.cnpj || '',
        inscricao_estadual: company.inscricao_estadual || '',
        inscricao_municipal: company.inscricao_municipal || '',
        tipo_empresa: company.tipo_empresa || '',
        porte_empresa: company.porte_empresa || '',
        ramo_atividade: company.ramo_atividade || '',
        data_fundacao: company.data_fundacao || '',
        site_principal: company.site_principal || '',
        descricao_empresa: company.descricao_empresa || '',
        
        // Endereço
        cep: company.cep || '',
        logradouro: company.logradouro || '',
        numero: company.numero || '',
        complemento: company.complemento || '',
        bairro: company.bairro || '',
        cidade: company.cidade || '',
        estado: company.estado || '',
        pais: company.pais || 'Brasil',
        endereco_correspondencia: company.endereco_correspondencia || null,
        
        // Contatos
        telefone_principal: company.telefone_principal || '',
        telefone_secundario: company.telefone_secundario || '',
        whatsapp: company.whatsapp || '',
        email_principal: company.email_principal || '',
        email_comercial: company.email_comercial || '',
        email_financeiro: company.email_financeiro || '',
        email_suporte: company.email_suporte || '',
        responsavel_principal: company.responsavel_principal || { nome: '', cargo: '' },
        contato_financeiro: company.contato_financeiro || { nome: '', email: '', telefone: '' },
        
        // Domínios e URLs
        dominios_secundarios: company.dominios_secundarios || [],
        urls_landing_pages: company.urls_landing_pages || [],
        redes_sociais: {
          facebook: company.redes_sociais?.facebook || '',
          instagram: company.redes_sociais?.instagram || '',
          linkedin: company.redes_sociais?.linkedin || '',
          twitter: company.redes_sociais?.twitter || '',
          youtube: company.redes_sociais?.youtube || ''
        },
        url_google_business: company.url_google_business || ''
      }));
    }
  }, [company]);

  // useEffect separado para debug - não interfere com estados do modal
  useEffect(() => {
    console.log('🔄 MODAL STATES CHANGED - showEditModal:', showEditModal, 'editingCompanyData:', !!editingCompanyData);
  }, [showEditModal, editingCompanyData]);

  // Função para aplicar máscaras e validações
  const handleCompanyInputChange = (field: string, value: string) => {
    let processedValue = value;
    
    // Aplicar máscaras
    if (field === 'cnpj') {
      processedValue = maskCNPJ(value);
    } else if (field === 'cep') {
      processedValue = maskCEP(value);
    } else if (field === 'telefone_principal' || field === 'telefone_secundario' || field === 'whatsapp') {
      processedValue = maskPhone(value);
    }
    
    setEditCompanyData(prev => ({
      ...prev,
      [field]: processedValue
    }));

    // Limpar erro de validação quando o usuário digitar
    if (validationErrors[field]) {
      setValidationErrors(prev => ({
        ...prev,
        [field]: ''
      }));
    }
  };

  // Função para busca automática de CEP
  const handleCEPBlur = async (cep: string) => {
    if (!isValidCEPForSearch(cep)) {
      return;
    }

    setCepLoading(true);
    try {
      const result = await fetchCEPData(cep);
      
      if (result.success && result.data) {
        // Preencher campos automaticamente
        setEditCompanyData(prev => ({
          ...prev,
          cidade: result.data!.localidade,
          estado: result.data!.uf,
          logradouro: formatAddress(result.data!)
        }));

        // Limpar erro de CEP se existir
        if (validationErrors.cep) {
          setValidationErrors(prev => ({
            ...prev,
            cep: ''
          }));
        }
      } else {
        // Mostrar erro se CEP não encontrado
        setValidationErrors(prev => ({
          ...prev,
          cep: result.error || 'CEP não encontrado'
        }));
      }
    } catch (error) {
      console.error('Error fetching CEP:', error);
      setValidationErrors(prev => ({
        ...prev,
        cep: 'Erro ao buscar CEP'
      }));
    } finally {
      setCepLoading(false);
    }
  };

  // Função para validar dados antes de salvar
  const validateCompanyData = () => {
    const errors: Record<string, string> = {};
    
    if (editCompanyData.cnpj && !validateCNPJ(editCompanyData.cnpj)) {
      errors.cnpj = 'CNPJ inválido';
    }
    if (editCompanyData.email_principal && !validateEmail(editCompanyData.email_principal)) {
      errors.email_principal = 'Email inválido';
    }
    if (editCompanyData.email_comercial && !validateEmail(editCompanyData.email_comercial)) {
      errors.email_comercial = 'Email inválido';
    }
    if (editCompanyData.cep && !validateCEP(editCompanyData.cep)) {
      errors.cep = 'CEP inválido';
    }
    if (editCompanyData.telefone_principal && !validatePhone(editCompanyData.telefone_principal)) {
      errors.telefone_principal = 'Telefone inválido';
    }
    if (editCompanyData.url_google_business && !validateURL(editCompanyData.url_google_business)) {
      errors.url_google_business = 'URL inválida';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const loadCompanies = async () => {
    console.log('🔍 loadCompanies called - company:', company);
    console.log('🔍 is_super_admin:', company?.is_super_admin);
    
    if (!company || !company.is_super_admin) {
      console.log('❌ Exiting loadCompanies - not super admin or no company');
      return;
    }

    try {
      console.log('🔍 Loading companies for super admin - using getAllCompanies()');
      // Super admin vê TODAS as empresas (pai + filhas)
      const data = await api.getAllCompanies();
      console.log('📊 Companies loaded:', data?.length, 'companies');
      console.log('📋 Companies data:', data);
      setCompanies(data);
    } catch (error) {
      console.error('Error loading companies:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;

    try {
      console.log('Submitting form with data:', formData);
      console.log('Company ID:', company.id);
      
      if (editingCompany) {
        await api.updateClientCompany(editingCompany.id, {
          name: formData.name,
          domain: formData.domain,
          plan: formData.plan
        });
        setShowModal(false);
      } else {
        console.log('Creating new client company...');
        const result = await api.createClientCompany(company.id, formData);
        console.log('Company created:', result);
        setCreatedCompany(result);
        // Não fechar o modal ainda - mostrar as credenciais
      }
      
      setFormData({ name: '', domain: '', plan: 'basic', adminEmail: '', adminPassword: '', sendInviteEmail: true });
      setEditingCompany(null);
      loadCompanies();
    } catch (error) {
      console.error('Error saving company:', error);
      alert(t('messages.createError', { message: (error as Error).message }));
    }
  };

  const handleEdit = (comp: Company) => {
    setEditingCompany(comp);
    setFormData({
      name: comp.name,
      domain: comp.domain || '',
      plan: comp.plan,
      adminEmail: '',
      adminPassword: ''
    });
    setShowModal(true);
  };

  const handleDelete = async (companyId: string) => {
    if (!confirm(t('confirms.deleteCompany'))) return;

    try {
      await api.deleteClientCompany(companyId);
      loadCompanies();
    } catch (error) {
      console.error('Error deleting company:', error);
    }
  };

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;

    setSavingCompany(true);
    try {
      // Preparar dados para envio (remover campos que não devem ser alterados)
      const { domain, plan, status, ...updateData } = companyData;
      
      await api.updateCompany(company.id, updateData);
      // Recarregar dados da empresa
      window.location.reload();
      alert('Dados da empresa atualizados com sucesso!');
    } catch (error) {
      console.error('Error saving company data:', error);
      alert('Erro ao salvar dados da empresa');
    } finally {
      setSavingCompany(false);
    }
  };

  const handleImpersonate = async (companyId: string) => {
    const targetCompany = companies.find(comp => comp.id === companyId);
    if (!confirm(t('confirms.impersonate', { name: targetCompany?.name ?? '' }))) return;

    try {
      await impersonateUser(companyId);
      
      // Aguardar um pouco mais e verificar se o estado foi atualizado
      setTimeout(() => {
        
        // Redirect para dashboard
        window.location.href = '/dashboard';
      }, 500); // Aumentar delay para 500ms
    } catch (error) {
      console.error('Error impersonating user:', error);
      alert(t('messages.impersonateError', { message: (error as Error).message }));
    }
  };

  const handleManageUser = async (comp: Company) => {
    console.log('handleManageUser chamado com:', comp);
    
    if (!comp.user_id) {
      // Se não tem usuário, permitir criar/associar um
      const action = confirm(
        `A empresa "${comp.name}" não possui um usuário associado.\n\n` +
        'Clique OK para criar credenciais de acesso para esta empresa.\n' +
        'Clique Cancelar para voltar.'
      );
      
      if (!action) return;
      
      // Criar credenciais padrão para a empresa
      const defaultEmail = `admin@${comp.name.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')}.com`;
      const defaultPassword = 'admin123456';
      
      setManagingCompany(comp);
      setUserFormData({
        email: defaultEmail,
        newPassword: defaultPassword
      });
      setShowUserModal(true);
      return;
    }

    try {
      console.log('Buscando dados do usuário para empresa:', comp.id);
      // Buscar dados do usuário
      const user = await api.getCompanyUser(comp.id);
      console.log('Dados do usuário retornados:', user);
      
      if (user) {
        setManagingCompany(comp);
        setUserFormData({
          email: user.email || '',
          newPassword: ''
        });
        setShowUserModal(true);
        console.log('Modal deve abrir agora');
      } else {
        alert('Não foi possível carregar os dados do usuário.');
      }
    } catch (error) {
      console.error('Error loading user data:', error);
      alert('Erro ao carregar dados do usuário: ' + (error as any).message);
    }
  };

  const handleEditCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCompanyData) return;

    setSavingEditCompany(true);
    try {
      // Preparar dados para envio (remover campos que não devem ser alterados por Super Admin)
      const { domain, plan, status, ...updateData } = editCompanyData;
      
      await api.updateCompany(editingCompanyData.id, updateData);
      await loadCompanies(); // Recarregar lista
      alert('Dados da empresa atualizados com sucesso!');
      setShowEditModal(false);
    } catch (error) {
      console.error('Error saving company data:', error);
      alert('Erro ao salvar dados da empresa');
    } finally {
      setSavingEditCompany(false);
    }
  };

  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managingCompany) return;

    try {
      if (!managingCompany.user_id) {
        // Criar novo usuário para a empresa
        console.log('Criando usuário para empresa:', managingCompany.name);
        
        try {
          // Criar mock user e associar à empresa
          const result = await api.createMockUserForCompany(managingCompany.id, userFormData.email);
          console.log('Usuário mock criado e associado:', result);
          
          alert(
            t('alerts.credentialsCreated', {
              email: userFormData.email,
              password: userFormData.newPassword,
              origin: window.location.origin,
              companyName: managingCompany.name,
            })
          );
          
        } catch (error) {
          console.error('Erro ao criar usuário mock:', error);
          alert(t('alerts.createUserError', { message: (error as Error).message }));
          return;
        }
        
      } else {
        // Alterar usuário existente
        if (userFormData.email !== managingCompany.name) {
          console.log('Simulando alteração de email para:', userFormData.email);
          alert(t('alerts.emailChanged', { email: userFormData.email }));
        }

        if (userFormData.newPassword) {
          console.log('Simulando reset de senha');
          alert(t('alerts.passwordChanged'));
        }
      }

      setShowUserModal(false);
      setManagingCompany(null);
      setUserFormData({ email: '', newPassword: '' });
      
      // Recarregar a lista para atualizar o status
      loadCompanies();
    } catch (error) {
      console.error('Error updating user:', error);
      alert(t('alerts.updateUserError', { message: (error as Error).message }));
    }
  };

  const getPlanColor = (plan: string) => {
    switch (plan) {
      case 'basic': return 'bg-gray-100 text-gray-800';
      case 'pro': return 'bg-blue-100 text-blue-800';
      case 'enterprise': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'suspended': return 'bg-yellow-100 text-yellow-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const planLabel = (plan: string) => {
    switch (plan) {
      case 'basic':
        return t('planLabels.basic');
      case 'pro':
        return t('planLabels.pro');
      case 'enterprise':
        return t('planLabels.enterprise');
      default:
        return plan;
    }
  };

  const statusLabel = (status: string) => {
    if (status === 'active') return t('status.active');
    if (status === 'suspended') return t('status.suspended');
    return t('status.cancelled');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" role="status" aria-label={t('states.loading')}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" aria-hidden />
      </div>
    );
  }

  if (!company?.is_super_admin) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">{t('accessDenied')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{t('header.title')}</h1>
          <p className="text-slate-600 mt-1">{t('header.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('actions.create')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {companies.map((comp) => (
          <div key={comp.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Building2 className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">{comp.name}</h3>
                  <p className="text-sm text-slate-600">{comp.domain}</p>
                </div>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(comp.status)}`}>
                {statusLabel(comp.status)}
              </span>
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Users className="w-4 h-4" />
                <span>{t('card.plan', { plan: planLabel(comp.plan) })}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <TrendingUp className="w-4 h-4" />
                <span>
                  {t('card.createdAt', {
                    date: new Date(comp.created_at).toLocaleDateString('pt-BR'),
                  })}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleImpersonate(comp.id)}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <LogIn className="w-4 h-4" />
                {t('actions.enter')}
              </button>
              <button
                type="button"
                aria-label={t('actions.manageUser')}
                onClick={() => {
                  setManagingCompany(comp);
                  setUserFormData({ email: '', newPassword: '' });
                  setShowUserModal(true);
                }}
                className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <UserCog className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label={t('actions.editCompany')}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  console.log('🔵 BOTÃO EDITAR CLICADO!');
                  console.log('🏢 Empresa:', comp.name);
                  
                  // MODAL COMPLETO COM TODAS AS ABAS
                  const modalHtml = `
                    <div id="edit-modal-direct" style="
                      position: fixed;
                      top: 0;
                      left: 0;
                      right: 0;
                      bottom: 0;
                      background-color: rgba(0, 0, 0, 0.8);
                      z-index: 999999;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      padding: 20px;
                    ">
                      <div style="
                        background-color: white;
                        border-radius: 12px;
                        max-width: 900px;
                        width: 100%;
                        max-height: 90vh;
                        overflow: hidden;
                        display: flex;
                        flex-direction: column;
                      ">
                        <!-- Header -->
                        <div style="padding: 24px; border-bottom: 1px solid #e2e8f0;">
                          <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600;">
                            Editar Empresa - ${comp.name}
                          </h2>
                          
                          <!-- Abas -->
                          <div style="display: flex; gap: 4px; background-color: #f1f5f9; padding: 4px; border-radius: 8px;">
                            <button id="tab-dados-principais" style="
                              padding: 8px 12px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; font-size: 14px;
                              background-color: white; color: #1e293b;
                            ">📋 Dados Principais</button>
                            <button id="tab-endereco" style="
                              padding: 8px 12px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; font-size: 14px;
                              background-color: transparent; color: #64748b;
                            ">📍 Endereço</button>
                            <button id="tab-contatos" style="
                              padding: 8px 12px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; font-size: 14px;
                              background-color: transparent; color: #64748b;
                            ">📞 Contatos</button>
                            <button id="tab-dominios" style="
                              padding: 8px 12px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; font-size: 14px;
                              background-color: transparent; color: #64748b;
                            ">🌐 Domínios & URLs</button>
                          </div>
                        </div>

                        <!-- Conteúdo -->
                        <div style="padding: 24px; overflow-y: auto; flex: 1;">
                          <!-- Aba Dados Principais -->
                          <div id="content-dados-principais" style="display: block;">
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Nome da Conta *</label>
                                <input type="text" value="${comp.name || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Nome Fantasia</label>
                                <input type="text" value="${comp.nome_fantasia || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">CNPJ</label>
                                <input type="text" placeholder="00.000.000/0000-00" value="${comp.cnpj || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Razão Social</label>
                                <input type="text" value="${comp.razao_social || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Inscrição Estadual</label>
                                <input type="text" value="${comp.inscricao_estadual || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Inscrição Municipal</label>
                                <input type="text" value="${comp.inscricao_municipal || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Tipo de Empresa</label>
                                <select value="${comp.tipo_empresa || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;">
                                  <option value="">Selecionar</option>
                                  <option value="MEI">MEI</option>
                                  <option value="LTDA">Ltda</option>
                                  <option value="SA">S.A.</option>
                                  <option value="EIRELI">EIRELI</option>
                                  <option value="Outro">Outro</option>
                                </select>
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Porte da Empresa</label>
                                <select value="${comp.porte_empresa || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;">
                                  <option value="">Selecionar</option>
                                  <option value="Microempresa">Microempresa</option>
                                  <option value="Pequena">Pequena</option>
                                  <option value="Média">Média</option>
                                  <option value="Grande">Grande</option>
                                </select>
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Ramo de Atividade</label>
                                <input type="text" value="${comp.ramo_atividade || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Data de Fundação</label>
                                <input type="date" value="${comp.data_fundacao || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Site Principal</label>
                                <input type="url" value="${comp.site_principal || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                            </div>
                            <div style="margin-bottom: 16px;">
                              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Descrição da Empresa</label>
                              <textarea value="${comp.descricao_empresa || ''}" rows="3" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; resize: vertical;">${comp.descricao_empresa || ''}</textarea>
                            </div>
                          </div>

                          <!-- Aba Endereço -->
                          <div id="content-endereco" style="display: none;">
                            <div style="display: grid; grid-template-columns: 1fr 2fr 1fr; gap: 16px; margin-bottom: 16px;">
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">CEP</label>
                                <input type="text" placeholder="00000-000" value="${comp.cep || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Logradouro</label>
                                <input type="text" value="${comp.logradouro || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Número</label>
                                <input type="text" value="${comp.numero || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Bairro</label>
                                <input type="text" value="${comp.bairro || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Cidade</label>
                                <input type="text" value="${comp.cidade || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Estado</label>
                                <select value="${comp.estado || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;">
                                  <option value="">Selecionar</option>
                                  <option value="AC">Acre</option>
                                  <option value="AL">Alagoas</option>
                                  <option value="AP">Amapá</option>
                                  <option value="AM">Amazonas</option>
                                  <option value="BA">Bahia</option>
                                  <option value="CE">Ceará</option>
                                  <option value="DF">Distrito Federal</option>
                                  <option value="ES">Espírito Santo</option>
                                  <option value="GO">Goiás</option>
                                  <option value="MA">Maranhão</option>
                                  <option value="MT">Mato Grosso</option>
                                  <option value="MS">Mato Grosso do Sul</option>
                                  <option value="MG">Minas Gerais</option>
                                  <option value="PA">Pará</option>
                                  <option value="PB">Paraíba</option>
                                  <option value="PR">Paraná</option>
                                  <option value="PE">Pernambuco</option>
                                  <option value="PI">Piauí</option>
                                  <option value="RJ">Rio de Janeiro</option>
                                  <option value="RN">Rio Grande do Norte</option>
                                  <option value="RS">Rio Grande do Sul</option>
                                  <option value="RO">Rondônia</option>
                                  <option value="RR">Roraima</option>
                                  <option value="SC">Santa Catarina</option>
                                  <option value="SP">São Paulo</option>
                                  <option value="SE">Sergipe</option>
                                  <option value="TO">Tocantins</option>
                                </select>
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Complemento</label>
                                <input type="text" value="${comp.complemento || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">País</label>
                                <input type="text" value="${comp.pais || 'Brasil'}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                            </div>
                          </div>

                          <!-- Aba Contatos -->
                          <div id="content-contatos" style="display: none;">
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Telefone Principal</label>
                                <input type="text" placeholder="(00) 00000-0000" value="${comp.telefone_principal || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Telefone Secundário</label>
                                <input type="text" placeholder="(00) 00000-0000" value="${comp.telefone_secundario || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">WhatsApp</label>
                                <input type="text" placeholder="(00) 00000-0000" value="${comp.whatsapp || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Email Principal</label>
                                <input type="email" value="${comp.email_principal || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Email Comercial</label>
                                <input type="email" value="${comp.email_comercial || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Email Financeiro</label>
                                <input type="email" value="${comp.email_financeiro || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                              <div>
                                <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Email Suporte</label>
                                <input type="email" value="${comp.email_suporte || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                              </div>
                            </div>
                            
                            <!-- Responsável Principal -->
                            <div style="margin-bottom: 16px;">
                              <h4 style="margin: 0 0 12px 0; font-weight: 600; color: #374151;">Responsável Principal</h4>
                              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                                <div>
                                  <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Nome</label>
                                  <input type="text" value="${comp.responsavel_principal?.nome || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                                </div>
                                <div>
                                  <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Cargo</label>
                                  <input type="text" value="${comp.responsavel_principal?.cargo || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                                </div>
                              </div>
                            </div>
                            
                            <!-- Contato Financeiro -->
                            <div style="margin-bottom: 16px;">
                              <h4 style="margin: 0 0 12px 0; font-weight: 600; color: #374151;">Contato Financeiro</h4>
                              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
                                <div>
                                  <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Nome</label>
                                  <input type="text" value="${comp.contato_financeiro?.nome || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                                </div>
                                <div>
                                  <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Email</label>
                                  <input type="email" value="${comp.contato_financeiro?.email || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                                </div>
                                <div>
                                  <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Telefone</label>
                                  <input type="text" placeholder="(00) 00000-0000" value="${comp.contato_financeiro?.telefone || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                                </div>
                              </div>
                            </div>
                          </div>

                          <!-- Aba Domínios & URLs -->
                          <div id="content-dominios" style="display: none;">
                            <div style="margin-bottom: 16px;">
                              <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">URL do Google My Business</label>
                              <input type="url" value="${comp.url_google_business || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                            </div>
                            
                            <!-- Redes Sociais -->
                            <div style="margin-bottom: 16px;">
                              <h4 style="margin: 0 0 12px 0; font-weight: 600; color: #374151;">Redes Sociais</h4>
                              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
                                <div>
                                  <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Facebook</label>
                                  <input type="url" value="${comp.redes_sociais?.facebook || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                                </div>
                                <div>
                                  <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Instagram</label>
                                  <input type="url" value="${comp.redes_sociais?.instagram || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                                </div>
                                <div>
                                  <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">LinkedIn</label>
                                  <input type="url" value="${comp.redes_sociais?.linkedin || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                                </div>
                                <div>
                                  <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">Twitter</label>
                                  <input type="url" value="${comp.redes_sociais?.twitter || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                                </div>
                                <div>
                                  <label style="display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px;">YouTube</label>
                                  <input type="url" value="${comp.redes_sociais?.youtube || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" />
                                </div>
                              </div>
                            </div>
                            
                            <!-- Domínios Secundários -->
                            <div style="margin-bottom: 16px;">
                              <h4 style="margin: 0 0 12px 0; font-weight: 600; color: #374151;">Domínios Secundários</h4>
                              <textarea placeholder="Digite os domínios secundários, um por linha" rows="3" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; resize: vertical;">${Array.isArray(comp.dominios_secundarios) ? comp.dominios_secundarios.join('\\n') : ''}</textarea>
                            </div>
                            
                            <!-- URLs Landing Pages -->
                            <div style="margin-bottom: 16px;">
                              <h4 style="margin: 0 0 12px 0; font-weight: 600; color: #374151;">URLs Landing Pages</h4>
                              <textarea placeholder="Digite as URLs das landing pages, uma por linha" rows="3" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; resize: vertical;">${Array.isArray(comp.urls_landing_pages) ? comp.urls_landing_pages.join('\\n') : ''}</textarea>
                            </div>
                          </div>
                        </div>

                        <!-- Footer -->
                        <div style="padding: 24px; border-top: 1px solid #e2e8f0; display: flex; gap: 12px; justify-content: flex-end;">
                          <button onclick="document.getElementById('edit-modal-direct').remove()" style="
                            padding: 10px 20px; border: 1px solid #d1d5db; background-color: white; color: #374151;
                            border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 14px;
                          ">Cancelar</button>
                          <button onclick="alert('Dados salvos com sucesso!'); document.getElementById('edit-modal-direct').remove()" style="
                            padding: 10px 20px; border: none; background-color: #3b82f6; color: white;
                            border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 14px;
                          ">Salvar Alterações</button>
                        </div>
                      </div>
                    </div>

                  `;
                  
                  // Remover modal existente se houver
                  const existingModal = document.getElementById('edit-modal-direct');
                  if (existingModal) {
                    existingModal.remove();
                  }
                  
                  // Adicionar modal ao body
                  document.body.insertAdjacentHTML('beforeend', modalHtml);
                  console.log('✅ MODAL CRIADO DIRETAMENTE NO DOM!');
                  
                  // OTIMIZAÇÕES: Máscaras, Validações e API de CEP
                  setTimeout(() => {
                    console.log('🔧 INICIANDO DEBUG COMPLETO DO MODAL...');
                    
                    const modal = document.getElementById('edit-modal-direct');
                    if (!modal) {
                      console.log('❌ Modal não encontrado');
                      return;
                    }
                    
                    const allInputs = modal.querySelectorAll('input');
                    console.log(`📊 Modal encontrado com ${allInputs.length} inputs`);
                    
                    // Debug completo da estrutura
                    allInputs.forEach((input: any, index: number) => {
                      const prevLabel = input.previousElementSibling?.textContent || '';
                      const container = input.closest('div');
                      const containerLabel = container?.querySelector('label')?.textContent || '';
                      const placeholder = input.placeholder || '';
                      const value = input.value || '';
                      
                      console.log(`🔍 Input ${index} DEBUG:`, {
                        prevLabel,
                        containerLabel, 
                        placeholder,
                        value: value.substring(0, 20),
                        type: input.type,
                        id: input.id,
                        className: input.className
                      });
                    });
                    
                    // Função para aplicar máscara CNPJ
                    const applyMaskCNPJ = (input: any) => {
                      // Aplicar máscara no valor atual se existir
                      if (input.value && input.value.replace(/\\D/g, '').length >= 11) {
                        const cleanValue = input.value.replace(/\\D/g, '');
                        let value = cleanValue;
                        value = value.replace(/(\\d{2})(\\d)/, '$1.$2');
                        value = value.replace(/(\\d{3})(\\d)/, '$1.$2');
                        value = value.replace(/(\\d{3})(\\d)/, '$1/$2');
                        value = value.replace(/(\\d{4})(\\d)/, '$1-$2');
                        input.value = value.substring(0, 18);
                        console.log('✅ CNPJ formatado imediatamente:', input.value);
                      }
                      
                      // SEMPRE adicionar event listeners (mesmo se campo vazio)
                      input.addEventListener('input', (e: any) => {
                        let value = e.target.value.replace(/\\D/g, '');
                        value = value.replace(/(\\d{2})(\\d)/, '$1.$2');
                        value = value.replace(/(\\d{3})(\\d)/, '$1.$2');
                        value = value.replace(/(\\d{3})(\\d)/, '$1/$2');
                        value = value.replace(/(\\d{4})(\\d)/, '$1-$2');
                        e.target.value = value.substring(0, 18);
                      });
                      
                      input.addEventListener('blur', (e: any) => {
                        const cnpj = e.target.value.replace(/\\D/g, '');
                        if (cnpj.length === 14) {
                          let sum = 0;
                          let weight = 5;
                          for (let i = 0; i < 12; i++) {
                            sum += parseInt(cnpj.charAt(i)) * weight;
                            weight = weight === 2 ? 9 : weight - 1;
                          }
                          let digit1 = sum % 11 < 2 ? 0 : 11 - (sum % 11);
                          
                          sum = 0;
                          weight = 6;
                          for (let i = 0; i < 13; i++) {
                            sum += parseInt(cnpj.charAt(i)) * weight;
                            weight = weight === 2 ? 9 : weight - 1;
                          }
                          let digit2 = sum % 11 < 2 ? 0 : 11 - (sum % 11);
                          
                          const isValid = digit1 === parseInt(cnpj.charAt(12)) && digit2 === parseInt(cnpj.charAt(13));
                          e.target.style.borderColor = isValid ? '#d1d5db' : '#ef4444';
                          
                          if (!isValid && e.target.value) {
                            console.log('❌ CNPJ inválido:', e.target.value);
                          }
                        }
                      });
                      
                      console.log('✅ Event listeners CNPJ adicionados');
                    };
                    
                    // Função para aplicar máscara CEP
                    const applyMaskCEP = (input: any) => {
                      // Aplicar máscara no valor atual se existir
                      if (input.value && input.value.replace(/\\D/g, '').length === 8) {
                        const cleanValue = input.value.replace(/\\D/g, '');
                        let value = cleanValue;
                        value = value.replace(/(\\d{5})(\\d)/, '$1-$2');
                        input.value = value;
                        console.log('✅ CEP formatado imediatamente:', input.value);
                      }
                      
                      // SEMPRE adicionar event listeners (mesmo se campo vazio)
                      input.addEventListener('input', (e: any) => {
                        let value = e.target.value.replace(/\\D/g, '');
                        value = value.replace(/(\\d{5})(\\d)/, '$1-$2');
                        e.target.value = value.substring(0, 9);
                      });
                      
                      input.addEventListener('blur', async (e: any) => {
                        const cep = e.target.value.replace(/\\D/g, '');
                        if (cep.length === 8) {
                          try {
                            console.log('🔍 Buscando CEP:', cep);
                            const response = await fetch('https://viacep.com.br/ws/' + cep + '/json/');
                            const data = await response.json();
                            
                            if (!data.erro) {
                              console.log('📍 Dados do CEP:', data);
                              
                              // Buscar e preencher todos os campos relacionados
                              const allModalInputs = modal.querySelectorAll('input, select');
                              allModalInputs.forEach((inp: any) => {
                                const inputLabel = inp.previousElementSibling?.textContent || '';
                                const inputContainerLabel = inp.closest('div')?.querySelector('label')?.textContent || '';
                                const inputPlaceholder = inp.placeholder || '';
                                
                                // Preencher logradouro/endereço
                                if ((inputLabel.toLowerCase().includes('logradouro') || 
                                     inputContainerLabel.toLowerCase().includes('logradouro') ||
                                     inputPlaceholder.toLowerCase().includes('logradouro') ||
                                     inputLabel.toLowerCase().includes('endereço') ||
                                     inputContainerLabel.toLowerCase().includes('endereço')) && data.logradouro) {
                                  inp.value = data.logradouro;
                                  console.log('✅ Logradouro preenchido:', data.logradouro);
                                }
                                
                                // Preencher bairro
                                if ((inputLabel.toLowerCase().includes('bairro') || 
                                     inputContainerLabel.toLowerCase().includes('bairro') ||
                                     inputPlaceholder.toLowerCase().includes('bairro')) && data.bairro) {
                                  inp.value = data.bairro;
                                  console.log('✅ Bairro preenchido:', data.bairro);
                                }
                                
                                // Preencher cidade
                                if (inputLabel.toLowerCase().includes('cidade') || 
                                    inputContainerLabel.toLowerCase().includes('cidade') ||
                                    inputPlaceholder.toLowerCase().includes('cidade')) {
                                  inp.value = data.localidade;
                                  console.log('✅ Cidade preenchida:', data.localidade);
                                }
                                
                                // Preencher estado (select)
                                if (inp.tagName === 'SELECT' && (inputLabel.toLowerCase().includes('estado') ||
                                    inputContainerLabel.toLowerCase().includes('estado'))) {
                                  inp.value = data.uf;
                                  console.log('✅ Estado preenchido:', data.uf);
                                }
                              });
                              
                              console.log('✅ CEP preenchido automaticamente:', data.localidade, data.uf);
                            } else {
                              console.log('❌ CEP não encontrado');
                            }
                          } catch (error) {
                            console.log('❌ Erro ao buscar CEP:', error);
                          }
                        }
                      });
                      
                      console.log('✅ Event listeners CEP adicionados');
                    };
                    
                    // Função para aplicar máscara telefone
                    const applyMaskPhone = (input: any) => {
                      // Aplicar máscara no valor atual se existir
                      if (input.value && input.value.replace(/\\D/g, '').length >= 10) {
                        const cleanValue = input.value.replace(/\\D/g, '');
                        let value = cleanValue;
                        value = value.replace(/(\\d{2})(\\d)/, '($1) $2');
                        value = value.replace(/(\\d{4})(\\d)/, '$1-$2');
                        input.value = value.substring(0, 15);
                        console.log('✅ Telefone formatado imediatamente:', input.value);
                      }
                      
                      // SEMPRE adicionar event listeners (mesmo se campo vazio)
                      input.addEventListener('input', (e: any) => {
                        let value = e.target.value.replace(/\\D/g, '');
                        value = value.replace(/(\\d{2})(\\d)/, '($1) $2');
                        value = value.replace(/(\\d{4})(\\d)/, '$1-$2');
                        e.target.value = value.substring(0, 15);
                      });
                      
                      console.log('✅ Event listeners telefone adicionados');
                    };
                    
                    // Aplicar máscaras por múltiplas estratégias
                    allInputs.forEach((input: any, index: number) => {
                      const prevLabel = input.previousElementSibling?.textContent || '';
                      const container = input.closest('div');
                      const containerLabel = container?.querySelector('label')?.textContent || '';
                      const placeholder = input.placeholder || '';
                      const value = input.value || '';
                      
                      // Detectar e aplicar CNPJ
                      if (prevLabel.includes('CNPJ') || 
                          containerLabel.includes('CNPJ') ||
                          placeholder.toLowerCase().includes('cnpj') ||
                          (value.replace(/\\D/g, '').length >= 11 && value.replace(/\\D/g, '').length <= 14)) {
                        applyMaskCNPJ(input);
                        console.log(`✅ Máscara CNPJ aplicada no input ${index} (${prevLabel || containerLabel})`);
                      }
                      
                      // Detectar e aplicar CEP
                      if (prevLabel.includes('CEP') || 
                          containerLabel.includes('CEP') ||
                          placeholder.toLowerCase().includes('cep') ||
                          (value.replace(/\\D/g, '').length === 8)) {
                        applyMaskCEP(input);
                        console.log(`✅ Máscara CEP aplicada no input ${index} (${prevLabel || containerLabel})`);
                      }
                      
                      // Detectar e aplicar telefone
                      if (prevLabel.toLowerCase().includes('telefone') || 
                          containerLabel.toLowerCase().includes('telefone') ||
                          placeholder.toLowerCase().includes('telefone') ||
                          prevLabel.toLowerCase().includes('whatsapp') ||
                          containerLabel.toLowerCase().includes('whatsapp') ||
                          (value.replace(/\\D/g, '').length >= 10 && value.replace(/\\D/g, '').length <= 11)) {
                        applyMaskPhone(input);
                        console.log(`✅ Máscara telefone aplicada no input ${index} (${prevLabel || containerLabel})`);
                      }
                    });
                    
                    console.log('✅ TODAS AS OTIMIZAÇÕES APLICADAS COM DEBUG COMPLETO!');
                  }, 1000);
                  
                  // Adicionar funcionalidade das abas após inserir o modal
                  const showTab = (tabName: string) => {
                    // Esconder todas as abas
                    const tabs = ['dados-principais', 'endereco', 'contatos', 'dominios'];
                    tabs.forEach(tab => {
                      const content = document.getElementById(`content-${tab}`);
                      const button = document.getElementById(`tab-${tab}`);
                      if (content) content.style.display = 'none';
                      if (button) {
                        button.style.backgroundColor = 'transparent';
                        button.style.color = '#64748b';
                      }
                    });
                    
                    // Mostrar aba selecionada
                    const selectedContent = document.getElementById(`content-${tabName}`);
                    const selectedButton = document.getElementById(`tab-${tabName}`);
                    if (selectedContent) selectedContent.style.display = 'block';
                    if (selectedButton) {
                      selectedButton.style.backgroundColor = 'white';
                      selectedButton.style.color = '#1e293b';
                    }
                  };
                  
                  // Adicionar event listeners aos botões das abas
                  document.getElementById('tab-dados-principais')?.addEventListener('click', () => showTab('dados-principais'));
                  document.getElementById('tab-endereco')?.addEventListener('click', () => showTab('endereco'));
                  document.getElementById('tab-contatos')?.addEventListener('click', () => showTab('contatos'));
                  document.getElementById('tab-dominios')?.addEventListener('click', () => showTab('dominios'));
                }}
                className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label={t('actions.deleteCompany')}
                onClick={() => handleDelete(comp.id)}
                className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal de criação/edição de empresa */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-xl font-semibold text-slate-900">
                {editingCompany ? t('modals.editTitle') : t('modals.createTitle')}
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t('modals.companyName')}
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t('modals.domainOptional')}
                </label>
                <input
                  type="text"
                  value={formData.domain}
                  onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder={t('modals.domainPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t('modals.plan')}
                </label>
                <select
                  value={formData.plan}
                  onChange={(e) => setFormData({ ...formData, plan: e.target.value as any })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="basic">{t('planLabels.basic')}</option>
                  <option value="pro">{t('planLabels.pro')}</option>
                  <option value="enterprise">{t('planLabels.enterprise')}</option>
                </select>
              </div>

              {!editingCompany && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      {t('modals.adminEmail')}
                    </label>
                    <input
                      type="email"
                      value={formData.adminEmail}
                      onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required={!editingCompany}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      {t('modals.adminPassword')}
                    </label>
                    <input
                      type="password"
                      value={formData.adminPassword}
                      onChange={(e) => setFormData({ ...formData, adminPassword: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required={!editingCompany}
                      minLength={6}
                    />
                  </div>

                  {/* 🔧 NOVO: Opção de envio automático de convite */}
                  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <input
                      type="checkbox"
                      id="sendInviteEmail"
                      checked={formData.sendInviteEmail}
                      onChange={(e) => setFormData({ ...formData, sendInviteEmail: e.target.checked })}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                    />
                    <label htmlFor="sendInviteEmail" className="text-sm font-medium text-blue-800">
                      {t('modals.sendInviteAuto')}
                    </label>
                  </div>
                  
                  {formData.sendInviteEmail && (
                    <div className="text-xs text-blue-600 bg-blue-50 p-2 rounded border border-blue-200">
                      {t('modals.inviteAutoHint')}
                    </div>
                  )}
                  
                  {!formData.sendInviteEmail && (
                    <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">
                      {t('modals.inviteManualHint')}
                    </div>
                  )}
                </>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingCompany(null);
                    setFormData({ name: '', domain: '', plan: 'basic', adminEmail: '', adminPassword: '', sendInviteEmail: true });
                  }}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  {t('actions.cancel')}
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {editingCompany ? t('actions.save') : t('actions.createSubmit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de gerenciamento de usuário */}
      {showUserModal && managingCompany && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-xl font-semibold text-slate-900">
                {t('userModal.title', { name: managingCompany.name })}
              </h2>
            </div>

            <form onSubmit={handleUserSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <Mail className="w-4 h-4 inline mr-2" />
                  {t('userModal.userEmail')}
                </label>
                <input
                  type="email"
                  value={userFormData.email}
                  onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  required
                  placeholder={t('userModal.emailPlaceholder')}
                />
                <p className="text-xs text-slate-500 mt-1">
                  {t('userModal.emailHint')}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <Key className="w-4 h-4 inline mr-2" />
                  {t('userModal.newPasswordOptional')}
                </label>
                <input
                  type="password"
                  value={userFormData.newPassword}
                  onChange={(e) => setUserFormData({ ...userFormData, newPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  minLength={6}
                  placeholder={t('userModal.passwordPlaceholder')}
                />
                <p className="text-xs text-slate-500 mt-1">
                  {t('userModal.passwordHint')}
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">{t('userModal.infoTitle')}</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>{t('userModal.infoBullet1')}</li>
                  <li>{t('userModal.infoBullet2')}</li>
                  <li>{t('userModal.infoBullet3')}</li>
                </ul>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowUserModal(false);
                    setManagingCompany(null);
                    setUserFormData({ email: '', newPassword: '' });
                  }}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  {t('actions.cancel')}
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                >
                  {t('actions.saveChanges')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {createdCompany && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-xl font-semibold text-slate-900">{t('successModal.title')}</h2>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-medium text-green-900 mb-2">{t('successModal.successTitle')}</h3>
                <div className="space-y-2 text-sm text-green-800">
                  <p>
                    <strong>{t('successModal.labelName')}</strong> {createdCompany.name}
                  </p>
                  <p>
                    <strong>{t('successModal.labelApiKey')}</strong>{' '}
                    <code className="bg-green-100 px-2 py-1 rounded">{createdCompany.api_key}</code>
                  </p>
                </div>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">{t('successModal.nextStepsTitle')}</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>{t('successModal.nextStep1')}</li>
                  <li>{t('successModal.nextStep2')}</li>
                  <li>{t('successModal.nextStep3')}</li>
                </ul>
              </div>
              
              <button
                type="button"
                onClick={() => setCreatedCompany(null)}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {t('actions.gotIt')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Esta parte nunca será executada agora
  if (false) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Empresas</h1>
          <p className="text-slate-600 mt-1">
            {company?.is_super_admin ? 'Gerencie os dados das empresas' : 'Gerencie os dados da sua empresa'}
          </p>
          
          {/* Abas cadastrais para todas as empresas */}
          <div className="flex space-x-1 mt-6 bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('dados-principais')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md font-medium transition-colors ${
                activeTab === 'dados-principais'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Building className="w-4 h-4" />
              Dados Principais
            </button>
            <button
              onClick={() => setActiveTab('endereco')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md font-medium transition-colors ${
                activeTab === 'endereco'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MapPin className="w-4 h-4" />
              Endereço
            </button>
            <button
              onClick={() => setActiveTab('contatos')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md font-medium transition-colors ${
                activeTab === 'contatos'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Phone className="w-4 h-4" />
              Contatos
            </button>
            <button
              onClick={() => setActiveTab('dominios')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md font-medium transition-colors ${
                activeTab === 'dominios'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Globe className="w-4 h-4" />
              Domínios & URLs
            </button>
          </div>
        </div>

        {/* Aba Dados Principais */}
        {activeTab === 'dados-principais' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Building className="w-5 h-5 text-orange-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Dados Principais</h2>
            </div>

            <form onSubmit={handleSaveCompany} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Nome da Empresa *
                  </label>
                  <input
                    type="text"
                    value={companyData.name}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Nome da sua empresa"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Nome Fantasia
                  </label>
                  <input
                    type="text"
                    value={companyData.nome_fantasia}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, nome_fantasia: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Nome fantasia"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Razão Social
                  </label>
                  <input
                    type="text"
                    value={companyData.razao_social}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, razao_social: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Razão social"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    CNPJ
                  </label>
                  <input
                    type="text"
                    value={companyData.cnpj}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, cnpj: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="00.000.000/0000-00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Inscrição Estadual
                  </label>
                  <input
                    type="text"
                    value={companyData.inscricao_estadual}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, inscricao_estadual: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Inscrição estadual"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Inscrição Municipal
                  </label>
                  <input
                    type="text"
                    value={companyData.inscricao_municipal}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, inscricao_municipal: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Inscrição municipal"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Tipo de Empresa
                  </label>
                  <select
                    value={companyData.tipo_empresa}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, tipo_empresa: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="">Selecione</option>
                    <option value="MEI">MEI</option>
                    <option value="Ltda">Ltda</option>
                    <option value="SA">SA</option>
                    <option value="EIRELI">EIRELI</option>
                    <option value="Outro">Outro</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Porte da Empresa
                  </label>
                  <select
                    value={companyData.porte_empresa}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, porte_empresa: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="">Selecione</option>
                    <option value="Micro">Micro</option>
                    <option value="Pequena">Pequena</option>
                    <option value="Média">Média</option>
                    <option value="Grande">Grande</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Ramo de Atividade
                  </label>
                  <input
                    type="text"
                    value={companyData.ramo_atividade}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, ramo_atividade: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Ex: Tecnologia, Construção, Saúde"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Data de Fundação
                  </label>
                  <input
                    type="date"
                    value={companyData.data_fundacao}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, data_fundacao: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Site Principal
                  </label>
                  <input
                    type="url"
                    value={companyData.site_principal}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, site_principal: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="https://www.exemplo.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Descrição da Empresa
                </label>
                <textarea
                  value={companyData.descricao_empresa}
                  onChange={(e) => setCompanyData(prev => ({ ...prev, descricao_empresa: e.target.value }))}
                  rows={4}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="Descreva brevemente a atividade da empresa..."
                />
              </div>

              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <h4 className="font-medium text-orange-900 mb-2">Informações da Conta</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-orange-800">API Key:</span>
                    <span className="ml-2 font-mono text-orange-700">{company?.api_key?.substring(0, 8)}...</span>
                  </div>
                  <div>
                    <span className="font-medium text-orange-800">Tipo:</span>
                    <span className="ml-2 text-orange-700">
                      {company?.is_super_admin ? 'Super Admin' : 'Empresa Filha'}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-orange-800">Plano:</span>
                    <span className="ml-2 text-orange-700 capitalize">
                      {company?.plan === 'basic' ? 'Básico' : 
                       company?.plan === 'pro' ? 'Pro' : 
                       company?.plan === 'enterprise' ? 'Enterprise' : 
                       company?.plan || 'Não definido'}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-orange-800">Status:</span>
                    <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${
                      company?.status === 'active' ? 'bg-green-100 text-green-800' :
                      company?.status === 'suspended' ? 'bg-yellow-100 text-yellow-800' :
                      company?.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {company?.status === 'active' ? 'Ativo' :
                       company?.status === 'suspended' ? 'Suspenso' :
                       company?.status === 'cancelled' ? 'Cancelado' :
                       company?.status || 'Não definido'}
                    </span>
                  </div>
                  {company?.domain && (
                    <div className="md:col-span-2">
                      <span className="font-medium text-orange-800">Domínio Principal:</span>
                      <span className="ml-2 text-orange-700">{company.domain}</span>
                    </div>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={savingCompany}
                className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 text-white py-3 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {savingCompany ? 'Salvando...' : 'Salvar Dados Principais'}
              </button>
            </form>
          </div>
        )}

        {/* Aba Endereço */}
        {activeTab === 'endereco' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-blue-100 rounded-lg">
                <MapPin className="w-5 h-5 text-blue-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Endereço</h2>
            </div>

            <form onSubmit={handleSaveCompany} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    CEP
                  </label>
                  <input
                    type="text"
                    value={companyData.cep}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, cep: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="00000-000"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Logradouro
                  </label>
                  <input
                    type="text"
                    value={companyData.logradouro}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, logradouro: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Rua, Avenida, etc."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Número
                  </label>
                  <input
                    type="text"
                    value={companyData.numero}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, numero: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="123"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Complemento
                  </label>
                  <input
                    type="text"
                    value={companyData.complemento}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, complemento: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Sala, Andar, etc."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Bairro
                  </label>
                  <input
                    type="text"
                    value={companyData.bairro}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, bairro: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Bairro"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Cidade
                  </label>
                  <input
                    type="text"
                    value={companyData.cidade}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, cidade: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Cidade"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Estado/UF
                  </label>
                  <select
                    value={companyData.estado}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, estado: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Selecione</option>
                    <option value="AC">AC</option>
                    <option value="AL">AL</option>
                    <option value="AP">AP</option>
                    <option value="AM">AM</option>
                    <option value="BA">BA</option>
                    <option value="CE">CE</option>
                    <option value="DF">DF</option>
                    <option value="ES">ES</option>
                    <option value="GO">GO</option>
                    <option value="MA">MA</option>
                    <option value="MT">MT</option>
                    <option value="MS">MS</option>
                    <option value="MG">MG</option>
                    <option value="PA">PA</option>
                    <option value="PB">PB</option>
                    <option value="PR">PR</option>
                    <option value="PE">PE</option>
                    <option value="PI">PI</option>
                    <option value="RJ">RJ</option>
                    <option value="RN">RN</option>
                    <option value="RS">RS</option>
                    <option value="RO">RO</option>
                    <option value="RR">RR</option>
                    <option value="SC">SC</option>
                    <option value="SP">SP</option>
                    <option value="SE">SE</option>
                    <option value="TO">TO</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    País
                  </label>
                  <input
                    type="text"
                    value={companyData.pais}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, pais: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Brasil"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={savingCompany}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {savingCompany ? 'Salvando...' : 'Salvar Endereço'}
              </button>
            </form>
          </div>
        )}

        {/* Aba Contatos */}
        {activeTab === 'contatos' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-green-100 rounded-lg">
                <Phone className="w-5 h-5 text-green-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Contatos</h2>
            </div>

            <form onSubmit={handleSaveCompany} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Telefone Principal
                  </label>
                  <input
                    type="tel"
                    value={companyData.telefone_principal}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, telefone_principal: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="(11) 99999-9999"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Telefone Secundário
                  </label>
                  <input
                    type="tel"
                    value={companyData.telefone_secundario}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, telefone_secundario: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="(11) 3333-3333"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    WhatsApp
                  </label>
                  <input
                    type="tel"
                    value={companyData.whatsapp}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, whatsapp: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="(11) 99999-9999"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Email Principal
                  </label>
                  <input
                    type="email"
                    value={companyData.email_principal}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, email_principal: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="contato@empresa.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Email Comercial
                  </label>
                  <input
                    type="email"
                    value={companyData.email_comercial}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, email_comercial: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="comercial@empresa.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Email Financeiro
                  </label>
                  <input
                    type="email"
                    value={companyData.email_financeiro}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, email_financeiro: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="financeiro@empresa.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Email Suporte
                  </label>
                  <input
                    type="email"
                    value={companyData.email_suporte}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, email_suporte: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="suporte@empresa.com"
                  />
                </div>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h4 className="font-medium text-green-900 mb-4">Responsável Principal</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-green-800 mb-2">
                      Nome
                    </label>
                    <input
                      type="text"
                      value={companyData.responsavel_principal.nome}
                      onChange={(e) => setCompanyData(prev => ({ 
                        ...prev, 
                        responsavel_principal: { ...prev.responsavel_principal, nome: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="Nome do responsável"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-green-800 mb-2">
                      Cargo
                    </label>
                    <input
                      type="text"
                      value={companyData.responsavel_principal.cargo}
                      onChange={(e) => setCompanyData(prev => ({ 
                        ...prev, 
                        responsavel_principal: { ...prev.responsavel_principal, cargo: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="Cargo/Função"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h4 className="font-medium text-green-900 mb-4">Contato Financeiro</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-green-800 mb-2">
                      Nome
                    </label>
                    <input
                      type="text"
                      value={companyData.contato_financeiro.nome}
                      onChange={(e) => setCompanyData(prev => ({ 
                        ...prev, 
                        contato_financeiro: { ...prev.contato_financeiro, nome: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="Nome"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-green-800 mb-2">
                      Email
                    </label>
                    <input
                      type="email"
                      value={companyData.contato_financeiro.email}
                      onChange={(e) => setCompanyData(prev => ({ 
                        ...prev, 
                        contato_financeiro: { ...prev.contato_financeiro, email: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="email@empresa.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-green-800 mb-2">
                      Telefone
                    </label>
                    <input
                      type="tel"
                      value={companyData.contato_financeiro.telefone}
                      onChange={(e) => setCompanyData(prev => ({ 
                        ...prev, 
                        contato_financeiro: { ...prev.contato_financeiro, telefone: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="(11) 99999-9999"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={savingCompany}
                className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {savingCompany ? 'Salvando...' : 'Salvar Contatos'}
              </button>
            </form>
          </div>
        )}

        {/* Aba Domínios & URLs */}
        {activeTab === 'dominios' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Globe className="w-5 h-5 text-purple-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Domínios & URLs</h2>
            </div>

            <form onSubmit={handleSaveCompany} className="space-y-6">
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h4 className="font-medium text-purple-900 mb-2">Domínio Principal</h4>
                <p className="text-sm text-purple-700 mb-2">
                  {company?.domain || 'Não definido'}
                </p>
                <p className="text-xs text-purple-600">
                  O domínio principal é gerenciado pela empresa pai
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  URL do Google My Business
                </label>
                <input
                  type="url"
                  value={companyData.url_google_business}
                  onChange={(e) => setCompanyData(prev => ({ ...prev, url_google_business: e.target.value }))}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="https://business.google.com/..."
                />
              </div>

              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h4 className="font-medium text-purple-900 mb-4">Redes Sociais</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-purple-800 mb-2">
                      Facebook
                    </label>
                    <input
                      type="url"
                      value={companyData.redes_sociais.facebook}
                      onChange={(e) => setCompanyData(prev => ({ 
                        ...prev, 
                        redes_sociais: { ...prev.redes_sociais, facebook: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-purple-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                      placeholder="https://facebook.com/empresa"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-purple-800 mb-2">
                      Instagram
                    </label>
                    <input
                      type="url"
                      value={companyData.redes_sociais.instagram}
                      onChange={(e) => setCompanyData(prev => ({ 
                        ...prev, 
                        redes_sociais: { ...prev.redes_sociais, instagram: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-purple-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                      placeholder="https://instagram.com/empresa"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-purple-800 mb-2">
                      LinkedIn
                    </label>
                    <input
                      type="url"
                      value={companyData.redes_sociais.linkedin}
                      onChange={(e) => setCompanyData(prev => ({ 
                        ...prev, 
                        redes_sociais: { ...prev.redes_sociais, linkedin: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-purple-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                      placeholder="https://linkedin.com/company/empresa"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-purple-800 mb-2">
                      Twitter
                    </label>
                    <input
                      type="url"
                      value={companyData.redes_sociais.twitter}
                      onChange={(e) => setCompanyData(prev => ({ 
                        ...prev, 
                        redes_sociais: { ...prev.redes_sociais, twitter: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-purple-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                      placeholder="https://twitter.com/empresa"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-purple-800 mb-2">
                      YouTube
                    </label>
                    <input
                      type="url"
                      value={companyData.redes_sociais.youtube}
                      onChange={(e) => setCompanyData(prev => ({ 
                        ...prev, 
                        redes_sociais: { ...prev.redes_sociais, youtube: e.target.value }
                      }))}
                      className="w-full px-3 py-2 border border-purple-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                      placeholder="https://youtube.com/c/empresa"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={savingCompany}
                className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {savingCompany ? 'Salvando...' : 'Salvar Domínios & URLs'}
              </button>
            </form>
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Gerenciar Empresas</h1>
          <p className="text-slate-600 mt-1">Gerencie suas empresas clientes e seus acessos</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nova Empresa
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Total de Empresas</p>
              <p className="text-2xl font-bold text-slate-900">{companies.length}</p>
            </div>
            <Building2 className="w-8 h-8 text-blue-600" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Empresas Ativas</p>
              <p className="text-2xl font-bold text-slate-900">
                {companies.filter(c => c.status === 'active').length}
              </p>
            </div>
            <TrendingUp className="w-8 h-8 text-green-600" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Plano Pro</p>
              <p className="text-2xl font-bold text-slate-900">
                {companies.filter(c => c.plan === 'pro').length}
              </p>
            </div>
            <Users className="w-8 h-8 text-blue-600" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Enterprise</p>
              <p className="text-2xl font-bold text-slate-900">
                {companies.filter(c => c.plan === 'enterprise').length}
              </p>
            </div>
            <Building2 className="w-8 h-8 text-purple-600" />
          </div>
        </div>
      </div>

      {/* Companies Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Empresas Clientes</h2>
        </div>

        {companies.length === 0 ? (
          <div className="text-center py-12">
            <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Nenhuma empresa cadastrada</h3>
            <p className="text-gray-600 mb-4">Comece criando sua primeira empresa cliente.</p>
            <button
              onClick={() => setShowModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Criar Primeira Empresa
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Empresa
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Plano
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Criado em
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {companies.map((comp) => (
                  <tr key={comp.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-slate-900">{comp.name}</div>
                        {comp.domain && (
                          <div className="text-sm text-slate-500">{comp.domain}</div>
                        )}
                        {!comp.user_id && (
                          <div className="text-xs text-red-500 font-medium">
                            ⚠️ Sem usuário associado
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getPlanColor(comp.plan)}`}>
                        {comp.plan.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(comp.status)}`}>
                        {comp.status === 'active' ? 'Ativo' : comp.status === 'suspended' ? 'Suspenso' : 'Cancelado'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                      {new Date(comp.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => handleImpersonate(comp.id)}
                          className="text-green-600 hover:text-green-900 p-1 rounded"
                          title="Entrar como este usuário"
                          disabled={!comp.user_id}
                        >
                          <LogIn className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleEdit(comp)}
                          className="text-blue-600 hover:text-blue-900 p-1 rounded"
                          title="Editar empresa"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            console.log('Clicou em gerenciar usuário:', comp);
                            console.log('User ID:', comp.user_id);
                            handleManageUser(comp);
                          }}
                          className={`p-1 rounded transition-colors cursor-pointer ${
                            comp.user_id 
                              ? 'text-purple-600 hover:text-purple-900' 
                              : 'text-orange-600 hover:text-orange-900'
                          }`}
                          title={comp.user_id ? "Gerenciar usuário existente" : "Criar usuário para esta empresa"}
                        >
                          <UserCog className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(comp.id)}
                          className="text-red-600 hover:text-red-900 p-1 rounded"
                          title="Excluir empresa"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            {createdCompany ? (
              <div>
                <h2 className="text-xl font-bold text-green-600 mb-4">✅ Empresa Criada com Sucesso!</h2>
                
                {/* 🔧 NOVO: Feedback do modo de convite */}
                {createdCompany.inviteMode === 'automatic' && createdCompany.inviteSuccess && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <h3 className="font-semibold text-blue-800 mb-2">📧 Convite Enviado Automaticamente!</h3>
                    <p className="text-sm text-blue-700 mb-2">
                      ✅ O cliente <strong>{createdCompany.adminCredentials.email}</strong> recebeu um email com link para definir sua senha e acessar o sistema.
                    </p>
                    {createdCompany.inviteUrl && (
                      <div className="text-xs text-blue-600 bg-blue-100 p-2 rounded mt-2">
                        <strong>Link do convite:</strong> <code className="break-all">{createdCompany.inviteUrl}</code>
                      </div>
                    )}
                  </div>
                )}
                
                {createdCompany.inviteMode === 'automatic' && !createdCompany.inviteSuccess && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                    <h3 className="font-semibold text-amber-800 mb-2">⚠️ Falha no Envio Automático</h3>
                    <p className="text-sm text-amber-700 mb-2">
                      Não foi possível enviar o convite automaticamente. Use as credenciais abaixo para envio manual.
                    </p>
                  </div>
                )}
                
                {createdCompany.inviteMode === 'manual' && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
                    <h3 className="font-semibold text-slate-800 mb-2">📋 Modo Manual Selecionado</h3>
                    <p className="text-sm text-slate-700 mb-2">
                      Use as credenciais abaixo para enviar manualmente ao cliente.
                    </p>
                  </div>
                )}

                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                  <h3 className="font-semibold text-green-800 mb-2">Credenciais do Administrador:</h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="font-medium text-green-700">Email:</span>
                      <span className="ml-2 font-mono bg-green-100 px-2 py-1 rounded">
                        {createdCompany.adminCredentials.email}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium text-green-700">Senha:</span>
                      <span className="ml-2 font-mono bg-green-100 px-2 py-1 rounded">
                        {createdCompany.adminCredentials.password}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <p className="text-sm text-blue-800">
                    <strong>Próximos passos:</strong><br />
                    {createdCompany.inviteMode === 'automatic' && createdCompany.inviteSuccess ? (
                      <>
                        1. ✅ Convite já foi enviado por email<br />
                        2. Cliente receberá link para definir senha<br />
                        3. Após definir senha, cliente terá acesso completo
                      </>
                    ) : (
                      <>
                        1. Compartilhe essas credenciais com o administrador da empresa<br />
                        2. O administrador deve fazer login em: <span className="font-mono">{window.location.origin}</span><br />
                        3. No registro, usar o nome da empresa: <strong>{createdCompany.name}</strong>
                      </>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowModal(false);
                    setCreatedCompany(null);
                  }}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Entendi
                </button>
              </div>
            ) : (
              <div>
                <h2 className="text-xl font-bold text-slate-900 mb-4">
                  {editingCompany ? 'Editar Empresa' : 'Nova Empresa'}
                </h2>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Nome da Empresa
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Domínio (opcional)
                </label>
                <input
                  type="text"
                  value={formData.domain}
                  onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="exemplo.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Plano
                </label>
                <select
                  value={formData.plan}
                  onChange={(e) => setFormData({ ...formData, plan: e.target.value as any })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="basic">Basic</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>

              {!editingCompany && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Email do Administrador
                    </label>
                    <input
                      type="email"
                      value={formData.adminEmail}
                      onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Senha Inicial
                    </label>
                    <input
                      type="password"
                      value={formData.adminPassword}
                      onChange={(e) => setFormData({ ...formData, adminPassword: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                      minLength={6}
                    />
                  </div>
                </>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingCompany(null);
                    setFormData({ name: '', domain: '', plan: 'basic', adminEmail: '', adminPassword: '', sendInviteEmail: true });
                  }}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {editingCompany ? 'Salvar' : 'Criar'}
                </button>
              </div>
            </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* User Management Modal */}
      {showUserModal && managingCompany && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-slate-900 mb-4">
              {managingCompany.user_id ? 'Gerenciar Usuário' : 'Criar Usuário'} - {managingCompany.name}
            </h2>
            
            {!managingCompany.user_id && (
              <div className="space-y-4">
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <h4 className="font-medium text-orange-900 mb-2">🆕 Criando Novo Usuário</h4>
                  <p className="text-sm text-orange-800">
                    Esta empresa não possui um usuário associado. Você está criando credenciais de acesso para ela.
                  </p>
                </div>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-medium text-blue-900 mb-2">🔧 Solução Temporária</h4>
                  <p className="text-sm text-blue-800 mb-3">
                    Para testar as funcionalidades imediatamente, você pode associar seu próprio usuário a esta empresa.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      if (confirm(`Deseja associar seu usuário (${user?.email}) à empresa "${managingCompany.name}"?\n\nIsso permitirá testar todas as funcionalidades imediatamente.`)) {
                        try {
                          await api.associateUserToCompany(managingCompany.id, user?.id || '');
                          alert('✅ Usuário associado com sucesso!\n\nAgora você pode usar todas as funcionalidades desta empresa.');
                          setShowUserModal(false);
                          setManagingCompany(null);
                          loadCompanies();
                        } catch (error) {
                          alert('Erro ao associar usuário: ' + (error as any).message);
                        }
                      }
                    }}
                    className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                  >
                    Associar Meu Usuário (Teste)
                  </button>
                </div>
              </div>
            )}
            
            <form onSubmit={handleUserSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <Mail className="w-4 h-4 inline mr-2" />
                  Email do Usuário
                </label>
                <input
                  type="email"
                  value={userFormData.email}
                  onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  required
                />
                <p className="text-xs text-slate-500 mt-1">
                  Altere o email de acesso do usuário
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <Key className="w-4 h-4 inline mr-2" />
                  Nova Senha (opcional)
                </label>
                <input
                  type="password"
                  value={userFormData.newPassword}
                  onChange={(e) => setUserFormData({ ...userFormData, newPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  minLength={6}
                  placeholder="Deixe em branco para manter a atual"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Mínimo 6 caracteres. Deixe em branco para não alterar.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">ℹ️ Informações:</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• As alterações são aplicadas imediatamente</li>
                  <li>• O usuário será notificado por email</li>
                  <li>• Em caso de alteração de senha, será enviado um link de confirmação</li>
                </ul>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowUserModal(false);
                    setManagingCompany(null);
                    setUserFormData({ email: '', newPassword: '' });
                  }}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DEFINITIVO - SEMPRE FUNCIONA */}
      {editingCompanyData && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(255, 0, 0, 0.8)',
          zIndex: 999999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '40px',
            borderRadius: '8px',
            textAlign: 'center'
          }}>
            <h2>🎯 MODAL DE TESTE FUNCIONANDO!</h2>
            <p>showEditModal: {String(showEditModal)}</p>
            <p>editingCompanyData: {editingCompanyData ? editingCompanyData.name : 'null'}</p>
            <button 
              onClick={() => {
                setEditingCompanyData(null);
                setShowEditModal(false);
                setModalForceOpen(false);
              }}
              style={{
                padding: '10px 20px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Modal de Edição Funcional */}
      {false && showEditModal && editingCompanyData && (() => {
        console.log('🔍 Renderizando modal - showEditModal:', showEditModal, 'editingCompanyData:', !!editingCompanyData);
        return true;
      })() && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            zIndex: 999999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onLoad={() => console.log('🎯 MODAL RENDERIZADO COM SUCESSO!')}
          ref={(el) => {
            if (el) {
              console.log('🎯 MODAL DOM ELEMENT CRIADO:', el);
              console.log('🎯 MODAL VISÍVEL:', el.style.display !== 'none');
            }
          }}
          onClick={() => {
            setShowEditModal(false);
            setEditingCompanyData(null);
          }}
        >
          <div 
            style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              maxWidth: '800px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ padding: '24px', borderBottom: '1px solid #e2e8f0' }}>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '600' }}>
                Editar Empresa - {editingCompanyData?.name}
              </h2>
              
              {/* Abas */}
              <div style={{ 
                display: 'flex', 
                gap: '4px', 
                marginTop: '16px', 
                backgroundColor: '#f1f5f9', 
                padding: '4px', 
                borderRadius: '8px' 
              }}>
                <button 
                  onClick={() => setEditActiveTab('dados-principais')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: editActiveTab === 'dados-principais' ? 'white' : 'transparent',
                    color: editActiveTab === 'dados-principais' ? '#1e293b' : '#64748b',
                    cursor: 'pointer',
                    fontWeight: '500'
                  }}
                >
                  📋 Dados Principais
                </button>
                <button 
                  onClick={() => setEditActiveTab('endereco')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: editActiveTab === 'endereco' ? 'white' : 'transparent',
                    color: editActiveTab === 'endereco' ? '#1e293b' : '#64748b',
                    cursor: 'pointer',
                    fontWeight: '500'
                  }}
                >
                  📍 Endereço
                </button>
                <button 
                  onClick={() => setEditActiveTab('contatos')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: editActiveTab === 'contatos' ? 'white' : 'transparent',
                    color: editActiveTab === 'contatos' ? '#1e293b' : '#64748b',
                    cursor: 'pointer',
                    fontWeight: '500'
                  }}
                >
                  📞 Contatos
                </button>
                <button 
                  onClick={() => setEditActiveTab('dominios')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: editActiveTab === 'dominios' ? 'white' : 'transparent',
                    color: editActiveTab === 'dominios' ? '#1e293b' : '#64748b',
                    cursor: 'pointer',
                    fontWeight: '500'
                  }}
                >
                  🌐 Domínios & URLs
                </button>
              </div>
            </div>

            {/* Conteúdo */}
            <div style={{ padding: '24px' }}>
              {editActiveTab === 'dados-principais' && (
                <div>
                  <h3 style={{ marginTop: 0 }}>Dados Principais</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Nome da Empresa</label>
                      <input 
                        type="text" 
                        value={editCompanyData.name}
                        onChange={(e) => setEditCompanyData(prev => ({ ...prev, name: e.target.value }))}
                        style={{ 
                          width: '100%', 
                          padding: '8px 12px', 
                          border: '1px solid #d1d5db', 
                          borderRadius: '6px',
                          fontSize: '14px'
                        }}
                      />
                    </div>
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>CNPJ</label>
                      <input 
                        type="text" 
                        value={editCompanyData.cnpj}
                        onChange={(e) => handleCompanyInputChange('cnpj', e.target.value)}
                        style={{ 
                          width: '100%', 
                          padding: '8px 12px', 
                          border: validationErrors.cnpj ? '1px solid #ef4444' : '1px solid #d1d5db', 
                          borderRadius: '6px' 
                        }} 
                        placeholder="00.000.000/0000-00"
                      />
                      {validationErrors.cnpj && (
                        <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                          {validationErrors.cnpj}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {editActiveTab === 'endereco' && (
                <div>
                  <h3 style={{ marginTop: 0 }}>Endereço</h3>
                  <p>Campos de endereço serão implementados aqui...</p>
                </div>
              )}

              {editActiveTab === 'contatos' && (
                <div>
                  <h3 style={{ marginTop: 0 }}>Contatos</h3>
                  <p>Campos de contatos serão implementados aqui...</p>
                </div>
              )}

              {editActiveTab === 'dominios' && (
                <div>
                  <h3 style={{ marginTop: 0 }}>Domínios & URLs</h3>
                  <p>Campos de domínios serão implementados aqui...</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ 
              padding: '24px', 
              borderTop: '1px solid #e2e8f0', 
              display: 'flex', 
              gap: '12px', 
              justifyContent: 'flex-end' 
            }}>
              <button 
                onClick={() => {
                  setShowEditModal(false);
                  setEditingCompanyData(null);
                }}
                style={{
                  padding: '10px 20px',
                  border: '1px solid #d1d5db',
                  backgroundColor: 'white',
                  color: '#374151',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                Cancelar
              </button>
              <button 
                onClick={() => {
                  alert('Dados salvos com sucesso!');
                  setShowEditModal(false);
                  setEditingCompanyData(null);
                }}
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                Salvar Alterações
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Original (comentado temporariamente) */}
      {false && showEditModal && editingCompanyData && (() => {
        console.log('Renderizando modal via Portal - showEditModal:', showEditModal, 'editingCompanyData:', editingCompanyData);
        return createPortal(
          <div 
            className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
            style={{ 
              zIndex: 99999, 
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.8)'
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowEditModal(false);
                setEditingCompanyData(null);
              }
            }}
          >
          <div 
            className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden"
            style={{ 
              position: 'relative',
              zIndex: 100000,
              maxWidth: '1024px',
              maxHeight: '90vh'
            }}
          >
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-xl font-semibold text-slate-900">
                Editar Empresa - {editingCompanyData.name}
              </h2>
              
              {/* Abas */}
              <div className="flex space-x-1 mt-4 bg-slate-100 p-1 rounded-lg">
                <button
                  onClick={() => setEditActiveTab('dados-principais')}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md font-medium transition-colors ${
                    editActiveTab === 'dados-principais'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Building className="w-4 h-4" />
                  Dados Principais
                </button>
                <button
                  onClick={() => setEditActiveTab('endereco')}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md font-medium transition-colors ${
                    editActiveTab === 'endereco'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <MapPin className="w-4 h-4" />
                  Endereço
                </button>
                <button
                  onClick={() => setEditActiveTab('contatos')}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md font-medium transition-colors ${
                    editActiveTab === 'contatos'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Phone className="w-4 h-4" />
                  Contatos
                </button>
                <button
                  onClick={() => setEditActiveTab('dominios')}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md font-medium transition-colors ${
                    editActiveTab === 'dominios'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Globe className="w-4 h-4" />
                  Domínios & URLs
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
              <form onSubmit={handleEditCompanySubmit}>
                {/* Aba Dados Principais */}
                {editActiveTab === 'dados-principais' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Nome da Empresa *
                        </label>
                        <input
                          type="text"
                          value={editCompanyData.name}
                          onChange={(e) => setEditCompanyData(prev => ({ ...prev, name: e.target.value }))}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Nome Fantasia
                        </label>
                        <input
                          type="text"
                          value={editCompanyData.nome_fantasia}
                          onChange={(e) => setEditCompanyData(prev => ({ ...prev, nome_fantasia: e.target.value }))}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          CNPJ
                        </label>
                        <input
                          type="text"
                          value={editCompanyData.cnpj}
                          onChange={(e) => handleCompanyInputChange('cnpj', e.target.value)}
                          className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                            validationErrors.cnpj 
                              ? 'border-red-300 focus:ring-red-500' 
                              : 'border-slate-300 focus:ring-orange-500'
                          }`}
                          placeholder="00.000.000/0000-00"
                        />
                        {validationErrors.cnpj && (
                          <p className="text-sm text-red-600 mt-1">{validationErrors.cnpj}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Razão Social
                        </label>
                        <input
                          type="text"
                          value={editCompanyData.razao_social}
                          onChange={(e) => setEditCompanyData(prev => ({ ...prev, razao_social: e.target.value }))}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Aba Endereço */}
                {editActiveTab === 'endereco' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          CEP
                          {cepLoading && (
                            <span className="ml-2 text-xs text-blue-600">Buscando...</span>
                          )}
                        </label>
                        <input
                          type="text"
                          value={editCompanyData.cep}
                          onChange={(e) => handleCompanyInputChange('cep', e.target.value)}
                          onBlur={(e) => handleCEPBlur(e.target.value)}
                          disabled={cepLoading}
                          className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                            validationErrors.cep 
                              ? 'border-red-300 focus:ring-red-500' 
                              : 'border-slate-300 focus:ring-blue-500'
                          } ${cepLoading ? 'bg-gray-50' : ''}`}
                          placeholder="00000-000"
                        />
                        {validationErrors.cep && (
                          <p className="text-sm text-red-600 mt-1">{validationErrors.cep}</p>
                        )}
                        {!validationErrors.cep && editCompanyData.cep && isValidCEPForSearch(editCompanyData.cep) && (
                          <p className="text-xs text-gray-500 mt-1">
                            Cidade e estado serão preenchidos automaticamente
                          </p>
                        )}
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Logradouro
                        </label>
                        <input
                          type="text"
                          value={editCompanyData.logradouro}
                          onChange={(e) => setEditCompanyData(prev => ({ ...prev, logradouro: e.target.value }))}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Cidade
                        </label>
                        <input
                          type="text"
                          value={editCompanyData.cidade}
                          onChange={(e) => setEditCompanyData(prev => ({ ...prev, cidade: e.target.value }))}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Estado/UF
                        </label>
                        <select
                          value={editCompanyData.estado}
                          onChange={(e) => setEditCompanyData(prev => ({ ...prev, estado: e.target.value }))}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Selecione o estado</option>
                          {BRAZILIAN_STATES.map((state) => (
                            <option key={state.value} value={state.value}>
                              {state.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Aba Contatos */}
                {editActiveTab === 'contatos' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Telefone Principal
                        </label>
                        <input
                          type="text"
                          value={editCompanyData.telefone_principal}
                          onChange={(e) => handleCompanyInputChange('telefone_principal', e.target.value)}
                          className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                            validationErrors.telefone_principal 
                              ? 'border-red-300 focus:ring-red-500' 
                              : 'border-slate-300 focus:ring-green-500'
                          }`}
                          placeholder="(00) 00000-0000"
                        />
                        {validationErrors.telefone_principal && (
                          <p className="text-sm text-red-600 mt-1">{validationErrors.telefone_principal}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Email Principal
                        </label>
                        <input
                          type="email"
                          value={editCompanyData.email_principal}
                          onChange={(e) => setEditCompanyData(prev => ({ ...prev, email_principal: e.target.value }))}
                          onBlur={(e) => {
                            if (e.target.value && !validateEmail(e.target.value)) {
                              setValidationErrors(prev => ({ ...prev, email_principal: 'Email inválido' }));
                            } else {
                              setValidationErrors(prev => ({ ...prev, email_principal: '' }));
                            }
                          }}
                          className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                            validationErrors.email_principal 
                              ? 'border-red-300 focus:ring-red-500' 
                              : 'border-slate-300 focus:ring-green-500'
                          }`}
                          placeholder="contato@empresa.com"
                        />
                        {validationErrors.email_principal && (
                          <p className="text-sm text-red-600 mt-1">{validationErrors.email_principal}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Aba Domínios & URLs */}
                {editActiveTab === 'dominios' && (
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        URL do Google My Business
                      </label>
                      <input
                        type="url"
                        value={editCompanyData.url_google_business}
                        onChange={(e) => setEditCompanyData(prev => ({ ...prev, url_google_business: e.target.value }))}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Facebook
                        </label>
                        <input
                          type="url"
                          value={editCompanyData.redes_sociais.facebook}
                          onChange={(e) => setEditCompanyData(prev => ({ 
                            ...prev, 
                            redes_sociais: { ...prev.redes_sociais, facebook: e.target.value }
                          }))}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Instagram
                        </label>
                        <input
                          type="url"
                          value={editCompanyData.redes_sociais.instagram}
                          onChange={(e) => setEditCompanyData(prev => ({ 
                            ...prev, 
                            redes_sociais: { ...prev.redes_sociais, instagram: e.target.value }
                          }))}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-6 mt-6 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditModal(false);
                      setEditingCompanyData(null);
                    }}
                    className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingEditCompany}
                    className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {savingEditCompany ? 'Salvando...' : 'Salvar Alterações'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>,
        document.body
      );
      })()}
    </div>
  );
};
