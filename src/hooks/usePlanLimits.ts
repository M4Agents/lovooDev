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
    canAdd:       false,
    currentCount: 0,
    maxAllowed:   null,
    planType:     'unknown',
    remaining:    null,
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
      console.log('[usePlanLimits] Calling RPC with company ID:', companyId);
      
      const { data, error } = await supabase.rpc('check_whatsapp_life_plan_limit', {
        p_company_id: companyId,
      });

      console.log('[usePlanLimits] RPC Response:', { data, error });

      if (error) {
        console.error('[usePlanLimits] Erro RPC:', error);
        throw new Error(`RPC Error: ${error.message || JSON.stringify(error)}`);
      }

      if (data) {
        // RPC retorna planSlug (campo novo). planType não existe no response.
        const planSlug: string | null = data.planSlug ?? null;

        if (!planSlug) {
          // Expose inconsistency: company sem plan_id vinculado ou plano inativo.
          // Não mascarar com 'starter' — logar para facilitar diagnóstico.
          console.warn(
            '[usePlanLimits] planSlug ausente na resposta da RPC.',
            'Company pode estar sem plan_id vinculado ou com plano inativo.',
            { companyId, rpcResponse: data }
          );
        }

        // maxAllowed e remaining: null = ilimitado (Elite/custom).
        // NÃO coagir null para 1 — preservar semântica de ilimitado.
        setPlanLimits({
          canAdd:       data.canAdd       ?? false,
          currentCount: data.currentCount ?? 0,
          maxAllowed:   data.maxAllowed   ?? null,
          planType:     planSlug ?? 'unknown',
          remaining:    data.remaining    ?? null,
        });
      } else {
        throw new Error('Dados inválidos recebidos');
      }
    } catch (err) {
      console.error('[usePlanLimits] Erro ao buscar limites:', err);
      setError(err instanceof Error ? err.message : 'Erro ao verificar limites');
      
      // Estado conservador em erro: bloqueia adição, não mascara como 'starter'.
      // Verificar this.error === null no consumidor para distinguir de estado normal.
      setPlanLimits({
        canAdd:       false,
        currentCount: 0,
        maxAllowed:   1,   // conservador: bloqueia adição em caso de erro
        planType:     'unknown',
        remaining:    0,
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
  const planConfig: PlanConfig = PLAN_CONFIGS[planLimits.planType] || PLAN_CONFIGS.starter;

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
