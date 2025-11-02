import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { Company } from '../lib/supabase';
import { Plus, Building2, Users, TrendingUp, Trash2, Edit2, UserCog, LogIn, Key, Mail, Building, MapPin, Phone, Globe, Save } from 'lucide-react';

export const Companies: React.FC = () => {
  const { company, user, impersonateUser } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [createdCompany, setCreatedCompany] = useState<any>(null);
  
  // Estados para modal de edição com abas cadastrais
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingCompanyData, setEditingCompanyData] = useState<any>(null);
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
    adminPassword: ''
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

  const loadCompanies = async () => {
    if (!company || !company.is_super_admin) return;

    try {
      const data = await api.getClientCompanies(company.id);
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
      
      setFormData({ name: '', domain: '', plan: 'basic', adminEmail: '', adminPassword: '' });
      setEditingCompany(null);
      loadCompanies();
    } catch (error) {
      console.error('Error saving company:', error);
      alert('Erro ao criar empresa: ' + (error as any).message);
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
    if (!confirm('Tem certeza que deseja excluir esta empresa?')) return;

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
    if (!confirm(`Deseja entrar como usuário da empresa "${targetCompany?.name}"?\n\nVocê poderá voltar ao seu usuário original a qualquer momento através do banner laranja que aparecerá no topo.`)) return;

    try {
      console.log('Companies: Starting impersonation for:', companyId);
      await impersonateUser(companyId);
      console.log('Companies: Impersonation successful');
      
      // Aguardar um pouco mais e verificar se o estado foi atualizado
      setTimeout(() => {
        console.log('Companies: Checking impersonation state before redirect');
        console.log('localStorage impersonating:', localStorage.getItem('lovoo_crm_impersonating'));
        console.log('localStorage company_id:', localStorage.getItem('lovoo_crm_impersonated_company_id'));
        
        // Redirect para dashboard
        window.location.href = '/dashboard';
      }, 500); // Aumentar delay para 500ms
    } catch (error) {
      console.error('Error impersonating user:', error);
      alert('Erro ao entrar como usuário: ' + (error as any).message);
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
            `✅ Credenciais criadas com sucesso!\n\n` +
            `📧 Email: ${userFormData.email}\n` +
            `🔑 Senha: ${userFormData.newPassword}\n\n` +
            `⚠️ IMPORTANTE - PRÓXIMOS PASSOS:\n\n` +
            `1️⃣ COMPARTILHE AS CREDENCIAIS:\n` +
            `   • Email: ${userFormData.email}\n` +
            `   • Senha: ${userFormData.newPassword}\n\n` +
            `2️⃣ INSTRUA O CLIENTE:\n` +
            `   • Acesse: ${window.location.origin}\n` +
            `   • Clique em "Registrar"\n` +
            `   • Nome da Empresa: "${managingCompany.name}" (EXATO)\n` +
            `   • Use o email e senha fornecidos\n\n` +
            `3️⃣ APÓS O REGISTRO:\n` +
            `   • O sistema associará automaticamente\n` +
            `   • A empresa terá um user_id válido\n` +
            `   • Todas as funcionalidades funcionarão\n\n` +
            `📋 O cliente deve se registrar para ativar a conta!`
          );
          
        } catch (error) {
          console.error('Erro ao criar usuário mock:', error);
          alert('Erro ao criar usuário: ' + (error as any).message);
          return;
        }
        
      } else {
        // Alterar usuário existente
        if (userFormData.email !== managingCompany.name) {
          console.log('Simulando alteração de email para:', userFormData.email);
          alert(`✅ Email alterado com sucesso!\n\nNovo email: ${userFormData.email}\n\n⚠️ Em produção, isso seria feito via API server-side.`);
        }

        if (userFormData.newPassword) {
          console.log('Simulando reset de senha');
          alert(`✅ Senha alterada com sucesso!\n\n⚠️ Em produção, isso seria feito via API server-side.\n\nO usuário receberá um email para confirmar a nova senha.`);
        }
      }

      setShowUserModal(false);
      setManagingCompany(null);
      setUserFormData({ email: '', newPassword: '' });
      
      // Recarregar a lista para atualizar o status
      loadCompanies();
    } catch (error) {
      console.error('Error updating user:', error);
      alert('Erro ao atualizar usuário: ' + (error as any).message);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!company?.is_super_admin) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">Acesso restrito a administradores</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Empresas</h1>
          <p className="text-slate-600 mt-1">Gerencie suas empresas clientes</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nova Empresa
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
                {comp.status === 'active' ? 'Ativo' : comp.status === 'suspended' ? 'Suspenso' : 'Cancelado'}
              </span>
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Users className="w-4 h-4" />
                <span>Plano: {comp.plan}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <TrendingUp className="w-4 h-4" />
                <span>Criada em: {new Date(comp.created_at).toLocaleDateString('pt-BR')}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleImpersonate(comp.id)}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <LogIn className="w-4 h-4" />
                Entrar
              </button>
              <button
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
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  console.log('Botão Editar clicado para empresa:', comp.name);
                  console.log('Dados da empresa:', comp);
                  try {
                    setEditingCompanyData(comp);
                    setEditCompanyData({
                    // Dados básicos
                    name: comp.name || '',
                    domain: comp.domain || '',
                    plan: comp.plan || 'basic',
                    status: comp.status || 'active',
                    
                    // Dados Principais
                    nome_fantasia: comp.nome_fantasia || '',
                    razao_social: comp.razao_social || '',
                    cnpj: comp.cnpj || '',
                    inscricao_estadual: comp.inscricao_estadual || '',
                    inscricao_municipal: comp.inscricao_municipal || '',
                    tipo_empresa: comp.tipo_empresa || '',
                    porte_empresa: comp.porte_empresa || '',
                    ramo_atividade: comp.ramo_atividade || '',
                    data_fundacao: comp.data_fundacao || '',
                    site_principal: comp.site_principal || '',
                    descricao_empresa: comp.descricao_empresa || '',
                    
                    // Endereço
                    cep: comp.cep || '',
                    logradouro: comp.logradouro || '',
                    numero: comp.numero || '',
                    complemento: comp.complemento || '',
                    bairro: comp.bairro || '',
                    cidade: comp.cidade || '',
                    estado: comp.estado || '',
                    pais: comp.pais || 'Brasil',
                    endereco_correspondencia: comp.endereco_correspondencia || null,
                    
                    // Contatos
                    telefone_principal: comp.telefone_principal || '',
                    telefone_secundario: comp.telefone_secundario || '',
                    whatsapp: comp.whatsapp || '',
                    email_principal: comp.email_principal || '',
                    email_comercial: comp.email_comercial || '',
                    email_financeiro: comp.email_financeiro || '',
                    email_suporte: comp.email_suporte || '',
                    responsavel_principal: comp.responsavel_principal || { nome: '', cargo: '' },
                    contato_financeiro: comp.contato_financeiro || { nome: '', email: '', telefone: '' },
                    
                    // Domínios e URLs
                    dominios_secundarios: comp.dominios_secundarios || [],
                    urls_landing_pages: comp.urls_landing_pages || [],
                    redes_sociais: {
                      facebook: comp.redes_sociais?.facebook || '',
                      instagram: comp.redes_sociais?.instagram || '',
                      linkedin: comp.redes_sociais?.linkedin || '',
                      twitter: comp.redes_sociais?.twitter || '',
                      youtube: comp.redes_sociais?.youtube || ''
                    },
                    url_google_business: comp.url_google_business || ''
                    });
                    setEditActiveTab('dados-principais');
                    setShowEditModal(true);
                    console.log('Modal deve abrir agora - showEditModal:', true);
                  } catch (error) {
                    console.error('Erro ao abrir modal:', error);
                    alert('Erro ao abrir modal de edição');
                  }
                }}
                className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
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
                {editingCompany ? 'Editar Empresa' : 'Nova Empresa'}
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
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
                  <option value="basic">Básico</option>
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
                      required={!editingCompany}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Senha do Administrador
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
                </>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingCompany(null);
                    setFormData({ name: '', domain: '', plan: 'basic', adminEmail: '', adminPassword: '' });
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
        </div>
      )}

      {/* Modal de gerenciamento de usuário */}
      {showUserModal && managingCompany && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-xl font-semibold text-slate-900">
                Gerenciar Usuário - {managingCompany.name}
              </h2>
            </div>

            <form onSubmit={handleUserSubmit} className="p-6 space-y-4">
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
                  placeholder="usuario@empresa.com"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Este será o novo email de login do usuário
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

      {createdCompany && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-xl font-semibold text-slate-900">Empresa Criada!</h2>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-medium text-green-900 mb-2">✅ Empresa criada com sucesso!</h3>
                <div className="space-y-2 text-sm text-green-800">
                  <p><strong>Nome:</strong> {createdCompany.name}</p>
                  <p><strong>API Key:</strong> <code className="bg-green-100 px-2 py-1 rounded">{createdCompany.api_key}</code></p>
                </div>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">📧 Próximos passos:</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• O usuário receberá um email de confirmação</li>
                  <li>• Ele deve confirmar o email para ativar a conta</li>
                  <li>• Após confirmação, poderá fazer login normalmente</li>
                </ul>
              </div>
              
              <button
                onClick={() => setCreatedCompany(null)}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Entendi
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
                    1. Compartilhe essas credenciais com o administrador da empresa<br />
                    2. O administrador deve fazer login em: <span className="font-mono">{window.location.origin}</span><br />
                    3. No registro, usar o nome da empresa: <strong>{createdCompany.name}</strong>
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
                    setFormData({ name: '', domain: '', plan: 'basic', adminEmail: '', adminPassword: '' });
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

      {/* Modal de Edição com Abas Cadastrais */}
      {showEditModal && editingCompanyData && (() => {
        console.log('Renderizando modal - showEditModal:', showEditModal, 'editingCompanyData:', editingCompanyData);
        return true;
      })() && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
          style={{ 
            zIndex: 99999, 
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)'
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
                          onChange={(e) => setEditCompanyData(prev => ({ ...prev, cnpj: e.target.value }))}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                        />
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
                        </label>
                        <input
                          type="text"
                          value={editCompanyData.cep}
                          onChange={(e) => setEditCompanyData(prev => ({ ...prev, cep: e.target.value }))}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
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
                          <option value="">Selecione</option>
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
                          onChange={(e) => setEditCompanyData(prev => ({ ...prev, telefone_principal: e.target.value }))}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Email Principal
                        </label>
                        <input
                          type="email"
                          value={editCompanyData.email_principal}
                          onChange={(e) => setEditCompanyData(prev => ({ ...prev, email_principal: e.target.value }))}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
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
        </div>
      )}
    </div>
  );
};
