import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export const useRealtimeAnalytics = (companyId: string | undefined) => {
  const [stats, setStats] = useState({
    activeVisitors: 0,
    recentConversions: 0,
    lastUpdate: new Date()
  });

  useEffect(() => {
    if (!companyId) return;

    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    const fetchActiveData = async () => {
      const { data: pages } = await supabase
        .from('landing_pages')
        .select('id')
        .eq('company_id', companyId);

      const pageIds = pages?.map(p => p.id) || [];

      if (pageIds.length === 0) return;

      const [visitorsResult, conversionsResult] = await Promise.all([
        supabase
          .from('visitors')
          .select('id', { count: 'exact' })
          .in('landing_page_id', pageIds)
          .gte('created_at', fiveMinutesAgo.toISOString()),
        supabase
          .from('conversions')
          .select('id', { count: 'exact' })
          .in('landing_page_id', pageIds)
          .gte('converted_at', fiveMinutesAgo.toISOString())
      ]);

      setStats({
        activeVisitors: visitorsResult.count || 0,
        recentConversions: conversionsResult.count || 0,
        lastUpdate: new Date()
      });
    };

    fetchActiveData();
    const interval = setInterval(fetchActiveData, 30000);

    const conversionsChannel = supabase
      .channel('conversions-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversions'
        },
        (payload) => {
          setStats(prev => ({
            ...prev,
            recentConversions: prev.recentConversions + 1,
            lastUpdate: new Date()
          }));
        }
      )
      .subscribe();

    const visitorsChannel = supabase
      .channel('visitors-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'visitors'
        },
        (payload) => {
          setStats(prev => ({
            ...prev,
            activeVisitors: prev.activeVisitors + 1,
            lastUpdate: new Date()
          }));
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(conversionsChannel);
      supabase.removeChannel(visitorsChannel);
    };
  }, [companyId]);

  return stats;
};
