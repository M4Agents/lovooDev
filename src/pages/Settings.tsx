import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { Webhook, Key, Save, Clock, Building, Settings as SettingsIcon, MapPin, Phone, Globe } from 'lucide-react';

export const Settings: React.FC = () => {
  const { company, refreshCompany } = useAuth();
  const [webhookUrl, setWebhookUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  
  // Estados para abas e dados da empresa
  const [activeTab, setActiveTab] = useState<'settings' | 'dados-principais' | 'endereco' | 'contatos' | 'dominios'>('settings');
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
  
  // Verificar se é empresa filha (não é super admin)
  const isChildCompany = company && !company.is_super_admin;

  useEffect(() => {
    console.log('Settings: useEffect triggered, company:', company);
    console.log('Settings: company.api_key:', company?.api_key);
    
    if (company) {
      setWebhookUrl(company.webhook_url || '');
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
      loadWebhookLogs();
    } 
    // Se não tem company mas está impersonating, carregar logs pelo localStorage
    else if (localStorage.getItem('lovoo_crm_impersonating') === 'true') {
      const impersonatedCompanyId = localStorage.getItem('lovoo_crm_impersonated_company_id');
      console.log('Settings: No company but impersonating, using localStorage ID:', impersonatedCompanyId);
      
      if (impersonatedCompanyId) {
        loadWebhookLogsById(impersonatedCompanyId);
      }
    }
    // Se não tem company e não está impersonating, parar loading
    else {
      console.log('Settings: No company and not impersonating, stopping loading');
      setLoadingLogs(false);
    }
  }, [company]);

  const loadWebhookLogs = async () => {
    if (!company) return;

    try {
      const data = await api.getWebhookLogs(company.id);
      setLogs(data);
    } catch (error) {
      console.error('Error loading webhook logs:', error);
    } finally {
      setLoadingLogs(false);
    }
  };

  const loadWebhookLogsById = async (companyId: string) => {
    console.log('Settings: loadWebhookLogsById called for:', companyId);

    try {
      const data = await api.getWebhookLogs(companyId);
      console.log('Settings: Webhook logs loaded:', data);
      setLogs(data);
    } catch (error) {
      console.error('Settings: Error loading webhook logs by ID:', error);
    } finally {
      console.log('Settings: Setting loadingLogs to false');
      setLoadingLogs(false);
    }
  };

  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;

    setSaving(true);
    try {
      await api.updateCompanyWebhook(company.id, webhookUrl);
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
      
      await api.updateCompany(company.id, updateData);
      await refreshCompany();
      alert('Dados da empresa atualizados com sucesso!');
    } catch (error) {
      console.error('Error saving company data:', error);
      alert('Erro ao salvar dados da empresa');
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
        
        {/* Abas - Apenas para empresas filhas */}
        {isChildCompany && (
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
        )}
      </div>

      {/* Conteúdo das Abas */}
      {(!isChildCompany || activeTab === 'settings') && (
        <>
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

            {/* Webhook Personalizado */}
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

          {/* Webhook de Conversão */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Webhook className="w-5 h-5 text-purple-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Webhook de Conversão</h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    URL do Webhook para Formulários
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={company?.api_key ? 
                        `https://app.lovoocrm.com/api/webhook-conversion?api_key=${company.api_key}` : 
                        'Carregando API key...'
                      }
                      readOnly
                      className="flex-1 px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-mono text-sm"
                    />
                    <button
                      onClick={() => copyToClipboard(`https://app.lovoocrm.com/api/webhook-conversion?api_key=${company?.api_key || ''}`)}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
                    >
                      Copiar
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    Use esta URL nos seus formulários para capturar conversões automaticamente
                  </p>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-medium text-blue-900 mb-2">Como usar no formulário:</h4>
                  <div className="space-y-2 text-sm text-blue-800">
                    <p><strong>Método:</strong> POST</p>
                    <p><strong>Content-Type:</strong> application/json</p>
                    <p><strong>Dados obrigatórios:</strong></p>
                    <ul className="list-disc list-inside ml-4 space-y-1">
                      <li><code>tracking_code</code>: Código da landing page</li>
                      <li><code>form_data</code>: Dados do formulário (nome, email, telefone, etc.)</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="font-medium text-green-900 mb-2">Script automático para formulários:</h4>
                  <div className="bg-white border rounded p-3 font-mono text-xs overflow-x-auto">
                    <div className="text-slate-600">{`<!-- Adicionar no final da página -->`}</div>
                    <div>{`<script src="https://app.lovoocrm.com/conversion-tracker.js"></script>`}</div>
                    <div>{`<script>`}</div>
                    <div className="ml-2">{`ConversionTracker.init('SEU_TRACKING_CODE');`}</div>
                    <div className="ml-2">{`ConversionTracker.autoTrack(); // Captura todos os formulários`}</div>
                    <div>{`</script>`}</div>
                  </div>
                  <button
                    onClick={() => copyToClipboard(`<script src="https://app.lovoocrm.com/conversion-tracker.js"></script>
<script>
  ConversionTracker.init('SEU_TRACKING_CODE');
  ConversionTracker.autoTrack();
</script>`)}
                    className="mt-2 px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded font-medium transition-colors"
                  >
                    Copiar Script
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Logs de Webhook */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Clock className="w-5 h-5 text-purple-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Logs de Webhook</h2>
            </div>

            {loadingLogs ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              </div>
            ) : logs.length === 0 ? (
              <p className="text-slate-600 text-center py-8">Nenhum webhook enviado ainda</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Data/Hora</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">URL</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Status</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Resposta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-3 px-4 text-sm text-slate-900">
                          {new Date(log.sent_at).toLocaleString('pt-BR')}
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600 max-w-xs truncate">
                          {log.webhook_url}
                        </td>
                        <td className="py-3 px-4 text-sm">
                          {log.response_status ? (
                            <span
                              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                log.response_status >= 200 && log.response_status < 300
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {log.response_status}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              Erro
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600 max-w-md truncate">
                          {log.error_message || log.response_body || 'Sucesso'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl shadow-sm p-6 text-white">
            <h2 className="text-lg font-semibold mb-4">Exemplo de Payload do Webhook</h2>
            <pre className="bg-slate-950 rounded-lg p-4 text-sm overflow-x-auto text-slate-100">
{`{
  "conversion_data": {
    "name": "João Silva",
    "email": "joao@email.com",
    "phone": "11999999999"
  },
  "behavior_analytics": {
    "session_duration": 245,
    "scroll_depth": "85%",
    "sections_viewed": ["hero", "about", "services"],
    "total_clicks": 7,
    "cta_clicks": 3,
    "engagement_score": 8.5,
    "device_type": "desktop",
    "time_to_convert": 180
  }
}`}
            </pre>
          </div>
        </>
      )}

      {/* Aba Dados Principais - Apenas para empresas filhas */}
      {isChildCompany && activeTab === 'dados-principais' && (
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
                  <span className="ml-2 text-orange-700">Empresa Filha</span>
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

      {/* Aba Endereço - Apenas para empresas filhas */}
      {isChildCompany && activeTab === 'endereco' && (
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
    </div>
  );
};
