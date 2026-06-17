import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { InstagramConnection } from '../types/instagram-chat';

// Re-exporta InstagramConnection para manter compatibilidade com importações existentes
export type { InstagramConnection };

export interface ConnectWithTokenResult {
  success: boolean;
  status?: 'active' | 'limited';
  username?: string;
  missing_scopes?: string[];
  webhook_subscribed?: boolean;
  warning?: string;
  error?: string;
}

interface UseInstagramConnectionsReturn {
  connections: InstagramConnection[];
  loading: boolean;
  loadingAction: boolean;
  error: string | null;
  refetch: () => void;
  connect: (companyId: string) => Promise<void>;
  connectWithToken: (companyId: string, rawToken: string) => Promise<ConnectWithTokenResult>;
  disconnect: (connectionId: string) => Promise<{ success: boolean; error?: string }>;
  deleteConnection: (connectionId: string) => Promise<{ success: boolean; error?: string }>;
  syncPhoto: (connectionId: string) => Promise<{ success: boolean; photoUrl?: string | null; error?: string }>;
}

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function useInstagramConnections(companyId: string | undefined): UseInstagramConnectionsReturn {
  const [connections, setConnections] = useState<InstagramConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchConnections = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError('Sessão expirada. Recarregue a página.');
        return;
      }

      const res = await fetch(`/api/instagram/connections?company_id=${encodeURIComponent(companyId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? 'Erro ao buscar conexões Instagram.');
        return;
      }

      setConnections(json.connections ?? []);
    } catch {
      setError('Erro de conexão. Verifique sua internet.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchConnections();

    // Polling a cada 30s — pausa quando aba está oculta para economizar recursos
    const startPolling = () => {
      pollingRef.current = setInterval(() => {
        if (!document.hidden) fetchConnections();
      }, 30_000);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      } else {
        fetchConnections();
        if (!pollingRef.current) startPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchConnections]);

  const connect = useCallback(async (cId: string) => {
    setLoadingAction(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError('Sessão expirada. Recarregue a página.');
        return;
      }

      const res = await fetch('/api/instagram/connect/initiate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ company_id: cId }),
      });

      const json = await res.json();

      if (!res.ok || !json.authUrl) {
        setError(json.error ?? 'Não foi possível iniciar a conexão com Instagram.');
        return;
      }

      window.location.href = json.authUrl;
    } catch {
      setError('Erro ao iniciar conexão. Tente novamente.');
    } finally {
      setLoadingAction(false);
    }
  }, []);

  const disconnect = useCallback(async (connectionId: string): Promise<{ success: boolean; error?: string }> => {
    setLoadingAction(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        return { success: false, error: 'Sessão expirada. Recarregue a página.' };
      }

      const res = await fetch('/api/instagram/connect/disconnect', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ connection_id: connectionId }),
      });

      const json = await res.json();

      if (!res.ok) {
        const msg = json.error ?? 'Erro ao desconectar conta Instagram.';
        setError(msg);
        return { success: false, error: msg };
      }

      await fetchConnections();
      return { success: true };
    } catch {
      const msg = 'Erro ao desconectar. Tente novamente.';
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setLoadingAction(false);
    }
  }, [fetchConnections]);

  const deleteConnection = useCallback(async (connectionId: string): Promise<{ success: boolean; error?: string }> => {
    setLoadingAction(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        return { success: false, error: 'Sessão expirada. Recarregue a página.' };
      }

      const res = await fetch('/api/instagram/connect/delete', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ connection_id: connectionId }),
      });

      const json = await res.json();

      if (!res.ok) {
        const msg = json.error ?? 'Erro ao excluir conexão Instagram.';
        setError(msg);
        return { success: false, error: msg };
      }

      await fetchConnections();
      return { success: true };
    } catch {
      const msg = 'Erro ao excluir conexão. Tente novamente.';
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setLoadingAction(false);
    }
  }, [fetchConnections]);

  const syncPhoto = useCallback(async (connectionId: string): Promise<{ success: boolean; photoUrl?: string | null; error?: string }> => {
    setLoadingAction(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        return { success: false, error: 'Sessão expirada. Recarregue a página.' };
      }

      const res = await fetch(`/api/instagram/connections/${connectionId}/sync-photo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await res.json();

      if (!res.ok) {
        const isExpired = json.error === 'token_expired';
        const msg = isExpired
          ? 'Token expirado. Reconecte a conta para atualizar a foto.'
          : (json.message ?? 'Erro ao atualizar foto.');
        setError(msg);
        return { success: false, error: msg };
      }

      // Atualiza a foto localmente sem re-fetch completo
      setConnections(prev =>
        prev.map(c =>
          c.id === connectionId
            ? { ...c, profile_picture_url: json.profile_picture_url }
            : c
        )
      );

      return { success: true, photoUrl: json.profile_picture_url };
    } catch {
      const msg = 'Erro ao atualizar foto. Tente novamente.';
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setLoadingAction(false);
    }
  }, []);

  const connectWithToken = useCallback(async (
    cId: string,
    rawToken: string,
  ): Promise<ConnectWithTokenResult> => {
    setLoadingAction(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        return { success: false, error: 'Sessão expirada. Recarregue a página.' };
      }

      const res = await fetch('/api/instagram/connect/token', {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ company_id: cId, raw_token: rawToken }),
      });

      const json = await res.json();

      if (!res.ok) {
        return { success: false, error: json.error ?? 'Erro ao conectar com token.' };
      }

      await fetchConnections();

      return {
        success:            true,
        status:             json.status,
        username:           json.username,
        webhook_subscribed: json.webhook_subscribed,
        missing_scopes:     json.missing_scopes ?? [],
        warning:            json.warning,
      };
    } catch {
      return { success: false, error: 'Erro de conexão. Tente novamente.' };
    } finally {
      setLoadingAction(false);
    }
  }, [fetchConnections]);

  return {
    connections,
    loading,
    loadingAction,
    error,
    refetch: fetchConnections,
    connect,
    connectWithToken,
    disconnect,
    deleteConnection,
    syncPhoto,
  };
}
