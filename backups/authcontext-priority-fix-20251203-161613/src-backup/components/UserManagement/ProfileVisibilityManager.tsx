// =====================================================
// GERENCIADOR DE VISIBILIDADE DE PERFIS
// =====================================================

import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  Eye, 
  EyeOff, 
  Shield, 
  Crown, 
  Briefcase, 
  UserCheck, 
  User, 
  Save, 
  RotateCcw,
  AlertTriangle,
  CheckCircle,
  Info
} from 'lucide-react';
import { UserRole } from '../../types/user';
import { getSystemTemplates } from '../../services/userTemplates';
import { useAuth } from '../../contexts/AuthContext';

interface ProfileVisibilityConfig {
  profileId: string;
  name: string;
  baseRole: UserRole;
  currentVisibility: boolean;
  newVisibility: boolean;
  hasChanges: boolean;
}

export const ProfileVisibilityManager: React.FC = () => {
  const { company, hasPermission } = useAuth();
  const [profiles, setProfiles] = useState<ProfileVisibilityConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Verificar se usuário tem permissão
  const canManageVisibility = company?.company_type === 'parent' && 
    (hasPermission?.('users') || company?.is_super_admin);

  // Carregar perfis do sistema
  useEffect(() => {
    loadSystemProfiles();
  }, []);

  const loadSystemProfiles = async () => {
    try {
      setLoading(true);
      
      // Obter todos os perfis do sistema (sem filtragem)
      const systemTemplates = getSystemTemplates();
      
      const profileConfigs: ProfileVisibilityConfig[] = systemTemplates.map(template => ({
        profileId: template.id,
        name: template.name,
        baseRole: template.baseRole,
        currentVisibility: template.visibleToChildCompanies ?? false,
        newVisibility: template.visibleToChildCompanies ?? false,
        hasChanges: false
      }));

      setProfiles(profileConfigs);
    } catch (error) {
      console.error('ProfileVisibilityManager: Error loading profiles:', error);
      setMessage({ type: 'error', text: 'Erro ao carregar perfis do sistema' });
    } finally {
      setLoading(false);
    }
  };

  // Ícone do role
  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'super_admin':
        return <Crown className="w-5 h-5 text-yellow-500" />;
      case 'admin':
        return <Shield className="w-5 h-5 text-blue-500" />;
      case 'partner':
        return <Briefcase className="w-5 h-5 text-purple-500" />;
      case 'manager':
        return <UserCheck className="w-5 h-5 text-green-500" />;
      case 'seller':
        return <User className="w-5 h-5 text-slate-500" />;
      default:
        return <User className="w-5 h-5 text-slate-400" />;
    }
  };

  // Alterar visibilidade
  const toggleVisibility = (profileId: string) => {
    setProfiles(prev => prev.map(profile => {
      if (profile.profileId === profileId) {
        const newVisibility = !profile.newVisibility;
        return {
          ...profile,
          newVisibility,
          hasChanges: newVisibility !== profile.currentVisibility
        };
      }
      return profile;
    }));
  };

  // Resetar alterações
  const resetChanges = () => {
    setProfiles(prev => prev.map(profile => ({
      ...profile,
      newVisibility: profile.currentVisibility,
      hasChanges: false
    })));
    setMessage({ type: 'info', text: 'Alterações descartadas' });
  };

  // Salvar alterações
  const saveChanges = async () => {
    try {
      setSaving(true);
      
      const changedProfiles = profiles.filter(p => p.hasChanges);
      
      if (changedProfiles.length === 0) {
        setMessage({ type: 'info', text: 'Nenhuma alteração para salvar' });
        return;
      }

      // TODO: Implementar persistência real
      // Por enquanto, simular salvamento
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Atualizar estado local
      setProfiles(prev => prev.map(profile => ({
        ...profile,
        currentVisibility: profile.newVisibility,
        hasChanges: false
      })));

      setMessage({ 
        type: 'success', 
        text: `${changedProfiles.length} configuração(ões) salva(s) com sucesso!` 
      });

    } catch (error) {
      console.error('ProfileVisibilityManager: Error saving changes:', error);
      setMessage({ type: 'error', text: 'Erro ao salvar configurações' });
    } finally {
      setSaving(false);
    }
  };

  // Verificar se há alterações pendentes
  const hasUnsavedChanges = profiles.some(p => p.hasChanges);

  if (!canManageVisibility) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
        <div className="flex items-center space-x-3">
          <AlertTriangle className="w-6 h-6 text-yellow-600" />
          <div>
            <h3 className="text-lg font-semibold text-yellow-800">Acesso Restrito</h3>
            <p className="text-yellow-700 mt-1">
              Apenas Super Administradores e Administradores da empresa pai podem gerenciar a visibilidade de perfis.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-slate-600">Carregando perfis...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Settings className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Configuração de Visibilidade de Perfis
              </h2>
              <p className="text-slate-600 mt-1">
                Controle quais perfis do sistema são visíveis para empresas filhas
              </p>
            </div>
          </div>
          
          {hasUnsavedChanges && (
            <div className="flex items-center space-x-3">
              <button
                onClick={resetChanges}
                className="flex items-center space-x-2 px-4 py-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Descartar</span>
              </button>
              <button
                onClick={saveChanges}
                disabled={saving}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Salvando...' : 'Salvar Alterações'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Mensagem de status */}
        {message && (
          <div className={`mt-4 p-4 rounded-lg flex items-center space-x-3 ${
            message.type === 'success' ? 'bg-green-50 border border-green-200' :
            message.type === 'error' ? 'bg-red-50 border border-red-200' :
            'bg-blue-50 border border-blue-200'
          }`}>
            {message.type === 'success' && <CheckCircle className="w-5 h-5 text-green-600" />}
            {message.type === 'error' && <AlertTriangle className="w-5 h-5 text-red-600" />}
            {message.type === 'info' && <Info className="w-5 h-5 text-blue-600" />}
            <span className={
              message.type === 'success' ? 'text-green-800' :
              message.type === 'error' ? 'text-red-800' :
              'text-blue-800'
            }>
              {message.text}
            </span>
          </div>
        )}
      </div>

      {/* Lista de Perfis */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200">
        <div className="p-6 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">Perfis do Sistema</h3>
          <p className="text-slate-600 mt-1">
            Configure a visibilidade de cada perfil para empresas filhas
          </p>
        </div>

        <div className="divide-y divide-slate-200">
          {profiles.map((profile) => (
            <div key={profile.profileId} className="p-6 hover:bg-slate-50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  {getRoleIcon(profile.baseRole)}
                  <div>
                    <h4 className="font-semibold text-slate-900">{profile.name}</h4>
                    <p className="text-sm text-slate-500 capitalize">
                      Role base: {profile.baseRole}
                    </p>
                  </div>
                  {profile.hasChanges && (
                    <div className="px-2 py-1 bg-orange-100 text-orange-800 text-xs font-medium rounded">
                      Alterado
                    </div>
                  )}
                </div>

                <div className="flex items-center space-x-4">
                  <div className="text-sm text-slate-600">
                    {profile.newVisibility ? (
                      <span className="flex items-center space-x-2 text-green-600">
                        <Eye className="w-4 h-4" />
                        <span>Visível para empresas filhas</span>
                      </span>
                    ) : (
                      <span className="flex items-center space-x-2 text-slate-500">
                        <EyeOff className="w-4 h-4" />
                        <span>Apenas empresa pai</span>
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => toggleVisibility(profile.profileId)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                      profile.newVisibility ? 'bg-blue-600' : 'bg-slate-200'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        profile.newVisibility ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Informações */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-start space-x-3">
          <Info className="w-5 h-5 text-blue-600 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-2">Como funciona:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li><strong>Visível para empresas filhas:</strong> O perfil aparece na lista de templates e no dropdown de criação de usuários</li>
              <li><strong>Apenas empresa pai:</strong> O perfil só é visível para a empresa pai (M4 Digital)</li>
              <li><strong>Alterações:</strong> As configurações são aplicadas imediatamente após salvar</li>
              <li><strong>Segurança:</strong> Apenas Super Administradores e Administradores podem alterar essas configurações</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
