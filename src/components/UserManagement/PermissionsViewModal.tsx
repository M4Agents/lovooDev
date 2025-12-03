// =====================================================
// MODAL DE VISUALIZAÇÃO DE PERMISSÕES
// =====================================================

import React from 'react';
import { X, Eye, Shield, Check, X as XIcon, Crown, Briefcase, UserCheck, User, Settings } from 'lucide-react';
import { UserProfile, UserTemplate, UserPermissions, UserRole } from '../../types/user';
import { useAuth } from '../../contexts/AuthContext';
import { canAccessCriticalPermissions, filterCriticalPermissions } from '../../utils/permissionUtils';

interface PermissionsViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile | UserTemplate | null;
}

export const PermissionsViewModal: React.FC<PermissionsViewModalProps> = ({ 
  isOpen, 
  onClose, 
  profile 
}) => {
  const { company } = useAuth();
  
  if (!isOpen || !profile) return null;

  // Extrair permissões do perfil ou template
  let permissions: UserPermissions = 'permissions' in profile 
    ? profile.permissions 
    : {
        // Para templates, combinar role base + customizações
        dashboard: true,
        leads: true,
        chat: true,
        analytics: false,
        settings: false,
        companies: false,
        users: false,
        financial: false,
        create_users: false,
        edit_users: false,
        delete_users: false,
        impersonate: false,
        view_all_leads: false,
        edit_all_leads: false,
        view_financial: false,
        edit_financial: false,
        ...('customPermissions' in profile ? profile.customPermissions : {})
      };

  // Obter role para filtragem e exibição
  const role: UserRole = 'legacyRole' in profile 
    ? (profile.legacyRole || 'seller')
    : 'baseRole' in profile 
    ? (profile.baseRole || 'seller')
    : 'seller';

  // NOVO: Filtrar permissões críticas baseado no contexto de segurança
  const canViewCritical = canAccessCriticalPermissions(
    company?.company_type,
    role,
    company?.is_super_admin
  );

  if (!canViewCritical) {
    // Filtrar permissões críticas para visualização
    permissions = filterCriticalPermissions(
      permissions,
      company?.company_type,
      role,
      company?.is_super_admin
    );
  }

  // Ícone do role
  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'super_admin':
        return <Crown className="w-4 h-4 text-yellow-500" />;
      case 'admin':
        return <Shield className="w-4 h-4 text-blue-500" />;
      case 'partner':
        return <Briefcase className="w-4 h-4 text-purple-500" />;
      case 'manager':
        return <UserCheck className="w-4 h-4 text-green-500" />;
      case 'seller':
        return <User className="w-4 h-4 text-slate-500" />;
      default:
        return <User className="w-4 h-4 text-slate-500" />;
    }
  };

  // Componente para mostrar permissão
  const PermissionItem: React.FC<{ 
    label: string; 
    value: boolean | undefined; 
    description?: string 
  }> = ({ label, value, description }) => (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50">
      <div className="flex-1">
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium text-slate-700">{label}</span>
          {description && (
            <span className="text-xs text-slate-500">({description})</span>
          )}
        </div>
      </div>
      <div className="flex items-center">
        {value ? (
          <Check className="w-4 h-4 text-green-500" />
        ) : (
          <XIcon className="w-4 h-4 text-red-400" />
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Eye className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Visualizar Permissões
              </h2>
              <p className="text-sm text-slate-500">
                Detalhes completos do perfil de acesso
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {/* Informações do Perfil */}
          <div className="mb-6 p-4 bg-slate-50 rounded-lg">
            <div className="flex items-center space-x-3 mb-3">
              {getRoleIcon(role)}
              <div>
                <h3 className="font-semibold text-slate-900">{profile.name}</h3>
                <p className="text-sm text-slate-600">{profile.description}</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium text-slate-700">Tipo:</span>
                <span className="ml-2 text-slate-600">
                  {'isSystem' in profile && profile.isSystem ? 'Sistema' : 'Personalizado'}
                </span>
              </div>
              <div>
                <span className="font-medium text-slate-700">Role Base:</span>
                <span className="ml-2 text-slate-600 capitalize">{role}</span>
              </div>
            </div>

            {/* Tags */}
            {'tags' in profile && profile.tags && profile.tags.length > 0 && (
              <div className="mt-3">
                <span className="font-medium text-slate-700 text-sm">Tags:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {profile.tags.map((tag, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Módulos Principais */}
          <div className="mb-6">
            <h4 className="flex items-center space-x-2 text-base font-semibold text-slate-900 mb-3">
              <Settings className="w-4 h-4" />
              <span>Módulos Principais</span>
            </h4>
            <div className="space-y-1 bg-white border border-slate-200 rounded-lg">
              <PermissionItem label="Dashboard" value={permissions.dashboard} description="Painel principal" />
              <PermissionItem label="Leads" value={permissions.leads} description="Gestão de leads" />
              <PermissionItem label="Chat" value={permissions.chat} description="Sistema de chat" />
              <PermissionItem label="Analytics" value={permissions.analytics} description="Relatórios e métricas" />
              <PermissionItem label="Configurações" value={permissions.settings} description="Configurações gerais" />
              <PermissionItem label="Empresas" value={permissions.companies} description="Gestão de empresas" />
              <PermissionItem label="Usuários" value={permissions.users} description="Gestão de usuários" />
              <PermissionItem label="Financeiro" value={permissions.financial} description="Módulo financeiro" />
            </div>
          </div>

          {/* Ações Específicas */}
          <div className="mb-6">
            <h4 className="flex items-center space-x-2 text-base font-semibold text-slate-900 mb-3">
              <Shield className="w-4 h-4" />
              <span>Ações Específicas</span>
            </h4>
            <div className="space-y-1 bg-white border border-slate-200 rounded-lg">
              <PermissionItem label="Criar usuários" value={permissions.create_users} />
              <PermissionItem label="Editar usuários" value={permissions.edit_users} />
              <PermissionItem label="Deletar usuários" value={permissions.delete_users} />
              <PermissionItem label="Impersonar empresas" value={permissions.impersonate} />
              <PermissionItem label="Ver todos os leads" value={permissions.view_all_leads} />
              <PermissionItem label="Editar todos os leads" value={permissions.edit_all_leads} />
              <PermissionItem label="Ver dados financeiros" value={permissions.view_financial} />
              <PermissionItem label="Editar dados financeiros" value={permissions.edit_financial} />
            </div>
          </div>

          {/* Limitações */}
          <div>
            <h4 className="flex items-center space-x-2 text-base font-semibold text-slate-900 mb-3">
              <Shield className="w-4 h-4" />
              <span>Limitações</span>
            </h4>
            <div className="space-y-3 bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-slate-700">Máximo de empresas:</span>
                <span className="text-sm text-slate-600">
                  {permissions.max_companies || 'Ilimitado'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-slate-700">Máximo de usuários:</span>
                <span className="text-sm text-slate-600">
                  {permissions.max_users || 'Ilimitado'}
                </span>
              </div>
              {permissions.restricted_companies && permissions.restricted_companies.length > 0 && (
                <div>
                  <span className="text-sm font-medium text-slate-700">Empresas restritas:</span>
                  <div className="mt-1 text-sm text-slate-600">
                    {permissions.restricted_companies.length} empresa(s) com acesso restrito
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end p-6 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
