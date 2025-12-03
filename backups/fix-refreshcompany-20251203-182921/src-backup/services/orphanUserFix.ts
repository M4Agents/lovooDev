// =====================================================
// CORREÇÃO DE USUÁRIOS ÓRFÃOS - FUNÇÃO TEMPORÁRIA
// =====================================================

import { supabase } from '../lib/supabase';

/**
 * Função para corrigir usuário órfão específico
 * Esta função deve ser executada apenas uma vez para corrigir o problema atual
 */
export const fixOrphanUser = async (userEmail: string, companyName: string) => {
  try {
    console.log('OrphanFix: Starting fix for user:', userEmail, 'in company:', companyName);

    // 1. Buscar usuário no auth.users
    const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) throw usersError;

    const targetUser = users.find(u => u.email === userEmail);
    if (!targetUser) {
      throw new Error(`Usuário ${userEmail} não encontrado no auth.users`);
    }

    console.log('OrphanFix: Found user in auth:', targetUser.id);

    // 2. Buscar empresa de destino
    const { data: targetCompany, error: companyError } = await supabase
      .from('companies')
      .select('*')
      .ilike('name', `%${companyName}%`)
      .eq('company_type', 'client')
      .single();

    if (companyError || !targetCompany) {
      throw new Error(`Empresa ${companyName} não encontrada`);
    }

    console.log('OrphanFix: Found target company:', targetCompany.id, targetCompany.name);

    // 3. Verificar se já existe em company_users
    const { data: existingCompanyUser } = await supabase
      .from('company_users')
      .select('*')
      .eq('user_id', targetUser.id)
      .eq('company_id', targetCompany.id)
      .single();

    if (!existingCompanyUser) {
      // 4. Criar registro em company_users
      console.log('OrphanFix: Creating company_users record');
      
      const { error: companyUserError } = await supabase
        .from('company_users')
        .insert({
          user_id: targetUser.id,
          company_id: targetCompany.id,
          role: 'admin',
          permissions: {
            dashboard: true,
            leads: true,
            chat: true,
            analytics: true,
            settings: true,
            users: true,
            create_users: true,
            edit_users: true,
            view_financial: true
          },
          is_active: true,
          created_by: targetUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (companyUserError) {
        console.error('OrphanFix: Error creating company_users record:', companyUserError);
        throw companyUserError;
      }

      console.log('OrphanFix: Company_users record created successfully');
    } else {
      console.log('OrphanFix: Company_users record already exists');
    }

    // 5. Verificar se já existe em companies (sistema antigo)
    const { data: existingCompanyRecord } = await supabase
      .from('companies')
      .select('*')
      .eq('user_id', targetUser.id)
      .single();

    if (!existingCompanyRecord) {
      // 6. Criar registro de compatibilidade em companies
      console.log('OrphanFix: Creating compatibility record in companies');
      
      const { error: compatibilityError } = await supabase
        .from('companies')
        .insert({
          id: crypto.randomUUID(),
          user_id: targetUser.id,
          name: `${userEmail} - ${targetCompany.name}`,
          company_type: targetCompany.company_type,
          parent_company_id: targetCompany.id,
          is_super_admin: false,
          plan: targetCompany.plan || 'basic',
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (compatibilityError) {
        console.error('OrphanFix: Error creating compatibility record:', compatibilityError);
        throw compatibilityError;
      }

      console.log('OrphanFix: Compatibility record created successfully');
    } else {
      console.log('OrphanFix: Compatibility record already exists');
    }

    console.log('OrphanFix: User fix completed successfully!');
    
    return {
      success: true,
      userId: targetUser.id,
      companyId: targetCompany.id,
      message: `Usuário ${userEmail} corrigido com sucesso na empresa ${targetCompany.name}`
    };

  } catch (error) {
    console.error('OrphanFix: Error fixing orphan user:', error);
    throw error;
  }
};

/**
 * Função para verificar status de um usuário
 */
export const checkUserStatus = async (userEmail: string) => {
  try {
    console.log('OrphanFix: Checking status for user:', userEmail);

    // Buscar usuário no auth.users
    const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) throw usersError;

    const targetUser = users.find(u => u.email === userEmail);
    if (!targetUser) {
      return { exists: false, message: 'Usuário não encontrado no auth.users' };
    }

    // Verificar em company_users
    const { data: companyUsers } = await supabase
      .from('company_users')
      .select('*, companies(*)')
      .eq('user_id', targetUser.id);

    // Verificar em companies
    const { data: companies } = await supabase
      .from('companies')
      .select('*')
      .eq('user_id', targetUser.id);

    return {
      exists: true,
      userId: targetUser.id,
      email: targetUser.email,
      companyUsersCount: companyUsers?.length || 0,
      companiesCount: companies?.length || 0,
      companyUsers: companyUsers,
      companies: companies,
      isOrphan: (companyUsers?.length || 0) === 0 && (companies?.length || 0) === 0
    };

  } catch (error) {
    console.error('OrphanFix: Error checking user status:', error);
    throw error;
  }
};
