// =====================================================
// GESTÃO DE TEMPLATES - INTERFACE COMPLETA
// =====================================================

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, Crown, Shield, Briefcase, UserCheck, User, Tag, Eye, EyeOff, Settings, Save, CheckCircle, AlertTriangle } from 'lucide-react';
import { UserTemplate, UserRole } from '../../types/user';
import { getCompanyTemplates } from '../../services/userTemplates';
import { useAuth } from '../../contexts/AuthContext';
import { useAccessControl } from '../../hooks/useAccessControl';
import { PermissionsViewModal } from './PermissionsViewModal';

interface TemplateManagerProps {
  onCreateUser?: (templateId?: string) => void;
}

export const TemplateManager: React.FC<TemplateManagerProps> = ({ onCreateUser }) => {
  const { t } = useTranslation('settings.app');
  const { company } = useAuth();
  const { isSaaSAdmin } = useAccessControl();
  const [templates, setTemplates] = useState<UserTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewingTemplate, setViewingTemplate] = useState<UserTemplate | null>(null);
  
  // Estados para controle de visibilidade integrado
  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean>>({});
  const [savingChanges, setSavingChanges] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
      setError(t('users.states.templatesLoadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, [company?.id]);

  // Verificar se usuário pode configurar visibilidade
  const canConfigureVisibility = isSaaSAdmin;

  // NOVO: Toggle de visibilidade
  const toggleVisibility = (templateId: string, currentVisibility: boolean) => {
    const newVisibility = !currentVisibility;
    setPendingChanges(prev => ({
      ...prev,
      [templateId]: newVisibility
    }));
  };

  // NOVO: Salvar alterações de visibilidade
  const saveVisibilityChanges = async () => {
    try {
      setSavingChanges(true);
      setMessage(null);

      // TODO: Implementar salvamento real quando persistência for adicionada
      // Por enquanto, simular salvamento
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Atualizar templates localmente
      setTemplates(prev => prev.map(template => {
        if (pendingChanges.hasOwnProperty(template.id)) {
          return {
            ...template,
            visibleToChildCompanies: pendingChanges[template.id]
          };
        }
        return template;
      }));

      // Limpar alterações pendentes
      setPendingChanges({});
      
      const changesCount = Object.keys(pendingChanges).length;
      setMessage({ 
        type: 'success', 
        text: t('users.templates.messages.savedCount', { count: changesCount }) 
      });

      // Limpar mensagem após 3 segundos
      setTimeout(() => setMessage(null), 3000);

    } catch (error) {
      console.error('TemplateManager: Error saving visibility changes:', error);
      setMessage({ type: 'error', text: t('users.templates.messages.saveVisibilityError') });
    } finally {
      setSavingChanges(false);
    }
  };

  // NOVO: Descartar alterações
  const discardChanges = () => {
    setPendingChanges({});
    setMessage({ type: 'success', text: t('users.templates.messages.discarded') });
    setTimeout(() => setMessage(null), 2000);
  };

  // NOVO: Verificar se há alterações pendentes
  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

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

  const getRoleName = (role: UserRole | undefined): string =>
    role ? t(`users.roles.${role}`) : t('users.roles.user');

  // Criar usuário com template
  const handleCreateUserWithTemplate = (templateId: string) => {
    if (onCreateUser) {
      onCreateUser(templateId);
    }
  };

  // Separar templates por tipo
  const systemTemplates = templates.filter(t => t.isSystem);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-900">{t('users.sections.templates')}</h2>
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
          <h2 className="text-2xl font-bold text-slate-900">{t('users.sections.templates')}</h2>
          <p className="text-slate-600 mt-1">
            {t('users.subtitles.templates')}
          </p>
        </div>
        
        <div className="flex items-center space-x-3">
          {/* Controles de salvamento - Apenas quando há alterações pendentes */}
          {hasPendingChanges && canConfigureVisibility && (
            <>
              <button
                onClick={discardChanges}
                className="flex items-center space-x-2 px-3 py-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <span>{t('users.actions.discard')}</span>
              </button>
              <button
                onClick={saveVisibilityChanges}
                disabled={savingChanges}
                className="flex items-center space-x-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{savingChanges ? t('users.actions.saving') : t('users.actions.saveChanges')}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Erro */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600">{error}</p>
        </div>
      )}

      {/* Mensagem de feedback */}
      {message && (
        <div className={`p-4 rounded-lg flex items-center space-x-3 ${
          message.type === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          {message.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-green-600" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-red-600" />
          )}
          <span className={message.type === 'success' ? 'text-green-800' : 'text-red-800'}>
            {message.text}
          </span>
        </div>
      )}

      {/* Templates do Sistema */}
      <div className="space-y-4">
        <div className="flex items-center space-x-2">
          <h3 className="text-lg font-semibold text-slate-900">{t('users.sections.systemTemplates')}</h3>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
            {t('users.templates.badgePredefined')}
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
                  {t('users.templates.badgeSystem')}
                </span>
              </div>
              
              <p className="text-sm text-slate-600 mb-3">{template.description}</p>
              
              <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
                <span className="flex items-center space-x-1">
                  <Tag className="w-3 h-3" />
                  <span>{t('users.templates.baseLabel', { role: getRoleName(template.baseRole) })}</span>
                </span>
                {template.usage_count && (
                  <span className="flex items-center space-x-1">
                    <Users className="w-3 h-3" />
                    <span>{t('users.templates.usageCount', { count: template.usage_count })}</span>
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

              {/* Controle de Visibilidade - Apenas para Super Admin/Admin */}
              {canConfigureVisibility && (
                <div className="mb-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Settings className="w-4 h-4 text-slate-500" />
                      <span className="text-sm font-medium text-slate-700">
                        {t('users.templates.visibilityForChildren')}
                      </span>
                      {pendingChanges.hasOwnProperty(template.id) && (
                        <span className="px-2 py-0.5 bg-orange-100 text-orange-800 text-xs font-medium rounded">
                          {t('users.templates.badgeChanged')}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => toggleVisibility(template.id, 
                        pendingChanges.hasOwnProperty(template.id) 
                          ? pendingChanges[template.id] 
                          : template.visibleToChildCompanies ?? false
                      )}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                        (pendingChanges.hasOwnProperty(template.id) 
                          ? pendingChanges[template.id] 
                          : template.visibleToChildCompanies ?? false)
                          ? 'bg-blue-600' : 'bg-slate-200'
                      }`}
                      title={(pendingChanges.hasOwnProperty(template.id) 
                        ? pendingChanges[template.id] 
                        : template.visibleToChildCompanies ?? false) 
                        ? t('users.templates.visibilityOn') 
                        : t('users.templates.visibilityOff')}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          (pendingChanges.hasOwnProperty(template.id) 
                            ? pendingChanges[template.id] 
                            : template.visibleToChildCompanies ?? false)
                            ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {(pendingChanges.hasOwnProperty(template.id) 
                      ? pendingChanges[template.id] 
                      : template.visibleToChildCompanies ?? false) ? (
                      <span className="flex items-center space-x-1 text-green-600">
                        <Eye className="w-3 h-3" />
                        <span>{t('users.templates.visibilityHintOn')}</span>
                      </span>
                    ) : (
                      <span className="flex items-center space-x-1 text-slate-500">
                        <EyeOff className="w-3 h-3" />
                        <span>{t('users.templates.visibilityHintOff')}</span>
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Ações */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleCreateUserWithTemplate(template.id)}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors"
                >
                  {t('users.actions.useTemplate')}
                </button>
                <button
                  onClick={() => setViewingTemplate(template)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                  title={t('users.actions.viewPermissions')}
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Nota informativa: templates personalizados */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <div className="flex items-start space-x-2">
          <div className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center">
            <span className="text-xs font-medium text-slate-600">i</span>
          </div>
          <p className="text-sm text-slate-600">
            {t('users.templates.customComingSoon')}
          </p>
        </div>
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
            <p className="font-medium mb-1">{t('users.templates.aboutTitle')}</p>
            <ul className="space-y-1 text-xs">
              <li>{t('users.templates.aboutBullet1')}</li>
              <li>{t('users.templates.aboutBullet2')}</li>
              <li>{t('users.templates.aboutBullet3')}</li>
              <li>{t('users.templates.aboutBullet4')}</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Modal de Visualização de Permissões */}
      <PermissionsViewModal
        isOpen={!!viewingTemplate}
        onClose={() => setViewingTemplate(null)}
        profile={viewingTemplate}
      />
    </div>
  );
};
