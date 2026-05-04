// =====================================================
// MODAL DE LINK DE CONVITE - REENVIO SEGURO
// =====================================================
// Gera magic link real via backend (Supabase Admin API)
// Substitui o token fake btoa() que não criava sessão

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Copy, ExternalLink, Mail, CheckCircle, AlertCircle, RefreshCw, KeyRound, Eye, EyeOff } from 'lucide-react';
import { CompanyUser } from '../../types/user';
import { supabase } from '../../lib/supabase';
import { changePassword } from '../../services/authAdmin';

type ModalMode = 'link' | 'password';

interface InviteLinkProps {
  isOpen: boolean;
  onClose: () => void;
  user: CompanyUser | null;
  companyId: string;
}

export const InviteLink: React.FC<InviteLinkProps> = ({ isOpen, onClose, user, companyId }) => {
  const { t } = useTranslation('settings.app');

  // — Magic link state —
  const [mode, setMode] = useState<ModalMode>('link');
  const [copied, setCopied] = useState(false);
  const [realEmail, setRealEmail] = useState<string>('');
  const [magicLink, setMagicLink] = useState<string>('');
  const [loadingLink, setLoadingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // — Password form state —
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [forcePasswordChange, setForcePasswordChange] = useState(true);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  // Resetar estado ao abrir/fechar modal
  useEffect(() => {
    if (!isOpen) {
      setMode('link');
      setNewPassword('');
      setConfirmPassword('');
      setShowNewPassword(false);
      setShowConfirmPassword(false);
      setForcePasswordChange(true);
      setPasswordError(null);
      setPasswordSuccess(null);
    }
  }, [isOpen]);

  // Buscar email real do usuário quando modal abrir
  useEffect(() => {
    const fetchRealEmail = async () => {
      if (!user || !isOpen) return;

      try {
        const { data: emailResult, error } = await supabase.rpc('get_user_email_safe', {
          p_user_id: user.user_id
        });

        if (!error && emailResult) {
          setRealEmail(emailResult);
        } else {
          setRealEmail(user._email || '');
        }
      } catch {
        setRealEmail(user._email || '');
      }
    };

    fetchRealEmail();
  }, [user, isOpen]);

  // Gerar magic link real via backend quando email estiver disponível
  useEffect(() => {
    const email = realEmail || user?._email || '';
    if (!email || !isOpen) return;

    generateMagicLink(email);
  }, [realEmail, isOpen]);

  const generateMagicLink = async (email: string) => {
    setLoadingLink(true);
    setLinkError(null);
    setMagicLink('');

    try {
      // #region agent log
      fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'56e383'},body:JSON.stringify({sessionId:'56e383',location:'InviteLink.tsx:generateMagicLink',message:'InviteLink.generateMagicLink called — buscando sessão',data:{email},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      // #region agent log
      fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'56e383'},body:JSON.stringify({sessionId:'56e383',location:'InviteLink.tsx:generateMagicLink',message:'token obtido',data:{hasToken:!!token},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      if (!token) {
        setLinkError('Não autenticado');
        setLoadingLink(false);
        return;
      }

      const response = await fetch('/api/auth/generate-magic-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ email })
      });

      const result = await response.json();

      // #region agent log
      fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'56e383'},body:JSON.stringify({sessionId:'56e383',location:'InviteLink.tsx:generateMagicLink',message:'generate-magic-link resposta',data:{status:response.status,hasLink:!!result.magicLink,error:result.error??null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      if (!response.ok || result.error) {
        setLinkError(result.error || t('users.invite.fallbackGenerateError'));
        return;
      }

      setMagicLink(result.magicLink);
    } catch {
      setLinkError(t('users.invite.connectionError'));
    } finally {
      setLoadingLink(false);
    }
  };

  const handleCopyLink = async () => {
    if (!magicLink) return;
    try {
      await navigator.clipboard.writeText(magicLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.error('Erro ao copiar link');
    }
  };

  const handleOpenLink = () => {
    if (!magicLink) return;
    window.open(magicLink, '_blank');
  };

  const handleRefresh = () => {
    const email = realEmail || user?._email || '';
    if (email) generateMagicLink(email);
  };

  const handleSetPassword = async () => {
    setPasswordError(null);

    if (newPassword.length < 6) {
      setPasswordError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('As senhas não coincidem.');
      return;
    }
    if (!user?.user_id || !companyId) {
      setPasswordError('Contexto inválido. Feche e tente novamente.');
      return;
    }

    try {
      setPasswordLoading(true);
      const result = await changePassword(user.user_id, newPassword, companyId, forcePasswordChange);

      if (!result.success) {
        setPasswordError(result.error || 'Erro ao definir senha.');
        return;
      }

      const name = realEmail || user._email || user.user_id;
      setPasswordSuccess(
        forcePasswordChange
          ? `Senha temporária definida para ${name}. O usuário deverá alterá-la no primeiro acesso.`
          : `Senha definida com sucesso para ${name}.`
      );
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setPasswordError('Erro inesperado. Tente novamente.');
    } finally {
      setPasswordLoading(false);
    }
  };

  const isPasswordValid = newPassword.length >= 6;
  const doPasswordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;
  const canSubmitPassword = isPasswordValid && doPasswordsMatch && !passwordLoading;

  if (!isOpen || !user) return null;

  const displayEmail = realEmail || user._email || user.user_id;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Mail className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {t('users.invite.title')}
              </h2>
              <p className="text-sm text-slate-600">
                {t('users.invite.subtitle')}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Informações do usuário */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-slate-200 flex items-center justify-center">
                <Mail className="w-5 h-5 text-slate-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">{displayEmail}</p>
                <p className="text-xs text-slate-600">
                  {t('users.invite.roleIdLine', { role: user.role, id: user.id.slice(0, 8) })}
                </p>
              </div>
            </div>
          </div>

          {/* Toggle de modo */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            <button
              onClick={() => { setMode('link'); setPasswordError(null); setPasswordSuccess(null); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors ${
                mode === 'link'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Mail className="w-4 h-4" />
              Link de acesso
            </button>
            <button
              onClick={() => { setMode('password'); setLinkError(null); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors ${
                mode === 'password'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <KeyRound className="w-4 h-4" />
              Definir senha
            </button>
          </div>

          {/* Painel: Link de acesso */}
          {mode === 'link' && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-slate-700">
                    {t('users.invite.linkLabel')}
                  </label>
                  <button
                    onClick={handleRefresh}
                    disabled={loadingLink}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingLink ? 'animate-spin' : ''}`} />
                    {t('users.invite.regenerate')}
                  </button>
                </div>

                {loadingLink && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mx-auto mb-2" />
                    <p className="text-sm text-slate-600">{t('users.invite.generating')}</p>
                  </div>
                )}

                {linkError && !loadingLink && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />
                      <p className="text-sm text-red-700">{linkError}</p>
                    </div>
                  </div>
                )}

                {magicLink && !loadingLink && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <code className="text-xs text-slate-800 flex-1 break-all">{magicLink}</code>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={handleCopyLink}
                          className="p-1 hover:bg-slate-200 rounded transition-colors"
                          title={t('users.invite.copyTitle')}
                        >
                          <Copy className="w-4 h-4 text-slate-600" />
                        </button>
                        <button
                          onClick={handleOpenLink}
                          className="p-1 hover:bg-slate-200 rounded transition-colors"
                          title={t('users.invite.openTitle')}
                        >
                          <ExternalLink className="w-4 h-4 text-slate-600" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {copied && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    {t('users.messages.linkCopied')}
                  </p>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-blue-900 mb-2">{t('users.invite.howToTitle')}</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>{t('users.invite.howToStep1')}</li>
                  <li>{t('users.invite.howToStep2')}</li>
                  <li>{t('users.invite.howToStep3')}</li>
                  <li>{t('users.invite.howToStep4')}</li>
                </ul>
                <p className="text-xs text-blue-700 mt-2">{t('users.invite.linkExpires')}</p>
              </div>
            </>
          )}

          {/* Painel: Definir senha temporária */}
          {mode === 'password' && (
            <div className="space-y-4">
              {passwordSuccess ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-green-800">{passwordSuccess}</p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-600">
                    Define uma senha diretamente para o usuário. Ele poderá acessar o sistema sem
                    precisar do link de validação.
                  </p>

                  {/* Campo nova senha */}
                  <div className="space-y-1">
                    <label className="block text-sm font-medium text-slate-700">Nova senha</label>
                    <div className="relative">
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Mínimo 6 caracteres"
                        className="w-full px-3 py-2 pr-10 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {newPassword.length > 0 && !isPasswordValid && (
                      <p className="text-xs text-red-600">Mínimo 6 caracteres</p>
                    )}
                  </div>

                  {/* Campo confirmar senha */}
                  <div className="space-y-1">
                    <label className="block text-sm font-medium text-slate-700">Confirmar senha</label>
                    <div className="relative">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repita a senha"
                        className="w-full px-3 py-2 pr-10 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {confirmPassword.length > 0 && !doPasswordsMatch && (
                      <p className="text-xs text-red-600">As senhas não coincidem</p>
                    )}
                    {doPasswordsMatch && confirmPassword.length > 0 && (
                      <p className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Senhas coincidem
                      </p>
                    )}
                  </div>

                  {/* Exigir troca no 1º acesso */}
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={forcePasswordChange}
                      onChange={(e) => setForcePasswordChange(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600"
                    />
                    <div>
                      <span className="text-sm font-medium text-slate-700">
                        Exigir troca de senha no primeiro acesso
                      </span>
                      <p className="text-xs text-slate-500">Recomendado para senhas temporárias</p>
                    </div>
                  </label>

                  {/* Erro */}
                  {passwordError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                        <p className="text-sm text-red-700">{passwordError}</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-slate-200">
          {mode === 'link' ? (
            <button
              onClick={handleCopyLink}
              disabled={!magicLink || loadingLink}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              <Copy className="w-4 h-4" />
              {copied ? t('users.invite.footerCopied') : t('users.invite.footerCopy')}
            </button>
          ) : passwordSuccess ? (
            <button
              onClick={() => { setPasswordSuccess(null); setMode('link'); }}
              className="flex items-center gap-2 bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              Voltar ao link
            </button>
          ) : (
            <button
              onClick={handleSetPassword}
              disabled={!canSubmitPassword}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              {passwordLoading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              ) : (
                <KeyRound className="w-4 h-4" />
              )}
              {passwordLoading ? 'Definindo...' : 'Definir Senha'}
            </button>
          )}
          <button
            onClick={onClose}
            className="text-slate-600 hover:text-slate-800 px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {t('users.actions.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
