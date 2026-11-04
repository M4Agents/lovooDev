// Cria a sessão de QR na UAZAPI usando a credencial administrativa do servidor.
// O token administrativo e o token da instância ficam fora da resposta.
// Uma tentativa repetida reutiliza a instância temporária já aberta.

import { randomUUID } from 'node:crypto';
import { readAdminToken, resolveUazapiBaseUrl } from './adminCredential.js';
import {
  QrSessionError,
  beginRemoteInit,
  claimOpenTemp,
  classifyOpen,
  findOpenTemp,
  initResponseKind,
  markTemp,
  publicRecovery,
  uazapiName,
} from './qrClaim.js';
import { postJson, readQr, webhookUrl } from './qrHttp.js';
import { INIT_CAP_MS, QR_BUDGET_MS, WEBHOOK_CAP_MS, timeoutForStep } from './qrBudget.js';

const QR_TTL_MS = 2 * 60 * 1000;

export { QrSessionError };

function publicPayload(input) {
  const hasQr = Boolean(input.qrcode);
  return {
    success: true,
    data: {
      temp_instance_id: input.tempId,
      qrcode: input.qrcode,
      paircode: input.paircode,
      status: 'connecting',
      message: hasQr ? 'Escaneie o QR Code com seu WhatsApp' : 'Use o código de pareamento no seu WhatsApp',
      connection_method: hasQr ? 'qrcode' : 'paircode',
      expires_at: input.expiresAt,
      instance_name: input.instanceName,
      company_id: input.companyId,
    },
  };
}

async function failWithRecovery(svc, details) {
  if (details.tempId) {
    await markTemp(svc, details.tempId, details.companyId, {
      status: details.rowStatus,
      error_message: details.message,
      ...(details.remoteInitState ? { remote_init_state: details.remoteInitState } : {}),
    }).catch(() => {});
  }
  throw new QrSessionError(details.code, 502, details.message, {
    recovery: publicRecovery(details.tempId, details.instanceName, details.companyId, details.rowStatus),
  });
}

function unknownInit(tempId, instanceName, companyId) {
  return new QrSessionError('init_unknown', 409, 'O resultado da criação anterior ainda não foi confirmado. A mesma operação foi preservada.', {
    recovery: publicRecovery(tempId, instanceName, companyId, 'unknown'),
  });
}

