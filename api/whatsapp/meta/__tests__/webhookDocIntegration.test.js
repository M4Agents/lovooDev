// =============================================================================
// webhookDocIntegration.test.js  (INBOUND-DOC-D)
//
// Testes de INTEGRAÇÃO SIMULADA — webhook.js + inboundMediaProcessor.js reais.
//
// DIFERENÇA CRÍTICA em relação a webhook.test.js (W-DOC):
//   webhook.test.js:  inboundMediaProcessor mockado → valida somente contrato de interface
//   este arquivo:     inboundMediaProcessor REAL   → valida fluxo end-to-end simulado
//
// COMPONENTES REAIS:
//   api/whatsapp/meta/webhook.js
//   api/lib/meta-whatsapp/inboundMediaProcessor.js
//   file-type (fileTypeFromBlob com bytes reais de PDF)
//
// FRONTEIRAS MOCKADAS:
//   graphClient.js        — downloadMediaMetadata, downloadMediaBytes
//   tokenCrypto.js        — decryptMetaToken
//   supabaseAdmin.js      — svc (from + rpc + storage)
//   verifyWebhookSignature.js — readRawBody, verifyMetaWebhookSignature
//   config.js             — getMetaServerConfig, getMetaWebhookConfig
//
// COBERTURA:
//   D-01 — caminho feliz: webhook + processor juntos → asset criado, RPC OK
//   D-02 — source_ref reuse: CML precheck HIT, early dedupe MISS → asset reutilizado
//   D-03 — storage failure propagation → 500 transiente, zero RPC, res sanitizada
//
// NÃO DUPLICA:
//   batch safety, document.id ausente, too_large, type_mismatch, credential_missing,
//   metadata_failure, download_timeout, image/video skip, url_invalid — cobertos em W-DOC.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks — DEVEM PRECEDER O IMPORT DO HANDLER (vi.mock é hoisted)
// =============================================================================

// ── Signature / config (padrão do projeto) ───────────────────────────────────
const mockReadRawBody               = vi.fn();
const mockVerifyMetaWebhookSignature = vi.fn();
vi.mock('../../../lib/meta-whatsapp/verifyWebhookSignature.js', () => ({
  readRawBody:                (...args) => mockReadRawBody(...args),
  verifyMetaWebhookSignature: (...args) => mockVerifyMetaWebhookSignature(...args),
}));

const mockGetMetaServerConfig  = vi.fn();
const mockGetMetaWebhookConfig = vi.fn();
vi.mock('../../../lib/meta-whatsapp/config.js', () => ({
  getMetaServerConfig:  (...args) => mockGetMetaServerConfig(...args),
  getMetaWebhookConfig: (...args) => mockGetMetaWebhookConfig(...args),
}));

// ── Graph API (fronteira externa — sem fetch real, sem CDN real) ──────────────
// ATENÇÃO: graphClient.js é mockado, mas inboundMediaProcessor.js NÃO.
// O processor importa downloadMediaMetadata/downloadMediaBytes de graphClient.js —
// o mock aqui substitui ambas as funções para o processor também.
const mockDownloadMediaMetadata = vi.fn();
const mockDownloadMediaBytes    = vi.fn();
vi.mock('../../../lib/meta-whatsapp/graphClient.js', () => ({
  downloadMediaMetadata: (...args) => mockDownloadMediaMetadata(...args),
  downloadMediaBytes:    (...args) => mockDownloadMediaBytes(...args),
}));

// ── Token decrypt (sem criptografia real, sem .env) ───────────────────────────
const mockDecryptMetaToken = vi.fn();
vi.mock('../../../lib/meta-whatsapp/tokenCrypto.js', () => ({
  decryptMetaToken: (...args) => mockDecryptMetaToken(...args),
}));

// ── Supabase mock compartilhado — atende webhook E processor ─────────────────
// O svc é obtido via getSupabaseAdmin() no webhook e passado como parâmetro
// para downloadAndStoreInboundMedia. Logo um único mockSvc cobre ambos.
// Roteamento explícito por tableName em setupIntegrationMocks evita
// dependência frágil de sequência de mockReturnValueOnce.
const mockStorageUpload    = vi.fn();
const mockStoragePublicUrl = vi.fn();
const mockStorageRemove    = vi.fn();
const mockSingle           = vi.fn();
const mockSelectForInsert  = vi.fn();
const mockCmlInsert        = vi.fn();

