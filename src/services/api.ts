import { supabase } from '../lib/supabase';

// Process tracking queue
export const processTrackingQueue = async () => {
  try {
    const { data, error } = await supabase.rpc('process_tracking_queue');
    
    if (error) {
      console.error('Error processing tracking queue:', error);
      return { success: false, error };
    }
    
    console.log(`Processed ${data} tracking records`);
    return { success: true, processed: data };
  } catch (error) {
    console.error('Error calling process_tracking_queue:', error);
    return { success: false, error };
  }
};

// Auto-process tracking queue every 30 seconds
let queueProcessorInterval: NodeJS.Timeout | null = null;

export const startTrackingQueueProcessor = () => {
  if (queueProcessorInterval) return; // Already running
  
  console.log('Starting tracking queue processor...');
  
  // Process immediately
  processTrackingQueue();
  
  // Then process every 30 seconds
  queueProcessorInterval = setInterval(() => {
    processTrackingQueue();
  }, 30000);
};

export const stopTrackingQueueProcessor = () => {
  if (queueProcessorInterval) {
    clearInterval(queueProcessorInterval);
    queueProcessorInterval = null;
    console.log('Stopped tracking queue processor');
  }
};

export const api = {
  async createLandingPage(companyId: string, data: { name: string; url: string }) {
    console.log('API: createLandingPage called with:', { companyId, data });
    
    const { data: page, error } = await supabase
      .from('landing_pages')
      .insert({
        company_id: companyId,
        name: data.name,
        url: data.url,
        status: 'active'
      })
      .select()
      .single();

    console.log('API: createLandingPage result:', { page, error });
    
    if (error) throw error;
    return page;
  },

  async getLandingPages(companyId: string) {
    console.log('API: getLandingPages called for company:', companyId);
    
    // Verificar se é super admin
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('is_super_admin, company_type, name')
      .eq('id', companyId)
      .single();

    console.log('API: Company data:', { company, companyError });

    if (companyError) {
      console.error('API: Error fetching company:', companyError);
      throw companyError;
    }

    let query = supabase
      .from('landing_pages')
      .select(`
        *,
        companies!inner(name, company_type)
      `)
      .order('created_at', { ascending: false });

    // Se for super admin, mostrar todas as landing pages
    if (company?.is_super_admin && company?.company_type === 'parent') {
      console.log('API: Super admin - fetching all landing pages');
      const { data, error } = await query;
      console.log('API: All landing pages result:', { data, error });
      if (error) throw error;
      return data || [];
    } else {
      console.log('API: Regular company - fetching company landing pages');
      // Empresa normal vê apenas suas próprias landing pages
      const { data, error } = await query.eq('company_id', companyId);
      console.log('API: Company landing pages result:', { data, error });
      if (error) throw error;
      return data || [];
    }
  },

  async updateLandingPage(id: string, updates: Partial<{ name: string; url: string; status: string }>) {
    const { data, error } = await supabase
      .from('landing_pages')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async deleteLandingPage(id: string) {
    const { error } = await supabase
      .from('landing_pages')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  async getAnalytics(landingPageId: string, dateRange?: { start: string; end: string }) {
    console.log('API: getAnalytics called with landingPageId:', landingPageId);
    console.log('API: dateRange:', dateRange);
    
    let query = supabase
      .from('conversions')
      .select(`
        *,
        visitors (
          id,
          device_type,
          created_at
        )
      `)
      .eq('landing_page_id', landingPageId);

    if (dateRange) {
      query = query
        .gte('converted_at', dateRange.start)
        .lte('converted_at', dateRange.end);
    }

    const { data, error } = await query;
    console.log('API: conversions query result:', { data, error });
    if (error) throw error;

    const visitorsQuery = supabase
      .from('visitors')
      .select('*')
      .eq('landing_page_id', landingPageId);

    if (dateRange) {
      visitorsQuery
        .gte('created_at', dateRange.start)
        .lte('created_at', dateRange.end);
    }

    const { data: visitors, error: visitorsError } = await visitorsQuery;
    console.log('API: visitors query result:', { visitors, visitorsError });
    if (visitorsError) throw visitorsError;

    const result = {
      conversions: data,
      visitors,
      totalVisitors: visitors?.length || 0,
      totalConversions: data?.length || 0,
      conversionRate: visitors?.length ? ((data?.length || 0) / visitors.length) * 100 : 0
    };
    
    console.log('API: getAnalytics final result:', result);
    return result;
  },

  async getBehaviorEvents(visitorId: string) {
    const { data, error } = await supabase
      .from('behavior_events')
      .select('*')
      .eq('visitor_id', visitorId)
      .order('timestamp', { ascending: true });

    if (error) throw error;
    return data;
  },

  async getHeatmapData(landingPageId: string) {
    const { data: visitors, error: visitorsError } = await supabase
      .from('visitors')
      .select('id')
      .eq('landing_page_id', landingPageId);

    if (visitorsError) throw visitorsError;

    const visitorIds = visitors?.map(v => v.id) || [];

    if (visitorIds.length === 0) return [];

    const { data, error } = await supabase
      .from('behavior_events')
      .select('*')
      .in('visitor_id', visitorIds)
      .eq('event_type', 'click')
      .not('coordinates', 'is', null);

    if (error) throw error;
    return data;
  },

  async updateCompanyWebhook(companyId: string, webhookUrl: string) {
    const { data, error } = await supabase
      .from('companies')
      .update({ webhook_url: webhookUrl })
      .eq('id', companyId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getWebhookLogs(companyId: string, limit: number = 50) {
    console.log('API: getWebhookLogs called for company:', companyId);
    
    const { data, error } = await supabase
      .from('webhook_logs')
      .select('*')
      .eq('company_id', companyId)
      .order('sent_at', { ascending: false })
      .limit(limit);

    console.log('API: Webhook logs result:', { data, error });
    
    if (error) throw error;
    return data || [];
  },

  async getDashboardStats(companyId: string) {
    // Verificar se é super admin
    const { data: company } = await supabase
      .from('companies')
      .select('is_super_admin, company_type')
      .eq('id', companyId)
      .single();

    let pagesQuery = supabase.from('landing_pages').select('id');

    // Se for super admin, pegar todas as landing pages da plataforma
    if (company?.is_super_admin && company?.company_type === 'parent') {
      // Super admin vê métricas de toda a plataforma
      const { data: pages } = await pagesQuery;
      const pageIds = pages?.map(p => p.id) || [];

      if (pageIds.length === 0) {
        return {
          totalPages: 0,
          totalVisitors: 0,
          totalConversions: 0,
          avgEngagementScore: 0,
          totalCompanies: 0
        };
      }

      const [visitorsResult, conversionsResult, companiesResult] = await Promise.all([
        supabase.from('visitors').select('id', { count: 'exact' }).in('landing_page_id', pageIds),
        supabase.from('conversions').select('engagement_score').in('landing_page_id', pageIds),
        supabase.from('companies').select('id', { count: 'exact' }).eq('company_type', 'client')
      ]);

      const avgEngagement = conversionsResult.data?.length
        ? conversionsResult.data.reduce((sum, c) => sum + (c.engagement_score || 0), 0) / conversionsResult.data.length
        : 0;

      return {
        totalPages: pages?.length || 0,
        totalVisitors: visitorsResult.count || 0,
        totalConversions: conversionsResult.data?.length || 0,
        avgEngagementScore: Number(avgEngagement.toFixed(2)),
        totalCompanies: companiesResult.count || 0
      };
    } else {
      // Empresa normal vê apenas suas próprias métricas
      const { data: pages } = await pagesQuery.eq('company_id', companyId);
      const pageIds = pages?.map(p => p.id) || [];

      if (pageIds.length === 0) {
        return {
          totalPages: 0,
          totalVisitors: 0,
          totalConversions: 0,
          avgEngagementScore: 0
        };
      }

      const [visitorsResult, conversionsResult] = await Promise.all([
        supabase.from('visitors').select('id', { count: 'exact' }).in('landing_page_id', pageIds),
        supabase.from('conversions').select('engagement_score').in('landing_page_id', pageIds)
      ]);

      const avgEngagement = conversionsResult.data?.length
        ? conversionsResult.data.reduce((sum, c) => sum + (c.engagement_score || 0), 0) / conversionsResult.data.length
        : 0;

      return {
        totalPages: pages?.length || 0,
        totalVisitors: visitorsResult.count || 0,
        totalConversions: conversionsResult.data?.length || 0,
        avgEngagementScore: Number(avgEngagement.toFixed(2))
      };
    }
  },

  // Company Management Functions
  async getClientCompanies(parentCompanyId: string) {
    console.log('API: Getting client companies for parent:', parentCompanyId);
    
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('parent_company_id', parentCompanyId)
      .eq('company_type', 'client')
      .order('created_at', { ascending: false });

    console.log('API: Client companies result:', { data, error });
    if (error) throw error;
    return data;
  },

  async createClientCompany(parentCompanyId: string, data: { 
    name: string; 
    domain?: string; 
    plan: 'basic' | 'pro' | 'enterprise';
    adminEmail: string;
    adminPassword: string;
  }) {
    console.log('API: Creating client company with data:', data);
    console.log('API: Parent company ID:', parentCompanyId);
    
    // Buscar o user_id do super admin (empresa pai)
    const { data: parentCompany } = await supabase
      .from('companies')
      .select('user_id')
      .eq('id', parentCompanyId)
      .single();

    // Create the company associando temporariamente ao super admin para gerenciamento
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .insert({
        name: data.name,
        domain: data.domain,
        plan: data.plan,
        parent_company_id: parentCompanyId,
        company_type: 'client',
        is_super_admin: false,
        user_id: parentCompany?.user_id || null, // Associar ao super admin temporariamente
        status: 'active'
      })
      .select()
      .single();

    console.log('API: Insert result:', { company, companyError });
    if (companyError) throw companyError;

    // Store the admin credentials temporarily (in a real app, you'd send an invitation email)
    // Company is now associated with super admin for management purposes
    return { 
      ...company, 
      adminCredentials: {
        email: data.adminEmail,
        password: data.adminPassword,
        companyId: company.id
      },
      managementNote: 'Empresa associada ao super admin para gerenciamento. O cliente deve se registrar para obter acesso próprio.'
    };
  },

  async updateClientCompany(companyId: string, updates: Partial<{
    name: string;
    domain: string;
    plan: 'basic' | 'pro' | 'enterprise';
    status: 'active' | 'suspended' | 'cancelled';
  }>) {
    const { data, error } = await supabase
      .from('companies')
      .update(updates)
      .eq('id', companyId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async deleteClientCompany(companyId: string) {
    const { error } = await supabase
      .from('companies')
      .delete()
      .eq('id', companyId);

    if (error) throw error;
  },

  async getCompanyStats(companyId: string) {
    const { data: company } = await supabase
      .from('companies')
      .select(`
        *,
        landing_pages(count),
        landing_pages(
          visitors(count),
          conversions(count)
        )
      `)
      .eq('id', companyId)
      .single();

    return company;
  },

  // User Management Functions
  async getCompanyUser(companyId: string) {
    console.log('API: getCompanyUser chamado para:', companyId);
    
    const { data: company, error } = await supabase
      .from('companies')
      .select('user_id, name')
      .eq('id', companyId)
      .single();

    console.log('API: Dados da empresa:', { company, error });

    if (!company?.user_id) {
      console.log('API: Empresa não tem user_id');
      return null;
    }

    // Como não podemos acessar auth.users diretamente do cliente,
    // vamos simular os dados do usuário baseado na empresa
    // Em produção, isso seria feito via API server-side
    const mockUser = {
      id: company.user_id,
      email: `admin@${company.name.toLowerCase().replace(/\s+/g, '')}.com`,
      created_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString()
    };

    console.log('API: Retornando dados simulados do usuário:', mockUser);
    return mockUser;
  },

  async updateUserEmail(userId: string, newEmail: string) {
    // Note: In a real implementation, you'd use Supabase Admin API
    // For now, we'll simulate the functionality
    console.log('Updating user email:', { userId, newEmail });
    
    // This would require server-side implementation with admin privileges
    throw new Error('Email update requires server-side implementation');
  },

  async resetUserPassword(userId: string, _newPassword: string) {
    // Note: In a real implementation, you'd use Supabase Admin API
    // For now, we'll simulate the functionality
    console.log('Resetting user password for userId:', userId);
    
    // This would require server-side implementation with admin privileges
    throw new Error('Password reset requires server-side implementation');
  },

  async impersonateUser(companyId: string) {
    const { data: company } = await supabase
      .from('companies')
      .select('user_id, name')
      .eq('id', companyId)
      .single();

    if (!company?.user_id) {
      throw new Error('Company has no associated user');
    }

    // Store original user info for later restoration
    const originalUser = supabase.auth.getUser();
    
    // In a real implementation, this would create a temporary session
    // For demo purposes, we'll return the company info
    return {
      companyId,
      companyName: company.name,
      userId: company.user_id,
      originalUser: originalUser
    };
  },

  async associateUserToCompany(companyId: string, userId: string) {
    console.log('API: Associating user to company:', { companyId, userId });
    
    const { data, error } = await supabase
      .from('companies')
      .update({ user_id: userId })
      .eq('id', companyId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async createMockUserForCompany(companyId: string, email: string) {
    console.log('API: Creating mock user for company:', { companyId, email });
    
    // Em produção, aqui seria criado um usuário real via Supabase Admin API
    // Por enquanto, vamos simular a criação sem alterar o banco
    
    const mockUserId = `mock_user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Simular a resposta sem alterar o banco (devido à foreign key constraint)
    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();
    
    if (!company) throw new Error('Company not found');
    
    // Retornar dados simulados
    return {
      company: {
        ...company,
        user_id: mockUserId // Simular que tem user_id
      },
      mockUser: {
        id: mockUserId,
        email: email,
        created_at: new Date().toISOString()
      },
      isSimulated: true
    };
  },

  async verifyTrackingTag(url: string, trackingCode: string) {
    console.log('API: Verifying tracking tag for:', { url, trackingCode });
    
    try {
      // Fazer uma requisição para verificar se a tag está instalada
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'User-Agent': 'M4Track-Verification-Bot/1.0'
        }
      });

      if (!response.ok) {
        return {
          isInstalled: false,
          error: `Erro HTTP: ${response.status} - ${response.statusText}`,
          details: 'Não foi possível acessar a página para verificação.'
        };
      }

      const html = await response.text();
      
      // Verificar se contém o script do LovooCRM (aceita todas as variantes)
      const hasLovooCRMScript = html.includes('m4track.js') || 
                               html.includes('LovooCRM') || 
                               html.includes('LovoCRM') || 
                               html.includes('M4Track');
      
      // Verificar se contém o tracking code específico
      const hasTrackingCode = html.includes(trackingCode);
      
      // Verificar se o script está no local correto (antes do </body>)
      const bodyCloseIndex = html.lastIndexOf('</body>');
      const scriptIndex = html.indexOf('m4track.js');
      const isInCorrectPosition = bodyCloseIndex > -1 && scriptIndex > -1 && scriptIndex < bodyCloseIndex;
      
      return {
        isInstalled: hasLovooCRMScript && hasTrackingCode,
        hasScript: hasLovooCRMScript,
        hasTrackingCode: hasTrackingCode,
        isInCorrectPosition: isInCorrectPosition,
        details: {
          scriptFound: hasLovooCRMScript,
          trackingCodeFound: hasTrackingCode,
          correctPosition: isInCorrectPosition,
          recommendations: []
        }
      };
    } catch (error) {
      console.error('API: Error verifying tracking tag:', error);
      
      // Verificar se é erro de CORS
      if (error instanceof TypeError && error.message.includes('CORS')) {
        return {
          isInstalled: false,
          error: 'Erro de CORS',
          details: 'Não foi possível verificar a tag devido a políticas de CORS. Isso é normal para muitos sites. Verifique manualmente se o código está instalado.'
        };
      }
      
      return {
        isInstalled: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        details: 'Ocorreu um erro durante a verificação. Verifique se a URL está correta e acessível.'
      };
    }
  }
};
