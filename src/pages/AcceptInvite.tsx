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
      
      // Tentar extrair informações do token se possível
      // Por enquanto, usar informações básicas
      setInviteInfo({
        email: searchParams.get('email') || '',
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

      // SOLUÇÃO SIMPLIFICADA: Usar apenas email para validação
      console.log('AcceptInvite: Validating invite for email:', email);

      if (!email) {
        setError('Email não encontrado no convite. Verifique se o link está correto.');
        return;
      }

      // Verificar se o usuário existe no sistema
      const { data: existingUsers, error: userError } = await supabase
        .from('auth.users')
        .select('id, email, invited_at, email_confirmed_at')
        .eq('email', email)
        .limit(1);

      if (userError) {
        console.error('AcceptInvite: Error checking user:', userError);
        setError('Erro ao verificar usuário. Tente novamente.');
        return;
      }

      if (!existingUsers || existingUsers.length === 0) {
        console.error('AcceptInvite: User not found by email:', email);
        setError('Usuário não encontrado. Verifique se o convite é válido.');
        return;
      }

      const user = existingUsers[0];
      console.log('AcceptInvite: Found user:', { id: user.id, email: user.email, invited_at: user.invited_at });

      // Verificar se o usuário foi convidado
      if (!user.invited_at) {
        console.error('AcceptInvite: User was not invited:', email);
        setError('Este usuário não possui um convite pendente.');
        return;
      }

      // Verificar se já foi confirmado
      if (user.email_confirmed_at) {
        console.log('AcceptInvite: User already confirmed, allowing password update');
      }

      // ABORDAGEM DIRETA: Usar Admin API para definir senha
      try {
        // Tentar fazer login com uma senha temporária para ativar a sessão
        const tempPassword = 'TempPass123!';
        
        // Primeiro, definir uma senha temporária via Admin API (se disponível)
        console.log('AcceptInvite: Attempting to set temporary password');
        
        // Como não temos Admin API disponível, vamos usar abordagem de reset
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password?from=invite`
        });

        if (resetError) {
          console.error('AcceptInvite: Password reset failed:', resetError);
          
          // FALLBACK: Tentar login direto (caso já tenha senha)
          const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
            email: email,
            password: formData.password
          });

          if (loginError) {
            // Se não conseguir fazer login, mostrar mensagem de reset
            setError('Um email de ativação será enviado. Verifique sua caixa de entrada e siga as instruções.');
            
            // Tentar enviar email de convite novamente
            try {
              await supabase.auth.resetPasswordForEmail(email);
            } catch (e) {
              console.log('AcceptInvite: Could not send reset email');
            }
            return;
          }

          console.log('AcceptInvite: Login successful, user already has password');
        } else {
          console.log('AcceptInvite: Password reset email sent');
          setError('Um email foi enviado para ativar sua conta. Verifique sua caixa de entrada.');
          return;
        }

        // Se chegou até aqui, tentar atualizar a senha
        const { error: updateError } = await supabase.auth.updateUser({
          password: formData.password
        });

        if (updateError) {
          console.error('AcceptInvite: Error updating password:', updateError);
          setError('Erro ao definir senha. Um email de ativação foi enviado para você.');
          
          // Enviar email de reset como fallback
          await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password?from=invite`
          });
          return;
        }

      } catch (err) {
        console.error('AcceptInvite: Unexpected error:', err);
        setError('Erro inesperado. Um email de ativação será enviado para você.');
        
        // Fallback final: enviar email de reset
        try {
          await supabase.auth.resetPasswordForEmail(email);
        } catch (e) {
          console.log('AcceptInvite: Final fallback failed');
        }
        return;
      }

      console.log('AcceptInvite: Invite accepted successfully');
      setSuccess(true);

      // Redirecionar para dashboard após 3 segundos
      setTimeout(() => {
        navigate('/dashboard');
      }, 3000);

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