const mockSvc = {
  from:    vi.fn(),
  rpc:     vi.fn(),
  storage: { from: vi.fn() },
};

vi.mock('../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

// ── CRÍTICO: inboundMediaProcessor.js NÃO é mockado ──────────────────────────
// Se for adicionado um vi.mock para inboundMediaProcessor.js aqui,
// este teste perde valor e vira duplicata de W-DOC. Não adicionar.

// file-type: NÃO mockado — fileTypeFromBlob real detecta bytes reais de PDF.

import handler from '../webhook.js';

// =============================================================================
// Fixtures — todos fictícios, sem tokens/IDs reais
// =============================================================================

const FAKE_APP_SECRET       = 'meta_app_secret_integration_fake_not_real_xxxxxxx';
const FAKE_VERIFY_TOKEN     = 'meta_webhook_token_integration_fake_not_real_xxxxx';
const FAKE_PHONE_NUM_ID     = '106540352242922';
const FAKE_INSTANCE_ID      = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_COMPANY_ID       = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_ASSET_ID         = 'eeee0000-0000-0000-0000-000000000005';
const FAKE_WAMID            = 'wamid.INTG_DOC_FAKE_FOR_TESTS_ONLY_xxxxxxxxxxxxxxxxxxx';
const FAKE_MEDIA_ID         = '123456789012345';
const FAKE_PLAIN_TOKEN      = 'plain_token_integration_fake_for_tests_only_xxxxxxxxxxx';
const FAKE_ACCESS_TOKEN_ENC = 'encrypted_token_integration_fake_for_tests_only_xxxxxxx';
const FAKE_CDN_URL          = 'https://cdn.fbcdn.net/fake-integration-document-fixture.pdf';
const FAKE_PUBLIC_URL       = 'https://storage.example.com/biblioteca/companies/fake/doc.pdf';
const FAKE_WA_ID            = '5511987654321';
const FAKE_CONTACT_NAME     = 'Contato Integracao Ficticio';

// FAKE_INSTANCE representa somente as colunas reais de meta_whatsapp_instances.
// access_token_enc pertence a meta_whatsapp_credentials (tabela separada 1:1).
const FAKE_INSTANCE = {
  id:         FAKE_INSTANCE_ID,
  company_id: FAKE_COMPANY_ID,
};

// ── PDF fixture mínimo para fileTypeFromBlob real ─────────────────────────────
// file-type detecta application/pdf pelos magic bytes '%PDF' (0x25 0x50 0x44 0x46).
// 8 bytes são suficientes — sem criar arquivo em disco.
// Tamanho (8 bytes) << maxBytes (5 MB) → nenhuma falha de limite.
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]); // %PDF-1.4
const PDF_BLOB  = new Blob([PDF_MAGIC], { type: 'application/pdf' });

// =============================================================================
// Helpers — chains de mock
// =============================================================================

/** Chain para meta_whatsapp_instances: select().eq().is().maybeSingle() */
function makeInstChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    is:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

/** Chain para meta_whatsapp_credentials: select().eq().maybeSingle() */
function makeCredentialChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

// Captura da última credentialChain criada para assertions de .eq()
let lastCredentialChain = null;

/**
 * Chain para meta_messages (early dedupe DOC.2):
 * select('id').eq('instance_id', ...).eq('meta_message_id', ...).maybeSingle()
 */
function makeDedupeChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

/**
 * Chain para CML precheck do processor:
 * select('id, mime_type, file_size, original_filename')
 *   .eq('company_id', ...).eq('source_ref', ...).maybeSingle()
 *
 * data=null → MISS (prosseguir download).
 * data={id,...} → HIT (retornar asset existente — reuse path).
 */
function makeCmlPrecheckChain(data) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

