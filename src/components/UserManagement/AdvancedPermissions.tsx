// =====================================================
// SELETOR AVANÇADO DE PERMISSÕES - COMPONENTE OPCIONAL
// =====================================================

import React, { useState } from 'react';
import { UserPermissions } from '../../types/user';
import { ChevronDown, ChevronRight, Shield, Settings, Zap, BarChart3, Users, DollarSign, Eye, EyeOff } from 'lucide-react';

interface AdvancedPermissionsProps {
  permissions: Partial<UserPermissions>;
  onChange: (permissions: Partial<UserPermissions>) => void;
  disabled?: boolean;
  showAdvanced?: boolean;
}

interface PermissionGroup {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  permissions: Array<{
    key: keyof UserPermissions;
    name: string;
    description: string;
    type: 'boolean' | 'number';
    min?: number;
    max?: number;
  }>;
}

export const AdvancedPermissions: React.FC<AdvancedPermissionsProps> = ({
  permissions,
  onChange,
  disabled = false,
  showAdvanced = false
}) => {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['core']));
  const [showLimits, setShowLimits] = useState(false);

  // Definir grupos de permissões
  const permissionGroups: PermissionGroup[] = [
    {
      id: 'core',
      name: 'Módulos Principais',
      icon: <Shield className="w-4 h-4" />,
      color: 'blue',
      permissions: [
        {
          key: 'dashboard',
          name: 'Dashboard',
          description: 'Acesso ao painel principal',
          type: 'boolean'
        },
        {
          key: 'leads',
          name: 'Gestão de Leads',
          description: 'Acesso ao módulo de leads',
          type: 'boolean'
        },
        {
          key: 'chat',
          name: 'Chat e Comunicação',
          description: 'Acesso ao sistema de chat',
          type: 'boolean'
        },
        {
          key: 'analytics',
          name: 'Analytics',
          description: 'Acesso a relatórios e análises',
          type: 'boolean'
        }
      ]
    },
    {
      id: 'leads_actions',
      name: 'Ações com Leads',
      icon: <Zap className="w-4 h-4" />,
      color: 'green',
      permissions: [
        {
          key: 'create_leads',
          name: 'Criar Leads',
          description: 'Permite criar novos leads',
          type: 'boolean'
        },
        {
          key: 'edit_own_leads',
          name: 'Editar Próprios Leads',
          description: 'Permite editar leads próprios',
          type: 'boolean'
        },
        {
          key: 'edit_team_leads',
          name: 'Editar Leads da Equipe',
          description: 'Permite editar leads de outros membros',
          type: 'boolean'
        },
        {
          key: 'edit_all_leads',
          name: 'Editar Todos os Leads',
          description: 'Permite editar qualquer lead da empresa',
          type: 'boolean'
        },
        {
          key: 'delete_leads',
          name: 'Excluir Leads',
          description: 'Permite excluir leads',
          type: 'boolean'
        },
        {
          key: 'export_leads',
          name: 'Exportar Leads',
          description: 'Permite exportar dados de leads',
          type: 'boolean'
        },
        {
          key: 'import_leads',
          name: 'Importar Leads',
          description: 'Permite importar leads em massa',
          type: 'boolean'
        }
      ]
    },
    {
      id: 'chat_actions',
      name: 'Comunicação',
      icon: <BarChart3 className="w-4 h-4" />,
      color: 'purple',
      permissions: [
        {
          key: 'chat_own_leads',
          name: 'Chat com Próprios Leads',
          description: 'Conversar com leads próprios',
          type: 'boolean'
        },
        {
          key: 'chat_all_leads',
          name: 'Chat com Todos os Leads',
          description: 'Conversar com qualquer lead',
          type: 'boolean'
        },
        {
          key: 'chat_templates',
          name: 'Usar Templates',
          description: 'Usar templates de mensagem',
          type: 'boolean'
        },
        {
          key: 'bulk_messaging',
          name: 'Mensagens em Massa',
          description: 'Enviar mensagens para múltiplos leads',
          type: 'boolean'
        }
      ]
    },
    {
      id: 'admin',
      name: 'Administração',
      icon: <Users className="w-4 h-4" />,
      color: 'orange',
      permissions: [
        {
          key: 'settings',
          name: 'Configurações',
          description: 'Acesso às configurações da empresa',
          type: 'boolean'
        },
        {
          key: 'users',
          name: 'Gestão de Usuários',
          description: 'Acesso à gestão de usuários',
          type: 'boolean'
        },
        {
          key: 'create_users',
          name: 'Criar Usuários',
          description: 'Permite criar novos usuários',
          type: 'boolean'
        },
        {
          key: 'edit_users',
          name: 'Editar Usuários',
          description: 'Permite editar usuários existentes',
          type: 'boolean'
        },
        {
          key: 'delete_users',
          name: 'Excluir Usuários',
          description: 'Permite excluir usuários',
          type: 'boolean'
        },
        {
          key: 'companies',
          name: 'Gestão de Empresas',
          description: 'Acesso à gestão de empresas',
          type: 'boolean'
        },
        {
          key: 'impersonate',
          name: 'Impersonar Usuários',
          description: 'Permite acessar outras empresas',
          type: 'boolean'
        }
      ]
    },
    {
      id: 'financial',
      name: 'Financeiro',
      icon: <DollarSign className="w-4 h-4" />,
      color: 'red',
      permissions: [
        {
          key: 'financial',
          name: 'Módulo Financeiro',
          description: 'Acesso ao módulo financeiro',
          type: 'boolean'
        },
        {
          key: 'view_financial',
          name: 'Ver Dados Financeiros',
          description: 'Visualizar informações financeiras',
          type: 'boolean'
        },
        {
          key: 'edit_financial',
          name: 'Editar Dados Financeiros',
          description: 'Editar informações financeiras',
          type: 'boolean'
        }
      ]
    }
  ];

  // Grupos de limitações
  const limitGroups = [
    {
      id: 'limits',
      name: 'Limitações',
      permissions: [
        {
          key: 'max_leads_per_month' as keyof UserPermissions,
          name: 'Máximo de Leads por Mês',
          description: 'Limite mensal de leads',
          type: 'number' as const,
          min: 0,
          max: 10000
        },
        {
          key: 'max_exports_per_day' as keyof UserPermissions,
          name: 'Máximo de Exportações por Dia',
          description: 'Limite diário de exportações',
          type: 'number' as const,
          min: 0,
          max: 100
        }
      ]
    }
  ];

  // Toggle grupo expandido
  const toggleGroup = (groupId: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
    }
    setExpandedGroups(newExpanded);
  };

  // Atualizar permissão
  const updatePermission = (key: keyof UserPermissions, value: boolean | number) => {
    onChange({
      ...permissions,
      [key]: value
    });
  };

  // Cor do grupo
  const getGroupColor = (color: string) => {
    const colors = {
      blue: 'text-blue-600 bg-blue-100',
      green: 'text-green-600 bg-green-100',
      purple: 'text-purple-600 bg-purple-100',
      orange: 'text-orange-600 bg-orange-100',
      red: 'text-red-600 bg-red-100'
    };
    return colors[color as keyof typeof colors] || 'text-gray-600 bg-gray-100';
  };

  if (!showAdvanced) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-slate-900">
          Permissões Avançadas
        </h3>
        <button
          type="button"
          onClick={() => setShowLimits(!showLimits)}
          className="flex items-center space-x-1 text-sm text-slate-600 hover:text-slate-800"
          disabled={disabled}
        >
          {showLimits ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          <span>{showLimits ? 'Ocultar' : 'Mostrar'} Limitações</span>
        </button>
      </div>

      <div className="space-y-3">
        {/* Grupos de permissões principais */}
        {permissionGroups.map((group) => (
          <div key={group.id} className="border border-slate-200 rounded-lg">
            <button
              type="button"
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
              onClick={() => toggleGroup(group.id)}
              disabled={disabled}
            >
              <div className="flex items-center space-x-3">
                <div className={`p-1.5 rounded ${getGroupColor(group.color)}`}>
                  {group.icon}
                </div>
                <span className="font-medium text-slate-900">{group.name}</span>
                <span className="text-xs text-slate-500">
                  ({group.permissions.filter(p => permissions[p.key]).length}/{group.permissions.length})
                </span>
              </div>
              {expandedGroups.has(group.id) ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {expandedGroups.has(group.id) && (
              <div className="px-4 pb-4 space-y-3">
                {group.permissions.map((permission) => (
                  <div key={permission.key} className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <label className="text-sm font-medium text-slate-700">
                          {permission.name}
                        </label>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {permission.description}
                      </p>
                    </div>
                    <div className="flex-shrink-0 ml-4">
                      {permission.type === 'boolean' ? (
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={!!permissions[permission.key]}
                            onChange={(e) => updatePermission(permission.key, e.target.checked)}
                            disabled={disabled}
                          />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                      ) : (
                        <input
                          type="number"
                          className="w-20 px-2 py-1 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          value={permissions[permission.key] as number || permission.min || 0}
                          onChange={(e) => updatePermission(permission.key, parseInt(e.target.value) || 0)}
                          min={permission.min}
                          max={permission.max}
                          disabled={disabled}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Grupos de limitações */}
        {showLimits && limitGroups.map((group) => (
          <div key={group.id} className="border border-slate-200 rounded-lg">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <div className="flex items-center space-x-3">
                <Settings className="w-4 h-4 text-slate-600" />
                <span className="font-medium text-slate-900">{group.name}</span>
              </div>
            </div>
            <div className="px-4 py-4 space-y-3">
              {group.permissions.map((permission) => (
                <div key={permission.key} className="flex items-center justify-between">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-slate-700">
                      {permission.name}
                    </label>
                    <p className="text-xs text-slate-500 mt-1">
                      {permission.description}
                    </p>
                  </div>
                  <div className="flex-shrink-0 ml-4">
                    <input
                      type="number"
                      className="w-24 px-2 py-1 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={permissions[permission.key] as number || permission.min || 0}
                      onChange={(e) => updatePermission(permission.key, parseInt(e.target.value) || 0)}
                      min={permission.min}
                      max={permission.max}
                      disabled={disabled}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Informações sobre permissões */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start space-x-2">
          <div className="flex-shrink-0">
            <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center">
              <span className="text-xs font-medium text-blue-600">i</span>
            </div>
          </div>
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">Sobre Permissões Avançadas:</p>
            <ul className="space-y-1 text-xs">
              <li>• Permissões são aplicadas sobre o role base selecionado</li>
              <li>• Algumas permissões podem ter dependências entre si</li>
              <li>• Limitações ajudam a controlar o uso de recursos</li>
              <li>• Alterações são aplicadas imediatamente após salvar</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
