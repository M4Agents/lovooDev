import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import {
  X,
  Save,
  User,
  Mail,
  Phone,
  Building,
  Tag,
  FileText,
  Calendar,
  CheckSquare,
  Type,
  Hash,
  List
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
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>({});

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
        setCustomFieldValues({});
      }
    }
  }, [isOpen, lead, company?.id]);

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

    setLoading(true);
    try {
      const leadData = {
        ...formData,
        company_id: company.id,
        custom_fields: customFieldValues
      };

      if (lead?.id) {
        // Edição
        await api.updateLead(lead.id, leadData);
      } else {
        // Criação
        await api.createLead(leadData);
      }

      onSave();
      onClose();
    } catch (error) {
      console.error('Error saving lead:', error);
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

  const handleCustomFieldChange = (fieldId: string, value: any) => {
    setCustomFieldValues(prev => ({
      ...prev,
      [fieldId]: value
    }));
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

      case 'number':
        return (
          <div key={field.id} className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              <Hash className="w-4 h-4 inline mr-1" />
              {field.field_label}
              {field.is_required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              type="number"
              value={value}
              onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
              required={field.is_required}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder={`Digite ${field.field_label.toLowerCase()}`}
            />
          </div>
        );

      case 'date':
        return (
          <div key={field.id} className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              <Calendar className="w-4 h-4 inline mr-1" />
              {field.field_label}
              {field.is_required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              type="date"
              value={value}
              onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
              required={field.is_required}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        );

      case 'boolean':
        return (
          <div key={field.id} className="space-y-2">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={value === 'true' || value === true}
                onChange={(e) => handleCustomFieldChange(field.id, e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">
                <CheckSquare className="w-4 h-4 inline mr-1" />
                {field.field_label}
                {field.is_required && <span className="text-red-500 ml-1">*</span>}
              </span>
            </label>
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
          {/* Dados Básicos */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
              Dados Básicos
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
