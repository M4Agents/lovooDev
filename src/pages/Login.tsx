import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LogIn, Mail, Lock, Building2 } from 'lucide-react';

export const Login: React.FC = () => {
  const { t } = useTranslation('auth');
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showResendButton, setShowResendButton] = useState(false);
  const { signIn, signUp, resendConfirmationEmail } = useAuth();
  const navigate = useNavigate();

  // CORREÇÃO: Interceptar tokens de convite como backup
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const type = urlParams.get('type');
    
    if (type === 'invite' && token) {
      console.log('Login: Invite token detected, redirecting to accept-invite');
      navigate(`/accept-invite?${urlParams.toString()}`);
    }
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await signIn(email, password);
      } else {
        await signUp(email, password, companyName);
      }
      navigate('/dashboard');
    } catch (err: any) {
      const errorMessage = err.message || t('login.errors.generic');
      setError(errorMessage);
      
      // 🔧 MOSTRAR BOTÃO DE REENVIO SE FOR ERRO DE EMAIL NÃO CONFIRMADO
      if (errorMessage.includes('Email não confirmado') || errorMessage.includes('Email not confirmed')) {
        setShowResendButton(true);
      } else {
        setShowResendButton(false);
      }
    } finally {
      setLoading(false);
    }
  };

  // 🔧 FUNÇÃO PARA REENVIAR EMAIL DE CONFIRMAÇÃO
  const handleResendConfirmation = async () => {
    if (!email) {
      setError(t('login.errors.enterEmailFirst'));
      return;
    }

    setLoading(true);
    try {
      await resendConfirmationEmail(email);
      setError('');
      setShowResendButton(false);
      // Mostrar mensagem de sucesso
      setError(t('login.successConfirmationResent'));
    } catch (err: any) {
      setError(err.message || t('login.errors.resendConfirmationFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Main Card */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          {/* Header integrado ao card */}
          <div className="text-center pt-8 pb-6 px-8">
            <div className="mx-auto mb-1 flex items-center justify-center" style={{ width: '226px', height: '96px' }}>
              <img 
                src="https://app.lovoocrm.com/images/emails/logo_fundo_branco-300x128.png" 
                alt={t('login.brandLogoAlt')} 
                className="w-full h-full object-contain"
              />
            </div>
            <h2 className="text-xl font-semibold text-gray-800 mb-1">{t('login.heroTagline')}</h2>
            <p className="text-sm text-gray-500">{t('login.heroSubtitle')}</p>
          </div>

          {/* Form Section */}
          <div className="px-8 pb-8">
          {/* Toggle Buttons */}
          <div className="flex bg-gray-100 rounded-lg p-1 mb-8">
            <button
              type="button"
              onClick={() => setIsLogin(true)}
              className={`flex-1 py-2.5 px-4 rounded-md font-medium transition-all duration-200 ${
                isLogin
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t('login.toggleSignIn')}
            </button>
            <button
              type="button"
              onClick={() => setIsLogin(false)}
              className={`flex-1 py-2.5 px-4 rounded-md font-medium transition-all duration-200 ${
                !isLogin
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t('login.toggleSignUp')}
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {!isLogin && (
              <div>
                <label htmlFor="companyName" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('login.fields.companyName')}
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    id="companyName"
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-gray-50 focus:bg-white"
                    placeholder={t('login.fields.companyPlaceholder')}
                    required={!isLogin}
                  />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                {t('login.fields.email')}
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-gray-50 focus:bg-white"
                  placeholder={t('login.fields.emailPlaceholder')}
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                {t('login.fields.password')}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-gray-50 focus:bg-white"
                  placeholder={t('login.fields.passwordPlaceholder')}
                  required
                />
              </div>
            </div>

            {error && (
              <div className={`border rounded-lg p-4 text-sm ${
                error.includes('✅') 
                  ? 'bg-green-50 border-green-200 text-green-700' 
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    error.includes('✅') ? 'bg-green-500' : 'bg-red-500'
                  }`}></div>
                  {error}
                </div>
                
                {/* 🔧 BOTÃO DE REENVIO DE CONFIRMAÇÃO */}
                {showResendButton && (
                  <div className="mt-3 pt-3 border-t border-red-200">
                    <button
                      type="button"
                      onClick={handleResendConfirmation}
                      disabled={loading}
                      className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-200 text-sm"
                    >
                      {loading ? t('login.actions.resending') : t('login.actions.resendConfirmation')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Link Esqueci Minha Senha - Apenas no modo Login */}
            {isLogin && (
              <div className="text-right">
                <Link
                  to="/forgot-password"
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
                >
                  {t('login.linkForgotPassword')}
                </Link>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-medium py-3.5 px-4 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <LogIn className="w-5 h-5" />
              )}
              {loading ? t('login.actions.processing') : isLogin ? t('login.actions.signIn') : t('login.actions.createAccount')}
            </button>
          </form>

            {/* Footer */}
            <div className="mt-8 pt-6 border-t border-gray-200 text-center">
              <p className="text-sm text-gray-500">
                {t('marketing.tagline')}
              </p>
            </div>
          </div>
        </div>

        {/* Bottom Text */}
        <div className="text-center mt-6">
          <p className="text-sm text-gray-500">
            {t('marketing.trustBadges')}
          </p>
        </div>
      </div>
    </div>
  );
};
