export const runtime = 'nodejs';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzA0NzU1NjQsImV4cCI6MjA0NjA1MTU2NH0.YSzqmkJjmBnWIDGJJoJBKvvOb5eCcNzaEzpvQSKhCNs';

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    
    const eventType = payload.EventType;
    const message = payload.message;
    
    if (eventType !== 'messages' || !message) {
      return new Response('ok', { status: 200 });
    }

    if (message.fromMe || message.wasSentByApi || message.isGroup) {
      return new Response('ok', { status: 200 });
    }

    const messageType = message.messageType?.toLowerCase();
    if (!['conversation', 'extendedtextmessage'].includes(messageType)) {
      return new Response('ok', { status: 200 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { data, error } = await supabase.rpc('process_uazapi_webhook_real', {
      p_payload: payload
    });

    if (error) {
      console.error('Supabase RPC error:', error);
    }

    return new Response('ok', { status: 200 });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('ok', { status: 200 });
  }
}
