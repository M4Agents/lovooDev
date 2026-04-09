// =============================================================================
// POST /api/chat/set-ai-state
//
// Altera o estado da IA (ai_state) em uma conversa.
// Requer: caller autenticado, membro ativo da empresa, conversa pertence à empresa.
//
// TRANSIÇÕES PERMITIDAS:
//   ai_inactive → ai_active
//   ai_active   → ai_paused
//   ai_paused   → ai_active
//
// MULTI-TENANT: company_id validado em todas as queries. Nunca confia no frontend.
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = 'https://etzdsywunlpbgxkphuil.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Matriz de transições permitidas
const ALLOWED_TRANSITIONS = {
  ai_inactive: ['ai_active'],
  ai_active:   ['ai_paused'],
  ai_paused:   ['ai_active']
};

const VALID_STATES = ['ai_inactive', 'ai_active', 'ai_paused'];

// ── Validação de caller (JWT + membership) ────────────────────────────────────

async function validateCaller(req, companyId) {
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const authHeader = req.headers?.authorization;

  if (!authHeader || !String(authHeader).startsWith('Bearer ') || !anonKey) {
    return { ok: false, status: 401, error: 'Autenticação necessária' };
  }

  const callerClient = createClient(SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: String(authHeader) } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) {
    return { ok: false, status: 401, error: 'Sessão inválida ou expirada' };
  }

  // Verificar membership ativa na empresa
  const { data: membership } = await callerClient
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();

  if (!membership) {
    return { ok: false, status: 403, error: 'Acesso negado à empresa' };
  }

  return { ok: true, callerId: user.id };
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use POST.' });
  }

  if (!SERVICE_ROLE_KEY) {
    return res.status(500).json({ success: false, error: 'Configuração interna inválida.' });
  }

  const { conversation_id, company_id, new_state } = req.body ?? {};

  // ── Validação de entrada ───────────────────────────────────────────────────

  if (!conversation_id || !company_id || !new_state) {
    return res.status(400).json({
      success: false,
      error: 'conversation_id, company_id e new_state são obrigatórios.'
    });
  }

  if (!VALID_STATES.includes(new_state)) {
    return res.status(400).json({
      success: false,
      error: `Estado inválido: ${new_state}. Permitidos: ${VALID_STATES.join(', ')}.`
    });
  }

  // ── Validação de autenticação e membership ────────────────────────────────

  const auth = await validateCaller(req, company_id);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.error });
  }

  // ── Buscar conversa atual (multi-tenant) ───────────────────────────────────

  const { data: conversation, error: convErr } = await supabaseAdmin
    .from('chat_conversations')
    .select('id, ai_state, company_id')
    .eq('id', conversation_id)
    .eq('company_id', company_id)
    .maybeSingle();

  if (convErr || !conversation) {
    return res.status(404).json({
      success: false,
      error: 'Conversa não encontrada ou não pertence a esta empresa.'
    });
  }

  const currentState = conversation.ai_state ?? 'ai_inactive';

  // ── Validar transição de estado ────────────────────────────────────────────

  const allowedNext = ALLOWED_TRANSITIONS[currentState] ?? [];

  if (!allowedNext.includes(new_state)) {
    return res.status(400).json({
      success: false,
      error: `Transição inválida: ${currentState} → ${new_state}. Permitido a partir de "${currentState}": ${allowedNext.join(', ') || 'nenhuma'}.`
    });
  }

  // ── Aplicar UPDATE ─────────────────────────────────────────────────────────

  const { error: updateErr } = await supabaseAdmin
    .from('chat_conversations')
    .update({ ai_state: new_state, updated_at: new Date().toISOString() })
    .eq('id', conversation_id)
    .eq('company_id', company_id);

  if (updateErr) {
    console.error('[set-ai-state] Erro ao atualizar ai_state:', updateErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao salvar alteração.' });
  }

  console.log('[set-ai-state] ai_state atualizado:', {
    conversation_id,
    company_id,
    from: currentState,
    to:   new_state,
    by:   auth.callerId
  });

  return res.status(200).json({
    success:  true,
    ai_state: new_state,
    previous: currentState
  });
}
