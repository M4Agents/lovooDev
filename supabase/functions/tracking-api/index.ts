import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

const LP_NOT_FOUND_CODES = new Set([
  'INVALID_TRACKING_CODE',
  'LANDING_PAGE_NOT_FOUND',
  'LANDING_PAGE_INACTIVE',
]);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/tracking-api/visitor' && req.method === 'POST') {
      return await handleTrackingVisit(req);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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
        { headers: jsonHeaders }
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
          { status: 404, headers: jsonHeaders }
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
        { headers: jsonHeaders }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: jsonHeaders }
    );
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: jsonHeaders }
    );
  }
});

async function handleTrackingVisit(req: Request): Promise<Response> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey =
      Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('VITE_SUPABASE_ANON_KEY');

    if (!supabaseUrl || !anonKey) {
      console.error('[tracking-api/visitor] Missing anon credentials');
      return new Response(
        JSON.stringify({ error: 'Tracking visit failed' }),
        { status: 500, headers: jsonHeaders }
      );
    }

    const body = await req.json();
    const {
      tracking_code,
      visitor_id,
      session_id,
      user_agent,
      device_type,
      screen_resolution,
      referrer,
      timezone,
      language,
    } = body || {};

    if (!tracking_code) {
      return new Response(
        JSON.stringify({ error: 'Invalid tracking code' }),
        { status: 404, headers: jsonHeaders }
      );
    }

    const supabaseAnon = createClient(supabaseUrl, anonKey);

    const payload = {
      p_tracking_code: tracking_code,
      p_persistent_visitor_id: isValidUUID(visitor_id) ? visitor_id : generateUUID(),
      p_session_id: isValidUUID(session_id) ? session_id : generateUUID(),
      p_user_agent: user_agent ?? null,
      p_device_type: normalizeDeviceType(device_type),
      p_screen_resolution: screen_resolution ?? null,
      p_referrer: referrer ?? null,
      p_timezone: timezone ?? null,
      p_language: language ?? null,
    };

    const { data, error } = await supabaseAnon.rpc('public_create_tracking_visit', payload);

    if (error) {
      console.error('[tracking-api/visitor] RPC client error');
      return new Response(
        JSON.stringify({ error: 'Tracking visit failed' }),
        { status: 500, headers: jsonHeaders }
      );
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (result?.success === true && result.visit_id) {
      console.log('[tracking-api/visitor] Visit created:', result.visit_id);
      return new Response(
        JSON.stringify({ visitor_id: result.visit_id }),
        { headers: jsonHeaders }
      );
    }

    const errorCode =
      typeof result?.error_code === 'string' && result.error_code
        ? result.error_code
        : 'TRACKING_VISIT_FAILED';

    console.error('[tracking-api/visitor] Visit failed:', errorCode);

    if (LP_NOT_FOUND_CODES.has(errorCode)) {
      return new Response(
        JSON.stringify({ error: 'Invalid tracking code' }),
        { status: 404, headers: jsonHeaders }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Tracking visit failed' }),
      { status: 500, headers: jsonHeaders }
    );
  } catch (error) {
    console.error('[tracking-api/visitor] Exception:', sanitizeError(error));
    return new Response(
      JSON.stringify({ error: 'Tracking visit failed' }),
      { status: 500, headers: jsonHeaders }
    );
  }
}

function normalizeDeviceType(value: unknown): string | null {
  if (value === 'desktop' || value === 'mobile' || value === 'tablet') {
    return value;
  }
  return null;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isValidUUID(str: unknown): str is string {
  if (typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    str
  );
}

function sanitizeError(error: unknown): string {
  if (!error) return 'unknown';
  if (typeof error === 'string') return error.slice(0, 200);
  if (error instanceof Error) return (error.message || 'Error').slice(0, 200);
  return 'unknown';
}
