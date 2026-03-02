import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/tracking-api/visitor' && req.method === 'POST') {
      const body = await req.json();
      const { tracking_code, session_id, user_agent, device_type, screen_resolution, referrer } = body;

      const { data: page } = await supabase
        .from('landing_pages')
        .select('id')
        .eq('tracking_code', tracking_code)
        .eq('status', 'active')
        .maybeSingle();

      if (!page) {
        return new Response(
          JSON.stringify({ error: 'Invalid tracking code' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: visitor, error } = await supabase
        .from('visitors')
        .insert({
          landing_page_id: page.id,
          session_id,
          user_agent,
          device_type,
          screen_resolution,
          referrer,
        })
        .select()
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({ visitor_id: visitor.id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (path === '/tracking-api/event' && req.method === 'POST') {
      const body = await req.json();
      const { visitor_id, event_type, event_data, coordinates, element_selector, section } = body;

      const { error } = await supabase
        .from('behavior_events')
        .insert({
          visitor_id,
          event_type,
          event_data: event_data || {},
          coordinates,
          element_selector,
          section,
        });

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (path === '/tracking-api/convert' && req.method === 'POST') {
      const body = await req.json();
      const { visitor_id, tracking_code, form_data, behavior_summary } = body;

      const { data: visitor } = await supabase
        .from('visitors')
        .select('landing_page_id, landing_pages(company_id, companies(webhook_url))')
        .eq('id', visitor_id)
        .maybeSingle();

      if (!visitor) {
        return new Response(
          JSON.stringify({ error: 'Visitor not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: conversion, error } = await supabase
        .from('conversions')
        .insert({
          visitor_id,
          landing_page_id: visitor.landing_page_id,
          form_data,
          behavior_summary,
          engagement_score: behavior_summary.engagement_score || 0,
          time_to_convert: behavior_summary.time_to_convert || 0,
          webhook_sent: false,
        })
        .select()
        .single();

      if (error) throw error;

      const webhookUrl = (visitor.landing_pages as any)?.companies?.webhook_url;
      const companyId = (visitor.landing_pages as any)?.company_id;

      if (webhookUrl && companyId) {
        const webhookPayload = {
          conversion_data: form_data,
          behavior_analytics: behavior_summary,
        };

        try {
          const webhookResponse = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webhookPayload),
          });

          const responseBody = await webhookResponse.text();

          await supabase.from('webhook_logs').insert({
            company_id: companyId,
            conversion_id: conversion.id,
            webhook_url: webhookUrl,
            payload: webhookPayload,
            response_status: webhookResponse.status,
            response_body: responseBody.substring(0, 1000),
          });

          await supabase
            .from('conversions')
            .update({ webhook_sent: true, webhook_response: { status: webhookResponse.status } })
            .eq('id', conversion.id);
        } catch (webhookError: any) {
          await supabase.from('webhook_logs').insert({
            company_id: companyId,
            conversion_id: conversion.id,
            webhook_url: webhookUrl,
            payload: webhookPayload,
            error_message: webhookError.message,
          });
        }
      }

      return new Response(
        JSON.stringify({ success: true, conversion_id: conversion.id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});