export async function createQrSession(input) {
  const instanceName = typeof input.instanceName === 'string' ? input.instanceName.trim() : '';
  if (!instanceName || instanceName.length > 80) {
    throw new QrSessionError('invalid_name', 400, 'Nome da instância inválido');
  }

  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const clock = input.now ?? (() => new Date());
  const svc = input.svc;
  const budgetMs = input.budgetMs ?? QR_BUDGET_MS;
  const startedAt = clock().getTime();
  const elapsed = () => clock().getTime() - startedAt;

  const plan = await svc.rpc('check_whatsapp_life_plan_limit', { p_company_id: input.companyId });
  if (plan.error) throw new QrSessionError('plan_check_failed', 503, 'Não foi possível verificar o plano');
  if (!plan.data?.canAdd) {
    throw new QrSessionError('plan_limit', 400, 'Limite de instâncias atingido para seu plano', {
      planInfo: {
        canAdd: false,
        currentCount: plan.data?.currentCount ?? null,
        maxAllowed: plan.data?.maxAllowed ?? null,
        remaining: plan.data?.remaining ?? null,
      },
    });
  }

  const existing = await svc
    .from('whatsapp_life_instances')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('instance_name', instanceName)
    .is('deleted_at', null)
    .maybeSingle();
  if (existing.error) throw new QrSessionError('duplicate_check_failed', 503, 'Não foi possível verificar a instância');
  if (existing.data) throw new QrSessionError('duplicate_name', 409, 'Já existe uma instância com este nome');

  let open = await findOpenTemp(svc, input.companyId, instanceName, input.tempInstanceId);
  let phase = classifyOpen(open);
  const updatedAt = Date.parse(open?.updated_at ?? '');
  if (
    phase === 'confirmed'
    && open?.qrcode
    && open.status === 'connecting'
    && !Number.isNaN(updatedAt)
    && updatedAt + QR_TTL_MS > clock().getTime()
  ) {
    return publicPayload({
      tempId: open.temp_instance_id,
      qrcode: open.qrcode,
      paircode: open.paircode ?? null,
      expiresAt: new Date(updatedAt + QR_TTL_MS).toISOString(),
      instanceName,
      companyId: input.companyId,
    });
  }

  if (phase === 'unknown' || phase === 'failed') {
    throw unknownInit(open?.temp_instance_id, instanceName, input.companyId);
  }

  let tempId = open?.temp_instance_id ?? null;
  let remoteName = open?.uazapi_name ?? null;
  let instanceToken = null;
  let remoteId = null;

  if (phase === 'confirmed') {
    if (!open?.uazapi_token || !open?.uazapi_instance_id) {
      throw unknownInit(tempId, instanceName, input.companyId);
    }
    instanceToken = open.uazapi_token;
    remoteId = open.uazapi_instance_id;
  }

  if (phase !== 'confirmed') {
    if (phase === 'absent') {
      tempId = randomUUID();
      remoteName = uazapiName(input.companyId, instanceName, tempId);
      const claim = await claimOpenTemp(svc, {
        companyId: input.companyId,
        instanceName,
        tempId,
        remoteName,
      });
      if (!claim.ok) {
        throw new QrSessionError('temp_claim_unavailable', 503, 'Não foi possível preparar a conexão');
      }
      if (claim.data?.outcome === 'existing') {
        open = await findOpenTemp(svc, input.companyId, instanceName, claim.data.temp_instance_id ?? null);
        tempId = open?.temp_instance_id || claim.data.temp_instance_id || tempId;
        remoteName = open?.uazapi_name || claim.data.uazapi_name || remoteName;
        phase = classifyOpen(open);
        if (phase === 'confirmed' && open?.uazapi_token && open?.uazapi_instance_id) {
          instanceToken = open.uazapi_token;
          remoteId = open.uazapi_instance_id;
        } else if (phase !== 'reserved') {
          throw unknownInit(tempId, instanceName, input.companyId);
        }
      }
      if (claim.data?.outcome === 'created') phase = 'reserved';
      if (phase !== 'reserved' && phase !== 'confirmed') {
        throw new QrSessionError('temp_claim_unavailable', 503, 'Não foi possível preparar a conexão');
      }
    }

    if (!instanceToken && phase === 'reserved') {
      const adminToken = readAdminToken(env);
      const initBaseUrl = resolveUazapiBaseUrl(env);
      const initTimeout = timeoutForStep(elapsed(), INIT_CAP_MS, budgetMs);
      if (initTimeout === 0) {
        throw new QrSessionError('budget_exceeded', 502, 'Não foi possível iniciar a criação. Tente novamente.', {
          recovery: publicRecovery(tempId, instanceName, input.companyId, 'reserved'),
        });
      }
      const gate = await beginRemoteInit(svc, input.companyId, tempId, clock().toISOString());
      if (!gate.ok) throw new QrSessionError('temp_claim_failed', 503, 'Não foi possível preparar a conexão');
      if (!gate.won) throw unknownInit(tempId, instanceName, input.companyId);
      const init = await postJson(
        fetchImpl,
        `${initBaseUrl}/instance/init`,
        { 'Content-Type': 'application/json', admintoken: adminToken, 'User-Agent': 'LovooCRM-QrSession/1.0' },
        { name: remoteName },
        initTimeout,
      ).catch(() => null);
      const kind = initResponseKind(init?.status, Boolean(init?.json?.token && init?.json?.instance?.id));
      if (kind === 'failed') {
        await failWithRecovery(svc, {
          tempId,
          instanceName,
          companyId: input.companyId,
          rowStatus: 'error',
          remoteInitState: 'failed',
          code: 'init_failed',
          message: 'Erro ao criar instância WhatsApp',
        });
      }
      if (kind !== 'confirmed') throw unknownInit(tempId, instanceName, input.companyId);
      instanceToken = init.json.token;
      remoteId = init.json.instance.id;
      await markTemp(svc, tempId, input.companyId, {
        uazapi_instance_id: remoteId,
        uazapi_token: instanceToken,
        status: 'created',
        remote_init_state: 'confirmed',
      });
    }
  }

  const baseUrl = resolveUazapiBaseUrl(env);
  const hook = webhookUrl(env);
  if (hook) {
    const webhookTimeout = timeoutForStep(elapsed(), WEBHOOK_CAP_MS, budgetMs);
    const webhook = webhookTimeout === 0 ? null : await postJson(
      fetchImpl,
      `${baseUrl}/instance/webhook`,
      { 'Content-Type': 'application/json', token: instanceToken, 'User-Agent': 'LovooCRM-QrSession/1.0' },
      { webhook: hook, events: ['connection.update', 'messages.upsert'] },
      webhookTimeout,
    ).catch(() => null);
    if (!webhook || webhook.status !== 200) {
      await svc.from('whatsapp_temp_instances')
        .update({ error_message: 'Webhook não configurado', updated_at: new Date().toISOString() })
        .eq('temp_instance_id', tempId)
        .eq('company_id', input.companyId);
    }
  }

  const connectTimeout = timeoutForStep(elapsed(), budgetMs, budgetMs);
  const connect = connectTimeout === 0 ? null : await postJson(
    fetchImpl,
    `${baseUrl}/instance/connect`,
    { 'Content-Type': 'application/json', token: instanceToken, 'User-Agent': 'LovooCRM-QrSession/1.0' },
    {},
    connectTimeout,
  ).catch(() => null);

  const { qrcode, paircode } = readQr(connect?.json);
  if (!connect || connect.status !== 200 || (!qrcode && !paircode)) {
    await failWithRecovery(svc, {
      tempId,
      instanceName,
      companyId: input.companyId,
      rowStatus: 'created_no_qr',
      code: connect ? 'connect_failed' : 'budget_exceeded',
      message: 'Não foi possível gerar o QR Code. Tente novamente.',
    });
  }

  await markTemp(svc, tempId, input.companyId, { qrcode, paircode, status: 'connecting', error_message: null });
  return publicPayload({
    tempId,
    qrcode,
    paircode,
    expiresAt: new Date(clock().getTime() + QR_TTL_MS).toISOString(),
    instanceName,
    companyId: input.companyId,
  });
}
