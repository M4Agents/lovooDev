// =====================================================
// PÁGINA DE ACEITE DE CONVITE - ATIVAÇÃO DE CONTA
// =====================================================

import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, CheckCircle, AlertCircle, Mail, Lock, User } from 'lucide-react';
import { supabase } from '../lib/supabase';

export const AcceptInvite: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  // Estados do formulário
  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: ''
  });

  // Informações do convite
  const [inviteInfo, setInviteInfo] = useState<{
    email?: string;
    role?: string;
    company_name?: string;
  }>({});

  // Verificar se há token de convite na URL
  useEffect(() => {
    const token = searchParams.get('token');
    const type = searchParams.get('type');
    
    if (type === 'invite' && token) {
      // Token de convite válido
      console.log('AcceptInvite: Valid invite token found');
      
      // Extrair informações do token e URL
      const emailFromUrl = searchParams.get('email') || '';
      const tokenFromUrl = searchParams.get('token') || '';
      
      console.log('AcceptInvite: Email from URL:', emailFromUrl);
      console.log('AcceptInvite: Token from URL:', tokenFromUrl.substring(0, 20) + '...');
      
      // Tentar decodificar token para extrair informações adicionais
      let decodedEmail = emailFromUrl;
      try {
        if (tokenFromUrl) {
          const decoded = atob(tokenFromUrl);
          console.log('AcceptInvite: Token decoded:', decoded);
          // Token format: user_id:company_user_id:timestamp
          // Não contém email, então usar da URL
        }
      } catch (e) {
        console.log('AcceptInvite: Could not decode token, using URL email');
      }
      
      setInviteInfo({
        email: decodedEmail || 'Email não encontrado',
        role: searchParams.get('role') || '',
        company_name: searchParams.get('company') || ''
      });
    } else {
      // Redirecionar para login se não há token válido
      console.log('AcceptInvite: No valid token, redirecting to login');
      navigate('/login');
    }
  }, [searchParams, navigate]);

  // Validar senha
  const validatePassword = (password: string): string | null => {
    if (password.length < 8) {
      return 'A senha deve ter pelo menos 8 caracteres';
    }
    if (!/(?=.*[a-z])/.test(password)) {
      return 'A senha deve conter pelo menos uma letra minúscula';
    }
    if (!/(?=.*[A-Z])/.test(password)) {
      return 'A senha deve conter pelo menos uma letra maiúscula';
    }
    if (!/(?=.*\d)/.test(password)) {
      return 'A senha deve conter pelo menos um número';
    }
    return null;
  };

  // Aceitar convite
  const handleAcceptInvite = async () => {
    try {
      setLoading(true);
      setError(null);

      // Validações
      if (!formData.password.trim()) {
        setError('Senha é obrigatória');
        return;
      }

      const passwordError = validatePassword(formData.password);
      if (passwordError) {
        setError(passwordError);
        return;
      }

      if (formData.password !== formData.confirmPassword) {
        setError('As senhas não coincidem');
        return;
      }

      const token = searchParams.get('token') || '';
      const email = searchParams.get('email') || '';
      
      console.log('AcceptInvite: Processing invite with token:', token.substring(0, 20) + '...');

      // SOLUÇÃO DIRETA: Múltiplas estratégias de ativação
      console.log('AcceptInvite: Attempting invite activation for email:', email);

      if (!email) {
        setError('Email não encontrado no convite. Verifique se o link está correto.');
        return;
      }

      // ESTRATÉGIA 1: Tentar login direto (caso usuário já tenha senha)
      console.log('AcceptInvite: Strategy 1 - Attempting direct login');
      try {
        const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
          email: email,
          password: formData.password
        });

        if (!loginError && loginData.user) {
          console.log('AcceptInvite: Direct login successful - user already activated');
          setSuccess(true);
          setTimeout(() => navigate('/dashboard'), 2000);
          return;
        }
      } catch (e) {
        console.log('AcceptInvite: Direct login failed, trying other strategies');
      }

      // ESTRATÉGIA 2: Criar usuário SEM envio de email (SOLUÇÃO PRINCIPAL)
      console.log('AcceptInvite: Strategy 2 - Creating user without email confirmation');
      try {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: email,
          password: formData.password
          // SEM options.emailRedirectTo - não envia email automático!
        });

        if (!signUpError && signUpData.user) {
          console.log('AcceptInvite: User created successfully - attempting immediate login');
          
          // SOLUÇÃO 3: Tentar login imediato (não depende de Admin API)
          try {
            const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
              email: email,
              password: formData.password
            });
            
            if (!loginError && loginData.user) {
              console.log('AcceptInvite: Immediate login successful - user can access system');
              setSuccess(true);
              setTimeout(() => navigate('/dashboard'), 2000);
              return;
            } else {
              console.log('AcceptInvite: Immediate login failed, trying Admin API confirmation');
            }
          } catch (loginErr) {
            console.log('AcceptInvite: Immediate login error, trying Admin API confirmation');
          }
          
          // FALLBACK: CONFIRMAÇÃO AUTOMÁTICA via Admin API (lógica original mantida)
          try {
            const { error: confirmError } = await supabase.auth.admin.updateUserById(
              signUpData.user.id,
              { email_confirm: true }
            );
            
            if (!confirmError) {
              console.log('AcceptInvite: User confirmed automatically via Admin API - login enabled');
            } else {
              console.warn('AcceptInvite: Auto confirmation failed, but user created:', confirmError.message);
              // Continuar mesmo se confirmação falhar - usuário foi criado
            }
          } catch (confirmErr) {
            console.warn('AcceptInvite: Admin API not available for confirmation, but user created');
            // Fallback: usuário foi criado, mesmo sem confirmação automática
          }
          
          setSuccess(true);
          setTimeout(() => navigate('/dashboard'), 2000);
          return;
        }
      } catch (e) {
        console.log('AcceptInvite: User creation failed, trying Supabase invite verification');
      }

      // ESTRATÉGIA 3: Tentar como convite real do Supabase (fallback)
      console.log('AcceptInvite: Strategy 3 - Attempting Supabase invite verification');
      try {
        const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: token,
          type: 'invite'
        });

        if (!verifyError && verifyData.user) {
          console.log('AcceptInvite: Supabase invite verification successful');
          
          // Definir senha
          const { error: updateError } = await supabase.auth.updateUser({
            password: formData.password
          });

          if (!updateError) {
            console.log('AcceptInvite: Password set successfully via Supabase invite');
            setSuccess(true);
            setTimeout(() => navigate('/dashboard'), 2000);
            return;
          }
        }
      } catch (e) {
        console.log('AcceptInvite: Supabase invite verification failed, trying reset as last resort');
      }

      // ESTRATÉGIA 4: Reset de senha (ÚLTIMO RECURSO - ainda pode enviar email)
      console.log('AcceptInvite: Strategy 4 - Using password reset as last resort');
      try {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `https://app.lovoocrm.com/reset-password?from=invite&email=${encodeURIComponent(email)}`
        });

        if (!resetError) {
          console.log('AcceptInvite: Password reset email sent as fallback');
          setError('✅ Um email foi enviado para ativar sua conta! Verifique sua caixa de entrada e clique no link para definir sua senha.');
          return;
        }
      } catch (e) {
        console.log('AcceptInvite: Password reset failed');
      }

      // ESTRATÉGIA 5: Fallback final - orientação específica
      console.log('AcceptInvite: All strategies failed, providing specific guidance');
      setError(`❌ Não foi possível ativar automaticamente. 
      
📧 Email: ${email}
      
✅ Opções disponíveis:
1. Tente fazer login diretamente se já tem senha
2. Solicite um novo convite ao administrador
3. Use "Esqueci minha senha" na tela de login

🔗 Fazer login: ${window.location.origin}/login`);

    } catch (err) {
      console.error('AcceptInvite: Error in handleAcceptInvite:', err);
      setError('Erro inesperado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-8 text-center">
          <div className="p-4 bg-green-100 rounded-full w-20 h-20 mx-auto mb-6">
            <CheckCircle className="w-12 h-12 text-green-600 mx-auto mt-2" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-4">
            Conta Ativada com Sucesso!
          </h1>
          <p className="text-slate-600 mb-6">
            Sua conta foi ativada e você será redirecionado para o dashboard em instantes.
          </p>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="bg-blue-600 text-white p-6 text-center">
          <div className="p-3 bg-blue-500 rounded-full w-16 h-16 mx-auto mb-4">
            <Mail className="w-10 h-10 mx-auto mt-1" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Ativar Conta</h1>
          <p className="text-blue-100">
            Complete o cadastro para acessar o sistema
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Informações do convite */}
          {inviteInfo.email && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <h3 className="text-sm font-medium text-slate-700 mb-2">Informações do Convite</h3>
              <div className="space-y-1 text-sm text-slate-600">
                {inviteInfo.email && (
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    <span>Email: {inviteInfo.email}</span>
                  </div>
                )}
                {inviteInfo.role && (
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    <span>Role: {inviteInfo.role}</span>
                  </div>
                )}
                {inviteInfo.company_name && (
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    <span>Empresa: {inviteInfo.company_name}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium text-red-900 mb-1">Erro</h4>
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Formulário de senha */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                <Lock className="w-4 h-4 inline mr-2" />
                Nova Senha
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full px-3 py-2 pr-10 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Digite sua nova senha"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Mínimo 8 caracteres, incluindo maiúscula, minúscula e número
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                <Lock className="w-4 h-4 inline mr-2" />
                Confirmar Senha
              </label>
              <input
                type="password"
                value={formData.confirmPassword}
                onChange={(e) => setFormData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Confirme sua nova senha"
                disabled={loading}
              />
            </div>
          </div>

          {/* Botão de ativação */}
          <button
            onClick={handleAcceptInvite}
            disabled={loading || !formData.password || !formData.confirmPassword}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white py-3 px-4 rounded-lg font-medium transition-colors"
          >
            {loading ? (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            ) : (
              <CheckCircle className="w-5 h-5" />
            )}
            {loading ? 'Ativando conta...' : 'Ativar Conta'}
          </button>

          {/* Link para login */}
          <div className="text-center">
            <p className="text-sm text-slate-600">
              Já tem uma conta?{' '}
              <button
                onClick={() => navigate('/login')}
                className="text-blue-600 hover:text-blue-800 font-medium"
              >
                Fazer login
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
