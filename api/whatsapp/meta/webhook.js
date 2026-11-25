// =============================================================================
// GET|POST /api/whatsapp/meta/webhook
//
// GET  → Verificação do challenge Meta (setup do webhook no App Dashboard)
// POST → Recebimento de eventos: statuses[] outbound (MVP2) + messages[] inbound
//        TEXT (MVP3A), DOCUMENT/IMAGE/VIDEO/AUDIO, BUTTON/QUICK_REPLY (MVP4C.12)
//        e INTERACTIVE button_reply/list_reply (MVP5.B3.1)
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
//   - a transição só grava se o status lido ainda for o mesmo (compare-and-swap)
//   - messages[]: RPC process_meta_inbound_message — UNIQUE (instance_id, wamid)
//   - Retry Meta em 5xx é seguro: ambos os ramos são idempotentes
//
// MVP5.B1.2 — sinal de ticks:
//   Após transição APPLY no tracking, UPDATE pontual de meta_messages.updated_at
//   (company_id + instance_id + meta_message_id + direction outbound).
//   NOOP não toca o chat. Zero linhas = no-op. Falha de touch não reverte tracking.
//
// Ramos INDEPENDENTES por value:
//   - statuses[] e messages[] processados em paralelo (sem else/continue entre eles)
//   - Um mesmo value pode conter ambos — ambos são processados
//   - Tenant resolution compartilhada (uma query por value)
//
// MVP3A/MVP4C.12/MVP5.B3.1 escopo (messages[]):
//   - type='text' persistido via process_meta_inbound_message
//   - type='button' persistido via a mesma RPC, usando somente button.text
//   - type='interactive' button_reply/list_reply via a mesma RPC, somente title
//   - button.payload, interactive ids e payloads nunca logados, persistidos
//     ou usados como tenant
//   - Grupos (message.group_id presente) ignorados silenciosamente
//   - played ignorado silenciosamente
//   - type='audio' persistido via process_meta_inbound_media_message (MVP5.B3.2.B)
//   - location, sticker, interactive de outro subtipo e unknown: type_skipped
//
// Status sem tracking:
//   - O primeiro evento é inserido em meta_early_status_pendings.
//   - Sem tracking depois da releitura, a pendência fica e o chat não é tocado.
//   - HTTP 200 se essa persistência for a única ocorrência, sem falha transitória.
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
import { MEDIA_SIZE_LIMITS }           from '../../lib/meta-whatsapp/mediaConstants.js';
import {
  SUPPORTED_STATUSES,
  handleLiveOutboundStatus,
  parseMetaTimestamp,
  recoverOutboundStatusBacklog,
}                                      from '../../lib/meta-whatsapp/outboundStatusTracking.js';

// CRÍTICO: desabilitar body parser do Vercel — obrigatório para HMAC validation.
// Qualquer re-serialização do body invalida a assinatura.
export const config = { api: { bodyParser: false } };

// Limite MVP conservador para documentos inbound (INBOUND-DOC-C2).
// INTENCIONALMENTE 5 MB — não altera MEDIA_SIZE_LIMITS global (infra suporta 30 MB).
// Justificativa:
//   - PDFs de negócio comuns: < 2 MB.
//   - Mantém download + Storage + RPC dentro de maxDuration: 30 s com folga.
//   - Pressão de memória Vercel: ~2–3× tamanho → ~15 MB pico com 5 MB PDF (seguro).
//   - Revisável em C3 após validação E2E e decisão operacional.
const MAX_INBOUND_DOCUMENT_BYTES = 5 * 1024 * 1024; // 5 MB

