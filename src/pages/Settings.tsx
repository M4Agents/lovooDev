import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { Webhook, Save, Clock, Building, MapPin, Phone, Globe, Settings as SettingsIcon, Eye, EyeOff, Zap } from 'lucide-react';

export const Settings: React.FC = () => {
  const { company, refreshCompany } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  
  // Estados para teste do webhook de leads (EXISTENTE)
  const [testingWebhookLead, setTestingWebhookLead] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<{success: boolean, lead_id?: string, error?: string} | null>(null);
  
  // Estado para mostrar/ocultar API Key
  const [showApiKey, setShowApiKey] = useState(false);
  
  // Estados para Webhook Avançado - MÓDULO ISOLADO
  const [webhookConfig, setWebhookConfig] = useState({
    name: '',
    webhook_url: '',
    trigger_event: 'lead_converted',
    timeout_seconds: 10,
    retry_attempts: 3,
    headers: '',
    payload_fields: {
      lead: ['name', 'email', 'phone', 'status', 'origin'],
      empresa: [],
      analytics: []
    }
  });
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookConfigs, setWebhookConfigs] = useState<any[]>([]);
  const [webhookLogs, setWebhookLogs] = useState<any[]>([]);
  
  // Estados para edição e exclusão - FUNCIONALIDADE BOTÕES
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const [deletingConfigId, setDeletingConfigId] = useState<string | null>(null);
  
  // Estados para abas principais - NOVA ESTRUTURA
  const [activeTab, setActiveTab] = useState<'integracoes' | 'empresas'>('integracoes');
  const [integracoesTab, setIntegracoesTab] = useState<'webhook-simples' | 'webhook-avancado'>('webhook-simples');
  const [empresasTab, setEmpresasTab] = useState<'dados-principais' | 'endereco' | 'contatos' | 'dominios'>('dados-principais');
  
  // Estado para modal de documentação
  const [showDocumentationModal, setShowDocumentationModal] = useState(false);
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
      loadWebhookLogs();
      loadWebhookConfigs(); // Carregar configurações de webhook avançado
      
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


  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;

    setSavingCompany(true);
    try {
      // Preparar dados para envio (remover campos que não devem ser alterados)
      const { domain, plan, status, ...rawData } = companyData;
      
      // Limpar campos vazios e tratar datas
      const updateData = Object.entries(rawData).reduce((acc, [key, value]) => {
        // Tratar campos de data - converter string vazia para null
        if (key === 'data_fundacao') {
          acc[key] = (typeof value === 'string' && value.trim() !== '') ? value : null;
        }
        // Tratar outros campos específicos - converter string vazia para null
        else if (typeof value === 'string' && value.trim() === '' && 
                 ['inscricao_estadual', 'inscricao_municipal', 'tipo_empresa', 'porte_empresa'].includes(key)) {
          acc[key] = null;
        }
        // Manter valor original para outros campos
        else {
          acc[key] = value;
        }
        return acc;
      }, {} as any);
      
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
      } else if (typeof error === 'object' && error !== null && 'message' in error) {
        errorMessage += ': ' + (error as any).message;
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

  const testWebhookLead = async () => {
    if (!company?.api_key) return;
    
    setTestingWebhookLead(true);
    setWebhookTestResult(null);
    
    try {
      const testData = {
        api_key: company.api_key,
        nome: 'Lead de Teste',
        email: 'teste@lovoocrm.com',
        telefone: '(11) 99999-9999',
        empresa: 'Empresa de Teste Ltda',
        interesse: 'Teste do webhook ultra-simples',
        // Campos personalizados de teste
        orcamento: 'R$ 10.000',
        prazo_projeto: '2 meses',
        fonte_indicacao: 'Teste Automático'
      };
      
      const response = await fetch('https://app.lovoocrm.com/api/webhook-lead', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testData)
      });
      
      const result = await response.json();
      
      if (result.success) {
        setWebhookTestResult({
          success: true,
          lead_id: result.lead_id
        });
      } else {
        setWebhookTestResult({
          success: false,
          error: result.error || 'Erro desconhecido'
        });
      }
    } catch (error) {
      setWebhookTestResult({
        success: false,
        error: error instanceof Error ? error.message : 'Erro de conexão'
      });
    } finally {
      setTestingWebhookLead(false);
    }
  };

  // ===== FUNÇÕES WEBHOOK AVANÇADO - MÓDULO ISOLADO =====
  
  const handleWebhookConfigChange = (field: string, value: any) => {
    setWebhookConfig(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleFieldToggle = (category: 'lead' | 'empresa' | 'analytics', field: string) => {
    setWebhookConfig(prev => ({
      ...prev,
      payload_fields: {
        ...prev.payload_fields,
        [category]: prev.payload_fields[category].includes(field)
          ? prev.payload_fields[category].filter(f => f !== field)
          : [...prev.payload_fields[category], field]
      }
    }));
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault(); // Previne submit padrão
    
    if (!company?.id) {
      alert('Erro: Empresa não encontrada');
      return;
    }

    if (!webhookConfig.name || !webhookConfig.webhook_url) {
      alert('Por favor, preencha Nome e URL do webhook');
      return;
    }

    setSavingWebhook(true);
    
    try {
      let headers = {};
      if (webhookConfig.headers.trim()) {
        try {
          headers = JSON.parse(webhookConfig.headers);
        } catch (error) {
          alert('Headers inválidos. Use formato JSON válido.');
          setSavingWebhook(false);
          return;
        }
      }

      const configData = {
        name: webhookConfig.name,
        webhook_url: webhookConfig.webhook_url,
        is_active: true,
        trigger_events: [webhookConfig.trigger_event],
        conditions: {},
        payload_fields: webhookConfig.payload_fields,
        timeout_seconds: webhookConfig.timeout_seconds,
        retry_attempts: webhookConfig.retry_attempts,
        headers
      };

      let result;
      
      if (editingConfigId) {
        // Modo edição - atualizar configuração existente
        result = await api.updateWebhookTriggerConfig(editingConfigId, company.id, configData);
        alert('Configuração atualizada com sucesso!');
        setEditingConfigId(null); // Sair do modo edição
      } else {
        // Modo criação - criar nova configuração
        result = await api.createWebhookTriggerConfig(company.id, configData);
        alert('Configuração criada com sucesso!');
      }
      
      // Reset form
      setWebhookConfig({
        name: '',
        webhook_url: '',
        trigger_event: 'lead_converted',
        timeout_seconds: 10,
        retry_attempts: 3,
        headers: '',
        payload_fields: {
          lead: ['name', 'email', 'phone', 'status', 'origin'],
          empresa: [],
          analytics: []
        }
      });
      
      // Reload configs
      loadWebhookConfigs();
      
    } catch (error) {
      console.error('Error creating webhook config:', error);
      alert('Erro ao criar configuração: ' + (error instanceof Error ? error.message : 'Erro desconhecido'));
    } finally {
      setSavingWebhook(false);
    }
  };

  // FUNÇÃO EDITAR CONFIGURAÇÃO - NOVA FUNCIONALIDADE
  const handleEditWebhookConfig = (config: any) => {
    console.log('Editando configuração:', config);
    
    // Preencher formulário com dados da configuração selecionada
    setWebhookConfig({
      name: config.name || '',
      webhook_url: config.webhook_url || '',
      trigger_event: config.trigger_events?.[0] || 'lead_converted',
      timeout_seconds: config.timeout_seconds || 30,
      retry_attempts: config.retry_attempts || 3,
      headers: config.headers ? JSON.stringify(config.headers, null, 2) : '',
      payload_fields: config.payload_fields || {
        lead: ['name', 'email', 'phone', 'status', 'origin'],
        empresa: [],
        analytics: []
      }
    });
    
    // Definir modo edição
    setEditingConfigId(config.id);
    
    // Scroll para o formulário
    const formElement = document.querySelector('form');
    if (formElement) {
      formElement.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // FUNÇÃO CANCELAR EDIÇÃO - NOVA FUNCIONALIDADE
  const handleCancelEdit = () => {
    console.log('Cancelando edição');
    
    // Reset form para estado inicial
    setWebhookConfig({
      name: '',
      webhook_url: '',
      trigger_event: 'lead_converted',
      timeout_seconds: 30,
      retry_attempts: 3,
      headers: '',
      payload_fields: {
        lead: ['name', 'email', 'phone', 'status', 'origin'],
        empresa: [],
        analytics: []
      }
    });
    
    // Sair do modo edição
    setEditingConfigId(null);
  };

  // FUNÇÃO EXCLUIR CONFIGURAÇÃO - NOVA FUNCIONALIDADE
  const handleDeleteWebhookConfig = async (configId: string, configName: string) => {
    console.log('Excluindo configuração:', { configId, configName });
    
    // Confirmação do usuário
    const confirmed = window.confirm(
      `Tem certeza que deseja excluir a configuração "${configName}"?\n\nEsta ação não pode ser desfeita.`
    );
    
    if (!confirmed) {
      console.log('Exclusão cancelada pelo usuário');
      return;
    }
    
    if (!company?.id) {
      alert('Erro: Empresa não encontrada');
      return;
    }
    
    setDeletingConfigId(configId);
    
    try {
      await api.deleteWebhookTriggerConfig(configId, company.id);
      
      alert('Configuração excluída com sucesso!');
      
      // Se estava editando esta configuração, cancelar edição
      if (editingConfigId === configId) {
        handleCancelEdit();
      }
      
      // Recarregar lista de configurações
      loadWebhookConfigs();
      
    } catch (error) {
      console.error('Error deleting webhook config:', error);
      alert('Erro ao excluir configuração: ' + (error instanceof Error ? error.message : 'Erro desconhecido'));
    } finally {
      setDeletingConfigId(null);
    }
  };

  const handleTestWebhook = async () => {
    if (!webhookConfig.webhook_url) {
      alert('Por favor, informe a URL do webhook');
      return;
    }

    setTestingWebhook(true);
    
    try {
      let headers = {};
      if (webhookConfig.headers.trim()) {
        try {
          headers = JSON.parse(webhookConfig.headers);
        } catch (error) {
          alert('Headers inválidos. Use formato JSON válido.');
          setTestingWebhook(false);
          return;
        }
      }

      const testPayload = {
        event: webhookConfig.trigger_event,
        timestamp: new Date().toISOString(),
        data: {
          lead: {
            name: 'Lead de Teste',
            email: 'teste@exemplo.com',
            phone: '(11) 99999-9999',
            status: 'convertido',
            origin: 'teste'
          },
          empresa: {
            name: company?.name || 'Empresa Teste',
            domain: company?.domain || 'teste.com'
          },
          analytics: {
            visitor_id: 'test_visitor_123',
            session_duration: 180,
            page_views: 5
          }
        }
      };

      const result = await api.testWebhookTrigger(webhookConfig.webhook_url, testPayload, headers);
      
      if (result.success) {
        alert(`✅ Teste realizado com sucesso!\nStatus: ${result.status}\nResposta: ${JSON.stringify(result.response, null, 2)}`);
      } else {
        alert(`❌ Erro no teste:\nStatus: ${result.status || 'N/A'}\nErro: ${result.error || result.statusText || 'Erro desconhecido'}`);
      }
      
    } catch (error) {
      console.error('Error testing webhook:', error);
      alert('Erro ao testar webhook: ' + (error instanceof Error ? error.message : 'Erro desconhecido'));
    } finally {
      setTestingWebhook(false);
    }
  };

  const loadWebhookConfigs = async () => {
    if (!company?.id) return;
    
    try {
      const configs = await api.getWebhookTriggerConfigs(company.id);
      setWebhookConfigs(configs);
    } catch (error) {
      console.error('Error loading webhook configs:', error);
    }
  };

  const loadWebhookTriggerLogs = async () => {
    if (!company?.id) return;
    
    try {
      const logs = await api.getWebhookTriggerLogs(company.id);
      setWebhookLogs(logs);
    } catch (error) {
      console.error('Error loading webhook logs:', error);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Configurações</h1>
        <p className="text-slate-600 mt-1">Gerencie as configurações da sua conta</p>
        
        {/* Abas principais - NOVA ESTRUTURA */}
        <div className="flex space-x-1 mt-6 bg-slate-100 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('integracoes')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === 'integracoes'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <SettingsIcon className="w-4 h-4" />
            Integrações
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
            Dados da Empresa
          </button>
        </div>
      </div>

      {/* Aba Integrações - NOVA ESTRUTURA */}
      {activeTab === 'integracoes' && (
        <div className="space-y-6">
          
          {/* Sub-navegação das Integrações */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-blue-100 rounded-lg">
                <SettingsIcon className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Integrações</h2>
                <p className="text-sm text-slate-600">Configure suas integrações e webhooks</p>
              </div>
            </div>
            
            {/* Sub-abas das Integrações */}
            <div className="flex space-x-1 bg-slate-50 p-1 rounded-lg">
              <button
                onClick={() => setIntegracoesTab('webhook-simples')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
                  integracoesTab === 'webhook-simples'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Webhook className="w-4 h-4" />
                Webhook Ultra-Simples
              </button>
              <button
                onClick={() => {
                  setIntegracoesTab('webhook-avancado');
                  if (company?.id) loadWebhookConfigs(); // Carregar configurações ao trocar de aba
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
                  integracoesTab === 'webhook-avancado'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Zap className="w-4 h-4" />
                Webhook Avançado
              </button>
            </div>
          </div>
          
          {/* Conteúdo das Sub-abas */}
          
          {/* Sub-aba: Webhook Ultra-Simples */}
          {integracoesTab === 'webhook-simples' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 lg:col-span-2">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <Webhook className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Webhook Ultra-Simples para Leads</h2>
                <p className="text-sm text-slate-600">Crie leads automaticamente a partir de qualquer formulário</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* URL do Webhook */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    🚀 URL Ultra-Simples para Leads
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value="https://app.lovoocrm.com/api/webhook-lead"
                      readOnly
                      className="flex-1 px-4 py-2 bg-emerald-50 border border-emerald-300 rounded-lg text-slate-900 font-mono text-sm"
                    />
                    <button
                      onClick={() => copyToClipboard('https://app.lovoocrm.com/api/webhook-lead')}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
                    >
                      Copiar
                    </button>
                  </div>
                  <p className="text-xs text-emerald-600 mt-2 font-medium">
                    ✨ Envie qualquer JSON e criamos o lead automaticamente!
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    🔑 Sua API Key (incluir no JSON)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={company?.api_key || 'Carregando...'}
                      readOnly
                      className="flex-1 px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-mono text-sm"
                    />
                    <button
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="px-3 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg transition-colors"
                      title={showApiKey ? "Ocultar API Key" : "Mostrar API Key"}
                    >
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => copyToClipboard(company?.api_key || '')}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
                    >
                      Copiar
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    Use esta chave no campo "api_key" do seu JSON para identificar sua empresa
                  </p>
                </div>

                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                  <h4 className="font-medium text-emerald-900 mb-2">📋 Como usar (3 passos):</h4>
                  <div className="space-y-2 text-sm text-emerald-800">
                    <p><strong>1.</strong> Configure seu formulário para enviar POST para a URL acima</p>
                    <p><strong>2.</strong> Inclua sua API Key + dados do formulário em formato JSON</p>
                    <p><strong>3.</strong> Pronto! O lead será criado automaticamente</p>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-medium text-blue-900 mb-2">🔧 Sistema Híbrido V5:</h4>
                  <div className="space-y-2 text-sm text-blue-800">
                    <p><strong>Método:</strong> POST</p>
                    <p><strong>Content-Type:</strong> application/json</p>
                    <p><strong>Campos padrão (por nome):</strong></p>
                    <ul className="list-disc list-inside ml-4 space-y-1 text-xs">
                      <li>Nome: name, nome, full_name, cliente</li>
                      <li>Email: email, e-mail, mail</li>
                      <li>Telefone: phone, telefone, celular, whatsapp</li>
                      <li>Origem: origin, origem, source, fonte</li>
                    </ul>
                    <p><strong>Campos personalizados (por ID):</strong></p>
                    <ul className="list-disc list-inside ml-4 space-y-1 text-xs">
                      <li>Use o ID numérico: "1": "valor", "2": "valor"</li>
                      <li>Crie campos em: Configurações → Campos Personalizados</li>
                      <li>Copie o ID mostrado na interface</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Exemplo e Teste */}
              <div className="space-y-4">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-2">📝 Exemplo de Uso:</h4>
                  <div className="bg-white border rounded p-3 font-mono text-xs overflow-x-auto">
                    <div className="text-gray-600">{`// Sistema Híbrido V5 - Exemplo de JSON:`}</div>
                    <div className="text-green-600 mt-2">{`{`}</div>
                    <div className="ml-2 text-red-600">{`"api_key": "(sua apikey aqui...)",`}</div>
                    <div className="ml-2 text-blue-600">{`"nome": "João Silva",`}</div>
                    <div className="ml-2 text-blue-600">{`"email": "joao@email.com",`}</div>
                    <div className="ml-2 text-blue-600">{`"telefone": "(11) 99999-9999",`}</div>
                    <div className="ml-2 text-blue-600">{`"origem": "landing_page",`}</div>
                    <div className="ml-2 text-purple-600">{`"1": "R$ 50.000",        // Campo ID: 1`}</div>
                    <div className="ml-2 text-purple-600">{`"2": "3 meses",          // Campo ID: 2`}</div>
                    <div className="ml-2 text-purple-600">{`"3": "Google Ads"        // Campo ID: 3`}</div>
                    <div className="text-green-600">{`}`}</div>
                  </div>
                  <div className="mt-3 p-3 bg-purple-50 border border-purple-200 rounded">
                    <p className="text-xs text-purple-800">
                      <strong>🎯 Sistema Híbrido:</strong> Campos <span className="text-blue-600 font-mono">azuis</span> são padrão (por nome), campos <span className="text-purple-600 font-mono">roxos</span> são personalizados (por ID numérico)!
                    </p>
                  </div>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <h4 className="font-medium text-yellow-900 mb-2">⚡ Teste Rápido:</h4>
                  <p className="text-sm text-yellow-800 mb-3">
                    Clique no botão abaixo para testar se o webhook está funcionando:
                  </p>
                  <button
                    onClick={() => testWebhookLead()}
                    disabled={!company?.api_key || testingWebhook}
                    className="w-full flex items-center justify-center gap-2 bg-yellow-600 hover:bg-yellow-700 text-white py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
                  >
                    {testingWebhook ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Testando...
                      </>
                    ) : (
                      <>
                        <Webhook className="w-4 h-4" />
                        Testar Webhook
                      </>
                    )}
                  </button>
                  {webhookTestResult && (
                    <div className={`mt-3 p-3 rounded-lg text-sm ${
                      webhookTestResult.success 
                        ? 'bg-green-100 text-green-800 border border-green-200' 
                        : 'bg-red-100 text-red-800 border border-red-200'
                    }`}>
                      {webhookTestResult.success ? (
                        <>
                          ✅ <strong>Sucesso!</strong> Lead de teste criado: {webhookTestResult.lead_id}
                        </>
                      ) : (
                        <>
                          ❌ <strong>Erro:</strong> {webhookTestResult.error}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Documentação Completa da API */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <SettingsIcon className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Documentação Completa da API</h2>
                <p className="text-sm text-slate-600">Guia completo para desenvolvedores</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Campos Personalizados */}
              <div className="space-y-4">
                <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-4">
                  <h4 className="font-semibold text-purple-900 mb-3">🎯 Campos Personalizados</h4>
                  <div className="space-y-3 text-sm text-purple-800">
                    <div>
                      <p className="font-medium">1. Criar Campo:</p>
                      <p className="text-xs ml-4">• Acesse: Configurações → Campos Personalizados</p>
                      <p className="text-xs ml-4">• Clique em "Novo Campo"</p>
                      <p className="text-xs ml-4">• Campo receberá ID automático (1, 2, 3...)</p>
                    </div>
                    <div>
                      <p className="font-medium">2. Usar no Payload:</p>
                      <div className="bg-white rounded p-2 mt-1 font-mono text-xs">
                        <span className="text-gray-600">{"{"}</span><br/>
                        <span className="ml-2 text-purple-600">"1": "valor_campo_1",</span><br/>
                        <span className="ml-2 text-purple-600">"2": "valor_campo_2"</span><br/>
                        <span className="text-gray-600">{"}"}</span>
                      </div>
                    </div>
                    <div>
                      <p className="font-medium">3. Copiar ID:</p>
                      <p className="text-xs ml-4">• Botão verde "Copiar" na interface</p>
                      <p className="text-xs ml-4">• ID é único e nunca muda</p>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-semibold text-blue-900 mb-3">📋 Campos Padrão</h4>
                  <div className="space-y-2 text-sm text-blue-800">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><strong>Nome:</strong> nome, name</div>
                      <div><strong>Email:</strong> email, e-mail</div>
                      <div><strong>Telefone:</strong> telefone, phone</div>
                      <div><strong>Origem:</strong> origem, origin</div>
                    </div>
                    <p className="text-xs mt-2">
                      <strong>Uso:</strong> Sempre por nome, sem ID necessário
                    </p>
                  </div>
                </div>
              </div>

              {/* Exemplos Práticos */}
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="font-semibold text-green-900 mb-3">✅ Exemplo Completo</h4>
                  <div className="bg-white rounded p-3 font-mono text-xs overflow-x-auto">
                    <div className="text-gray-600">// Payload Sistema Híbrido V5</div>
                    <div className="text-green-600 mt-1">{"{"}</div>
                    <div className="ml-2 text-red-600">"api_key": "sua-api-key",</div>
                    <div className="ml-2 text-blue-600">"nome": "Maria Silva",</div>
                    <div className="ml-2 text-blue-600">"email": "maria@empresa.com",</div>
                    <div className="ml-2 text-blue-600">"telefone": "11999999999",</div>
                    <div className="ml-2 text-blue-600">"origem": "landing_page",</div>
                    <div className="ml-2 text-purple-600">"1": "R$ 100.000",</div>
                    <div className="ml-2 text-purple-600">"2": "6 meses",</div>
                    <div className="ml-2 text-purple-600">"3": "E-commerce"</div>
                    <div className="text-green-600">{"}"}</div>
                  </div>
                </div>

                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <h4 className="font-semibold text-orange-900 mb-3">⚠️ Importante</h4>
                  <div className="space-y-2 text-sm text-orange-800">
                    <p><strong>• Precisão:</strong> IDs garantem mapeamento exato</p>
                    <p><strong>• Escalabilidade:</strong> Suporta milhares de campos</p>
                    <p><strong>• Compatibilidade:</strong> Funciona com qualquer tecnologia</p>
                    <p><strong>• Performance:</strong> Processamento otimizado</p>
                  </div>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">🔧 Configuração Técnica</h4>
                  <div className="space-y-1 text-sm text-gray-800">
                    <p><strong>Endpoint:</strong> POST /api/webhook-lead</p>
                    <p><strong>Content-Type:</strong> application/json</p>
                    <p><strong>Timeout:</strong> 30 segundos</p>
                    <p><strong>Rate Limit:</strong> 1000 req/min</p>
                    <p><strong>Logs:</strong> Disponíveis abaixo</p>
                  </div>
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
                    {logs.map((log: any) => (
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
          
          {/* Sub-aba: Webhook Avançado */}
          {integracoesTab === 'webhook-avancado' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <Zap className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Webhook Avançado - Disparos Automáticos</h2>
                  <p className="text-sm text-slate-600">Configure webhooks que são disparados automaticamente quando eventos específicos acontecem</p>
                </div>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <h3 className="font-medium text-blue-900 mb-2">🚀 Sistema Completo</h3>
                <p className="text-blue-800 text-sm">
                  Configure webhooks que são disparados automaticamente quando eventos específicos acontecem no sistema (ex: lead convertido).
                  Diferente do webhook simples, aqui o <strong>sistema envia dados para você</strong> automaticamente.
                </p>
              </div>
              
              {/* CONTEÚDO COMPLETO DO WEBHOOK AVANÇADO */}
              <div className="space-y-6">
                
                {/* Formulário de Configuração */}
                <div className="bg-gradient-to-r from-orange-50 to-yellow-50 border border-orange-200 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-orange-900">
                      {editingConfigId ? '✏️ Editar Configuração de Webhook' : '➕ Nova Configuração de Webhook'}
                    </h3>
                    {editingConfigId && (
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="px-3 py-1 text-sm bg-slate-200 text-slate-700 rounded hover:bg-slate-300 transition-colors"
                      >
                        Cancelar Edição
                      </button>
                    )}
                  </div>
                  
                  <form onSubmit={handleCreateWebhook} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Nome da Configuração *
                        </label>
                        <input
                          type="text"
                          value={webhookConfig.name}
                          onChange={(e) => handleWebhookConfigChange('name', e.target.value)}
                          placeholder="Ex: Webhook Lead Convertido"
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                          required
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          URL do Webhook *
                        </label>
                        <input
                          type="url"
                          value={webhookConfig.webhook_url}
                          onChange={(e) => handleWebhookConfigChange('webhook_url', e.target.value)}
                          placeholder="https://seu-sistema.com/webhook"
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Evento de Disparo
                        </label>
                        <select
                          value={webhookConfig.trigger_event}
                          onChange={(e) => handleWebhookConfigChange('trigger_event', e.target.value)}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                        >
                          <option value="lead_created">Lead Criado</option>
                          <option value="lead_converted">Lead Convertido</option>
                          <option value="lead_updated">Lead Atualizado</option>
                        </select>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Timeout (segundos)
                        </label>
                        <input
                          type="number"
                          value={webhookConfig.timeout_seconds}
                          onChange={(e) => handleWebhookConfigChange('timeout_seconds', parseInt(e.target.value))}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                          min="1"
                          max="60"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Tentativas
                        </label>
                        <input
                          type="number"
                          value={webhookConfig.retry_attempts}
                          onChange={(e) => handleWebhookConfigChange('retry_attempts', parseInt(e.target.value))}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                          min="1"
                          max="10"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Campos do Payload
                      </label>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        {['name', 'email', 'phone', 'status', 'origin'].map((field) => (
                          <label key={field} className="flex items-center">
                            <input
                              type="checkbox"
                              checked={webhookConfig.payload_fields.lead.includes(field)}
                              onChange={() => handleFieldToggle('lead', field)}
                              className="mr-2"
                            />
                            {field}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Headers Personalizados (JSON)
                      </label>
                      <textarea
                        value={webhookConfig.headers}
                        onChange={(e) => handleWebhookConfigChange('headers', e.target.value)}
                        placeholder='{"Authorization": "Bearer token", "Content-Type": "application/json"}'
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                        rows={3}
                      />
                      <p className="text-xs text-slate-500 mt-1">Formato JSON. Exemplo: {"{"}"Authorization": "Bearer token"{"}"}</p>
                    </div>

                    <div className="flex gap-3">
                      <button
                        type="submit"
                        disabled={savingWebhook}
                        className="flex-1 bg-orange-600 hover:bg-orange-700 text-white py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <Save className="w-4 h-4" />
                        {savingWebhook ? 'Salvando...' : (editingConfigId ? 'Atualizar Configuração' : 'Criar Configuração')}
                      </button>
                      <button
                        type="button"
                        onClick={handleTestWebhook}
                        disabled={testingWebhook}
                        className="px-6 py-3 border border-orange-300 text-orange-700 rounded-lg font-medium hover:bg-orange-50 transition-colors disabled:opacity-50"
                      >
                        {testingWebhook ? 'Testando...' : 'Testar Webhook'}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Lista de Configurações */}
                <div className="bg-white border border-slate-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">⚙️ Configurações Existentes</h3>
                  
                  {webhookConfigs.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                      <p>Nenhuma configuração criada ainda</p>
                      <p className="text-sm">Crie sua primeira configuração acima</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {webhookConfigs.map((config: any) => (
                        <div key={config.id} className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <h4 className="font-medium text-slate-900">{config.name}</h4>
                              <p className="text-sm text-slate-600 mt-1">{config.webhook_url}</p>
                              <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                                <span>Evento: {config.trigger_events?.[0] || 'N/A'}</span>
                                <span>Status: {config.is_active ? '✅ Ativo' : '❌ Inativo'}</span>
                                <span>Timeout: {config.timeout_seconds}s</span>
                                <span>Retry: {config.retry_attempts}x</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => handleEditWebhookConfig(config)}
                                className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                                title="Editar configuração"
                              >
                                Editar
                              </button>
                              <button 
                                onClick={() => handleDeleteWebhookConfig(config.id, config.name)}
                                disabled={deletingConfigId === config.id}
                                className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors disabled:opacity-50"
                                title="Excluir configuração"
                              >
                                {deletingConfigId === config.id ? 'Excluindo...' : 'Excluir'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Logs de Disparos */}
                <div className="bg-white border border-slate-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">📊 Logs de Disparos</h3>
                  
                  <div className="text-center py-8 text-slate-500">
                    <Clock className="w-12 h-12 mx-auto mb-2 text-slate-400" />
                    <p>Logs de disparos serão implementados na próxima etapa</p>
                    <p className="text-sm">Backend funcionando - interface em desenvolvimento</p>
                  </div>
                </div>

                {/* Botão para Documentação da API */}
                <div className="bg-white border border-slate-200 rounded-lg p-6">
                  <div className="text-center">
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">📖 Documentação da API</h3>
                    <p className="text-sm text-slate-600 mb-4">
                      Acesse o guia completo para desenvolvedores com exemplos de código e configurações técnicas
                    </p>
                    <button
                      onClick={() => setShowDocumentationModal(true)}
                      className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 mx-auto"
                    >
                      <SettingsIcon className="w-4 h-4" />
                      Ver Documentação Completa
                    </button>
                  </div>
                </div>

              </div>
            </div>
          )}

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
                      Nome da Conta *
                    </label>
                    <input
                      type="text"
                      value={companyData.name}
                      onChange={(e) => setCompanyData(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="Nome da sua conta"
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

      {/* Modal de Documentação da API */}
      {showDocumentationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-100 rounded-lg">
                  <SettingsIcon className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Documentação Completa da API</h2>
                  <p className="text-sm text-slate-600">Guia completo para desenvolvedores</p>
                </div>
              </div>
              <button
                onClick={() => setShowDocumentationModal(false)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <span className="sr-only">Fechar</span>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
              <div className="text-center py-8 text-slate-500">
                <p className="text-lg mb-2">📖 Documentação em Desenvolvimento</p>
                <p className="text-sm">
                  A documentação completa da API será implementada na próxima versão.
                </p>
                <p className="text-sm mt-2">
                  Por enquanto, utilize as configurações disponíveis no formulário acima.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
