import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { Webhook, Key, Save, Clock, Building, MapPin, Phone, Globe, Settings as SettingsIcon } from 'lucide-react';

export const Settings: React.FC = () => {
  const { company, refreshCompany } = useAuth();
  const [webhookUrl, setWebhookUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  
  // Estados para abas principais
  const [activeTab, setActiveTab] = useState<'settings' | 'empresas'>('settings');
  const [empresasTab, setEmpresasTab] = useState<'dados-principais' | 'endereco' | 'contatos' | 'dominios'>('dados-principais');
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
    if (company) {
      setWebhookUrl(company.webhook_url || '');
      loadWebhookLogs();
      
      // Carregar dados da empresa para as abas cadastrais
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

  const loadWebhookLogs = async () => {
    if (!company?.id) return;
    
    try {
      setLoadingLogs(true);
      const response = await api.getWebhookLogs(company.id);
      setLogs(response || []);
    } catch (error) {
      console.error('Error loading webhook logs:', error);
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;

    setSaving(true);
    try {
      await api.updateCompany(company.id, { webhook_url: webhookUrl });
      await refreshCompany();
      alert('Webhook URL atualizada com sucesso!');
    } catch (error) {
      console.error('Error saving webhook:', error);
      alert('Erro ao salvar webhook URL');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;

    setSavingCompany(true);
    try {
      // Preparar dados para envio (remover campos que não devem ser alterados)
      const { domain, plan, status, ...updateData } = companyData;
      
      console.log('🔄 Salvando dados da empresa:', { companyId: company.id, updateData });
      
      await api.updateCompany(company.id, updateData);
      await refreshCompany();
      
      console.log('✅ Dados salvos com sucesso!');
      alert('Dados da empresa atualizados com sucesso!');
    } catch (error) {
      console.error('❌ Error saving company data:', error);
      
      // Mostrar erro mais detalhado
      let errorMessage = 'Erro ao salvar dados da empresa';
      if (error instanceof Error) {
        errorMessage += ': ' + error.message;
      }
      
      alert(errorMessage);
    } finally {
      setSavingCompany(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('Copiado para a área de transferência!');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Configurações</h1>
        <p className="text-slate-600 mt-1">Gerencie as configurações da sua conta</p>
        
        {/* Abas principais */}
        <div className="flex space-x-1 mt-6 bg-slate-100 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === 'settings'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <SettingsIcon className="w-4 h-4" />
            Configurações
          </button>
          <button
            onClick={() => setActiveTab('empresas')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === 'empresas'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Building className="w-4 h-4" />
            Empresas
          </button>
        </div>
      </div>

      {/* Aba Configurações Técnicas */}
      {activeTab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Key className="w-5 h-5 text-blue-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">API Key</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Sua API Key (usada nos scripts de tracking)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={company?.api_key || 'Carregando...'}
                    readOnly
                    className="flex-1 px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-mono text-sm"
                  />
                  <button
                    onClick={() => copyToClipboard(company?.api_key || '')}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                  >
                    Copiar
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Use esta chave para identificar sua empresa nas requisições de tracking
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-green-100 rounded-lg">
                <Webhook className="w-5 h-5 text-green-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Webhook Personalizado</h2>
            </div>

            <form onSubmit={handleSaveWebhook} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  URL do Webhook
                </label>
                <input
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://seu-site.com/webhook"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-500 mt-2">
                  Enviaremos dados de conversão com analytics comportamental para esta URL
                </p>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Salvando...' : 'Salvar Webhook'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Aba Empresas com Sub-abas */}
      {activeTab === 'empresas' && (
        <div className="space-y-6">
          {/* Sub-abas da Empresa */}
          <div className="flex space-x-1 bg-slate-50 p-1 rounded-lg">
            <button
              onClick={() => setEmpresasTab('dados-principais')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md font-medium transition-colors ${
                empresasTab === 'dados-principais'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Building className="w-4 h-4" />
              Dados Principais
            </button>
            <button
              onClick={() => setEmpresasTab('endereco')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md font-medium transition-colors ${
                empresasTab === 'endereco'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MapPin className="w-4 h-4" />
              Endereço
            </button>
            <button
              onClick={() => setEmpresasTab('contatos')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md font-medium transition-colors ${
                empresasTab === 'contatos'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Phone className="w-4 h-4" />
              Contatos
            </button>
            <button
              onClick={() => setEmpresasTab('dominios')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md font-medium transition-colors ${
                empresasTab === 'dominios'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Globe className="w-4 h-4" />
              Domínios & URLs
            </button>
          </div>

          {/* Conteúdo das Sub-abas */}
          {empresasTab === 'dados-principais' && (
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
                      Razão Social
                    </label>
                    <input
                      type="text"
                      value={companyData.razao_social}
                      onChange={(e) => setCompanyData(prev => ({ ...prev, razao_social: e.target.value }))}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="Razão social da empresa"
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
                      <option value="">Selecionar</option>
                      <option value="MEI">MEI</option>
                      <option value="LTDA">Ltda</option>
                      <option value="SA">S.A.</option>
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
                      <option value="">Selecionar</option>
                      <option value="Microempresa">Microempresa</option>
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
                      placeholder="Ramo de atividade"
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
                      placeholder="https://www.empresa.com"
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
                    rows={3}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 resize-vertical"
                    placeholder="Descreva brevemente sua empresa..."
                  />
                </div>

                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <h4 className="font-medium text-orange-900 mb-2">Informações da Conta</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
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

          {empresasTab === 'endereco' && (
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
                      placeholder="Número"
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
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Complemento
                    </label>
                    <input
                      type="text"
                      value={companyData.complemento}
                      onChange={(e) => setCompanyData(prev => ({ ...prev, complemento: e.target.value }))}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Apto, Sala, etc."
                    />
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
                      placeholder="País"
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

          {empresasTab === 'contatos' && (
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
                      type="text"
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
                      type="text"
                      value={companyData.telefone_secundario}
                      onChange={(e) => setCompanyData(prev => ({ ...prev, telefone_secundario: e.target.value }))}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="(11) 99999-9999"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      WhatsApp
                    </label>
                    <input
                      type="text"
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

                {/* Responsável Principal */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="font-medium text-green-900 mb-4">Responsável Principal</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Nome
                      </label>
                      <input
                        type="text"
                        value={companyData.responsavel_principal.nome}
                        onChange={(e) => setCompanyData(prev => ({ 
                          ...prev, 
                          responsavel_principal: { ...prev.responsavel_principal, nome: e.target.value }
                        }))}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="Nome do responsável"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Cargo
                      </label>
                      <input
                        type="text"
                        value={companyData.responsavel_principal.cargo}
                        onChange={(e) => setCompanyData(prev => ({ 
                          ...prev, 
                          responsavel_principal: { ...prev.responsavel_principal, cargo: e.target.value }
                        }))}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="Cargo do responsável"
                      />
                    </div>
                  </div>
                </div>

                {/* Contato Financeiro */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="font-medium text-green-900 mb-4">Contato Financeiro</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Nome
                      </label>
                      <input
                        type="text"
                        value={companyData.contato_financeiro.nome}
                        onChange={(e) => setCompanyData(prev => ({ 
                          ...prev, 
                          contato_financeiro: { ...prev.contato_financeiro, nome: e.target.value }
                        }))}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="Nome do contato financeiro"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Email
                      </label>
                      <input
                        type="email"
                        value={companyData.contato_financeiro.email}
                        onChange={(e) => setCompanyData(prev => ({ 
                          ...prev, 
                          contato_financeiro: { ...prev.contato_financeiro, email: e.target.value }
                        }))}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="email@empresa.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Telefone
                      </label>
                      <input
                        type="text"
                        value={companyData.contato_financeiro.telefone}
                        onChange={(e) => setCompanyData(prev => ({ 
                          ...prev, 
                          contato_financeiro: { ...prev.contato_financeiro, telefone: e.target.value }
                        }))}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
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

          {empresasTab === 'dominios' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Globe className="w-5 h-5 text-purple-600" />
                </div>
                <h2 className="text-lg font-semibold text-slate-900">Domínios & URLs</h2>
              </div>

              <form onSubmit={handleSaveCompany} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    URL do Google My Business
                  </label>
                  <input
                    type="url"
                    value={companyData.url_google_business}
                    onChange={(e) => setCompanyData(prev => ({ ...prev, url_google_business: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="https://goo.gl/maps/..."
                  />
                </div>
                
                {/* Redes Sociais */}
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <h4 className="font-medium text-purple-900 mb-4">Redes Sociais</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Facebook
                      </label>
                      <input
                        type="url"
                        value={companyData.redes_sociais.facebook}
                        onChange={(e) => setCompanyData(prev => ({ 
                          ...prev, 
                          redes_sociais: { ...prev.redes_sociais, facebook: e.target.value }
                        }))}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        placeholder="https://facebook.com/..."
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Instagram
                      </label>
                      <input
                        type="url"
                        value={companyData.redes_sociais.instagram}
                        onChange={(e) => setCompanyData(prev => ({ 
                          ...prev, 
                          redes_sociais: { ...prev.redes_sociais, instagram: e.target.value }
                        }))}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        placeholder="https://instagram.com/..."
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        LinkedIn
                      </label>
                      <input
                        type="url"
                        value={companyData.redes_sociais.linkedin}
                        onChange={(e) => setCompanyData(prev => ({ 
                          ...prev, 
                          redes_sociais: { ...prev.redes_sociais, linkedin: e.target.value }
                        }))}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        placeholder="https://linkedin.com/company/..."
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Twitter
                      </label>
                      <input
                        type="url"
                        value={companyData.redes_sociais.twitter}
                        onChange={(e) => setCompanyData(prev => ({ 
                          ...prev, 
                          redes_sociais: { ...prev.redes_sociais, twitter: e.target.value }
                        }))}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        placeholder="https://twitter.com/..."
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        YouTube
                      </label>
                      <input
                        type="url"
                        value={companyData.redes_sociais.youtube}
                        onChange={(e) => setCompanyData(prev => ({ 
                          ...prev, 
                          redes_sociais: { ...prev.redes_sociais, youtube: e.target.value }
                        }))}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        placeholder="https://youtube.com/..."
                      />
                    </div>
                  </div>
                </div>

                {/* Domínios Secundários */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Domínios Secundários
                  </label>
                  <textarea
                    value={Array.isArray(companyData.dominios_secundarios) ? companyData.dominios_secundarios.join('\n') : ''}
                    onChange={(e) => setCompanyData(prev => ({ 
                      ...prev, 
                      dominios_secundarios: e.target.value.split('\n').filter(domain => domain.trim() !== '')
                    }))}
                    rows={3}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-vertical"
                    placeholder="Digite os domínios secundários, um por linha&#10;exemplo.com&#10;outro-dominio.com.br"
                  />
                  <p className="text-xs text-slate-500 mt-1">Digite um domínio por linha</p>
                </div>

                {/* URLs Landing Pages */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    URLs Landing Pages
                  </label>
                  <textarea
                    value={Array.isArray(companyData.urls_landing_pages) ? companyData.urls_landing_pages.join('\n') : ''}
                    onChange={(e) => setCompanyData(prev => ({ 
                      ...prev, 
                      urls_landing_pages: e.target.value.split('\n').filter(url => url.trim() !== '')
                    }))}
                    rows={3}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-vertical"
                    placeholder="Digite as URLs das landing pages, uma por linha&#10;https://landing1.com&#10;https://landing2.com"
                  />
                  <p className="text-xs text-slate-500 mt-1">Digite uma URL por linha</p>
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
      )}
    </div>
  );
};
