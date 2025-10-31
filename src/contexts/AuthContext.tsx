import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase, Company } from '../lib/supabase';

type AuthContextType = {
  user: User | null;
  company: Company | null;
  loading: boolean;
  isImpersonating: boolean;
  originalUser: User | null;
  availableCompanies: Company[];
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, companyName: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshCompany: () => Promise<void>;
  impersonateUser: (companyId: string) => Promise<void>;
  stopImpersonation: () => Promise<void>;
  switchCompany: (companyId: string) => void;
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
      
      // Só buscar empresa se não estiver impersonating
      if (session?.user && !localStorage.getItem('lovoo_crm_impersonating')) {
        fetchCompany(session.user.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => {
        setUser(session?.user ?? null);
        
        // Só buscar empresa se não estiver impersonating
        if (session?.user && !localStorage.getItem('lovoo_crm_impersonating')) {
          await fetchCompany(session.user.id);
        } else if (!session?.user) {
          setCompany(null);
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
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      company, 
      loading, 
      isImpersonating,
      originalUser,
      availableCompanies,
      signIn, 
      signUp, 
      signOut, 
      refreshCompany,
      impersonateUser,
      stopImpersonation,
      switchCompany
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
