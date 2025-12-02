// =====================================================
// MODAL DE USUÁRIO - CRIAÇÃO/EDIÇÃO SEGURA
// =====================================================

import React, { useState, useEffect } from 'react';
import { X, User, Mail, Shield, Save, AlertCircle, CheckCircle, Info, Lock, RefreshCw, UserCheck } from 'lucide-react';
import { CompanyUser, UserRole, CreateUserRequest, UpdateUserRequest } from '../../types/user';
import { createCompanyUser, updateCompanyUser, validateRoleForCompany, getDefaultPermissions } from '../../services/userApi';
import { useAuth } from '../../contexts/AuthContext';
import { getSystemStatus, getStatusMessage, SystemStatus } from '../../services/systemStatus';
import { InviteSuccess } from './InviteSuccess';
import { supabase } from '../../lib/supabase';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  user?: CompanyUser | null;
}

export const UserModal: React.FC<UserModalProps> = ({ isOpen, onClose, onSave, user }) => {
  const { company } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [showInviteSuccess, setShowInviteSuccess] = useState(false);
  const [inviteData, setInviteData] = useState<any>(null);
  
  // Estados para gerenciamento de senha
  const [activeTab, setActiveTab] = useState<'info' | 'password'>('info');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    email: '',
    displayName: '',
    role: 'seller' as UserRole,
    sendInvite: true
  });

  const isEditing = !!user;

  // Reset form quando modal abre/fecha
  useEffect(() => {
    if (isOpen) {
      if (user) {
        // Modo edição
        setFormData({
          email: user.user_id.startsWith('mock_') ? '' : user.user_id,
          displayName: user.display_name || '',
          role: user.role,
          sendInvite: false
        });
      } else {
        // Modo criação
        setFormData({
          email: '',
          displayName: '',
          role: 'seller',
          sendInvite: true
        });
      }
      setError(null);
      
      // Carregar status do sistema
      getSystemStatus().then(setSystemStatus);
    }
  }, [isOpen, user]);

  // Roles disponíveis baseados no tipo de empresa
  const getAvailableRoles = (): { value: UserRole; label: string; description: string }[] => {
    const companyType = company?.company_type || 'client';
    
    if (companyType === 'parent') {
      return [
        { value: 'super_admin', label: 'Super Admin', description: 'Acesso total ao sistema' },
        { value: 'admin', label: 'Administrador', description: 'Gerencia empresas filhas' },
        { value: 'partner', label: 'Parceiro', description: 'Gerencia próprias contas' }
      ];
    } else {
      return [
        { value: 'admin', label: 'Administrador', description: 'Configurações da empresa' },
        { value: 'manager', label: 'Gerente', description: 'Gestão de leads e vendas' },
        { value: 'seller', label: 'Vendedor', description: 'Leads próprios e chat' }
      ];
    }
  };

  // Salvar usuário
  const handleSave = async () => {
    try {
      setLoading(true);
      setError(null);

      // Validações
      if (!isEditing && !formData.email.trim()) {
        setError('Email é obrigatório');
        return;
      }

      if (!company?.id) {
        setError('Empresa não identificada');
        return;
      }

      // Validar role para tipo de empresa
      if (!validateRoleForCompany(formData.role, company.company_type)) {
        setError(`Role ${formData.role} não é válido para este tipo de empresa`);
        return;
      }

      if (isEditing && user) {
        // Atualizar usuário existente
        const updateRequest: UpdateUserRequest = {
          id: user.id,
          role: formData.role,
          permissions: getDefaultPermissions(formData.role)
        };

        await updateCompanyUser(updateRequest);
      } else {
        // Criar novo usuário
        const createRequest: CreateUserRequest = {
          companyId: company.id,
          email: formData.email.trim(),
          role: formData.role,
          sendInvite: formData.sendInvite
        };

        const result = await createCompanyUser(createRequest);
        
        console.log('UserModal: User creation result:', {
          result: result,
          isReal: result._isRealUser,
          hasAppMetadata: !!(result as any).app_metadata,
          inviteUrl: (result as any).app_metadata?.invite_url,
          sendInvite: formData.sendInvite
        });
        
        // SEMPRE mostrar modal de sucesso quando usuário é criado com convite
        if (formData.sendInvite) {
          const mode = result._isRealUser ? 'real' : 'simulated';
          let inviteUrl = (result as any).app_metadata?.invite_url;
          
          // Se não tem URL do convite, gerar uma para teste
          if (!inviteUrl) {
            // Buscar email real do usuário criado/reativado
            let emailForLink = formData.email;
            if (result && (result as any).user_id) {
              try {
                const { data: emailResult, error } = await supabase.rpc('get_user_email_safe', {
                  p_user_id: (result as any).user_id
                });
                
                if (!error && emailResult) {
                  emailForLink = emailResult;
                  console.log('UserModal: Using real email for link:', emailForLink);
                }
              } catch (e) {
                console.log('UserModal: Could not fetch real email, using form email');
              }
            }
            
            inviteUrl = `https://app.lovoocrm.com/accept-invite?token=${btoa(emailForLink)}&type=invite&email=${encodeURIComponent(emailForLink)}`;
          }
          
          setInviteData({
            email: formData.email,
            inviteUrl: inviteUrl,
            mode: mode === 'real' ? 'real' : 'simulated',
            message: mode === 'real' ? 'Convite enviado por email via Supabase Auth' : 'Configure Admin API para envio real de emails'
          });
          
          setShowInviteSuccess(true);
          console.log('UserModal: Showing success modal:', { 
            mode, 
            email: formData.email,
            hasUrl: !!inviteUrl,
            inviteUrl: inviteUrl
          });
          
          // Não fechar o modal principal ainda - deixar o modal de sucesso aparecer
          onSave();
          return;
        }
      }

      // Se não foi convite, fechar normalmente
      onSave();
      onClose();
    } catch (err) {
      console.error('UserModal: Error saving user:', err);
      
      // TRATAMENTO INTELIGENTE: Verificar se é erro real ou modo compatibilidade
      const errorMessage = err instanceof Error ? err.message : 'Erro ao salvar usuário';
      
      // Se contém indicações de modo compatibilidade, tratar como sucesso
      if (errorMessage.includes('modo compatibilidade') || 
          errorMessage.includes('Admin API não configurada') ||
          errorMessage.includes('Convite simulado criado')) {
        
        console.log('UserModal: Operating in compatibility mode - treating as success');
        
        // Se era para enviar convite, mostrar modal de sucesso mesmo assim
        if (formData.sendInvite) {
          // Usar email do formulário para modo compatibilidade (já é o correto)
          setInviteData({
            email: formData.email,
            inviteUrl: `https://app.lovoocrm.com/accept-invite?token=${btoa(formData.email)}&type=invite&email=${encodeURIComponent(formData.email)}`,
            mode: 'simulated',
            message: 'Sistema em modo compatibilidade - Configure Admin API para envio real de emails'
          });
          
          setShowInviteSuccess(true);
          console.log('UserModal: Showing success modal for compatibility mode');
        }
        
        // Tratar como sucesso
        onSave();
        onClose();
      } else {
        // Erro real - mostrar para usuário
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  // Função para resetar senha via email
  const handleResetPassword = async () => {
    if (!user?.email) return;

    try {
      setPasswordLoading(true);
      setPasswordSuccess(null);
      setError(null);

      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/reset-password`
      });

      if (error) {
        throw error;
      }

      setPasswordSuccess(`Email de recuperação enviado para ${user.email}`);
    } catch (err) {
      console.error('Error sending reset email:', err);
      setError(err instanceof Error ? err.message : 'Erro ao enviar email de recuperação');
    } finally {
      setPasswordLoading(false);
    }
  };

  // Função para atualizar display name
  const handleUpdateDisplayName = async () => {
    if (!user?.user_id || !formData.displayName.trim()) return;

    try {
      setLoading(true);
      setError(null);

      // Atualizar via Admin API
      const { error } = await supabase.auth.admin.updateUserById(user.user_id, {
        user_metadata: { 
          display_name: formData.displayName.trim(),
          name: formData.displayName.trim()
        }
      });

      if (error) {
        throw error;
      }

      setPasswordSuccess('Nome atualizado com sucesso');
      onSave(); // Recarregar lista
    } catch (err) {
      console.error('Error updating display name:', err);
      setError(err instanceof Error ? err.message : 'Erro ao atualizar nome');
    } finally {
      setLoading(false);
    }
  };

  // Função para reenviar convite
  const handleResendInvite = async () => {
    if (!user?.email) return;

    try {
      setPasswordLoading(true);
      setPasswordSuccess(null);
      setError(null);

      // Gerar novo link de convite
      const { error } = await supabase.auth.admin.generateLink({
        type: 'invite',
        email: user.email
      });

      if (error) {
        throw error;
      }

      setPasswordSuccess(`Novo convite enviado para ${user.email}`);
    } catch (err) {
      console.error('Error resending invite:', err);
      setError(err instanceof Error ? err.message : 'Erro ao reenviar convite');
    } finally {
      setPasswordLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <User className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {isEditing ? 'Editar Usuário' : 'Novo Usuário'}
              </h2>
              <p className="text-sm text-slate-600">
                {isEditing ? 'Altere as informações do usuário' : 'Adicione um novo usuário à empresa'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            disabled={loading}
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Tabs - Apenas para edição */}
        {isEditing && (
          <div className="border-b border-slate-200">
            <div className="flex">
              <button
                onClick={() => setActiveTab('info')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'info'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <User className="w-4 h-4 inline mr-2" />
                Informações
              </button>
              <button
                onClick={() => setActiveTab('password')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'password'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Lock className="w-4 h-4 inline mr-2" />
                Senha & Acesso
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium text-red-900 mb-1">Erro</h4>
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Success Message */}
          {passwordSuccess && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium text-green-900 mb-1">Sucesso</h4>
                  <p className="text-sm text-green-700">{passwordSuccess}</p>
                </div>
              </div>
            </div>
          )}

          {/* Conteúdo baseado na aba ativa */}
          {(!isEditing || activeTab === 'info') && (
            <>

          {/* Email (apenas para criação) */}
          {!isEditing && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                <Mail className="w-4 h-4 inline mr-2" />
                Email do Usuário
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="usuario@empresa.com"
                disabled={loading}
              />
              <p className="text-xs text-slate-500 mt-1">
                O usuário receberá um convite por email para acessar o sistema
              </p>
            </div>
          )}

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              <Shield className="w-4 h-4 inline mr-2" />
              Nível de Acesso (Role)
            </label>
            <select
              value={formData.role}
              onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value as UserRole }))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={loading}
            >
              {getAvailableRoles().map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
            
            {/* Descrição do role selecionado */}
            {(() => {
              const selectedRole = getAvailableRoles().find(r => r.value === formData.role);
              return selectedRole ? (
                <p className="text-xs text-slate-500 mt-1">
                  {selectedRole.description}
                </p>
              ) : null;
            })()}
          </div>

          {/* Enviar convite (apenas para criação) */}
          {!isEditing && (
            <div>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={formData.sendInvite}
                  onChange={(e) => setFormData(prev => ({ ...prev, sendInvite: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                  disabled={loading}
                />
                <div>
                  <span className="text-sm font-medium text-slate-700">
                    Enviar convite por email
                  </span>
                  <p className="text-xs text-slate-500">
                    O usuário receberá instruções para acessar o sistema
                  </p>
                </div>
              </label>
            </div>
          )}

          {/* Informações da empresa */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-slate-700 mb-2">Empresa</h4>
            <div className="text-sm text-slate-600">
              <p><strong>Nome:</strong> {company?.name || 'N/A'}</p>
              <p><strong>Tipo:</strong> {company?.company_type === 'parent' ? 'Empresa Pai' : 'Cliente'}</p>
            </div>
          </div>

          {/* Informações sobre criação de usuário e status do sistema */}
          {!isEditing && (
            <div className="space-y-3">
              {/* Status do sistema */}
              {systemStatus && (
                <div className={`border rounded-lg p-4 ${
                  systemStatus.mode === 'production' ? 'bg-green-50 border-green-200' :
                  systemStatus.mode === 'development' ? 'bg-yellow-50 border-yellow-200' :
                  'bg-blue-50 border-blue-200'
                }`}>
                  <div className="flex items-start gap-3">
                    {systemStatus.mode === 'production' ? (
                      <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                    ) : systemStatus.mode === 'development' ? (
                      <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                    ) : (
                      <Info className="w-5 h-5 text-blue-600 mt-0.5" />
                    )}
                    <div>
                      <h4 className={`text-sm font-medium mb-1 ${
                        systemStatus.mode === 'production' ? 'text-green-900' :
                        systemStatus.mode === 'development' ? 'text-yellow-900' :
                        'text-blue-900'
                      }`}>
                        Status do Sistema
                      </h4>
                      <p className={`text-sm ${
                        systemStatus.mode === 'production' ? 'text-green-700' :
                        systemStatus.mode === 'development' ? 'text-yellow-700' :
                        'text-blue-700'
                      }`}>
                        {getStatusMessage(systemStatus)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Informações sobre criação */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-slate-600 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-slate-900 mb-1">
                      {formData.sendInvite ? 'Convite por Email' : 'Usuário Interno'}
                    </h4>
                    <p className="text-sm text-slate-700">
                      {formData.sendInvite ? 
                        (systemStatus?.features.emailInvites ? 
                          'O usuário receberá um email com instruções para ativar a conta e definir sua senha.' :
                          'Será criado um usuário que poderá ser convidado quando o email estiver configurado.'
                        ) :
                        'Será criado um registro interno. Para acesso completo, marque "Enviar convite por email".'
                      }
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
            </>
          )}

          {/* Aba de Senha & Acesso - Apenas para edição */}
          {isEditing && activeTab === 'password' && (
            <>
              {/* Campo Display Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <User className="w-4 h-4 inline mr-2" />
                  Nome de Exibição
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formData.displayName}
                    onChange={(e) => setFormData(prev => ({ ...prev, displayName: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Nome do usuário"
                    disabled={loading}
                  />
                  <button
                    onClick={handleUpdateDisplayName}
                    disabled={loading || !formData.displayName.trim() || formData.displayName === (user?.display_name || '')}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                  >
                    <UserCheck className="w-4 h-4" />
                    Salvar
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Nome que aparecerá na interface do sistema
                </p>
              </div>

              {/* Gerenciamento de Senha */}
              <div className="space-y-4">
                <h4 className="text-sm font-medium text-slate-900 flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  Gerenciar Senha
                </h4>

                {/* Resetar Senha */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h5 className="text-sm font-medium text-blue-900 mb-1">
                        Resetar Senha
                      </h5>
                      <p className="text-sm text-blue-700 mb-3">
                        Enviar email para o usuário redefinir a senha
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleResetPassword}
                    disabled={passwordLoading || !user?.email}
                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {passwordLoading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    {passwordLoading ? 'Enviando...' : 'Enviar Email de Reset'}
                  </button>
                </div>

                {/* Reenviar Convite */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h5 className="text-sm font-medium text-green-900 mb-1">
                        Reenviar Convite
                      </h5>
                      <p className="text-sm text-green-700 mb-3">
                        Gerar novo link de convite para o usuário
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleResendInvite}
                    disabled={passwordLoading || !user?.email}
                    className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {passwordLoading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    ) : (
                      <Mail className="w-4 h-4" />
                    )}
                    {passwordLoading ? 'Enviando...' : 'Reenviar Convite'}
                  </button>
                </div>

                {/* Informações do Usuário */}
                {user && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                    <h5 className="text-sm font-medium text-slate-900 mb-2">
                      Informações da Conta
                    </h5>
                    <div className="space-y-2 text-sm text-slate-600">
                      <div><strong>Email:</strong> {user.email || user.user_id}</div>
                      <div><strong>Status:</strong> {user.is_active ? '🟢 Ativo' : '⚪ Inativo'}</div>
                      <div><strong>Role:</strong> {user.role}</div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium transition-colors"
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={loading || (!isEditing && !formData.email.trim())}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {loading ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <Save className="w-4 h-4" />
            )}
            {loading ? 'Salvando...' : (isEditing ? 'Salvar Alterações' : 'Criar Usuário')}
          </button>
        </div>
      </div>

      {/* Modal de Sucesso do Convite */}
      <InviteSuccess
        isOpen={showInviteSuccess}
        onClose={() => {
          setShowInviteSuccess(false);
          onClose(); // Fechar modal principal quando modal de sucesso for fechado
        }}
        inviteData={inviteData || { email: '', mode: 'simulated' }}
      />
    </div>
  );
};
