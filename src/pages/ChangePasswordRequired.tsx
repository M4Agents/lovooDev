// =====================================================
// PÁGINA ALTERAÇÃO OBRIGATÓRIA DE SENHA
// =====================================================

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff, CheckCircle, Loader2, AlertTriangle, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export const ChangePasswordRequired: React.FC = () => {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const validatePassword = useCallback((password: string) => {
    if (password.length < 6) {
      return t('changePasswordRequired.validation.minLength');
    }
    return null;
  }, [t]);

  const formatTimeRemaining = useCallback(() => {
    if (!expiresAt) return null;
    
    const now = new Date();
    const expires = new Date(expiresAt);
    const diff = expires.getTime() - now.getTime();
    
    if (diff <= 0) return t('changePasswordRequired.time.expired');
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return t('changePasswordRequired.time.hoursMinutes', { hours, minutes });
    }
    return t('changePasswordRequired.time.minutesOnly', { minutes });
  }, [expiresAt, t]);

  // Verificar se realmente precisa alterar senha
  useEffect(() => {
    const checkPasswordRequirement = () => {
      if (!user?.app_metadata?.must_change_password) {
        // Se não precisa alterar, redirecionar para dashboard
        navigate('/dashboard');
        return;
      }

      // Verificar expiração
      const expires = user.app_metadata?.password_expires_at;
      if (expires) {
        setExpiresAt(expires);
        
        // Se expirou, fazer logout
        if (new Date() > new Date(expires)) {
          signOut();
          navigate('/login');
          return;
        }
      }
    };

    checkPasswordRequirement();
  }, [user, navigate, signOut]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validações
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('changePasswordRequired.validation.mismatch'));
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Atualizar senha e remover flag de alteração obrigatória
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (updateError) {
        throw updateError;
      }

      // Remover metadata de alteração obrigatória
      const { error: metadataError } = await supabase.auth.updateUser({
        data: {
          must_change_password: false,
          password_expires_at: null,
          password_type: 'user_defined',
          password_changed_at: new Date().toISOString()
        }
      });

      if (metadataError) {
        console.warn('Failed to update metadata:', metadataError);
      }

      // Redirecionar para dashboard
      navigate('/dashboard');

    } catch (err) {
      console.error('Error changing password:', err);
      setError(err instanceof Error ? err.message : t('changePasswordRequired.errors.changeFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="mx-auto w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-4">
            <Lock className="w-8 h-8 text-orange-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {t('changePasswordRequired.title')}
          </h1>
          <p className="text-gray-600">
            {t('changePasswordRequired.subtitle')}
          </p>
        </div>

        {/* Aviso de expiração */}
        {expiresAt && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-orange-600 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium text-orange-900 mb-1">
                  {t('changePasswordRequired.temporaryPassword.title')}
                </h4>
                <p className="text-sm text-orange-700">
                  {formatTimeRemaining()}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Nova Senha */}
          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-2">
              {t('changePasswordRequired.fields.newPassword')}
            </label>
            <div className="relative">
              <input
                id="newPassword"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError(null);
                }}
                className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                placeholder={t('changePasswordRequired.fields.newPasswordPlaceholder')}
                disabled={loading}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {newPassword && (
              <div className="mt-2">
                <div className={`text-xs ${newPassword.length >= 6 ? 'text-green-600' : 'text-red-600'}`}>
                  {newPassword.length >= 6 ? '✓' : '×'} {t('changePasswordRequired.fields.hintMinLength')}
                </div>
              </div>
            )}
          </div>

          {/* Confirmar Senha */}
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
              {t('changePasswordRequired.fields.confirmPassword')}
            </label>
            <div className="relative">
              <input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError(null);
                }}
                className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                placeholder={t('changePasswordRequired.fields.confirmPasswordPlaceholder')}
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {confirmPassword && (
              <div className="mt-2">
                <div className={`text-xs ${newPassword === confirmPassword ? 'text-green-600' : 'text-red-600'}`}>
                  {newPassword === confirmPassword ? '✓' : '×'} {t('changePasswordRequired.fields.hintMatch')}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
                <p className="text-sm text-red-600">{error}</p>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !newPassword || !confirmPassword || newPassword !== confirmPassword}
            className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('changePasswordRequired.actions.changing')}
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                {t('changePasswordRequired.actions.confirm')}
              </>
            )}
          </button>
        </form>

        {/* Logout Option */}
        <div className="mt-6 text-center">
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-700 font-medium"
          >
            {t('changePasswordRequired.signOut')}
          </button>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-500">
            {t('changePasswordRequired.footerSecurity')}
          </p>
        </div>
      </div>
    </div>
  );
};
