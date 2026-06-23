import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Instagram, Plus, Unlink, RefreshCw, AlertCircle, Camera, Clock, Trash2, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { useInstagramConnections } from '../../hooks/useInstagramConnections';
import type { InstagramConnection } from '../../types/instagram-chat';
import { useAccessControl } from '../../hooks/useAccessControl';
import { computeConnectionHealth } from '../../utils/instagram/computeConnectionHealth';
import { InstagramHealthBadge } from '../InstagramHealth/InstagramHealthBadge';
import { InstagramScopeWarning } from '../InstagramHealth/InstagramScopeWarning';

interface Props {
  companyId: string;
}

function ExpiryInfo({ expiresInDays }: { expiresInDays: number | null }) {
  const { t } = useTranslation('settings.app');

  if (expiresInDays === null) return null;
  if (expiresInDays <= 0) return (
    <span className="flex items-center gap-1 text-xs text-red-600">
      <Clock className="w-3 h-3" />
      {t('integrations.instagram.health.tokenExpiredShort')}
    </span>
  );
  if (expiresInDays <= 7) return (
    <span className="flex items-center gap-1 text-xs text-amber-600">
      <Clock className="w-3 h-3" />
      {t('integrations.instagram.health.expiresInDays', { count: expiresInDays })}
    </span>
  );
  if (expiresInDays <= 30) return (
    <span className="flex items-center gap-1 text-xs text-slate-500">
      <Clock className="w-3 h-3" />
      {t('integrations.instagram.health.expiresInDays', { count: expiresInDays })}
    </span>
  );

  return null;
}

function LastErrorInfo({ lastErrorAt }: { lastErrorAt: string | null }) {
  const { t } = useTranslation('settings.app');
  if (!lastErrorAt) return null;

  const date = new Date(lastErrorAt);
  const formatted = date.toLocaleString('pt-BR', {
    day:    '2-digit',
    month:  '2-digit',
    hour:   '2-digit',
    minute: '2-digit',
  });

  return (
    <span className="flex items-center gap-1 text-xs text-red-500">
      <AlertCircle className="w-3 h-3" />
      {t('integrations.instagram.health.lastError', { date: formatted })}
    </span>
  );
}

