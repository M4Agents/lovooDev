/**
 * Após um envio bem-sucedido, o chat passa a existir no cache da uazapi
 * e /chat/details costuma devolver wa_name / name. Atualiza lead e conversa
 * somente se o nome atual ainda for placeholder.
 *
 * Nunca loga nome, telefone ou token. Falha nunca impede o envio.
 */

import { getSupabaseAdmin } from '../automation/supabaseAdmin.js';
import {
  isPlaceholderName,
  fetchContactNameFromChatDetails,
} from './contactNameResolver.js';

function phoneLookupValues(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return [];
  return [...new Set([digits, digits.slice(-11)])];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function refreshPlaceholderLeadNameAfterSend({
  companyId,
  phone,
  token,
  baseUrl,
  seenContactName,
  messageId,
}) {
  if (!companyId || !phone || !token) return { updated: false, reason: 'params' };
  if (seenContactName && !isPlaceholderName(seenContactName)) {
    return { updated: false, reason: 'nome_ja_real' };
  }

  // O chat só é gravado no servidor depois do send — espera + 1 retry.
  await sleep(600);
  let resolved = await fetchContactNameFromChatDetails({
    token,
    phoneNumber: phone,
    baseUrl,
  });
  if (!resolved) {
    await sleep(800);
    resolved = await fetchContactNameFromChatDetails({
      token,
      phoneNumber: phone,
      baseUrl,
    });
  }
  if (!resolved) return { updated: false, reason: 'sem_nome' };

  const lookup = phoneLookupValues(phone);
  if (lookup.length === 0) return { updated: false, reason: 'phone' };

  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data: lead } = await admin
    .from('leads')
    .select('id, name')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .in('phone_normalized', lookup)
    .limit(1)
    .maybeSingle();

  if (!lead?.id) return { updated: false, reason: 'lead_ausente' };
  if (!isPlaceholderName(lead.name)) return { updated: false, reason: 'lead_ja_real' };

  const { data: updated, error: leadError } = await admin
    .from('leads')
    .update({ name: resolved, updated_at: now })
    .eq('id', lead.id)
    .eq('company_id', companyId)
    .eq('name', lead.name)
    .select('id');

  if (leadError) {
    console.warn('[leadNameRefresh] falha ao atualizar lead:', leadError.message);
    return { updated: false, reason: 'lead_erro' };
  }

  if (messageId) {
    const { data: msg } = await admin
      .from('chat_messages')
      .select('conversation_id')
      .eq('id', messageId)
      .eq('company_id', companyId)
      .maybeSingle();

    if (msg?.conversation_id) {
      await admin
        .from('chat_conversations')
        .update({ contact_name: resolved, updated_at: now })
        .eq('id', msg.conversation_id)
        .eq('company_id', companyId);
    }
  }

  await admin
    .from('chat_contacts')
    .update({ name: resolved, updated_at: now })
    .eq('company_id', companyId)
    .in('phone_number', lookup);

  const applied = Boolean(updated?.length);
  console.log('[leadNameRefresh]', applied ? 'nome do lead corrigido apos envio' : 'atualizacao condicional nao aplicada');
  return { updated: applied, reason: applied ? 'ok' : 'zero_rows' };
}
