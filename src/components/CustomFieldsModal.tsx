import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import {
  X,
  Plus,
  Edit,
  Trash2,
  Save,
  Settings,
  Type,
  Hash,
  Calendar,
  CheckSquare,
  List,
  AlertCircle,
  Copy  // ← ADICIONADO: Ícone para copiar ID
} from 'lucide-react';

interface CustomField {
  id: string;
  numeric_id?: number;  // ← ADICIONADO: ID numérico para sistema híbrido
  field_name: string;
  field_label: string;
  field_type: 'text' | 'number' | 'date' | 'boolean' | 'select';
  options?: any[];
  is_required: boolean;
}

interface CustomFieldsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

export const CustomFieldsModal: React.FC<CustomFieldsModalProps> = ({
  isOpen,
  onClose,
  onSave
}) => {
  const { company } = useAuth();
  const [loading, setLoading] = useState(false);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [formData, setFormData] = useState({
    field_name: '',
    field_label: '',
    field_type: 'text' as 'text' | 'number' | 'date' | 'boolean' | 'select',
    options: [] as string[],
    is_required: false
  });
  const [optionInput, setOptionInput] = useState('');

  useEffect(() => {
    if (isOpen && company?.id) {
      loadCustomFields();
    }
  }, [isOpen, company?.id]);

  const loadCustomFields = async () => {
    if (!company?.id) return;
    
    try {
      setLoading(true);
      const fields = await api.getCustomFields(company.id);
      setCustomFields(fields);
    } catch (error) {
      console.error('Error loading custom fields:', error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      field_name: '',
      field_label: '',
      field_type: 'text',
      options: [],
      is_required: false
    });
    setOptionInput('');
    setEditingField(null);
    setShowCreateForm(false);
  };

  // Função para copiar ID do campo para área de transferência
  const handleCopyId = async (numericId: number) => {
    try {
      await navigator.clipboard.writeText(numericId.toString());
      // Você pode adicionar uma notificação de sucesso aqui se desejar
    } catch (error) {
      console.error('Erro ao copiar ID:', error);
      // Fallback para navegadores mais antigos
      const textArea = document.createElement('textarea');
      textArea.value = numericId.toString();
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  };

  const handleCreateField = () => {
    resetForm();
    setShowCreateForm(true);
  };

  const handleEditField = (field: CustomField) => {
    setFormData({
      field_name: field.field_name,
      field_label: field.field_label,
      field_type: field.field_type,
      options: field.options || [],
      is_required: field.is_required
    });
    setEditingField(field);
    setShowCreateForm(true);
  };

  const handleSubmitField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company?.id) return;

    try {
      setLoading(true);
      
      // Gerar field_name a partir do field_label se não fornecido
      const fieldName = formData.field_name || 
        formData.field_label.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '_');

      const fieldData = {
        ...formData,
        field_name: fieldName,
        company_id: company.id,
        options: formData.field_type === 'select' ? formData.options : undefined
      };

      if (editingField) {
        await api.updateCustomField(editingField.id, fieldData);
      } else {
        await api.createCustomField(fieldData);
      }

      await loadCustomFields();
      resetForm();
    } catch (error) {
      console.error('Error saving custom field:', error);
      alert('Erro ao salvar campo personalizado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteField = async (fieldId: string) => {
    if (!confirm('Tem certeza que deseja excluir este campo? Esta ação não pode ser desfeita.')) {
      return;
    }

    try {
      setLoading(true);
      await api.deleteCustomField(fieldId);
      await loadCustomFields();
    } catch (error) {
      console.error('Error deleting custom field:', error);
      alert('Erro ao excluir campo personalizado.');
    } finally {
      setLoading(false);
    }
  };

  const addOption = () => {
    if (optionInput.trim() && !formData.options.includes(optionInput.trim())) {
      setFormData(prev => ({
        ...prev,
        options: [...prev.options, optionInput.trim()]
      }));
      setOptionInput('');
    }
  };

  const removeOption = (index: number) => {
    setFormData(prev => ({
      ...prev,
      options: prev.options.filter((_, i) => i !== index)
    }));
  };

  const getFieldTypeIcon = (type: string) => {
    switch (type) {
      case 'text': return <Type className="w-4 h-4" />;
      case 'number': return <Hash className="w-4 h-4" />;
      case 'date': return <Calendar className="w-4 h-4" />;
      case 'boolean': return <CheckSquare className="w-4 h-4" />;
      case 'select': return <List className="w-4 h-4" />;
      default: return <Type className="w-4 h-4" />;
    }
  };

  const getFieldTypeLabel = (type: string) => {
    switch (type) {
      case 'text': return 'Texto';
      case 'number': return 'Número';
      case 'date': return 'Data';
      case 'boolean': return 'Sim/Não';
      case 'select': return 'Lista';
      default: return type;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <Settings className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">
              Campos Personalizados
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6">
          {/* Documentação do Sistema Híbrido */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h4 className="text-sm font-medium text-blue-900 mb-2">
              💡 Sistema Híbrido de Campos
            </h4>
            <div className="text-sm text-blue-800 space-y-1">
              <p><strong>Campos padrão:</strong> Use nomes como "nome", "email", "telefone"</p>
              <p><strong>Campos personalizados:</strong> Use o ID numérico no payload (ex: "1": "valor")</p>
              <p><strong>Exemplo de payload:</strong></p>
              <code className="block bg-white p-2 rounded text-xs mt-1">
                {`{ "nome": "João Silva", "email": "joao@email.com", "1": "valor_personalizado" }`}
              </code>
            </div>
          </div>

          {/* Header com botão de criar */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900">
                Gerencie os campos personalizados dos seus leads
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Adicione campos específicos para capturar informações importantes do seu negócio
              </p>
            </div>
            <button
              onClick={handleCreateField}
              disabled={showCreateForm}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Novo Campo
            </button>
          </div>

          {/* Formulário de criação/edição */}
          {showCreateForm && (
            <div className="bg-gray-50 rounded-lg p-6 mb-6">
              <h4 className="text-lg font-medium text-gray-900 mb-4">
                {editingField ? 'Editar Campo' : 'Novo Campo Personalizado'}
              </h4>
              
              <form onSubmit={handleSubmitField} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Nome do Campo *
                    </label>
                    <input
                      type="text"
                      value={formData.field_label}
                      onChange={(e) => setFormData(prev => ({ ...prev, field_label: e.target.value }))}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Ex: Orçamento Disponível"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Tipo do Campo *
                    </label>
                    <select
                      value={formData.field_type}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        field_type: e.target.value as 'text' | 'number' | 'date' | 'boolean' | 'select',
                        options: e.target.value === 'select' ? prev.options : []
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="text">Texto</option>
                      <option value="number">Número</option>
                      <option value="date">Data</option>
                      <option value="boolean">Sim/Não</option>
                      <option value="select">Lista de Opções</option>
                    </select>
                  </div>
                </div>

                {/* Opções para campo select */}
                {formData.field_type === 'select' && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Opções da Lista
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={optionInput}
                        onChange={(e) => setOptionInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addOption())}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Digite uma opção e pressione Enter"
                      />
                      <button
                        type="button"
                        onClick={addOption}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                      >
                        Adicionar
                      </button>
                    </div>
                    
                    {formData.options.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {formData.options.map((option, index) => (
                          <div
                            key={index}
                            className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm"
                          >
                            {option}
                            <button
                              type="button"
                              onClick={() => removeOption(index)}
                              className="text-blue-600 hover:text-blue-800"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="is_required"
                    checked={formData.is_required}
                    onChange={(e) => setFormData(prev => ({ ...prev, is_required: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="is_required" className="text-sm font-medium text-gray-700">
                    Campo obrigatório
                  </label>
                </div>

                <div className="flex items-center justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={resetForm}
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
                    {loading ? 'Salvando...' : 'Salvar Campo'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Lista de campos existentes */}
          <div className="space-y-4">
            <h4 className="text-lg font-medium text-gray-900">
              Campos Existentes ({customFields.length})
            </h4>
            
            {loading && customFields.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : customFields.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 rounded-lg">
                <Settings className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Nenhum campo personalizado
                </h3>
                <p className="text-gray-500 mb-4">
                  Crie campos personalizados para capturar informações específicas dos seus leads.
                </p>
                <button
                  onClick={handleCreateField}
                  className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Criar Primeiro Campo
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {customFields.map((field) => (
                  <div key={field.id} className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {getFieldTypeIcon(field.field_type)}
                          <h5 className="font-medium text-gray-900">
                            {field.numeric_id && (
                              <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-800 mr-2">
                                ID: {field.numeric_id}
                              </span>
                            )}
                            {field.field_label}
                          </h5>
                          {field.is_required && (
                            <span className="text-red-500 text-xs">*</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mb-2">
                          Tipo: {getFieldTypeLabel(field.field_type)}
                        </p>
                        <p className="text-xs text-gray-400 mb-2">
                          Nome interno: {field.field_name}
                        </p>
                        
                        {/* Exemplo de uso no payload */}
                        {field.numeric_id && (
                          <div className="bg-gray-50 rounded-md p-2 mb-2">
                            <p className="text-xs text-gray-600 mb-1">Uso no payload:</p>
                            <code className="text-xs text-blue-600 bg-white px-2 py-1 rounded border">
                              "{field.numeric_id}": "seu_valor_aqui"
                            </code>
                          </div>
                        )}
                        
                        {field.field_type === 'select' && field.options && field.options.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs text-gray-500 mb-1">Opções:</p>
                            <div className="flex flex-wrap gap-1">
                              {field.options.slice(0, 3).map((option, index) => (
                                <span
                                  key={index}
                                  className="inline-block bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs"
                                >
                                  {option}
                                </span>
                              ))}
                              {field.options.length > 3 && (
                                <span className="text-xs text-gray-500">
                                  +{field.options.length - 3} mais
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-1 ml-4">
                        {/* Botão para copiar ID numérico */}
                        {field.numeric_id && (
                          <button
                            onClick={() => handleCopyId(field.numeric_id!)}
                            className="p-1 text-green-600 hover:text-green-800 hover:bg-green-50 rounded transition-colors"
                            title={`Copiar ID: ${field.numeric_id}`}
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleEditField(field)}
                          className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                          title="Editar campo"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteField(field.id)}
                          className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
                          title="Excluir campo"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Aviso sobre exclusão */}
          {customFields.length > 0 && (
            <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                <div className="text-sm text-yellow-800">
                  <p className="font-medium mb-1">Atenção ao excluir campos</p>
                  <p>
                    Ao excluir um campo personalizado, todos os dados associados a ele nos leads existentes serão perdidos permanentemente.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Botões finais */}
          <div className="flex items-center justify-end space-x-3 pt-6 border-t border-gray-200 mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Fechar
            </button>
            <button
              onClick={() => {
                onSave();
                onClose();
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Save className="w-4 h-4" />
              Salvar e Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
