// Script para verificar problema de login do usuário
// User ID: aba8bb6e-6381-4d6e-a27c-5764cbfce7

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://etzdsywunlpbgxkphuil.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E'
);

async function debugUserLogin() {
  const userId = 'aba8bb6e-6381-4d6e-a27c-5764cbfce7';
  
  console.log('🔍 INVESTIGANDO PROBLEMA DE LOGIN');
  console.log('User ID:', userId);
  console.log('Timestamp:', new Date().toISOString());
  
  try {
    // 1. Verificar se usuário existe na tabela companies (sistema antigo)
    console.log('\n1️⃣ VERIFICANDO SISTEMA ANTIGO (companies)...');
    const { data: companiesData, error: companiesError } = await supabase
      .from('companies')
      .select('id, user_id, name, company_type, is_super_admin')
      .eq('user_id', userId);
    
    console.log('Companies result:', { data: companiesData, error: companiesError });
    
    // 2. Verificar se usuário existe na tabela company_users (sistema novo)
    console.log('\n2️⃣ VERIFICANDO SISTEMA NOVO (company_users)...');
    const { data: companyUsersData, error: companyUsersError } = await supabase
      .from('company_users')
      .select('id, user_id, company_id, role, is_active, companies(id, name, company_type)')
      .eq('user_id', userId);
    
    console.log('Company_users result:', { data: companyUsersData, error: companyUsersError });
    
    // 3. Verificar se usuário existe no auth.users
    console.log('\n3️⃣ VERIFICANDO AUTH.USERS...');
    const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers();
    const authUser = users?.find(u => u.id === userId);
    
    console.log('Auth user found:', !!authUser);
    if (authUser) {
      console.log('Auth user details:', {
        id: authUser.id,
        email: authUser.email,
        created_at: authUser.created_at,
        email_confirmed_at: authUser.email_confirmed_at
      });
    }
    
    // 4. Análise do problema
    console.log('\n📊 ANÁLISE DO PROBLEMA:');
    
    if (!authUser) {
      console.log('❌ PROBLEMA: Usuário não existe no auth.users');
      return;
    }
    
    if (!companiesData || companiesData.length === 0) {
      console.log('⚠️ PROBLEMA: Usuário não tem registro na tabela companies (sistema antigo)');
    } else {
      console.log('✅ OK: Usuário encontrado no sistema antigo');
    }
    
    if (!companyUsersData || companyUsersData.length === 0) {
      console.log('⚠️ PROBLEMA: Usuário não tem registro na tabela company_users (sistema novo)');
    } else {
      console.log('✅ OK: Usuário encontrado no sistema novo');
    }
    
    // 5. Propor solução
    console.log('\n🔧 SOLUÇÃO PROPOSTA:');
    
    if ((!companiesData || companiesData.length === 0) && (!companyUsersData || companyUsersData.length === 0)) {
      console.log('🚨 USUÁRIO ÓRFÃO: Não existe em nenhum sistema');
      console.log('💡 AÇÃO: Criar registro de empresa para o usuário');
      
      // Criar empresa padrão para o usuário
      const newCompany = {
        id: crypto.randomUUID(),
        user_id: userId,
        name: `${authUser.email} - Empresa`,
        company_type: 'client',
        is_super_admin: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      console.log('Criando empresa:', newCompany);
      
      const { data: insertData, error: insertError } = await supabase
        .from('companies')
        .insert(newCompany)
        .select();
      
      if (insertError) {
        console.error('❌ ERRO ao criar empresa:', insertError);
      } else {
        console.log('✅ EMPRESA CRIADA:', insertData);
        
        // Também criar no sistema novo para compatibilidade
        const newCompanyUser = {
          id: crypto.randomUUID(),
          user_id: userId,
          company_id: newCompany.id,
          role: 'admin',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        
        const { error: companyUserError } = await supabase
          .from('company_users')
          .insert(newCompanyUser);
        
        if (companyUserError) {
          console.error('⚠️ ERRO ao criar company_user:', companyUserError);
        } else {
          console.log('✅ COMPANY_USER CRIADO');
        }
      }
    }
    
  } catch (error) {
    console.error('❌ ERRO GERAL:', error);
  }
}

// Executar debug
debugUserLogin().then(() => {
  console.log('\n🎯 DEBUG CONCLUÍDO');
}).catch(error => {
  console.error('❌ ERRO NO DEBUG:', error);
});