/** Payload completo com type='document'. */
function makeDocumentPayload({
  messages = null,
  contacts = null,
  phoneId  = FAKE_PHONE_NUM_ID,
} = {}) {
  const msgs = messages ?? [{
    id:        FAKE_WAMID,
    from:      FAKE_WA_ID,
    type:      'document',
    timestamp: '1739321024',
    document:  { id: FAKE_MEDIA_ID, filename: 'report.pdf', mime_type: 'application/pdf' },
  }];
  const ctxs = contacts ?? [{ wa_id: FAKE_WA_ID, profile: { name: FAKE_CONTACT_NAME } }];
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'entry-integration-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550783881', phone_number_id: phoneId },
          messages: msgs,
          contacts: ctxs,
        },
      }],
    }],
  };
}

/** Request POST mínimo. */
function makePostReq() {
  return {
    method:  'POST',
    headers: { 'x-hub-signature-256': 'sha256=fakesignature' },
    query:   {},
  };
}

/** Res mock com captura de status e body. */
function makeRes() {
  return {
    _status: null,
    _body:   null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body = body;   return this; },
    send(body)   { this._body = body;   return this; },
  };
}

// =============================================================================
// Setup por teste — roteamento explícito por tabela
// =============================================================================

/**
 * Configura mockSvc.from com roteamento explícito por tableName.
 * Elimina dependência de ordem de mockReturnValueOnce.
 *
 * @param {object} opts
 * @param {object|null} opts.cmlPrecheckData
 *   null  → MISS (prosseguir download + Storage + CML insert)
 *   object → HIT  (retornar asset existente, zero Graph/Storage/CML insert)
 * @param {object|null} opts.storageUploadError
 *   null → Storage upload OK
 *   {...} → Storage upload falha (simula inbound_media_storage_failed)
 */
function setupIntegrationMocks({ cmlPrecheckData = null, storageUploadError = null } = {}) {
  if (storageUploadError !== null) {
    mockStorageUpload.mockResolvedValue({ error: storageUploadError });
  }

  let cmlCallIdx = 0; // fechamento por chamada — reset automático por teste

  mockSvc.from.mockImplementation((tableName) => {
    switch (tableName) {
      case 'meta_whatsapp_instances':
        // Tenant resolution — somente id e company_id (schema real)
        return makeInstChain(FAKE_INSTANCE);

      case 'meta_whatsapp_credentials':
        // Credential lookup (DOC.3) — fonte canônica separada da instance
        lastCredentialChain = makeCredentialChain({ access_token_enc: FAKE_ACCESS_TOKEN_ENC });
        return lastCredentialChain;

      case 'meta_messages':
        // DOC.2 early dedupe — sempre MISS neste conjunto de testes
        // (dedupe HIT já coberto em W-DOC-03; aqui precisamos que o processor execute)
        return makeDedupeChain(null);

      case 'company_media_library':
        cmlCallIdx++;
        if (cmlCallIdx === 1) {
          // Primeira chamada: precheck do processor (idempotência source_ref)
          return makeCmlPrecheckChain(cmlPrecheckData);
        }
        // Segunda chamada: INSERT (somente se precheck miss + storage ok)
        return { insert: mockCmlInsert };

      default:
        // Qualquer tabela inesperada revela nova query não prevista → falha explícita
        throw new Error(`[webhookDocIntegration] Tabela inesperada: "${tableName}"`);
    }
  });
}

// =============================================================================
// beforeEach — defaults estáticos (reset completo pós vi.resetAllMocks)
// =============================================================================

beforeEach(() => {
  vi.resetAllMocks();

  // Config
  mockGetMetaServerConfig.mockReturnValue({ appSecret: FAKE_APP_SECRET });
  mockGetMetaWebhookConfig.mockReturnValue({ verifyToken: FAKE_VERIFY_TOKEN });
  mockVerifyMetaWebhookSignature.mockReturnValue(true);

  // Token
  mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);

  // Graph (URL real nunca chega — mocked aqui)
  mockDownloadMediaMetadata.mockResolvedValue({
    url:       FAKE_CDN_URL,
    mime_type: 'application/pdf',
    sha256:    null,
    file_size: PDF_BLOB.size,
  });
  // downloadMediaBytes retorna Blob com bytes reais de PDF — fileTypeFromBlob NÃO mockado
  mockDownloadMediaBytes.mockResolvedValue(PDF_BLOB);

  // Storage
  mockStorageUpload.mockResolvedValue({ error: null });
  mockStoragePublicUrl.mockReturnValue({ data: { publicUrl: FAKE_PUBLIC_URL } });
  mockStorageRemove.mockResolvedValue({ error: null });
  mockSvc.storage.from.mockReturnValue({
    upload:       mockStorageUpload,
    getPublicUrl: mockStoragePublicUrl,
    remove:       mockStorageRemove,
  });

  // CML insert chain: insert({...}).select('id').single()
  mockSingle.mockResolvedValue({ data: { id: FAKE_ASSET_ID }, error: null });
  mockSelectForInsert.mockReturnValue({ single: mockSingle });
  mockCmlInsert.mockReturnValue({ select: mockSelectForInsert });

  // RPC default
  mockSvc.rpc.mockResolvedValue({ data: { created: true }, error: null });
});

