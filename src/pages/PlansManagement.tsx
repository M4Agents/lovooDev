import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { 
  Plus, 
  Edit2, 
  Trash2, 
  Save, 
  X, 
  DollarSign, 
  Users, 
  MessageSquare, 
  FileText,
  Crown,
  Star,
  Eye,
  EyeOff
} from 'lucide-react';

interface Plan {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  currency: string;
  billing_cycle: string;
  max_whatsapp_instances: number;
  max_landing_pages: number | null;
  max_leads: number | null;
  max_users: number | null;
  features: string[];
  is_active: boolean;
  is_popular: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface PlanFormData {
  name: string;
  slug: string;
  description: string;
  price: number;
  currency: string;
  billing_cycle: string;
  max_whatsapp_instances: number;
  max_landing_pages: number | null;
  max_leads: number | null;
  max_users: number | null;
  features: string[];
  is_active: boolean;
  is_popular: boolean;
  sort_order: number;
}

export const PlansManagement: React.FC = () => {
  const { company } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<PlanFormData>({
    name: '',
    slug: '',
    description: '',
    price: 0,
    currency: 'BRL',
    billing_cycle: 'monthly',
    max_whatsapp_instances: 1,
    max_landing_pages: null,
    max_leads: null,
    max_users: null,
    features: [],
    is_active: true,
    is_popular: false,
    sort_order: 0
  });

  const [newFeature, setNewFeature] = useState('');

  // =====================================================
  // CARREGAR PLANOS
  // =====================================================
  const loadPlans = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase.rpc('get_plans');

      if (error) {
        throw new Error(error.message);
      }

      setPlans(data || []);
    } catch (err) {
      console.error('Erro ao carregar planos:', err);
      setError(err instanceof Error ? err.message : 'Erro ao carregar planos');
    } finally {
      setLoading(false);
    }
  };

  // =====================================================
  // SALVAR PLANO
  // =====================================================
  const savePlan = async () => {
    try {
      setSaving(true);
      setError(null);

      const planData = {
        ...formData,
        max_landing_pages: formData.max_landing_pages || null,
        max_leads: formData.max_leads || null,
        max_users: formData.max_users || null,
      };

      let result;
      if (editingPlan) {
        // Atualizar plano existente
        result = await supabase.rpc('update_plan', {
          p_plan_id: editingPlan.id,
          p_name: planData.name,
          p_slug: planData.slug,
          p_description: planData.description,
          p_price: planData.price,
          p_currency: planData.currency,
          p_billing_cycle: planData.billing_cycle,
          p_max_whatsapp_instances: planData.max_whatsapp_instances,
          p_max_landing_pages: planData.max_landing_pages,
          p_max_leads: planData.max_leads,
          p_max_users: planData.max_users,
          p_features: JSON.stringify(planData.features),
          p_is_active: planData.is_active,
          p_is_popular: planData.is_popular,
          p_sort_order: planData.sort_order
        });
      } else {
        // Criar novo plano
        result = await supabase.rpc('create_plan', {
          p_name: planData.name,
          p_slug: planData.slug,
          p_description: planData.description,
          p_price: planData.price,
          p_currency: planData.currency,
          p_billing_cycle: planData.billing_cycle,
          p_max_whatsapp_instances: planData.max_whatsapp_instances,
          p_max_landing_pages: planData.max_landing_pages,
          p_max_leads: planData.max_leads,
          p_max_users: planData.max_users,
          p_features: JSON.stringify(planData.features),
          p_is_active: planData.is_active,
          p_is_popular: planData.is_popular,
          p_sort_order: planData.sort_order
        });
      }

      if (result.error) {
        throw new Error(result.error.message);
      }

      if (!result.data?.success) {
        throw new Error(result.data?.error || 'Erro ao salvar plano');
      }

      closeModal();
      loadPlans();
    } catch (err) {
      console.error('Erro ao salvar plano:', err);
      setError(err instanceof Error ? err.message : 'Erro ao salvar plano');
    } finally {
      setSaving(false);
    }
  };

  // =====================================================
  // DELETAR PLANO
  // =====================================================
  const deletePlan = async (plan: Plan) => {
    if (!confirm(`Tem certeza que deseja deletar o plano "${plan.name}"?`)) {
      return;
    }

    try {
      setError(null);

      const { data, error } = await supabase.rpc('delete_plan', {
        p_plan_id: plan.id
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Erro ao deletar plano');
      }

      loadPlans();
    } catch (err) {
      console.error('Erro ao deletar plano:', err);
      setError(err instanceof Error ? err.message : 'Erro ao deletar plano');
    }
  };

  // =====================================================
  // MODAL FUNCTIONS
  // =====================================================
  const openCreateModal = () => {
    setEditingPlan(null);
    setFormData({
      name: '',
      slug: '',
      description: '',
      price: 0,
      currency: 'BRL',
      billing_cycle: 'monthly',
      max_whatsapp_instances: 1,
      max_landing_pages: null,
      max_leads: null,
      max_users: null,
      features: [],
      is_active: true,
      is_popular: false,
      sort_order: plans.length + 1
    });
    setShowModal(true);
  };

  const openEditModal = (plan: Plan) => {
    setEditingPlan(plan);
    setFormData({
      name: plan.name,
      slug: plan.slug,
      description: plan.description || '',
      price: plan.price,
      currency: plan.currency,
      billing_cycle: plan.billing_cycle,
      max_whatsapp_instances: plan.max_whatsapp_instances,
      max_landing_pages: plan.max_landing_pages,
      max_leads: plan.max_leads,
      max_users: plan.max_users,
      features: plan.features || [],
      is_active: plan.is_active,
      is_popular: plan.is_popular,
      sort_order: plan.sort_order
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingPlan(null);
    setError(null);
    setNewFeature('');
  };

  // =====================================================
  // FEATURES MANAGEMENT
  // =====================================================
  const addFeature = () => {
    if (newFeature.trim()) {
      setFormData({
        ...formData,
        features: [...formData.features, newFeature.trim()]
      });
      setNewFeature('');
    }
  };

  const removeFeature = (index: number) => {
    setFormData({
      ...formData,
      features: formData.features.filter((_, i) => i !== index)
    });
  };

  // =====================================================
  // UTILS
  // =====================================================
  const formatPrice = (price: number, currency: string) => {
    if (price === 0) return 'Gratuito';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency === 'BRL' ? 'BRL' : 'USD'
    }).format(price);
  };

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  };

  // =====================================================
  // EFFECTS
  // =====================================================
  useEffect(() => {
    if (company?.is_super_admin) {
      loadPlans();
    }
  }, [company]);

  // Auto-generate slug from name
  useEffect(() => {
    if (formData.name && !editingPlan) {
      setFormData(prev => ({
        ...prev,
        slug: generateSlug(prev.name)
      }));
    }
  }, [formData.name, editingPlan]);

  // =====================================================
  // VERIFICAR PERMISSÃO
  // =====================================================
  if (!company?.is_super_admin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Acesso Negado</h2>
          <p className="text-gray-600">Apenas super administradores podem acessar esta página.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Gestão de Planos</h1>
          <p className="text-slate-600 mt-1">Gerencie os planos disponíveis na plataforma</p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Plano
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        /* Plans Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`bg-white rounded-xl shadow-sm border-2 p-6 relative ${
                plan.is_popular ? 'border-blue-500' : 'border-slate-200'
              }`}
            >
              {/* Popular Badge */}
              {plan.is_popular && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <span className="bg-blue-500 text-white px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1">
                    <Star className="w-3 h-3" />
                    Popular
                  </span>
                </div>
              )}

              {/* Status Badge */}
              <div className="absolute top-4 right-4">
                {plan.is_active ? (
                  <Eye className="w-5 h-5 text-green-500" title="Ativo" />
                ) : (
                  <EyeOff className="w-5 h-5 text-gray-400" title="Inativo" />
                )}
              </div>

              {/* Plan Header */}
              <div className="mb-4">
                <h3 className="text-xl font-bold text-slate-900 mb-2">{plan.name}</h3>
                <p className="text-slate-600 text-sm mb-4">{plan.description}</p>
                <div className="text-3xl font-bold text-slate-900">
                  {formatPrice(plan.price, plan.currency)}
                  {plan.price > 0 && (
                    <span className="text-sm font-normal text-slate-500">
                      /{plan.billing_cycle === 'monthly' ? 'mês' : 'ano'}
                    </span>
                  )}
                </div>
              </div>

              {/* Limits */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <MessageSquare className="w-4 h-4" />
                  <span>{plan.max_whatsapp_instances} WhatsApp</span>
                </div>
                {plan.max_landing_pages && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <FileText className="w-4 h-4" />
                    <span>{plan.max_landing_pages} Landing Pages</span>
                  </div>
                )}
                {plan.max_users && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Users className="w-4 h-4" />
                    <span>{plan.max_users} Usuários</span>
                  </div>
                )}
              </div>

              {/* Features */}
              <div className="mb-6">
                <h4 className="font-medium text-slate-900 mb-2">Recursos:</h4>
                <ul className="space-y-1">
                  {plan.features.slice(0, 3).map((feature, index) => (
                    <li key={index} className="text-sm text-slate-600 flex items-start gap-2">
                      <span className="text-green-500 mt-0.5">✓</span>
                      {feature}
                    </li>
                  ))}
                  {plan.features.length > 3 && (
                    <li className="text-sm text-slate-500">
                      +{plan.features.length - 3} recursos adicionais
                    </li>
                  )}
                </ul>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => openEditModal(plan)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <Edit2 className="w-4 h-4" />
                  Editar
                </button>
                <button
                  onClick={() => deletePlan(plan)}
                  className="flex items-center justify-center px-3 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              {/* Modal Header */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-slate-900">
                  {editingPlan ? 'Editar Plano' : 'Novo Plano'}
                </h2>
                <button
                  onClick={closeModal}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Form */}
              <div className="space-y-4">
                {/* Basic Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Nome do Plano *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: Plano Básico"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Slug *
                    </label>
                    <input
                      type="text"
                      value={formData.slug}
                      onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: basic"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Descrição
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    rows={3}
                    placeholder="Descrição do plano..."
                  />
                </div>

                {/* Pricing */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Preço *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Moeda
                    </label>
                    <select
                      value={formData.currency}
                      onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="BRL">BRL (R$)</option>
                      <option value="USD">USD ($)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Ciclo
                    </label>
                    <select
                      value={formData.billing_cycle}
                      onChange={(e) => setFormData({ ...formData, billing_cycle: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="monthly">Mensal</option>
                      <option value="yearly">Anual</option>
                      <option value="lifetime">Vitalício</option>
                    </select>
                  </div>
                </div>

                {/* Limits */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      WhatsApp *
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={formData.max_whatsapp_instances}
                      onChange={(e) => setFormData({ ...formData, max_whatsapp_instances: parseInt(e.target.value) || 1 })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Landing Pages
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={formData.max_landing_pages || ''}
                      onChange={(e) => setFormData({ ...formData, max_landing_pages: e.target.value ? parseInt(e.target.value) : null })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ilimitado"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Leads
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={formData.max_leads || ''}
                      onChange={(e) => setFormData({ ...formData, max_leads: e.target.value ? parseInt(e.target.value) : null })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ilimitado"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Usuários
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={formData.max_users || ''}
                      onChange={(e) => setFormData({ ...formData, max_users: e.target.value ? parseInt(e.target.value) : null })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ilimitado"
                    />
                  </div>
                </div>

                {/* Features */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Recursos do Plano
                  </label>
                  <div className="space-y-2">
                    {formData.features.map((feature, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="flex-1 px-3 py-2 bg-slate-50 rounded-lg text-sm">
                          {feature}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFeature(index)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newFeature}
                        onChange={(e) => setNewFeature(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && addFeature()}
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Adicionar recurso..."
                      />
                      <button
                        type="button"
                        onClick={addFeature}
                        className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Options */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Ordem
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={formData.sort_order}
                      onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div className="flex items-center">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.is_active}
                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-slate-700">Ativo</span>
                    </label>
                  </div>
                  <div className="flex items-center">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.is_popular}
                        onChange={(e) => setFormData({ ...formData, is_popular: e.target.checked })}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-slate-700">Popular</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex gap-3 mt-6 pt-6 border-t border-slate-200">
                <button
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={savePlan}
                  disabled={saving || !formData.name || !formData.slug}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
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
