// =============================================================================
// useCompanyIntegration
//
// Hook exclusivamente para decisões de visibilidade da integração Nuvemshop.
// NÃO substitui validações de segurança do backend.
//
// ── Três estados previstos no plano v5.1 ─────────────────────────────────────
//   'none'         → Empresa nunca conectou — ocultar todos os elementos NS
//   'active'       → Integração ativa — exibir todos os elementos habilitados
//   'disconnected' → Integração desconectada — modo somente leitura com aviso
//
// ── Uso ──────────────────────────────────────────────────────────────────────
//   const { hasNuvemshopEver, isActive, isDisconnected } = useCompanyIntegration()
//
//   // Esconder opção de origem no filtro
//   {hasNuvemshopEver && <option value="nuvemshop">Nuvemshop</option>}
//
//   // Exibir aviso de desconexão
//   {isDisconnected && <DisconnectedBanner />}
//
// ── Princípio de segurança ───────────────────────────────────────────────────
//   - Este hook é UX apenas; nunca gera acesso ou autorização
//   - O backend revalida company_id, membership e role a cada request
//   - Em caso de erro ou loading, o comportamento padrão é NÃO exibir elementos
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth }            from '../contexts/AuthContext';
import { getNuvemshopStatus } from '../services/nuvemshopApi';

// ── Tipos ─────────────────────────────────────────────────────────────────────

/** Os três estados previstos no plano para a integração Nuvemshop. */
export type NuvemshopIntegrationState = 'none' | 'active' | 'disconnected';

export interface CompanyIntegrationResult {
  /** Estado derivado da integração: none | active | disconnected */
  integrationState: NuvemshopIntegrationState;

  /** Atalhos para condicionais no JSX */
  hasNuvemshopEver:  boolean;  // true quando active OU disconnected
  isActive:          boolean;  // true apenas quando active
  isDisconnected:    boolean;  // true apenas quando disconnected
  hasNever:          boolean;  // true quando nunca conectou

  /** Dados básicos da loja (apenas para exibição — UX) */
  storeName: string | null;

  loading:   boolean;
  error:     string | null;

  /** Forçar revalidação (ex: após conectar/desconectar) */
  refetch:   () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCompanyIntegration(): CompanyIntegrationResult {
  const { company } = useAuth();
  const companyId   = company?.id;

  const [integrationState, setIntegrationState] = useState<NuvemshopIntegrationState>('none');
  const [storeName,        setStoreName]        = useState<string | null>(null);
  const [loading,          setLoading]          = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const hasFetchedRef                           = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (!companyId) {
      setIntegrationState('none');
      setStoreName(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await getNuvemshopStatus(companyId);

      // Derivar os três estados canônicos a partir do status retornado
      if (data.connected && data.status === 'active') {
        setIntegrationState('active');
      } else if (data.status !== null && data.status !== 'active') {
        // Houve conexão histórica (status = 'disconnected', 'expired', etc.)
        setIntegrationState('disconnected');
      } else {
        // Nunca conectou ou endpoint não encontrou registro
        setIntegrationState('none');
      }

      setStoreName(data.store_name ?? null);
    } catch {
      // Em caso de erro, comportamento conservador: não exibir elementos NS
      setIntegrationState('none');
      setError('Não foi possível verificar o status da integração.');
    } finally {
      setLoading(false);
      hasFetchedRef.current = true;
    }
  }, [companyId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return {
    integrationState,
    hasNuvemshopEver: integrationState !== 'none',
    isActive:         integrationState === 'active',
    isDisconnected:   integrationState === 'disconnected',
    hasNever:         integrationState === 'none',
    storeName,
    loading,
    error,
    refetch: fetchStatus,
  };
}
