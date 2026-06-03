// =====================================================
// UAZAPI RESTRICTIONS HELPER
// =====================================================
// Detecta e registra restrições de envio impostas pelo WhatsApp
// via Uazapi (ex: WHATSAPP_REACHOUT_TIMELOCK, error 463).
//
// Regras obrigatórias:
//   - company_id sempre exigido (isolamento multi-tenant)
//   - Atualização sempre por id + company_id OU provider_token + company_id
//   - Nunca usar service_role no frontend
//   - Não altera RLS, policies ou fluxo de envio
//   - Não redefine restriction_since se já estiver registrada (preserva primeira detecção)
// =====================================================

/** Conjunto de error_key conhecidos que representam restrição de envio WhatsApp */
const RESTRICTION_KEYS = new Set([
  'WHATSAPP_REACHOUT_TIMELOCK',
]);

/**
 * Parser defensivo para a resposta do endpoint /instance/wa_messages_limits.
 *
 * Retorna objeto estruturado com três estados possíveis:
 *
 *   known=true,  hasRestriction=true  → restrição confirmada (registrar)
 *   known=true,  hasRestriction=false → sem restrição confirmada (limpar)
 *   known=false, hasRestriction=false → schema desconhecido (não alterar restriction_key)
 *
 * Indicadores de RESTRIÇÃO verificados (ordem de prioridade):
 *   1. payload.error_key ∈ RESTRICTION_KEYS
 *   2. payload.restricted === true
 *   3. payload.timelock === true
 *   4. payload.is_restricted === true
 *   5. payload.status === 'restricted'
 *
 * Indicadores de RESPOSTA CONHECIDA SEM RESTRIÇÃO:
 *   - payload é objeto com campos reconhecíveis (tier, current, limit, quality_rating,
 *     restricted === false, is_restricted === false, status === 'ok' / 'active')
 *
 * @param {*} payload - Resposta JSON bruta do endpoint (qualquer formato)
 * @returns {{ hasRestriction: boolean, known: boolean, key: string|null, payload: any }}
 */
export function parseMessagesLimits(payload) {
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { hasRestriction: false, known: false, key: null, payload };
    }

    // ── Indicadores de RESTRIÇÃO ATIVA ─────────────────────────────────────

    // 1. error_key explícito (mesmo padrão do erro de envio)
    if (RESTRICTION_KEYS.has(payload.error_key)) {
      return { hasRestriction: true, known: true, key: payload.error_key, payload };
    }

    // 2-5. Campos booleanos/string alternativos
    if (
      payload.restricted    === true ||
      payload.timelock      === true ||
      payload.is_restricted === true ||
      payload.status        === 'restricted'
    ) {
      const key =
        payload.restriction_type ||
        payload.error_key ||
        'WHATSAPP_REACHOUT_TIMELOCK';
      return { hasRestriction: true, known: true, key, payload };
    }

    // ── Indicadores de RESPOSTA CONHECIDA SEM RESTRIÇÃO ────────────────────
    // O endpoint retornou campos reconhecíveis e nenhum indica restrição.
    // Pode limpar com segurança.
    const knownNoRestrictionFields = [
      'tier', 'current', 'limit', 'quality_rating', 'messaging_limit_tier',
    ];
    const hasKnownField =
      knownNoRestrictionFields.some(f => f in payload) ||
      payload.restricted    === false ||
      payload.is_restricted === false ||
      payload.status === 'ok' ||
      payload.status === 'active';

    if (hasKnownField) {
      return { hasRestriction: false, known: true, key: null, payload };
    }

    // ── Schema desconhecido: não alterar restriction_key ───────────────────
    return { hasRestriction: false, known: false, key: null, payload };

  } catch {
    return { hasRestriction: false, known: false, key: null, payload: null };
  }
}

/**
 * Limpa os campos de restrição de uma instância quando o polling
 * confirma que não há restrição ativa.
 *
 * @param {Object} supabase   - Cliente Supabase (service_role)
 * @param {string} instanceId - UUID da instância
 * @param {string} companyId  - company_id (obrigatório)
 * @param {string} now        - ISO timestamp atual
 */
