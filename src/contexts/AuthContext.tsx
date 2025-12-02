import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase, Company } from '../lib/supabase';
import { UserRole, CompanyUser, UserPermissions, LegacyUserInfo } from '../types/user';

type AuthContextType = {
  user: User | null;
  company: Company | null;
  loading: boolean;
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
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
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

  const fetchCompany = async (userId: string, forceSuper: boolean = false) => {
    try {
      console.log('AuthContext: Fetching company for user:', userId, 'forceSuper:', forceSuper);
      
      // Verificar localStorage primeiro para impersonation
      const isCurrentlyImpersonating = localStorage.getItem('lovoo_crm_impersonating') === 'true';
      
      // Se está impersonating e não é para forçar super admin, buscar empresa impersonada diretamente
      if (isCurrentlyImpersonating && !forceSuper) {
        const impersonatedCompanyId = localStorage.getItem('lovoo_crm_impersonated_company_id');
        console.log('AuthContext: Looking for impersonated company:', impersonatedCompanyId);
        
        if (impersonatedCompanyId) {
          const { data: impersonatedCompany, error: impError } = await supabase
            .from('companies')
            .select('*')
            .eq('id', impersonatedCompanyId)
            .single();
            
          if (!impError && impersonatedCompany) {
            console.log('AuthContext: Found impersonated company:', impersonatedCompany.name);
            setCompany(impersonatedCompany);
            setIsImpersonating(true); // Garantir que o estado está correto
            
            // Sincronizar currentCompanyId no localStorage para analytics
            localStorage.setItem('currentCompanyId', impersonatedCompany.id);
            
            // Recuperar originalUser do localStorage se não estiver definido
            if (!originalUser) {
              const storedOriginalUser = localStorage.getItem('lovoo_crm_original_user');
              if (storedOriginalUser) {
                setOriginalUser(JSON.parse(storedOriginalUser));
              }
            }
            return;
          } else {
            console.log('AuthContext: Impersonated company not found, clearing impersonation');
            // Limpar impersonation se empresa não existe
            localStorage.removeItem('lovoo_crm_impersonating');
            localStorage.removeItem('lovoo_crm_impersonated_company_id');
            localStorage.removeItem('lovoo_crm_original_user');
            setIsImpersonating(false);
            setOriginalUser(null);
          }
        }
      }
      
      // Buscar todas as empresas do usuário para super admin
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('user_id', userId);

      console.log('AuthContext: Company fetch result:', { data, error });

      if (!error && data && data.length > 0) {
        // Armazenar todas as empresas disponíveis
        setAvailableCompanies(data);
        
        // Priorizar empresa super admin se existir
        const superAdminCompany = data.find(comp => comp.is_super_admin);
        const selectedCompany = superAdminCompany || data[0];
        
        console.log('AuthContext: Setting company:', selectedCompany);
        console.log('AuthContext: Available companies:', data.map(c => ({ name: c.name, is_super_admin: c.is_super_admin })));
        setCompany(selectedCompany);
        
        // Sincronizar currentCompanyId no localStorage para analytics
        localStorage.setItem('currentCompanyId', selectedCompany.id);
      } else {
        console.log('AuthContext: No company found or error:', error);
        setAvailableCompanies([]);
        setCompany(null);
      }
    } catch (error) {
      console.error('AuthContext: Error fetching company:', error);
      setCompany(null);
    }
  };

  const refreshCompany = async () => {
    if (user) {
      console.log('AuthContext: Manual refresh company requested');
      
      // Se estiver impersonating, forçar recarregamento da empresa impersonada
      const isCurrentlyImpersonating = localStorage.getItem('lovoo_crm_impersonating') === 'true';
      if (isCurrentlyImpersonating) {
        const impersonatedCompanyId = localStorage.getItem('lovoo_crm_impersonated_company_id');
        console.log('AuthContext: Refreshing impersonated company:', impersonatedCompanyId);
        
        if (impersonatedCompanyId) {
          const { data: impersonatedCompany, error } = await supabase
            .from('companies')
            .select('*')
            .eq('id', impersonatedCompanyId)
            .single();
            
          if (!error && impersonatedCompany) {
            console.log('AuthContext: Refreshed impersonated company:', impersonatedCompany.name);
            setCompany(impersonatedCompany);
            setIsImpersonating(true);
            
            // Sincronizar currentCompanyId no localStorage para analytics
            localStorage.setItem('currentCompanyId', impersonatedCompany.id);
            
            // Recuperar originalUser se necessário
            if (!originalUser) {
              const storedOriginalUser = localStorage.getItem('lovoo_crm_original_user');
              if (storedOriginalUser) {
                setOriginalUser(JSON.parse(storedOriginalUser));
              }
            }
            return;
          }
        }
      }
      
      await fetchCompany(user.id, false); // Não forçar super admin no refresh normal
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      
      // Buscar empresa sempre que tiver usuário
      if (session?.user) {
        fetchCompany(session.user.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => {
        setUser(session?.user ?? null);
        
        // Buscar empresa sempre que tiver usuário
        if (session?.user) {
          await fetchCompany(session.user.id);
          // Carregar roles do usuário após carregar empresa
          setTimeout(() => {
            refreshUserRoles();
          }, 100);
        } else {
          setCompany(null);
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
    // Bypass temporário para debug
    if (email === 'admin@debug.com' && password === 'debug123') {
      // Simular login bem-sucedido
      const mockUser = { id: 'abe5b85d-5193-404b-a27c-51754dcffce7', email: 'admin@debug.com' };
      setUser(mockUser as any);
      await fetchCompany('abe5b85d-5193-404b-a27c-51754dcffce7');
      return;
    }
    
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string, companyName: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;

    if (data.user) {
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

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setCompany(null);
    setIsImpersonating(false);
    setOriginalUser(null);
  };

  const impersonateUser = async (companyId: string) => {
    if (!user || !company?.is_super_admin) {
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
      
      // Sincronizar currentCompanyId no localStorage para analytics
      localStorage.setItem('currentCompanyId', targetCompany.id);
    }
  };

  // =====================================================
  // NOVAS FUNÇÕES PARA SISTEMA DE USUÁRIOS
  // =====================================================

  const refreshUserRoles = async () => {
    if (!user) return;

    try {
      console.log('AuthContext: Refreshing user roles for:', user.id);
      
      // Buscar roles do usuário na nova estrutura
      const { data: roles, error } = await supabase
        .from('company_users')
        .select(`
          *,
          companies:company_id (
            id,
            name,
            company_type
          )
        `)
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (error) {
        console.warn('AuthContext: Error fetching user roles:', error);
        setUserRoles([]);
        return;
      }

      console.log('AuthContext: User roles found:', roles);
      setUserRoles(roles || []);

      // Determinar role atual baseado na empresa ativa
      if (company && roles) {
        const currentCompanyRole = roles.find(r => r.company_id === company.id);
        if (currentCompanyRole) {
          setCurrentRole(currentCompanyRole.role);
          setUserPermissions(currentCompanyRole.permissions);
        }
      }

      // Criar informações de compatibilidade
      const hasLegacyRole = company?.is_super_admin || false;
      const legacyRole = company?.is_super_admin ? 'super_admin' : 
                        company?.company_type === 'parent' ? 'admin' : undefined;
      
      setLegacyInfo({
        hasLegacyRole,
        legacyRole,
        newRoles: roles || [],
        primaryRole: roles?.[0]?.role || null,
        canImpersonate: hasLegacyRole || (roles?.some(r => r.role === 'super_admin') || false)
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
    // Fallback para sistema atual (compatibilidade)
    if (company?.is_super_admin) {
      return true; // Super admin tem todas as permissões
    }

    // Usar novo sistema de permissões se disponível
    if (userPermissions) {
      return userPermissions[permission] === true;
    }

    // Fallback baseado no role atual
    if (currentRole) {
      switch (currentRole) {
        case 'super_admin':
          return true;
        case 'admin':
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
    return company?.company_type === 'parent' || false;
  };

  const canImpersonateCompany = async (companyId: string): Promise<boolean> => {
    if (!user) return false;

    try {
      // Verificar sistema atual (compatibilidade)
      if (company?.is_super_admin) {
        return true;
      }

      // Verificar novo sistema
      const { data, error } = await supabase
        .rpc('can_impersonate_company', {
          p_user_id: user.id,
          p_target_company_id: companyId
        });

      if (error) {
        console.warn('AuthContext: Error checking impersonation permission:', error);
        // Fallback para sistema atual
        return company?.is_super_admin || false;
      }

      return data || false;
    } catch (error) {
      console.error('AuthContext: Error in canImpersonateCompany:', error);
      return company?.is_super_admin || false;
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
      loading, 
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
      checkPasswordRequirements
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
