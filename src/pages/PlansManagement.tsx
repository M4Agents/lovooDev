import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccessControl } from '../hooks/useAccessControl';
import { supabase } from '../lib/supabase';
import {
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  Users,
  MessageSquare,
  Star,
  Eye,
  EyeOff,
  Cpu,
  Zap,
  Globe,
  EyeOff as EyeOffIcon,
  CheckCircle,
  Clock,
  XCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface PlanChangeRequest {
  id: string;
  company_id: string;
  company_name: string;
  from_plan_id: string | null;
  from_plan_name: string | null;
  to_plan_id: string;
  to_plan_name: string;
  status: string;
  notes: string | null;
  created_at: string;
}

interface Plan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number | null;
  currency: string;
  billing_cycle: string;
  is_active: boolean;
  is_popular: boolean;
  is_publicly_listed: boolean;
  sort_order: number;
  // Limites CRM (NULL = ilimitado)
  max_whatsapp_instances: number | null;
  max_leads: number | null;
  max_users: number | null;
  max_landing_pages: number | null;
  max_funnels: number | null;
  max_funnel_stages: number | null;
  max_automation_flows: number | null;
  max_automation_executions_monthly: number | null;
  max_products: number | null;
  storage_mb: number | null;
  // Features JSONB (chaves com sufixo _enabled)
  features: Record<string, boolean>;
  // Stripe (somente admin — nunca exposto para empresas finais)
  stripe_price_id_monthly: string | null;
  // Plano de IA vinculado (via JOIN em get_plans_full)
  ai_plan_id: string | null;
  ai_plan_name: string | null;
  ai_plan_slug: string | null;
  ai_plan_monthly_credits: number | null;
  ai_plan_internal_price: number | null;
  estimated_conversations: number | null;
  created_at: string;
  updated_at: string;
}

interface AiPlanOption {
  id: string;
  name: string;
  slug: string;
  monthly_credits: number;
  is_active: boolean;
}

