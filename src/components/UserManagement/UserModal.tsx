// =====================================================
// MODAL DE USUÁRIO - CRIAÇÃO/EDIÇÃO SEGURA
// =====================================================

import React, { useState, useEffect } from 'react';
import { X, Save, Shield, UserCheck, User, Lock, AlertCircle, CheckCircle, Mail, Info, RefreshCw, Eye, EyeOff, Camera, Upload } from 'lucide-react';
import { CompanyUser, UserRole, CreateUserRequest, UpdateUserRequest, UserTemplate, UserPermissions, UserProfile } from '../../types/user';
import { createCompanyUser, updateCompanyUser, validateRoleForCompany, getDefaultPermissions } from '../../services/userApi';
import { applyTemplateToPermissions } from '../../services/userTemplates';
import { getProfilesForCompanyType, getProfileRole } from '../../services/userProfiles';
import { useAuth } from '../../contexts/AuthContext';
import { getSystemStatus, getStatusMessage, SystemStatus } from '../../services/systemStatus';
import { InviteSuccess } from './InviteSuccess';
import { Toggle } from '../ui/Toggle';
import { supabase } from '../../lib/supabase';
import { canAccessCriticalPermissions, CRITICAL_PERMISSIONS } from '../../utils/permissionUtils';
import { Avatar } from '../Avatar';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  user?: CompanyUser | null;
  preSelectedProfileId?: string; // NOVO: ID do perfil/template pré-selecionado
}

