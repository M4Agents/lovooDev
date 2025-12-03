import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase, Company } from '../lib/supabase';
import { UserRole, CompanyUser, UserPermissions, LegacyUserInfo } from '../types/user';

type AuthContextType = {
  user: User | null;
  company: Company | null;
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
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
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

  const fetchCompany = async (userId: string, forceSuper: boolean = false) => {
    try {
      setIsLoadingCompany(true); // Iniciar loading
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
      
      // CORREÇÃO CRÍTICA: Verificar se é super admin no sistema antigo PRIMEIRO
      console.log('AuthContext: Checking for legacy super admin status, forceSuper:', forceSuper);
      const { data: legacySuperAdmin, error: legacyError } = await supabase
        .from('companies')
        .select('*')
        .eq('user_id', userId)
        .eq('is_super_admin', true)
        .single();
        
      console.log('AuthContext: Legacy super admin check:', { data: legacySuperAdmin, error: legacyError });
      
      // Se é super admin no sistema antigo OU forceSuper está ativo, carregar TODAS as empresas
      if ((!legacyError && legacySuperAdmin) || forceSuper) {
        console.log('AuthContext: User is LEGACY SUPER ADMIN - loading ALL companies');
        
        const { data: allCompanies, error: allCompaniesError } = await supabase
          .from('companies')
          .select('*')
          .order('name');
          
        console.log('AuthContext: All companies loaded for super admin:', { count: allCompanies?.length, error: allCompaniesError });
        
        if (!allCompaniesError && allCompanies && allCompanies.length > 0) {
          // Armazenar todas as empresas disponíveis
          setAvailableCompanies(allCompanies);
          
          // Selecionar a empresa super admin como principal (usar legacySuperAdmin se disponível, senão a primeira com is_super_admin)
          const superAdminCompany = legacySuperAdmin || allCompanies.find(c => c.is_super_admin) || allCompanies[0];
          setCompany(superAdminCompany);
          
          // Sincronizar currentCompanyId no localStorage para analytics
          localStorage.setItem('currentCompanyId', superAdminCompany.id);
          
          console.log('AuthContext: Super admin setup completed - Company:', superAdminCompany.name, 'Available companies:', allCompanies.length);
          return; // Sair da função - super admin configurado com sucesso
        }
      }
      
      // SISTEMA HÍBRIDO: Tentar buscar no sistema novo primeiro
      console.log('AuthContext: Trying NEW system first (company_users)');
      console.log('AuthContext: User ID:', userId);
      
      let { data, error } = await supabase
        .from('company_users')
        .select(`
          *,
          companies (*)
        `)
        .eq('user_id', userId)
        .eq('is_active', true);
        
      console.log('AuthContext: NEW system query result:', { data, error, dataLength: data?.length });
      
      if (!error && data && data.length > 0) {
        console.log('AuthContext: Found companies in NEW system:', data.length);
        console.log('AuthContext: Raw data from NEW system:', data);
        
        // Verificar se os dados das empresas estão corretos
        const companiesData = data.map((item: any) => {
          console.log('AuthContext: Processing item:', item);
          console.log('AuthContext: Item.companies:', item.companies);
          return item.companies;
        });
        
        console.log('AuthContext: Mapped companies data:', companiesData);
        
        // Filtrar dados válidos
        const validCompanies = companiesData.filter(comp => comp && comp.id);
        console.log('AuthContext: Valid companies after filter:', validCompanies);
        
        if (validCompanies.length > 0) {
          data = validCompanies;
        } else {
          console.warn('AuthContext: No valid companies found in NEW system data, falling back to OLD system');
          data = null;
          error = { message: 'No valid companies in NEW system', details: '', hint: '', code: '' } as any;
        }
      } else {
        console.log('AuthContext: Not found in NEW system or error occurred');
        console.log('AuthContext: Error details:', error);
        console.log('AuthContext: Trying alternative NEW system approach');
        
        // Tentativa alternativa: buscar company_users e depois companies separadamente
        try {
          const { data: companyUsers, error: cuError } = await supabase
            .from('company_users')
            .select('company_id')
            .eq('user_id', userId)
            .eq('is_active', true);
            
          console.log('AuthContext: Alternative query - company_users result:', { data: companyUsers, error: cuError });
          
          if (!cuError && companyUsers && companyUsers.length > 0) {
            const companyIds = companyUsers.map(cu => cu.company_id);
            console.log('AuthContext: Found company IDs:', companyIds);
            
            const { data: companies, error: companiesError } = await supabase
              .from('companies')
              .select('*')
              .in('id', companyIds);
              
            console.log('AuthContext: Alternative query - companies result:', { data: companies, error: companiesError });
            
            if (!companiesError && companies && companies.length > 0) {
              console.log('AuthContext: SUCCESS with alternative approach!');
              data = companies;
              error = null;
            } else {
              throw new Error('Companies query failed in alternative approach');
            }
          } else {
            throw new Error('Company users query failed in alternative approach');
          }
        } catch (altError) {
          console.log('AuthContext: Alternative approach failed, trying OLD system as final fallback');
          console.log('AuthContext: Alternative error:', altError);
          
          // Fallback final para sistema antigo
          const result = await supabase
            .from('companies')
            .select('*')
            .eq('user_id', userId);
            
          console.log('AuthContext: OLD system query result:', { data: result.data, error: result.error });
          data = result.data;
          error = result.error;
        }
      }

      console.log('AuthContext: Company fetch result:', { data, error });

      if (!error && data && data.length > 0) {
        // Armazenar todas as empresas disponíveis
        setAvailableCompanies(data as any);
        
        // Priorizar empresa super admin se existir
        const superAdminCompany = (data as any).find((comp: any) => comp.is_super_admin);
        const selectedCompany = superAdminCompany || data[0];
        
        console.log('AuthContext: Setting company:', (selectedCompany as any).name);
        console.log('AuthContext: Available companies:', (data as any).map((c: any) => ({ name: c.name, is_super_admin: c.is_super_admin })));
        setCompany(selectedCompany as any);
        
        // Sincronizar currentCompanyId no localStorage para analytics
        localStorage.setItem('currentCompanyId', (selectedCompany as any).id);
      } else {
        console.log('AuthContext: No company found or error:', error);
        setAvailableCompanies([]);
        setCompany(null);
      }
    } catch (error) {
      console.error('AuthContext: Error fetching company:', error);
      setCompany(null);
    } finally {
      setIsLoadingCompany(false); // Finalizar loading sempre
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
      
      // CORREÇÃO ADICIONAL: Se não está impersonando, verificar se é super admin
      console.log('AuthContext: Refresh - checking if user is super admin');
      const { data: legacySuperAdminCheck } = await supabase
        .from('companies')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_super_admin', true)
        .single();
        
      if (legacySuperAdminCheck) {
        console.log('AuthContext: Refresh - User is super admin, forcing super admin mode');
        await fetchCompany(user.id, true); // Forçar modo super admin
      } else {
        await fetchCompany(user.id, false); // Não forçar super admin no refresh normal
      }
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
