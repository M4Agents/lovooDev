// =====================================================
// PÁGINA DE ACEITE DE CONVITE - ATIVAÇÃO DE CONTA
// =====================================================

import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, CheckCircle, AlertCircle, Lock, User } from 'lucide-react';
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

  // Função para verificar status de autenticação do usuário
  const checkUserAuthStatus = async () => {
    try {
      console.log('AcceptInvite: Checking user authentication status');
      
      const { data: { user }, error } = await supabase.auth.getUser();
      
      if (error) {
        console.log('AcceptInvite: Error getting user:', error);
        return;
      }
      
      if (user && user.email_confirmed_at) {
        console.log('AcceptInvite: User is confirmed and logged in, redirecting to dashboard');
        setSuccess(true);
        setTimeout(() => navigate('/dashboard'), 2000);
        return;
      }
      
      if (user && !user.email_confirmed_at) {
        console.log('AcceptInvite: User exists but not confirmed');
        const emailFromUrl = searchParams.get('email');
        if (emailFromUrl) {
          setInviteInfo(prev => ({ ...prev, email: emailFromUrl }));
        }
        return;
      }
      
      console.log('AcceptInvite: No authenticated user found');
    } catch (error) {
      console.error('AcceptInvite: Error checking auth status:', error);
    }
  };

  // [DEBUG] Log da URL completa no carregamento da página
  useEffect(() => {
    console.log('[DEBUG AcceptInvite] URL hash:', window.location.hash.substring(0, 80) || '(vazio)');
    console.log('[DEBUG AcceptInvite] URL search:', window.location.search || '(vazio)');
    console.log('[DEBUG AcceptInvite] hasSupabaseHash:', window.location.hash.includes('access_token='));
  }, []);

  // Listener para magic link do Supabase (hash com access_token)
  // Captura o evento SIGNED_IN gerado pelo SDK ao processar o hash da URL
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[DEBUG AcceptInvite] onAuthStateChange event:', event, '| has session:', !!session, '| email:', session?.user?.email || 'none');
      if (event === 'SIGNED_IN' && session?.user) {
        console.log('[DEBUG AcceptInvite] SIGNED_IN — email_confirmed_at:', session.user.email_confirmed_at || 'null');
        const user = session.user;
        setInviteInfo({
          email: user.email || '',
          role: user.user_metadata?.role || '',
          company_name: user.user_metadata?.company_name || ''
        });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Verificar se há token de convite na URL e processar usuário já confirmado
  useEffect(() => {
    const token = searchParams.get('token');
    const type = searchParams.get('type');
    const confirmed = searchParams.get('confirmed');

    // Detectar redirect do Supabase via hash (magic link gerado pelo backend)
    // O SDK do Supabase processa o hash automaticamente e dispara onAuthStateChange
    // Não redirecionar para login nesse caso
    const hasSupabaseHash = window.location.hash.includes('access_token=');
    if (hasSupabaseHash) {
      console.log('AcceptInvite: Supabase magic link hash detected, waiting for auth state');
      return;
    }
    
    // NOVA LÓGICA: Verificar se usuário já foi confirmado via email
    if (confirmed === 'true') {
      console.log('AcceptInvite: User already confirmed via email link');
      checkUserAuthStatus();
    }
    
    if (type === 'invite' && token) {
      // Token de convite válido (link manual de fallback)
      console.log('AcceptInvite: Valid invite token found');
      
      const emailFromUrl = searchParams.get('email') || '';
      const tokenFromUrl = searchParams.get('token') || '';
      
      console.log('AcceptInvite: Email from URL:', emailFromUrl);
      console.log('AcceptInvite: Token from URL:', tokenFromUrl.substring(0, 20) + '...');
      
      let decodedEmail = emailFromUrl;
      try {
        if (tokenFromUrl) {
          atob(tokenFromUrl); // apenas validar se é base64
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
      // Sem hash do Supabase nem token válido — redirecionar para login
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
  const handleAcceptInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!formData.password) {
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

      const email = searchParams.get('email') || inviteInfo.email || '';
      
      console.log('AcceptInvite: Processing invite for email:', email);

      if (!email) {
        setError('Email não encontrado. Verifique se o link está correto.');
        return;
      }

      // CAMINHO 1: Usuário já autenticado via magic link (fluxo principal)
      // O SDK do Supabase cria a sessão automaticamente ao processar o hash
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      console.log('[DEBUG AcceptInvite] getSession — has session:', !!session, '| email:', session?.user?.email || 'none', '| error:', sessionError?.message || 'none');
      console.log('[DEBUG AcceptInvite] session user confirmed:', session?.user?.email_confirmed_at || 'null');

      if (session?.user) {
        console.log('[DEBUG AcceptInvite] CAMINHO 1: tentando updateUser (magic link)');
        
        const { error: updateError } = await supabase.auth.updateUser({
          password: formData.password
        });
        
        console.log('[DEBUG AcceptInvite] updateUser error:', updateError?.message || 'none', '| status:', (updateError as any)?.status || 'none');

        if (updateError) {
          console.error('AcceptInvite: Error updating password:', updateError.message);
          setError('Erro ao definir senha. Tente novamente.');
          return;
        }

        console.log('AcceptInvite: Password set successfully');
        
        // Salvar company_id do convite para AuthContext usar
        if (session.user.user_metadata?.company_id) {
          localStorage.setItem('invited_company_id', session.user.user_metadata.company_id);
          console.log('AcceptInvite: Saved invited company_id:', session.user.user_metadata.company_id);
        }
        
        setSuccess(true);
        setTimeout(() => navigate('/dashboard'), 2000);
        return;
      }

      // CAMINHO 2: Fallback — tentar login com senha (link manual antigo)
      console.log('[DEBUG AcceptInvite] CAMINHO 2: tentando signInWithPassword para:', email);
      const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password: formData.password
      });

      console.log('[DEBUG AcceptInvite] signInWithPassword error:', loginError?.message || 'none', '| status:', (loginError as any)?.status || 'none');
      console.log('[DEBUG AcceptInvite] signInWithPassword user:', loginData?.user?.email || 'null');
      
      if (!loginError && loginData.user) {
        console.log('AcceptInvite: Login successful');
        
        if (loginData.user.user_metadata?.company_id) {
          localStorage.setItem('invited_company_id', loginData.user.user_metadata.company_id);
        }
        
        setSuccess(true);
        setTimeout(() => navigate('/dashboard'), 2000);
        return;
      }
      
      // Nenhum caminho funcionou
      console.log('AcceptInvite: All paths failed');
      setError('Não foi possível ativar a conta. Solicite um novo link ao administrador.');

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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="bg-white px-8 pt-8 pb-4 text-center border-b border-slate-100">
          <img
            src="/images/emails/logo_fundo_branco-300x128.png"
            alt="Lovoo CRM"
            className="h-14 mx-auto mb-4 object-contain"
          />
          <h1 className="text-xl font-semibold text-slate-800 mb-1">Ativar Conta</h1>
          <p className="text-sm text-slate-500">
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
                  <p className="text-sm text-red-700 whitespace-pre-line">{error}</p>
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
