import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Instagram, Plus, Unlink, RefreshCw, AlertCircle, Camera, Clock, Trash2, Eye, EyeOff } from 'lucide-react';
import { useInstagramConnections } from '../../hooks/useInstagramConnections';
import type { ConnectWithTokenResult } from '../../hooks/useInstagramConnections';
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
  const { connections, loading, loadingAction, error, refetch, connect, connectWithToken, disconnect, deleteConnection, syncPhoto } = useInstagramConnections(companyId);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [syncingPhotoId, setSyncingPhotoId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Estados do modal de conexão por token
  const [showTokenModal, setShowTokenModal]       = useState(false);
  const [rawToken, setRawToken]                   = useState('');
  const [showTokenValue, setShowTokenValue]       = useState(false);
  const [tokenLoading, setTokenLoading]           = useState(false);
  const [tokenResult, setTokenResult]             = useState<ConnectWithTokenResult | null>(null);
  const tokenInputRef                             = useRef<HTMLInputElement>(null);

  function openTokenModal() {
    setRawToken('');
    setTokenResult(null);
    setShowTokenValue(false);
    setShowTokenModal(true);
    setTimeout(() => tokenInputRef.current?.focus(), 100);
  }

  function closeTokenModal() {
    setRawToken('');
    setTokenResult(null);
    setShowTokenValue(false);
    setShowTokenModal(false);
  }

  async function handleConnectWithToken() {
    if (!rawToken.trim()) return;

    setTokenLoading(true);
    setTokenResult(null);

    const result = await connectWithToken(companyId, rawToken.trim());

    setRawToken(''); // limpar sempre, independente do resultado
    setTokenLoading(false);
    setTokenResult(result);

    if (result.success) {
      // Fechar automaticamente após 4s em caso de sucesso total
      if (result.status === 'active') {
        setTimeout(() => closeTokenModal(), 4000);
      }
    }
  }

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
            <div className="flex flex-col items-end gap-1">
              <button
                onClick={handleConnect}
                disabled={loadingAction}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                <Plus className="w-4 h-4" />
                {loadingAction ? 'Conectando...' : ig('connect')}
              </button>
              <button
                onClick={openTokenModal}
                disabled={loadingAction}
                className="text-xs text-slate-400 hover:text-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Conectar com token (avançado)
              </button>
            </div>
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

      {/* Tela vazia: botão secundário de token abaixo do botão OAuth */}
      {!loading && connections.length === 0 && canConnectInstagram && (
        <div className="flex justify-center">
          <button
            onClick={openTokenModal}
            disabled={loadingAction}
            className="text-xs text-slate-400 hover:text-purple-600 transition-colors disabled:opacity-50"
          >
            Conectar com token (avançado)
          </button>
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
      {/* Modal: Conectar com token */}
      {showTokenModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeTokenModal(); }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg">
                  <Instagram className="w-4 h-4 text-white" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">Conectar com token</h3>
              </div>
              <button
                onClick={closeTokenModal}
                disabled={tokenLoading}
                className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            {/* Resultado de sucesso */}
            {tokenResult?.success && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">
                      {tokenResult.username ? `@${tokenResult.username} conectado!` : 'Conta conectada com sucesso!'}
                    </p>
                    {tokenResult.status === 'limited' && (
                      <p className="mt-1 text-amber-700">
                        Status: <strong>limitado</strong> — webhooks não configurados.
                      </p>
                    )}
                  </div>
                </div>

                {/* Aviso de webhook não configurado */}
                {(!tokenResult.webhook_subscribed || tokenResult.status === 'limited') && (
                  <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <p>
                      {tokenResult.warning ??
                        'O recebimento de mensagens pode não funcionar. Verifique as permissões do token.'}
                    </p>
                  </div>
                )}

                <button
                  onClick={closeTokenModal}
                  className="w-full px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 transition-colors"
                >
                  Fechar
                </button>
              </div>
            )}

            {/* Resultado de erro */}
            {tokenResult && !tokenResult.success && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>{tokenResult.error ?? 'Erro ao conectar. Tente novamente.'}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTokenResult(null)}
                    className="flex-1 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all"
                  >
                    Tentar novamente
                  </button>
                  <button
                    onClick={closeTokenModal}
                    className="flex-1 px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Formulário (visível apenas quando não há resultado) */}
            {!tokenResult && (
              <>
                <p className="text-sm text-slate-500">
                  Insira um token de acesso gerado pelo painel{' '}
                  <a
                    href="https://developers.facebook.com/tools/explorer/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-600 hover:underline"
                  >
                    Meta Graph API Explorer
                  </a>{' '}
                  usando o app desta plataforma.
                </p>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700">
                    Token de acesso
                  </label>
                  <div className="relative">
                    <input
                      ref={tokenInputRef}
                      type={showTokenValue ? 'text' : 'password'}
                      value={rawToken}
                      onChange={(e) => setRawToken(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !tokenLoading) handleConnectWithToken(); }}
                      disabled={tokenLoading}
                      placeholder="Cole o token aqui..."
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      className="w-full pr-10 pl-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent disabled:opacity-50 disabled:bg-slate-50 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTokenValue(v => !v)}
                      disabled={tokenLoading}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
                      aria-label={showTokenValue ? 'Ocultar token' : 'Mostrar token'}
                    >
                      {showTokenValue
                        ? <EyeOff className="w-4 h-4" />
                        : <Eye className="w-4 h-4" />
                      }
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">
                    O token nunca é armazenado localmente e é criptografado antes de salvar.
                  </p>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleConnectWithToken}
                    disabled={tokenLoading || !rawToken.trim()}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                  >
                    {tokenLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Validando...
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        Conectar
                      </>
                    )}
                  </button>
                  <button
                    onClick={closeTokenModal}
                    disabled={tokenLoading}
                    className="px-4 py-2.5 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
