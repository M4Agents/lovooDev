// =============================================================================
// GET|POST /api/whatsapp/meta/webhook
//
// GET  → Verificação do challenge Meta (setup do webhook no App Dashboard)
// POST → Recebimento de eventos: statuses[] outbound (MVP2) + messages[] inbound TEXT (MVP3A)
//
// Segurança:
//   - GET: timing-safe comparison do verify token (nunca logar)
//   - POST: HMAC SHA-256 validado ANTES de qualquer processamento (fail-closed)
//   - JSON.parse SOMENTE após HMAC válido
//   - getSupabaseAdmin() SOMENTE após HMAC válido
//   - company_id/instance_id NUNCA extraídos do payload — resolvidos via DB
//   - phone_number_id é o único identificador externo aceito para tenant resolution
//
// Idempotência:
//   - statuses[]: state machine explícita (TRANSITION_MATRIX) com NOOP
//   - messages[]: RPC process_meta_inbound_message — UNIQUE (instance_id, wamid)
//   - Retry Meta em 5xx é seguro: ambos os ramos são idempotentes
//
// Ramos INDEPENDENTES por value:
//   - statuses[] e messages[] processados em paralelo (sem else/continue entre eles)
//   - Um mesmo value pode conter ambos — ambos são processados
//   - Tenant resolution compartilhada (uma query por value)
//
// MVP3A escopo (messages[]):
//   - Somente type='text' persistido
//   - Grupos (message.group_id presente) ignorados silenciosamente
//   - played ignorado silenciosamente
//
// Decisão UNKNOWN_WAMID (B1):
//   - Meta retenta não-200 por até 7 dias (documentado oficialmente)
//   - Wamids não encontrados são mais provavelmente de mensagens externas ao Lovoo
//   - Retornar 200 + log seguro evita retry storm de 7 dias
// =============================================================================

import { timingSafeEqual } from 'crypto';
import { getSupabaseAdmin }            from '../../lib/automation/supabaseAdmin.js';
import {
  readRawBody,
  verifyMetaWebhookSignature,
}                                      from '../../lib/meta-whatsapp/verifyWebhookSignature.js';
import {
  getMetaServerConfig,
  getMetaWebhookConfig,
}                                      from '../../lib/meta-whatsapp/config.js';
import { decryptMetaToken }            from '../../lib/meta-whatsapp/tokenCrypto.js';
import { downloadAndStoreInboundMedia } from '../../lib/meta-whatsapp/inboundMediaProcessor.js';

// CRÍTICO: desabilitar body parser do Vercel — obrigatório para HMAC validation.
// Qualquer re-serialização do body invalida a assinatura.
export const config = { api: { bodyParser: false } };

// Statuses outbound suportados nesta fase (MVP2 2C.4).
// 'played' não está incluído — ignorado silenciosamente.
const SUPPORTED_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

// Limite MVP conservador para documentos inbound (INBOUND-DOC-C2).
// INTENCIONALMENTE 5 MB — não altera MEDIA_SIZE_LIMITS global (infra suporta 30 MB).
// Justificativa:
//   - PDFs de negócio comuns: < 2 MB.
//   - Mantém download + Storage + RPC dentro de maxDuration: 30 s com folga.
//   - Pressão de memória Vercel: ~2–3× tamanho → ~15 MB pico com 5 MB PDF (seguro).
//   - Revisável em C3 após validação E2E e decisão operacional.
const MAX_INBOUND_DOCUMENT_BYTES = 5 * 1024 * 1024; // 5 MB

