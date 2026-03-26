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

  // 🔍 CONTADOR PARA RASTREAR CHAMADAS
  const [fetchCompanyCallCount, setFetchCompanyCallCount] = useState(0);
  
  // 🔧 FLAG PARA EVITAR MÚLTIPLAS CHAMADAS SIMULTÂNEAS
  const [isFetchingCompany, setIsFetchingCompany] = useState(false);

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

  // NOVA FUNÇÃO: Recuperação automática de usuários órfãos
  const attemptOrphanUserRecovery = async (userId: string) => {
    try {
      console.log('🔍 AuthContext: ORPHAN RECOVERY CALLED:', {
        userId,
        userIdType: typeof userId,
        userIdLength: userId?.length,
        callStack: new Error().stack?.split('\n').slice(1, 4).join(' -> '),
        timestamp: new Date().toISOString()
      });
      
      // Buscar informações do usuário no auth.users
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser || authUser.id !== userId) {
        console.log('AuthContext: Auth user mismatch, cannot recover');
        return null;
      }

      // Buscar se existe registro em company_users (sistema novo)
      const { data: companyUsers } = await supabase
        .from('company_users')
        .select('*, companies(*)')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (companyUsers && companyUsers.length > 0) {
        console.log('AuthContext: Found company_users records, creating compatibility record');
        const companyUser = companyUsers[0];
        const targetCompany = companyUser.companies;

        // Criar registro de compatibilidade no sistema antigo
        try {
          const { error: insertError } = await supabase
            .from('companies')
            .insert({
              id: crypto.randomUUID(),
              user_id: userId,
              name: `${authUser.email} - ${targetCompany.name}`,
              company_type: targetCompany.company_type,
              parent_company_id: targetCompany.company_type === 'client' ? targetCompany.id : null,
              is_super_admin: false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });

          if (!insertError) {
            console.log('AuthContext: Compatibility record created during recovery');
            return targetCompany;
          }
        } catch (insertError) {
          console.warn('AuthContext: Could not create compatibility record during recovery:', insertError);
        }

        // Mesmo se não conseguir criar compatibilidade, retornar empresa encontrada
        return targetCompany;
      }

      console.log('AuthContext: No recovery possible - user truly orphaned');
      return null;
    } catch (error) {
      console.error('AuthContext: Error during orphan user recovery:', error);
      return null;
    }
  };

  const fetchCompany = async (userId: string, forceSuper: boolean = false) => {
    // Capturar user_id no início para evitar timing issues
    const capturedUserId = userId;
    
    try {
      // 🔧 VERIFICAR SE EMPRESA JÁ FOI CARREGADA COM SUCESSO
      if (company && company.id && !forceSuper) {
        console.log('🔧 AuthContext: Company already loaded successfully, skipping call:', {
          companyId: company.id,
          companyName: company.name,
          forceSuper
        });
        return;
      }
      
      // 🔧 EVITAR MÚLTIPLAS CHAMADAS SIMULTÂNEAS
      if (isFetchingCompany && !forceSuper) {
        console.log('🔧 AuthContext: fetchCompany already in progress, skipping call');
        return;
      }
      
      setIsLoadingCompany(true); // Iniciar loading
      setIsFetchingCompany(true); // Marcar como em progresso
      setFetchCompanyCallCount(prev => prev + 1);
      
      // 🔍 GERAR ID ÚNICO PARA RASTREAR ESTA CHAMADA
      const callId = Math.random().toString(36).substr(2, 9);
      const callerInfo = new Error().stack?.split('\n')[2]?.trim() || 'unknown';
      
      console.log('🔍 AuthContext: fetchCompany called with:', {
        callId,
        callNumber: fetchCompanyCallCount + 1,
        userId,
        userIdType: typeof userId,
        userIdLength: userId?.length,
        forceSuper,
        isFetchingCompany,
        callerInfo,
        timestamp: new Date().toISOString()
      });
      
      // ✅ NOVO: Verificar se há company_id do convite (primeira vez após ativação)
      const invitedCompanyId = localStorage.getItem('invited_company_id');
      if (invitedCompanyId && !company) {
        console.log('🎯 AuthContext: Loading invited company:', invitedCompanyId);
        
        const { data: invitedCompany, error: invitedError } = await supabase
          .from('companies')
          .select('*')
          .eq('id', invitedCompanyId)
          .single();
          
        if (!invitedError && invitedCompany) {
          console.log('✅ AuthContext: Loaded invited company:', invitedCompany.name);
          setCompany(invitedCompany);
          setCompanyTimezone(invitedCompany.timezone || 'America/Sao_Paulo');
          localStorage.setItem('currentCompanyId', invitedCompany.id);
          localStorage.removeItem('invited_company_id'); // Limpar após usar
          return;
        } else {
          console.warn('⚠️ AuthContext: Invited company not found, continuing with normal flow');
          localStorage.removeItem('invited_company_id');
        }
      }
      
      // Verificar localStorage primeiro para impersonation
      const isCurrentlyImpersonating = localStorage.getItem('lovoo_crm_impersonating') === 'true';
      const impersonatedCompanyId = localStorage.getItem('lovoo_crm_impersonated_company_id');
      const originalUserData = localStorage.getItem('lovoo_crm_original_user');
      
      console.log('🔍 AuthContext: Impersonation check:', {
        isCurrentlyImpersonating,
        impersonatedCompanyId,
        originalUserData,
        forceSuper,
        willUseImpersonation: isCurrentlyImpersonating && !forceSuper
      });
      
      // Se está impersonating e não é para forçar super admin, buscar empresa impersonada diretamente
      if (isCurrentlyImpersonating && !forceSuper) {
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
            setCompanyTimezone(impersonatedCompany.timezone || 'America/Sao_Paulo');
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
      
      // CORREÇÃO CRÍTICA: Verificar se é super admin em AMBOS os sistemas
      console.log('AuthContext: Checking for super admin status, forceSuper:', forceSuper);
      
      // Verificar sistema antigo
      const { data: legacySuperAdmin, error: legacyError } = await supabase
        .from('companies')
        .select('*')
        .eq('user_id', userId)
        .eq('is_super_admin', true)
        .single();
        
      console.log('AuthContext: Legacy super admin check:', { data: legacySuperAdmin, error: legacyError });
      
      // Verificar sistema novo
      const { data: newSystemSuperAdmin, error: newSystemError } = await supabase
        .from('company_users')
        .select('*, companies(*)')
        .eq('user_id', userId)
        .eq('role', 'super_admin')
        .eq('is_active', true)
        .single();
        
      console.log('AuthContext: New system super admin check:', { data: newSystemSuperAdmin, error: newSystemError });
      
      // Se é super admin em QUALQUER sistema OU forceSuper está ativo, carregar TODAS as empresas
      if ((!legacyError && legacySuperAdmin) || (!newSystemError && newSystemSuperAdmin) || forceSuper) {
        console.log('AuthContext: User is LEGACY SUPER ADMIN - loading ALL companies');
        
        const { data: allCompanies, error: allCompaniesError } = await supabase
          .from('companies')
          .select('*')
          .order('name');
          
        console.log('AuthContext: All companies loaded for super admin:', { count: allCompanies?.length, error: allCompaniesError });
        
        if (!allCompaniesError && allCompanies && allCompanies.length > 0) {
          // Armazenar todas as empresas disponíveis
          setAvailableCompanies(allCompanies);
          
          // Selecionar a empresa super admin como principal
          const superAdminCompany = legacySuperAdmin || 
                                   (newSystemSuperAdmin?.companies) || 
                                   allCompanies.find(c => c.is_super_admin) || 
                                   allCompanies[0];
          setCompany(superAdminCompany);
          setCompanyTimezone(superAdminCompany.timezone || 'America/Sao_Paulo');
          
          // Sincronizar currentCompanyId no localStorage para analytics
          localStorage.setItem('currentCompanyId', superAdminCompany.id);
          
          console.log('AuthContext: Super admin setup completed - Company:', superAdminCompany.name, 'Available companies:', allCompanies.length);
          return; // Sair da função - super admin configurado com sucesso
        }
      }
      
      // SISTEMA HÍBRIDO: Tentar buscar no sistema novo primeiro
      console.log('AuthContext: Trying NEW system first (company_users)');
      console.log('🔍 AuthContext: About to query with userId:', {
        userId,
        userIdType: typeof userId,
        userIdLength: userId?.length,
        userIdString: String(userId),
        userIdJSON: JSON.stringify(userId)
      });
      
      // CORREÇÃO: Usar abordagem mais robusta - buscar company_users primeiro
      const { data: companyUsersData, error: companyUsersError } = await supabase
        .from('company_users')
        .select('company_id, role, is_active')
        .eq('user_id', userId)
        .eq('is_active', true);
        
      console.log('🔍 AuthContext: NEW system company_users query:', { 
        data: companyUsersData, 
        error: companyUsersError,
        userId: userId,
        queryDetails: {
          hasData: !!companyUsersData,
          dataLength: companyUsersData?.length,
          hasError: !!companyUsersError,
          errorMessage: companyUsersError?.message
        }
      });
      
      let { data, error }: { data: any[] | null, error: any } = { data: null, error: companyUsersError };
      
      if (!companyUsersError && companyUsersData && companyUsersData.length > 0) {
        console.log('AuthContext: Found user in company_users, fetching companies...');
        console.log('AuthContext: Company IDs from NEW system:', companyUsersData.map(cu => cu.company_id));
        
        // Buscar empresas correspondentes
        const companyIds = companyUsersData.map(cu => cu.company_id);
        const { data: companiesData, error: companiesError } = await supabase
          .from('companies')
          .select('*')
          .in('id', companyIds);
          
        console.log('🔍 AuthContext: Companies query for NEW system:', { 
          data: companiesData, 
          error: companiesError,
          companyIds: companyIds,
          queryDetails: {
            hasData: !!companiesData,
            dataLength: companiesData?.length,
            hasError: !!companiesError,
            errorMessage: companiesError?.message,
            companiesFound: companiesData?.map(c => ({ id: c.id, name: c.name, status: c.status }))
          }
        });
        
        if (!companiesError && companiesData && companiesData.length > 0) {
          console.log('🔧 AuthContext: SUCCESS - Found companies in NEW system, PROCESSING IMMEDIATELY');
          console.log('🔧 AuthContext: NEW system companies found:', companiesData.map(c => ({ id: c.id, name: c.name })));
          
          // 🔧 PROCESSAR IMEDIATAMENTE - NÃO ESPERAR CONDIÇÃO POSTERIOR
          setAvailableCompanies(companiesData as any);
          
          // Priorizar empresa super admin se existir
          const superAdminCompany = (companiesData as any).find((comp: any) => comp.is_super_admin);
          const selectedCompany = superAdminCompany || companiesData[0];
          
          console.log('🔧 AuthContext: IMMEDIATE SUCCESS (NEW system) - Setting company:', selectedCompany.name);
          console.log('🔧 AuthContext: Selected company details:', {
            id: selectedCompany.id,
            name: selectedCompany.name,
            is_super_admin: selectedCompany.is_super_admin,
            company_type: selectedCompany.company_type
          });
          
          setCompany(selectedCompany as any);
          setCompanyTimezone(selectedCompany.timezone || 'America/Sao_Paulo');
          localStorage.setItem('currentCompanyId', selectedCompany.id);
          
          // CRÍTICO: Verificar se é empresa do sistema antigo
          if (selectedCompany.id === '78ab1125-10ee-4881-9572-2b11813dacb2') {
            console.warn('🔧 AuthContext: WARNING - Using OLD system company ID, this will cause empty user list!');
          } else {
            console.log('🔧 AuthContext: SUCCESS - Using NEW system company ID');
          }
          
          return; // SAIR IMEDIATAMENTE - NÃO FAZER FALLBACK
          
          // CÓDIGO ANTIGO (REMOVIDO):
          // data = companiesData;
          // error = null;
          // console.log('AuthContext: SUCCESS - Found companies in NEW system:', companiesData.length);
          // console.log('AuthContext: NEW system company details:', companiesData.map(c => ({ id: c.id, name: c.name })));
          // console.log('AuthContext: FORCING use of NEW system data - will NOT fallback to old system');
        } else {
          // CORREÇÃO CRÍTICA: Só definir error se realmente houver erro
          if (companiesError) {
            error = companiesError;
            console.error('AuthContext: Failed to fetch companies for NEW system IDs:', companiesError);
          } else {
            // Dados vazios mas sem erro - manter error como null para não contaminar
            error = null;
            console.warn('AuthContext: NEW system returned empty data but no error - keeping error as null');
          }
        }
      }
      
      console.log('AuthContext: NEW system final result:', { data, error, dataLength: data?.length });
      console.log('AuthContext: Final condition check:', { 
        errorIsNull: error === null,
        errorIsFalsy: !error,
        dataExists: !!data,
        dataLength: data?.length,
        finalCondition: (!error && data && data.length > 0)
      });
      
      // 🔧 CORREÇÃO: REESTRUTURAR LÓGICA PARA EVITAR DUPLICAÇÃO
      if (!error && data && data.length > 0) {
        console.log('AuthContext: SUCCESS - Using companies from NEW system:', data.length);
        console.log('AuthContext: NEW system companies:', data.map(c => ({ id: c.id, name: c.name })));
        
        // 🔧 PROCESSAR DADOS DO SISTEMA NOVO DIRETAMENTE AQUI
        console.log('AuthContext: ENTERING final company selection logic');
        
        // Armazenar todas as empresas disponíveis
        setAvailableCompanies(data as any);
        
        // Priorizar empresa super admin se existir
        const superAdminCompany = (data as any).find((comp: any) => comp.is_super_admin);
        const selectedCompany = superAdminCompany || data[0];
        
        console.log('AuthContext: Company selection details:', {
          totalCompanies: data.length,
          superAdminFound: !!superAdminCompany,
          selectedCompanyId: (selectedCompany as any).id,
          selectedCompanyName: (selectedCompany as any).name
        });
        
        console.log('AuthContext: Setting company:', (selectedCompany as any).name);
        console.log('AuthContext: Selected company ID:', (selectedCompany as any).id);
        console.log('AuthContext: Available companies:', (data as any).map((c: any) => ({ id: c.id, name: c.name, is_super_admin: c.is_super_admin })));
        
        // CRÍTICO: Garantir que está usando empresa do sistema novo
        if ((selectedCompany as any).id === '78ab1125-10ee-4881-9572-2b11813dacb2') {
          console.warn('AuthContext: WARNING - Using OLD system company ID, this will cause empty user list!');
          console.warn('AuthContext: Company details:', selectedCompany);
        } else {
          console.log('AuthContext: SUCCESS - Using NEW system company ID');
        }
        
        setCompany(selectedCompany as any);
        
        // Sincronizar currentCompanyId no localStorage para analytics
        localStorage.setItem('currentCompanyId', (selectedCompany as any).id);
        
        // 🔧 RETORNAR AQUI PARA EVITAR EXECUÇÃO DO ELSE
        return;
        
      } else {
        console.log('AuthContext: Not found in NEW system, trying OLD system as fallback');
        console.log('AuthContext: NEW system error details:', error);
        console.log('AuthContext: NEW system data:', data);
        
        // IMPORTANTE: Só usar sistema antigo se realmente não encontrou no novo
        if (!data || data.length === 0) {
          console.log('AuthContext: Confirmed no data in NEW system, using OLD system fallback');
          
          // Fallback para sistema antigo
          const result = await supabase
            .from('companies')
            .select('*')
            .eq('user_id', userId);
            
          console.log('AuthContext: OLD system query result:', { data: result.data, error: result.error });
          
          // 🔧 PROTEÇÃO IMEDIATA: Se OLD system encontrou dados, forçar carregamento
          if (!result.error && result.data && result.data.length > 0) {
            console.log('🔧 AuthContext: OLD system found data - FORCING immediate load to avoid condition bug');
            console.log('🔧 AuthContext: OLD system companies found:', result.data.map(c => ({ id: c.id, name: c.name })));
            
            // FORÇAR carregamento imediato
            setAvailableCompanies(result.data as any);
            
            // Priorizar empresa super admin se existir
            const superAdminCompany = (result.data as any).find((comp: any) => comp.is_super_admin);
            const selectedCompany = superAdminCompany || result.data[0];
            
            console.log('🔧 AuthContext: IMMEDIATE FORCE LOAD SUCCESS (OLD system) - Setting company:', selectedCompany.name);
            console.log('🔧 AuthContext: Selected company details:', {
              id: selectedCompany.id,
              name: selectedCompany.name,
              is_super_admin: selectedCompany.is_super_admin
            });
            
            setCompany(selectedCompany as any);
            setCompanyTimezone(selectedCompany.timezone || 'America/Sao_Paulo');
            localStorage.setItem('currentCompanyId', selectedCompany.id);
            return; // SAIR IMEDIATAMENTE
          }
          
          data = result.data;
          error = result.error;
        } else {
          console.log('AuthContext: Actually found data in NEW system, keeping it');
        }
      }

      // 🔧 ESTA CONDIÇÃO AGORA SÓ EXECUTA PARA SISTEMA ANTIGO
      console.log('🔍 AuthContext: About to check final condition for OLD system:', {
        error: error,
        data: data,
        dataLength: data?.length,
        dataType: typeof data,
        isArray: Array.isArray(data),
        conditionResult: (!error && data && data.length > 0)
      });
      
      if (!error && data && data.length > 0) {
        console.log('AuthContext: ENTERING final company selection logic (OLD system SUCCESS)');
        
        // Armazenar todas as empresas disponíveis
        setAvailableCompanies(data as any);
        
        // Priorizar empresa super admin se existir
        const superAdminCompany = (data as any).find((comp: any) => comp.is_super_admin);
        const selectedCompany = superAdminCompany || data[0];
        
        console.log('AuthContext: Company selection details:', {
          totalCompanies: data.length,
          superAdminFound: !!superAdminCompany,
          selectedCompanyId: (selectedCompany as any).id,
          selectedCompanyName: (selectedCompany as any).name
        });
        
        console.log('AuthContext: Setting company:', (selectedCompany as any).name);
        console.log('AuthContext: Selected company ID:', (selectedCompany as any).id);
        console.log('AuthContext: Available companies:', (data as any).map((c: any) => ({ id: c.id, name: c.name, is_super_admin: c.is_super_admin })));
        
        // CRÍTICO: Garantir que está usando empresa do sistema novo
        if ((selectedCompany as any).id === '78ab1125-10ee-4881-9572-2b11813dacb2') {
          console.warn('AuthContext: WARNING - Using OLD system company ID, this will cause empty user list!');
          console.warn('AuthContext: Company details:', selectedCompany);
        } else {
          console.log('AuthContext: SUCCESS - Using NEW system company ID');
        }
        
        setCompany(selectedCompany as any);
        
        // Sincronizar currentCompanyId no localStorage para analytics
        localStorage.setItem('currentCompanyId', (selectedCompany as any).id);
      } else {
        console.log('AuthContext: FAILED final condition - No company found or error:', error);
        console.log('AuthContext: Final condition failed with values:', { 
          error, 
          data, 
          dataLength: data?.length,
          currentState: {
            user: !!user,
            company: !!company,
            loading,
            isLoadingCompany,
            isFetchingCompany
          }
        });
        
        // 🔧 VERIFICAR SE EMPRESA JÁ FOI CARREGADA EM OUTRA CHAMADA
        if (company && company.id) {
          console.log('🔧 AuthContext: Company already loaded in another call, skipping orphan recovery');
          console.log('🔧 AuthContext: Current company details:', {
            id: company.id,
            name: company.name,
            loadedAt: new Date().toISOString()
          });
          return;
        }
        
        // 🔧 PROTEÇÃO ADICIONAL: Verificar se dados foram encontrados mas condição falhou
        if (companyUsersData && companyUsersData.length > 0) {
          console.log('🔧 AuthContext: CRITICAL - Found company_users data (NEW system) but final condition failed!');
          console.log('🔧 AuthContext: This indicates a logic bug in the condition check');
          console.log('🔧 AuthContext: company_users data:', companyUsersData);
          console.log('🔧 AuthContext: Final data variable:', data);
          console.log('🔧 AuthContext: Final error variable:', error);
          
          // FORÇAR uso dos dados encontrados
          if (companyUsersData.length > 0) {
            console.log('🔧 AuthContext: FORCING company load with NEW system data');
            
            // Buscar empresa novamente com dados encontrados
            const companyId = companyUsersData[0].company_id;
            const { data: forceCompanyData, error: forceCompanyError } = await supabase
              .from('companies')
              .select('*')
              .eq('id', companyId)
              .single();
              
            if (!forceCompanyError && forceCompanyData) {
              console.log('🔧 AuthContext: FORCE LOAD SUCCESS (NEW system) - Setting company:', forceCompanyData.name);
              setCompany(forceCompanyData);
              setCompanyTimezone(forceCompanyData.timezone || 'America/Sao_Paulo');
              setAvailableCompanies([forceCompanyData]);
              localStorage.setItem('currentCompanyId', forceCompanyData.id);
              return;
            }
          }
        }
        
        // 🔧 PROTEÇÃO PARA SISTEMA ANTIGO: Verificar se dados do OLD system existem mas condição falhou
        if (data && Array.isArray(data) && data.length > 0) {
          console.log('🔧 AuthContext: CRITICAL - Found OLD system data but final condition failed!');
          console.log('🔧 AuthContext: This indicates the final condition logic has a bug');
          console.log('🔧 AuthContext: OLD system data found:', data.length, 'companies');
          console.log('🔧 AuthContext: OLD system companies:', data.map(c => ({ id: c.id, name: c.name })));
          console.log('🔧 AuthContext: Final error variable:', error);
          console.log('🔧 AuthContext: Final condition check: (!error && data && data.length > 0) =', (!error && data && data.length > 0));
          
          // FORÇAR uso dos dados do sistema antigo
          console.log('🔧 AuthContext: FORCING company load with OLD system data');
          
          // Usar lógica similar à do sistema novo
          setAvailableCompanies(data as any);
          
          // Priorizar empresa super admin se existir
          const superAdminCompany = (data as any).find((comp: any) => comp.is_super_admin);
          const selectedCompany = superAdminCompany || data[0];
          
          console.log('🔧 AuthContext: FORCE LOAD SUCCESS (OLD system) - Setting company:', selectedCompany.name);
          console.log('🔧 AuthContext: Selected company details:', {
            id: selectedCompany.id,
            name: selectedCompany.name,
            is_super_admin: selectedCompany.is_super_admin
          });
          
          setCompany(selectedCompany as any);
          setCompanyTimezone(selectedCompany.timezone || 'America/Sao_Paulo');
          localStorage.setItem('currentCompanyId', selectedCompany.id);
          return;
        }
        
        const recoveredCompany = await attemptOrphanUserRecovery(userId);
        
        if (recoveredCompany) {
          console.log('AuthContext: Orphan user recovered successfully:', recoveredCompany.name);
          setCompany(recoveredCompany);
          setCompanyTimezone(recoveredCompany.timezone || 'America/Sao_Paulo');
          setAvailableCompanies([recoveredCompany]);
        } else {
          console.log('AuthContext: Could not recover orphan user');
          setAvailableCompanies([]);
          setCompany(null);
        }
      }
    } catch (error) {
      console.error('AuthContext: Error fetching company:', error);
      setCompany(null);
    } finally {
      setIsLoadingCompany(false); // Finalizar loading sempre
      
      // Delay na limpeza da flag para evitar race conditions
      setTimeout(() => {
        setIsFetchingCompany(false);
        
        // Chamar refreshUserRoles com userId capturado
        if (capturedUserId) {
          try {
            refreshUserRoles(capturedUserId);
          } catch (error) {
            console.error('AuthContext: Erro ao chamar refreshUserRoles:', error);
          }
        }
      }, 500);
    }
  };

  const refreshCompany = async () => {
    // 🔧 VERIFICAÇÕES PREVENTIVAS PARA EVITAR EXECUÇÃO DESNECESSÁRIA
    if (!user) {
      console.log('🔧 AuthContext: Skipping refreshCompany - no user');
      return;
    }
    
    if (isFetchingCompany) {
      console.log('🔧 AuthContext: Skipping refreshCompany - fetchCompany already in progress');
      return;
    }
    
    console.log('AuthContext: Manual refresh company requested:', {
      userId: user.id,
      hasCompany: !!company,
      companyId: company?.id,
      companyName: company?.name
    });
    
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
          setCompanyTimezone(impersonatedCompany.timezone || 'America/Sao_Paulo');
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
    
    // CORREÇÃO ADICIONAL: Se não está impersonando, verificar se é super admin em AMBOS sistemas
    console.log('AuthContext: Refresh - checking if user is super admin');
    
    const { data: legacySuperAdminCheck } = await supabase
      .from('companies')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_super_admin', true)
      .single();
      
    const { data: newSystemSuperAdminCheck } = await supabase
      .from('company_users')
      .select('*')
      .eq('user_id', user.id)
      .eq('role', 'super_admin')
      .eq('is_active', true)
      .single();
      
    if (legacySuperAdminCheck || newSystemSuperAdminCheck) {
      console.log('AuthContext: Refresh - User is super admin, forcing super admin mode');
      await fetchCompany(user.id, true); // Forçar modo super admin
    } else {
      await fetchCompany(user.id, false); // Não forçar super admin no refresh normal
    }
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
    // Bypass temporário para debug
    if (email === 'admin@debug.com' && password === 'debug123') {
      // Simular login bem-sucedido
      const mockUser = { id: 'abe5b85d-5193-404b-a27c-51754dcffce7', email: 'admin@debug.com' };
      setUser(mockUser as any);
      await fetchCompany('abe5b85d-5193-404b-a27c-51754dcffce7');
      return;
    }
    
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

      // Criar informações de compatibilidade
      const hasLegacyRole = company?.is_super_admin || false;
      const legacyRole = company?.is_super_admin ? 'super_admin' : 
                        company?.company_type === 'parent' ? 'admin' : undefined;
      
      setLegacyInfo({
        hasLegacyRole,
        legacyRole,
        newRoles: roles || [],
        primaryRole: roles?.[0]?.role || null,
        canImpersonate: hasLegacyRole || (roles?.some(r => ['super_admin', 'support'].includes(r.role)) || false)
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
    // CORREÇÃO CRÍTICA: Verificar múltiplas condições de super admin e support
    const isSuperAdmin = company?.is_super_admin || 
                        (currentRole && ['super_admin', 'support'].includes(currentRole)) || 
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
