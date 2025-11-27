import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { validateCNPJ, validateEmail, validateURL, validateCEP, validatePhone } from '../utils/validators';
import { maskCNPJ, maskCEP, maskPhone, BRAZILIAN_STATES } from '../utils/masks';
import { fetchCEPData, isValidCEPForSearch, formatAddress } from '../utils/cep';
import {
  X,
  Save,
  User,
  Mail,
  Phone,
  Building,
  Tag,
  FileText,
  Type,
  List,
  MapPin,
  Globe
} from 'lucide-react';

interface Lead {
  id?: number;
  name: string;
  email?: string;
  phone?: string;
  origin: string;
  status: string;
  interest?: string;
  responsible_user_id?: string;
  visitor_id?: string;
  // Campos da empresa
  company_name?: string;
  company_cnpj?: string;
  company_razao_social?: string;
  company_nome_fantasia?: string;
  company_cep?: string;
  company_cidade?: string;
  company_estado?: string;
  company_endereco?: string;
  company_telefone?: string;
  company_email?: string;
  company_site?: string;
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

interface CustomField {
  id: string;
  field_name: string;
  field_label: string;
  field_type: 'text' | 'number' | 'date' | 'boolean' | 'select';
  options?: any[];
  is_required: boolean;
}

interface LeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead?: Lead | null;
  onSave: () => void;
}