export const UserModal: React.FC<UserModalProps> = ({ isOpen, onClose, onSave, user, preSelectedProfileId }) => {
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
  
  // Estados para alteração direta de senha
  const [showDirectPasswordForm, setShowDirectPasswordForm] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [forcePasswordChange, setForcePasswordChange] = useState(true);
  const [directPasswordLoading, setDirectPasswordLoading] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // Form state (MANTIDO - compatibilidade 100%)
  const [formData, setFormData] = useState({
    email: '',
    displayName: '',
    role: 'seller' as UserRole,
    sendInvite: true,
    profilePicture: null as File | null // 🔧 NOVO: Campo para foto de perfil
  });

  // ESTADOS LEGADOS - Mantidos para compatibilidade (não utilizados atualmente)
  const [selectedTemplate, setSelectedTemplate] = useState<UserTemplate | null>(null);
  const [useAdvancedPermissions, setUseAdvancedPermissions] = useState(false);
  const [customPermissions, setCustomPermissions] = useState<Partial<UserPermissions>>({});
  
  // NOVO SISTEMA - Perfis unificados
  const [availableProfiles, setAvailableProfiles] = useState<UserProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<UserProfile | null>(null);

  const isEditing = !!user;

  // 🔧 NOVO: Função para upload de foto de perfil
  const uploadProfilePicture = async (file: File, userId: string): Promise<string | null> => {
    try {
      console.log('🔧 Upload Debug: Starting upload process', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        userId: userId
      });

      // Verificar autenticação antes do upload
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      console.log('🔧 Upload Debug: Auth check', {
        isAuthenticated: !!authUser,
        authUserId: authUser?.id,
        authError: authError
      });

      if (!authUser) {
        throw new Error('Usuário não autenticado para upload');
      }

      // Gerar nome único para o arquivo
      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}-${Date.now()}.${fileExt}`;
      const filePath = `profile-pictures/${fileName}`;

      console.log('🔧 Upload Debug: File path generated', {
        fileName: fileName,
        filePath: filePath
      });

      // Upload para Supabase Storage
      const { data, error } = await supabase.storage
        .from('user-profiles')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });

      console.log('🔧 Upload Debug: Upload result', {
        success: !error,
        data: data,
        error: error
      });

      if (error) {
        console.error('🔧 Upload Error Details:', {
          message: error.message,
          error: error
        });
        throw error;
      }

      // Obter URL pública
      const { data: { publicUrl } } = supabase.storage
        .from('user-profiles')
        .getPublicUrl(filePath);

      console.log('🔧 Upload Debug: Public URL generated', {
        publicUrl: publicUrl
      });

      return publicUrl;
    } catch (error) {
      console.error('🔧 Upload Error: Complete error details:', {
        error: error,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      return null;
    }
  };

  // Reset form quando modal abre/fecha (EXPANDIDO - compatível)
  useEffect(() => {
    if (isOpen) {
      if (user) {
        // Modo edição (MANTIDO)
        console.log('UserModal: Editing user with role:', user.role);
        setFormData({
          email: user.user_id.startsWith('mock_') ? '' : user.user_id,
          displayName: user.display_name || '',
          role: user.role,
          sendInvite: false,
          profilePicture: null // 🔧 NOVO: Reset foto no modo edição
        });
        
        // NOVO: Resetar estados avançados para edição
        setSelectedTemplate(null);
        setUseAdvancedPermissions(false);
        setCustomPermissions(user.permissions || {});
        
        // CORREÇÃO: Resetar selectedProfile para forçar nova seleção baseada no role correto
        setSelectedProfile(null);
      } else {
        // Modo criação (MANTIDO)
        setFormData({
          email: '',
          displayName: '',
          role: 'seller',
          sendInvite: true,
          profilePicture: null // 🔧 NOVO: Reset foto no modo criação
        });
        
        // NOVO: Resetar estados avançados para criação
        setSelectedTemplate(null);
        setUseAdvancedPermissions(false);
        setCustomPermissions({});
      }
      setError(null);
      
      // Carregar status do sistema
      getSystemStatus().then(setSystemStatus);
      
      // NOVO: Carregar perfis disponíveis
      if (company?.id) {
        loadAvailableProfiles();
      }
    }
  }, [isOpen, user, company?.id]);

  // NOVO: Recarregar perfis quando role do formulário mudar
  useEffect(() => {
    if (isOpen && company?.id && formData.role && availableProfiles.length > 0) {
      // Buscar perfil correto para o role atual
      const correctProfile = availableProfiles.find(p => 
        p.isSystem && 
        p.legacyRole === formData.role
      );
      
      if (correctProfile && (!selectedProfile || selectedProfile.legacyRole !== formData.role)) {
        console.log('UserModal: Role changed, updating profile:', formData.role, '→', correctProfile.name);
        setSelectedProfile(correctProfile);
      }
    }
  }, [formData.role, availableProfiles, isOpen, company?.id]);

  // NOVO: Pré-seleção de perfil quando preSelectedProfileId é fornecido
  useEffect(() => {
    if (isOpen && preSelectedProfileId && availableProfiles.length > 0 && !user) {
      // Buscar perfil/template pré-selecionado (apenas para criação, não edição)
      const preSelectedProfile = availableProfiles.find(p => p.id === preSelectedProfileId);
      
      if (preSelectedProfile) {
        console.log('UserModal: Pre-selecting profile:', preSelectedProfileId, '→', preSelectedProfile.name);
        setSelectedProfile(preSelectedProfile);
        
        // Atualizar role do formulário baseado no perfil pré-selecionado
        const role = getProfileRole(preSelectedProfile);
        setFormData(prev => ({ ...prev, role }));
      }
    }
  }, [preSelectedProfileId, availableProfiles, isOpen, user]);

  // NOVA FUNÇÃO: Carregar perfis disponíveis (COM FALLBACK SEGURO)
  const loadAvailableProfiles = async () => {
    if (!company?.id) return;
    
    try {
      // Verificar se as funções existem antes de usar
      if (typeof getProfilesForCompanyType !== 'function') {
        console.warn('UserModal: getProfilesForCompanyType not available, using fallback');
        setAvailableProfiles([]);
        return;
      }

      const profiles = await getProfilesForCompanyType(company.id, company.company_type || 'client');
      setAvailableProfiles(profiles || []);
      
      // CORREÇÃO: Sempre tentar encontrar perfil correto baseado no role atual
      if (profiles && profiles.length > 0) {
        // Buscar perfil do sistema que corresponde ao role do usuário
        const correctProfile = profiles.find(p => 
          p.isSystem && 
          p.legacyRole === formData.role
        );
        
        if (correctProfile) {
          console.log('UserModal: Setting correct profile for role:', formData.role, '→', correctProfile.name);
          setSelectedProfile(correctProfile);
        } else {
          // Fallback: buscar qualquer perfil compatível
          const fallbackProfile = profiles.find(p => p.isSystem && getProfileRole(p) === formData.role);
          if (fallbackProfile) {
            console.log('UserModal: Using fallback profile for role:', formData.role, '→', fallbackProfile.name);
            setSelectedProfile(fallbackProfile);
          }
        }
      }
    } catch (error) {
      console.error('UserModal: Fallback to legacy system due to error:', error);
      // FALLBACK SEGURO: Limpar perfis e usar sistema antigo
      setAvailableProfiles([]);
      setSelectedProfile(null);
      // Modal continua funcionando com sistema de roles antigo
    }
  };

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

      // NOVO: Calcular permissões finais usando perfil selecionado
      let finalPermissions = getDefaultPermissions(formData.role);
      
      // Prioridade 1: Usar perfil selecionado (sistema unificado)
      if (selectedProfile) {
        finalPermissions = selectedProfile.permissions;
      }
      // Fallback: Sistema antigo (template + customizações)
      else if (selectedTemplate) {
        finalPermissions = applyTemplateToPermissions(selectedTemplate, finalPermissions);
      }
      
      // Aplicar customizações avançadas se configuradas
      if (useAdvancedPermissions && Object.keys(customPermissions).length > 0) {
        finalPermissions = { ...finalPermissions, ...customPermissions };
      }

      // NOVO: Filtrar permissões críticas baseado no contexto de segurança
      const canAccessCritical = canAccessCriticalPermissions(
        company?.company_type,
        formData.role,
        company?.is_super_admin
      );

      if (!canAccessCritical) {
        // Remover permissões críticas se não autorizado
        CRITICAL_PERMISSIONS.forEach(permission => {
          if (permission in finalPermissions) {
            delete (finalPermissions as any)[permission];
          }
        });
        
        console.log('[SECURITY] Permissões críticas removidas para:', {
          companyType: company?.company_type,
          userRole: formData.role,
          removedPermissions: CRITICAL_PERMISSIONS.filter(p => p in (selectedProfile?.permissions || {}))
        });
      }

      if (isEditing && user) {
        // 🔧 NOVO: Upload da foto de perfil se selecionada
        let profilePictureUrl = user.profile_picture_url;
        if (formData.profilePicture) {
          console.log('🔧 UserModal: Starting profile picture upload for existing user');
          const uploadedUrl = await uploadProfilePicture(formData.profilePicture, user.user_id);
          if (uploadedUrl) {
            profilePictureUrl = uploadedUrl;
            console.log('🔧 UserModal: Profile picture uploaded successfully:', uploadedUrl);
          } else {
            console.warn('🔧 UserModal: Profile picture upload failed, keeping existing URL');
            // Não falhar a operação se o upload da foto falhar
            // setError('Falha no upload da foto, mas usuário foi salvo');
          }
        }

        // Atualizar usuário existente (EXPANDIDO)
        const updateRequest: UpdateUserRequest = {
          id: user.id,
          role: formData.role,
          permissions: finalPermissions, // Usar permissões calculadas
          profile_picture_url: profilePictureUrl // 🔧 NOVO: Incluir URL da foto
        };

        console.log('🔧 UserModal: Updating user with request:', {
          userId: user.id,
          userIdField: user.user_id,
          profilePictureUrl: profilePictureUrl,
          updateRequest: updateRequest
        });

        await updateCompanyUser(updateRequest);
      } else {
        // Criar novo usuário (EXPANDIDO)
        const createRequest: CreateUserRequest = {
          companyId: company.id,
          email: formData.email.trim(),
          role: formData.role,
          permissions: finalPermissions, // Usar permissões calculadas
          sendInvite: formData.sendInvite
        };

        const result = await createCompanyUser(createRequest);
        
        // 🔧 NOVO: Upload da foto de perfil após criação do usuário
        if (formData.profilePicture && result.user_id) {
          console.log('🔧 UserModal: Starting profile picture upload for new user');
          const uploadedUrl = await uploadProfilePicture(formData.profilePicture, result.user_id);
          if (uploadedUrl) {
            console.log('🔧 UserModal: Profile picture uploaded, updating user record');
            // Atualizar o usuário com a URL da foto
            const updateRequest: UpdateUserRequest = {
              id: result.id,
              profile_picture_url: uploadedUrl
            };
            await updateCompanyUser(updateRequest);
            console.log('🔧 UserModal: User record updated with profile picture URL');
          } else {
            console.warn('🔧 UserModal: Profile picture upload failed for new user, continuing without photo');
            // Não falhar a criação do usuário se o upload da foto falhar
          }
        }
        
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
      console.log('UserModal: Full error details:', {
        error: err,
        message: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined
      });
      
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

  // Função para alterar senha diretamente
  const handleDirectPasswordChange = async () => {
    if (!user || !newPassword || newPassword !== confirmPassword) {
      setError('Verifique se as senhas coincidem');
      return;
    }

    if (newPassword.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres');
      return;
    }

    try {
      setDirectPasswordLoading(true);
      setPasswordSuccess(null);
      setError(null);

      // Preparar metadata baseado no toggle
      const metadata = {
        password_changed_at: new Date().toISOString(),
        password_changed_by: company?.user_id,
        password_type: forcePasswordChange ? 'temporary' : 'permanent',
        must_change_password: forcePasswordChange,
        password_expires_at: forcePasswordChange 
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 dias
          : null
      };

      // Alterar senha usando Admin API
      const { error } = await supabase.auth.admin.updateUserById(user.user_id, {
        password: newPassword,
        app_metadata: metadata
      });

      if (error) {
        throw error;
      }

      // Feedback de sucesso
      const successMessage = forcePasswordChange
        ? `Senha temporária definida. ${user.display_name || user.email} deve alterar no próximo acesso.`
        : `Senha alterada com sucesso para ${user.display_name || user.email}.`;

      setPasswordSuccess(successMessage);
      
      // Limpar formulário
      setNewPassword('');
      setConfirmPassword('');
      setShowDirectPasswordForm(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);

    } catch (err) {
      console.error('Error changing password directly:', err);
      setError(err instanceof Error ? err.message : 'Erro ao alterar senha');
    } finally {
      setDirectPasswordLoading(false);
    }
  };

  // Função para cancelar alteração direta
  const handleCancelDirectPassword = () => {
    setNewPassword('');
    setConfirmPassword('');
    setShowDirectPasswordForm(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setError(null);
  };

  // Validações para o formulário de senha
  const isPasswordValid = newPassword.length >= 6;
  const doPasswordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;
  const canSubmitPassword = isPasswordValid && doPasswordsMatch && !directPasswordLoading;

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

          {/* Foto de Perfil */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              <Camera className="w-4 h-4 inline mr-2" />
              Foto de Perfil
            </label>
            <div className="flex items-center gap-4">
              {/* Preview da foto */}
              <Avatar 
                src={formData.profilePicture ? URL.createObjectURL(formData.profilePicture) : (user?.profile_picture_url || null)}
                alt={formData.displayName || formData.email || 'Usuário'}
                size="lg"
                fallbackText={formData.displayName?.charAt(0) || formData.email?.charAt(0)}
              />
              
              {/* Upload button */}
              <div className="flex-1">
                <input
                  type="file"
                  id="profile-picture"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      // Validar tamanho (máx 2MB)
                      if (file.size > 2 * 1024 * 1024) {
                        setError('A imagem deve ter no máximo 2MB');
                        return;
                      }
                      // Validar formato
                      if (!file.type.startsWith('image/')) {
                        setError('Apenas arquivos de imagem são permitidos');
                        return;
                      }
                      setFormData(prev => ({ ...prev, profilePicture: file }));
                      setError(null);
                    }
                  }}
                  className="hidden"
                  disabled={loading}
                />
                <label
                  htmlFor="profile-picture"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg cursor-pointer transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  {formData.profilePicture ? 'Alterar Foto' : 'Escolher Foto'}
                </label>
                {formData.profilePicture && (
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, profilePicture: null }))}
                    className="ml-2 text-sm text-red-600 hover:text-red-700"
                  >
                    Remover
                  </button>
                )}
                <p className="text-xs text-slate-500 mt-1">
                  Formatos aceitos: JPG, PNG, GIF. Máximo 2MB.
                </p>
              </div>
            </div>
          </div>

          {/* Perfil de Acesso - SISTEMA UNIFICADO COM FALLBACK */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              <Shield className="w-4 h-4 inline mr-2" />
              {availableProfiles.length > 0 ? 'Perfil de Acesso' : 'Nível de Acesso (Role)'}
            </label>
            
            {/* SISTEMA NOVO: Seletor de Perfis (quando disponível) */}
            {availableProfiles.length > 0 ? (
              <>
                <select
                  value={selectedProfile?.id || ''}
                  onChange={(e) => {
                    const profile = availableProfiles.find(p => p.id === e.target.value);
                    setSelectedProfile(profile || null);
                    if (profile) {
                      // Atualizar role do formulário para compatibilidade
                      const role = getProfileRole(profile);
                      setFormData(prev => ({ ...prev, role }));
                    }
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={loading}
                >
                  <option value="">Selecione um perfil...</option>
                  
                  {/* Perfis do Sistema */}
                  {availableProfiles.filter(p => p.isSystem).length > 0 && (
                    <optgroup label="Perfis do Sistema">
                      {availableProfiles
                        .filter(p => p.isSystem)
                        .map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name}
                          </option>
                        ))
                      }
                    </optgroup>
                  )}
                  
                  {/* Perfis Personalizados */}
                  {availableProfiles.filter(p => !p.isSystem).length > 0 && (
                    <optgroup label="Perfis Personalizados">
                      {availableProfiles
                        .filter(p => !p.isSystem)
                        .map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            📋 {profile.name}
                          </option>
                        ))
                      }
                    </optgroup>
                  )}
                </select>
                
                {/* Descrição do perfil selecionado */}
                {selectedProfile && (
                  <div className="mt-2 p-3 bg-slate-50 rounded-lg">
                    <p className="text-sm text-slate-700 font-medium">
                      {selectedProfile.name}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {selectedProfile.description}
                    </p>
                    {selectedProfile.tags && selectedProfile.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {selectedProfile.tags.slice(0, 3).map((tag, index) => (
                          <span
                            key={index}
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              /* FALLBACK: Seletor de Roles Antigo (quando perfis falham) */
              <>
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
                
                {/* Aviso de fallback */}
                <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-xs text-yellow-700">
                    ⚠️ Usando sistema básico de roles. Perfis personalizados temporariamente indisponíveis.
                  </p>
                </div>
              </>
            )}
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

                {/* Alterar Senha Diretamente */}
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  {!showDirectPasswordForm ? (
                    // Estado colapsado
                    <div className="flex items-center justify-between">
                      <div>
                        <h5 className="text-sm font-medium text-orange-900 mb-1">
                          Alterar Senha Diretamente
                        </h5>
                        <p className="text-sm text-orange-700">
                          Definir nova senha sem enviar email
                        </p>
                      </div>
                      <button
                        onClick={() => setShowDirectPasswordForm(true)}
                        className="px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded-md transition-colors"
                      >
                        Definir Senha
                      </button>
                    </div>
                  ) : (
                    // Estado expandido - Formulário
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h5 className="text-sm font-medium text-orange-900">
                          Definir Nova Senha
                        </h5>
                        <button
                          onClick={handleCancelDirectPassword}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Campos de senha */}
                      <div className="space-y-3">
                        <div className="relative">
                          <input
                            type={showNewPassword ? 'text' : 'password'}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="Nova senha (mín. 6 caracteres)"
                            className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                            disabled={directPasswordLoading}
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPassword(!showNewPassword)}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                            disabled={directPasswordLoading}
                          >
                            {showNewPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                        <div className="relative">
                          <input
                            type={showConfirmPassword ? 'text' : 'password'}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Confirmar nova senha"
                            className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                            disabled={directPasswordLoading}
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                            disabled={directPasswordLoading}
                          >
                            {showConfirmPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>

                        {/* Validações visuais */}
                        {(newPassword || confirmPassword) && (
                          <div className="text-xs space-y-1">
                            <div className={`${isPasswordValid ? 'text-green-600' : 'text-red-600'}`}>
                              {isPasswordValid ? '✓' : '×'} Mínimo 6 caracteres
                            </div>
                            {confirmPassword && (
                              <div className={`${doPasswordsMatch ? 'text-green-600' : 'text-red-600'}`}>
                                {doPasswordsMatch ? '✓' : '×'} Senhas coincidem
                              </div>
                            )}
                          </div>
                        )}

                        {/* Toggle de controle */}
                        <div className="bg-white border border-orange-200 rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <h6 className="text-sm font-medium text-gray-900 mb-1">
                                Forçar alteração no próximo acesso
                              </h6>
                              <p className="text-xs text-gray-600">
                                {forcePasswordChange 
                                  ? 'Usuário será obrigado a alterar a senha no próximo login'
                                  : 'Senha definida será permanente até próxima alteração'
                                }
                              </p>
                            </div>
                            <Toggle
                              checked={forcePasswordChange}
                              onChange={setForcePasswordChange}
                              disabled={directPasswordLoading}
                            />
                          </div>
                        </div>

                        {/* Botões */}
                        <div className="flex gap-2 pt-2">
                          <button
                            onClick={handleCancelDirectPassword}
                            disabled={directPasswordLoading}
                            className="flex-1 px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm rounded-md transition-colors disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={handleDirectPasswordChange}
                            disabled={!canSubmitPassword}
                            className="flex-1 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                          >
                            {directPasswordLoading ? (
                              <>
                                <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                                Alterando...
                              </>
                            ) : (
                              <>
                                <Lock className="w-3 h-3" />
                                {forcePasswordChange ? 'Definir Temporária' : 'Alterar Senha'}
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
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
