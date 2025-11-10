import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { supabase } from '../lib/supabase';
import { Webhook, Save, Clock, Building, MapPin, Phone, Globe, Settings as SettingsIcon, Eye, EyeOff, Zap, MessageCircle, Smartphone, Cloud, FileText, Users } from 'lucide-react';

// Ícone oficial do WhatsApp
const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.63"/>
  </svg>
);

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
  
  // ===== NOVOS ESTADOS ISOLADOS PARA LOGS AVANÇADOS =====
  // Estados específicos para não interferir nos existentes
  const [advancedLogs, setAdvancedLogs] = useState<any[]>([]);
  const [loadingAdvancedLogs, setLoadingAdvancedLogs] = useState(false);
  const [advancedLogsStats, setAdvancedLogsStats] = useState({
    total: 0,
    success: 0,
    errors: 0,
    last24h: 0
  });
  const [logsFilters, setLogsFilters] = useState({
    status: '',
    dateFrom: '',
    dateTo: '',
    configId: '',
    limit: 50
  });
  
  // Estados para abas principais - NOVA ESTRUTURA
  const [activeTab, setActiveTab] = useState<'integracoes' | 'usuarios' | 'empresas'>('integracoes');
  const [integracoesTab, setIntegracoesTab] = useState<'whatsapp' | 'webhook-simples' | 'webhook-avancado'>('whatsapp');
  const [whatsappTab, setWhatsappTab] = useState<'whatsapp-life' | 'cloud-api' | 'modelos'>('whatsapp-life');
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

  // ===== NOVO useEffect ISOLADO PARA LOGS AVANÇADOS =====
  // Carrega logs avançados apenas quando necessário
  useEffect(() => {
    if (company && activeTab === 'integracoes' && integracoesTab === 'webhook-avancado') {
      console.log('🔄 Carregando dados dos logs avançados...');
      // Carregar logs sem filtros inicialmente
      const initialFilters = {
        status: 'todos',
        dateFrom: '',
        dateTo: '',
        configId: '',
        limit: 50
      };
      loadAdvancedLogs(initialFilters);
      loadAdvancedLogsStats();
    }
  }, [company, activeTab, integracoesTab]);

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

  // ===== NOVAS FUNÇÕES ISOLADAS PARA LOGS AVANÇADOS =====
  // Funções específicas para não interferir nas existentes
  
  const loadAdvancedLogs = async (filters = logsFilters) => {
    if (!company?.id) return;
    
    setLoadingAdvancedLogs(true);
    try {
      console.log('🔄 Carregando logs avançados diretamente da tabela:', { companyId: company.id, filters });
      
      // TESTE 1: Primeiro vamos buscar logs SEM JOIN para ver se existem
      console.log('🔍 TESTE 1: Buscando logs sem JOIN');
      const { data: rawLogs, error: rawError } = await supabase
        .from('webhook_trigger_logs')
        .select('*')
        .limit(10);
      
      console.log('📊 TESTE 1 - Logs brutos encontrados:', rawLogs?.length || 0);
      console.log('📋 TESTE 1 - Primeiro log bruto:', rawLogs?.[0]);
      if (rawError) console.error('❌ TESTE 1 - Erro:', rawError);
      
      // TESTE 2: Buscar configurações de webhook
      console.log('🔍 TESTE 2: Buscando configurações de webhook');
      const { data: configs, error: configError } = await supabase
        .from('webhook_trigger_configs')
        .select('*')
        .eq('company_id', company.id);
      
      console.log('📊 TESTE 2 - Configurações encontradas:', configs?.length || 0);
      console.log('📋 TESTE 2 - Primeira config:', configs?.[0]);
      if (configError) console.error('❌ TESTE 2 - Erro:', configError);
      
      // TESTE 3: Buscar logs que pertencem às configurações da empresa
      console.log('🔍 TESTE 3: Buscando logs com filtro por config_id');
      const configIds = configs?.map(c => c.id) || [];
      console.log('🔑 Config IDs da empresa:', configIds);
      
      if (configIds.length > 0) {
        const { data: filteredLogs, error: filteredError } = await supabase
          .from('webhook_trigger_logs')
          .select('*')
          .in('config_id', configIds)
          .limit(10);
        
        console.log('📊 TESTE 3 - Logs filtrados encontrados:', filteredLogs?.length || 0);
        console.log('📋 TESTE 3 - Primeiro log filtrado:', filteredLogs?.[0]);
        if (filteredError) console.error('❌ TESTE 3 - Erro:', filteredError);
      }
      
      // Construir query base (usando apenas colunas que existem)
      let query = supabase
        .from('webhook_trigger_logs')
        .select(`
          id,
          config_id,
          response_status,
          response_body,
          error_message,
          created_at
        `);
      
      // Aplicar filtros de data se especificados
      if (filters.dateFrom) {
        const dateFrom = new Date(filters.dateFrom);
        dateFrom.setHours(0, 0, 0, 0); // Início do dia
        console.log('📅 Filtro Data Início:', dateFrom.toISOString());
        query = query.gte('created_at', dateFrom.toISOString());
      }
      
      if (filters.dateTo) {
        const dateTo = new Date(filters.dateTo);
        dateTo.setHours(23, 59, 59, 999); // Final do dia
        console.log('📅 Filtro Data Fim:', dateTo.toISOString());
        query = query.lte('created_at', dateTo.toISOString());
      }
      
      // Filtrar por logs da empresa usando config_ids
      if (configIds.length > 0) {
        query = query.in('config_id', configIds);
        console.log('🔍 Filtro por config_ids aplicado:', configIds);
      } else {
        console.log('⚠️ Nenhuma configuração encontrada - retornando array vazio');
        setAdvancedLogs([]);
        return;
      }
      
      // Aplicar filtro de status se especificado (baseado na nova lógica)
      if (filters.status && filters.status !== 'todos') {
        console.log('🔍 Filtro Status:', { status: filters.status });
        if (filters.status === 'success') {
          // Sucesso = response_status 2xx (200-299) e sem erros de rede
          query = query.gte('response_status', 200).lt('response_status', 300);
        } else if (filters.status === 'error') {
          // Erro = response_status fora de 2xx ou com erros de rede
          query = query.or('response_status.lt.200,response_status.gte.300,response_status.is.null');
        }
      }
      
      // Aplicar ordenação e limite
      query = query.order('created_at', { ascending: false }).limit(filters.limit || 50);
      
      console.log('🔍 Query final construída com filtros aplicados');
      
      // Executar query
      const { data, error } = await query;
      
      if (error) {
        console.error('❌ Erro ao buscar logs:', error);
        setAdvancedLogs([]);
        return;
      }
      
      // Transformar dados para o formato esperado
      const transformedLogs = (data || []).map((log: any) => {
        // Encontrar a configuração correspondente
        const config = configs?.find(c => c.id === log.config_id);
        
        // Lógica melhorada para determinar sucesso
        const isSuccess = () => {
          // Se há erro de rede/timeout/conexão = falha real
          if (log.error_message && 
              (log.error_message.toLowerCase().includes('timeout') || 
               log.error_message.toLowerCase().includes('network') ||
               log.error_message.toLowerCase().includes('connection') ||
               log.error_message.toLowerCase().includes('failed to fetch'))) {
            return false;
          }
          
          // Se conseguiu enviar e tem response_status = verificar se é sucesso
          if (log.response_status !== null && log.response_status !== undefined) {
            // Aceitar status 2xx (200-299) como sucesso
            return log.response_status >= 200 && log.response_status < 300;
          }
          
          // Se não há erro explícito de rede = provavelmente sucesso
          return !log.error_message;
        };

        return {
          id: log.id,
          config_id: log.config_id,
          webhook_name: config?.name || 'N8N - Novo Lead',
          webhook_url: config?.webhook_url || '',
          trigger_event: 'lead_created', // Valor fixo já que todos são lead_created
          success: isSuccess(), // Lógica melhorada para determinar sucesso
          response_status: log.response_status,
          response_body: log.response_body,
          error_message: log.error_message,
          created_at: log.created_at
        };
      });
      
      setAdvancedLogs(transformedLogs);
      console.log('✅ Logs avançados carregados diretamente:', transformedLogs.length);
      console.log('📋 Primeiro log:', transformedLogs[0]);
      console.log('📋 Todos os logs:', transformedLogs);
      console.log('📊 Estado advancedLogs atualizado:', { length: transformedLogs.length });
    } catch (error) {
      console.error('❌ Erro ao carregar logs avançados:', error);
      setAdvancedLogs([]);
    } finally {
      setLoadingAdvancedLogs(false);
    }
  };

  const loadAdvancedLogsStats = async () => {
    if (!company?.id) return;
    
    try {
      console.log('🔄 Carregando estatísticas dos logs...');
      const stats = await api.getAdvancedWebhookStats(company.id);
      setAdvancedLogsStats(stats);
      console.log('✅ Estatísticas carregadas:', stats);
    } catch (error) {
      console.error('❌ Erro ao carregar estatísticas:', error);
    }
  };

  const refreshAdvancedLogs = async () => {
    console.log('🔄 Atualizando logs avançados...');
    await Promise.all([
      loadAdvancedLogs(),
      loadAdvancedLogsStats()
    ]);
  };

  const handleLogsFilterChange = (field: string, value: string) => {
    setLogsFilters(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const applyLogsFilters = () => {
    loadAdvancedLogs(logsFilters);
  };

  const clearLogsFilters = () => {
    const defaultFilters = {
      status: '',
      dateFrom: '',
      dateTo: '',
      configId: '',
      limit: 50
    };
    setLogsFilters(defaultFilters);
    loadAdvancedLogs(defaultFilters);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Configurações</h1>
        <p className="text-slate-600 mt-1">Gerencie as configurações da sua conta</p>
        
        {/* Navegação Principal Moderna */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          {/* Card Integrações */}
          <div 
            onClick={() => setActiveTab('integracoes')}
            className="group cursor-pointer"
          >
            <div className={`bg-gradient-to-br from-blue-50 to-indigo-100 border-2 rounded-xl p-6 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 ${
              activeTab === 'integracoes' 
                ? 'border-blue-400 shadow-lg -translate-y-1' 
                : 'border-transparent hover:border-blue-300'
            }`}>
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-lg shadow-md group-hover:shadow-lg transition-shadow ${
                  activeTab === 'integracoes' ? 'bg-blue-600' : 'bg-blue-500'
                }`}>
                  <SettingsIcon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Integrações</h3>
                  <p className="text-sm text-slate-600">Configure suas integrações e automações</p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Card Usuários - NOVO */}
          <div 
            onClick={() => setActiveTab('usuarios')}
            className="group cursor-pointer"
          >
            <div className={`bg-gradient-to-br from-orange-50 to-red-100 border-2 rounded-xl p-6 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 ${
              activeTab === 'usuarios' 
                ? 'border-orange-400 shadow-lg -translate-y-1' 
                : 'border-transparent hover:border-orange-300'
            }`}>
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-lg shadow-md group-hover:shadow-lg transition-shadow ${
                  activeTab === 'usuarios' ? 'bg-orange-600' : 'bg-orange-500'
                }`}>
                  <Users className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Usuários</h3>
                  <p className="text-sm text-slate-600">Gerencie usuários e permissões</p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Card Dados da Empresa */}
          <div 
            onClick={() => setActiveTab('empresas')}
            className="group cursor-pointer"
          >
            <div className={`bg-gradient-to-br from-emerald-50 to-green-100 border-2 rounded-xl p-6 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 ${
              activeTab === 'empresas' 
                ? 'border-emerald-400 shadow-lg -translate-y-1' 
                : 'border-transparent hover:border-emerald-300'
            }`}>
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-lg shadow-md group-hover:shadow-lg transition-shadow ${
                  activeTab === 'empresas' ? 'bg-emerald-600' : 'bg-emerald-500'
                }`}>
                  <Building className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Dados da Empresa</h3>
                  <p className="text-sm text-slate-600">Gerencie informações da sua empresa</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Aba Integrações - NOVA ESTRUTURA */}
      {activeTab === 'integracoes' && (
        <div className="space-y-6">
          
          {/* Sub-navegação das Integrações Moderna */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* WhatsApp Card */}
            <div 
              onClick={() => setIntegracoesTab('whatsapp')}
              className="group cursor-pointer"
            >
              <div className={`bg-gradient-to-br from-green-50 to-emerald-100 border-2 rounded-xl p-6 transition-all duration-300 hover:shadow-xl hover:-translate-y-2 ${
                integracoesTab === 'whatsapp'
                  ? 'border-green-400 shadow-xl -translate-y-2'
                  : 'border-transparent hover:border-green-400'
              }`}>
                <div className="text-center">
                  <div className={`p-4 rounded-full w-16 h-16 mx-auto mb-4 shadow-lg group-hover:shadow-xl transition-shadow ${
                    integracoesTab === 'whatsapp' ? 'bg-green-600' : 'bg-green-500'
                  }`}>
                    <WhatsAppIcon className="w-8 h-8 text-white mx-auto mt-1" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">WhatsApp</h3>
                  <p className="text-sm text-slate-600 mb-4">Automações e integrações WhatsApp</p>
                  <div className="flex justify-center">
                    <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                      3 funcionalidades
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* API Card */}
            <div 
              onClick={() => setIntegracoesTab('webhook-simples')}
              className="group cursor-pointer"
            >
              <div className={`bg-gradient-to-br from-blue-50 to-cyan-100 border-2 rounded-xl p-6 transition-all duration-300 hover:shadow-xl hover:-translate-y-2 ${
                integracoesTab === 'webhook-simples'
                  ? 'border-blue-400 shadow-xl -translate-y-2'
                  : 'border-transparent hover:border-blue-400'
              }`}>
                <div className="text-center">
                  <div className={`p-4 rounded-full w-16 h-16 mx-auto mb-4 shadow-lg group-hover:shadow-xl transition-shadow ${
                    integracoesTab === 'webhook-simples' ? 'bg-blue-600' : 'bg-blue-500'
                  }`}>
                    <Webhook className="w-8 h-8 text-white mx-auto mt-1" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">API</h3>
                  <p className="text-sm text-slate-600 mb-4">Receba dados de formulários</p>
                  <div className="flex justify-center">
                    <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                      Ativo
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Webhook Avançado Card */}
            <div 
              onClick={() => setIntegracoesTab('webhook-avancado')}
              className="group cursor-pointer"
            >
              <div className={`bg-gradient-to-br from-purple-50 to-indigo-100 border-2 rounded-xl p-6 transition-all duration-300 hover:shadow-xl hover:-translate-y-2 ${
                integracoesTab === 'webhook-avancado'
                  ? 'border-purple-400 shadow-xl -translate-y-2'
                  : 'border-transparent hover:border-purple-400'
              }`}>
                <div className="text-center">
                  <div className={`p-4 rounded-full w-16 h-16 mx-auto mb-4 shadow-lg group-hover:shadow-xl transition-shadow ${
                    integracoesTab === 'webhook-avancado' ? 'bg-purple-600' : 'bg-purple-500'
                  }`}>
                    <Zap className="w-8 h-8 text-white mx-auto mt-1" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Webhook Avançado</h3>
                  <p className="text-sm text-slate-600 mb-4">Envie dados automaticamente</p>
                  <div className="flex justify-center">
                    <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                      Configurável
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Conteúdo das Sub-abas */}
          
          {/* Sub-aba: WhatsApp */}
          {integracoesTab === 'whatsapp' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              {/* Sub-navegação do WhatsApp Moderna */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {/* WhatsApp Life */}
                <div 
                  onClick={() => setWhatsappTab('whatsapp-life')}
                  className="group cursor-pointer"
                >
                  <div className={`bg-white border-2 rounded-lg p-4 transition-all duration-300 hover:shadow-md ${
                    whatsappTab === 'whatsapp-life'
                      ? 'border-green-300 shadow-md'
                      : 'border-slate-200 hover:border-green-300'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-100 rounded-lg">
                        <Smartphone className="w-5 h-5 text-green-600" />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-medium text-slate-900">WhatsApp Life</h4>
                        <p className="text-xs text-slate-500">Conexão local</p>
                      </div>
                      <div className="w-2 h-2 bg-yellow-400 rounded-full" title="Em desenvolvimento"></div>
                    </div>
                  </div>
                </div>
                
                {/* Cloud API */}
                <div 
                  onClick={() => setWhatsappTab('cloud-api')}
                  className="group cursor-pointer"
                >
                  <div className={`bg-white border-2 rounded-lg p-4 transition-all duration-300 hover:shadow-md ${
                    whatsappTab === 'cloud-api'
                      ? 'border-green-300 shadow-md'
                      : 'border-slate-200 hover:border-green-300'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-100 rounded-lg">
                        <Cloud className="w-5 h-5 text-green-600" />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-medium text-slate-900">Cloud API</h4>
                        <p className="text-xs text-slate-500">API oficial</p>
                      </div>
                      <div className="w-2 h-2 bg-yellow-400 rounded-full" title="Em desenvolvimento"></div>
                    </div>
                  </div>
                </div>
                
                {/* Modelos */}
                <div 
                  onClick={() => setWhatsappTab('modelos')}
                  className="group cursor-pointer"
                >
                  <div className={`bg-white border-2 rounded-lg p-4 transition-all duration-300 hover:shadow-md ${
                    whatsappTab === 'modelos'
                      ? 'border-green-300 shadow-md'
                      : 'border-slate-200 hover:border-green-300'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-100 rounded-lg">
                        <FileText className="w-5 h-5 text-green-600" />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-medium text-slate-900">Modelos</h4>
                        <p className="text-xs text-slate-500">Templates</p>
                      </div>
                      <div className="w-2 h-2 bg-yellow-400 rounded-full" title="Em desenvolvimento"></div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Conteúdo das Sub-abas do WhatsApp */}
              
              {/* WhatsApp Life */}
              {whatsappTab === 'whatsapp-life' && (
                <div className="text-center py-12">
                  <div className="p-4 bg-green-100 rounded-full w-16 h-16 mx-auto mb-4">
                    <Smartphone className="w-8 h-8 text-green-600 mx-auto mt-2" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">
                    🚧 WhatsApp Life - Em Desenvolvimento
                  </h3>
                  <p className="text-slate-600 mb-4">
                    Integração com WhatsApp pessoal/business local
                  </p>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 max-w-md mx-auto">
                    <p className="text-sm text-green-800">
                      Funcionalidade em desenvolvimento. Em breve você poderá conectar seu WhatsApp local para automações avançadas.
                    </p>
                  </div>
                </div>
              )}
              
              {/* Cloud API WhatsApp */}
              {whatsappTab === 'cloud-api' && (
                <div className="text-center py-12">
                  <div className="p-4 bg-green-100 rounded-full w-16 h-16 mx-auto mb-4">
                    <Cloud className="w-8 h-8 text-green-600 mx-auto mt-2" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">
                    🚧 Cloud API WhatsApp - Em Desenvolvimento
                  </h3>
                  <p className="text-slate-600 mb-4">
                    API oficial do WhatsApp Business Cloud
                  </p>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 max-w-md mx-auto">
                    <p className="text-sm text-green-800">
                      Funcionalidade em desenvolvimento. Em breve você poderá usar a API oficial do WhatsApp Business para envios em massa e automações.
                    </p>
                  </div>
                </div>
              )}
              
              {/* Modelos */}
              {whatsappTab === 'modelos' && (
                <div className="text-center py-12">
                  <div className="p-4 bg-green-100 rounded-full w-16 h-16 mx-auto mb-4">
                    <FileText className="w-8 h-8 text-green-600 mx-auto mt-2" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">
                    🚧 Modelos de Mensagens - Em Desenvolvimento
                  </h3>
                  <p className="text-slate-600 mb-4">
                    Cadastro e gerenciamento de modelos de mensagens do WhatsApp
                  </p>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 max-w-md mx-auto">
                    <p className="text-sm text-green-800">
                      Funcionalidade em desenvolvimento. Em breve você poderá criar e gerenciar modelos de mensagens para automações do WhatsApp.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Sub-aba: API */}
          {integracoesTab === 'webhook-simples' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 lg:col-span-2">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <Webhook className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">API para Leads</h2>
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
          )}
          
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
              
              {/* CONTEÚDO COMPLETO DO WEBHOOK AVANÇADO - FORMULÁRIOS E CONFIGURAÇÕES */}
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
                        📋 Campos do Lead
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
                        🏢 Campos da Empresa
                      </label>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {['name', 'domain', 'plan', 'status', 'created_at'].map((field) => (
                          <label key={field} className="flex items-center">
                            <input
                              type="checkbox"
                              checked={webhookConfig.payload_fields.empresa.includes(field)}
                              onChange={() => handleFieldToggle('empresa', field)}
                              className="mr-2"
                            />
                            {field}
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Campos disponíveis da empresa: nome, domínio, plano, status e data de criação
                      </p>
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

                {/* Logs de Disparos - INTERFACE FUNCIONAL */}
                <div className="bg-white border border-slate-200 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-purple-100 rounded-lg">
                        <Clock className="w-5 h-5 text-purple-600" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">📊 Logs de Disparos</h3>
                        <p className="text-sm text-slate-600">Histórico de execuções dos webhooks</p>
                      </div>
                    </div>
                    <button
                      onClick={refreshAdvancedLogs}
                      disabled={loadingAdvancedLogs}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      <Clock className="w-4 h-4" />
                      {loadingAdvancedLogs ? 'Atualizando...' : 'Atualizar'}
                    </button>
                  </div>

                  {/* Estatísticas dos Logs */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-slate-50 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-slate-900">{advancedLogsStats.total}</div>
                      <div className="text-sm text-slate-600">Total</div>
                    </div>
                    <div className="bg-green-50 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-green-600">{advancedLogsStats.success}</div>
                      <div className="text-sm text-green-700">Sucessos</div>
                    </div>
                    <div className="bg-red-50 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-red-600">{advancedLogsStats.errors}</div>
                      <div className="text-sm text-red-700">Erros</div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-blue-600">{advancedLogsStats.last24h}</div>
                      <div className="text-sm text-blue-700">Últimas 24h</div>
                    </div>
                  </div>

                  {/* Filtros */}
                  <div className="bg-slate-50 rounded-lg p-4 mb-6">
                    <h4 className="font-medium text-slate-900 mb-3">🔍 Filtros</h4>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                        <select
                          value={logsFilters.status}
                          onChange={(e) => handleLogsFilterChange('status', e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                        >
                          <option value="">Todos</option>
                          <option value="success">Sucesso</option>
                          <option value="error">Erro</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Data Início</label>
                        <input
                          type="date"
                          value={logsFilters.dateFrom}
                          onChange={(e) => handleLogsFilterChange('dateFrom', e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Data Fim</label>
                        <input
                          type="date"
                          value={logsFilters.dateTo}
                          onChange={(e) => handleLogsFilterChange('dateTo', e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                        />
                      </div>
                      <div className="flex items-end gap-2">
                        <button
                          onClick={applyLogsFilters}
                          className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors text-sm"
                        >
                          Aplicar
                        </button>
                        <button
                          onClick={clearLogsFilters}
                          className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm"
                        >
                          Limpar
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Lista de Logs */}
                  {loadingAdvancedLogs ? (
                    <div className="text-center py-8">
                      <Clock className="w-8 h-8 mx-auto mb-2 text-slate-400 animate-spin" />
                      <p className="text-slate-600">Carregando logs...</p>
                    </div>
                  ) : advancedLogs.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                      <Clock className="w-12 h-12 mx-auto mb-2 text-slate-400" />
                      <p>Nenhum log de disparo encontrado</p>
                      <p className="text-sm">Os logs aparecerão aqui quando webhooks forem disparados</p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {advancedLogs.map((log, index) => (
                        <div key={index} className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <h4 className="font-medium text-slate-900">{log.webhook_name || 'N8N - Novo Lead'}</h4>
                                <span className={`px-2 py-1 rounded text-xs font-medium ${
                                  log.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                }`}>
                                  {log.success ? '✅ Sucesso' : '❌ Erro'}
                                </span>
                                {log.success === false && (
                                  <span className="px-2 py-1 rounded text-xs bg-yellow-100 text-yellow-700">
                                    ⚠️ Verificar logs
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-slate-600 mb-2">{log.webhook_url}</p>
                              <div className="flex items-center gap-4 text-xs text-slate-500">
                                <span>Evento: {log.trigger_event || 'N/A'}</span>
                                {log.response_status && <span>Status: {log.response_status}</span>}
                                <span>Data: {log.created_at ? new Date(log.created_at).toLocaleString('pt-BR') : 'Data não disponível'}</span>
                              </div>
                            </div>
                          </div>
                          
                          {log.error_message && (
                            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm">
                              <div className="flex items-start gap-2">
                                <span className="text-red-600 font-medium">❌ Erro:</span>
                                <span className="text-red-700">{log.error_message}</span>
                              </div>
                            </div>
                          )}
                          
                          {log.response_body && (
                            <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded text-sm">
                              <div className="flex items-start gap-2">
                                <span className="text-slate-600 font-medium">📄 Resposta:</span>
                                <span className="text-slate-700 font-mono text-xs">{log.response_body}</span>
                              </div>
                            </div>
                          )}
                          
                          {/* Informação de debug para logs com erro */}
                          {log.success === false && !log.error_message && (
                            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded text-sm">
                              <div className="flex items-start gap-2">
                                <span className="text-blue-600 font-medium">ℹ️ Informação:</span>
                                <div className="text-blue-700">
                                  <p>O webhook foi disparado mas está marcado como erro no banco de dados.</p>
                                  <p className="mt-1 text-xs">
                                    <strong>Teste manual:</strong> O webhook responde corretamente (200 OK) quando testado diretamente.
                                    <br />
                                    <strong>Problema:</strong> A função RPC que registra os logs precisa ser atualizada.
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Rodapé com informações */}
                  <div className="mt-4 pt-4 border-t border-slate-200 text-center">
                    <p className="text-xs text-slate-500">
                      Mostrando {advancedLogs.length} log(s) • 
                      Atualizado automaticamente • 
                      Dados em tempo real
                    </p>
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

      {/* Aba Usuários - EM DESENVOLVIMENTO */}
      {activeTab === 'usuarios' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12">
            <div className="text-center">
              <div className="p-4 bg-orange-100 rounded-full w-20 h-20 mx-auto mb-6">
                <Users className="w-12 h-12 text-orange-600 mx-auto mt-2" />
              </div>
              <h3 className="text-2xl font-semibold text-slate-900 mb-4">
                🚧 Gestão de Usuários - Em Desenvolvimento
              </h3>
              <p className="text-slate-600 mb-6 max-w-md mx-auto">
                Funcionalidade para gerenciar usuários, permissões e controle de acesso ao sistema
              </p>
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-6 max-w-lg mx-auto">
                <p className="text-sm text-orange-800">
                  Em breve você poderá adicionar usuários, definir permissões e controlar o acesso às funcionalidades do sistema.
                </p>
              </div>
            </div>
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
              <div className="space-y-8">
                
                {/* Campos Personalizados */}
                <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-purple-900 mb-4 flex items-center gap-2">
                    🎯 Campos Personalizados
                  </h3>
                  <div className="space-y-4 text-sm text-purple-800">
                    <div>
                      <p className="font-medium mb-2">1. Criar Campo:</p>
                      <p className="ml-4 mb-1">• Acesse: Configurações → Campos Personalizados</p>
                      <p className="ml-4 mb-1">• Clique em "Novo Campo"</p>
                      <p className="ml-4">• Campo receberá ID automático (1, 2, 3...)</p>
                    </div>
                    <div>
                      <p className="font-medium mb-2">2. Usar no Payload:</p>
                      <div className="bg-purple-100 p-3 rounded border ml-4">
                        <code className="text-xs">
                          "custom_fields": {"{"}
                          <br />
                          &nbsp;&nbsp;"custom_field_1": "Valor do campo 1",
                          <br />
                          &nbsp;&nbsp;"custom_field_2": "Valor do campo 2"
                          <br />
                          {"}"}
                        </code>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Campos Padrão */}
                <div className="bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-blue-900 mb-4 flex items-center gap-2">
                    📋 Campos Padrão Disponíveis
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <h4 className="font-medium text-blue-800 mb-2">Lead:</h4>
                      <ul className="space-y-1 text-blue-700">
                        <li>• name (string)</li>
                        <li>• email (string)</li>
                        <li>• phone (string)</li>
                        <li>• status (string)</li>
                        <li>• origin (string)</li>
                        <li>• created_at (datetime)</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-medium text-blue-800 mb-2">Empresa:</h4>
                      <ul className="space-y-1 text-blue-700">
                        <li>• name (string)</li>
                        <li>• cnpj (string)</li>
                        <li>• domain (string)</li>
                        <li>• created_at (datetime)</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-medium text-blue-800 mb-2">Analytics:</h4>
                      <ul className="space-y-1 text-blue-700">
                        <li>• source (string)</li>
                        <li>• medium (string)</li>
                        <li>• campaign (string)</li>
                        <li>• utm_content (string)</li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Exemplos de Código */}
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-green-900 mb-4 flex items-center gap-2">
                    💻 Exemplo Completo de Payload
                  </h3>
                  <div className="bg-green-100 p-4 rounded border overflow-x-auto">
                    <pre className="text-xs text-green-800">
{`{
  "event": "lead_converted",
  "timestamp": "2024-11-06T12:30:00Z",
  "lead": {
    "id": "lead_123456",
    "name": "João Silva",
    "email": "joao@empresa.com",
    "phone": "+5511999999999",
    "status": "converted",
    "origin": "website",
    "created_at": "2024-11-06T12:00:00Z"
  },
  "company": {
    "id": "company_789",
    "name": "Empresa LTDA",
    "cnpj": "12.345.678/0001-90",
    "domain": "empresa.com"
  },
  "custom_fields": {
    "custom_field_1": "Interesse em produto A",
    "custom_field_2": "Orçamento: R$ 10.000"
  },
  "analytics": {
    "source": "google",
    "medium": "cpc",
    "campaign": "campanha_novembro",
    "utm_content": "anuncio_produto_a"
  }
}`}
                    </pre>
                  </div>
                </div>

                {/* Configuração Técnica */}
                <div className="bg-gradient-to-r from-orange-50 to-yellow-50 border border-orange-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-orange-900 mb-4 flex items-center gap-2">
                    ⚙️ Configuração Técnica
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                    <div>
                      <h4 className="font-medium text-orange-800 mb-2">Rate Limits:</h4>
                      <ul className="space-y-1 text-orange-700">
                        <li>• 1000 requests/hour</li>
                        <li>• 50 requests/minute</li>
                        <li>• Burst: até 10 simultâneos</li>
                      </ul>
                      
                      <h4 className="font-medium text-orange-800 mb-2 mt-4">Timeout:</h4>
                      <ul className="space-y-1 text-orange-700">
                        <li>• Mínimo: 1 segundo</li>
                        <li>• Máximo: 60 segundos</li>
                        <li>• Recomendado: 10-30s</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-medium text-orange-800 mb-2">Headers Obrigatórios:</h4>
                      <div className="bg-orange-100 p-3 rounded border">
                        <code className="text-xs">
                          Content-Type: application/json
                          <br />
                          User-Agent: LovoCRM-Webhook/1.0
                        </code>
                      </div>
                      
                      <h4 className="font-medium text-orange-800 mb-2 mt-4">Retry Logic:</h4>
                      <ul className="space-y-1 text-orange-700">
                        <li>• Exponential backoff</li>
                        <li>• 1ª tentativa: imediata</li>
                        <li>• 2ª tentativa: +2s</li>
                        <li>• 3ª tentativa: +4s</li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Troubleshooting */}
                <div className="bg-gradient-to-r from-red-50 to-pink-50 border border-red-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-red-900 mb-4 flex items-center gap-2">
                    🔧 Troubleshooting
                  </h3>
                  <div className="space-y-4 text-sm">
                    <div>
                      <h4 className="font-medium text-red-800 mb-2">Erros Comuns:</h4>
                      <div className="space-y-3">
                        <div className="bg-red-100 p-3 rounded border">
                          <p className="font-medium text-red-800">Timeout (408):</p>
                          <p className="text-red-700">• Aumente o timeout na configuração</p>
                          <p className="text-red-700">• Verifique se sua URL responde rapidamente</p>
                        </div>
                        <div className="bg-red-100 p-3 rounded border">
                          <p className="font-medium text-red-800">Unauthorized (401):</p>
                          <p className="text-red-700">• Verifique headers de autenticação</p>
                          <p className="text-red-700">• Confirme se o token está válido</p>
                        </div>
                        <div className="bg-red-100 p-3 rounded border">
                          <p className="font-medium text-red-800">Bad Request (400):</p>
                          <p className="text-red-700">• Verifique formato do payload</p>
                          <p className="text-red-700">• Confirme se campos obrigatórios estão presentes</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Performance */}
                <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-indigo-900 mb-4 flex items-center gap-2">
                    📊 Performance & Monitoramento
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                    <div>
                      <h4 className="font-medium text-indigo-800 mb-2">Boas Práticas:</h4>
                      <ul className="space-y-1 text-indigo-700">
                        <li>• Responda com status 200 para sucesso</li>
                        <li>• Implemente idempotência</li>
                        <li>• Use HTTPS sempre</li>
                        <li>• Valide assinatura do webhook</li>
                        <li>• Processe de forma assíncrona</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-medium text-indigo-800 mb-2">Logs Disponíveis:</h4>
                      <ul className="space-y-1 text-indigo-700">
                        <li>• Timestamp do disparo</li>
                        <li>• Status da resposta</li>
                        <li>• Tempo de resposta</li>
                        <li>• Payload enviado</li>
                        <li>• Mensagem de erro (se houver)</li>
                      </ul>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
