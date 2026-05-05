import { supabase } from '../lib/supabase';
// triggerManager removido — automação via backend novo (/api/automation/trigger-event)

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

    
    if (error) throw error;
    return page;
  },

  async getLandingPages(companyId: string) {
    
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('company_type, name')
      .eq('id', companyId)
      .single();

    if (companyError) {
      throw companyError;
    }

    let query = supabase
      .from('landing_pages')
      .select(`
        *,
        companies!inner(name, company_type)
      `)
      .order('created_at', { ascending: false });

    // Empresa parent (SaaS) vê todas as landing pages da plataforma
    if (company?.company_type === 'parent') {
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } else {
      // Empresa normal vê apenas suas próprias landing pages
      const { data, error } = await query.eq('company_id', companyId);
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
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error('Sessão inválida');

    const res = await fetch('/api/companies/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ companyId, updates: { webhook_url: webhookUrl } }),
    });

    const json = await res.json();
    if (!res.ok) throw json;
    return json.company;
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
    const { data: company } = await supabase
      .from('companies')
      .select('company_type')
      .eq('id', companyId)
      .single();

    let pagesQuery = supabase.from('landing_pages').select('id');

    // Empresa parent (SaaS) agrega métricas de toda a plataforma
    if (company?.company_type === 'parent') {
      // Super admin vê métricas de toda a plataforma
      const { data: pages } = await pagesQuery;
      const pageIds = pages?.map(p => p.id) || [];

      if (pageIds.length === 0) {
        // Mesmo sem páginas, buscar dados globais para super admin
        const [companiesResult, usersResult, instancesResult] = await Promise.all([
          supabase.from('companies').select('id', { count: 'exact' }).eq('company_type', 'client'),
          supabase.from('companies').select('user_id', { count: 'exact' }).not('user_id', 'is', null),
          supabase.from('whatsapp_life_instances').select('id', { count: 'exact' }).neq('status', 'disconnected')
        ]);

        return {
          totalPages: 0,
          totalVisitors: 0,
          totalConversions: 0,
          avgEngagementScore: 0,
          totalCompanies: companiesResult.count || 0,
          totalUsers: usersResult.count || 0,
          activeInstances: instancesResult.count || 0
        };
      }

      const [visitorsResult, conversionsResult, companiesResult, usersResult, instancesResult] = await Promise.all([
        supabase.from('visitors').select('id', { count: 'exact' }).in('landing_page_id', pageIds),
        supabase.from('conversions').select('engagement_score').in('landing_page_id', pageIds),
        supabase.from('companies').select('id', { count: 'exact' }).eq('company_type', 'client'),
        supabase.from('companies').select('user_id', { count: 'exact' }).not('user_id', 'is', null),
        supabase.from('whatsapp_life_instances').select('id', { count: 'exact' }).neq('status', 'disconnected')
      ]);

      const avgEngagement = conversionsResult.data?.length
        ? conversionsResult.data.reduce((sum, c) => sum + (c.engagement_score || 0), 0) / conversionsResult.data.length
        : 0;

      return {
        totalPages: pages?.length || 0,
        totalVisitors: visitorsResult.count || 0,
        totalConversions: conversionsResult.data?.length || 0,
        avgEngagementScore: Number(avgEngagement.toFixed(2)),
        totalCompanies: companiesResult.count || 0,
        totalUsers: usersResult.count || 0,
        activeInstances: instancesResult.count || 0
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
    
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('parent_company_id', parentCompanyId)
      .eq('company_type', 'client')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  },

  async getAllCompanies() {
    // Para super admin ver TODAS as empresas (pai + filhas)
    const { data, error } = await supabase
      .from('companies')
      .select('*, plans!plan_id(name, slug)')
      .order('company_type', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw error;
    return data;
  },

  async createClientCompany(parentCompanyId: string, data: { 
    name: string; 
    domain?: string; 
    plan: 'basic' | 'pro' | 'enterprise';
    adminEmail: string;
    adminPassword: string;
    sendInviteEmail?: boolean;
  }) {
    // Criação atômica via backend (POST /api/companies/create):
    //   - valida permissões (super_admin/system_admin/partner)
    //   - chama create_client_company_safe (empresa + company_users + trial)
    //   - trial de 14 dias criado automaticamente
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('Sessão inválida');

    const createRes = await fetch('/api/companies/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name:            data.name,
        domain:          data.domain ?? null,
        parentCompanyId,
      }),
    });

    const createJson = await createRes.json();

    if (!createRes.ok) {
      throw new Error(
        'Erro ao criar empresa: ' + (createJson?.error ?? 'unknown error')
      );
    }

    const companyId: string     = createJson.company_id;
    const rpcResult: Record<string, unknown> = {
      auto_assigned: createJson.auto_assigned ?? false,
    };

    // Buscar empresa criada para compor o retorno
    const { data: company, error: fetchError } = await supabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();

    if (fetchError || !company) throw fetchError ?? new Error('Company not found after creation');

    // Envio de convite (independente da criação)
    let inviteResult = null;
    if (data.sendInviteEmail) {
      try {
        const { createCompanyUser } = await import('./userApi');
        inviteResult = await createCompanyUser({
          companyId,
          email: data.adminEmail,
          role: 'admin',
          sendInvite: true,
          permissions: {
            chat: true,
            leads: true,
            users: true,
            settings: true,
            analytics: true,
            dashboard: true,
            financial: false,
            edit_users: true,
            create_users: true,
            delete_users: true,
            edit_all_leads: true,
            edit_financial: false,
            view_all_leads: true,
            view_financial: false
          }
        });
      } catch (inviteError) {
        // Não falhar a criação — convite é opcional
      }
    }

    const result: Record<string, unknown> = {
      ...company,
      adminCredentials: { email: data.adminEmail, password: data.adminPassword, companyId },
      inviteMode: data.sendInviteEmail ? 'automatic' : 'manual',
      inviteResult,
      auto_assigned: rpcResult.auto_assigned ?? false,
    };

    if (data.sendInviteEmail && inviteResult) {
      result.inviteSuccess = true;
      result.inviteUrl = (inviteResult as { app_metadata?: { invite_url?: string } })
        ?.app_metadata?.invite_url;
      result.inviteNote = 'Convite enviado automaticamente por email.';
    } else if (data.sendInviteEmail) {
      result.inviteSuccess = false;
      result.inviteNote = 'Falha no envio automático. Use as credenciais abaixo para envio manual.';
    } else {
      result.inviteNote = 'Modo manual selecionado.';
    }

    return result;
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
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error('Sessão inválida');

    const res = await fetch('/api/companies/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ companyId, updates }),
    });

    const json = await res.json();
    if (!res.ok) {
      console.error('Error in updateCompany:', json);
      throw json;
    }

    return json.company;
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
    record_type?: string;  // NOVO: Tipo de registro
    custom_fields?: Record<string, any>;
    
    // NOVOS CAMPOS - Redes Sociais
    instagram?: string;
    linkedin?: string;
    tiktok?: string;
    
    // NOVOS CAMPOS - Informações Profissionais
    cargo?: string;
    poder_investimento?: string;
    
    // NOVOS CAMPOS - Dados Pessoais
    data_nascimento?: string;
    cep?: string;
    estado?: string;
    cidade?: string;
    endereco?: string;
    numero?: string;
    bairro?: string;
    complemento?: string;
    
    // NOVOS CAMPOS - Dados de Anúncios
    campanha?: string;
    conjunto_anuncio?: string;
    anuncio?: string;
    
    // Campos da empresa (existentes)
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

      // Disparar automação backend (fire-and-forget — nunca bloqueia a criação)
      supabase.auth.getSession().then(({ data: sessionData }) => {
        const token = sessionData.session?.access_token
        if (!token || !lead.company_id) return

        fetch('/api/automation/trigger-event', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            event_type: 'lead.created',
            company_id: lead.company_id,
            data: { lead_id: lead.id, source: 'manual' },
          }),
        }).catch(err => console.error('[api.createLead] automation trigger failed:', err))
      }).catch(() => { /* sem sessão — ignora silenciosamente */ })

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
    responsible_user_id?: string;
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

      // FILTRO POR RESPONSÁVEL
      if (filters?.responsible_user_id) {
        if (filters.responsible_user_id === 'unassigned') {
          query = query.is('responsible_user_id', null);
        } else {
          query = query.eq('responsible_user_id', filters.responsible_user_id);
        }
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

      const leads = (data || []).map((lead: any) => {
        if (!lead.is_over_plan) return lead;
        return {
          ...lead,
          phone: null,
          email: null,
          company_cnpj: null,
          company_phone: null,
          company_email: null,
        };
      });

      console.log('API: Leads retrieved successfully:', leads.length);
      return leads;
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
    record_type?: string;  // NOVO: Tipo de registro
    custom_fields?: Record<string, any>;
    // Campo obrigatório para updates
    company_id?: string;
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
    console.log('🔍 API updateLead - INÍCIO:', { leadId, updates });
    
    try {
      const { custom_fields, ...leadUpdates } = updates;
      console.log('🔍 DADOS SEPARADOS:', { 
        leadUpdates, 
        custom_fields, 
        hasCustomFields: !!custom_fields,
        customFieldsCount: custom_fields ? Object.keys(custom_fields).length : 0
      });
      
      console.log('🔍 LEAD UPDATES ANTES DO SUPABASE:', leadUpdates);
      console.log('🔍 COMPANY_ID EM LEAD UPDATES:', (leadUpdates as any).company_id);
      console.log('🔍 EMAIL EM LEAD UPDATES:', (leadUpdates as any).email);
      console.log('🔍 TIPO DO EMAIL:', typeof (leadUpdates as any).email);
      console.log('🔍 EMAIL É VAZIO?:', (leadUpdates as any).email === '');
      console.log('🔍 EMAIL É NULL?:', (leadUpdates as any).email === null);
      console.log('🔍 EMAIL É UNDEFINED?:', (leadUpdates as any).email === undefined);
      console.log('🔍 TODOS OS CAMPOS DE LEAD UPDATES:', Object.keys(leadUpdates));
      
      // Limpar campo email vazio para evitar violação da constraint valid_email
      if ((leadUpdates as any).email === '') {
        console.log('🔧 REMOVENDO EMAIL VAZIO para evitar constraint violation');
        delete (leadUpdates as any).email;
      }
      
      const { data: lead, error } = await supabase
        .from('leads')
        .update(leadUpdates)
        .eq('id', leadId)
        .select()
        .single();

      console.log('🔍 RESULTADO UPDATE LEADS:', { 
        success: !error, 
        leadData: lead, 
        error: error 
      });

      if (error) {
        console.error('❌ ERRO NO UPDATE LEADS:', error);
        throw error;
      }

      // Atualizar campos personalizados se fornecidos
      if (custom_fields) {
        console.log('🔍 PROCESSANDO CUSTOM FIELDS:', custom_fields);
        
        // Primeiro, deletar valores existentes
        console.log('🔍 DELETANDO custom_values existentes para leadId:', leadId);
        const { error: deleteError } = await supabase
          .from('lead_custom_values')
          .delete()
          .eq('lead_id', leadId);
        
        console.log('🔍 RESULTADO DELETE custom_values:', { 
          success: !deleteError, 
          error: deleteError 
        });

        // Inserir novos valores
        if (Object.keys(custom_fields).length > 0) {
          const customValues = Object.entries(custom_fields).map(([fieldId, value]) => ({
            lead_id: leadId,
            field_id: fieldId,
            value: String(value)
          }));

          console.log('🔍 INSERINDO custom_values:', customValues);

          const { error: customError } = await supabase
            .from('lead_custom_values')
            .insert(customValues);

          console.log('🔍 RESULTADO INSERT custom_values:', { 
            success: !customError, 
            error: customError 
          });

          if (customError) {
            console.error('❌ ERRO EM CUSTOM FIELDS:', customError);
          }
        } else {
          console.log('🔍 NENHUM custom_field para inserir');
        }
      } else {
        console.log('🔍 SEM custom_fields para processar');
      }

      console.log('✅ API updateLead - SUCESSO COMPLETO:', lead);
      return lead;
    } catch (error) {
      console.error('❌ API updateLead - ERRO GERAL:', error);
      console.error('❌ DETALHES DO ERRO:', {
        message: (error as any)?.message,
        code: (error as any)?.code,
        details: (error as any)?.details,
        hint: (error as any)?.hint
      });
      throw error;
    }
  },

  async deleteLead(leadId: number, softDelete: boolean = true) {
    console.log('API: deleteLead called with:', { leadId, softDelete });
    
    try {
      if (softDelete) {
        // 1. Soft delete no lead
        const { data, error } = await supabase
          .from('leads')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', leadId)
          .select()
          .single();

        if (error) throw error;

        // 2. Remover do funil (evita oportunidades órfãs no kanban)
        await supabase
          .from('opportunity_funnel_positions')
          .delete()
          .eq('lead_id', leadId);

        // 3. Marcar oportunidades como perdidas (preserva histórico)
        await supabase
          .from('opportunities')
          .update({ status: 'lost' })
          .eq('lead_id', leadId)
          .eq('status', 'open');

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
    
    // #region agent log
    const _dbgSession = await supabase.auth.getSession();
    const _dbgUid = _dbgSession.data?.session?.user?.id ?? null;
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'25e06b'},body:JSON.stringify({sessionId:'25e06b',location:'api.ts:createCustomField:entry',message:'createCustomField chamado',data:{company_id:data.company_id,field_name:data.field_name,auth_uid:_dbgUid},hypothesisId:'H-A,H-B,H-C',timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    try {
      const { data: field, error } = await supabase
        .from('lead_custom_fields')
        .insert(data)
        .select()
        .single();

      // #region agent log
      fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'25e06b'},body:JSON.stringify({sessionId:'25e06b',location:'api.ts:createCustomField:result',message:'resultado do insert',data:{field:field??null,error_code:error?.code??null,error_message:error?.message??null,error_hint:error?.hint??null,error_details:(error as any)?.details??null},hypothesisId:'H-A,H-B,H-C',timestamp:Date.now()})}).catch(()=>{});
      // #endregion

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

  // ── Importação de leads por arquivo (segura via backend) ──────────────────
  // company_id vai no query param; JWT + company_users resolvem o tenant.
  // Substitui o insert direto anterior (removido — rollback via git revert).
  async importLeadsViaFile(
    companyId: string,
    leads: Array<Record<string, any>>,
    funnelId?: string,
    stageId?: string,
  ) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('Sessão não encontrada. Faça login novamente.');

    const url = `/api/leads/import-file?company_id=${encodeURIComponent(companyId)}`;

    const response = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        leads,
        funnel_id: funnelId ?? null,
        stage_id:  stageId  ?? null,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Erro na importação de leads');
    }

    return data as {
      summary: {
        total_submitted: number;
        success:         number;
        duplicate:       number;
        error:           number;
      };
    };
  },

  async getLeadStats(
    companyId: string,
    dateRange?: { start: string; end: string }
  ): Promise<{ totalLeads: number; totalEntries: number }> {
    try {
      const { data, error } = await supabase.rpc('get_lead_dashboard_stats', {
        p_company_id: companyId,
        p_start_date: dateRange?.start ?? null,
        p_end_date: dateRange?.end ?? null,
      });

      if (error) throw error;

      return {
        totalLeads: (data as any)?.total_leads ?? 0,
        totalEntries: (data as any)?.total_entries ?? 0,
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
          const isSuccess = log.response_status !== null && log.response_status !== undefined
            ? (log.response_status >= 200 && log.response_status < 300)
            : !log.error_message;
          return options.status === 'success' ? isSuccess : !isSuccess;
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
        success: logs.filter((log: any) => {
          // Sucesso = response_status 2xx (200-299) e sem erros de rede
          if (log.response_status !== null && log.response_status !== undefined) {
            return log.response_status >= 200 && log.response_status < 300;
          }
          // Se não há erro explícito = provavelmente sucesso
          return !log.error_message;
        }).length,
        errors: logs.filter((log: any) => {
          // Erro = response_status fora de 2xx ou com erros de rede
          if (log.response_status !== null && log.response_status !== undefined) {
            return log.response_status < 200 || log.response_status >= 300;
          }
          // Se há erro explícito = erro
          return !!log.error_message;
        }).length,
        last24h: logs.filter((log: any) => {
          const logDate = new Date(log.triggered_at || log.created_at);
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
  },

  // Analytics functions
  async getAnalyticsData(period: any, companyId?: string) {
    try {
      // Use the same approach as getDashboardStats for consistency
      let targetCompanyId = companyId;
      
      // Fallback to localStorage if companyId not provided (backward compatibility)
      if (!targetCompanyId) {
        targetCompanyId = localStorage.getItem('currentCompanyId');
      }
      
      if (!targetCompanyId) {
        throw new Error('ID da empresa não encontrado');
      }

      // Get company data using the same method as other functions
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .select('*')
        .eq('id', targetCompanyId)
        .single();

      if (companyError) {
        console.error('Error fetching company:', companyError);
        throw new Error('Erro ao buscar dados da empresa');
      }

      if (company?.company_type !== 'parent') {
        throw new Error('Acesso negado: Apenas empresas SaaS podem acessar analytics');
      }

      const startDate = period.startDate?.toISOString();
      const endDate = period.endDate?.toISOString();

      if (!startDate || !endDate) {
        throw new Error('Período de datas inválido');
      }

      // Get previous period data first
      const previousPeriodData = await this.getPreviousPeriodData(period);

      // Parallel queries for better performance
      const [
        newCompaniesResult,
        companiesByPlanResult,
        growthDataResult
      ] = await Promise.all([
        // Count new companies in period
        supabase
          .from('companies')
          .select('id', { count: 'exact' })
          .eq('company_type', 'client')
          .gte('created_at', startDate)
          .lte('created_at', endDate),

        // Companies by plan distribution
        supabase
          .from('companies')
          .select('plan')
          .eq('company_type', 'client')
          .gte('created_at', startDate)
          .lte('created_at', endDate),

        // Daily growth data
        supabase
          .from('companies')
          .select('created_at')
          .eq('company_type', 'client')
          .gte('created_at', startDate)
          .lte('created_at', endDate)
          .order('created_at')
      ]);

      // Process companies by plan
      const planCounts: Record<string, number> = {};
      companiesByPlanResult.data?.forEach((company: any) => {
        const plan = company.plan || 'basic';
        planCounts[plan] = (planCounts[plan] || 0) + 1;
      });

      const totalCompanies = Object.values(planCounts).reduce((sum, count) => sum + count, 0);
      
      const companiesByPlan = Object.entries(planCounts).map(([plan, count]) => ({
        plan,
        count,
        percentage: totalCompanies > 0 ? Math.round((count / totalCompanies) * 100) : 0,
        color: this.getPlanColor(plan)
      })).sort((a, b) => b.count - a.count);

      // Process growth data
      const growthByDate: Record<string, number> = {};
      growthDataResult.data?.forEach((company: any) => {
        const date = new Date(company.created_at).toISOString().split('T')[0];
        growthByDate[date] = (growthByDate[date] || 0) + 1;
      });

      const growthData = Object.entries(growthByDate).map(([date, count], index, arr) => {
        const cumulative = arr.slice(0, index + 1).reduce((sum, [, c]) => sum + c, 0);
        return { date, count, cumulative };
      });

      // Calculate period comparison
      const currentCount = newCompaniesResult.count || 0;
      const previousCount = previousPeriodData || 0;
      const growth = currentCount - previousCount;
      const growthPercentage = previousCount > 0 ? Math.round((growth / previousCount) * 100) : 0;

      // Calculate average daily growth
      const periodDays = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
      const averageDailyGrowth = periodDays > 0 ? Math.round((currentCount / periodDays) * 100) / 100 : 0;

      return {
        newCompaniesCount: currentCount,
        companiesByPlan,
        topPlans: companiesByPlan.slice(0, 5), // Top 5 plans
        growthData,
        periodComparison: {
          current: currentCount,
          previous: previousCount,
          growth,
          growthPercentage
        },
        averageDailyGrowth
      };
    } catch (error) {
      console.error('Error in getAnalyticsData:', error);
      throw error;
    }
  },

  async getPreviousPeriodData(period: any) {
    try {
      if (!period.startDate || !period.endDate) return 0;

      const periodLength = period.endDate.getTime() - period.startDate.getTime();
      const previousStartDate = new Date(period.startDate.getTime() - periodLength);
      const previousEndDate = new Date(period.startDate.getTime());

      const { count } = await supabase
        .from('companies')
        .select('id', { count: 'exact' })
        .eq('company_type', 'client')
        .gte('created_at', previousStartDate.toISOString())
        .lt('created_at', previousEndDate.toISOString());

      return count || 0;
    } catch (error) {
      console.error('Error in getPreviousPeriodData:', error);
      return 0;
    }
  },

  getPlanColor(plan: string): string {
    const colors: Record<string, string> = {
      basic: '#3B82F6',
      pro: '#10B981',
      enterprise: '#8B5CF6',
      start: '#F59E0B',
      professional: '#EF4444'
    };
    return colors[plan] || '#6B7280';
  }
};
