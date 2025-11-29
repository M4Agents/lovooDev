// =====================================================
// LISTA DE USUÁRIOS - COMPONENTE SEGURO
// =====================================================

import React, { useState, useEffect } from 'react';
import { Users, Plus, Edit2, Trash2, Shield, Crown, UserCheck, Briefcase, User, Mail } from 'lucide-react';
import { CompanyUser, UserRole } from '../../types/user';
import { getCompanyUsers, getManagedUsers, deactivateUser } from '../../services/userApi';
import { useAuth } from '../../contexts/AuthContext';
import { InviteLink } from './InviteLink';

interface UsersListProps {
  onCreateUser: () => void;
  onEditUser: (user: CompanyUser) => void;
}

export const UsersList: React.FC<UsersListProps> = ({ onCreateUser, onEditUser }) => {
  const { company, hasPermission } = useAuth();
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInviteLink, setShowInviteLink] = useState(false);
  const [selectedUser, setSelectedUser] = useState<CompanyUser | null>(null);

  // Carregar usuários
  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);

      let userData: CompanyUser[] = [];

      if (company?.id) {
        // Tentar buscar usuários da empresa atual
        userData = await getCompanyUsers(company.id);
      } else {
        // Fallback: buscar usuários que pode gerenciar
        userData = await getManagedUsers();
      }

      setUsers(userData);
    } catch (err) {
      console.error('UsersList: Error loading users:', err);
      setError('Erro ao carregar usuários');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [company?.id]);

  // Desativar usuário
  const handleDeactivateUser = async (user: CompanyUser) => {
    if (!confirm(`Tem certeza que deseja desativar o usuário ${user.user_id}?`)) {
      return;
    }

    try {
      await deactivateUser(user.id);
      await loadUsers(); // Recarregar lista
    } catch (error) {
      console.error('Error deactivating user:', error);
      setError('Erro ao desativar usuário');
    }
  };

  // Mostrar link de convite
  const handleShowInviteLink = (user: CompanyUser) => {
    setSelectedUser(user);
    setShowInviteLink(true);
  };

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

  // Nome do role em português
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

  // Cor do badge do role
  const getRoleColor = (role: UserRole): string => {
    switch (role) {
      case 'super_admin':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'admin':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'partner':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'manager':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'seller':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      default:
        return 'bg-gray-100 text-gray-600 border-gray-200';
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Carregando usuários...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
        <div className="text-center">
          <div className="p-4 bg-red-100 rounded-full w-16 h-16 mx-auto mb-4">
            <Users className="w-8 h-8 text-red-600 mx-auto mt-1" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">Erro ao Carregar</h3>
          <p className="text-slate-600 mb-4">{error}</p>
          <button
            onClick={loadUsers}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Gestão de Usuários</h2>
          <p className="text-slate-600 mt-1">
            Gerencie usuários, roles e permissões da empresa
          </p>
        </div>
        
        {hasPermission('create_users') && (
          <button
            onClick={onCreateUser}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Novo Usuário
          </button>
        )}
      </div>

      {/* Lista de usuários */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        {users.length === 0 ? (
          <div className="p-12 text-center">
            <div className="p-4 bg-slate-100 rounded-full w-16 h-16 mx-auto mb-4">
              <Users className="w-8 h-8 text-slate-400 mx-auto mt-1" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Nenhum usuário encontrado</h3>
            <p className="text-slate-600 mb-6">
              {company?.name ? 
                `Não há usuários cadastrados para a empresa ${company.name}` :
                'Não há usuários para exibir'
              }
            </p>
            {hasPermission('create_users') && (
              <button
                onClick={onCreateUser}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Criar Primeiro Usuário
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-hidden">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Usuário
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Empresa
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Criado em
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          <div className="h-10 w-10 rounded-full bg-slate-200 flex items-center justify-center">
                            <User className="w-5 h-5 text-slate-500" />
                          </div>
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-slate-900">
                            {user.user_id.startsWith('mock_') ? 
                              `Usuário Mock ${user.user_id.slice(-4)}` : 
                              user.user_id
                            }
                          </div>
                          <div className="text-sm text-slate-500">
                            ID: {user.id.slice(0, 8)}...
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {getRoleIcon(user.role)}
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getRoleColor(user.role)}`}>
                          {getRoleName(user.role)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-slate-900">
                        {user.companies?.name || 'N/A'}
                      </div>
                      <div className="text-sm text-slate-500">
                        {user.companies?.company_type === 'parent' ? 'Empresa Pai' : 'Cliente'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                      {new Date(user.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center gap-2 justify-end">
                        {hasPermission('create_users') && (
                          <button
                            onClick={() => handleShowInviteLink(user)}
                            className="text-green-600 hover:text-green-900 p-1 rounded transition-colors"
                            title="Reenviar convite"
                          >
                            <Mail className="w-4 h-4" />
                          </button>
                        )}
                        {hasPermission('edit_users') && (
                          <button
                            onClick={() => onEditUser(user)}
                            className="text-blue-600 hover:text-blue-900 p-1 rounded transition-colors"
                            title="Editar usuário"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                        {hasPermission('delete_users') && (
                          <button
                            onClick={() => handleDeactivateUser(user)}
                            className="text-red-600 hover:text-red-900 p-1 rounded transition-colors"
                            title="Desativar usuário"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Informações adicionais */}
      {users.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Users className="w-5 h-5 text-blue-600 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-blue-900 mb-1">
                Sistema de Usuários Ativo
              </h4>
              <p className="text-sm text-blue-700">
                Total de {users.length} usuário{users.length !== 1 ? 's' : ''} encontrado{users.length !== 1 ? 's' : ''}. 
                O sistema está utilizando a nova estrutura de múltiplos usuários por empresa.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Link de Convite */}
      <InviteLink
        isOpen={showInviteLink}
        onClose={() => {
          setShowInviteLink(false);
          setSelectedUser(null);
        }}
        user={selectedUser}
      />
    </div>
  );
};
