import React, { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'

interface GoogleConnection {
  id: string
  google_email: string
  is_active: boolean
  sync_enabled: boolean
  last_sync_at: string
  created_at: string
}

export const GoogleCalendarSettings: React.FC = () => {
  const { user } = useAuth()
  const [connection, setConnection] = useState<GoogleConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    fetchConnection()
  }, [user])

  const fetchConnection = async () => {
    if (!user) return

    try {
      const { data, error } = await supabase
        .from('google_calendar_connections')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching Google connection:', error)
      }

      setConnection(data)
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleConnect = () => {
    // Redirecionar para API de conexão
    window.location.href = '/api/google-calendar/auth/connect'
  }

  const handleDisconnect = async () => {
    if (!confirm('Deseja realmente desconectar o Google Calendar? A sincronização será interrompida.')) {
      return
    }

    try {
      setLoading(true)

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        alert('Sessão expirada. Faça login novamente.')
        return
      }

      const response = await fetch('/api/google-calendar/auth/disconnect', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error('Failed to disconnect')
      }

      setConnection(null)
      alert('Google Calendar desconectado com sucesso!')
    } catch (error) {
      console.error('Error disconnecting:', error)
      alert('Erro ao desconectar Google Calendar')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleSync = async () => {
    if (!connection) return

    try {
      const { error } = await supabase
        .from('google_calendar_connections')
        .update({ sync_enabled: !connection.sync_enabled })
        .eq('id', connection.id)

      if (error) throw error

      setConnection({ ...connection, sync_enabled: !connection.sync_enabled })
    } catch (error) {
      console.error('Error toggling sync:', error)
      alert('Erro ao alterar sincronização')
    }
  }

  const handleSyncNow = async () => {
    if (!connection) return

    try {
      setSyncing(true)

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        alert('Sessão expirada. Faça login novamente.')
        return
      }

      const response = await fetch('/api/google-calendar/sync/full', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error('Sync failed')
      }

      await fetchConnection()
      alert('Sincronização concluída!')
    } catch (error) {
      console.error('Error syncing:', error)
      alert('Erro ao sincronizar')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
          <span className="text-white text-xl">📅</span>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Google Calendar</h3>
          <p className="text-xs text-gray-500">Sincronize seus eventos automaticamente</p>
        </div>
      </div>

      {connection ? (
        <div className="space-y-3">
          {/* Status da conexão */}
          <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-2">
              <span className="text-green-600 text-sm">✓</span>
              <div>
                <p className="text-xs font-medium text-green-900">Conectado</p>
                <p className="text-xs text-green-700">{connection.google_email}</p>
              </div>
            </div>
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
          </div>

          {/* Última sincronização */}
          {connection.last_sync_at && (
            <div className="text-xs text-gray-600">
              Última sincronização: {new Date(connection.last_sync_at).toLocaleString('pt-BR')}
            </div>
          )}

          {/* Toggle sincronização automática */}
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="text-xs font-medium text-gray-900">Sincronização automática</p>
              <p className="text-xs text-gray-500">Eventos sincronizam em tempo real</p>
            </div>
            <button
              onClick={handleToggleSync}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                connection.sync_enabled ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  connection.sync_enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Botões de ação */}
          <div className="flex gap-2">
            <button
              onClick={handleSyncNow}
              disabled={syncing}
              className="flex-1 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? '🔄 Sincronizando...' : '🔄 Sincronizar agora'}
            </button>
            <button
              onClick={handleDisconnect}
              className="px-3 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
            >
              Desconectar
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-600">
            Conecte sua conta Google para sincronizar eventos automaticamente entre o sistema e o Google Calendar.
          </p>
          <button
            onClick={handleConnect}
            className="w-full px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all shadow-sm hover:shadow flex items-center justify-center gap-2"
          >
            <span>🔗</span>
            Conectar Google Calendar
          </button>
        </div>
      )}
    </div>
  )
}
