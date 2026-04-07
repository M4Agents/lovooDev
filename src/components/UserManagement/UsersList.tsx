// =====================================================
// LISTA DE USUÁRIOS - COMPONENTE SEGURO
// =====================================================

import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, Plus, Edit2, Trash2, UserX, Shield, Crown, UserCheck, Briefcase, User, Mail } from 'lucide-react';
import { Avatar } from '../Avatar';
import { CompanyUser, UserRole } from '../../types/user';
import { getCompanyUsers, getManagedUsers, deactivateUser } from '../../services/userApi';
import { useAuth } from '../../contexts/AuthContext';
import { InviteLink } from './InviteLink';
import { DeleteUserModal } from './DeleteUserModal';
import { supabase } from '../../lib/supabase';

interface UsersListProps {
  onCreateUser: () => void;
  onEditUser: (user: CompanyUser) => void;
}

// Interface para métodos expostos via ref
export interface UsersListRef {
  loadUsers: () => Promise<void>;
  refreshList: () => Promise<void>;
}

export const UsersList = forwardRef<UsersListRef, UsersListProps>(({ onCreateUser, onEditUser }, ref) => {
  const { t } = useTranslation('settings.app');
  const { company, hasPermission } = useAuth();
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInviteLink, setShowInviteLink] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
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
      setError(t('users.states.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [company?.id]);

  // Expor métodos via ref para componente pai
  useImperativeHandle(ref, () => ({
    loadUsers,
    refreshList: loadUsers // Alias para compatibilidade
  }), []);

  // Desativar usuário (soft delete)
  const handleDeactivateUser = async (user: CompanyUser) => {
    if (!confirm(t('users.confirm.deactivate', { id: user.user_id }))) {
      return;
    }

    try {
      await deactivateUser(user.id);
      await loadUsers(); // Recarregar lista
    } catch (error) {
      console.error('Error deactivating user:', error);
      setError(t('users.states.deactivateError'));
    }
  };

  // Reativar usuário
  const handleReactivateUser = async (user: CompanyUser) => {
    if (!confirm(`✅ REATIVAR USUÁRIO\n\nTem certeza que deseja reativar o usuário ${user.user_id}?\n\n• O usuário voltará a estar ativo no sistema\n• Poderá acessar normalmente\n• Todas as permissões serão restauradas`)) {
      return;
    }

    try {
      // Usar função RPC para reativar (atualizar is_active = true)
      const { error } = await supabase
        .from('company_users')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('id', user.id);

      if (error) {
        throw error;
      }

      await loadUsers(); // Recarregar lista
    } catch (error) {
      console.error('Error reactivating user:', error);
      setError(t('users.states.reactivateError'));
    }
  };

  // Abrir modal de exclusão
  const handleDeleteUser = (user: CompanyUser) => {
    setSelectedUser(user);
    setShowDeleteModal(true);
  };

  // Executar exclusão via modal
  const executeDeleteUser = async (user: CompanyUser) => {
    try {
      setError(null);
      
      // Usar email correto para a função RPC
      const emailToUse = user.email || user.user_id;
      
      console.log('Deleting user with email:', emailToUse);
      
      // Usar nossa função segura de exclusão completa
      const { data, error } = await supabase.rpc('safe_delete_user_complete', {
        p_user_email: emailToUse
      });
      
      if (error) {
        throw new Error(error.message);
      }
      
      if (!data?.success) {
        throw new Error(data?.error || 'Erro na exclusão do usuário');
      }
      
      console.log('User deleted successfully:', data);
      await loadUsers(); // Recarregar lista
      
    } catch (error) {
      console.error('Error deleting user permanently:', error);
      throw error; // Re-throw para o modal tratar
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

  const getRoleName = (role: UserRole): string => t(`users.roles.${role}`);

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
          <p className="text-slate-600">{t('users.states.loading')}</p>
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
          <h3 className="text-lg font-semibold text-slate-900 mb-2">{t('users.states.loadErrorTitle')}</h3>
          <p className="text-slate-600 mb-4">{error}</p>
          <button
            onClick={loadUsers}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {t('users.actions.retry')}
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
          <h2 className="text-2xl font-bold text-slate-900">{t('users.sections.management')}</h2>
          <p className="text-slate-600 mt-1">
            {t('users.subtitles.management')}
          </p>
        </div>
        
        {hasPermission('create_users') && (
          <button
            onClick={onCreateUser}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t('users.actions.create')}
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
            <h3 className="text-lg font-semibold text-slate-900 mb-2">{t('users.states.empty')}</h3>
            <p className="text-slate-600 mb-6">
              {company?.name ? 
                t('users.states.emptyWithCompany', { name: company.name }) :
                t('users.states.emptyGeneric')
              }
            </p>
            {hasPermission('create_users') && (
              <button
                onClick={onCreateUser}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                {t('users.actions.createFirst')}
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-hidden">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    {t('users.table.columns.user')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    {t('users.table.columns.role')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    {t('users.table.columns.company')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    {t('users.table.columns.createdAt')}
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                    {t('users.table.columns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {users.map((user) => (
                  <tr key={user.id} className={`hover:bg-slate-50 ${!user.is_active ? 'opacity-75 bg-gray-50' : ''}`}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          <Avatar 
                            src={user.profile_picture_url}
                            alt={user.display_name || user.email || t('users.avatarAlt')}
                            size="md"
                            fallbackText={user.display_name?.charAt(0) || user.email?.charAt(0)}
                          />
                        </div>
                        <div className="ml-4">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-slate-900">
                              {user.user_id.startsWith('mock_') ? 
                                t('users.mockUser', { suffix: user.user_id.slice(-4) }) : 
                                user.display_name || user.user_id
                              }
                            </div>
                            {/* Indicador de status */}
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              user.is_active 
                                ? 'bg-green-100 text-green-800 border border-green-200' 
                                : 'bg-gray-100 text-gray-600 border border-gray-200'
                            }`}>
                              {user.is_active ? `🟢 ${t('users.status.active')}` : `⚪ ${t('users.status.inactive')}`}
                            </span>
                          </div>
                          <div className="text-sm text-slate-500">
                            {user.email || user.user_id}
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
                        {user.companies?.name || t('users.notAvailable')}
                      </div>
                      <div className="text-sm text-slate-500">
                        {user.companies?.company_type === 'parent' ? t('users.companyType.parent') : t('users.companyType.client')}
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
                            title={t('users.actions.resendInvite')}
                          >
                            <Mail className="w-4 h-4" />
                          </button>
                        )}
                        {hasPermission('edit_users') && (
                          <button
                            onClick={() => onEditUser(user)}
                            className="text-blue-600 hover:text-blue-900 p-1 rounded transition-colors"
                            title={t('users.actions.edit')}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                        {hasPermission('delete_users') && (
                          <>
                            {/* Botão Desativar/Reativar */}
                            {user.is_active ? (
                              <button
                                onClick={() => handleDeactivateUser(user)}
                                className="text-orange-600 hover:text-orange-900 p-1 rounded transition-colors"
                                title={t('users.actions.deactivate')}
                              >
                                <UserX className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleReactivateUser(user)}
                                className="text-green-600 hover:text-green-900 p-1 rounded transition-colors"
                                title={t('users.actions.reactivate')}
                              >
                                <UserCheck className="w-4 h-4" />
                              </button>
                            )}
                            
                            {/* Botão Excluir Permanentemente (Hard Delete) */}
                            <button
                              onClick={() => handleDeleteUser(user)}
                              className="text-red-600 hover:text-red-900 p-1 rounded transition-colors"
                              title={t('users.actions.delete')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
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
                {t('users.summary.activeUsersTitle')}
              </h4>
              <p className="text-sm text-blue-700">
                {t('users.summary.activeUsersBody', { count: users.length })}
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
      
      {/* Modal de Exclusão Elegante */}
      <DeleteUserModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedUser(null);
        }}
        onConfirm={executeDeleteUser}
        user={selectedUser}
      />
    </div>
  );
});

// Definir displayName para debugging
UsersList.displayName = 'UsersList';