export async function clearRestriction(supabase, instanceId, companyId, now) {
  if (!companyId || !instanceId) return;

  const { error } = await supabase
    .from('whatsapp_life_instances')
    .update({
      restriction_key:         null,
      restriction_since:       null,
      restriction_payload:     null,
      restriction_checked_at:  now,
      updated_at:              now,
    })
    .eq('id', instanceId)
    .eq('company_id', companyId);

  if (error) {
    console.error('[restrictions] Erro ao limpar restrição:', error.message);
  }
}

/**
 * Verifica defensivamente se o payload de erro da Uazapi representa
 * uma restrição de envio conhecida.
 *
 * @param {*} errorPayload - Resposta JSON da Uazapi (qualquer formato)
 * @returns {boolean}
 */
export function isRestrictionError(errorPayload) {
  if (!errorPayload || typeof errorPayload !== 'object') return false;
  return RESTRICTION_KEYS.has(errorPayload.error_key);
}

/**
 * Registra a restrição de envio na instância correspondente
 * em whatsapp_life_instances.
 *
 * Comportamento:
 *   - Se restriction_key for null (primeira detecção): grava todos os campos
 *     incluindo restriction_since = agora.
 *   - Se restriction_key já existir: atualiza apenas restriction_checked_at
 *     e restriction_payload, preservando restriction_since original.
 *
 * @param {Object} supabase       - Cliente Supabase (service_role para backends)
 * @param {Object} params
 * @param {string}  params.companyId      - Obrigatório: company_id da instância
 * @param {string} [params.instanceId]    - UUID da instância (preferido)
 * @param {string} [params.providerToken] - Token do provider (fallback se instanceId indisponível)
 * @param {Object}  params.errorPayload   - Payload completo de erro retornado pela Uazapi
 */
export async function recordRestriction(supabase, { companyId, instanceId, providerToken, errorPayload }) {
  // Validação defensiva: campos obrigatórios
  if (!companyId) {
    console.error('[restrictions] company_id obrigatório para registrar restrição. Operação cancelada.');
    return;
  }
  if (!instanceId && !providerToken) {
    console.error('[restrictions] instanceId ou providerToken obrigatório. Operação cancelada.');
    return;
  }

  const restrictionKey = errorPayload?.error_key || 'WHATSAPP_REACHOUT_TIMELOCK';
  const now = new Date().toISOString();

  // Filtro base comum a ambos os updates
  function baseFilter(query) {
    const q = query.eq('company_id', companyId);
    return instanceId ? q.eq('id', instanceId) : q.eq('provider_token', providerToken);
  }

  // Step 1: Primeira detecção — só grava se restriction_key ainda é NULL
  const { error: firstErr } = await baseFilter(
    supabase.from('whatsapp_life_instances').update({
      restriction_key:         restrictionKey,
      restriction_since:       now,
      restriction_checked_at:  now,
      restriction_payload:     errorPayload || null,
      updated_at:              now,
    }).is('restriction_key', null)
  );

  if (firstErr) {
    console.error('[restrictions] Erro ao registrar restrição (primeira detecção):', firstErr.message);
  }

  // Step 2: Detecções subsequentes — atualiza apenas checked_at e payload,
  //         preservando restriction_since da primeira detecção
  const { error: subseqErr } = await baseFilter(
    supabase.from('whatsapp_life_instances').update({
      restriction_checked_at: now,
      restriction_payload:    errorPayload || null,
      updated_at:             now,
    }).not('restriction_key', 'is', null)
  );

  if (subseqErr) {
    console.error('[restrictions] Erro ao atualizar restrição (detecção subsequente):', subseqErr.message);
  }

  console.error('[restrictions] ⚠️ Restrição WhatsApp registrada:', {
    companyId,
    instanceId: instanceId || '(via provider_token)',
    restrictionKey,
  });
}
