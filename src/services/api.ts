import { supabase } from '../lib/supabase';

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
    const { data, error } = await supabase
      .from('landing_pages')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
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
    if (visitorsError) throw visitorsError;

    return {
      conversions: data,
      visitors,
      totalVisitors: visitors?.length || 0,
      totalConversions: data?.length || 0,
      conversionRate: visitors?.length ? ((data?.length || 0) / visitors.length) * 100 : 0
    };
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
    const { data, error } = await supabase
      .from('webhook_logs')
      .select('*')
      .eq('company_id', companyId)
      .order('sent_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  },

  async getDashboardStats(companyId: string) {
    const { data: pages } = await supabase
      .from('landing_pages')
      .select('id')
      .eq('company_id', companyId);

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
};