// =============================================================================
// D-01..03 — Integração webhook + inboundMediaProcessor (INBOUND-DOC-D)
// =============================================================================

describe('INBOUND-DOC-D — integração webhook + inboundMediaProcessor', () => {

  // D-01 — caminho feliz ─────────────────────────────────────────────────────
  it('D-01 | caminho feliz: webhook + processor juntos → asset criado, RPC OK, HTTP 200', async () => {
    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupIntegrationMocks();

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    // (1) HTTP 200
    expect(res._status).toBe(200);

    // (2) downloadMediaMetadata recebe o mediaId exato do payload
    //     (não alterado pelo webhook nem pelo processor)
    expect(mockDownloadMediaMetadata).toHaveBeenCalledOnce();
    const [metaToken, metaMediaId] = mockDownloadMediaMetadata.mock.calls[0];
    expect(metaMediaId).toBe(FAKE_MEDIA_ID);
    // token é o plain token decriptado — nunca o enc
    expect(metaToken).toBe(FAKE_PLAIN_TOKEN);

    // (3) Storage upload ocorreu exatamente uma vez
    expect(mockStorageUpload).toHaveBeenCalledOnce();

    // (4) CML insert contém campos obrigatórios com valores corretos do servidor
    //     company_id e source_ref devem vir do banco (instance.company_id) e do wamid do payload
    expect(mockCmlInsert).toHaveBeenCalledOnce();
    const insertedDoc = mockCmlInsert.mock.calls[0][0];
    expect(insertedDoc.company_id).toBe(FAKE_COMPANY_ID);                    // do DB, não do payload
    expect(insertedDoc.source_ref).toBe(`meta-inbound:${FAKE_WAMID}`);       // wamid real do payload
    expect(insertedDoc.file_type).toBe('document');                           // expectedMediaType.toLowerCase()
    expect(insertedDoc.mime_type).toBe('application/pdf');                    // REAL fileTypeFromBlob detecção
    expect(insertedDoc.created_by).toBeNull();                                // system ingestion
    expect(insertedDoc.file_size).toBe(PDF_BLOB.size);                        // tamanho real do Blob

    // (5) RPC recebe parâmetros corretos — tenant sempre do banco
    expect(mockSvc.rpc).toHaveBeenCalledOnce();
    const [rpcName, rpcArgs] = mockSvc.rpc.mock.calls[0];
    expect(rpcName).toBe('process_meta_inbound_media_message');
    expect(rpcArgs.p_company_id).toBe(FAKE_COMPANY_ID);                      // do banco, não do payload
    expect(rpcArgs.p_instance_id).toBe(FAKE_INSTANCE_ID);                    // do banco, não do payload
    expect(rpcArgs.p_meta_message_id).toBe(FAKE_WAMID);                      // wamid do payload
    expect(rpcArgs.p_media_asset_id).toBe(FAKE_ASSET_ID);                    // retornado pelo processor real
    expect(rpcArgs.p_message_type).toBe('document');

    // (6) CRED-01: credential lookup usou instance.id do banco (não do payload)
    expect(lastCredentialChain).not.toBeNull();
    expect(lastCredentialChain.eq).toHaveBeenCalledWith('instance_id', FAKE_INSTANCE_ID);
    // decrypt recebeu o access_token_enc da credencial (não de instance)
    expect(mockDecryptMetaToken).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN_ENC);
  });

  // D-02 — source_ref reuse ──────────────────────────────────────────────────
  it('D-02 | source_ref reuse: early dedupe MISS + CML precheck HIT → zero Graph/Storage/insert, RPC OK', async () => {
    // Cenário: meta_message ainda não existe (early dedupe MISS — wamid novo para o webhook)
    // mas o asset já foi criado por um processamento anterior (precheck HIT no processor).
    // Prova: processor retorna o asset existente via source_ref, webhook chama RPC com ele.
    const existingAsset = {
      id:                FAKE_ASSET_ID,
      mime_type:         'application/pdf',
      file_size:         2048,
      original_filename: 'report-existente.pdf',
    };

    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupIntegrationMocks({ cmlPrecheckData: existingAsset });

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    // (1) HTTP 200
    expect(res._status).toBe(200);

    // (2) downloadMediaMetadata NÃO chamado — precheck hit antes do Graph
    expect(mockDownloadMediaMetadata).not.toHaveBeenCalled();

    // (3) downloadMediaBytes NÃO chamado
    expect(mockDownloadMediaBytes).not.toHaveBeenCalled();

    // (4) Storage upload NÃO chamado
    expect(mockStorageUpload).not.toHaveBeenCalled();

    // (5) CML insert NÃO chamado — asset reutilizado do precheck
    expect(mockCmlInsert).not.toHaveBeenCalled();

    // (6) RPC É chamado — meta_message ainda precisa ser criada
    expect(mockSvc.rpc).toHaveBeenCalledOnce();
    const [rpcName, rpcArgs] = mockSvc.rpc.mock.calls[0];
    expect(rpcName).toBe('process_meta_inbound_media_message');

    // (7) RPC recebe o assetId do asset existente (retornado pelo precheck real do processor)
    expect(rpcArgs.p_media_asset_id).toBe(FAKE_ASSET_ID);
    expect(rpcArgs.p_company_id).toBe(FAKE_COMPANY_ID);
    expect(rpcArgs.p_message_type).toBe('document');

    // (8) Credential lookup ocorreu com instance.id correto
    expect(lastCredentialChain).not.toBeNull();
    expect(lastCredentialChain.eq).toHaveBeenCalledWith('instance_id', FAKE_INSTANCE_ID);
  });

  // D-03 — storage failure propagation ──────────────────────────────────────
  it('D-03 | storage failure → 500 transiente; zero CML insert; zero RPC; res sanitizada', async () => {
    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupIntegrationMocks({
      storageUploadError: { message: 'Storage service unavailable', statusCode: 503 },
    });

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    // (1) HTTP 500 — inbound_media_storage_failed é classificado como transiente no webhook
    expect(res._status).toBe(500);

    // (2) metadata foi chamada — pipeline chegou até o Graph
    expect(mockDownloadMediaMetadata).toHaveBeenCalledOnce();

    // (3) bytes foram obtidos — pipeline chegou até o download
    expect(mockDownloadMediaBytes).toHaveBeenCalledOnce();

    // (4) Storage upload foi tentado — processor chegou até o Storage
    expect(mockStorageUpload).toHaveBeenCalledOnce();

    // (5) CML insert NÃO ocorreu — upload falhou antes do insert
    expect(mockCmlInsert).not.toHaveBeenCalled();

    // (6) RPC NÃO foi chamado — processamento abortado
    expect(mockSvc.rpc).not.toHaveBeenCalled();

    // (7) Response sanitizada — sem token, URL CDN, ciphertext ou stack trace
    const resBody = JSON.stringify(res._body);
    expect(resBody).not.toContain(FAKE_PLAIN_TOKEN);
    expect(resBody).not.toContain(FAKE_CDN_URL);
    expect(resBody).not.toContain(FAKE_ACCESS_TOKEN_ENC);
    expect(resBody).not.toContain('Authorization');
    expect(resBody).not.toContain('stack');
    // Mensagem genérica segura
    expect(res._body).toMatchObject({ error: 'Internal error' });

    // (8) Credential lookup ocorreu (pipeline chegou ao DOC.3)
    expect(lastCredentialChain).not.toBeNull();
    expect(lastCredentialChain.eq).toHaveBeenCalledWith('instance_id', FAKE_INSTANCE_ID);
  });

});