export function InstagramConnectionPanel({ companyId }: Props) {
  const { t } = useTranslation('settings.app');
  const ig = (key: string, opts?: Record<string, unknown>) =>
    t(`integrations.instagram.${key}`, opts);
  const { canConnectInstagram } = useAccessControl();
  const { connections, loading, loadingAction, error, refetch, connect, disconnect, deleteConnection, syncPhoto } = useInstagramConnections(companyId);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [syncingPhotoId, setSyncingPhotoId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showHandoverTip, setShowHandoverTip] = useState(false);

  async function handleConnect() {
    setActionError(null);
    setSuccessMsg(null);
    await connect(companyId);
  }

  async function handleReconnect(conn: InstagramConnection) {
    setActionError(null);
    setSuccessMsg(null);
    await connect(companyId);
  }

  async function handleDisconnect(conn: InstagramConnection) {
    if (!window.confirm(ig('disconnectConfirm', { account: conn.instagram_username }))) return;
    setDisconnectingId(conn.id);
    setActionError(null);
    setSuccessMsg(null);

    const result = await disconnect(conn.id);
    setDisconnectingId(null);

    if (result.success) {
      setSuccessMsg(ig('disconnectSuccess', { account: conn.instagram_username }));
      setTimeout(() => setSuccessMsg(null), 4000);
    } else {
      setActionError(result.error ?? ig('errorGeneric'));
    }
  }

  async function handleDelete(conn: InstagramConnection) {
    if (!window.confirm(ig('deleteConfirm', { account: conn.instagram_username }))) return;
    setDeletingId(conn.id);
    setActionError(null);
    setSuccessMsg(null);

    const result = await deleteConnection(conn.id);
    setDeletingId(null);

    if (result.success) {
      setSuccessMsg(ig('deleteSuccess', { account: conn.instagram_username }));
      setTimeout(() => setSuccessMsg(null), 4000);
    } else {
      setActionError(result.error ?? ig('errorGeneric'));
    }
  }

  async function handleSyncPhoto(conn: InstagramConnection) {
    setSyncingPhotoId(conn.id);
    setActionError(null);
    setSuccessMsg(null);

    const result = await syncPhoto(conn.id);
    setSyncingPhotoId(null);

    if (result.success) {
      setSuccessMsg(ig('syncPhotoSuccess', { account: conn.instagram_username }));
      setTimeout(() => setSuccessMsg(null), 4000);
    } else {
      setActionError(result.error ?? ig('errorGeneric'));
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{ig('tab')}</h3>
          <p className="text-sm text-slate-500 mt-0.5">{ig('description')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refetch}
            disabled={loading || loadingAction}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
            title="Atualizar"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canConnectInstagram && (
            <button
              onClick={handleConnect}
              disabled={loadingAction}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              <Plus className="w-4 h-4" />
              {loadingAction ? 'Conectando...' : ig('connect')}
            </button>
          )}
        </div>
      </div>

      {/* Dica: conta conectada = conta logada no navegador */}
      {canConnectInstagram && (
        <div className="flex items-start gap-2.5 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-blue-400" />
          <p>{ig('connectHint')}</p>
        </div>
      )}

      {/* Dica: Handover Protocol — Página do Facebook com outro app */}
      {canConnectInstagram && (
        <div className="border border-amber-200 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowHandoverTip(v => !v)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-amber-50 hover:bg-amber-100 transition-colors text-left"
          >
            <div className="flex items-center gap-2 text-sm text-amber-800 font-medium">
              <Info className="w-4 h-4 shrink-0 text-amber-500" />
              Instagram vinculado a uma Página do Facebook com outro app de mensagens?
            </div>
            {showHandoverTip
              ? <ChevronUp className="w-4 h-4 shrink-0 text-amber-500" />
              : <ChevronDown className="w-4 h-4 shrink-0 text-amber-500" />
            }
          </button>

          {showHandoverTip && (
            <div className="px-4 py-3 bg-amber-50 border-t border-amber-100 text-sm text-amber-900 space-y-2">
              <p>{ig('facebookPageHint')}</p>
              <ol className="list-decimal list-inside space-y-1 pl-1">
                <li>{ig('facebookPageStep1')}</li>
                <li>{ig('facebookPageStep2')}</li>
                <li className="font-medium">{ig('facebookPageStep3')}</li>
              </ol>
              <p className="text-xs text-amber-700 mt-2">{ig('facebookPageNote')}</p>
            </div>
          )}
        </div>
      )}

      {/* Mensagens de feedback */}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {successMsg}
        </div>
      )}
      {(error || actionError) && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {actionError ?? error}
        </div>
      )}

      {/* Loading inicial */}
      {loading && connections.length === 0 && (
        <div className="grid gap-4">
          {[1, 2].map(i => (
            <div key={i} className="h-20 bg-slate-100 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {/* Lista vazia */}
      {!loading && connections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-purple-100 to-pink-100 rounded-full flex items-center justify-center mb-4">
            <Instagram className="w-8 h-8 text-purple-500" />
          </div>
          <p className="text-slate-700 font-medium">{ig('empty')}</p>
          <p className="text-sm text-slate-400 mt-1">{ig('emptyHint')}</p>
          {canConnectInstagram && (
            <button
              onClick={handleConnect}
              disabled={loadingAction}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              {ig('connect')}
            </button>
          )}
        </div>
      )}

      {/* Lista de conexões */}
      {connections.length > 0 && (
        <div className="grid gap-3">
          {connections.map(conn => {
            const health = computeConnectionHealth(conn);
            const isCritical = health.level === 'error' || health.level === 'disconnected';

            return (
              <div
                key={conn.id}
                className={`p-4 bg-white border rounded-lg transition-colors ${
                  isCritical
                    ? 'border-red-200 hover:border-red-300'
                    : health.level === 'warning'
                    ? 'border-amber-200 hover:border-amber-300'
                    : 'border-slate-200 hover:border-purple-200'
                }`}
              >
                {/* Linha principal */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative w-10 h-10 shrink-0">
                      {conn.profile_picture_url ? (
                        <img
                          src={conn.profile_picture_url}
                          alt={`@${conn.instagram_username}`}
                          className="w-10 h-10 rounded-full object-cover border border-slate-200"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                          <Instagram className="w-5 h-5 text-white" />
                        </div>
                      )}
                      {canConnectInstagram && health.level === 'healthy' && (
                        <button
                          onClick={() => handleSyncPhoto(conn)}
                          disabled={loadingAction || syncingPhotoId === conn.id}
                          title={ig('syncPhoto')}
                          className="absolute -bottom-1 -right-1 w-5 h-5 bg-white border border-slate-200 rounded-full flex items-center justify-center text-slate-400 hover:text-purple-600 hover:border-purple-300 transition-colors disabled:opacity-50"
                        >
                          <Camera className={`w-3 h-3 ${syncingPhotoId === conn.id ? 'animate-pulse' : ''}`} />
                        </button>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-900 truncate">
                          @{conn.instagram_username}
                        </span>
                        <InstagramHealthBadge health={health} />
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <ExpiryInfo expiresInDays={health.expiresInDays} />
                        <LastErrorInfo lastErrorAt={conn.last_error_at} />
                      </div>
                    </div>
                  </div>

                  {/* Botões de ação */}
                  <div className="flex items-center gap-2 shrink-0">
                    {canConnectInstagram && health.level === 'healthy' && (
                      <button
                        onClick={() => handleDisconnect(conn)}
                        disabled={loadingAction || disconnectingId === conn.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Unlink className="w-3.5 h-3.5" />
                        {disconnectingId === conn.id ? 'Desconectando...' : ig('disconnect')}
                      </button>
                    )}

                    {canConnectInstagram && health.actionRequired === 'reconnect' && (
                      <button
                        onClick={() => handleReconnect(conn)}
                        disabled={loadingAction}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${loadingAction ? 'animate-spin' : ''}`} />
                        {ig('reconnect')}
                      </button>
                    )}

                    {canConnectInstagram && health.level === 'disconnected' && (
                      <button
                        onClick={() => handleDelete(conn)}
                        disabled={loadingAction || deletingId === conn.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {deletingId === conn.id ? 'Excluindo...' : ig('delete')}
                      </button>
                    )}
                  </div>
                </div>

                {/* Aviso de escopo ausente */}
                {health.missingScopes.length > 0 && (
                  <div className="mt-3">
                    <InstagramScopeWarning
                      missingScopes={health.missingScopes}
                      onReconnect={canConnectInstagram ? () => handleReconnect(conn) : undefined}
                      loading={loadingAction}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
