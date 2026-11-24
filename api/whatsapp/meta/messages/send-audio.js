// =============================================================================
// POST /api/whatsapp/meta/messages/send-audio
//
// Graph outbound audio após validações reais (JWT, company_users, instância,
// conversa, janela 24h, credencial backend). Sem variável de ambiente, host
// ou empresa como gate. created → claim CAS → Graph uma vez → markGraphAccepted
// → B.6 se restar >= 30s, senão 503 recuperação local.
// graph_accepted: tracking → S3 → biblioteca → chat → completed (sem Graph).
//
// Contrato:
//   Content-Type: multipart/form-data
//   Campos: company_id, instance_id, conversation_id, operation_id, file
//   Autoridade operacional: JWT + company_users + lookups com auth.companyId.
//   Ignorados como autoridade: to, access_token, phone_number_id, media_id,
//     media_url, s3_key, role, permissions, MIME/extensão do cliente,
//     deadline, deadlineAtMs, startedAtMs, enabled.
//
// Fluxo (ordem de segurança — não alterar):
//   1.  Method guard (POST only)
//   1.5 startedAtMs = Date.now() imediato; deadline = started + 60000 - 3000
//   2.  getSupabaseAdmin()
//   3.  Bearer + svc.auth.getUser(token) — 401 sem gravar multipart
//   4.  Parse multipart (formidable, teto 4 MiB, maxFields 8 / 4096)
//   4.5 operation_id UUID v4 canônico em minúsculas (multipart only; não gera ID)
//   5.  validateMetaCaller() — RBAC + feature flag (META_SEND_ROLES)
//   6.  Validação de instance_id / conversation_id
//   7.  Lookup de instância (auth.companyId + deleted_at IS NULL)
//   8.  Status connected
//   9.  Lookup de conversa (company + instance) → deriva wa_id (não envia)
//  10.  Leitura dos bytes + AAC-LC + SHA-256 backend
//  11.  SELECT operação (company_id + operation_id)
//  12.  Janela 24h somente para created/novo envio; completed e graph_accepted pulam
//  13.  INSERT created (sem upsert). 23505 → re-SELECT.
//  14.  graph_accepted → persistência local B.6 (não passa pelo send orchestrator)
//       tracking antes de AWS/S3; biblioteca → chat → completed
//  15.  created → credencial backend → claim CAS → Graph uma vez → B.6
//       completed idêntico / graph_accepted persistido → HTTP 200 { ok: true }
//
// Limpeza: unlink de todos os filepaths do formidable em qualquer saída.
// =============================================================================

import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { S3Client } from '@aws-sdk/client-s3';
import formidable from 'formidable';
import { getSupabaseAdmin } from '../../../lib/automation/supabaseAdmin.js';
import {
  INVALID_OPERATION_ID_RESPONSE,
  parseOperationId,
  resolveExistingOperationDecision,
} from '../../../lib/meta-whatsapp/outboundAudioOperation.js';
import { orchestrateOutboundAudioSend } from '../../../lib/meta-whatsapp/outboundAudioSendOrchestrator.js';
import { completeMetaOutboundAudioPersistence } from '../../../lib/meta-whatsapp/outboundAudioPersistenceOrchestrator.js';
import {
  claimCreatedToGraphInFlight,
  insertCreated,
  markCompleted,
  markGraphAccepted,
  markUnknown,
  selectByCompanyOperation,
} from '../../../lib/meta-whatsapp/outboundAudioOperationStore.js';
import {
  buildMetaOutboundAudioS3Key,
  uploadMetaOutboundAudio,
} from '../../../lib/meta-whatsapp/awsOutboundAudio.js';
import { persistOutboundAudioMediaLibrary } from '../../../lib/meta-whatsapp/outboundAudioMediaLibraryStore.js';
import { persistOutboundAudioTracking } from '../../../lib/meta-whatsapp/outboundAudioTrackingStore.js';
import { persistOutboundAudioChat } from '../../../lib/meta-whatsapp/outboundAudioChatStore.js';
import { validateMetaCaller, META_SEND_ROLES } from '../../../lib/meta-whatsapp/validateMetaCaller.js';
import { decryptMetaToken } from '../../../lib/meta-whatsapp/tokenCrypto.js';
import { sendAudioMessage, uploadMedia } from '../../../lib/meta-whatsapp/graphClient.js';
import * as customerServiceWindow from '../../../lib/meta-whatsapp/customerServiceWindow.js';
import {
  validateMetaOutboundAudioBytes,
  META_OUTBOUND_AUDIO_MAX_BYTES,
} from '../../../lib/meta-whatsapp/audioBytes.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const config = { api: { bodyParser: false } };