// Teto do body de texto inbound (Cloud API / Graph). Interactive title usa o mesmo
// contrato: string após trim, não vazia, no máximo este comprimento. Acima → skip.
const MAX_INBOUND_TEXT_BODY_LENGTH = 4096;

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

  // Marcador de falha transiente para o lote.
  // Erro recuperável de texto, botão, interativo ou mídia marca este flag
  // e o processamento dos eventos seguintes continua. O flag não volta a false.
  // HTTP 500 sai só depois dos entries e changes.
  // Meta reenvia o payload inteiro — a idempotência fica na RPC, no wamid
  // e no compare-and-swap de status.
  let hasTransientFailure = false;
  const recoveryScopes = new Map();
  const rememberInstance = (resolved) => {
    const scopeKey = `${resolved.company_id}:${resolved.id}`;
    let scope = recoveryScopes.get(scopeKey);
    if (!scope) {
      scope = { instance: resolved, wamids: new Set() };
      recoveryScopes.set(scopeKey, scope);
    }
    return scope;
  };

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

      const { data: instance, error: instErr } = await svc
        .from('meta_whatsapp_instances')
        .select('id, company_id')
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

      // ── 9. Ramo A — statuses[] outbound ───────────────────────────────────
      for (const statusItem of statuses) {
        const wamid     = statusItem.id;
        const newStatus = statusItem.status;

        // Validar wamid
        if (typeof wamid !== 'string' || wamid.length === 0) continue;

        // Ignorar statuses fora do escopo (played, outros)
        if (!SUPPORTED_STATUSES.has(newStatus)) continue;

        // ── 10–12. Pendências do wamid, depois o evento ao vivo, um toque ──
        rememberInstance(instance).wamids.add(wamid);

        const decision = await handleLiveOutboundStatus(
          svc,
          instance,
          wamid,
          newStatus,
          statusItem,
        );
        if (decision.transient) hasTransientFailure = true;
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
        // Extraído antes do ramo de tipo para reutilização em TEXT, DOCUMENT, IMAGE e VIDEO.
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

          // RPC idempotente por (instance_id, wamid). Erro ou exceção
          // desta mensagem não encerra o lote.
          rememberInstance(instance);
          const textTransient = await persistInboundTextLikeMessage(
            svc, instance, message, body, contactName, providerTimestamp,
          );
          if (textTransient) hasTransientFailure = true;

        } else if (message.type === 'button') {
          // ── B.5.1b BUTTON / QUICK_REPLY inbound (MVP4C.12) ───────────────
          // Somente button.text vira body. payload é ignorado: não é fallback,
          // não é persistido, não entra em log e não identifica tenant.
          const body = message.button?.text;
          if (typeof body !== 'string' || body.trim().length === 0) {
            console.log('[meta/webhook] event_type=inbound_message invalid_body=true');
            continue;
          }

          rememberInstance(instance);
          const buttonTransient = await persistInboundTextLikeMessage(
            svc, instance, message, body, contactName, providerTimestamp,
          );
          if (buttonTransient) hasTransientFailure = true;

        } else if (message.type === 'interactive') {
          // ── B.5.1c INTERACTIVE inbound (MVP5.B3.1) ───────────────────────
          // Somente button_reply.title e list_reply.title. IDs, description e
          // o objeto interactive completo não são persistidos nem logados.
          const body = extractInteractiveReplyTitle(message.interactive);
          if (body == null) {
            console.log('[meta/webhook] event_type=inbound_message type_skipped=%s', 'interactive');
            continue;
          }

          rememberInstance(instance);
          const interactiveTransient = await persistInboundTextLikeMessage(
            svc, instance, message, body, contactName, providerTimestamp,
          );
          if (interactiveTransient) hasTransientFailure = true;

        } else if (message.type === 'document') {
          // ── B.5.2 DOCUMENT inbound (INBOUND-DOC-C2) ──────────────────────
          // mime_type e sha256 do payload NÃO são autoridade — bytes reais.
          const mediaId = message.document?.id;
          if (typeof mediaId !== 'string' || mediaId.trim().length === 0) {
            console.log('[meta/webhook] event_type=inbound_document outcome=invalid_media_id');
            continue;
          }
          rememberInstance(instance);
          const docTransient = await processInboundMediaMessage({
            svc,
            instance,
            message,
            contactName,
            providerTimestamp,
            mediaId,
            expectedMediaType: 'DOCUMENT',
            rpcMessageType:    'document',
            hintFilename:      message.document.filename,
            maxBytes:          MAX_INBOUND_DOCUMENT_BYTES,
            logEvent:          'inbound_document',
          });
          if (docTransient) hasTransientFailure = true;

        } else if (message.type === 'image') {
          // ── B.5.3 IMAGE inbound — mesmo pipeline DOCUMENT, parâmetros IMAGE.
          // caption do payload é IGNORADO neste MVP (paridade DOCUMENT; body=NULL na RPC).
          // mime_type e sha256 do payload NÃO são autoridade.
          // filename: IMAGE oficial não traz filename — processor usa inbound.<ext>.
          const mediaId = message.image?.id;
          if (typeof mediaId !== 'string' || mediaId.trim().length === 0) {
            console.log('[meta/webhook] event_type=inbound_image outcome=invalid_media_id');
            continue;
          }
          rememberInstance(instance);
          const imgTransient = await processInboundMediaMessage({
            svc,
            instance,
            message,
            contactName,
            providerTimestamp,
            mediaId,
            expectedMediaType: 'IMAGE',
            rpcMessageType:    'image',
            hintFilename:      undefined,
            maxBytes:          MEDIA_SIZE_LIMITS.IMAGE,
            logEvent:          'inbound_image',
          });
          if (imgTransient) hasTransientFailure = true;

        } else if (message.type === 'video') {
          // ── B.5.4 VIDEO inbound — mesmo pipeline DOCUMENT/IMAGE, parâmetros VIDEO.
          // caption do payload é IGNORADO neste MVP (paridade IMAGE; body=NULL na RPC).
          // mime_type e sha256 do payload NÃO são autoridade.
          // filename: VIDEO oficial normalmente não traz filename — processor usa inbound.<ext>.
          const mediaId = message.video?.id;
          if (typeof mediaId !== 'string' || mediaId.trim().length === 0) {
            console.log('[meta/webhook] event_type=inbound_video outcome=invalid_media_id');
            continue;
          }
          rememberInstance(instance);
          const vidTransient = await processInboundMediaMessage({
            svc,
            instance,
            message,
            contactName,
            providerTimestamp,
            mediaId,
            expectedMediaType: 'VIDEO',
            rpcMessageType:    'video',
            hintFilename:      undefined,
            maxBytes:          MEDIA_SIZE_LIMITS.VIDEO,
            logEvent:          'inbound_video',
          });
          if (vidTransient) hasTransientFailure = true;

        } else if (message.type === 'audio') {
          // ── B.5.4b AUDIO inbound (MVP5.B3.2.B) ──────────────────────────
          // mime_type, sha256 e voice do payload NÃO são autoridade nem persistidos.
          // media_id: somente audio.id string não vazia. Filename: inbound.<ext>.
          const mediaId = message.audio?.id;
          if (typeof mediaId !== 'string' || mediaId.trim().length === 0) {
            console.log('[meta/webhook] event_type=inbound_audio outcome=invalid_media_id');
            continue;
          }
          rememberInstance(instance);
          const audTransient = await processInboundMediaMessage({
            svc,
            instance,
            message,
            contactName,
            providerTimestamp,
            mediaId,
            expectedMediaType: 'AUDIO',
            rpcMessageType:    'audio',
            hintFilename:      undefined,
            maxBytes:          MEDIA_SIZE_LIMITS.AUDIO,
            logEvent:          'inbound_audio',
          });
          if (audTransient) hasTransientFailure = true;

        } else {
          // ── B.5.5 Tipos não suportados (sticker, location, etc.) ────
          console.log('[meta/webhook] event_type=inbound_message type_skipped=%s', message.type ?? 'unknown');
          continue;
        }
      }
    }
  }

  // Uma vez por instância com status suportado ou inbound elegível.
  // O wamid corrente já foi decidido e fica fora deste orçamento.
  for (const scope of recoveryScopes.values()) {
    const recovery = await recoverOutboundStatusBacklog(svc, scope.instance, scope.wamids);
    if (recovery.transient) hasTransientFailure = true;
  }

  // Retornar 500 se houve falha transiente em algum DOCUMENT/IMAGE/VIDEO/AUDIO do payload.
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
 * Persiste texto, botão ou resposta interativa pela mesma RPC.
 * error do cliente, timeout, exceção e retorno null ou undefined são
 * falha recuperável desta mensagem. { data: null, error: null } permanece
 * sucesso. O objeto de erro não é logado.
 *
 * @returns {Promise<boolean>} true quando o lote deve responder 500
 */