export const LeadModal: React.FC<LeadModalProps> = ({
  isOpen,
  onClose,
  lead,
  onSave
}) => {
  const { company } = useAuth();
  const [loading, setLoading] = useState(false);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [activeTab, setActiveTab] = useState<'lead' | 'company'>('lead');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    origin: 'manual',
    status: 'novo',
    interest: '',
    responsible_user_id: '',
    visitor_id: ''
  });
  const [companyData, setCompanyData] = useState({
    company_name: '',
    company_cnpj: '',
    company_razao_social: '',
    company_nome_fantasia: '',
    company_cep: '',
    company_cidade: '',
    company_estado: '',
    company_endereco: '',
    company_telefone: '',
    company_email: '',
    company_site: ''
  });
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [cepLoading, setCepLoading] = useState(false);

  useEffect(() => {
    if (isOpen && company?.id) {
      loadCustomFields();
      if (lead) {
        // Edição - preencher dados existentes
        setFormData({
          name: lead.name || '',
          email: lead.email || '',
          phone: lead.phone || '',
          origin: lead.origin || 'manual',
          status: lead.status || 'novo',
          interest: lead.interest || '',
          responsible_user_id: lead.responsible_user_id || '',
          visitor_id: lead.visitor_id || ''
        });

        // Preencher dados da empresa
        setCompanyData({
          company_name: lead.company_name || '',
          company_cnpj: lead.company_cnpj || '',
          company_razao_social: lead.company_razao_social || '',
          company_nome_fantasia: lead.company_nome_fantasia || '',
          company_cep: lead.company_cep || '',
          company_cidade: lead.company_cidade || '',
          company_estado: lead.company_estado || '',
          company_endereco: lead.company_endereco || '',
          company_telefone: lead.company_telefone || '',
          company_email: lead.company_email || '',
          company_site: lead.company_site || ''
        });

        // Preencher valores dos campos personalizados
        const customValues: Record<string, any> = {};
        lead.lead_custom_values?.forEach(value => {
          customValues[value.field_id] = value.value;
        });
        setCustomFieldValues(customValues);
      } else {
        // Criação - limpar formulário
        setFormData({
          name: '',
          email: '',
          phone: '',
          origin: 'manual',
          status: 'novo',
          interest: '',
          responsible_user_id: '',
          visitor_id: ''
        });
        setCompanyData({
          company_name: '',
          company_cnpj: '',
          company_razao_social: '',
          company_nome_fantasia: '',
          company_cep: '',
          company_cidade: '',
          company_estado: '',
          company_endereco: '',
          company_telefone: '',
          company_email: '',
          company_site: ''
        });
        setCustomFieldValues({});
      }
      setValidationErrors({});
    }
  }, [isOpen, lead, company?.id]);

  // Log adicional para diagnosticar problema
  useEffect(() => {
    console.log('🔍 LEADMODAL - DIAGNÓSTICO LEAD:', { 
      isOpen, 
      leadId: lead?.id, 
      leadName: lead?.name,
      leadExists: !!lead 
    });
  }, [isOpen, lead]);

  const loadCustomFields = async () => {
    if (!company?.id) return;
    
    try {
      const fields = await api.getCustomFields(company.id);
      setCustomFields(fields);
    } catch (error) {
      console.error('Error loading custom fields:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company?.id) return;

    // Validar dados da empresa
    const errors: Record<string, string> = {};
    
    if (companyData.company_cnpj && !validateCNPJ(companyData.company_cnpj)) {
      errors.company_cnpj = 'CNPJ inválido';
    }
    if (companyData.company_email && !validateEmail(companyData.company_email)) {
      errors.company_email = 'Email inválido';
    }
    if (companyData.company_site && !validateURL(companyData.company_site)) {
      errors.company_site = 'URL inválida';
    }
    if (companyData.company_cep && !validateCEP(companyData.company_cep)) {
      errors.company_cep = 'CEP inválido';
    }
    if (companyData.company_telefone && !validatePhone(companyData.company_telefone)) {
      errors.company_telefone = 'Telefone inválido';
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }

    // Verificar se company está disponível
    console.log('🔍 LEADMODAL - COMPANY CONTEXT:', company);
    console.log('🔍 LEADMODAL - COMPANY ID:', company?.id);
    
    if (!company?.id) {
      console.error('❌ LEADMODAL - COMPANY ID MISSING:', { company, companyId: company?.id });
      alert('Erro: Empresa não identificada. Recarregue a página e tente novamente.');
      return;
    }

    setLoading(true);
    try {
      console.log('🔍 LEADMODAL - FORM DATA:', formData);
      console.log('🔍 LEADMODAL - FORM DATA COMPANY_ID:', (formData as any).company_id);
      console.log('🔍 LEADMODAL - FORM DATA EMAIL:', formData.email);
      console.log('🔍 LEADMODAL - EMAIL TIPO:', typeof formData.email);
      console.log('🔍 LEADMODAL - EMAIL VAZIO?:', formData.email === '');
      console.log('🔍 LEADMODAL - COMPANY DATA:', companyData);
      console.log('🔍 LEADMODAL - COMPANY DATA COMPANY_ID:', (companyData as any).company_id);
      console.log('🔍 LEADMODAL - CUSTOM FIELDS:', customFieldValues);
      
      const leadData = {
        ...formData,
        ...companyData,
        company_id: company?.id,
        // Limpar campos UUID vazios para evitar erro de sintaxe
        responsible_user_id: formData.responsible_user_id || null,
        visitor_id: formData.visitor_id || null,
        custom_fields: customFieldValues
      };
      
      console.log('🔍 LEADMODAL - LEAD DATA FINAL:', leadData);
      console.log('🔍 LEADMODAL - COMPANY_ID FINAL:', leadData.company_id);
      console.log('🔍 LEADMODAL - VERIFICAR SE COMPANY_ID FOI SOBRESCRITO:', {
        formDataCompanyId: (formData as any).company_id,
        companyDataCompanyId: (companyData as any).company_id,
        contextCompanyId: company?.id,
        finalCompanyId: leadData.company_id
      });

      if (lead?.id) {
        // Edição
        await api.updateLead(lead.id, leadData);
      } else {
        // Criação
        await api.createLead(leadData);
      }

      console.log('✅ LEADMODAL - SUCESSO:', 'Lead salvo com sucesso');
      onSave();
      onClose();
    } catch (error) {
      console.error('❌ LEADMODAL - ERRO GERAL:', error);
      console.error('❌ LEADMODAL - DETALHES:', {
        message: (error as any)?.message,
        code: (error as any)?.code,
        details: (error as any)?.details
      });
      alert('Erro ao salvar lead. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleCompanyInputChange = (field: string, value: string) => {
    let processedValue = value;
    
    // Aplicar máscaras
    if (field === 'company_cnpj') {
      processedValue = maskCNPJ(value);
    } else if (field === 'company_cep') {
      processedValue = maskCEP(value);
    } else if (field === 'company_telefone') {
      processedValue = maskPhone(value);
    }
    
    setCompanyData(prev => ({
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

  const handleCustomFieldChange = (fieldId: string, value: any) => {
    setCustomFieldValues(prev => ({
      ...prev,
      [fieldId]: value
    }));
  };

  const handleCEPBlur = async (cep: string) => {
    // Só buscar se CEP estiver válido para busca
    if (!isValidCEPForSearch(cep)) {
      return;
    }

    setCepLoading(true);
    try {
      const result = await fetchCEPData(cep);
      
      if (result.success && result.data) {
        // Preencher campos automaticamente
        setCompanyData(prev => ({
          ...prev,
          company_cidade: result.data!.localidade,
          company_estado: result.data!.uf,
          company_endereco: formatAddress(result.data!)
        }));

        // Limpar erro de CEP se existir
        if (validationErrors.company_cep) {
          setValidationErrors(prev => ({
            ...prev,
            company_cep: ''
          }));
        }
      } else {
        // Mostrar erro se CEP não encontrado
        setValidationErrors(prev => ({
          ...prev,
          company_cep: result.error || 'CEP não encontrado'
        }));
      }
    } catch (error) {
      console.error('Error fetching CEP:', error);
      setValidationErrors(prev => ({
        ...prev,
        company_cep: 'Erro ao buscar CEP'
      }));
    } finally {
      setCepLoading(false);
    }
  };

  const renderCustomField = (field: CustomField) => {
    const value = customFieldValues[field.id] || '';

    switch (field.field_type) {
      case 'text':
        return (
          <div key={field.id} className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              <Type className="w-4 h-4 inline mr-1" />
              {field.field_label}
              {field.is_required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              type="text"
              value={value}
              onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
              required={field.is_required}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder={`Digite ${field.field_label.toLowerCase()}`}
            />
          </div>
        );

      case 'select':
        return (
          <div key={field.id} className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              <List className="w-4 h-4 inline mr-1" />
              {field.field_label}
              {field.is_required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <select
              value={value}
              onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
              required={field.is_required}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Selecione uma opção</option>
              {field.options?.map((option, index) => (
                <option key={index} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        );

      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {lead ? 'Editar Lead' : 'Novo Lead'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Sistema de Abas */}
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              <button
                type="button"
                onClick={() => setActiveTab('lead')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'lead'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <User className="w-4 h-4 inline mr-2" />
                Dados do Lead
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('company')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'company'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Building className="w-4 h-4 inline mr-2" />
                Dados da Empresa
              </button>
            </nav>
          </div>

          {/* Conteúdo da Aba - Dados do Lead */}
          {activeTab === 'lead' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
                Informações do Lead
              </h3>
            
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    <User className="w-4 h-4 inline mr-1" />
                    Nome *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Nome completo do lead"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    <Mail className="w-4 h-4 inline mr-1" />
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="email@exemplo.com"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    <Phone className="w-4 h-4 inline mr-1" />
                    Telefone
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="(11) 99999-9999"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    <Building className="w-4 h-4 inline mr-1" />
                    Origem
                  </label>
                  <select
                    value={formData.origin}
                    onChange={(e) => handleInputChange('origin', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="manual">Manual</option>
                    <option value="landing_page">Landing Page</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="import">Importação</option>
                    <option value="api">API Externa</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    <Tag className="w-4 h-4 inline mr-1" />
                    Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => handleInputChange('status', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="novo">Novo</option>
                    <option value="em_qualificacao">Em Qualificação</option>
                    <option value="convertido">Convertido</option>
                    <option value="perdido">Perdido</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    <FileText className="w-4 h-4 inline mr-1" />
                    Interesse
                  </label>
                  <input
                    type="text"
                    value={formData.interest}
                    onChange={(e) => handleInputChange('interest', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Produto ou serviço de interesse"
                  />
                </div>
              </div>

              {/* Campos Personalizados */}
              {customFields.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
                    Campos Personalizados
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {customFields.map(renderCustomField)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Conteúdo da Aba - Dados da Empresa */}
          {activeTab === 'company' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
                Informações da Empresa
              </h3>

              {/* Informações Básicas */}
              <div className="space-y-4">
                <h4 className="text-md font-medium text-gray-800 flex items-center gap-2">
                  <Building className="w-4 h-4" />
                  Informações Básicas
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Nome da Empresa
                    </label>
                    <input
                      type="text"
                      value={companyData.company_name}
                      onChange={(e) => handleCompanyInputChange('company_name', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Nome da empresa"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      CNPJ
                    </label>
                    <input
                      type="text"
                      value={companyData.company_cnpj}
                      onChange={(e) => handleCompanyInputChange('company_cnpj', e.target.value)}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                        validationErrors.company_cnpj ? 'border-red-300' : 'border-gray-300'
                      }`}
                      placeholder="00.000.000/0000-00"
                    />
                    {validationErrors.company_cnpj && (
                      <p className="text-sm text-red-600">{validationErrors.company_cnpj}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Razão Social
                    </label>
                    <input
                      type="text"
                      value={companyData.company_razao_social}
                      onChange={(e) => handleCompanyInputChange('company_razao_social', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Razão social da empresa"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Nome Fantasia
                    </label>
                    <input
                      type="text"
                      value={companyData.company_nome_fantasia}
                      onChange={(e) => handleCompanyInputChange('company_nome_fantasia', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Nome fantasia"
                    />
                  </div>
                </div>
              </div>

              {/* Localização */}
              <div className="space-y-4">
                <h4 className="text-md font-medium text-gray-800 flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Localização
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      CEP
                      {cepLoading && (
                        <span className="ml-2 text-xs text-blue-600">Buscando...</span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={companyData.company_cep}
                      onChange={(e) => handleCompanyInputChange('company_cep', e.target.value)}
                      onBlur={(e) => handleCEPBlur(e.target.value)}
                      disabled={cepLoading}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                        validationErrors.company_cep ? 'border-red-300' : 'border-gray-300'
                      } ${cepLoading ? 'bg-gray-50' : ''}`}
                      placeholder="00000-000"
                    />
                    {validationErrors.company_cep && (
                      <p className="text-sm text-red-600">{validationErrors.company_cep}</p>
                    )}
                    {!validationErrors.company_cep && companyData.company_cep && isValidCEPForSearch(companyData.company_cep) && (
                      <p className="text-xs text-gray-500">
                        Cidade e estado serão preenchidos automaticamente
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Estado
                    </label>
                    <select
                      value={companyData.company_estado}
                      onChange={(e) => handleCompanyInputChange('company_estado', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">Selecione o estado</option>
                      {BRAZILIAN_STATES.map((state) => (
                        <option key={state.value} value={state.value}>
                          {state.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Cidade
                    </label>
                    <input
                      type="text"
                      value={companyData.company_cidade}
                      onChange={(e) => handleCompanyInputChange('company_cidade', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Nome da cidade"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Endereço
                    </label>
                    <input
                      type="text"
                      value={companyData.company_endereco}
                      onChange={(e) => handleCompanyInputChange('company_endereco', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Rua, número, bairro"
                    />
                  </div>
                </div>
              </div>

              {/* Contato Empresarial */}
              <div className="space-y-4">
                <h4 className="text-md font-medium text-gray-800 flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  Contato Empresarial
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Telefone da Empresa
                    </label>
                    <input
                      type="tel"
                      value={companyData.company_telefone}
                      onChange={(e) => handleCompanyInputChange('company_telefone', e.target.value)}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                        validationErrors.company_telefone ? 'border-red-300' : 'border-gray-300'
                      }`}
                      placeholder="(00) 00000-0000"
                    />
                    {validationErrors.company_telefone && (
                      <p className="text-sm text-red-600">{validationErrors.company_telefone}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Email Corporativo
                    </label>
                    <input
                      type="email"
                      value={companyData.company_email}
                      onChange={(e) => handleCompanyInputChange('company_email', e.target.value)}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                        validationErrors.company_email ? 'border-red-300' : 'border-gray-300'
                      }`}
                      placeholder="contato@empresa.com"
                    />
                    {validationErrors.company_email && (
                      <p className="text-sm text-red-600">{validationErrors.company_email}</p>
                    )}
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700">
                      <Globe className="w-4 h-4 inline mr-1" />
                      Site
                    </label>
                    <input
                      type="url"
                      value={companyData.company_site}
                      onChange={(e) => handleCompanyInputChange('company_site', e.target.value)}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                        validationErrors.company_site ? 'border-red-300' : 'border-gray-300'
                      }`}
                      placeholder="https://www.empresa.com"
                    />
                    {validationErrors.company_site && (
                      <p className="text-sm text-red-600">{validationErrors.company_site}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Botões */}
          <div className="flex items-center justify-end space-x-3 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {loading ? 'Salvando...' : 'Salvar Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