// =============================================================================
// State machine — matriz de transições explícita
//
// Linha  = status ATUAL  na tabela meta_whatsapp_messages
// Coluna = status NOVO   recebido do webhook
//
// true  → APPLY: executar UPDATE no banco
// false → NOOP:  ignorar (duplicata ou regressão não permitida)
//
// Regras aplicadas:
//   accepted → qualquer → APPLY (primeira notificação)
//   sent     → delivered/read/failed → APPLY (progressão)
//   sent     → sent → NOOP (duplicata)
//   delivered → read → APPLY (única progressão possível)
//   delivered → failed → NOOP (S7 Meta: delivered = entregue em pelo menos 1 device)
//   read     → qualquer → NOOP (estado máximo de progressão)
//   failed   → qualquer → NOOP (terminal)
// =============================================================================
const TRANSITION_MATRIX = {
  accepted:  { sent: true,  delivered: true,  read: true,  failed: true  },
  sent:      { sent: false, delivered: true,  read: true,  failed: true  },
  delivered: { sent: false, delivered: false, read: true,  failed: false },
  read:      { sent: false, delivered: false, read: false, failed: false },
  failed:    { sent: false, delivered: false, read: false, failed: false },
};

// =============================================================================
// Handler principal
// =============================================================================

export default async function handler(req, res) {
  if (req.method === 'GET')  return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

// =============================================================================
// GET — Challenge verification
// =============================================================================

function handleGet(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Fail-closed: se ENV ausente, retornar 403 sem expor motivo
  let verifyToken;
  try {
    ({ verifyToken } = getMetaWebhookConfig());
  } catch {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (mode !== 'subscribe') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Timing-safe comparison — comprimentos diferentes → false (nunca chega ao timingSafeEqual)
  // Nunca logar o token fornecido nem o token esperado
  const provided = typeof token === 'string' ? token : '';
  if (!timingSafeTokenEqual(provided, verifyToken)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Retornar challenge como string — formato exigido pela Meta
  return res.status(200).send(challenge);
}

/**
 * Comparação timing-safe de dois tokens.
 * Comprimentos diferentes → false imediato (sem execução de timingSafeEqual).
 * Tokens vazios → false (token vazio não é válido).
 * Nunca lança exceção — fail-closed.
 *
 * @param {string} a — token fornecido pelo solicitante
 * @param {string} b — token esperado (do ENV)
 * @returns {boolean}
 */
function timingSafeTokenEqual(a, b) {
  try {
    const aBuf = Buffer.from(a, 'utf8');
    const bBuf = Buffer.from(b, 'utf8');
    // Token vazio nunca é válido
    if (aBuf.length === 0) return false;
    // Comprimentos diferentes → false (sem timing leak)
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

// =============================================================================
// POST — Webhook event processing
// =============================================================================

async function handlePost(req, res) {
  // ── 1. Ler raw body com limite (1 MB) — antes de QUALQUER processamento ───
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    if (err?.code === 'body_too_large') {
      return res.status(413).json({ error: 'Payload too large' });
    }
    return res.status(500).json({ error: 'Body read error' });
  }

  // ── 2. Obter appSecret — fail-closed sem ENV ──────────────────────────────
  let appSecret;
  try {
    ({ appSecret } = getMetaServerConfig());
  } catch {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // ── 3. Validar HMAC — ZERO DB antes deste ponto ───────────────────────────
  // Nunca logar signature, appSecret ou rawBody
  const signature = req.headers['x-hub-signature-256'] ?? '';
  if (!verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // ── 4. Parse JSON — somente após HMAC válido ──────────────────────────────
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  // ── 5. Validar objeto raiz — skip silencioso se não for WhatsApp ──────────
  if (payload.object !== 'whatsapp_business_account') {
    return res.status(200).json({ received: true });
  }

  // ── 6. Inicializar Supabase — somente após HMAC válido ───────────────────
  const svc = getSupabaseAdmin();

  // ── 7. Iterar defensivamente sobre entries e changes ─────────────────────
  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  // Marcador de falha transiente para batch safety (INBOUND-DOC-C2).
  // Erros transientes de DOCUMENT marcam este flag e continuam processando
  // demais eventos do payload, em vez de retornar 500 imediatamente.
  // Meta reenvia o payload inteiro em caso de 500 — por isso todos os ramos
  // são idempotentes (TEXT via RPC, DOCUMENT via source_ref + ON CONFLICT,
  // statuses via TRANSITION_MATRIX).
  let hasTransientFailure = false;

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const change of changes) {
      // Somente campo 'messages' nesta fase
      if (change.field !== 'messages') continue;

      const value    = change.value ?? {};
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];

      // Nada a processar neste change — pular sem DB access
      if (statuses.length === 0 && messages.length === 0) continue;

      // ── 8. Tenant resolution (compartilhada entre statuses[] e messages[]) ──
      // phone_number_id é o único identificador externo aceito
      // company_id/instance_id NUNCA extraídos do payload
      const phoneNumberId = value.metadata?.phone_number_id;
      if (typeof phoneNumberId !== 'string' || phoneNumberId.length === 0) continue;

      // access_token_enc: somente server-side; nunca logar, nunca retornar,
      // nunca incluir em erro. Decrypt lazy — somente no ramo DOCUMENT.
      const { data: instance, error: instErr } = await svc
        .from('meta_whatsapp_instances')
        .select('id, company_id, access_token_enc')
        .eq('phone_number_id', phoneNumberId)
        .is('deleted_at', null)
        .maybeSingle();

      if (instErr) {
        // Erro de DB real — retornar 500 para retry Meta
        console.error('[meta/webhook] instance_lookup_failed db_error=true');
        return res.status(500).json({ error: 'Internal error' });
      }

      if (!instance) {
        // phone_number_id desconhecido — instância removida/inexistente
        console.log('[meta/webhook] event_type=instance instance_resolved=false');
        continue;
      }

      // ── 9. Ramo A — statuses[] outbound (MVP2 — comportamento intacto) ────
      for (const statusItem of statuses) {
        const wamid     = statusItem.id;
        const newStatus = statusItem.status;

        // Validar wamid
        if (typeof wamid !== 'string' || wamid.length === 0) continue;

        // Ignorar statuses fora do escopo (played, outros)
        if (!SUPPORTED_STATUSES.has(newStatus)) continue;

        const effectiveTimestamp = parseMetaTimestamp(statusItem.timestamp);

        // ── 10. SELECT row atual (read-before-update) ──────────────────────
        // Correlação: (instance_id, meta_message_id) — nunca apenas por wamid
        const { data: row, error: selectErr } = await svc
          .from('meta_whatsapp_messages')
          .select('id, status')
          .eq('instance_id', instance.id)
          .eq('meta_message_id', wamid)
          .maybeSingle();

        if (selectErr) {
          console.error('[meta/webhook] select_failed db_error=true');
          return res.status(500).json({ error: 'Internal error' });
        }

        if (!row) {
          // Unknown wamid — decisão B1: 200 + log seguro, continuar batch
          // Não logar wamid completo nem phone_number_id
          console.log('[meta/webhook] event_type=status instance_resolved=true wamid_found=false');
          continue;
        }

        // ── 11. Consultar state machine ────────────────────────────────────
        if (!shouldApply(row.status, newStatus)) {
          // NOOP: duplicata ou regressão não permitida
          console.log('[meta/webhook] event_type=status transition_blocked=true status=%s', newStatus);
          continue;
        }

        // ── 12. Executar UPDATE ────────────────────────────────────────────
        const updatePayload = buildUpdatePayload(newStatus, effectiveTimestamp, statusItem);

        const { error: updateErr } = await svc
          .from('meta_whatsapp_messages')
          .update(updatePayload)
          .eq('id', row.id);

        if (updateErr) {
          console.error('[meta/webhook] update_failed db_error=true');
          return res.status(500).json({ error: 'Internal error' });
        }

        console.log('[meta/webhook] event_type=status status=%s transition_applied=true', newStatus);
      }

      // ── 13. Ramo B — messages[] inbound TEXT (MVP3A) ──────────────────────
      // INDEPENDENTE do ramo A: executado sempre que messages.length > 0,
      // independentemente de statuses[] estar presente ou não.
      // Contacts extraídos uma vez por value para lookup eficiente por wa_id.
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];

      for (const message of messages) {

        // B.1 Grupos — ignorar silenciosamente (MVP3A não suporta grupos)
        if (message.group_id != null) {
          console.log('[meta/webhook] event_type=inbound_message group_skipped=true');
          continue;
        }

        // B.2 Campos mínimos obrigatórios
        if (typeof message.id !== 'string' || message.id.length === 0) {
          console.log('[meta/webhook] event_type=inbound_message missing_field=message_id');
          continue;
        }
        if (typeof message.from !== 'string' || message.from.length === 0) {
          console.log('[meta/webhook] event_type=inbound_message missing_field=from');
          continue;
        }

        // B.3 Contact name — lookup compartilhado (pure, sem side effects).
        // Extraído antes do ramo de tipo para reutilização em TEXT e DOCUMENT.
        // contacts[] é opcional no payload Meta; contact_name = null é válido.
        // Nunca logar: message.from, wa_id, contact_name, body.
        const matchedContact = contacts.find(c => c.wa_id === message.from);
        const contactName =
          typeof matchedContact?.profile?.name === 'string' &&
          matchedContact.profile.name.trim().length > 0
            ? matchedContact.profile.name
            : null;

        // B.4 Timestamp — Unix epoch string → ISO 8601 (reutiliza parseMetaTimestamp).
        // null se ausente/inválido — RPCs possuem regra operacional para timestamp null.
        const providerTimestamp = parseMetaTimestamp(message.timestamp);

        // B.5 Ramo por tipo de mensagem —————————————————————————————————————

        if (message.type === 'text') {
          // ── B.5.1 TEXT (MVP3A — comportamento intacto) ───────────────────

          // Body obrigatório para type=text (contrato Meta Cloud API)
          const body = message.text?.body;
          if (typeof body !== 'string' || body.trim().length === 0) {
            console.log('[meta/webhook] event_type=inbound_message invalid_body=true');
            continue;
          }

          // RPC de persistência atômica — idempotente por (instance_id, wamid)
          const { data: rpcData, error: rpcErr } = await svc.rpc(
            'process_meta_inbound_message',
            {
              p_company_id:         instance.company_id,
              p_instance_id:        instance.id,
              p_wa_id:              message.from,
              p_meta_message_id:    message.id,
              p_body:               body,
              p_contact_name:       contactName,
              p_provider_timestamp: providerTimestamp,
            },
          );

          if (rpcErr) {
            // Erro real de DB/RPC — retornar 500 para retry Meta
            // Duplicata (created=false) NÃO é erro — tratada abaixo
            console.error('[meta/webhook] event_type=inbound_message rpc_error=true');
            return res.status(500).json({ error: 'Internal error' });
          }

          const created = rpcData?.created === true;
          console.log('[meta/webhook] event_type=inbound_message created=%s', created);

        } else if (message.type === 'document') {
          // ── B.5.2 DOCUMENT inbound (INBOUND-DOC-C2) ──────────────────────

          // DOC.1 — Validar document.id (media_id para Graph API)
          // mime_type e sha256 do payload NÃO são usados como autoridade —
          // bytes reais determinam o MIME (inboundMediaProcessor / fileTypeFromBlob).
          const mediaId = message.document?.id;
          if (typeof mediaId !== 'string' || mediaId.trim().length === 0) {
            // Definitivo — payload inválido; retry da Meta não vai melhorar.
            console.log('[meta/webhook] event_type=inbound_document outcome=invalid_media_id');
            continue;
          }

          // DOC.2 — Early dedupe: verificar se wamid já foi persistido.
          // Executado ANTES de decrypt/Graph/Storage para economizar I/O em replays.
          // A RPC permanece a autoridade final contra race condition.
          const { data: existingMsg, error: dedupeErr } = await svc
            .from('meta_messages')
            .select('id')
            .eq('instance_id', instance.id)
            .eq('meta_message_id', message.id)
            .maybeSingle();

          if (dedupeErr) {
            // Erro de DB ao verificar dedupe — tratar como transiente.
            // Não assumir que a mensagem existe ou não existe.
            console.error('[meta/webhook] event_type=inbound_document outcome=dedupe_db_error');
            hasTransientFailure = true;
            continue;
          }

          if (existingMsg) {
            // Já persistido — skip sem nenhum I/O adicional.
            console.log('[meta/webhook] event_type=inbound_document outcome=already_persisted');
            continue;
          }

          // DOC.3 — Decrypt do token (lazy — somente se documento válido chegou até aqui)
          // access_token_enc: somente server-side. NUNCA logar ciphertext nem plainToken.
          let plainToken;
          try {
            if (!instance.access_token_enc) {
              throw new Error('missing_enc');
            }
            plainToken = decryptMetaToken(instance.access_token_enc);
          } catch {
            // Configuração operacional inválida — 200 skip para evitar retry storm de 7 dias.
            // Retry da Meta não resolve configuração ausente/corrompida.
            // NUNCA logar ciphertext, plainToken ou conteúdo do erro de decrypt.
            console.error('[meta/webhook] event_type=inbound_document outcome=credential_unavailable');
            continue;
          }

          // DOC.4 — Download + validação + persistência do asset (inboundMediaProcessor)
          // Responsabilidades internas: anti-SSRF, redirect controlado, MIME authority
          // via bytes, Storage, CML com source_ref idempotente.
          let mediaResult;
          try {
            mediaResult = await downloadAndStoreInboundMedia({
              svc,
              token:             plainToken,
              companyId:         instance.company_id,
              mediaId:           mediaId.trim(),
              wamid:             message.id,
              expectedMediaType: 'DOCUMENT',
              hintFilename:      message.document.filename,   // hint — não confiável
              maxBytes:          MAX_INBOUND_DOCUMENT_BYTES,
            });
          } catch (err) {
            const code = err?.code;

            // Erros definitivos — arquivo inválido/grande: 200 skip (retry não muda bytes)
            if (
              code === 'inbound_media_type_mismatch' ||
              code === 'inbound_media_too_large'     ||
              code === 'inbound_media_invalid_input'
            ) {
              console.log('[meta/webhook] event_type=inbound_document outcome=%s', code);
              continue;
            }

            // media_download_url_invalid — DEBT-DOMAIN-ALLOWLIST-C.
            // Classificado como transiente: allowlist pode precisar de atualização.
            // NÃO logar URL nem hostname — não disponível de forma segura neste nível.
            // NÃO ampliar allowlist por suposição — resolver com evidência real em E2E.
            if (code === 'media_download_url_invalid') {
              console.error('[meta/webhook] event_type=inbound_document outcome=media_download_url_invalid');
              hasTransientFailure = true;
              continue;
            }

            // Todos os demais erros: transientes (rede, Graph, Storage, DB)
            console.error('[meta/webhook] event_type=inbound_document outcome=%s', code ?? 'unknown_media_error');
            hasTransientFailure = true;
            continue;
          }

          // DOC.5 — RPC de persistência da mensagem de mídia
          // company_id e instance_id: sempre do banco, nunca do payload.
          const { data: docRpcData, error: docRpcErr } = await svc.rpc(
            'process_meta_inbound_media_message',
            {
              p_company_id:         instance.company_id,
              p_instance_id:        instance.id,
              p_wa_id:              message.from,
              p_meta_message_id:    message.id,
              p_media_asset_id:     mediaResult.assetId,
              p_contact_name:       contactName,
              p_provider_timestamp: providerTimestamp,
              p_message_type:       'document',
            },
          );

          if (docRpcErr) {
            console.error('[meta/webhook] event_type=inbound_document outcome=rpc_error');
            hasTransientFailure = true;
            continue;
          }

          const docCreated = docRpcData?.created === true;
          // Log sanitizado — somente booleanos seguros; sem token, URL, filename, from.
          console.log('[meta/webhook] event_type=inbound_document created=%s reused_asset=%s',
            docCreated, mediaResult.reused);

        } else {
          // ── B.5.3 Tipos não suportados (image, video, audio, sticker, etc.) ────
          // IMAGE e VIDEO: reservados para extensão futura (C3+).
          // Ignorar silenciosamente — sem criar conversa ou incrementar unread.
          console.log('[meta/webhook] event_type=inbound_message type_skipped=%s', message.type ?? 'unknown');
          continue;
        }
      }
    }
  }

  // Retornar 500 se houve falha transiente em algum DOCUMENT do payload.
  // Meta reenviará o payload inteiro — idempotência garante segurança do retry.
  if (hasTransientFailure) {
    return res.status(500).json({ error: 'Internal error' });
  }

  return res.status(200).json({ received: true });
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Consulta a matriz de transições explícita.
 * Não usa ranking numérico — cada célula é declarada explicitamente.
 *
 * @param {string} currentStatus — status atual no banco
 * @param {string} newStatus     — status recebido do webhook
 * @returns {boolean} true = APPLY, false = NOOP
 */
function shouldApply(currentStatus, newStatus) {
  return TRANSITION_MATRIX[currentStatus]?.[newStatus] === true;
}

/**
 * Parseia o timestamp Meta (string Unix epoch em segundos).
 *
 * Aceita somente string composta exclusivamente de dígitos decimais,
 * representando um inteiro seguro e positivo.
 * Sem janela arbitrária de validade (Meta não documenta restrição de validade).
 *
 * @param {unknown} raw — valor bruto de statuses[].timestamp
 * @returns {string|null} ISO 8601 string ou null se inválido
 */
function parseMetaTimestamp(raw) {
  if (typeof raw !== 'string') return null;
  if (!/^[0-9]+$/.test(raw))  return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Extrai error_code numérico de statuses[].errors[].
 * Aceita somente inteiros — nunca string ou float.
 * Nunca persiste title, message, details, href.
 * error_subcode: sempre null (campo deprecated/inexistente em webhooks v16.0+).
 *
 * @param {object} statusItem — item de statuses[]
 * @returns {number|null}
 */
function extractErrorCode(statusItem) {
  const errors = Array.isArray(statusItem.errors) ? statusItem.errors : [];
  const first  = errors[0] ?? {};
  const code   = first.code;
  if (typeof code === 'number' && Number.isInteger(code)) return code;
  return null;
}

/**
 * Constrói o payload de UPDATE para meta_whatsapp_messages.
 * Persiste somente campos seguros — sem texto livre, sem dados de usuário.
 *
 * @param {string}      newStatus        — status de destino
 * @param {string|null} timestamp        — ISO 8601 ou null (usa now())
 * @param {object}      statusItem       — item completo de statuses[]
 * @returns {object} objeto de update compatível com Supabase
 */
function buildUpdatePayload(newStatus, timestamp, statusItem) {
  const now = new Date().toISOString();
  const ts  = timestamp ?? now;

  switch (newStatus) {
    case 'sent':
      return { status: 'sent',      sent_at:      ts, updated_at: now };
    case 'delivered':
      return { status: 'delivered', delivered_at: ts, updated_at: now };
    case 'read':
      return { status: 'read',      read_at:      ts, updated_at: now };
    case 'failed':
      return {
        status:        'failed',
        failed_at:     ts,
        error_code:    extractErrorCode(statusItem),
        error_subcode: null,   // deprecated/inexistente em webhooks v16.0+
        updated_at:    now,
      };
    default:
      // Nunca atingido com SUPPORTED_STATUSES guard antes desta função
      return { updated_at: now };
  }
}
