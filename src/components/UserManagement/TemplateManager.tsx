// =====================================================
// GESTÃO DE TEMPLATES - INTERFACE COMPLETA
// =====================================================

import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Copy, Users, Crown, Shield, Briefcase, UserCheck, User, Tag, Clock, Eye } from 'lucide-react';
import { UserTemplate, UserRole, CreateTemplateRequest } from '../../types/user';
import { getCompanyTemplates, createUserTemplate, deactivateTemplate } from '../../services/userTemplates';
import { useAuth } from '../../contexts/AuthContext';
import { TemplateModal } from './TemplateModal';
import { PermissionsViewModal } from './PermissionsViewModal';

interface TemplateManagerProps {
  onCreateUser?: (templateId?: string) => void;
}

export const TemplateManager: React.FC<TemplateManagerProps> = ({ onCreateUser }) => {
  const { company } = useAuth();
  const [templates, setTemplates] = useState<UserTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<UserTemplate | null>(null);
  const [viewingTemplate, setViewingTemplate] = useState<UserTemplate | null>(null); // NOVO: Template sendo visualizado

  // Carregar templates
  const loadTemplates = async () => {
    if (!company?.id) return;
    
    try {
      setLoading(true);
      setError(null);
      
      // NOVO: Passar tipo de empresa para filtragem de segurança
      const companyTemplates = await getCompanyTemplates(company.id, company.company_type);
      setTemplates(companyTemplates);
      
    } catch (err) {
      console.error('TemplateManager: Error loading templates:', err);
      setError('Erro ao carregar templates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, [company?.id]);

  // Ícone do role
  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'super_admin':
        return <Crown className="w-4 h-4 text-purple-600" />;
      case 'admin':
        return <Shield className="w-4 h-4 text-blue-600" />;
      case 'partner':
        return <Briefcase className="w-4 h-4 text-green-600" />;
      case 'manager':
        return <UserCheck className="w-4 h-4 text-orange-600" />;
      case 'seller':
        return <User className="w-4 h-4 text-gray-600" />;
      default:
        return <User className="w-4 h-4 text-gray-400" />;
    }
  };

  // Nome do role
  const getRoleName = (role: UserRole): string => {
    switch (role) {
      case 'super_admin':
        return 'Super Admin';
      case 'admin':
        return 'Administrador';
      case 'partner':
        return 'Parceiro';
      case 'manager':
        return 'Gerente';
      case 'seller':
        return 'Vendedor';
      default:
        return 'Usuário';
    }
  };

  // Criar usuário com template
  const handleCreateUserWithTemplate = (templateId: string) => {
    if (onCreateUser) {
      onCreateUser(templateId);
    }
  };

  // Duplicar template
  const handleDuplicateTemplate = async (template: UserTemplate) => {
    try {
      const duplicateRequest: CreateTemplateRequest = {
        name: `${template.name} (Cópia)`,
        description: `Cópia de: ${template.description}`,
        baseRole: template.baseRole,
        customPermissions: template.customPermissions,
        companyId: company!.id,
        tags: [...(template.tags || []), 'cópia']
      };

      await createUserTemplate(duplicateRequest);
      await loadTemplates();
      
    } catch (error) {
      console.error('Error duplicating template:', error);
      setError('Erro ao duplicar template');
    }
  };

  // Desativar template
  const handleDeactivateTemplate = async (templateId: string) => {
    if (!confirm('Tem certeza que deseja desativar este template?')) return;
    
    try {
      await deactivateTemplate(templateId);
      await loadTemplates();
    } catch (error) {
      console.error('Error deactivating template:', error);
      setError('Erro ao desativar template');
    }
  };

  // Separar templates por tipo
  const systemTemplates = templates.filter(t => t.isSystem);
  const customTemplates = templates.filter(t => !t.isSystem);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-900">Templates de Usuário</h2>
        </div>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-slate-200 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Templates de Usuário</h2>
          <p className="text-slate-600 mt-1">
            Gerencie templates de perfil para criação rápida de usuários
          </p>
        </div>
        
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Template
        </button>
      </div>

      {/* Erro */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600">{error}</p>
        </div>
      )}

      {/* Templates do Sistema */}
      <div className="space-y-4">
        <div className="flex items-center space-x-2">
          <h3 className="text-lg font-semibold text-slate-900">Templates do Sistema</h3>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
            Predefinidos
          </span>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {systemTemplates.map((template) => (
            <div key={template.id} className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-2">
                  {getRoleIcon(template.baseRole)}
                  <h4 className="font-medium text-slate-900">{template.name}</h4>
                </div>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                  Sistema
                </span>
              </div>
              
              <p className="text-sm text-slate-600 mb-3">{template.description}</p>
              
              <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
                <span className="flex items-center space-x-1">
                  <Tag className="w-3 h-3" />
                  <span>Base: {getRoleName(template.baseRole)}</span>
                </span>
                {template.usage_count && (
                  <span className="flex items-center space-x-1">
                    <Users className="w-3 h-3" />
                    <span>{template.usage_count} usos</span>
                  </span>
                )}
              </div>

              {/* Tags */}
              {template.tags && template.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {template.tags.slice(0, 3).map((tag, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700"
                    >
                      {tag}
                    </span>
                  ))}
                  {template.tags.length > 3 && (
                    <span className="text-xs text-slate-500">+{template.tags.length - 3}</span>
                  )}
                </div>
              )}

              {/* Ações */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleCreateUserWithTemplate(template.id)}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors"
                >
                  Usar Template
                </button>
                <button
                  onClick={() => setViewingTemplate(template)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                  title="Visualizar permissões"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDuplicateTemplate(template)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                  title="Duplicar template"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Templates Personalizados */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h3 className="text-lg font-semibold text-slate-900">Templates Personalizados</h3>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
              {customTemplates.length} templates
            </span>
          </div>
        </div>

        {customTemplates.length === 0 ? (
          <div className="text-center py-12 bg-slate-50 rounded-lg border-2 border-dashed border-slate-300">
            <Users className="w-12 h-12 mx-auto mb-4 text-slate-400" />
            <h3 className="text-lg font-medium text-slate-900 mb-2">Nenhum template personalizado</h3>
            <p className="text-slate-600 mb-4">
              Crie templates personalizados para agilizar a criação de usuários
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              Criar Primeiro Template
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {customTemplates.map((template) => (
              <div key={template.id} className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    {getRoleIcon(template.baseRole)}
                    <h4 className="font-medium text-slate-900">{template.name}</h4>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                    Personalizado
                  </span>
                </div>
                
                <p className="text-sm text-slate-600 mb-3">{template.description}</p>
                
                <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
                  <span className="flex items-center space-x-1">
                    <Tag className="w-3 h-3" />
                    <span>Base: {getRoleName(template.baseRole)}</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(template.created_at).toLocaleDateString('pt-BR')}</span>
                  </span>
                </div>

                {/* Tags */}
                {template.tags && template.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {template.tags.slice(0, 3).map((tag, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700"
                      >
                        {tag}
                      </span>
                    ))}
                    {template.tags.length > 3 && (
                      <span className="text-xs text-slate-500">+{template.tags.length - 3}</span>
                    )}
                  </div>
                )}

                {/* Ações */}
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleCreateUserWithTemplate(template.id)}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors"
                  >
                    Usar Template
                  </button>
                  <button
                    onClick={() => setViewingTemplate(template)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                    title="Visualizar permissões"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setEditingTemplate(template)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                    title="Editar template"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDuplicateTemplate(template)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                    title="Duplicar template"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeactivateTemplate(template.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="Desativar template"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Informações */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start space-x-2">
          <div className="flex-shrink-0">
            <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center">
              <span className="text-xs font-medium text-blue-600">i</span>
            </div>
          </div>
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">Sobre Templates:</p>
            <ul className="space-y-1 text-xs">
              <li>• Templates do sistema não podem ser editados, apenas duplicados</li>
              <li>• Templates personalizados podem ser editados e desativados</li>
              <li>• Ao usar um template, as permissões são aplicadas sobre o role base</li>
              <li>• Templates facilitam a criação consistente de usuários</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Modal de Template */}
      <TemplateModal
        isOpen={showCreateModal || !!editingTemplate}
        onClose={() => {
          setShowCreateModal(false);
          setEditingTemplate(null);
        }}
        onSave={loadTemplates}
        template={editingTemplate}
      />

      {/* Modal de Visualização de Permissões */}
      <PermissionsViewModal
        isOpen={!!viewingTemplate}
        onClose={() => setViewingTemplate(null)}
        profile={viewingTemplate}
      />
    </div>
  );
};
