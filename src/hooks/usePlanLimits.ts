// =====================================================
// HOOK: usePlanLimits
// =====================================================
// Hook para verificar limites do plano da empresa

import { useState, useEffect, useCallback } from 'react';
import { 
  PlanLimits, 
  PlanConfig, 
  UsePlanLimitsReturn,
  PLAN_CONFIGS,
  WHATSAPP_LIFE_CONSTANTS 
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
  // BUSCAR LIMITES DO PLANO
  // =====================================================
  const fetchPlanLimits = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `${WHATSAPP_LIFE_CONSTANTS.API_ENDPOINTS.PLAN_LIMITS}?company_id=${companyId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao verificar limites do plano');
      }

      if (data.success && data.data) {
        setPlanLimits(data.data);
      } else {
        throw new Error(data.error || 'Dados inválidos recebidos');
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
