// =============================================================================
// useNuvemshopConnection
//
// Hook que gerencia o estado e as ações da integração Nuvemshop.
//
// Responsabilidades:
//   - Buscar status da integração no mount e a cada 30s
//   - Pausar polling quando a aba está oculta (economiza recursos)
//   - Expor ações: connect, disconnect, refetch
//   - Invalidar cache automaticamente após conectar/desconectar
//
// Segurança (UX apenas — backend valida novamente):
//   - As ações expostas pelo endpoint status.actions controlam botões
//   - O hook não decide segurança; serve apenas para UX
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getNuvemshopStatus,
  initiateNuvemshopConnect,
  disconnectNuvemshop,
  type NuvemshopConnectionStatus,
} from '../services/nuvemshopApi';

interface UseNuvemshopConnectionReturn {
  status:         NuvemshopConnectionStatus | null;
  loading:        boolean;
  loadingAction:  boolean;
  error:          string | null;
  refetch:        () => void;
  connect:        () => Promise<void>;
  disconnect:     () => Promise<{ success: boolean; error?: string }>;
}

export function useNuvemshopConnection(
  companyId: string | undefined,
): UseNuvemshopConnectionReturn {
  const [status,        setStatus]        = useState<NuvemshopConnectionStatus | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError(null);

    try {
      const data = await getNuvemshopStatus(companyId);
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao buscar status da integração.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchStatus();

    // Polling a cada 30s — pausa quando a aba está oculta
    const startPolling = () => {
      pollingRef.current = setInterval(() => {
        if (!document.hidden) fetchStatus();
      }, 30_000);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      } else {
        fetchStatus();
        if (!pollingRef.current) startPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchStatus]);

  const connect = useCallback(async () => {
    if (!companyId) return;

    setLoadingAction(true);
    setError(null);

    try {
      await initiateNuvemshopConnect(companyId);
      // A navegação para o OAuth ocorre dentro de initiateNuvemshopConnect.
      // Não há retorno aqui; o callback redireciona de volta ao Settings.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao iniciar conexão. Tente novamente.');
      setLoadingAction(false);
    }
  }, [companyId]);

  const disconnect = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!companyId) return { success: false, error: 'Empresa não identificada.' };

    setLoadingAction(true);
    setError(null);

    try {
      await disconnectNuvemshop(companyId);
      await fetchStatus();
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao desconectar. Tente novamente.';
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setLoadingAction(false);
    }
  }, [companyId, fetchStatus]);

  return {
    status,
    loading,
    loadingAction,
    error,
    refetch: fetchStatus,
    connect,
    disconnect,
  };
}
