// =====================================================
// UAZAPI REPORT RESTRICTION — ENDPOINT BACKEND
// =====================================================
// Recebe notificação do frontend quando detecta erro
// WHATSAPP_REACHOUT_TIMELOCK durante envio de mensagem.
//
// O frontend NÃO grava diretamente em whatsapp_life_instances.
// Toda gravação ocorre aqui, no backend, com validação completa:
//   - auth.uid() via JWT
//   - company_id via membership (company_users)
//   - instance_id pertencente à company
//
// Regras:
//   - Não usa service_role sem validação de membership
//   - Não atualiza instância sem company_id
//   - Não altera RLS nem policies
// =====================================================

import { createClient } from '@supabase/supabase-js';
import { isRestrictionError, recordRestriction } from './lib/uazapi/restrictions.js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  // =====================================================
  // VALIDAÇÃO DE AUTENTICAÇÃO
  // =====================================================
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Token de autenticação ausente.' });
  }

  const userToken = authHeader.replace('Bearer ', '');

  // Validar token via Supabase (não service_role — usa o JWT do usuário)
  const supabaseUser = createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${userToken}` } }
  });

  const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !user) {
    return res.status(401).json({ success: false, error: 'Sessão inválida.' });
  }

  // =====================================================
  // VALIDAÇÃO DO BODY
  // =====================================================
  const { company_id, instance_id, error_payload } = req.body || {};

  if (!company_id) {
    return res.status(400).json({ success: false, error: 'company_id obrigatório.' });
  }
  if (!instance_id) {
    return res.status(400).json({ success: false, error: 'instance_id obrigatório.' });
  }
  if (!isRestrictionError(error_payload)) {
    return res.status(400).json({ success: false, error: 'error_payload não representa uma restrição conhecida.' });
  }

  // =====================================================
  // VALIDAÇÃO DE MEMBERSHIP (multi-tenant)
  // Confirmar que o usuário autenticado pertence à empresa
  // =====================================================
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  const { data: membership, error: memberError } = await supabaseAdmin
    .from('company_users')
    .select('user_id')
    .eq('company_id', company_id)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (memberError || !membership) {
    console.error('[report-restriction] Usuário sem membership na empresa:', { userId: user.id, company_id });
    return res.status(403).json({ success: false, error: 'Acesso negado a esta empresa.' });
  }

  // =====================================================
  // VALIDAÇÃO DA INSTÂNCIA
  // Confirmar que a instância pertence à empresa
  // =====================================================
  const { data: instance, error: instError } = await supabaseAdmin
    .from('whatsapp_life_instances')
    .select('id')
    .eq('id', instance_id)
    .eq('company_id', company_id)
    .is('deleted_at', null)
    .maybeSingle();

  if (instError || !instance) {
    console.error('[report-restriction] Instância não encontrada ou não pertence à empresa:', { instance_id, company_id });
    return res.status(404).json({ success: false, error: 'Instância não encontrada.' });
  }

  // =====================================================
  // REGISTRO DA RESTRIÇÃO
  // =====================================================
  await recordRestriction(supabaseAdmin, {
    companyId:    company_id,
    instanceId:   instance_id,
    errorPayload: error_payload,
  });

  return res.status(200).json({
    success: true,
    message: 'Restrição registrada com sucesso.',
    restriction_key: error_payload?.error_key,
  });
}
