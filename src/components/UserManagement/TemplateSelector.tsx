// =====================================================
// SELETOR DE TEMPLATES - COMPONENTE OPCIONAL
// =====================================================

import React, { useState, useEffect } from 'react';
import { UserTemplate, UserRole } from '../../types/user';
import { getRecommendedTemplates } from '../../services/userTemplates';
import { Crown, Shield, Briefcase, UserCheck, User, Tag, Clock, Users } from 'lucide-react';

interface TemplateSelectorProps {
  companyId: string;
  selectedRole: UserRole;
  selectedTemplate?: UserTemplate | null;
  onSelectTemplate: (template: UserTemplate | null) => void;
  disabled?: boolean;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({
  companyId,
  selectedRole,
  selectedTemplate,
  onSelectTemplate,
  disabled = false
}) => {
  const [templates, setTemplates] = useState<UserTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carregar templates recomendados
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const recommendedTemplates = await getRecommendedTemplates(companyId, selectedRole);
        setTemplates(recommendedTemplates);
        
      } catch (err) {
        console.error('TemplateSelector: Error loading templates:', err);
        setError('Erro ao carregar templates');
        setTemplates([]);
      } finally {
        setLoading(false);
      }
    };

    if (companyId && selectedRole) {
      loadTemplates();
    }
  }, [companyId, selectedRole]);

  // Ícone do role base
  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'super_admin':
        return <Crown className="w-4 h-4 text-purple-600" />;
      case 'support':
        return <Shield className="w-4 h-4 text-green-600" />;
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

  // Nome do role em português
  const getRoleName = (role: UserRole): string => {
    switch (role) {
      case 'super_admin':
        return 'Super Admin';
      case 'support':
        return 'Suporte';
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

  if (loading) {
    return (
      <div className="space-y-3">
        <label className="block text-sm font-medium text-slate-700">
          Template de Perfil
        </label>
        <div className="animate-pulse">
          <div className="h-20 bg-slate-200 rounded-lg"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <label className="block text-sm font-medium text-slate-700">
          Template de Perfil
        </label>
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-slate-700">
        Template de Perfil
        <span className="text-xs text-slate-500 ml-2">(Opcional)</span>
      </label>
      
      <div className="space-y-3">
        {/* Opção: Sem template (padrão) */}
        <div
          className={`cursor-pointer border-2 rounded-lg p-4 transition-all ${
            !selectedTemplate
              ? 'border-blue-500 bg-blue-50'
              : 'border-slate-200 hover:border-slate-300'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          onClick={() => !disabled && onSelectTemplate(null)}
        >
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0 mt-1">
              {getRoleIcon(selectedRole)}
            </div>
            <div className="flex-1">
              <h4 className="font-medium text-slate-900">
                {getRoleName(selectedRole)} Padrão
              </h4>
              <p className="text-sm text-slate-600 mt-1">
                Usar permissões padrão do role {getRoleName(selectedRole).toLowerCase()}
              </p>
              <div className="flex items-center space-x-4 mt-2 text-xs text-slate-500">
                <span className="flex items-center space-x-1">
                  <Tag className="w-3 h-3" />
                  <span>Sistema</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Templates disponíveis */}
        {templates.map((template) => (
          <div
            key={template.id}
            className={`cursor-pointer border-2 rounded-lg p-4 transition-all ${
              selectedTemplate?.id === template.id
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-200 hover:border-slate-300'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={() => !disabled && onSelectTemplate(template)}
          >
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 mt-1">
                {getRoleIcon(template.baseRole)}
              </div>
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <h4 className="font-medium text-slate-900">
                    {template.name}
                  </h4>
                  {template.isSystem && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                      Sistema
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-600 mt-1">
                  {template.description}
                </p>
                
                {/* Metadados do template */}
                <div className="flex items-center space-x-4 mt-2 text-xs text-slate-500">
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
                  
                  {template.last_used && (
                    <span className="flex items-center space-x-1">
                      <Clock className="w-3 h-3" />
                      <span>
                        Usado em {new Date(template.last_used).toLocaleDateString('pt-BR')}
                      </span>
                    </span>
                  )}
                </div>

                {/* Tags do template */}
                {template.tags && template.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {template.tags.map((tag, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Mensagem quando não há templates */}
        {templates.length === 0 && (
          <div className="text-center py-8 text-slate-500">
            <User className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="text-sm">
              Nenhum template disponível para o role {getRoleName(selectedRole).toLowerCase()}
            </p>
            <p className="text-xs mt-1">
              Use as permissões padrão ou crie um template personalizado
            </p>
          </div>
        )}
      </div>

      {/* Informação sobre templates */}
      <div className="bg-slate-50 rounded-lg p-3">
        <div className="flex items-start space-x-2">
          <div className="flex-shrink-0">
            <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center">
              <span className="text-xs font-medium text-blue-600">i</span>
            </div>
          </div>
          <div className="text-xs text-slate-600">
            <p className="font-medium mb-1">Sobre Templates:</p>
            <ul className="space-y-1">
              <li>• Templates aplicam permissões personalizadas sobre o role base</li>
              <li>• Templates do sistema não podem ser editados</li>
              <li>• Você pode criar templates personalizados para sua empresa</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