function fieldValue(fields, name) {
  const raw = fields?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim() : '';
}

function collectFilepaths(files) {
  const paths = [];
  for (const value of Object.values(files ?? {})) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (item && typeof item.filepath === 'string' && item.filepath.length > 0) {
        paths.push(item.filepath);
      }
    }
  }
  return paths;
}

async function cleanupTempFiles(filepaths) {
  for (const filepath of filepaths) {
    try {
      await unlink(filepath);
    } catch {
      // Temp já removido pelo runtime ou pelo formidable.
    }
  }
}

function isTooLargeError(err) {
  if (!err || typeof err !== 'object') return false;
  // Formidable: 1009 biggerThanTotalMaxFileSize, 1016 biggerThanMaxFileSize.
  // Não usar httpCode 413 — formidable também usa 413 para maxFilesExceeded.
  const code = Number(err.code);
  if (code === 1009 || code === 1016) return true;
  const message = String(err.message ?? '').toLowerCase();
  return message.includes('maxfilesize') || message.includes('maxtotalfilesize');
}

function resolveSingleFile(files) {
  const names = Object.keys(files ?? {});
  if (names.length === 0) return { error: 'missing' };
  if (names.length !== 1 || names[0] !== 'file') return { error: 'duplicate' };
  const value = files.file;
  if (value == null) return { error: 'missing' };
  if (Array.isArray(value)) {
    if (value.length === 0) return { error: 'missing' };
    if (value.length !== 1) return { error: 'duplicate' };
    return { file: value[0] };
  }
  return { file: value };
}

const PHONE_NUMBER_ID_RE = /^[0-9]+$/;

// Timeouts alinhados ao orquestrador D.3. Não cabem Graph default + B.6 30s
// no mesmo POST (33s + 30s > 57s). B.6 após aceite é oportunista.
export const GRAPH_UPLOAD_TIMEOUT_MS = 20_000;
export const GRAPH_SEND_TIMEOUT_MS = 10_000;
export const GRAPH_PERSIST_RESERVE_MS = 2_000;
export const GRAPH_CLAIM_RESERVE_MS = 1_000;
export const GRAPH_NEED_BEFORE_CLAIM_MS = GRAPH_CLAIM_RESERVE_MS
  + GRAPH_UPLOAD_TIMEOUT_MS
  + GRAPH_SEND_TIMEOUT_MS
  + GRAPH_PERSIST_RESERVE_MS;

export const META_AUDIO_FUNCTION_BUDGET_MS = 60_000;
export const META_AUDIO_PLATFORM_MARGIN_MS = 3_000;
export const META_AUDIO_PERSIST_MIN_REMAINING_MS = 30_000;

