// =====================================================
// HOOK: usePlanLimits
// =====================================================
// Hook para verificar limites do plano da empresa

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { 
  PlanLimits, 
  PlanConfig, 
  UsePlanLimitsReturn,
  PLAN_CONFIGS
} from '../types/whatsapp-life';

// =====================================================
// HOOK PRINCIPAL
// =====================================================
export const usePlanLimits = (companyId?: string): UsePlanLimitsReturn => {
  const [planLimits, setPlanLimits] = useState<PlanLimits>({
    canAdd: false,
    currentCount: 0,
    maxAllowed: 1,
    planType: 'basic',
    remaining: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // =====================================================
  // BUSCAR LIMITES DO PLANO (ANTI-CORS)
  // =====================================================
  const fetchPlanLimits = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // ✅ ANTI-CORS: Chamar apenas RPC Function
      const { data, error } = await supabase.rpc('check_whatsapp_life_plan_limit', {
        p_company_id: companyId,
      });

      if (error) {
        console.error('[usePlanLimits] Erro RPC:', error);
        throw new Error('Erro ao comunicar com servidor');
      }

      if (data) {
        setPlanLimits({
          canAdd: data.canAdd || false,
          currentCount: data.currentCount || 0,
          maxAllowed: data.maxAllowed || 1,
          planType: data.planType || 'basic',
          remaining: data.remaining || 0,
        });
      } else {
        throw new Error('Dados inválidos recebidos');
      }
    } catch (err) {
      console.error('[usePlanLimits] Erro ao buscar limites:', err);
      setError(err instanceof Error ? err.message : 'Erro ao verificar limites');
      
      // Definir valores padrão em caso de erro
      setPlanLimits({
        canAdd: false,
        currentCount: 0,
        maxAllowed: 1,
        planType: 'basic',
        remaining: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // =====================================================
  // REFETCH (ALIAS PARA FETCH)
  // =====================================================
  const refetch = useCallback(async () => {
    await fetchPlanLimits();
  }, [fetchPlanLimits]);

  // =====================================================
  // COMPUTED: PODE ADICIONAR INSTÂNCIA
  // =====================================================
  const canAddInstance = planLimits.canAdd;

  // =====================================================
  // COMPUTED: CONFIGURAÇÃO DO PLANO
  // =====================================================
  const planConfig: PlanConfig = PLAN_CONFIGS[planLimits.planType] || PLAN_CONFIGS.basic;

  // =====================================================
  // EFFECT: CARREGAR LIMITES
  // =====================================================
  useEffect(() => {
    fetchPlanLimits();
  }, [fetchPlanLimits]);

  // =====================================================
  // RETORNO DO HOOK
  // =====================================================
  return {
    planLimits,
    loading,
    error,
    canAddInstance,
    planConfig,
    refetch,
  };
};