interface PlanFormData {
  name: string;
  slug: string;
  description: string;
  price: string;           // string para input controlado (suporta valor vazio / Elite)
  currency: string;
  billing_cycle: string;
  is_active: boolean;
  is_popular: boolean;
  is_publicly_listed: boolean;
  sort_order: number;
  // Limites CRM
  max_whatsapp_instances: string;
  max_leads: string;
  max_users: string;
  max_landing_pages: string;
  max_funnels: string;
  max_funnel_stages: string;
  max_automation_flows: string;
  max_automation_executions_monthly: string;
  max_products: string;
  storage_mb: string;
  // Features booleanas (JSONB)
  opportunity_items_enabled: boolean;
  multiple_agents_enabled: boolean;
  follow_up_agent_enabled: boolean;
  scheduling_agent_enabled: boolean;
  cycle_report_enabled: boolean;
  advanced_debug_logs_enabled: boolean;
  dashboard_insight_customization_enabled: boolean;
  // Plano de IA
  ai_plan_id: string;
  // Stripe (somente admin)
  stripe_price_id_monthly: string;
  // Visibilidade
  is_publicly_listed: boolean;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const FEATURE_FLAGS: { key: keyof PlanFormData; label: string }[] = [
  { key: 'opportunity_items_enabled',                label: 'Itens em Oportunidades' },
  { key: 'multiple_agents_enabled',                  label: 'Múltiplos Agentes de IA' },
  { key: 'follow_up_agent_enabled',                  label: 'Agente de Follow-up' },
  { key: 'scheduling_agent_enabled',                 label: 'Agente de Agendamento' },
  { key: 'cycle_report_enabled',                     label: 'Relatório de Ciclo de Vendas' },
  { key: 'advanced_debug_logs_enabled',              label: 'Logs Avançados de Debug' },
  { key: 'dashboard_insight_customization_enabled',  label: 'Configuração de Regras de Insights' },
];

const EMPTY_FORM: PlanFormData = {
  name: '',
  slug: '',
  description: '',
  price: '',
  currency: 'BRL',
  billing_cycle: 'monthly',
  is_active: true,
  is_popular: false,
  is_publicly_listed: false,
  sort_order: 0,
  max_whatsapp_instances: '',
  max_leads: '',
  max_users: '',
  max_landing_pages: '',
  max_funnels: '',
  max_funnel_stages: '',
  max_automation_flows: '',
  max_automation_executions_monthly: '',
  max_products: '',
  storage_mb: '',
  opportunity_items_enabled: false,
  multiple_agents_enabled: false,
  follow_up_agent_enabled: false,
  scheduling_agent_enabled: false,
  cycle_report_enabled: false,
  advanced_debug_logs_enabled: false,
  dashboard_insight_customization_enabled: false,
  ai_plan_id: '',
  stripe_price_id_monthly: '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toInt = (v: string): number | null => {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
};

const toFloat = (v: string): number | null => {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

const displayLimit = (v: number | null): string =>
  v === null ? 'Ilimitado' : v.toLocaleString('pt-BR');

const generateSlug = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

const featuresFromPlan = (plan: Plan): Partial<PlanFormData> => ({
  opportunity_items_enabled:                  !!plan.features?.opportunity_items_enabled,
  multiple_agents_enabled:                    !!plan.features?.multiple_agents_enabled,
  follow_up_agent_enabled:                    !!plan.features?.follow_up_agent_enabled,
  scheduling_agent_enabled:                   !!plan.features?.scheduling_agent_enabled,
  cycle_report_enabled:                       !!plan.features?.cycle_report_enabled,
  advanced_debug_logs_enabled:                !!plan.features?.advanced_debug_logs_enabled,
  dashboard_insight_customization_enabled:    !!plan.features?.dashboard_insight_customization_enabled,
});

// ─── Componente ───────────────────────────────────────────────────────────────

export const PlansManagement: React.FC = () => {
  const { t } = useTranslation('plans');
  const { isSaaSAdmin } = useAccessControl();

  const [plans, setPlans]       = useState<Plan[]>([]);
  const [aiPlans, setAiPlans]   = useState<AiPlanOption[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [formData, setFormData] = useState<PlanFormData>(EMPTY_FORM);

  // Solicitações de mudança de plano
  const [requests, setRequests]         = useState<PlanChangeRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [processingRequest, setProcessingRequest] = useState<string | null>(null);

  // ── Carregar dados ──────────────────────────────────────────────────────────

  const loadPlans = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // get_plans_full() retorna plans CRM + JOIN ai_plans
      const { data, error: rpcError } = await supabase.rpc('get_plans_full');
      if (rpcError) throw new Error(rpcError.message);

      const normalized = (data || []).map((p: any) => ({
        ...p,
        features: typeof p.features === 'object' && !Array.isArray(p.features)
          ? p.features
          : {},
      }));

      setPlans(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadAiPlans = useCallback(async () => {
    try {
      const { data, error: rpcError } = await supabase.rpc('get_ai_plans_admin');
      if (rpcError) throw new Error(rpcError.message);
      setAiPlans((data || []).filter((a: AiPlanOption) => a.is_active));
    } catch {
      // Não bloqueia a tela — campo de seleção ficará vazio
    }
  }, []);

  useEffect(() => {
    if (isSaaSAdmin) {
      loadPlans();
      loadAiPlans();
    }
  }, [isSaaSAdmin, loadPlans, loadAiPlans]);

  // Auto-slug no create
  useEffect(() => {
    if (!editingPlan && formData.name) {
      setFormData(prev => ({ ...prev, slug: generateSlug(prev.name) }));
    }
  }, [formData.name, editingPlan]);

  // ── Modal helpers ───────────────────────────────────────────────────────────

  const openCreateModal = () => {
    setEditingPlan(null);
    setFormData({ ...EMPTY_FORM, sort_order: plans.length + 1 });
    setShowModal(true);
  };

  const openEditModal = (plan: Plan) => {
    setEditingPlan(plan);
    setFormData({
      name:          plan.name,
      slug:          plan.slug,
      description:   plan.description ?? '',
      price:         plan.price != null ? String(plan.price) : '',
      currency:      plan.currency,
      billing_cycle: plan.billing_cycle,
      is_active:            plan.is_active,
      is_popular:           plan.is_popular,
      is_publicly_listed:   plan.is_publicly_listed,
      sort_order:           plan.sort_order,
      max_whatsapp_instances:            plan.max_whatsapp_instances != null ? String(plan.max_whatsapp_instances) : '',
      max_leads:                         plan.max_leads != null ? String(plan.max_leads) : '',
      max_users:                         plan.max_users != null ? String(plan.max_users) : '',
      max_landing_pages:                 plan.max_landing_pages != null ? String(plan.max_landing_pages) : '',
      max_funnels:                       plan.max_funnels != null ? String(plan.max_funnels) : '',
      max_funnel_stages:                 plan.max_funnel_stages != null ? String(plan.max_funnel_stages) : '',
      max_automation_flows:              plan.max_automation_flows != null ? String(plan.max_automation_flows) : '',
      max_automation_executions_monthly: plan.max_automation_executions_monthly != null ? String(plan.max_automation_executions_monthly) : '',
      max_products:                      plan.max_products != null ? String(plan.max_products) : '',
      storage_mb:                        plan.storage_mb != null ? String(plan.storage_mb) : '',
      ai_plan_id:                plan.ai_plan_id ?? '',
      stripe_price_id_monthly:   plan.stripe_price_id_monthly ?? '',
      ...featuresFromPlan(plan),
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingPlan(null);
    setError(null);
  };

  const setField = <K extends keyof PlanFormData>(key: K, value: PlanFormData[K]) =>
    setFormData(prev => ({ ...prev, [key]: value }));

  // ── Salvar ──────────────────────────────────────────────────────────────────

  const savePlan = async () => {
    try {
      setSaving(true);
      setError(null);

      const stripeId = formData.stripe_price_id_monthly.trim();
      if (stripeId && !stripeId.startsWith('price_')) {
        setError('O Stripe Price ID deve começar com "price_" (ex: price_1Abc...)');
        setSaving(false);
        return;
      }

      const featuresJsonb = {
        opportunity_items_enabled:                 formData.opportunity_items_enabled,
        multiple_agents_enabled:                   formData.multiple_agents_enabled,
        follow_up_agent_enabled:                   formData.follow_up_agent_enabled,
        scheduling_agent_enabled:                  formData.scheduling_agent_enabled,
        cycle_report_enabled:                      formData.cycle_report_enabled,
        advanced_debug_logs_enabled:               formData.advanced_debug_logs_enabled,
        dashboard_insight_customization_enabled:   formData.dashboard_insight_customization_enabled,
      };

      let planId = editingPlan?.id;

      if (editingPlan) {
        const { data, error: rpcError } = await supabase.rpc('update_plan', {
          p_plan_id:                         editingPlan.id,
          p_name:                            formData.name,
          p_slug:                            formData.slug,
          p_description:                     formData.description || null,
          p_price:                           toFloat(formData.price),
          p_currency:                        formData.currency,
          p_billing_cycle:                   formData.billing_cycle,
          p_max_whatsapp_instances:          toInt(formData.max_whatsapp_instances),
          p_max_landing_pages:               toInt(formData.max_landing_pages),
          p_max_leads:                       toInt(formData.max_leads),
          p_max_users:                       toInt(formData.max_users),
          p_features:                        featuresJsonb,
          p_is_active:                       formData.is_active,
          p_is_popular:                      formData.is_popular,
          p_sort_order:                      formData.sort_order,
          p_stripe_price_id_monthly:         stripeId || null,
        });
        if (rpcError) throw new Error(rpcError.message);
        if (!data?.success) throw new Error(data?.error || t('errors.save'));
      } else {
        const { data, error: rpcError } = await supabase.rpc('create_plan', {
          p_name:                   formData.name,
          p_slug:                   formData.slug,
          p_description:            formData.description || null,
          p_price:                  toFloat(formData.price) ?? 0,
          p_currency:               formData.currency,
          p_billing_cycle:          formData.billing_cycle,
          p_max_whatsapp_instances: toInt(formData.max_whatsapp_instances) ?? 1,
          p_max_landing_pages:      toInt(formData.max_landing_pages),
          p_max_leads:              toInt(formData.max_leads),
          p_max_users:              toInt(formData.max_users),
          p_features:               featuresJsonb,
          p_is_active:              formData.is_active,
          p_is_popular:             formData.is_popular,
          p_sort_order:             formData.sort_order,
          p_stripe_price_id_monthly: stripeId || null,
        });
        if (rpcError) throw new Error(rpcError.message);
        if (!data?.success) throw new Error(data?.error || t('errors.save'));
        planId = data.plan_id;
      }

      // Vincular plano de IA (ai_plan_id)
      if (planId) {
        const aiPlanChanged = !editingPlan || editingPlan.ai_plan_id !== (formData.ai_plan_id || null);
        if (aiPlanChanged) {
          const { data: linkData, error: linkError } = await supabase.rpc('update_plan_with_ai_plan', {
            p_plan_id:    planId,
            p_ai_plan_id: formData.ai_plan_id || null,
          });
          if (linkError) throw new Error(linkError.message);
          if (!linkData?.success) throw new Error(linkData?.error || 'Erro ao vincular plano de IA');
        }

        // Persistir is_publicly_listed via RPC dedicada (campo não coberto pelo update_plan genérico)
        const publicListedChanged = !editingPlan || editingPlan.is_publicly_listed !== formData.is_publicly_listed;
        if (publicListedChanged) {
          const { data: plData, error: plError } = await supabase.rpc('set_plan_publicly_listed', {
            p_plan_id:            planId,
            p_is_publicly_listed: formData.is_publicly_listed,
          });
          if (plError) throw new Error(plError.message);
          if (!plData?.success) throw new Error(plData?.error || 'Erro ao atualizar visibilidade do plano');
        }
      }

      closeModal();
      loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.save'));
    } finally {
      setSaving(false);
    }
  };

  // ── Solicitações de mudança ──────────────────────────────────────────────────

  const loadRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_plan_change_requests_admin', {
        p_status: 'pending',
      });
      if (rpcError) throw new Error(rpcError.message);
      setRequests(data ?? []);
    } catch {
      // Não bloqueia a tela principal
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSaaSAdmin && showRequests) {
      loadRequests();
    }
  }, [isSaaSAdmin, showRequests, loadRequests]);

  const approveRequest = async (requestId: string) => {
    setProcessingRequest(requestId);
    try {
      const { data, error: rpcError } = await supabase.rpc('approve_plan_change_request', {
        p_request_id: requestId,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (!data?.success) throw new Error(data?.error || 'Erro ao aprovar');
      await loadRequests();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao aprovar solicitação');
    } finally {
      setProcessingRequest(null);
    }
  };

  const rejectRequest = async (requestId: string) => {
    const notes = window.prompt('Motivo da rejeição (opcional):');
    if (notes === null) return; // Cancelado
    setProcessingRequest(requestId);
    try {
      const { data, error: rpcError } = await supabase.rpc('reject_plan_change_request', {
        p_request_id: requestId,
        p_notes:      notes || null,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (!data?.success) throw new Error(data?.error || 'Erro ao rejeitar');
      await loadRequests();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao rejeitar solicitação');
    } finally {
      setProcessingRequest(null);
    }
  };

  // ── Deletar ─────────────────────────────────────────────────────────────────

  const deletePlan = async (plan: Plan) => {
    if (!confirm(t('confirm.deletePlan', { name: plan.name }))) return;
    try {
      setError(null);
      const { data, error: rpcError } = await supabase.rpc('delete_plan', {
        p_plan_id: plan.id,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (!data?.success) throw new Error(data?.error || t('errors.delete'));
      loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.delete'));
    }
  };

  // ── Render helpers ──────────────────────────────────────────────────────────

  const formatPrice = (price: number | null, currency: string) => {
    if (price == null) return 'Sob consulta';
    if (price === 0) return t('pricing.free');
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency === 'BRL' ? 'BRL' : 'USD' }).format(price);
  };

  const LimitInput: React.FC<{
    label: string;
    fieldKey: keyof PlanFormData;
  }> = ({ label, fieldKey }) => (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        type="number"
        min="0"
        value={formData[fieldKey] as string}
        onChange={e => setField(fieldKey, e.target.value as PlanFormData[typeof fieldKey])}
        className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        placeholder="Ilimitado"
      />
    </div>
  );

  // ── Guard ────────────────────────────────────────────────────────────────────

  if (!isSaaSAdmin) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-slate-500">Acesso restrito a administradores da plataforma.</p>
      </div>
    );
  }

  // ── JSX ──────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{t('header.title')}</h1>
          <p className="text-slate-600 mt-1">{t('header.subtitle')}</p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('actions.create')}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
          {plans.map(plan => (
            <div
              key={plan.id}
              className={`bg-white rounded-xl shadow-sm border-2 p-5 relative flex flex-col gap-4 ${
                plan.is_popular ? 'border-blue-500' : 'border-slate-200'
              } ${!plan.is_active ? 'opacity-60' : ''}`}
            >
              {/* Popular badge */}
              {plan.is_popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-blue-500 text-white px-3 py-0.5 rounded-full text-xs font-medium flex items-center gap-1">
                    <Star className="w-3 h-3" /> Popular
                  </span>
                </div>
              )}

              {/* Status */}
              <div className="absolute top-3 right-3 flex items-center gap-1.5">
                {plan.stripe_price_id_monthly && (
                  <span title={`Stripe: ${plan.stripe_price_id_monthly}`} className="text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-medium">
                    Stripe ✓
                  </span>
                )}
                {plan.is_publicly_listed && (
                  <span title="Disponível para venda" className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                    <Globe className="w-3 h-3" /> Público
                  </span>
                )}
                {plan.is_active
                  ? <Eye className="w-4 h-4 text-green-500" title="Ativo" />
                  : <EyeOff className="w-4 h-4 text-slate-400" title="Inativo" />
                }
              </div>

              {/* Header */}
              <div>
                <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                <span className="text-xs text-slate-400 font-mono">{plan.slug}</span>
                {plan.description && (
                  <p className="text-slate-500 text-sm mt-1 line-clamp-2">{plan.description}</p>
                )}
                <div className="mt-2 text-2xl font-bold text-slate-900">
                  {formatPrice(plan.price, plan.currency)}
                  {plan.price != null && plan.price > 0 && (
                    <span className="text-xs font-normal text-slate-400">/mês</span>
                  )}
                </div>
              </div>

              {/* Limites principais */}
              <div className="space-y-1 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5 text-slate-400" />
                  <span>{displayLimit(plan.max_whatsapp_instances)} canais</span>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-slate-400" />
                  <span>{displayLimit(plan.max_users)} usuários · {displayLimit(plan.max_leads)} leads</span>
                </div>
                <div className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-slate-400" />
                  <span>{displayLimit(plan.max_automation_flows)} automações</span>
                </div>
              </div>

              {/* Plano de IA vinculado */}
              {plan.ai_plan_name ? (
                <div className="flex items-center gap-2 bg-violet-50 rounded-lg px-3 py-2 text-sm">
                  <Cpu className="w-3.5 h-3.5 text-violet-500" />
                  <div>
                    <span className="font-medium text-violet-800">{plan.ai_plan_name}</span>
                    <span className="text-violet-500 ml-1">
                      · {plan.ai_plan_monthly_credits?.toLocaleString('pt-BR')} créditos/mês
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 text-sm text-slate-400">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Sem plano de IA vinculado</span>
                </div>
              )}

              {/* Ações */}
              <div className="flex gap-2 mt-auto">
                <button
                  onClick={() => openEditModal(plan)}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" /> Editar
                </button>
                <button
                  onClick={() => deletePlan(plan)}
                  className="flex items-center justify-center px-3 py-1.5 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors"
                  aria-label="Excluir"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Solicitações de mudança de plano */}
      <div className="bg-white rounded-xl border border-slate-200">
        <button
          onClick={() => setShowRequests(v => !v)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors rounded-xl"
        >
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-500" />
            <span className="font-semibold text-slate-900">Solicitações de Mudança de Plano</span>
            {requests.length > 0 && (
              <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                {requests.length}
              </span>
            )}
          </div>
          {showRequests ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        {showRequests && (
          <div className="border-t border-slate-200 px-6 py-4">
            {requestsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
              </div>
            ) : requests.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-6">Nenhuma solicitação pendente.</p>
            ) : (
              <div className="space-y-3">
                {requests.map(req => (
                  <div key={req.id} className="flex items-center justify-between gap-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{req.company_name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {req.from_plan_name ?? 'Sem plano'} → <strong>{req.to_plan_name}</strong>
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {new Date(req.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => approveRequest(req.id)}
                        disabled={processingRequest === req.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        Aprovar
                      </button>
                      <button
                        onClick={() => rejectRequest(req.id)}
                        disabled={processingRequest === req.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Rejeitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
            <div className="p-6">
              {/* Modal Header */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-slate-900">
                  {editingPlan ? `Editar — ${editingPlan.name}` : 'Novo Plano CRM'}
                </h2>
                <button onClick={closeModal} className="p-2 hover:bg-slate-100 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {error && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-red-800 text-sm">{error}</p>
                </div>
              )}

              <div className="space-y-5">
                {/* Identificação */}
                <section>
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Identificação</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Nome</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={e => setField('name', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="ex: Pro"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Slug</label>
                      <input
                        type="text"
                        value={formData.slug}
                        onChange={e => setField('slug', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="ex: pro"
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Descrição</label>
                    <textarea
                      value={formData.description}
                      onChange={e => setField('description', e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </section>

                {/* Precificação */}
                <section>
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Precificação</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Preço (deixe vazio = Sob consulta)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.price}
                        onChange={e => setField('price', e.target.value)}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Moeda</label>
                      <select
                        value={formData.currency}
                        onChange={e => setField('currency', e.target.value)}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="BRL">BRL</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Ciclo</label>
                      <select
                        value={formData.billing_cycle}
                        onChange={e => setField('billing_cycle', e.target.value)}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="monthly">Mensal</option>
                        <option value="yearly">Anual</option>
                        <option value="lifetime">Vitalício</option>
                      </select>
                    </div>
                  </div>
                </section>

                {/* Limites CRM */}
                <section>
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Limites CRM <span className="text-slate-400 font-normal normal-case">(vazio = ilimitado)</span>
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    <LimitInput label="Canais WhatsApp" fieldKey="max_whatsapp_instances" />
                    <LimitInput label="Usuários" fieldKey="max_users" />
                    <LimitInput label="Leads" fieldKey="max_leads" />
                    <LimitInput label="Funis" fieldKey="max_funnels" />
                    <LimitInput label="Etapas/funil" fieldKey="max_funnel_stages" />
                    <LimitInput label="Automações ativas" fieldKey="max_automation_flows" />
                    <LimitInput label="Execuções/mês" fieldKey="max_automation_executions_monthly" />
                    <LimitInput label="Produtos" fieldKey="max_products" />
                    <LimitInput label="Storage (MB)" fieldKey="storage_mb" />
                    <LimitInput label="Landing Pages" fieldKey="max_landing_pages" />
                  </div>
                </section>

                {/* Integração Stripe */}
                <section>
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Integração Stripe</h3>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Stripe Price ID (mensal)
                      <span className="ml-1 text-slate-400 font-normal normal-case">— opcional, somente admin</span>
                    </label>
                    <input
                      type="text"
                      value={formData.stripe_price_id_monthly}
                      onChange={e => setField('stripe_price_id_monthly', e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="price_XXXXXXXXXXXXXXXXXXXXXXXX"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {formData.stripe_price_id_monthly && !formData.stripe_price_id_monthly.startsWith('price_') && (
                      <p className="mt-1 text-xs text-amber-600">
                        O ID deve começar com "price_"
                      </p>
                    )}
                    <p className="mt-1 text-xs text-slate-400">
                      Encontre este valor no Stripe Dashboard → Produtos → selecione o produto → copie o Price ID.
                      Deixe vazio para planos personalizados (contato comercial).
                    </p>
                  </div>
                </section>

                {/* Plano de IA */}
                <section>
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Plano de IA vinculado</h3>
                  <select
                    value={formData.ai_plan_id}
                    onChange={e => setField('ai_plan_id', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">— Sem plano de IA —</option>
                    {aiPlans.map(ap => (
                      <option key={ap.id} value={ap.id}>
                        {ap.name} — {ap.monthly_credits.toLocaleString('pt-BR')} créditos/mês
                      </option>
                    ))}
                  </select>
                </section>

                {/* Features */}
                <section>
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Features habilitadas</h3>
                  <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                    {FEATURE_FLAGS.map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={!!formData[key]}
                          onChange={e => setField(key, e.target.checked as PlanFormData[typeof key])}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </section>

                {/* Opções */}
                <section>
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Opções</h3>
                  <div className="flex flex-wrap gap-6">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Ordem</label>
                      <input
                        type="number"
                        min="0"
                        value={formData.sort_order}
                        onChange={e => setField('sort_order', parseInt(e.target.value) || 0)}
                        className="w-24 px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 self-end mb-1">
                      <input
                        type="checkbox"
                        checked={formData.is_active}
                        onChange={e => setField('is_active', e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      Ativo
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 self-end mb-1">
                      <input
                        type="checkbox"
                        checked={formData.is_popular}
                        onChange={e => setField('is_popular', e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      Destacado (Popular)
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 self-end mb-1">
                      <input
                        type="checkbox"
                        checked={formData.is_publicly_listed}
                        onChange={e => setField('is_publicly_listed', e.target.checked)}
                        className="rounded border-slate-300 text-green-600 focus:ring-green-500"
                      />
                      Disponível para venda (auto-serviço)
                    </label>
                  </div>
                </section>
              </div>

              {/* Ações do modal */}
              <div className="flex gap-3 mt-6 pt-6 border-t border-slate-200">
                <button
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={savePlan}
                  disabled={saving || !formData.name || !formData.slug}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                >
                  {saving
                    ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    : <Save className="w-4 h-4" />
                  }
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
