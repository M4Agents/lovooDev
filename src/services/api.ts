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
  },

  async getProfessionalAnalytics(landingPageId: string, startDate: string, endDate: string) {
    console.log('API: getProfessionalAnalytics called with:', { landingPageId, startDate, endDate });
    
    try {
      const { data: visitors, error: visitorsError } = await supabase
        .from('visitors')
        .select('*')
        .eq('landing_page_id', landingPageId)
        .gte('created_at', startDate + 'T00:00:00Z')
        .lte('created_at', endDate + 'T23:59:59Z')
        .order('created_at', { ascending: false });

      if (visitorsError) throw visitorsError;

      const { data: conversions, error: conversionsError } = await supabase
        .from('conversions')
        .select('*')
        .eq('landing_page_id', landingPageId)
        .gte('converted_at', startDate + 'T00:00:00Z')
        .lte('converted_at', endDate + 'T23:59:59Z')
        .order('converted_at', { ascending: false });

      if (conversionsError) throw conversionsError;

      const totalVisitors = visitors?.length || 0;
      const visitorsWithId = visitors?.filter(v => v.visitor_id) || [];
      const uniqueVisitors = visitorsWithId.length > 0 
        ? new Set(visitorsWithId.map(v => v.visitor_id)).size 
        : totalVisitors;
      
      const visitorCounts = visitorsWithId.reduce((acc: Record<string, number>, v) => {
        if (v.visitor_id) acc[v.visitor_id] = (acc[v.visitor_id] || 0) + 1;
        return acc;
      }, {});
      
      const returningVisitors = Object.values(visitorCounts).filter(count => count > 1).length;
      const newVisitors = uniqueVisitors - returningVisitors;
      const conversionRate = totalVisitors > 0 ? ((conversions?.length || 0) / totalVisitors) * 100 : 0;

      const getSpecificDeviceType = (userAgent: string, deviceType: string) => {
        if (!userAgent) return deviceType || 'unknown';
        
        const ua = userAgent.toLowerCase();
        
        // Detectar dispositivos específicos baseado no User Agent
        if (ua.includes('iphone')) return 'iPhone';
        if (ua.includes('ipad')) return 'iPad';
        if (ua.includes('ipod')) return 'iPod';
        if (ua.includes('android') && ua.includes('mobile')) return 'Android Phone';
        if (ua.includes('android')) return 'Android Tablet';
        if (ua.includes('blackberry')) return 'BlackBerry';
        if (ua.includes('windows phone')) return 'Windows Phone';
        if (ua.includes('macintosh') || ua.includes('mac os')) return 'Mac';
        if (ua.includes('windows')) return 'Windows';
        if (ua.includes('linux')) return 'Linux';
        
        // Fallback para o tipo básico
        return deviceType || 'unknown';
      };

      const deviceBreakdown = visitors?.reduce((acc: Record<string, number>, v) => {
        const specificDevice = getSpecificDeviceType(v.user_agent, v.device_type);
        acc[specificDevice] = (acc[specificDevice] || 0) + 1;
        return acc;
      }, {}) || {};

      const referrerBreakdown = visitors?.reduce((acc: Record<string, number>, v) => {
        const referrer = v.referrer || 'direct';
        acc[referrer] = (acc[referrer] || 0) + 1;
        return acc;
      }, {}) || {};

      return {
        totalVisitors,
        uniqueVisitors,
        returningVisitors,
        newVisitors,
        totalSessions: totalVisitors,
        avgSessionDuration: 120,
        bounceRate: 45,
        conversionRate,
        deviceBreakdown,
        referrerBreakdown,
        timezoneBreakdown: {},
        languageBreakdown: {},
        hourlyBreakdown: {},
        dailyBreakdown: {},
        visitors: visitors || [],
        conversions: conversions || []
      };
    } catch (error) {
      console.error('Error in getProfessionalAnalytics:', error);
      throw error;
    }
  },

  async updateCompany(companyId: string, updates: any) {
    console.log('API: updateCompany called with:', { companyId, updates });
    
    try {
      const { data, error } = await supabase
        .from('companies')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', companyId)
        .select()
        .single();

      if (error) throw error;
      
      console.log('API: Company updated successfully:', data);
      return data;
    } catch (error) {
      console.error('Error in updateCompany:', error);
      throw error;
    }
  },

  // Leads Management Functions
  async createLead(data: {
    company_id: string;
    name: string;
    email?: string;
    phone?: string;
    origin?: string;
    status?: string;
    interest?: string;
    responsible_user_id?: string | null;
    visitor_id?: string | null;
    custom_fields?: Record<string, any>;
    // Campos da empresa
    company_name?: string;
    company_cnpj?: string;
    company_razao_social?: string;
    company_nome_fantasia?: string;
    company_cep?: string;
    company_cidade?: string;
    company_estado?: string;
    company_endereco?: string;
    company_telefone?: string;
    company_email?: string;
    company_site?: string;
  }) {
    console.log('API: createLead called with:', data);
    
    try {
      const { custom_fields, ...leadData } = data;
      
      const { data: lead, error } = await supabase
        .from('leads')
        .insert(leadData)
        .select()
        .single();

      if (error) throw error;

      // Se há campos personalizados, inserir os valores
      if (custom_fields && Object.keys(custom_fields).length > 0) {
        const customValues = Object.entries(custom_fields).map(([fieldId, value]) => ({
          lead_id: lead.id,
          field_id: fieldId,
          value: String(value)
        }));

        const { error: customError } = await supabase
          .from('lead_custom_values')
          .insert(customValues);

        if (customError) {
          console.error('Error inserting custom field values:', customError);
        }
      }

      console.log('API: Lead created successfully:', lead);
      return lead;
    } catch (error) {
      console.error('Error in createLead:', error);
      throw error;
    }
  },

  async getLeads(companyId: string, filters?: {
    status?: string;
    origin?: string;
    search?: string;
    name?: string;
    phone?: string;
    email?: string;
    dateRange?: { start: string; end: string };
    limit?: number;
    offset?: number;
  }) {
    console.log('API: getLeads called for company:', companyId);
    
    try {
      let query = supabase
        .from('leads')
        .select(`
          *,
          lead_custom_values (
            field_id,
            value,
            lead_custom_fields (
              field_name,
              field_label,
              field_type
            )
          )
        `)
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }

      if (filters?.origin) {
        query = query.eq('origin', filters.origin);
      }

      if (filters?.search) {
        query = query.or(`name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`);
      }

      // NOVOS FILTROS ESPECÍFICOS
      if (filters?.name) {
        query = query.ilike('name', `%${filters.name}%`);
      }

      if (filters?.phone) {
        query = query.ilike('phone', `%${filters.phone}%`);
      }

      if (filters?.email) {
        query = query.ilike('email', `%${filters.email}%`);
      }

      // FILTRO POR PERÍODO
      if (filters?.dateRange) {
        query = query
          .gte('created_at', filters.dateRange.start)
          .lte('created_at', filters.dateRange.end);
      }

      if (filters?.limit) {
        query = query.limit(filters.limit);
      }

      if (filters?.offset) {
        query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);
      }

      const { data, error } = await query;

      if (error) throw error;

      console.log('API: Leads retrieved successfully:', data?.length || 0);
      return data || [];
    } catch (error) {
      console.error('Error in getLeads:', error);
      throw error;
    }
  },

  async updateLead(leadId: number, updates: {
    name?: string;
    email?: string;
    phone?: string;
    origin?: string;
    status?: string;
    interest?: string;
    responsible_user_id?: string | null;
    visitor_id?: string | null;
    custom_fields?: Record<string, any>;
    // Campos da empresa
    company_name?: string;
    company_cnpj?: string;
    company_razao_social?: string;
    company_nome_fantasia?: string;
    company_cep?: string;
    company_cidade?: string;
    company_estado?: string;
    company_endereco?: string;
    company_telefone?: string;
    company_email?: string;
    company_site?: string;
  }) {
    console.log('API: updateLead called with:', { leadId, updates });
    
    try {
      const { custom_fields, ...leadUpdates } = updates;
      
      const { data: lead, error } = await supabase
        .from('leads')
        .update(leadUpdates)
        .eq('id', leadId)
        .select()
        .single();

      if (error) throw error;

      // Atualizar campos personalizados se fornecidos
      if (custom_fields) {
        // Primeiro, deletar valores existentes
        await supabase
          .from('lead_custom_values')
          .delete()
          .eq('lead_id', leadId);

        // Inserir novos valores
        if (Object.keys(custom_fields).length > 0) {
          const customValues = Object.entries(custom_fields).map(([fieldId, value]) => ({
            lead_id: leadId,
            field_id: fieldId,
            value: String(value)
          }));

          const { error: customError } = await supabase
            .from('lead_custom_values')
            .insert(customValues);

          if (customError) {
            console.error('Error updating custom field values:', customError);
          }
        }
      }

      console.log('API: Lead updated successfully:', lead);
      return lead;
    } catch (error) {
      console.error('Error in updateLead:', error);
      throw error;
    }
  },

  async deleteLead(leadId: number, softDelete: boolean = true) {
    console.log('API: deleteLead called with:', { leadId, softDelete });
    
    try {
      if (softDelete) {
        const { data, error } = await supabase
          .from('leads')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', leadId)
          .select()
          .single();

        if (error) throw error;
        return data;
      } else {
        const { error } = await supabase
          .from('leads')
          .delete()
          .eq('id', leadId);

        if (error) throw error;
        return { success: true };
      }
    } catch (error) {
      console.error('Error in deleteLead:', error);
      throw error;
    }
  },

  async getLeadById(leadId: number) {
    console.log('API: getLeadById called with:', leadId);
    
    try {
      const { data, error } = await supabase
        .from('leads')
        .select(`
          *,
          lead_custom_values (
            field_id,
            value,
            lead_custom_fields (
              field_name,
              field_label,
              field_type,
              options
            )
          )
        `)
        .eq('id', leadId)
        .is('deleted_at', null)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error in getLeadById:', error);
      throw error;
    }
  },

  // Custom Fields Management
  async getCustomFields(companyId: string) {
    console.log('API: getCustomFields called for company:', companyId);
    
    try {
      const { data, error } = await supabase
        .from('lead_custom_fields')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error in getCustomFields:', error);
      throw error;
    }
  },

  async createCustomField(data: {
    company_id: string;
    field_name: string;
    field_label: string;
    field_type: 'text' | 'number' | 'date' | 'boolean' | 'select';
    options?: any[];
    is_required?: boolean;
  }) {
    console.log('API: createCustomField called with:', data);
    
    try {
      const { data: field, error } = await supabase
        .from('lead_custom_fields')
        .insert(data)
        .select()
        .single();

      if (error) throw error;
      return field;
    } catch (error) {
      console.error('Error in createCustomField:', error);
      throw error;
    }
  },

  async updateCustomField(fieldId: string, updates: {
    field_label?: string;
    field_type?: 'text' | 'number' | 'date' | 'boolean' | 'select';
    options?: any[];
    is_required?: boolean;
  }) {
    console.log('API: updateCustomField called with:', { fieldId, updates });
    
    try {
      const { data, error } = await supabase
        .from('lead_custom_fields')
        .update(updates)
        .eq('id', fieldId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error in updateCustomField:', error);
      throw error;
    }
  },

  async deleteCustomField(fieldId: string) {
    console.log('API: deleteCustomField called with:', fieldId);
    
    try {
      const { error } = await supabase
        .from('lead_custom_fields')
        .delete()
        .eq('id', fieldId);

      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('Error in deleteCustomField:', error);
      throw error;
    }
  },

  // Bulk Import Functions
  async importLeads(companyId: string, leads: Array<{
    name: string;
    email?: string;
    phone?: string;
    origin?: string;
    status?: string;
    interest?: string;
    // Campos da empresa
    company_name?: string;
    company_cnpj?: string;
    company_razao_social?: string;
    company_nome_fantasia?: string;
    company_cep?: string;
    company_cidade?: string;
    company_estado?: string;
    company_endereco?: string;
    company_telefone?: string;
    company_email?: string;
    company_site?: string;
    [key: string]: any;
  }>) {
    console.log('API: importLeads called with:', { companyId, count: leads.length });
    
    try {
      // Buscar campos personalizados da empresa via RPC (contorna RLS)
      const { data: customFields, error: fieldsError } = await supabase
        .rpc('get_all_custom_fields_for_import', {
          p_company_id: companyId
        });

      if (fieldsError) {
        console.error('Error fetching custom fields:', fieldsError);
      }

      const customFieldsMap = new Map();
      if (customFields) {
        customFields.forEach((field: any) => {
          customFieldsMap.set(field.numeric_id?.toString(), field);
        });
      }

      console.log('Custom fields loaded for import:', customFieldsMap.size);

      const results = [];
      
      // Processar leads um por vez para garantir campos personalizados
      for (const leadData of leads) {
        try {
          // Separar campos padrão dos personalizados
          const { 
            name, email, phone, origin, status, interest,
            company_name, company_cnpj, company_razao_social, company_nome_fantasia,
            company_cep, company_cidade, company_estado, company_endereco,
            company_telefone, company_email, company_site,
            ...otherFields 
          } = leadData;

          // Campos padrão do lead
          const standardFields = {
            name, email, phone, origin: origin || 'import', status, interest,
            company_name, company_cnpj, company_razao_social, company_nome_fantasia,
            company_cep, company_cidade, company_estado, company_endereco,
            company_telefone, company_email, company_site,
            company_id: companyId
          };

          // Criar lead com campos padrão
          const { data: lead, error: leadError } = await supabase
            .from('leads')
            .insert(standardFields)
            .select()
            .single();

          if (leadError) throw leadError;

          // Processar campos personalizados (sistema híbrido)
          const customValues = [];
          for (const [key, value] of Object.entries(otherFields)) {
            if (value && value !== '') {
              // Verificar se é um ID numérico (campo personalizado)
              if (/^\d+$/.test(key)) {
                const customField = customFieldsMap.get(key);
                if (customField) {
                  customValues.push({
                    lead_id: lead.id,
                    field_id: customField.id,
                    value: String(value)
                  });
                  console.log(`Custom field mapped: ID ${key} -> ${customField.field_name} = ${value}`);
                }
              }
              // Verificar se é um campo mapeado (custom_fieldId)
              else if (key.startsWith('custom_')) {
                const fieldId = key.replace('custom_', '');
                customValues.push({
                  lead_id: lead.id,
                  field_id: fieldId,
                  value: String(value)
                });
                console.log(`Custom field mapped: ${key} -> ${fieldId} = ${value}`);
              }
            }
          }

          // Inserir valores dos campos personalizados
          if (customValues.length > 0) {
            const { error: customError } = await supabase
              .from('lead_custom_values')
              .insert(customValues);

            if (customError) {
              console.error('Error inserting custom field values:', customError);
            } else {
              console.log(`Inserted ${customValues.length} custom field values for lead ${lead.id}`);
            }
          }

          results.push(lead);
        } catch (leadError) {
          console.error('Error importing individual lead:', leadError);
          // Continuar com próximo lead em caso de erro
        }
      }

      console.log('API: Leads imported successfully:', results.length);
      return results;
    } catch (error) {
      console.error('Error in importLeads:', error);
      throw error;
    }
  },

  async getLeadStats(companyId: string) {
    console.log('API: getLeadStats called for company:', companyId);
    
    try {
      const { data: leads, error } = await supabase
        .from('leads')
        .select('status, origin, created_at')
        .eq('company_id', companyId)
        .is('deleted_at', null);

      if (error) throw error;

      const totalLeads = leads?.length || 0;
      const statusBreakdown = leads?.reduce((acc: Record<string, number>, lead) => {
        acc[lead.status] = (acc[lead.status] || 0) + 1;
        return acc;
      }, {}) || {};

      const originBreakdown = leads?.reduce((acc: Record<string, number>, lead) => {
        acc[lead.origin] = (acc[lead.origin] || 0) + 1;
        return acc;
      }, {}) || {};

      const thisMonth = new Date();
      thisMonth.setDate(1);
      const leadsThisMonth = leads?.filter(lead => 
        new Date(lead.created_at) >= thisMonth
      ).length || 0;

      return {
        totalLeads,
        leadsThisMonth,
        statusBreakdown,
        originBreakdown,
        conversionRate: statusBreakdown['convertido'] ? 
          (statusBreakdown['convertido'] / totalLeads) * 100 : 0
      };
    } catch (error) {
      console.error('Error in getLeadStats:', error);
      throw error;
    }
  },

  async exportLeads(companyId: string) {
    console.log('API: exportLeads called for company:', companyId);
    
    try {
      // Buscar leads com campos personalizados
      const { data: leads, error } = await supabase
        .from('leads')
        .select(`
          *,
          lead_custom_values (
            value,
            lead_custom_fields (
              field_name,
              field_label,
              numeric_id
            )
          )
        `)
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching leads for export:', error);
        throw error;
      }

      console.log('API: Leads fetched for export:', leads?.length || 0);
      return leads || [];
    } catch (error) {
      console.error('Error in exportLeads:', error);
      throw error;
    }
  },

  // ===== WEBHOOK AVANÇADO APIS - MÓDULO ISOLADO =====
  
  async getWebhookTriggerConfigs(companyId: string) {
    console.log('API: getWebhookTriggerConfigs called for company:', companyId);
    
    try {
      const { data, error } = await supabase.rpc('get_webhook_trigger_configs', {
        p_company_id: companyId
      });

      if (error) {
        console.error('Error fetching webhook trigger configs:', error);
        throw error;
      }

      console.log('API: Webhook trigger configs fetched:', data?.length || 0);
      return data || [];
    } catch (error) {
      console.error('Error in getWebhookTriggerConfigs:', error);
      throw error;
    }
  },

  async createWebhookTriggerConfig(companyId: string, config: {
    name: string;
    webhook_url: string;
    is_active?: boolean;
    trigger_events?: string[];
    conditions?: Record<string, any>;
    payload_fields?: Record<string, any>;
    timeout_seconds?: number;
    retry_attempts?: number;
    headers?: Record<string, string>;
  }) {
    console.log('API: createWebhookTriggerConfig called:', { companyId, config });
    
    try {
      const { data, error } = await supabase.rpc('create_webhook_trigger_config', {
        p_company_id: companyId,
        p_name: config.name,
        p_webhook_url: config.webhook_url,
        p_is_active: config.is_active ?? true,
        p_trigger_events: JSON.stringify(config.trigger_events || ['lead_converted']),
        p_conditions: JSON.stringify(config.conditions || {}),
        p_payload_fields: JSON.stringify(config.payload_fields || {
          lead: ['name', 'email', 'phone', 'status', 'origin'],
          empresa: ['company_name', 'company_cnpj'],
          tracking: ['visitor_id'],
          custom: []
        }),
        p_timeout_seconds: config.timeout_seconds || 10,
        p_retry_attempts: config.retry_attempts || 3,
        p_headers: JSON.stringify(config.headers || {})
      });

      if (error) {
        console.error('Error creating webhook trigger config:', error);
        throw error;
      }

      console.log('API: Webhook trigger config created with ID:', data);
      return data;
    } catch (error) {
      console.error('Error in createWebhookTriggerConfig:', error);
      throw error;
    }
  },

  async updateWebhookTriggerConfig(configId: string, companyId: string, updates: {
    name?: string;
    webhook_url?: string;
    is_active?: boolean;
    trigger_events?: string[];
    conditions?: Record<string, any>;
    payload_fields?: Record<string, any>;
    timeout_seconds?: number;
    retry_attempts?: number;
    headers?: Record<string, string>;
  }) {
    console.log('API: updateWebhookTriggerConfig called:', { configId, companyId, updates });
    
    try {
      const { data, error } = await supabase.rpc('update_webhook_trigger_config', {
        p_id: configId,
        p_company_id: companyId,
        p_name: updates.name || null,
        p_webhook_url: updates.webhook_url || null,
        p_is_active: updates.is_active ?? null,
        p_trigger_events: updates.trigger_events ? JSON.stringify(updates.trigger_events) : null,
        p_conditions: updates.conditions ? JSON.stringify(updates.conditions) : null,
        p_payload_fields: updates.payload_fields ? JSON.stringify(updates.payload_fields) : null,
        p_timeout_seconds: updates.timeout_seconds ?? null,
        p_retry_attempts: updates.retry_attempts ?? null,
        p_headers: updates.headers ? JSON.stringify(updates.headers) : null
      });

      if (error) {
        console.error('Error updating webhook trigger config:', error);
        throw error;
      }

      console.log('API: Webhook trigger config updated:', data);
      return data;
    } catch (error) {
      console.error('Error in updateWebhookTriggerConfig:', error);
      throw error;
    }
  },

  async deleteWebhookTriggerConfig(configId: string, companyId: string) {
    console.log('API: deleteWebhookTriggerConfig called:', { configId, companyId });
    
    try {
      const { data, error } = await supabase.rpc('delete_webhook_trigger_config', {
        p_id: configId,
        p_company_id: companyId
      });

      if (error) {
        console.error('Error deleting webhook trigger config:', error);
        throw error;
      }

      console.log('API: Webhook trigger config deleted:', data);
      return data;
    } catch (error) {
      console.error('Error in deleteWebhookTriggerConfig:', error);
      throw error;
    }
  },

  async getWebhookTriggerLogs(companyId: string, configId?: string, limit?: number) {
    console.log('API: getWebhookTriggerLogs called:', { companyId, configId, limit });
    
    try {
      const { data, error } = await supabase.rpc('get_webhook_trigger_logs', {
        p_company_id: companyId,
        p_config_id: configId || null,
        p_limit: limit || 50
      });

      if (error) {
        console.error('Error fetching webhook trigger logs:', error);
        throw error;
      }

      console.log('API: Webhook trigger logs fetched:', data?.length || 0);
      return data || [];
    } catch (error) {
      console.error('Error in getWebhookTriggerLogs:', error);
      throw error;
    }
  },

  async testWebhookTrigger(url: string, payload: any, headers?: Record<string, string>) {
    console.log('API: testWebhookTrigger called:', { url, payload, headers });
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(payload)
      });

      const responseText = await response.text();
      let responseBody;
      
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = responseText;
      }

      const result = {
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        response: responseBody
      };

      console.log('API: Webhook test result:', result);
      return result;
    } catch (error) {
      console.error('Error in testWebhookTrigger:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  },

  // ===== NOVAS APIs ISOLADAS PARA LOGS AVANÇADOS =====
  // Implementação completamente isolada para não afetar APIs existentes
  
  async getAdvancedWebhookLogs(companyId: string, options: {
    configId?: string;
    dateFrom?: string;
    dateTo?: string;
    status?: 'success' | 'error';
    limit?: number;
  } = {}) {
    console.log('API: getAdvancedWebhookLogs called:', { companyId, options });
    
    try {
      // Usar a mesma RPC existente mas com parâmetros específicos
      const { data, error } = await supabase.rpc('get_webhook_trigger_logs', {
        p_company_id: companyId,
        p_config_id: options.configId || null,
        p_limit: options.limit || 50
      });

      if (error) {
        console.error('Error fetching advanced webhook logs:', error);
        throw error;
      }

      let logs = data || [];

      // Aplicar filtros adicionais no frontend se necessário
      if (options.status) {
        logs = logs.filter((log: any) => {
          return options.status === 'success' ? log.success : !log.success;
        });
      }

      if (options.dateFrom) {
        const fromDate = new Date(options.dateFrom);
        logs = logs.filter((log: any) => new Date(log.created_at) >= fromDate);
      }

      if (options.dateTo) {
        const toDate = new Date(options.dateTo);
        logs = logs.filter((log: any) => new Date(log.created_at) <= toDate);
      }

      console.log('API: Advanced webhook logs processed:', logs.length);
      return logs;
    } catch (error) {
      console.error('Error in getAdvancedWebhookLogs:', error);
      throw error;
    }
  },

  async refreshAdvancedWebhookLogs(companyId: string) {
    console.log('API: refreshAdvancedWebhookLogs called for company:', companyId);
    
    try {
      // Buscar logs mais recentes
      return await this.getAdvancedWebhookLogs(companyId, { limit: 100 });
    } catch (error) {
      console.error('Error in refreshAdvancedWebhookLogs:', error);
      throw error;
    }
  },

  async getAdvancedWebhookStats(companyId: string) {
    console.log('API: getAdvancedWebhookStats called for company:', companyId);
    
    try {
      const logs = await this.getAdvancedWebhookLogs(companyId, { limit: 1000 });
      
      const stats = {
        total: logs.length,
        success: logs.filter((log: any) => log.success).length,
        errors: logs.filter((log: any) => !log.success).length,
        last24h: logs.filter((log: any) => {
          const logDate = new Date(log.created_at);
          const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
          return logDate >= yesterday;
        }).length
      };

      console.log('API: Advanced webhook stats:', stats);
      return stats;
    } catch (error) {
      console.error('Error in getAdvancedWebhookStats:', error);
      throw error;
    }
  }
};
