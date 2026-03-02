// =====================================================
// HOOK: useCompany
// =====================================================
// Hook para acessar dados da empresa do contexto de auth

import { useAuth } from '../contexts/AuthContext';

// =====================================================
// HOOK PRINCIPAL
// =====================================================
export const useCompany = () => {
  const { company } = useAuth();
  
  return {
    company,
  };
};
