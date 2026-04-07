import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase, Company } from '../lib/supabase';
import { UserRole, CompanyUser, UserPermissions, LegacyUserInfo } from '../types/user';

type AuthContextType = {
  user: User | null;
  company: Company | null;
  companyTimezone: string;
  loading: boolean;
  isLoadingCompany: boolean;
  isImpersonating: boolean;
  originalUser: User | null;
  availableCompanies: Company[];
  // Novos campos para sistema de usuários
  userRoles: CompanyUser[];
  currentRole: UserRole | null;
  userPermissions: UserPermissions | null;
  legacyInfo: LegacyUserInfo | null;
  // Métodos existentes
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, companyName: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshCompany: () => Promise<void>;
  impersonateUser: (companyId: string) => Promise<void>;
  stopImpersonation: () => Promise<void>;
  switchCompany: (companyId: string) => void;
  // Novos métodos
  hasPermission: (permission: keyof UserPermissions) => boolean;
  canImpersonateCompany: (companyId: string) => Promise<boolean>;
  refreshUserRoles: () => Promise<void>;
  // Método para verificar alteração obrigatória de senha
  checkPasswordRequirements: () => { requiresPasswordChange: boolean; expiresAt?: string };
  // 🔧 NOVO: Método para reenvio de email de confirmação
  resendConfirmationEmail: (email: string) => Promise<{ success: boolean }>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [companyTimezone, setCompanyTimezone] = useState<string>('America/Sao_Paulo');
  const [loading, setLoading] = useState(true);
  const [isLoadingCompany, setIsLoadingCompany] = useState(false);
  const [isImpersonating, setIsImpersonating] = useState(() => {
    return localStorage.getItem('lovoo_crm_impersonating') === 'true';
  });
  const [originalUser, setOriginalUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('lovoo_crm_original_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [availableCompanies, setAvailableCompanies] = useState<Company[]>([]);
  
  // Novos estados para sistema de usuários
  const [userRoles, setUserRoles] = useState<CompanyUser[]>([]);
  const [currentRole, setCurrentRole] = useState<UserRole | null>(null);
  const [userPermissions, setUserPermissions] = useState<UserPermissions | null>(null);
  const [legacyInfo, setLegacyInfo] = useState<LegacyUserInfo | null>(null);

  // 🔧 FLAG PARA EVITAR MÚLTIPLAS CHAMADAS SIMULTÂNEAS
  const [isFetchingCompany, setIsFetchingCompany] = useState(false);

  // Sincronizar currentRole sempre que company ou userRoles mudam.
  // Corrige o problema de stale closure: refreshUserRoles pode ser chamado
  // quando company ainda é null (closure capturada antes do setCompany).
  useEffect(() => {
    if (!company || !userRoles.length) return;
    const companyRole = userRoles.find(r => r.company_id === company.id);
    if (companyRole) {
      setCurrentRole(companyRole.role as UserRole);
      setUserPermissions(companyRole.permissions);
    } else {
      setCurrentRole(null);
      setUserPermissions(null);
    }
  }, [company?.id, userRoles]);

  // 🔧 FUNÇÃO DE LIMPEZA DE DADOS DE IMPERSONAÇÃO INVÁLIDOS
  const cleanupInvalidImpersonationData = () => {
    try {
      const impersonating = localStorage.getItem('lovoo_crm_impersonating');
      const originalUserData = localStorage.getItem('lovoo_crm_original_user');
      
      console.log('🔧 AuthContext: Checking impersonation data validity:', {
        impersonating,
        hasOriginalUser: !!originalUserData,
        originalUserData
      });

      // Se está marcado como impersonando mas não tem dados válidos, limpar tudo
      if (impersonating === 'true' && originalUserData) {
        try {
          const originalUser = JSON.parse(originalUserData);
          
          // Verificar se o ID do usuário original é válido (formato UUID)
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (!originalUser.id || !uuidRegex.test(originalUser.id)) {
            console.warn('🔧 AuthContext: Invalid original user ID detected, cleaning up impersonation data');
            localStorage.removeItem('lovoo_crm_impersonating');
            localStorage.removeItem('lovoo_crm_original_user');
            localStorage.removeItem('lovoo_crm_impersonated_company_id');
            setIsImpersonating(false);
            setOriginalUser(null);
            return true; // Dados foram limpos
          }
        } catch (error) {
          console.warn('🔧 AuthContext: Corrupted original user data, cleaning up:', error);
          localStorage.removeItem('lovoo_crm_impersonating');
          localStorage.removeItem('lovoo_crm_original_user');
          localStorage.removeItem('lovoo_crm_impersonated_company_id');
          setIsImpersonating(false);
          setOriginalUser(null);
          return true; // Dados foram limpos
        }
      }
      
      return false; // Nenhuma limpeza necessária
    } catch (error) {
      console.error('🔧 AuthContext: Error during impersonation cleanup:', error);
      return false;
    }
  };

  const fetchCompany = async (userId: string, forceSuper: boolean = false) => {
    const capturedUserId = userId;

    if (company && company.id && !forceSuper) {
      return;
    }

    if (isFetchingCompany && !forceSuper) {
      return;
    }

    setIsLoadingCompany(true);
    setIsFetchingCompany(true);

    try {
      // 1. Convite pendente — empresa definida pelo fluxo de convite
      const invitedCompanyId = localStorage.getItem('invited_company_id');
      if (invitedCompanyId && !company) {
        const { data: invitedCompany, error: invitedError } = await supabase
          .from('companies')
          .select('*')
          .eq('id', invitedCompanyId)
          .single();

        if (!invitedError && invitedCompany) {
          setCompany(invitedCompany);
          setCompanyTimezone(invitedCompany.timezone || 'America/Sao_Paulo');
          localStorage.setItem('currentCompanyId', invitedCompany.id);
          localStorage.removeItem('invited_company_id');
          return;
        }
        localStorage.removeItem('invited_company_id');
      }

      // 2. Impersonação ativa — carregar empresa impersonada
      const isCurrentlyImpersonating = localStorage.getItem('lovoo_crm_impersonating') === 'true';
      const impersonatedCompanyId = localStorage.getItem('lovoo_crm_impersonated_company_id');

      if (isCurrentlyImpersonating && !forceSuper && impersonatedCompanyId) {
        const { data: impersonatedCompany, error: impError } = await supabase
          .from('companies')
          .select('*')
          .eq('id', impersonatedCompanyId)
          .single();

        if (!impError && impersonatedCompany) {
          setCompany(impersonatedCompany);
          setCompanyTimezone(impersonatedCompany.timezone || 'America/Sao_Paulo');
          setIsImpersonating(true);
          localStorage.setItem('currentCompanyId', impersonatedCompany.id);
          if (!originalUser) {
            const storedOriginalUser = localStorage.getItem('lovoo_crm_original_user');
            if (storedOriginalUser) setOriginalUser(JSON.parse(storedOriginalUser));
          }
          return;
        }
        // Impersonação inválida: limpar
        localStorage.removeItem('lovoo_crm_impersonating');
        localStorage.removeItem('lovoo_crm_impersonated_company_id');
        localStorage.removeItem('lovoo_crm_original_user');
        setIsImpersonating(false);
        setOriginalUser(null);
      }

      // 3. Fonte única de verdade: company_users JOIN companies
      const { data: companyUserRows, error: cuError } = await supabase
        .from('company_users')
        .select('role, companies(*)')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (cuError || !companyUserRows || companyUserRows.length === 0) {
        console.warn('AuthContext: No active company_users found for user:', userId);
        setAvailableCompanies([]);
        setCompany(null);
        return;
      }

      // Verificar super admin: role explícito em empresa do tipo parent
      const isSuperAdmin = companyUserRows.some(
        r => r.role === 'super_admin' && (r.companies as any)?.company_type === 'parent'
      );

      if (isSuperAdmin || forceSuper) {
        // Super admin: carrega todas as empresas e seleciona a empresa pai
        const { data: allCompanies, error: allError } = await supabase
          .from('companies')
          .select('*')
          .order('name');

        if (!allError && allCompanies && allCompanies.length > 0) {
          setAvailableCompanies(allCompanies);
          const parentCompany = allCompanies.find(c => c.company_type === 'parent') || allCompanies[0];
          setCompany(parentCompany);
          setCompanyTimezone(parentCompany.timezone || 'America/Sao_Paulo');
          localStorage.setItem('currentCompanyId', parentCompany.id);
        }
        return;
      }

      // Usuário comum: empresas limitadas aos registros de company_users
      const companies = companyUserRows
        .map(r => r.companies as unknown as Company)
        .filter(Boolean);

      setAvailableCompanies(companies);

      // Tentar restaurar empresa da sessão anterior
      const savedCompanyId = localStorage.getItem('currentCompanyId');
      const savedCompany = savedCompanyId ? companies.find(c => c.id === savedCompanyId) : null;
      const selectedCompany = savedCompany || companies[0];

      setCompany(selectedCompany);
      setCompanyTimezone(selectedCompany.timezone || 'America/Sao_Paulo');
      localStorage.setItem('currentCompanyId', selectedCompany.id);

    } catch (error) {
      console.error('AuthContext: Error fetching company:', error);
      setCompany(null);
    } finally {
      setIsLoadingCompany(false);
      setTimeout(() => {
        setIsFetchingCompany(false);
        if (capturedUserId) {
          refreshUserRoles(capturedUserId);
        }
      }, 500);
    }
  };

  const refreshCompany = async () => {
    if (!user) return;
    if (isFetchingCompany) return;

    // Forçar recarregamento completo, limpando o guard de "já carregado"
    setCompany(null);
    await fetchCompany(user.id, false);
  };

  useEffect(() => {
    // 🔍 VERIFICAR DADOS SALVOS ANTES DE CARREGAR SESSÃO
    console.log('🔍 AuthContext: Checking stored data before session load:', {
      localStorage_user: localStorage.getItem('lovoo_crm_user'),
      localStorage_company: localStorage.getItem('lovoo_crm_company'),
      localStorage_impersonating: localStorage.getItem('lovoo_crm_impersonating'),
      localStorage_original_user: localStorage.getItem('lovoo_crm_original_user'),
      localStorage_company_id: localStorage.getItem('currentCompanyId'),
      sessionStorage_keys: Object.keys(sessionStorage)
    });

    // 🔧 LIMPAR DADOS DE IMPERSONAÇÃO INVÁLIDOS ANTES DE CARREGAR SESSÃO
    const wasCleanedUp = cleanupInvalidImpersonationData();
    if (wasCleanedUp) {
      console.log('🔧 AuthContext: Invalid impersonation data was cleaned up');
    }
    
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('🔍 AuthContext: Initial session loaded:', {
        hasSession: !!session,
        hasUser: !!session?.user,
        userId: session?.user?.id,
        userEmail: session?.user?.email,
        userIdType: typeof session?.user?.id,
        userIdLength: session?.user?.id?.length
      });
      
      setUser(session?.user ?? null);
      
      // 🔧 CORREÇÃO: Remover chamada duplicada - onAuthStateChange já fará isso
      // A chamada fetchCompany será feita pelo onAuthStateChange para evitar duplicação
      console.log('🔧 AuthContext: Initial session loaded, onAuthStateChange will handle fetchCompany');
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => {
        console.log('🔍 AuthContext: Auth state changed:', {
          event: _event,
          hasSession: !!session,
          hasUser: !!session?.user,
          userId: session?.user?.id,
          userEmail: session?.user?.email,
          userIdType: typeof session?.user?.id,
          userIdLength: session?.user?.id?.length
        });
        
        setUser(session?.user ?? null);
        
        // 🔧 VERIFICAR SE EMPRESA JÁ FOI CARREGADA ANTES DE CHAMAR fetchCompany
        if (session?.user) {
          if (company && company.id) {
            console.log('🔧 AuthContext: Company already loaded, skipping onAuthStateChange fetchCompany call:', {
              companyId: company.id,
              companyName: company.name,
              userId: session.user.id,
              event: _event
            });
            // Roles serão carregados automaticamente após fetchCompany
            console.log('🔧 AuthContext: Company already loaded, roles will be refreshed automatically');
          } else {
            console.log('🔍 AuthContext: Auth change - Calling fetchCompany with userId:', session.user.id);
            await fetchCompany(session.user.id);
            // Roles serão carregados automaticamente após fetchCompany
            console.log('🔧 AuthContext: fetchCompany called, roles will be refreshed automatically');
          }
        } else {
          // 🔧 PROTEÇÃO: NÃO SOBRESCREVER EMPRESA JÁ CARREGADA
          if (!company || !company.id) {
            console.log('🔧 AuthContext: No session user, clearing company state');
            setCompany(null);
          } else {
            console.log('🔧 AuthContext: No session user, but company already loaded - preserving company:', {
              companyId: company.id,
              companyName: company.name,
              event: _event
            });
          }
          setUserRoles([]);
          setCurrentRole(null);
          setUserPermissions(null);
          setLegacyInfo(null);
        }  
      })();
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      
      // 🔧 SISTEMA DE CONFIRMAÇÃO AUTOMÁTICA PARA USUÁRIOS RECRIADOS
      if (error?.message?.includes('Email not confirmed')) {
        console.log('🔧 AuthContext: Email not confirmed, attempting auto-confirmation for recreated user');
        
        // Verificar se é um usuário conhecido que foi recriado por admin
        const knownUsers = [
          'crmlovoo@gmail.com',
          // Adicionar outros emails de usuários que podem ser recriados por admin
        ];
        
        if (knownUsers.includes(email.toLowerCase())) {
          console.log('🔧 AuthContext: Known user detected, attempting auto-confirmation');
          
          try {
            // Tentar fazer signup para obter dados do usuário
            const { data: signupData, error: signupError } = await supabase.auth.signUp({
              email,
              password,
              options: {
                emailRedirectTo: `${window.location.origin}/dashboard`
              }
            });
            
            if (signupData?.user && !signupError) {
              console.log('🔧 AuthContext: User data obtained, confirming email automatically');
              
              // Marcar como confirmado usando update user metadata
              const { error: updateError } = await supabase.auth.updateUser({
                data: { email_confirmed: true }
              });
              
              if (!updateError) {
                console.log('✅ AuthContext: Email auto-confirmed successfully, retrying login');
                
                // Tentar login novamente após confirmação
                const { error: retryError } = await supabase.auth.signInWithPassword({ email, password });
                if (!retryError) {
                  console.log('✅ AuthContext: Login successful after auto-confirmation');
                  return;
                }
              }
            }
          } catch (autoConfirmError) {
            console.warn('⚠️ AuthContext: Auto-confirmation failed:', autoConfirmError);
          }
        }
        
        // Se auto-confirmação falhou, lançar erro original com instruções
        throw new Error(`Email não confirmado. Por favor, verifique sua caixa de entrada e clique no link de confirmação. Se você não recebeu o email, entre em contato com o administrador.`);
      }
      
      if (error) throw error;
    } catch (err) {
      throw err;
    }
  };

  const signUp = async (email: string, password: string, companyName: string) => {
    const { data, error } = await supabase.auth.signUp({ 
      email, 
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`
      }
    });
    if (error) throw error;

    if (data.user) {
      // 🔧 SISTEMA DE CONFIRMAÇÃO AUTOMÁTICA PARA NOVOS USUÁRIOS
      console.log('🔧 AuthContext: New user created, checking if auto-confirmation is needed');
      
      // Verificar se é um usuário que deve ser auto-confirmado (criado por admin)
      const shouldAutoConfirm = [
        'crmlovoo@gmail.com',
        // Adicionar outros emails que devem ser auto-confirmados
      ].includes(email.toLowerCase());
      
      if (shouldAutoConfirm) {
        console.log('🔧 AuthContext: Auto-confirming user created by admin');
        
        try {
          // Marcar como confirmado usando update user metadata
          const { error: updateError } = await supabase.auth.updateUser({
            data: { email_confirmed: true }
          });
          
          if (!updateError) {
            console.log('✅ AuthContext: User auto-confirmed successfully during signup');
          } else {
            console.warn('⚠️ AuthContext: Failed to auto-confirm user:', updateError);
          }
        } catch (confirmError) {
          console.warn('⚠️ AuthContext: Auto-confirmation error during signup:', confirmError);
        }
      }
      // Verificar se é o primeiro registro da M4 Digital
      if (companyName === 'M4 Digital') {
        // Atualizar a empresa M4 Digital existente com o user_id
        const { error: updateError } = await supabase
          .from('companies')
          .update({ user_id: data.user.id })
          .eq('name', 'M4 Digital')
          .eq('company_type', 'parent');
        
        if (updateError) throw updateError;
      } else {
        // Verificar se existe uma empresa cliente com este nome e sem user_id
        const { data: existingCompany } = await supabase
          .from('companies')
          .select('*')
          .eq('name', companyName)
          .eq('company_type', 'client')
          .is('user_id', null)
          .maybeSingle();

        if (existingCompany) {
          // Associar usuário à empresa existente
          const { error: updateError } = await supabase
            .from('companies')
            .update({ user_id: data.user.id })
            .eq('id', existingCompany.id);
          
          if (updateError) throw updateError;
        } else {
          // Criar nova empresa cliente
          const { error: companyError } = await supabase.from('companies').insert({
            user_id: data.user.id,
            name: companyName,
            company_type: 'client',
            is_super_admin: false,
            plan: 'basic',
            status: 'active'
          });

          if (companyError) throw companyError;
        }
      }
      
      await fetchCompany(data.user.id);
    }
  };

  // 🔧 FUNÇÃO AUXILIAR PARA REENVIO DE EMAIL DE CONFIRMAÇÃO
  const resendConfirmationEmail = async (email: string) => {
    try {
      console.log('🔧 AuthContext: Resending confirmation email for:', email);
      
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`
        }
      });
      
      if (error) {
        console.error('❌ AuthContext: Failed to resend confirmation email:', error);
        throw error;
      }
      
      console.log('✅ AuthContext: Confirmation email resent successfully');
      return { success: true };
    } catch (error) {
      console.error('❌ AuthContext: Error resending confirmation email:', error);
      throw error;
    }
  };

  const signOut = async () => {
    console.log('🔧 AuthContext: Starting signOut process');
    
    // Limpar todos os dados de impersonação
    localStorage.removeItem('lovoo_crm_impersonating');
    localStorage.removeItem('lovoo_crm_original_user');
    localStorage.removeItem('lovoo_crm_impersonated_company_id');
    localStorage.removeItem('currentCompanyId');
    
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    
    // Limpar estados
    setCompany(null);
    setIsImpersonating(false);
    setOriginalUser(null);
    setAvailableCompanies([]);
    setUserRoles([]);
    setCurrentRole(null);
    setUserPermissions(null);
    setLegacyInfo(null);
    
    console.log('🔧 AuthContext: SignOut completed, all data cleared');
  };

  const impersonateUser = async (companyId: string) => {
    if (!user || currentRole !== 'super_admin') {
      throw new Error('Only super admins can impersonate users');
    }

    try {
      console.log('AuthContext: Starting impersonation for company:', companyId);
      
      // Store original user and company
      setOriginalUser(user);
      
      // Fetch the company to impersonate
      const { data: targetCompany, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .single();

      if (error) {
        console.error('Error fetching target company:', error);
        throw error;
      }

      if (targetCompany) {
        console.log('AuthContext: Impersonating company:', targetCompany.name);
        
        // Persistir estado no localStorage
        localStorage.setItem('lovoo_crm_impersonating', 'true');
        localStorage.setItem('lovoo_crm_impersonated_company_id', targetCompany.id);
        localStorage.setItem('lovoo_crm_original_user', JSON.stringify(user));
        
        // Definir estados imediatamente
        setIsImpersonating(true);
        setCompany(targetCompany);
        setCompanyTimezone(targetCompany.timezone || 'America/Sao_Paulo');
        
        // Sincronizar currentCompanyId no localStorage para analytics
        localStorage.setItem('currentCompanyId', targetCompany.id);
        
        console.log('AuthContext: Impersonation complete, company set to:', targetCompany.name);
      } else {
        throw new Error('Target company not found');
      }
    } catch (error) {
      console.error('Error impersonating user:', error);
      // Reset states on error
      setIsImpersonating(false);
      setOriginalUser(null);
      throw error;
    }
  };

  const stopImpersonation = async () => {
    if (!isImpersonating || !originalUser) return;

    try {
      console.log('AuthContext: Stopping impersonation');
      
      // Limpar localStorage
      localStorage.removeItem('lovoo_crm_impersonating');
      localStorage.removeItem('lovoo_crm_impersonated_company_id');
      localStorage.removeItem('lovoo_crm_original_user');
      
      setIsImpersonating(false);
      await fetchCompany(originalUser.id, true); // Forçar voltar para super admin
      setOriginalUser(null);
    } catch (error) {
      console.error('Error stopping impersonation:', error);
      throw error;
    }
  };

  const switchCompany = (companyId: string) => {
    const targetCompany = availableCompanies.find(comp => comp.id === companyId);
    if (targetCompany) {
      console.log('AuthContext: Switching to company:', targetCompany);
      setCompany(targetCompany);
      setCompanyTimezone(targetCompany.timezone || 'America/Sao_Paulo');
      
      // Sincronizar currentCompanyId no localStorage para analytics
      localStorage.setItem('currentCompanyId', targetCompany.id);
    }
  };

  // =====================================================
  // NOVAS FUNÇÕES PARA SISTEMA DE USUÁRIOS
  // =====================================================

  const refreshUserRoles = async (targetUserId?: string) => {
    // Usar targetUserId se fornecido, senão usar user do estado
    const effectiveUserId = targetUserId || user?.id;
    
    if (!effectiveUserId) {
      return;
    }

    try {
      
      // 🔧 CORREÇÃO: Usar RPC único com SECURITY DEFINER para compatibilidade com RLS
      let roles: any[] = [];
      let error = null;
      
      try {
        // Usar RPC específico que bypassa RLS automaticamente
        const { data: userRoles, error: rpcError } = await supabase
          .rpc('get_user_roles_for_auth', {
            p_user_id: effectiveUserId
          });
        
        if (rpcError) {
          console.warn('AuthContext: RPC get_user_roles_for_auth failed:', rpcError);
          error = rpcError;
          roles = [];
        } else {
          // Transformar dados do RPC para formato esperado pelo AuthContext
          roles = (userRoles || []).map((role: any) => ({
            ...role,
            companies: {
              id: role.company_id,
              name: role.company_name,
              company_type: role.company_type
            }
          }));
        }
      } catch (rpcError) {
        console.error('AuthContext: Error calling get_user_roles_for_auth:', rpcError);
        error = rpcError;
        roles = [];
      }

      if (error) {
        console.warn('AuthContext: Error fetching user roles:', error);
        setUserRoles([]);
        return;
      }

      setUserRoles(roles || []);

      // Determinar role atual baseado na empresa ativa
      if (company && roles) {
        const currentCompanyRole = roles.find(r => r.company_id === company.id);
        if (currentCompanyRole) {
          setCurrentRole(currentCompanyRole.role);
          setUserPermissions(currentCompanyRole.permissions);
        } else {
          setCurrentRole(null);
          setUserPermissions(null);
        }
      }

      const isSuperAdminRole = roles?.some(r => r.role === 'super_admin') || false;
      setLegacyInfo({
        hasLegacyRole: isSuperAdminRole,
        legacyRole: isSuperAdminRole ? 'super_admin' : undefined,
        newRoles: roles || [],
        primaryRole: roles?.[0]?.role || null,
        canImpersonate: isSuperAdminRole
      });

    } catch (error) {
      console.error('AuthContext: Error in refreshUserRoles:', error);
      setUserRoles([]);
      setCurrentRole(null);
      setUserPermissions(null);
      setLegacyInfo(null);
    }
  };

  const hasPermission = (permission: keyof UserPermissions): boolean => {
    const isSuperAdmin = currentRole === 'super_admin' || 
                        (isImpersonating && originalUser);
    
    if (isSuperAdmin) {
      return true; // Super admin tem todas as permissões (mesmo impersonando)
    }

    // Usar novo sistema de permissões se disponível
    if (userPermissions) {
      return userPermissions[permission] === true;
    }

    // Fallback baseado no role atual
    if (currentRole) {
      switch (currentRole) {
        case 'admin':
          // Admin pode gerenciar usuários, exceto financial e companies
          return permission !== 'financial' && permission !== 'companies';
        case 'partner':
          return ['dashboard', 'leads', 'chat', 'analytics'].includes(permission);
        case 'manager':
          return ['dashboard', 'leads', 'chat', 'analytics'].includes(permission) && permission !== 'edit_all_leads';
        case 'seller':
          return ['dashboard', 'leads', 'chat'].includes(permission);
        default:
          return false;
      }
    }

    // Fallback final para sistema legado
    // 🔧 CORREÇÃO: Permitir gestão de usuários para admins de empresas filhas
    const isParentCompany = company?.company_type === 'parent';
    const isClientAdminWithUserPermissions = company?.company_type === 'client' && 
                                           ['users', 'create_users', 'edit_users', 'delete_users'].includes(permission);
    
    return isParentCompany || isClientAdminWithUserPermissions;
  };

  const canImpersonateCompany = async (companyId: string): Promise<boolean> => {
    if (!user) return false;

    try {
      const { data, error } = await supabase
        .rpc('can_impersonate_company', {
          p_user_id: user.id,
          p_target_company_id: companyId
        });

      if (error) {
        console.warn('AuthContext: Error checking impersonation permission:', error);
        return false;
      }

      return data || false;
    } catch (error) {
      console.error('AuthContext: Error in canImpersonateCompany:', error);
      return false;
    }
  };

  // Verificar se usuário precisa alterar senha
  const checkPasswordRequirements = () => {
    if (!user?.app_metadata) {
      return { requiresPasswordChange: false };
    }

    const { must_change_password, password_expires_at } = user.app_metadata;

    // Se não tem flag de alteração obrigatória, não precisa alterar
    if (!must_change_password) {
      return { requiresPasswordChange: false };
    }

    // Se tem expiração, verificar se ainda é válida
    if (password_expires_at) {
      const now = new Date();
      const expires = new Date(password_expires_at);
      
      // Se expirou, precisa alterar
      if (now > expires) {
        return { requiresPasswordChange: true, expiresAt: password_expires_at };
      }
    }

    // Precisa alterar senha
    return { requiresPasswordChange: true, expiresAt: password_expires_at };
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      company,
      companyTimezone,
      loading, 
      isLoadingCompany,
      isImpersonating,
      originalUser,
      availableCompanies,
      // Novos campos
      userRoles,
      currentRole,
      userPermissions,
      legacyInfo,
      // Métodos existentes
      signIn, 
      signUp, 
      signOut, 
      refreshCompany,
      impersonateUser,
      stopImpersonation,
      switchCompany,
      // Novos métodos
      hasPermission,
      canImpersonateCompany,
      refreshUserRoles,
      checkPasswordRequirements,
      // 🔧 NOVO: Função de reenvio de confirmação
      resendConfirmationEmail
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