const ISO_TZ_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (!ISO_TZ_RE.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

export function computeOutboundAudioDeadline(startedAtMs) {
  if (typeof startedAtMs !== 'number' || !Number.isInteger(startedAtMs) || !Number.isFinite(startedAtMs)) {
    return null;
  }
  return startedAtMs + META_AUDIO_FUNCTION_BUDGET_MS - META_AUDIO_PLATFORM_MARGIN_MS;
}

export function buildCreatedOutboundAudioContext(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const companyId = input.companyId;
  const userId = input.userId;
  const instanceId = input.instanceId;
  const conversationId = input.conversationId;
  const operationId = input.operationId;
  const audioSha256 = input.audioSha256;
  const phoneNumberId = input.phoneNumberId;
  const recipientWaId = input.recipientWaId;
  const audioBytes = input.audioBytes;
  const deadlineAtMs = input.deadlineAtMs;
  if (typeof companyId !== 'string' || companyId.length === 0) return null;
  if (typeof userId !== 'string' || userId.length === 0) return null;
  if (typeof instanceId !== 'string' || instanceId.length === 0) return null;
  if (typeof conversationId !== 'string' || conversationId.length === 0) return null;
  if (typeof operationId !== 'string' || operationId.length === 0) return null;
  if (typeof audioSha256 !== 'string' || audioSha256.length === 0) return null;
  if (typeof phoneNumberId !== 'string' || phoneNumberId.length === 0) return null;
  if (typeof recipientWaId !== 'string' || recipientWaId.length === 0) return null;
  if (audioBytes == null || typeof audioBytes.length !== 'number' || audioBytes.length === 0) {
    return null;
  }
  if (
    typeof deadlineAtMs !== 'number'
    || !Number.isInteger(deadlineAtMs)
    || !Number.isFinite(deadlineAtMs)
  ) {
    return null;
  }
  return {
    companyId,
    userId,
    instanceId,
    conversationId,
    operationId,
    audioSha256,
    operationStatus: 'created',
    customerServiceWindowOpen: true,
    phoneNumberId,
    recipientWaId,
    audioBytes,
    deadlineAtMs,
  };
}

function createdContextFromAuthorizedState({
  auth,
  instance,
  conversation,
  operationId,
  audioSha256,
  audioBytes,
  recipientWaId,
  deadlineAtMs,
}) {
  return buildCreatedOutboundAudioContext({
    companyId: auth.companyId,
    userId: auth.userId,
    instanceId: instance.id,
    conversationId: conversation.id,
    operationId,
    audioSha256,
    phoneNumberId: instance.phone_number_id,
    recipientWaId,
    audioBytes,
    deadlineAtMs,
  });
}

function remainingUntilDeadline(deadlineAtMs) {
  if (typeof deadlineAtMs !== 'number' || !Number.isFinite(deadlineAtMs)) return -1;
  return deadlineAtMs - Date.now();
}

async function resolveMetaAccessToken(svc, instanceId) {
  const { data: credential, error } = await svc
    .from('meta_whatsapp_credentials')
    .select('access_token_enc')
    .eq('instance_id', instanceId)
    .maybeSingle();
  if (error || typeof credential?.access_token_enc !== 'string' || credential.access_token_enc.length === 0) {
    return null;
  }
  try {
    const token = decryptMetaToken(credential.access_token_enc);
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function buildGraphSendDeps(svc) {
  return {
    claimCreatedToGraphInFlight: (args) => claimCreatedToGraphInFlight(svc, args),
    uploadMedia,
    sendAudioMessage,
    markUnknown: (args) => markUnknown(svc, args),
    markGraphAccepted: (args) => markGraphAccepted(svc, args),
  };
}

async function resumeAfterGraphAccepted(res, params) {
  const existing = await selectByCompanyOperation(params.svc, {
    companyId: params.auth.companyId,
    operationId: params.operationId,
  });
  if (!existing.ok) {
    return persistFailed(res);
  }
  return resumeGraphAcceptedPersistence({
    res,
    svc: params.svc,
    auth: params.auth,
    operationId: params.operationId,
    audioSha256: params.audioSha256,
    audioBytes: params.audioBytes,
    stored: existing.row,
    deadlineAtMs: params.deadlineAtMs,
  });
}

function mapGraphOrchestratorHttp(res, orchestrated, resumeParams) {
  if (orchestrated?.ok === true && orchestrated.persistedStatus === 'graph_accepted') {
    return resumeAfterGraphAccepted(res, resumeParams);
  }
  const error = orchestrated?.error;
  if (error === 'deadline_insufficient_before_claim') {
    return res.status(503).json({ error: 'graph_deadline_insufficient' });
  }
  if (error === 'claim_not_claimed') {
    return res.status(409).json({ ok: false, error: 'operation_in_progress' });
  }
  if (error === 'customer_service_window_closed') {
    return res.status(409).json({ error: 'customer_service_window_closed' });
  }
  if (error === 'operation_unknown' || error === 'deadline_insufficient_after_claim') {
    return res.status(409).json({ ok: false, error: 'operation_unknown' });
  }
  if (error === 'persist_wamid_failed' || error === 'persist_unknown_failed') {
    return persistFailed(res);
  }
  return res.status(500).json({ error: 'internal_error' });
}

async function respondCreatedGraphSend(res, sendContext, extras = {}) {
  const { svc, instance, auth, deadlineAtMs, audioSha256, audioBytes } = extras;
  if (!svc || !instance || !auth || !sendContext) {
    return res.status(500).json({ error: 'internal_error' });
  }
  if (!PHONE_NUMBER_ID_RE.test(instance.phone_number_id ?? '')) {
    return res.status(500).json({ error: 'internal_error' });
  }
  if (remainingUntilDeadline(deadlineAtMs) < GRAPH_NEED_BEFORE_CLAIM_MS) {
    return res.status(503).json({ error: 'graph_deadline_insufficient' });
  }

  const accessToken = await resolveMetaAccessToken(svc, instance.id);
  if (!accessToken) {
    return res.status(500).json({ error: 'credential_unavailable' });
  }

  let orchestrated;
  try {
    orchestrated = await orchestrateOutboundAudioSend({
      enabled: true,
      context: {
        ...sendContext,
        accessToken,
      },
      deps: buildGraphSendDeps(svc),
      now: () => new Date().toISOString(),
      clock: { nowMs: () => Date.now() },
      deadlineAtMs,
      uploadTimeoutMs: GRAPH_UPLOAD_TIMEOUT_MS,
      sendTimeoutMs: GRAPH_SEND_TIMEOUT_MS,
      persistReserveMs: GRAPH_PERSIST_RESERVE_MS,
      claimReserveMs: GRAPH_CLAIM_RESERVE_MS,
    });
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }

  return mapGraphOrchestratorHttp(res, orchestrated, {
    res,
    svc,
    auth,
    operationId: sendContext.operationId,
    audioSha256,
    audioBytes,
    deadlineAtMs,
  });
}

async function gateCustomerServiceWindow(svc, ids, res) {
  try {
    const loaded = await customerServiceWindow.loadLastInboundTimestamp(svc, ids);
    if (!loaded.ok) {
      console.error(
        `[meta/messages/send-audio] customer_service_window_unproven reason=${loaded.reason}`,
      );
      res.status(409).json({ error: 'customer_service_window_unproven' });
      return false;
    }
    const window = customerServiceWindow.resolveCustomerServiceWindow({
      lastInboundAt: loaded.lastInboundAt,
    });
    if (window.state === 'closed') {
      res.status(409).json({ error: 'customer_service_window_closed' });
      return false;
    }
    if (window.state !== 'open') {
      res.status(409).json({ error: 'customer_service_window_unproven' });
      return false;
    }
    return true;
  } catch {
    console.error(
      '[meta/messages/send-audio] customer_service_window_unproven reason=unexpected_gate_error',
    );
    res.status(409).json({ error: 'customer_service_window_unproven' });
    return false;
  }
}

function mapExistingOperation(stored, incomingIdentity) {
  const decision = resolveExistingOperationDecision(stored, incomingIdentity);
  if (decision.httpStatus && decision.body) {
    return {
      httpStatus: decision.httpStatus,
      body: decision.body,
      mayClaim: false,
      mayResumeLocal: false,
    };
  }
  if (decision.mayResumeLocal) {
    return { httpStatus: null, body: null, mayClaim: false, mayResumeLocal: true };
  }
  if (decision.mayClaim) {
    return { httpStatus: null, body: null, mayClaim: true, mayResumeLocal: false };
  }
  return {
    httpStatus: 500,
    body: { error: 'internal_error' },
    mayClaim: false,
    mayResumeLocal: false,
  };
}

function persistFailed(res) {
  return res.status(500).json({ error: 'send_persistence_failed' });
}

function mapPersistOutcome(res, result) {
  if (result?.ok === true) {
    return res.status(200).json({ ok: true });
  }
  if (result?.error === 'operation_identity_conflict' || result?.error === 'completion_conflict') {
    return res.status(409).json({ ok: false, error: 'operation_conflict' });
  }
  return persistFailed(res);
}

function readAwsCredentialsRow(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (
    row == null
    || typeof row.access_key_id !== 'string'
    || row.access_key_id.length === 0
    || typeof row.secret_access_key !== 'string'
    || row.secret_access_key.length === 0
    || typeof row.region !== 'string'
    || row.region.length === 0
    || typeof row.bucket !== 'string'
    || row.bucket.length === 0
  ) {
    return null;
  }
  return row;
}

async function resolveOutboundAwsClient(svc, companyId) {
  const { data, error } = await svc.rpc('webhook_resolve_aws_credentials', {
    p_company_id: companyId,
  });
  const creds = readAwsCredentialsRow(data);
  if (error || !creds) return null;
  const s3Client = new S3Client({
    region: creds.region,
    credentials: {
      accessKeyId: creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
    },
    maxAttempts: 1,
  });
  return { s3Client, bucket: creds.bucket };
}

function buildPersistDependencies(svc, resolveAws) {
  let awsPromise = null;
  const getAws = () => {
    if (awsPromise == null) {
      awsPromise = Promise.resolve()
        .then(resolveAws)
        .catch(() => null);
    }
    return awsPromise;
  };
  return {
    selectByCompanyOperation: (args) => selectByCompanyOperation(svc, args),
    persistOutboundAudioTracking: (context) => persistOutboundAudioTracking({
      supabase: svc,
      context,
    }),
    uploadMetaOutboundAudio: async (args) => {
      const aws = await getAws();
      if (!aws) return { ok: false, error: 'aws_credentials_unavailable' };
      return uploadMetaOutboundAudio({
        ...args,
        s3Client: aws.s3Client,
        bucket: aws.bucket,
      });
    },
    persistOutboundAudioMediaLibrary: (context) => persistOutboundAudioMediaLibrary({
      supabase: svc,
      context,
    }),
    persistOutboundAudioChat: (context) => persistOutboundAudioChat({
      supabase: svc,
      context,
    }),
    markCompleted: (args) => markCompleted(svc, args),
  };
}

/**
 * Recuperação local de graph_accepted. Usada no SELECT inicial e no reselect 23505.
 * providerTimestamp = graph_started_at interno estável; NÃO é o horário Graph.
 */
async function resumeGraphAcceptedPersistence({
  res,
  svc,
  auth,
  operationId,
  audioSha256,
  audioBytes,
  stored,
  deadlineAtMs,
}) {
  const remainingMs = (
    typeof deadlineAtMs === 'number' && Number.isFinite(deadlineAtMs)
      ? deadlineAtMs - Date.now()
      : -1
  );
  if (remainingMs < META_AUDIO_PERSIST_MIN_REMAINING_MS) {
    return res.status(503).json({ error: 'persist_deadline_insufficient' });
  }

  if (!isIsoTimestamp(stored?.graph_started_at)) {
    return persistFailed(res);
  }

  const s3KeyBuilt = buildMetaOutboundAudioS3Key({
    companyId: auth.companyId,
    operationId,
  });
  if (!s3KeyBuilt.ok) {
    return persistFailed(res);
  }

  try {
    const result = await completeMetaOutboundAudioPersistence({
      context: {
        companyId: auth.companyId,
        userId: auth.userId,
        instanceId: stored.instance_id,
        conversationId: stored.conversation_id,
        operationId,
        audioSha256,
        audioBytes,
        audioSizeBytes: audioBytes.length,
        s3Key: s3KeyBuilt.objectKey,
        providerTimestamp: stored.graph_started_at,
        completedAt: new Date().toISOString(),
      },
      dependencies: buildPersistDependencies(
        svc,
        () => resolveOutboundAwsClient(svc, auth.companyId),
      ),
    });
    return mapPersistOutcome(res, result);
  } catch {
    return persistFailed(res);
  }
}

function readBearerToken(req) {
  const authHeader = req.headers?.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Autenticação necessária' };
  }
  return { ok: true, token: authHeader.slice(7) };
}

async function requireValidJwtUser(req, svc) {
  const bearer = readBearerToken(req);
  if (!bearer.ok) return bearer;
  const { data, error } = await svc.auth.getUser(bearer.token);
  if (error || !data?.user) {
    return { ok: false, status: 401, error: 'Sessão inválida ou expirada' };
  }
  return { ok: true };
}

async function parseMultipart(req) {
  const uploaded = [];
  const form = formidable({
    maxFileSize: META_OUTBOUND_AUDIO_MAX_BYTES,
    maxTotalFileSize: META_OUTBOUND_AUDIO_MAX_BYTES,
    maxFiles: 2,
    maxFields: 8,
    maxFieldsSize: 4096,
    allowEmptyFiles: false,
    multiples: true,
    keepExtensions: false,
  });
  form.on('file', (_formName, file) => {
    if (file && typeof file.filepath === 'string' && file.filepath.length > 0) {
      uploaded.push(file.filepath);
    }
  });
  try {
    const [fields, files] = await form.parse(req);
    return { fields, files, uploaded: [...new Set([...uploaded, ...collectFilepaths(files)])] };
  } catch (err) {
    err._uploaded = uploaded;
    throw err;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startedAtMs = Date.now();
  const deadlineAtMs = computeOutboundAudioDeadline(startedAtMs);

  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }

  let uploadedFilepaths = [];

  try {
    const earlyAuth = await requireValidJwtUser(req, svc);
    if (!earlyAuth.ok) {
      return res.status(earlyAuth.status).json({ error: earlyAuth.error });
    }

    let fields;
    let files;
    try {
      const parsed = await parseMultipart(req);
      fields = parsed.fields;
      files = parsed.files;
      uploadedFilepaths = parsed.uploaded;
    } catch (err) {
      uploadedFilepaths = Array.isArray(err?._uploaded) ? err._uploaded : [];
      if (isTooLargeError(err)) {
        return res.status(400).json({ error: 'audio_too_large' });
      }
      return res.status(400).json({ error: 'invalid_request' });
    }

    const resolved = resolveSingleFile(files);
    if (resolved.error === 'duplicate') {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const parsedOperationId = parseOperationId(fields.operation_id);
    if (!parsedOperationId.ok) {
      return res
        .status(INVALID_OPERATION_ID_RESPONSE.httpStatus)
        .json(INVALID_OPERATION_ID_RESPONSE.body);
    }
    // Identidade futura deve persistir este UUID canônico, nunca a string original.
    const operationId = parsedOperationId.operationId;
    if (!operationId) {
      return res
        .status(INVALID_OPERATION_ID_RESPONSE.httpStatus)
        .json(INVALID_OPERATION_ID_RESPONSE.body);
    }

    const companyId = fieldValue(fields, 'company_id');
    const instanceId = fieldValue(fields, 'instance_id');
    const conversationId = fieldValue(fields, 'conversation_id');

    const auth = await validateMetaCaller(req, svc, companyId, { roles: META_SEND_ROLES });
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    if (!instanceId || !UUID_RE.test(instanceId)) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    if (!conversationId || !UUID_RE.test(conversationId)) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    if (resolved.error === 'missing' || !resolved.file?.filepath) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const { data: instance, error: instErr } = await svc
      .from('meta_whatsapp_instances')
      .select('id, company_id, phone_number_id, status')
      .eq('id', instanceId)
      .eq('company_id', auth.companyId)
      .is('deleted_at', null)
      .maybeSingle();

    if (instErr) {
      return res.status(500).json({ error: 'internal_error' });
    }
    if (!instance) {
      return res.status(404).json({ error: 'instance_not_found' });
    }
    if (instance.status !== 'connected') {
      return res.status(409).json({ error: 'instance_not_connected' });
    }

    const { data: conversation, error: convErr } = await svc
      .from('meta_conversations')
      .select('id, wa_id, company_id, instance_id')
      .eq('id', conversationId)
      .eq('company_id', auth.companyId)
      .eq('instance_id', instance.id)
      .maybeSingle();

    if (convErr) {
      return res.status(500).json({ error: 'internal_error' });
    }
    if (!conversation) {
      return res.status(404).json({ error: 'conversation_not_found' });
    }

    const waIdRaw = conversation.wa_id ?? '';
    const toNormalized = waIdRaw.startsWith('+') ? waIdRaw.slice(1) : waIdRaw;
    if (!/^[0-9]+$/.test(toNormalized) || toNormalized.length === 0) {
      return res.status(500).json({ error: 'internal_error' });
    }

    let bytes;
    try {
      bytes = await readFile(resolved.file.filepath);
    } catch {
      return res.status(400).json({ error: 'invalid_audio' });
    }

    const validation = validateMetaOutboundAudioBytes(bytes);
    const aacLcConfirmed =
      validation.ok === true
      && validation.audioCodec === 'aac'
      && validation.aacProfile === 'lc';
    if (!aacLcConfirmed) {
      if (validation.code === 'audio_too_large') {
        return res.status(400).json({ error: 'audio_too_large' });
      }
      return res.status(400).json({ error: 'invalid_audio' });
    }

    const audioSha256 = createHash('sha256').update(bytes).digest('hex');
    const incomingIdentity = {
      company_id: auth.companyId,
      operation_id: operationId,
      user_id: auth.userId,
      instance_id: instance.id,
      conversation_id: conversation.id,
      audio_sha256: audioSha256,
    };
    const windowIds = {
      companyId: auth.companyId,
      instanceId: instance.id,
      conversationId: conversation.id,
    };

    const existing = await selectByCompanyOperation(svc, {
      companyId: auth.companyId,
      operationId,
    });
    if (existing.reason === 'db_error' || existing.reason === 'invalid_identity') {
      return res.status(500).json({ error: 'internal_error' });
    }

    if (existing.ok) {
      const mapped = mapExistingOperation(existing.row, incomingIdentity);
      if (mapped.mayResumeLocal) {
        return resumeGraphAcceptedPersistence({
          res,
          svc,
          auth,
          operationId,
          audioSha256,
          audioBytes: bytes,
          stored: existing.row,
          deadlineAtMs,
        });
      }
      if (!mapped.mayClaim) {
        return res.status(mapped.httpStatus).json(mapped.body);
      }
      const windowOpen = await gateCustomerServiceWindow(svc, windowIds, res);
      if (!windowOpen) return;
      return respondCreatedGraphSend(
        res,
        createdContextFromAuthorizedState({
          auth,
          instance,
          conversation,
          operationId,
          audioSha256,
          audioBytes: bytes,
          recipientWaId: toNormalized,
          deadlineAtMs,
        }),
        { svc, instance, auth, deadlineAtMs, audioSha256, audioBytes: bytes },
      );
    }

    const windowOpen = await gateCustomerServiceWindow(svc, windowIds, res);
    if (!windowOpen) return;

    const inserted = await insertCreated(svc, incomingIdentity);
    if (inserted.ok) {
      return respondCreatedGraphSend(
        res,
        createdContextFromAuthorizedState({
          auth,
          instance,
          conversation,
          operationId,
          audioSha256,
          audioBytes: bytes,
          recipientWaId: toNormalized,
          deadlineAtMs,
        }),
        { svc, instance, auth, deadlineAtMs, audioSha256, audioBytes: bytes },
      );
    }
    if (inserted.reason !== 'unique_violation') {
      return res.status(500).json({ error: 'internal_error' });
    }

    const raced = await selectByCompanyOperation(svc, {
      companyId: auth.companyId,
      operationId,
    });
    if (!raced.ok) {
      return res.status(500).json({ error: 'internal_error' });
    }
    const mapped = mapExistingOperation(raced.row, incomingIdentity);
    if (mapped.mayResumeLocal) {
      return resumeGraphAcceptedPersistence({
        res,
        svc,
        auth,
        operationId,
        audioSha256,
        audioBytes: bytes,
        stored: raced.row,
        deadlineAtMs,
      });
    }
    if (!mapped.mayClaim) {
      return res.status(mapped.httpStatus).json(mapped.body);
    }
    return respondCreatedGraphSend(
      res,
      createdContextFromAuthorizedState({
        auth,
        instance,
        conversation,
        operationId,
        audioSha256,
        audioBytes: bytes,
        recipientWaId: toNormalized,
        deadlineAtMs,
      }),
      { svc, instance, auth, deadlineAtMs, audioSha256, audioBytes: bytes },
    );
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  } finally {
    await cleanupTempFiles(uploadedFilepaths);
  }
}