async function persistInboundTextLikeMessage(svc, instance, message, body, contactName, providerTimestamp) {
  let rpcData;
  let rpcErr;
  try {
    const result = await svc.rpc('process_meta_inbound_message', {
      p_company_id:         instance.company_id,
      p_instance_id:        instance.id,
      p_wa_id:              message.from,
      p_meta_message_id:    message.id,
      p_body:               body,
      p_contact_name:       contactName,
      p_provider_timestamp: providerTimestamp,
    });
    if (result == null) {
      console.error('[meta/webhook] event_type=inbound_message rpc_error=true');
      return true;
    }
    rpcData = result.data;
    rpcErr  = result.error;
  } catch {
    console.error('[meta/webhook] event_type=inbound_message rpc_error=true');
    return true;
  }

  if (rpcErr) {
    console.error('[meta/webhook] event_type=inbound_message rpc_error=true');
    return true;
  }

  console.log('[meta/webhook] event_type=inbound_message created=%s', rpcData?.created === true);
  return false;
}

/**
 * Lê o ciphertext da instância resolvida.
 * transient=true pede retry do lote e não inicia download.
 *
 * @returns {Promise<{ transient: true, outcome: string }|{ transient: false, accessTokenEnc: string }>}
 */
async function readInboundMediaCredential(svc, instanceId) {
  let lookup;
  try {
    lookup = await svc
      .from('meta_whatsapp_credentials')
      .select('access_token_enc')
      .eq('instance_id', instanceId)
      .maybeSingle();
  } catch {
    return { transient: true, outcome: 'credential_lookup_failed' };
  }

  const credential = lookup?.data;
  if (lookup?.error) return { transient: true, outcome: 'credential_lookup_failed' };
  if (!credential) return { transient: true, outcome: 'credential_missing' };

  const accessTokenEnc = credential.access_token_enc;
  if (typeof accessTokenEnc !== 'string' || accessTokenEnc.trim().length === 0) {
    return { transient: true, outcome: 'credential_token_absent' };
  }

  return { transient: false, accessTokenEnc };
}

