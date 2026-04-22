import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { api } from '../services/api';
import { Company, supabase } from '../lib/supabase';
import { Plus, Building2, Users, TrendingUp, Trash2, Edit2, UserCog, LogIn, Key, Mail, Link, Clock, CalendarClock } from 'lucide-react';
import { openDirectEditCompanyModal } from './companies/openDirectEditCompanyModal';
import { PartnerAssignmentModal } from '../components/PartnerAssignmentModal';

interface TrialInfo {
  company_id:        string;
  is_internal_trial: boolean;
  trial_start:       string | null;
  trial_end:         string | null;
  trial_extended:    boolean;
  can_extend:        boolean;
  days_remaining:    number | null;
}

const EXTEND_ERROR_MSGS: Record<string, string> = {
  trial_already_extended: 'Este trial já foi estendido. Apenas 1 extensão por empresa.',
  not_internal_trial:     'Esta empresa já possui uma assinatura Stripe ativa.',
  trial_not_started:      'Esta empresa não possui trial iniciado.',
  trial_not_eligible:     'Esta empresa não está em estado elegível para extensão.',
  forbidden:              'Você não tem permissão para estender este trial.',
  company_not_found:      'Empresa não encontrada.',
};

export const Companies: React.FC = () => {
  const { t } = useTranslation('companies');
  const { impersonateUser, company: currentCompany } = useAuth();
  const { isSaaSAdmin, isSystemAdmin } = useAccessControl();
  const canManagePartners = isSaaSAdmin || isSystemAdmin;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [createdCompany, setCreatedCompany] = useState<any>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [managingCompany, setManagingCompany] = useState<Company | null>(null);
  const [partnerModalCompany, setPartnerModalCompany] = useState<Company | null>(null);

  // ── Trial state ──────────────────────────────────────────────────────────
  const [trialInfoMap, setTrialInfoMap] = useState<Record<string, TrialInfo | null>>({});
  const [trialLoadingIds, setTrialLoadingIds] = useState<string[]>([]);
  const [extendModalCompany, setExtendModalCompany] = useState<Company | null>(null);
  const [extending, setExtending] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [extendSuccess, setExtendSuccess] = useState(false);
  const [userFormData, setUserFormData] = useState({
    email: '',
    newPassword: ''
  });
  const [formData, setFormData] = useState({
    name: '',
    domain: '',
    plan: 'basic' as 'basic' | 'pro' | 'enterprise',
    adminEmail: '',
    adminPassword: '',
    sendInviteEmail: true
  });

  useEffect(() => {
    if (isSaaSAdmin || isSystemAdmin) {
      loadCompanies();
    }
  }, [isSaaSAdmin, isSystemAdmin]);

  const loadCompanies = async () => {
    if (!isSaaSAdmin && !isSystemAdmin) {
      return;
    }

    try {
      const data = await api.getAllCompanies();
      setCompanies(data);
      // Buscar trial info para empresas cliente (não bloqueia o render)
      const clients = (data as any[]).filter(c => c.company_type === 'client');
      clients.forEach(c => fetchTrialInfo(c.id));
    } catch (error) {
      console.error('Error loading companies:', error);
    } finally {
      setLoading(false);
    }
  };

  // ── Trial: buscar info por empresa cliente ───────────────────────────────
  const fetchTrialInfo = async (companyId: string) => {
    setTrialLoadingIds(prev => [...prev, companyId]);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;

      const res = await fetch(`/api/admin/trials/info?company_id=${companyId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data: TrialInfo = await res.json();
      setTrialInfoMap(prev => ({ ...prev, [companyId]: data }));
    } catch {
      // Silencioso — não bloqueia a UI
    } finally {
      setTrialLoadingIds(prev => prev.filter(id => id !== companyId));
    }
  };

  // ── Trial: executar extensão via modal de confirmação ────────────────────
  const handleExtendTrial = async () => {
    if (!extendModalCompany) return;
    setExtending(true);
    setExtendError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Sessão inválida');

      const res = await fetch('/api/admin/trials/extend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ company_id: extendModalCompany.id }),
      });

      const json = await res.json();

      if (!res.ok) {
        const msg = EXTEND_ERROR_MSGS[json?.error] ?? 'Erro ao estender trial. Tente novamente.';
        setExtendError(msg);
        return;
      }

      setExtendSuccess(true);
      // Refetch para manter badge consistente com o banco
      await fetchTrialInfo(extendModalCompany.id);
      setTimeout(() => {
        setExtendModalCompany(null);
        setExtendSuccess(false);
        setExtendError(null);
      }, 2200);
    } catch {
      setExtendError('Erro interno ao processar extensão.');
    } finally {
      setExtending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;

    try {
      if (editingCompany) {
        await api.updateClientCompany(editingCompany.id, {
          name: formData.name,
          domain: formData.domain,
          plan: formData.plan
        });
        setShowModal(false);
      } else {
        const result = await api.createClientCompany(company.id, formData);
        setCreatedCompany(result);
      }

      setFormData({ name: '', domain: '', plan: 'basic', adminEmail: '', adminPassword: '', sendInviteEmail: true });
      setEditingCompany(null);
      loadCompanies();
    } catch (error) {
      console.error('Error saving company:', error);
      alert(t('messages.createError', { message: (error as Error).message }));
    }
  };

  const handleDelete = async (companyId: string) => {
    if (!confirm(t('confirms.deleteCompany'))) return;

    try {
      await api.deleteClientCompany(companyId);
      loadCompanies();
    } catch (error) {
      console.error('Error deleting company:', error);
    }
  };

  const handleImpersonate = async (companyId: string) => {
    const targetCompany = companies.find(comp => comp.id === companyId);
    if (!confirm(t('confirms.impersonate', { name: targetCompany?.name ?? '' }))) return;

    try {
      await impersonateUser(companyId);

      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 500);
    } catch (error) {
      console.error('Error impersonating user:', error);
      alert(t('messages.impersonateError', { message: (error as Error).message }));
    }
  };

  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managingCompany) return;

    try {
      if (!managingCompany.user_id) {
        try {
          await api.createMockUserForCompany(managingCompany.id, userFormData.email);

          alert(
            t('alerts.credentialsCreated', {
              email: userFormData.email,
              password: userFormData.newPassword,
              origin: window.location.origin,
              companyName: managingCompany.name,
            })
          );

        } catch (error) {
          console.error('Erro ao criar usuário mock:', error);
          alert(t('alerts.createUserError', { message: (error as Error).message }));
          return;
        }

      } else {
        if (userFormData.email !== managingCompany.name) {
          alert(t('alerts.emailChanged', { email: userFormData.email }));
        }

        if (userFormData.newPassword) {
          alert(t('alerts.passwordChanged'));
        }
      }

      setShowUserModal(false);
      setManagingCompany(null);
      setUserFormData({ email: '', newPassword: '' });

      loadCompanies();
    } catch (error) {
      console.error('Error updating user:', error);
      alert(t('alerts.updateUserError', { message: (error as Error).message }));
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'suspended': return 'bg-yellow-100 text-yellow-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const planLabel = (comp: Company & { plans?: { name: string; slug: string } | null }) => {
    // Prioridade: nome real do plano via plan_id (join com plans)
    if ((comp as any).plans?.name) return (comp as any).plans.name;
    // Fallback: mapeamento do campo legado
    switch (comp.plan) {
      case 'basic':
        return t('planLabels.basic');
      case 'pro':
        return t('planLabels.pro');
      case 'enterprise':
        return t('planLabels.enterprise');
      default:
        return comp.plan ?? '—';
    }
  };

  const statusLabel = (status: string) => {
    if (status === 'active') return t('status.active');
    if (status === 'suspended') return t('status.suspended');
    return t('status.cancelled');
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" role="status" aria-label={t('states.loading')}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" aria-hidden />
      </div>
    );
  }


  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{t('header.title')}</h1>
          <p className="text-slate-600 mt-1">{t('header.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('actions.create')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {companies.map((comp) => (
          <div key={comp.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Building2 className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">{comp.name}</h3>
                  <p className="text-sm text-slate-600">{comp.domain}</p>
                </div>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(comp.status)}`}>
                {statusLabel(comp.status)}
              </span>
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Users className="w-4 h-4" />
                <span>{t('card.plan', { plan: planLabel(comp as any) })}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <TrendingUp className="w-4 h-4" />
                <span>
                  {t('card.createdAt', {
                    date: new Date(comp.created_at).toLocaleDateString('pt-BR'),
                    interpolation: { escapeValue: false },
                  })}
                </span>
              </div>
            </div>

            {/* ── Badge de trial ──────────────────────────────────────── */}
            {(comp as any).company_type === 'client' && (() => {
              const info = trialInfoMap[comp.id];
              const isLoading = trialLoadingIds.includes(comp.id);

              if (isLoading) {
                return <div className="h-5 w-36 mb-3 bg-slate-100 animate-pulse rounded-full" />;
              }
              if (!info) return null;

              const isActiveTrial  = info.is_internal_trial;
              const isExpiredTrial = !isActiveTrial && !!info.trial_end && info.can_extend;
              const wasExtended    = !isActiveTrial && info.trial_extended && !!info.trial_end;

              if (!isActiveTrial && !isExpiredTrial && !wasExtended) return null;

              return (
                <div className="mb-3 flex items-center justify-between gap-2">
                  {isActiveTrial ? (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      (info.days_remaining ?? 99) <= 3
                        ? 'bg-red-100 text-red-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      <Clock className="w-3 h-3" />
                      {info.days_remaining === 0
                        ? 'Trial expira hoje'
                        : `Trial — ${info.days_remaining} dia(s)`}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                      <Clock className="w-3 h-3" />
                      Trial expirado
                    </span>
                  )}
                  {info.trial_extended && (
                    <span className="text-xs text-slate-400">Já estendido</span>
                  )}
                </div>
              );
            })()}

            {/* ── Botão Estender Trial ────────────────────────────────── */}
            {(comp as any).company_type === 'client' && trialInfoMap[comp.id]?.can_extend && (
              <button
                type="button"
                onClick={() => {
                  setExtendModalCompany(comp);
                  setExtendError(null);
                  setExtendSuccess(false);
                }}
                className="w-full mb-3 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <CalendarClock className="w-4 h-4" />
                Estender Trial (+14 dias)
              </button>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleImpersonate(comp.id)}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <LogIn className="w-4 h-4" />
                {t('actions.enter')}
              </button>
              {canManagePartners && comp.company_type === 'client' && (
                <button
                  type="button"
                  aria-label={t('actions.managePartners')}
                  onClick={() => setPartnerModalCompany(comp)}
                  className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  <Link className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                aria-label={t('actions.manageUser')}
                onClick={() => {
                  setManagingCompany(comp);
                  setUserFormData({ email: '', newPassword: '' });
                  setShowUserModal(true);
                }}
                className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <UserCog className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label={t('actions.editCompany')}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openDirectEditCompanyModal(comp);
                }}
                className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label={t('actions.deleteCompany')}
                onClick={() => handleDelete(comp.id)}
                className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal de criação/edição de empresa */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-xl font-semibold text-slate-900">
                {editingCompany ? t('modals.editTitle') : t('modals.createTitle')}
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t('modals.companyName')}
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t('modals.domainOptional')}
                </label>
                <input
                  type="text"
                  value={formData.domain}
                  onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder={t('modals.domainPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t('modals.plan')}
                </label>
                <select
                  value={formData.plan}
                  onChange={(e) => setFormData({ ...formData, plan: e.target.value as any })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="basic">{t('planLabels.basic')}</option>
                  <option value="pro">{t('planLabels.pro')}</option>
                  <option value="enterprise">{t('planLabels.enterprise')}</option>
                </select>
              </div>

              {!editingCompany && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      {t('modals.adminEmail')}
                    </label>
                    <input
                      type="email"
                      value={formData.adminEmail}
                      onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required={!editingCompany}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      {t('modals.adminPassword')}
                    </label>
                    <input
                      type="password"
                      value={formData.adminPassword}
                      onChange={(e) => setFormData({ ...formData, adminPassword: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required={!editingCompany}
                      minLength={6}
                    />
                  </div>

                  {/* 🔧 NOVO: Opção de envio automático de convite */}
                  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <input
                      type="checkbox"
                      id="sendInviteEmail"
                      checked={formData.sendInviteEmail}
                      onChange={(e) => setFormData({ ...formData, sendInviteEmail: e.target.checked })}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                    />
                    <label htmlFor="sendInviteEmail" className="text-sm font-medium text-blue-800">
                      {t('modals.sendInviteAuto')}
                    </label>
                  </div>
                  
                  {formData.sendInviteEmail && (
                    <div className="text-xs text-blue-600 bg-blue-50 p-2 rounded border border-blue-200">
                      {t('modals.inviteAutoHint')}
                    </div>
                  )}
                  
                  {!formData.sendInviteEmail && (
                    <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">
                      {t('modals.inviteManualHint')}
                    </div>
                  )}
                </>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingCompany(null);
                    setFormData({ name: '', domain: '', plan: 'basic', adminEmail: '', adminPassword: '', sendInviteEmail: true });
                  }}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  {t('actions.cancel')}
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {editingCompany ? t('actions.save') : t('actions.createSubmit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de gerenciamento de usuário */}
      {showUserModal && managingCompany && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-xl font-semibold text-slate-900">
                {t('userModal.title', { name: managingCompany.name })}
              </h2>
            </div>

            <form onSubmit={handleUserSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <Mail className="w-4 h-4 inline mr-2" />
                  {t('userModal.userEmail')}
                </label>
                <input
                  type="email"
                  value={userFormData.email}
                  onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  required
                  placeholder={t('userModal.emailPlaceholder')}
                />
                <p className="text-xs text-slate-500 mt-1">
                  {t('userModal.emailHint')}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <Key className="w-4 h-4 inline mr-2" />
                  {t('userModal.newPasswordOptional')}
                </label>
                <input
                  type="password"
                  value={userFormData.newPassword}
                  onChange={(e) => setUserFormData({ ...userFormData, newPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  minLength={6}
                  placeholder={t('userModal.passwordPlaceholder')}
                />
                <p className="text-xs text-slate-500 mt-1">
                  {t('userModal.passwordHint')}
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">{t('userModal.infoTitle')}</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>{t('userModal.infoBullet1')}</li>
                  <li>{t('userModal.infoBullet2')}</li>
                  <li>{t('userModal.infoBullet3')}</li>
                </ul>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowUserModal(false);
                    setManagingCompany(null);
                    setUserFormData({ email: '', newPassword: '' });
                  }}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  {t('actions.cancel')}
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                >
                  {t('actions.saveChanges')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {partnerModalCompany && currentCompany && (
        <PartnerAssignmentModal
          company={partnerModalCompany}
          parentCompanyId={currentCompany.id}
          onClose={() => setPartnerModalCompany(null)}
        />
      )}

      {/* ── Modal de extensão de trial ──────────────────────────────────── */}
      {extendModalCompany && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-200 flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <CalendarClock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Estender Trial</h2>
                <p className="text-sm text-slate-500">{extendModalCompany.name}</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {extendSuccess ? (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                    <CalendarClock className="w-6 h-6 text-green-600" />
                  </div>
                  <p className="font-medium text-green-800">Trial estendido com sucesso!</p>
                  <p className="text-sm text-slate-500">O período de teste foi renovado por mais 14 dias.</p>
                </div>
              ) : (
                <>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p className="text-sm text-amber-800">
                      Deseja estender o período de trial de{' '}
                      <strong>{extendModalCompany.name}</strong> por mais{' '}
                      <strong>14 dias</strong>?
                    </p>
                    <p className="text-xs text-amber-600 mt-2">
                      Esta ação é permitida apenas 1 vez por empresa e não pode ser desfeita.
                    </p>
                  </div>

                  {extendError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="text-sm text-red-700">{extendError}</p>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setExtendModalCompany(null);
                        setExtendError(null);
                      }}
                      disabled={extending}
                      className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleExtendTrial}
                      disabled={extending}
                      className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium disabled:opacity-50 transition-colors"
                    >
                      {extending ? 'Processando...' : 'Confirmar Extensão'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {createdCompany && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-xl font-semibold text-slate-900">{t('successModal.title')}</h2>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-medium text-green-900 mb-2">{t('successModal.successTitle')}</h3>
                <div className="space-y-2 text-sm text-green-800">
                  <p>
                    <strong>{t('successModal.labelName')}</strong> {createdCompany.name}
                  </p>
                  <p>
                    <strong>{t('successModal.labelApiKey')}</strong>{' '}
                    <code className="bg-green-100 px-2 py-1 rounded">{createdCompany.api_key}</code>
                  </p>
                </div>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">{t('successModal.nextStepsTitle')}</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>{t('successModal.nextStep1')}</li>
                  <li>{t('successModal.nextStep2')}</li>
                  <li>{t('successModal.nextStep3')}</li>
                </ul>
              </div>
              
              <button
                type="button"
                onClick={() => setCreatedCompany(null)}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {t('actions.gotIt')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
