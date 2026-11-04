// Reserva a operação aberta no Postgres e lê a linha temporária.
// A função claim_whatsapp_temp_open serializa empresa + nome.
// Enquanto ela não existir no banco, a criação volta ao INSERT e ao índice único.

const OPEN_STATUSES = ['creating', 'created', 'created_no_qr', 'connecting'];

export class QrSessionError extends Error {
  constructor(code, status, publicMessage, extra = {}) {
    super(publicMessage);
    this.name = 'QrSessionError';
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
    this.extra = extra;
  }
}

export async function markTemp(svc, tempId, companyId, values) {
  const { error } = await svc
    .from('whatsapp_temp_instances')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('temp_instance_id', tempId)
    .eq('company_id', companyId);
  if (error) throw new QrSessionError('temp_update_failed', 500, 'Erro ao preparar a conexão');
}

async function queryOpen(svc, companyId, instanceName, tempInstanceId) {
  let query = svc
    .from('whatsapp_temp_instances')
    .select('temp_instance_id, instance_name, company_id, uazapi_name, uazapi_instance_id, uazapi_token, status, qrcode, paircode, updated_at, remote_init_state')
    .eq('company_id', companyId)
    .in('status', OPEN_STATUSES);
  query = tempInstanceId
    ? query.eq('temp_instance_id', tempInstanceId)
    : query.eq('instance_name', instanceName);
  return query.order('updated_at', { ascending: false }).limit(1).maybeSingle();
}

export async function findOpenTemp(svc, companyId, instanceName, tempInstanceId) {
  if (tempInstanceId) {
    const byId = await queryOpen(svc, companyId, instanceName, tempInstanceId);
    if (byId.error) throw new QrSessionError('temp_lookup_failed', 503, 'Não foi possível verificar a conexão');
    if (byId.data?.instance_name === instanceName) return byId.data;
  }
  const byName = await queryOpen(svc, companyId, instanceName, null);
  if (byName.error) throw new QrSessionError('temp_lookup_failed', 503, 'Não foi possível verificar a conexão');
  return byName.data ?? null;
}

export function uazapiName(companyId, instanceName, tempId) {
  const slug = instanceName.replace(/[^a-zA-Z0-9]/g, '');
  return `${companyId.slice(0, 8)}_${slug}_${tempId.slice(0, 8)}`;
}

export function publicRecovery(tempId, instanceName, companyId, status) {
  if (!tempId) return undefined;
  return {
    temp_instance_id: tempId,
    instance_name: instanceName,
    company_id: companyId,
    status,
  };
}

export function isUniqueViolation(error) {
  return error?.code === '23505';
}

export function classifyOpen(row) {
  if (!row) return 'absent';
  if (row.remote_init_state === 'reserved') return 'reserved';
  if (row.remote_init_state === 'confirmed') return 'confirmed';
  if (row.remote_init_state === 'failed') return 'failed';
  return 'unknown';
}

export function initResponseKind(status, hasCredentials) {
  if (status === 200 && hasCredentials) return 'confirmed';
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408) return 'failed';
  return 'unknown';
}

export async function beginRemoteInit(svc, companyId, tempId, nowIso) {
  const result = await svc
    .from('whatsapp_temp_instances')
    .update({
      remote_init_state: 'unknown',
      init_started_at: nowIso,
      updated_at: nowIso,
    })
    .eq('company_id', companyId)
    .eq('temp_instance_id', tempId)
    .eq('remote_init_state', 'reserved')
    .select('temp_instance_id');
  if (result?.error) return { ok: false, won: false };
  return { ok: true, won: Array.isArray(result?.data) && result.data.length === 1 };
}

const MISSING = { ok: false, missing: true };
const FAILED = { ok: false, missing: false };

export function isMissingClaim(error) {
  if (!error) return false;
  const message = `${error.message || ''} ${error.details || ''}`;
  return error.code === 'PGRST202'
    || error.code === '42883'
    || message.includes('claim_whatsapp_temp_open');
}

export async function claimOpenTemp(svc, input) {
  let result;
  try {
    result = await svc.rpc('claim_whatsapp_temp_open', {
      p_company_id: input.companyId,
      p_instance_name: input.instanceName,
      p_temp_id: input.tempId,
      p_uazapi_name: input.remoteName,
    });
  } catch (error) {
    return isMissingClaim(error) ? MISSING : FAILED;
  }

  if (result?.error) return isMissingClaim(result.error) ? MISSING : FAILED;
  if (!result?.data?.outcome) return MISSING;
  return { ok: true, data: result.data };
}