/**
 * Pipeline compartilhado DOCUMENT + IMAGE + VIDEO + AUDIO inbound.
 *
 * Preserva a semântica validada do ramo DOCUMENT:
 *   dedupe wamid → credencial lazy (instance.id do banco) → processor existente
 *   → RPC process_meta_inbound_media_message (body=NULL; caption fora do MVP).
 *
 * NÃO baixa mídia, NÃO chama Graph, NÃO chama RPC se o caller já rejeitou mediaId.
 * NÃO processa STICKER / LOCATION. AUDIO usa este pipeline.
 *
 * @returns {Promise<boolean>} true = falha transiente (caller marca hasTransientFailure)
 */
async function processInboundMediaMessage({
  svc,
  instance,
  message,
  contactName,
  providerTimestamp,
  mediaId,
  expectedMediaType,
  rpcMessageType,
  hintFilename,
  maxBytes,
  logEvent,
}) {
  // Early dedupe: ANTES de decrypt/Graph/Storage. RPC é autoridade final contra race.
  const { data: existingMsg, error: dedupeErr } = await svc
    .from('meta_messages')
    .select('id, conversation_id')
    .eq('instance_id', instance.id)
    .eq('meta_message_id', message.id)
    .maybeSingle();

  if (dedupeErr) {
    console.error('[meta/webhook] event_type=%s outcome=dedupe_db_error', logEvent);
    return true;
  }

  if (existingMsg) {
    const waId = typeof message.from === 'string' ? message.from : '';
    if (!existingMsg.conversation_id || waId.length === 0) {
      console.error('[meta/webhook] event_type=%s outcome=lead_resolve_skipped', logEvent);
      return false;
    }

    const { error: resolveErr } = await svc.rpc('resolve_meta_conversation_lead', {
      p_company_id:      instance.company_id,
      p_instance_id:     instance.id,
      p_conversation_id: existingMsg.conversation_id,
      p_wa_id:           waId,
      p_contact_name:    contactName,
    });

    if (resolveErr) {
      console.error('[meta/webhook] event_type=%s outcome=lead_resolve_failed', logEvent);
      return true;
    }

    console.log('[meta/webhook] event_type=%s outcome=already_persisted', logEvent);
    return false;
  }

  // Credencial lazy — depois do dedupe, para mídia já persistida
  // recuperar o lead sem Graph nem Storage.
  // A tabela não tem company_id: o escopo é instance_id da instância
  // resolvida no banco. Não há token global nem credencial de outra instância.
  //
  // Erro de consulta, linha ausente, token vazio e falha de descriptografia
  // não provam configuração permanente. Confirmar 200 perderia a mídia.
  // Todos esses casos são falha recuperável do lote. O módulo de criptografia
  // não distingue chave ausente de ciphertext inválido; a falha de decrypt
  // segue o mesmo caminho para não descartar a mensagem.
  const credentialOutcome = await readInboundMediaCredential(svc, instance.id);
  if (credentialOutcome.transient) {
    console.error('[meta/webhook] event_type=%s outcome=%s', logEvent, credentialOutcome.outcome);
    return true;
  }

  let plainToken;
  try {
    plainToken = decryptMetaToken(credentialOutcome.accessTokenEnc);
  } catch {
    console.error('[meta/webhook] event_type=%s outcome=%s', logEvent, 'credential_decrypt_failed');
    return true;
  }

  let mediaResult;
  try {
    mediaResult = await downloadAndStoreInboundMedia({
      svc,
      token:             plainToken,
      companyId:         instance.company_id,
      mediaId:           mediaId.trim(),
      wamid:             message.id,
      expectedMediaType,
      hintFilename,
      maxBytes,
    });
  } catch (err) {
    const code = err?.code;

    if (
      code === 'inbound_media_type_mismatch' ||
      code === 'inbound_media_too_large'     ||
      code === 'inbound_media_invalid_input'
    ) {
      console.log('[meta/webhook] event_type=%s outcome=%s', logEvent, code);
      return false;
    }

    if (code === 'media_download_url_invalid') {
      console.error('[meta/webhook] event_type=%s outcome=media_download_url_invalid', logEvent);
      return true;
    }

    console.error('[meta/webhook] event_type=%s outcome=%s', logEvent, code ?? 'unknown_media_error');
    return true;
  }

  const { data: mediaRpcData, error: mediaRpcErr } = await svc.rpc(
    'process_meta_inbound_media_message',
    {
      p_company_id:         instance.company_id,
      p_instance_id:        instance.id,
      p_wa_id:              message.from,
      p_meta_message_id:    message.id,
      p_media_asset_id:     mediaResult.assetId,
      p_contact_name:       contactName,
      p_provider_timestamp: providerTimestamp,
      p_message_type:       rpcMessageType,
    },
  );

  if (mediaRpcErr) {
    console.error('[meta/webhook] event_type=%s outcome=rpc_error', logEvent);
    return true;
  }

  const created = mediaRpcData?.created === true;
  console.log('[meta/webhook] event_type=%s created=%s reused_asset=%s',
    logEvent, created, mediaResult.reused);
  return false;
}

/**
 * Extrai o title de interactive.button_reply ou interactive.list_reply.
 * Retorna a string após trim, ou null para skip (subtipo desconhecido,
 * estrutura incompleta, title não-string, vazio ou acima do teto inbound).
 * IDs, description e o objeto interactive não são retornados.
 *
 * @param {unknown} interactive
 * @returns {string|null}
 */
function extractInteractiveReplyTitle(interactive) {
  if (interactive == null || typeof interactive !== 'object' || Array.isArray(interactive)) {
    return null;
  }

  const subtype = interactive.type;
  let title;
  if (subtype === 'button_reply') {
    title = interactive.button_reply?.title;
  } else if (subtype === 'list_reply') {
    title = interactive.list_reply?.title;
  } else {
    return null;
  }

  if (typeof title !== 'string') return null;
  const trimmed = title.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_INBOUND_TEXT_BODY_LENGTH) return null;
  return trimmed;
}
