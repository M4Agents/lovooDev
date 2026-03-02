// =====================================================
// MODAL DE TEMPLATE - CRIAÇÃO/EDIÇÃO
// =====================================================

import React, { useState, useEffect } from 'react';
import { X, Save, Crown, Shield, Briefcase, UserCheck, User, Tag } from 'lucide-react';
import { UserTemplate, UserRole, CreateTemplateRequest, UpdateTemplateRequest, UserPermissions } from '../../types/user';
import { createUserTemplate, updateUserTemplate } from '../../services/userTemplates';
import { getDefaultPermissions } from '../../services/userApi';
import { useAuth } from '../../contexts/AuthContext';
import { AdvancedPermissions } from './AdvancedPermissions';

interface TemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  template?: UserTemplate | null;
}

export const TemplateModal: React.FC<TemplateModalProps> = ({ 
  isOpen, 
  onClose, 
  onSave, 
  template 
}) => {
  const { company } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    baseRole: 'seller' as UserRole,
    tags: [] as string[]
  });
  
  const [customPermissions, setCustomPermissions] = useState<Partial<UserPermissions>>({});
  const [newTag, setNewTag] = useState('');

  const isEditing = !!template;

  // Reset form quando modal abre/fecha
  useEffect(() => {
    if (isOpen) {
      if (template) {
        // Modo edição
        setFormData({
          name: template.name,
          description: template.description,
          baseRole: template.baseRole,
          tags: template.tags || []
        });
        setCustomPermissions(template.customPermissions);
      } else {
        // Modo criação
        setFormData({
          name: '',
          description: '',
          baseRole: 'seller',
          tags: []
        });
        setCustomPermissions({});
      }
      setError(null);
      setNewTag('');
    }
  }, [isOpen, template]);

  // Roles disponíveis baseados no tipo de empresa
  const getAvailableRoles = (): { value: UserRole; label: string; description: string; icon: React.ReactNode }[] => {
    const companyType = company?.company_type || 'client';
    
    if (companyType === 'parent') {
      return [
        { 
          value: 'super_admin', 
          label: 'Super Admin', 
          description: 'Acesso total ao sistema',
          icon: <Crown className="w-4 h-4 text-purple-600" />
        },
        { 
          value: 'admin', 
          label: 'Administrador', 
          description: 'Gerencia empresas filhas',
          icon: <Shield className="w-4 h-4 text-blue-600" />
        },
        { 
          value: 'partner', 
          label: 'Parceiro', 
          description: 'Gerencia próprias contas',
          icon: <Briefcase className="w-4 h-4 text-green-600" />
        }
      ];
    } else {
      return [
        { 
          value: 'admin', 
          label: 'Administrador', 
          description: 'Configurações da empresa',
          icon: <Shield className="w-4 h-4 text-blue-600" />
        },
        { 
          value: 'manager', 
          label: 'Gerente', 
          description: 'Gestão de leads e vendas',
          icon: <UserCheck className="w-4 h-4 text-orange-600" />
        },
        { 
          value: 'seller', 
          label: 'Vendedor', 
          description: 'Leads próprios e chat',
          icon: <User className="w-4 h-4 text-gray-600" />
        }
      ];
    }
  };

  // Atualizar permissões quando role base muda
  useEffect(() => {
    const defaultPermissions = getDefaultPermissions(formData.baseRole);
    setCustomPermissions(defaultPermissions);
  }, [formData.baseRole]);

  // Adicionar tag
  const handleAddTag = () => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, newTag.trim()]
      }));
      setNewTag('');
    }
  };

  // Remover tag
  const handleRemoveTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  // Salvar template
  const handleSave = async () => {
    try {
      setLoading(true);
      setError(null);

      // Validações
      if (!formData.name.trim()) {
        setError('Nome é obrigatório');
        return;
      }

      if (!formData.description.trim()) {
        setError('Descrição é obrigatória');
        return;
      }

      if (!company?.id) {
        setError('Empresa não identificada');
        return;
      }

      if (isEditing && template) {
        // Atualizar template existente
        const updateRequest: UpdateTemplateRequest = {
          id: template.id,
          name: formData.name.trim(),
          description: formData.description.trim(),
          customPermissions,
          tags: formData.tags
        };

        await updateUserTemplate(updateRequest);
      } else {
        // Criar novo template
        const createRequest: CreateTemplateRequest = {
          name: formData.name.trim(),
          description: formData.description.trim(),
          baseRole: formData.baseRole,
          customPermissions,
          companyId: company.id,
          tags: formData.tags
        };

        await createUserTemplate(createRequest);
      }

      onSave();
      onClose();
      
    } catch (err) {
      console.error('TemplateModal: Error saving template:', err);
      setError(err instanceof Error ? err.message : 'Erro ao salvar template');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              {isEditing ? 'Editar Template' : 'Novo Template'}
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              {isEditing ? 'Modifique as configurações do template' : 'Crie um template personalizado para usuários'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            disabled={loading}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="space-y-6">
            {/* Erro */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-600">{error}</p>
              </div>
            )}

            {/* Informações Básicas */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-slate-900">Informações Básicas</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Nome */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Nome do Template *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Ex: Vendedor Experiente"
                    disabled={loading}
                  />
                </div>

                {/* Role Base */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Role Base *
                  </label>
                  <select
                    value={formData.baseRole}
                    onChange={(e) => setFormData(prev => ({ ...prev, baseRole: e.target.value as UserRole }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    disabled={loading || isEditing} // Não permitir alterar role base em edição
                  >
                    {getAvailableRoles().map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label} - {role.description}
                      </option>
                    ))}
                  </select>
                  {isEditing && (
                    <p className="text-xs text-slate-500 mt-1">
                      Role base não pode ser alterado após criação
                    </p>
                  )}
                </div>
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Descrição *
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Descreva o propósito e características deste template..."
                  disabled={loading}
                />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Tags (opcional)
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {formData.tags.map((tag, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded-md"
                    >
                      <Tag className="w-3 h-3" />
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="text-blue-600 hover:text-blue-800"
                        disabled={loading}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Digite uma tag e pressione Enter"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={handleAddTag}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                    disabled={loading || !newTag.trim()}
                  >
                    Adicionar
                  </button>
                </div>
              </div>
            </div>

            {/* Permissões Personalizadas */}
            <div className="border-t border-slate-200 pt-6">
              <AdvancedPermissions
                permissions={customPermissions}
                onChange={setCustomPermissions}
                disabled={loading}
                showAdvanced={true}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-700 hover:text-slate-900 transition-colors"
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={loading || !formData.name.trim() || !formData.description.trim()}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isEditing ? 'Salvar Alterações' : 'Criar Template'}
          </button>
        </div>
      </div>
    </div>
  );
};
