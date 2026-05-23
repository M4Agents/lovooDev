import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface InstagramConnection {
  id: string;
  instagram_username: string;
  status: 'active' | 'revoked' | 'error';
  token_expires_at: string | null;
  created_at: string;
  connected_by: string | null;
}

interface UseInstagramConnectionsReturn {
  connections: InstagramConnection[];
  loading: boolean;
  loadingAction: boolean;
  error: string | null;
  refetch: () => void;
  connect: (companyId: string) => Promise<void>;
  disconnect: (connectionId: string) => Promise<{ success: boolean; error?: string }>;
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

  return {
    connections,
    loading,
    loadingAction,
    error,
    refetch: fetchConnections,
    connect,
    disconnect,
  };
}
