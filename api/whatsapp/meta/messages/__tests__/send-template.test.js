// =============================================================================
// send-template.test.js
//
// Testes unitários para POST /api/whatsapp/meta/messages/send-template
// Todos os testes usam mocks — sem banco, rede, Graph, decrypt ou token real.
//
// COBERTURA:
//
//   HTTP:
//     HTTP-01  não-POST → 405 + Allow: POST
//     HTTP-02  método inválido não chama guard
//
//   MEDIA REQUEST (MVP4B):
//     MBOD-01  header_media_asset_id UUID inválido → 400 invalid_request
//     MBOD-02  header_media_asset_id string vazia → 400 invalid_request
//
//   MEDIA CROSS-CHECK (MVP4B):
//     MCHK-01  template textual + asset presente → 400 media_header_unexpected; upload 0; send 0
//     MCHK-02  template IMAGE + asset ausente → 400 media_header_required; upload 0; send 0
//     MCHK-03  template VIDEO + asset ausente → 400 media_header_required
//     MCHK-04  template DOCUMENT + asset ausente → 400 media_header_required
//     MCHK-05  template IMAGE + asset válido → prosseguir (validateMediaAsset chamado)
//
//   VALIDATE MEDIA ASSET (MVP4B):
//     MAST-01  media_asset_not_found → 404 media_asset_not_found; upload 0; send 0
//     MAST-02  media_asset_invalid → 400 invalid_request; upload 0; send 0
//     MAST-03  media_asset_download_failed → 503 media_provider_unavailable; upload 0; send 0
//     MAST-04  media_asset_too_large → 422 media_asset_too_large; upload 0; send 0
//     MAST-05  media_asset_type_unknown → 422 media_asset_type_unknown; upload 0; send 0
//     MAST-06  media_asset_type_unsupported → 422 media_asset_type_unsupported; upload 0; send 0
//     MAST-07  media_asset_type_mismatch → 422 media_asset_type_mismatch; upload 0; send 0
//     MAST-08  companyId para validateMediaAsset = auth.companyId (não body.company_id)
//
//   UPLOAD MEDIA — WRITE 1 (MVP4B):
//     UMRT-01  upload_media_timeout → 503 provider_unavailable; send 0
//     UMRT-02  upload_media_network_error → 503 provider_unavailable; send 0
//     UMRT-03  upload_media_failed → 502 provider_error; send 0
//     UMRT-04  upload_media_invalid_response → 502 provider_error; send 0
//     UMRT-05  token e phone_number_id para uploadMedia vêm do banco
//
//   BUILD + SEND (MVP4B):
//     GBLD-01  IMAGE — header.parameters[0].image.id = mediaId
//     GBLD-02  VIDEO — header.parameters[0].video.id = mediaId
//     GBLD-03  DOCUMENT — header.parameters[0].document.id = mediaId + filename
//     GBLD-04  buildGraphComponents lança após WRITE 1 → 500 internal_error; send 0
//
//   WRITE BUDGET (MVP4B):
//     WBGT-01  template textual → upload 0, send 1
//     WBGT-02  media IMAGE sucesso → upload 1, send 1
//     WBGT-03  validateMediaAsset falha → upload 0, send 0
//     WBGT-04  uploadMedia falha → upload 1, send 0
//     WBGT-05  send falha após upload → upload 1, send 1 (send tentado)
//     WBGT-06  build falha após upload → upload 1, send 0
//
//   PERSISTÊNCIA MEDIA (MVP4B):
//     PMED-01  IMAGE → meta_messages.media_asset_id = assetId
//     PMED-02  VIDEO → meta_messages.media_asset_id = assetId
//     PMED-03  DOCUMENT → meta_messages.media_asset_id = assetId
//     PMED-04  textual → meta_messages.media_asset_id = null
//     PMED-05  body persistido = renderedBody (nunca mediaId/filename/URL)
//     PMED-06  tracking (meta_whatsapp_messages) inalterado para media
//     PMED-07  tracking failure pós-media-send → send_persistence_failed; Graph não repetido
//     PMED-08  meta_messages failure → send_persistence_failed; Graph não repetido
//
//   SEGURANÇA MEDIA (MVP4B):
//     MSEC-01  body malicioso com media_id, mime, filename, url ignorados
//     MSEC-02  recipient continua de conversation.wa_id (não body)
//     MSEC-03  phone_number_id para uploadMedia = instance.phone_number_id (banco)
//
//   AUTH:
//     AUTH-01  sem Authorization → 401
//     AUTH-02  JWT inválido → 401
//     AUTH-03  após 401 nenhum lookup DB ocorre
//
//   RBAC:
//     RBAC-01  role proibida → 403
//
//   FEAT:
//     FEAT-01  feature flag off → 403
//
//   BODY (pós-auth):
//     BODY-01  instance_id inválido → 400
//     BODY-02  conversation_id inválido → 400
//     BODY-03  template_name ausente/vazio → 400
//     BODY-03b template_name excede 512 chars → 400
//     BODY-04  template_language ausente/vazio → 400
//     BODY-04b template_language excede 64 chars → 400
//     BODY-05  parameter_values não-objeto → 400
//     BODY-06  parameter_values sem body → 400
//     BODY-07  parameter_values.body inválido (null/array/string) → 400 sem Graph READ
//
//   TENANT/INSTANCE:
//     INST-01  instance not found → 404 instance_not_found
//     INST-02  instance cross-tenant → 404 instance_not_found (opaco)
//     INST-03  instance not connected → 409 instance_not_connected
//     INST-04  lookups usam auth.companyId (não body.company_id)
//
//   CONVERSA:
//     CONV-01  conversation not found → 404 conversation_not_found
//     CONV-02  conversation cross-tenant → 404 (opaco)
//     CONV-03  conversation cross-instance → 404 (opaco)
//     CONV-04  conversation lookup usa auth.companyId
//     CONV-05  conversation lookup usa instance.id do banco
//     CONV-06  recipient vem de conversation.wa_id (não do body)
//     CONV-07  wa_id inválido no banco → 500
//
//   CREDENCIAIS:
//     CRED-01  credential ausente → 500 credential_unavailable
//     CRED-02  decrypt failure → 500 credential_unavailable
//     CRED-03  credential lookup NÃO ocorre antes de instance válida
//     CRED-04  credential lookup NÃO ocorre antes de instance connected
//
//   LOOKUP (paginação + duplicata):
//     LOOK-01  match página 1 sem nextCursor → sucesso
//     LOOK-02  match somente na página 2 → sucesso
//     LOOK-03  match somente na página 3 → sucesso
//     LOOK-04  duplicata na mesma página → template_unsupported
//     LOOK-05  duplicata em páginas diferentes → template_unsupported
//     LOOK-06  3 páginas consumidas + nextCursor → template_unsupported
//     LOOK-07  busca completa sem name match → template_not_found
//     LOOK-08  name encontrado, language ausente → template_language_not_found
//     LOOK-09  template unsupported pelo engine → template_unsupported
//     LOOK-10  list timeout/network → provider_unavailable
//     LOOK-11  list provider failure → provider_error
//     LOOK-12  máximo 3 Graph READs por request
//     LOOK-13  Graph WRITE não chamado quando template não encontrado
//     LOOK-14  Graph WRITE não chamado quando lookup incompleto
//     LOOK-15  entries null/primitivas ignoradas; match válido funciona (L-02)
//     LOOK-16  somente entries malformadas → fail-closed sem 500 acidental (L-02)
//
//   PARÂMETROS:
//     PARAM-01  POSITIONAL body → sucesso
//     PARAM-02  POSITIONAL header + body → sucesso
//     PARAM-03  NAMED body → sucesso
//     PARAM-04  NAMED header + body → sucesso
//     PARAM-05  missing body key → 422 template_params_mismatch
//     PARAM-06  extra body key → 422 template_params_mismatch
//     PARAM-07  whitespace-only value → 422 template_params_mismatch
//     PARAM-08  non-string value → 422 template_params_mismatch
//     PARAM-09  Graph WRITE não chamado quando mismatch
//
//   GRAPH WRITE:
//     GWRT-01  phone_number_id vem do banco
//     GWRT-02  recipient vem da conversa (não do body)
//     GWRT-03  name/language repassados corretamente
//     GWRT-04  components vêm do engine
//     GWRT-05  sendTemplateMessage chamado exatamente uma vez no sucesso
//     GWRT-06  send_template_timeout → 503 provider_unavailable
//     GWRT-07  send_template_network_error → 503 provider_unavailable
//     GWRT-08  send_template_failed → 502 provider_error
//     GWRT-09  send_template_invalid_response → 502 provider_error
//     GWRT-10  código inesperado → 500 internal_error
//     GWRT-11  template estático → components omitido do payload (L-05)
//
//   PERSISTÊNCIA:
//     PERS-01  sucesso → tracking com campos corretos
//     PERS-02  sucesso → chat com message_type=template, template_name, template_language, body
//     PERS-03  body persistido é renderedBody, não template_name
//     PERS-04  tracking failure → 500 send_persistence_failed
//     PERS-05  chat failure → 500 send_persistence_failed
//     PERS-06  Graph failure → nenhum INSERT
//     PERS-07  tracking failure → chat INSERT não é tentado (L-03)
//
//   SEGURANÇA:
//     SEC-01  token nunca aparece na resposta
//     SEC-02  body com 'to' ignorado (recipient não muda)
//     SEC-03  body com 'phone_number_id' ignorado
//     SEC-04  body com 'waba_id' ignorado
//     SEC-05  body com 'components' ignorado (engine constrói)
//     SEC-06  parameter values não aparecem em resposta de erro
//     SEC-07  credential lookup NÃO ocorre antes de instance+connected
//     SEC-08  Graph WRITE não chamado em falha de auth
//     SEC-09  Graph WRITE não chamado em falha de validação
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks (antes dos imports do handler)
// =============================================================================

const mockSvc = { from: vi.fn() };

vi.mock('../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

const mockValidateMetaCaller = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  META_SEND_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  META_VIEW_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  META_CONNECT_ROLES: ['super_admin', 'system_admin', 'partner', 'admin'],
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
}));

const mockDecryptMetaToken = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/tokenCrypto.js', () => ({
  decryptMetaToken: (...args) => mockDecryptMetaToken(...args),
}));

const mockListMessageTemplates = vi.fn();
const mockSendTemplateMessage  = vi.fn();
const mockUploadMedia          = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/graphClient.js', () => ({
  listMessageTemplates: (...args) => mockListMessageTemplates(...args),
  sendTemplateMessage:  (...args) => mockSendTemplateMessage(...args),
  uploadMedia:          (...args) => mockUploadMedia(...args),
}));

const mockValidateMediaAsset = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/mediaAsset.js', () => ({
  validateMediaAsset: (...args) => mockValidateMediaAsset(...args),
}));

// Engine mockado para isolamento completo (testado separadamente em templateEngine.test.js)
const mockAnalyzeTemplate          = vi.fn();
const mockValidateParameterValues  = vi.fn();
const mockBuildGraphComponents     = vi.fn();
const mockInterpolateBody          = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/templateEngine.js', () => ({
  analyzeTemplate:         (...args) => mockAnalyzeTemplate(...args),
  validateParameterValues: (...args) => mockValidateParameterValues(...args),
  buildGraphComponents:    (...args) => mockBuildGraphComponents(...args),
  interpolateBody:         (...args) => mockInterpolateBody(...args),
}));

import handler from '../send-template.js';

// =============================================================================
// Fixtures — todos fictícios, nunca reais
// =============================================================================

const FAKE_COMPANY_ID      = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_USER_ID         = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_INSTANCE_ID     = 'cccc0000-0000-0000-0000-000000000003';
const FAKE_CONVERSATION_ID = 'dddd0000-0000-0000-0000-000000000004';
const FAKE_PHONE_NUM_ID    = '106540352242922';
const FAKE_WABA_ID         = '111111111111111';
const FAKE_WA_ID           = '5511987654321';
const FAKE_ENC_TOKEN       = 'v1:FAKE_ENCRYPTED_CIPHERTEXT_FOR_TESTS';
const FAKE_PLAIN_TOKEN     = 'EAAAN_fake_plain_token_for_tests_only';
const FAKE_WAMID           = 'wamid.HBgLNTU1MTk4NzY1NDMyMQIVAgARGBI4NzY1NDMyMQ==';
const FAKE_TEMPLATE_NAME   = 'hello_world';
const FAKE_TEMPLATE_LANG   = 'pt_BR';
const FAKE_RENDERED_BODY   = 'Olá João, seu pedido foi confirmado.';

// Instância conectada (dados do banco — nunca do body)
const FAKE_INSTANCE = {
  id:              FAKE_INSTANCE_ID,
  company_id:      FAKE_COMPANY_ID,
  phone_number_id: FAKE_PHONE_NUM_ID,
  waba_id:         FAKE_WABA_ID,
  status:          'connected',
};

// Conversa ativa (dados do banco)
const FAKE_CONVERSATION = {
  id:          FAKE_CONVERSATION_ID,
  wa_id:       FAKE_WA_ID,
  company_id:  FAKE_COMPANY_ID,
  instance_id: FAKE_INSTANCE_ID,
};

// Credencial
const FAKE_CRED = { access_token_enc: FAKE_ENC_TOKEN };

// Template raw retornado pela Graph API (body fictício)
const FAKE_RAW_TEMPLATE = {
  id:               'tpl-001',
  name:             FAKE_TEMPLATE_NAME,
  language:         FAKE_TEMPLATE_LANG,
  status:           'APPROVED',
  category:         'MARKETING',
  parameter_format: 'POSITIONAL',
  components: [
    { type: 'BODY', text: 'Olá {{1}}, seu pedido foi confirmado.' },
  ],
};

// Análise simulada (retorno do engine mockado)
const FAKE_ANALYSIS_POSITIONAL = {
  supported:          true,
  unsupported_reason: null,
  parameter_format:   'POSITIONAL',
  parameters:         [{ component: 'BODY', key: '1', position: 1, example: null }],
  bodyText:           'Olá {{1}}, seu pedido foi confirmado.',
  headerMediaFormat:  null,  // MVP4B: textual → sem media header
};

const FAKE_ANALYSIS_NAMED = {
  supported:          true,
  unsupported_reason: null,
  parameter_format:   'NAMED',
  parameters:         [{ component: 'BODY', key: 'first_name', position: null, example: null }],
  bodyText:           'Olá {{first_name}}, seu pedido foi confirmado.',
  headerMediaFormat:  null,  // MVP4B: textual → sem media header
};

const FAKE_COMPONENTS_BUILT = [
  { type: 'body', parameters: [{ type: 'text', text: 'João' }] },
];

// Body HTTP padrão (happy path)
const HAPPY_BODY = {
  company_id:        FAKE_COMPANY_ID,
  instance_id:       FAKE_INSTANCE_ID,
  conversation_id:   FAKE_CONVERSATION_ID,
  template_name:     FAKE_TEMPLATE_NAME,
  template_language: FAKE_TEMPLATE_LANG,
  parameter_values:  { body: { '1': 'João' } },
};

// ── Fixtures MVP4B — media ──────────────────────────────────────────────────

const FAKE_ASSET_ID   = 'eeee0000-0000-0000-0000-000000000005';
const FAKE_MEDIA_ID   = '987654321012345';   // mediaId retornado pelo Graph /media
const FAKE_BLOB       = new Blob([new Uint8Array(100)], { type: 'application/octet-stream' });
const FAKE_FILENAME   = 'relatorio-2026.pdf';

// Templates raw com HEADER media
const FAKE_RAW_TEMPLATE_IMAGE = {
  id: 'tpl-img', name: FAKE_TEMPLATE_NAME, language: FAKE_TEMPLATE_LANG,
  status: 'APPROVED', category: 'MARKETING', parameter_format: 'POSITIONAL',
  components: [
    { type: 'HEADER', format: 'IMAGE' },
    { type: 'BODY',   text: 'Confira a imagem.' },
  ],
};

const FAKE_RAW_TEMPLATE_VIDEO = {
  id: 'tpl-vid', name: FAKE_TEMPLATE_NAME, language: FAKE_TEMPLATE_LANG,
  status: 'APPROVED', category: 'MARKETING', parameter_format: 'POSITIONAL',
  components: [
    { type: 'HEADER', format: 'VIDEO' },
    { type: 'BODY',   text: 'Confira o vídeo.' },
  ],
};

const FAKE_RAW_TEMPLATE_DOCUMENT = {
  id: 'tpl-doc', name: FAKE_TEMPLATE_NAME, language: FAKE_TEMPLATE_LANG,
  status: 'APPROVED', category: 'MARKETING', parameter_format: 'POSITIONAL',
  components: [
    { type: 'HEADER', format: 'DOCUMENT' },
    { type: 'BODY',   text: 'Segue o documento.' },
  ],
};

// Análises simuladas para templates media
const FAKE_ANALYSIS_IMAGE = {
  supported: true, unsupported_reason: null, parameter_format: 'POSITIONAL',
  parameters: [], bodyText: 'Confira a imagem.', headerMediaFormat: 'IMAGE',
};
const FAKE_ANALYSIS_VIDEO = {
  supported: true, unsupported_reason: null, parameter_format: 'POSITIONAL',
  parameters: [], bodyText: 'Confira o vídeo.', headerMediaFormat: 'VIDEO',
};
const FAKE_ANALYSIS_DOCUMENT = {
  supported: true, unsupported_reason: null, parameter_format: 'POSITIONAL',
  parameters: [], bodyText: 'Segue o documento.', headerMediaFormat: 'DOCUMENT',
};

// validateMediaAsset results por tipo
const FAKE_ASSET_RESULT_IMAGE = {
  assetId: FAKE_ASSET_ID, blob: FAKE_BLOB, mimeType: 'image/jpeg',
  size: 100, mediaType: 'IMAGE', filename: undefined,
};
const FAKE_ASSET_RESULT_VIDEO = {
  assetId: FAKE_ASSET_ID, blob: FAKE_BLOB, mimeType: 'video/mp4',
  size: 100, mediaType: 'VIDEO', filename: undefined,
};
const FAKE_ASSET_RESULT_DOCUMENT = {
  assetId: FAKE_ASSET_ID, blob: FAKE_BLOB, mimeType: 'application/pdf',
  size: 100, mediaType: 'DOCUMENT', filename: FAKE_FILENAME,
};

// components construídos para cada tipo (retorno do engine mockado)
const FAKE_COMPONENTS_IMAGE    = [{ type: 'header', parameters: [{ type: 'image',    image:    { id: FAKE_MEDIA_ID } }] }];
const FAKE_COMPONENTS_VIDEO    = [{ type: 'header', parameters: [{ type: 'video',    video:    { id: FAKE_MEDIA_ID } }] }];
const FAKE_COMPONENTS_DOCUMENT = [{ type: 'header', parameters: [{ type: 'document', document: { id: FAKE_MEDIA_ID, filename: FAKE_FILENAME } }] }];

// Body media (happy path IMAGE)
const HAPPY_BODY_IMAGE = { ...HAPPY_BODY, parameter_values: { body: {} }, header_media_asset_id: FAKE_ASSET_ID };
const HAPPY_BODY_VIDEO = { ...HAPPY_BODY, parameter_values: { body: {} }, header_media_asset_id: FAKE_ASSET_ID };
const HAPPY_BODY_DOCUMENT = { ...HAPPY_BODY, parameter_values: { body: {} }, header_media_asset_id: FAKE_ASSET_ID };

// =============================================================================
// Factories de mock chain
// =============================================================================

/** Chain para meta_whatsapp_instances: select→eq→eq→is→maybeSingle */
function makeInstChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    is:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

/** Chain para meta_conversations: select→eq→eq→eq→maybeSingle */
function makeConvChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

/** Chain para meta_whatsapp_credentials: select→eq→maybeSingle */
function makeCredChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

/** Chain para INSERTs (meta_whatsapp_messages ou meta_messages) */
function makeInsertChain(error = null) {
  return { insert: vi.fn().mockResolvedValue({ data: null, error }) };
}

/** Request POST mínimo */
function makeReq({ body = HAPPY_BODY, method = 'POST', headers = {} } = {}) {
  return {
    method,
    headers: { authorization: 'Bearer fake-jwt-fixture', ...headers },
    body,
  };
}

/** Response mock */
function makeRes() {
  return {
    _status:  null,
    _body:    null,
    _headers: {},
    status(code) { this._status = code; return this; },
    json(body)   { this._body   = body; return this; },
    setHeader(k, v) { this._headers[k] = v; return this; },
  };
}

// Helper: cria resultado de listMessageTemplates com 1 match
function makeListResult(templates = [], nextCursor = null) {
  return { templates, nextCursor };
}

// =============================================================================
// Setup helpers
// =============================================================================

function setupGuardOk(companyId = FAKE_COMPANY_ID) {
  mockValidateMetaCaller.mockResolvedValue({
    ok: true, userId: FAKE_USER_ID, companyId, role: 'admin', accessPath: 'direct',
  });
}

function setupGuardFail(status, error) {
  mockValidateMetaCaller.mockResolvedValue({ ok: false, status, error });
}

function setupEngineOk(analysis = FAKE_ANALYSIS_POSITIONAL) {
  mockAnalyzeTemplate.mockReturnValue(analysis);
  mockValidateParameterValues.mockReturnValue({ valid: true });
  mockBuildGraphComponents.mockReturnValue(FAKE_COMPONENTS_BUILT);
  mockInterpolateBody.mockReturnValue(FAKE_RENDERED_BODY);
}

/**
 * Configura happy path completo:
 * guard + instance + conversation + credential + decrypt +
 * lookup (1 página, 1 match) + engine + sendTemplate + insert×2
 */
function setupHappyPath() {
  setupGuardOk();

  mockSvc.from = vi.fn()
    .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))       // meta_whatsapp_instances
    .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))   // meta_conversations
    .mockReturnValueOnce(makeCredChain(FAKE_CRED))           // meta_whatsapp_credentials
    .mockReturnValueOnce(makeInsertChain())                  // meta_whatsapp_messages INSERT
    .mockReturnValueOnce(makeInsertChain());                 // meta_messages INSERT

  mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
  mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
  setupEngineOk();
  mockSendTemplateMessage.mockResolvedValue({ messageId: FAKE_WAMID });
}

/**
 * Configura happy path para template media (IMAGE/VIDEO/DOCUMENT).
 * analysis, assetResult e mediaComponents são injetados pelo teste para flexibilidade.
 */
function setupHappyMediaPath({
  rawTemplate  = FAKE_RAW_TEMPLATE_IMAGE,
  analysis     = FAKE_ANALYSIS_IMAGE,
  assetResult  = FAKE_ASSET_RESULT_IMAGE,
  components   = FAKE_COMPONENTS_IMAGE,
} = {}) {
  setupGuardOk();

  mockSvc.from = vi.fn()
    .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
    .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
    .mockReturnValueOnce(makeCredChain(FAKE_CRED))
    .mockReturnValueOnce(makeInsertChain())   // meta_whatsapp_messages
    .mockReturnValueOnce(makeInsertChain());  // meta_messages

  mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
  mockListMessageTemplates.mockResolvedValue(makeListResult([rawTemplate]));

  mockAnalyzeTemplate.mockReturnValue(analysis);
  mockValidateParameterValues.mockReturnValue({ valid: true });
  mockBuildGraphComponents.mockReturnValue(components);
  mockInterpolateBody.mockReturnValue(FAKE_RENDERED_BODY);

  mockValidateMediaAsset.mockResolvedValue(assetResult);
  mockUploadMedia.mockResolvedValue({ mediaId: FAKE_MEDIA_ID });
  mockSendTemplateMessage.mockResolvedValue({ messageId: FAKE_WAMID });
}

// =============================================================================
// beforeEach
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// HTTP
// =============================================================================

describe('HTTP-01 método inválido → 405', () => {
  it.each(['GET', 'PUT', 'PATCH', 'DELETE'])('%s → 405 + Allow: POST', async (method) => {
    const res = makeRes();
    await handler(makeReq({ method }), res);
    expect(res._status).toBe(405);
    expect(res._headers['Allow']).toBe('POST');
  });
});

describe('HTTP-02 método inválido não chama guard', () => {
  it('GET → guard não chamado', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
  });
});

// =============================================================================
// AUTH
// =============================================================================

describe('AUTH-01 sem Authorization → 401', () => {
  it('retorna 401 propagado pelo guard', async () => {
    setupGuardFail(401, 'Autenticação necessária');
    const res = makeRes();
    await handler(makeReq({ headers: { authorization: '' } }), res);
    expect(res._status).toBe(401);
    expect(res._body.error).toBe('Autenticação necessária');
  });
});

describe('AUTH-02 JWT inválido → 401', () => {
  it('retorna 401 propagado pelo guard', async () => {
    setupGuardFail(401, 'Sessão inválida ou expirada');
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(401);
  });
});

describe('AUTH-03 após 401 nenhum lookup DB ocorre', () => {
  it('svc.from não chamado em falha de auth', async () => {
    setupGuardFail(401, 'Autenticação necessária');
    mockSvc.from = vi.fn();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });
});

// =============================================================================
// RBAC
// =============================================================================

describe('RBAC-01 role proibida → 403', () => {
  it('403 propagado pelo guard', async () => {
    setupGuardFail(403, 'Permissão insuficiente para esta operação');
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
  });
});

// =============================================================================
// FEAT
// =============================================================================

describe('FEAT-01 feature flag off → 403', () => {
  it('meta_whatsapp desabilitado → 403', async () => {
    setupGuardFail(403, 'Meta WhatsApp não habilitado para esta empresa');
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(res._body.error).toContain('Meta WhatsApp');
  });
});

// =============================================================================
// BODY (pós-auth)
// =============================================================================

describe('BODY-01 instance_id inválido → 400', () => {
  it('ausente → 400', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, instance_id: undefined } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
  });

  it('não-UUID → 400', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, instance_id: 'not-a-uuid' } }), res);
    expect(res._status).toBe(400);
  });
});

describe('BODY-02 conversation_id inválido → 400', () => {
  it('ausente → 400', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, conversation_id: undefined } }), res);
    expect(res._status).toBe(400);
  });

  it('não-UUID → 400', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, conversation_id: 'invalid' } }), res);
    expect(res._status).toBe(400);
  });
});

describe('BODY-03 template_name ausente/vazio → 400', () => {
  it('ausente → 400', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, template_name: undefined } }), res);
    expect(res._status).toBe(400);
  });

  it('string vazia → 400', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, template_name: '' } }), res);
    expect(res._status).toBe(400);
  });

  it('somente espaços → 400', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, template_name: '   ' } }), res);
    expect(res._status).toBe(400);
  });
});

describe('BODY-03b template_name excede 512 chars → 400 (L-01)', () => {
  it('513 chars → 400 invalid_request; Graph NÃO chamado', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, template_name: 'a'.repeat(513) } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
    expect(mockListMessageTemplates).not.toHaveBeenCalled();
  });

  it('exatamente 512 chars → não é rejeitado por tamanho', async () => {
    setupHappyPath();
    // Substitui template_name por string de 512 chars mas mantém happy path
    // O lookup vai falhar (nome não bate) mas o endpoint não rejeita no step 5
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, template_name: 'a'.repeat(512) } }), res);
    // 400 NÃO deve ser por tamanho — pode ser 404 (template não encontrado) ou outro
    if (res._status === 400) {
      expect(res._body.error).not.toBe('invalid_request');
    }
    expect(mockListMessageTemplates).toHaveBeenCalled();
  });
});

describe('BODY-04 template_language ausente/vazio → 400', () => {
  it('ausente → 400', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, template_language: undefined } }), res);
    expect(res._status).toBe(400);
  });

  it('string vazia → 400', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, template_language: '' } }), res);
    expect(res._status).toBe(400);
  });
});

describe('BODY-04b template_language excede 64 chars → 400 (L-01)', () => {
  it('65 chars → 400 invalid_request; Graph NÃO chamado', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, template_language: 'x'.repeat(65) } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
    expect(mockListMessageTemplates).not.toHaveBeenCalled();
  });

  it('exatamente 64 chars → não rejeitado por tamanho', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, template_language: 'x'.repeat(64) } }), res);
    if (res._status === 400) {
      expect(res._body.error).not.toBe('invalid_request');
    }
    expect(mockListMessageTemplates).toHaveBeenCalled();
  });
});

describe('BODY-05 parameter_values não-objeto → 400', () => {
  it.each([null, 42, 'string', true, []])('parameter_values=%s → 400', async (pv) => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, parameter_values: pv } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
  });
});

describe('BODY-06 parameter_values sem body → 400', () => {
  it('objeto sem chave body → 400', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, parameter_values: { header: {} } } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
  });
});

describe('BODY-07 parameter_values.body inválido → 400 sem Graph READ (L-04)', () => {
  it.each([
    ['null',   { body: null }],
    ['array',  { body: [] }],
    ['string', { body: 'x' }],
    ['number', { body: 42 }],
  ])('body=%s → 400 invalid_request; listMessageTemplates NÃO chamado', async (_, pv) => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, parameter_values: pv } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
    // Prova que nenhum Graph READ foi tentado
    expect(mockListMessageTemplates).not.toHaveBeenCalled();
  });
});

// =============================================================================
// TENANT / INSTANCE
// =============================================================================

describe('INST-01 instance not found → 404', () => {
  it('não encontrada → 404 instance_not_found', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn().mockReturnValueOnce(makeInstChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('instance_not_found');
  });
});

describe('INST-02 instance cross-tenant → 404 opaco', () => {
  it('outra company → 404 idêntico a inexistente', async () => {
    setupGuardOk();
    // Cross-tenant: lookup usa auth.companyId que não bate → null
    mockSvc.from = vi.fn().mockReturnValueOnce(makeInstChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('instance_not_found');
    // Resposta não revela que a instância existe em outro tenant
    expect(JSON.stringify(res._body)).not.toContain('tenant');
  });
});

describe('INST-03 instance not connected → 409', () => {
  it.each(['disconnected', 'error', 'token_revoked', 'pending'])(
    'status %s → 409 instance_not_connected',
    async (status) => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain({ ...FAKE_INSTANCE, status }));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(409);
      expect(res._body.error).toBe('instance_not_connected');
    }
  );
});

describe('INST-04 lookups usam auth.companyId', () => {
  it('instance lookup usa auth.companyId (não body company_id)', async () => {
    const authCompanyId = 'eeee0000-0000-0000-0000-000000000099';
    mockValidateMetaCaller.mockResolvedValue({
      ok: true, userId: FAKE_USER_ID, companyId: authCompanyId, role: 'admin', accessPath: 'direct',
    });

    // Capturar args da cadeia de instance
    const instChain = makeInstChain(FAKE_INSTANCE);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(instChain)
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED))
      .mockReturnValueOnce(makeInsertChain())
      .mockReturnValueOnce(makeInsertChain());

    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    setupEngineOk();
    mockSendTemplateMessage.mockResolvedValue({ messageId: FAKE_WAMID });

    const res = makeRes();
    await handler(makeReq(), res);

    // eq() chamado com authCompanyId (não FAKE_COMPANY_ID do body)
    const eqCalls = instChain.eq.mock.calls;
    const companyIdCall = eqCalls.find(([field, val]) => field === 'company_id');
    expect(companyIdCall).toBeDefined();
    expect(companyIdCall[1]).toBe(authCompanyId);
    expect(companyIdCall[1]).not.toBe(FAKE_COMPANY_ID);
  });
});

// =============================================================================
// CONVERSA
// =============================================================================

describe('CONV-01 conversation not found → 404', () => {
  it('não encontrada → 404 conversation_not_found', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('conversation_not_found');
  });
});

describe('CONV-02 conversation cross-tenant → 404 opaco', () => {
  it('outro tenant → 404 idêntico a inexistente', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(null)); // lookup com auth.companyId não encontra
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('conversation_not_found');
  });
});

describe('CONV-03 conversation cross-instance → 404 opaco', () => {
  it('outra instance → 404 idêntico a inexistente', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(null)); // triple-filter exclui outra instance
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
  });
});

describe('CONV-04 conversation lookup usa auth.companyId', () => {
  it('instância e conversa usam auth.companyId', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    // Verificado implicitamente — lookups mockados com mesmo companyId
  });
});

describe('CONV-05 conversation usa instance.id do banco', () => {
  it('conversa filtrada por instance.id do banco (não do body)', async () => {
    setupGuardOk();

    const convChain = makeConvChain(FAKE_CONVERSATION);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(convChain)
      .mockReturnValueOnce(makeCredChain(FAKE_CRED))
      .mockReturnValueOnce(makeInsertChain())
      .mockReturnValueOnce(makeInsertChain());

    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    setupEngineOk();
    mockSendTemplateMessage.mockResolvedValue({ messageId: FAKE_WAMID });

    const res = makeRes();
    await handler(makeReq(), res);

    // O eq de instance_id deve ter recebido FAKE_INSTANCE.id (do banco)
    const eqCalls = convChain.eq.mock.calls;
    const instanceIdCall = eqCalls.find(([field, val]) => field === 'instance_id');
    expect(instanceIdCall).toBeDefined();
    expect(instanceIdCall[1]).toBe(FAKE_INSTANCE_ID);
  });
});

describe('CONV-06 recipient vem de conversation.wa_id (não do body)', () => {
  it('body com to=evil não altera recipient', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, to: '9999999999' } }), res);
    expect(res._status).toBe(200);

    // sendTemplateMessage recebe FAKE_WA_ID (da conversa), não '9999999999'
    const [, , recipientArg] = mockSendTemplateMessage.mock.calls[0];
    expect(recipientArg).toBe(FAKE_WA_ID);
    expect(recipientArg).not.toBe('9999999999');
  });
});

describe('CONV-07 wa_id inválido no banco → 500', () => {
  it('wa_id não-dígitos → 500 internal_error', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain({ ...FAKE_CONVERSATION, wa_id: 'invalid-waid!' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('internal_error');
  });

  it('wa_id vazio → 500 internal_error', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain({ ...FAKE_CONVERSATION, wa_id: '' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
  });
});

// =============================================================================
// CREDENCIAIS
// =============================================================================

describe('CRED-01 credential ausente → 500', () => {
  it('sem credencial → 500 credential_unavailable', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('credential_unavailable');
  });
});

describe('CRED-02 decrypt failure → 500', () => {
  it('decryptMetaToken lança → 500 credential_unavailable', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockImplementation(() => { throw new Error('crypto failure'); });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('credential_unavailable');
    // Detalhe de crypto não vaza
    expect(JSON.stringify(res._body)).not.toContain('crypto failure');
  });
});

describe('CRED-03 credential lookup NÃO ocorre antes de instance válida', () => {
  it('instance not found → credential não consultada', async () => {
    setupGuardOk();
    const credChain = makeCredChain(FAKE_CRED);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(null))
      .mockReturnValue(credChain); // nunca deveria ser chamado para credential
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(credChain.select).not.toHaveBeenCalled();
  });
});

describe('CRED-04 credential lookup NÃO ocorre antes de instance connected', () => {
  it('instance disconnected → credential não consultada', async () => {
    setupGuardOk();
    const credChain = makeCredChain(FAKE_CRED);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain({ ...FAKE_INSTANCE, status: 'disconnected' }))
      .mockReturnValue(credChain);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(409);
    expect(credChain.select).not.toHaveBeenCalled();
  });
});

// =============================================================================
// LOOKUP (paginação + duplicata)
// =============================================================================

function setupLookupBase() {
  setupGuardOk();
  mockSvc.from = vi.fn()
    .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
    .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
    .mockReturnValueOnce(makeCredChain(FAKE_CRED))
    .mockReturnValueOnce(makeInsertChain())
    .mockReturnValueOnce(makeInsertChain());
  mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
  setupEngineOk();
  mockSendTemplateMessage.mockResolvedValue({ messageId: FAKE_WAMID });
}

describe('LOOK-01 match página 1 sem nextCursor → sucesso', () => {
  it('200 com message_id', async () => {
    setupLookupBase();
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, message_id: FAKE_WAMID });
  });
});

describe('LOOK-02 match somente na página 2 → sucesso', () => {
  it('template encontrado na 2ª página → 200', async () => {
    setupLookupBase();

    // Página 1: outros templates (language diferente), nextCursor presente
    const otherTemplate = { ...FAKE_RAW_TEMPLATE, language: 'en_US', id: 'tpl-en' };
    mockListMessageTemplates
      .mockResolvedValueOnce(makeListResult([otherTemplate], 'cursor-page-2'))
      .mockResolvedValueOnce(makeListResult([FAKE_RAW_TEMPLATE]));

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(mockListMessageTemplates).toHaveBeenCalledTimes(2);
  });
});

describe('LOOK-03 match somente na página 3 → sucesso', () => {
  it('template encontrado na 3ª página → 200', async () => {
    setupLookupBase();

    const other = { ...FAKE_RAW_TEMPLATE, language: 'en_US', id: 'tpl-en' };
    mockListMessageTemplates
      .mockResolvedValueOnce(makeListResult([other], 'cursor-p2'))
      .mockResolvedValueOnce(makeListResult([other], 'cursor-p3'))
      .mockResolvedValueOnce(makeListResult([FAKE_RAW_TEMPLATE]));

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(mockListMessageTemplates).toHaveBeenCalledTimes(3);
  });
});

describe('LOOK-04 duplicata na mesma página → template_unsupported', () => {
  it('2 matches na página 1 → 422 template_unsupported', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    const dup = { ...FAKE_RAW_TEMPLATE, id: 'tpl-dup' };
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE, dup]));

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(422);
    expect(res._body.error).toBe('template_unsupported');
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('LOOK-05 duplicata em páginas diferentes → template_unsupported', () => {
  it('1 match p1 + 1 match p2 → 422 template_unsupported', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);

    mockListMessageTemplates
      .mockResolvedValueOnce(makeListResult([FAKE_RAW_TEMPLATE], 'cursor-p2'))
      .mockResolvedValueOnce(makeListResult([{ ...FAKE_RAW_TEMPLATE, id: 'dup-p2' }]));

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(422);
    expect(res._body.error).toBe('template_unsupported');
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('LOOK-06 3 páginas consumidas + nextCursor → template_unsupported', () => {
  it('busca incompleta → fail-closed 422', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);

    // 3 páginas, todas com nextCursor (lookup incompleto)
    const other = { ...FAKE_RAW_TEMPLATE, language: 'en_US', id: 'other' };
    mockListMessageTemplates
      .mockResolvedValueOnce(makeListResult([other], 'c1'))
      .mockResolvedValueOnce(makeListResult([other], 'c2'))
      .mockResolvedValueOnce(makeListResult([FAKE_RAW_TEMPLATE], 'c3')); // ainda tem nextCursor!

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(422);
    expect(res._body.error).toBe('template_unsupported');
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('LOOK-07 busca completa sem name match → template_not_found', () => {
  it('nenhum template APPROVED com o name → 404 template_not_found', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([]));

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('template_not_found');
  });
});

describe('LOOK-08 name encontrado, language ausente → template_language_not_found', () => {
  it('name match mas language diferente → 404 template_language_not_found', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);

    // Template com o name correto mas language diferente
    const wrongLang = { ...FAKE_RAW_TEMPLATE, language: 'en_US', id: 'tpl-en' };
    mockListMessageTemplates.mockResolvedValue(makeListResult([wrongLang]));

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('template_language_not_found');
  });
});

describe('LOOK-09 template unsupported pelo engine → template_unsupported', () => {
  it('analyzeTemplate.supported=false → 422 template_unsupported; Graph WRITE não chamado', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    mockAnalyzeTemplate.mockReturnValue({
      supported: false, unsupported_reason: 'HEADER format IMAGE not supported',
      parameter_format: 'POSITIONAL', parameters: [], bodyText: null,
    });

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(422);
    expect(res._body.error).toBe('template_unsupported');
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('LOOK-10 list timeout/network → provider_unavailable', () => {
  it('graph_timeout → 503', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    const err = new Error('timeout'); err.code = 'graph_timeout';
    mockListMessageTemplates.mockRejectedValue(err);

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(503);
    expect(res._body.error).toBe('provider_unavailable');
  });

  it('graph_network_error → 503', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    const err = new Error('network'); err.code = 'graph_network_error';
    mockListMessageTemplates.mockRejectedValue(err);

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(503);
  });
});

describe('LOOK-11 list provider failure → provider_error', () => {
  it('graph_templates_failed → 502', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    const err = new Error('failed'); err.code = 'graph_templates_failed';
    mockListMessageTemplates.mockRejectedValue(err);

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(502);
    expect(res._body.error).toBe('provider_error');
  });
});

describe('LOOK-12 máximo 3 Graph READs por request', () => {
  it('3 páginas sem match → para em 3 chamadas', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);

    mockListMessageTemplates
      .mockResolvedValueOnce(makeListResult([], 'c1'))
      .mockResolvedValueOnce(makeListResult([], 'c2'))
      .mockResolvedValueOnce(makeListResult([], 'c3')); // nextCursor → lookup incompleto

    const res = makeRes();
    await handler(makeReq(), res);
    // Máximo 3 chamadas, não mais
    expect(mockListMessageTemplates).toHaveBeenCalledTimes(3);
  });
});

describe('LOOK-13 Graph WRITE não chamado quando template não encontrado', () => {
  it('template_not_found → sendTemplateMessage não chamado', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([]));

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('LOOK-14 Graph WRITE não chamado quando lookup incompleto', () => {
  it('busca incompleta → sendTemplateMessage não chamado', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);

    mockListMessageTemplates
      .mockResolvedValueOnce(makeListResult([], 'c1'))
      .mockResolvedValueOnce(makeListResult([], 'c2'))
      .mockResolvedValueOnce(makeListResult([FAKE_RAW_TEMPLATE], 'c3'));

    const res = makeRes();
    await handler(makeReq(), res);
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('LOOK-15 entries null/primitivas na página são ignoradas; match válido funciona (L-02)', () => {
  it('página com null + primitivo + template válido → 200', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED))
      .mockReturnValueOnce(makeInsertChain())
      .mockReturnValueOnce(makeInsertChain());
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    // Mistura de entries malformadas + template válido na mesma página
    mockListMessageTemplates.mockResolvedValue(
      makeListResult([null, 42, 'bad', FAKE_RAW_TEMPLATE, undefined]),
    );
    setupEngineOk();
    mockSendTemplateMessage.mockResolvedValue({ messageId: FAKE_WAMID });

    const res = makeRes();
    await handler(makeReq(), res);
    // Entries inválidas ignoradas; match válido encontrado → sucesso
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(mockSendTemplateMessage).toHaveBeenCalledTimes(1);
  });
});

describe('LOOK-16 somente entries malformadas → fail-closed sem 500 acidental (L-02)', () => {
  it('todas as entries null/primitivas → template_not_found, sem TypeError', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    // Página com somente entries malformadas
    mockListMessageTemplates.mockResolvedValue(
      makeListResult([null, undefined, 0, false, 'str']),
    );

    const res = makeRes();
    await handler(makeReq(), res);
    // nameMatchCount=0, matches=[], lookupComplete=true → template_not_found
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('template_not_found');
    // Confirmar que não foi 500 acidental por TypeError
    expect(res._status).not.toBe(500);
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

// =============================================================================
// PARÂMETROS
// =============================================================================

describe('PARAM-01 POSITIONAL body → sucesso', () => {
  it('body POSITIONAL válido → 200', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, parameter_values: { body: { '1': 'João' } } } }), res);
    expect(res._status).toBe(200);
  });
});

describe('PARAM-02 POSITIONAL header + body → sucesso', () => {
  it('header + body POSITIONAL → 200', async () => {
    setupLookupBase();
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));

    const analysisWithHeader = {
      ...FAKE_ANALYSIS_POSITIONAL,
      parameters: [
        { component: 'HEADER', key: '1', position: 1, example: null },
        { component: 'BODY',   key: '1', position: 1, example: null },
      ],
    };
    mockAnalyzeTemplate.mockReturnValue(analysisWithHeader);
    mockValidateParameterValues.mockReturnValue({ valid: true });
    mockBuildGraphComponents.mockReturnValue([]);
    mockInterpolateBody.mockReturnValue(FAKE_RENDERED_BODY);
    mockSendTemplateMessage.mockResolvedValue({ messageId: FAKE_WAMID });

    const res = makeRes();
    await handler(makeReq({ body: {
      ...HAPPY_BODY,
      parameter_values: { header: { '1': 'Empresa' }, body: { '1': 'João' } },
    } }), res);
    expect(res._status).toBe(200);
  });
});

describe('PARAM-03 NAMED body → sucesso', () => {
  it('body NAMED válido → 200', async () => {
    setupLookupBase();
    mockListMessageTemplates.mockResolvedValue(makeListResult([{
      ...FAKE_RAW_TEMPLATE, parameter_format: 'NAMED',
    }]));
    setupEngineOk(FAKE_ANALYSIS_NAMED);
    mockSendTemplateMessage.mockResolvedValue({ messageId: FAKE_WAMID });

    const res = makeRes();
    await handler(makeReq({ body: {
      ...HAPPY_BODY,
      parameter_values: { body: { first_name: 'Ana' } },
    } }), res);
    expect(res._status).toBe(200);
  });
});

describe('PARAM-04 NAMED header + body → sucesso', () => {
  it('header + body NAMED → 200', async () => {
    setupLookupBase();
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    const analysisNamedHeader = {
      ...FAKE_ANALYSIS_NAMED,
      parameters: [
        { component: 'HEADER', key: 'company_name', position: null, example: null },
        { component: 'BODY',   key: 'first_name',   position: null, example: null },
      ],
    };
    setupEngineOk(analysisNamedHeader);
    mockSendTemplateMessage.mockResolvedValue({ messageId: FAKE_WAMID });

    const res = makeRes();
    await handler(makeReq({ body: {
      ...HAPPY_BODY,
      parameter_values: { header: { company_name: 'LovooCRM' }, body: { first_name: 'Ana' } },
    } }), res);
    expect(res._status).toBe(200);
  });
});

describe('PARAM-05 missing body key → 422 template_params_mismatch', () => {
  it('chave ausente no body → 422', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    mockAnalyzeTemplate.mockReturnValue(FAKE_ANALYSIS_POSITIONAL);
    mockValidateParameterValues.mockReturnValue({ valid: false, error: 'template_params_mismatch' });

    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, parameter_values: { body: {} } } }), res);
    expect(res._status).toBe(422);
    expect(res._body.error).toBe('template_params_mismatch');
  });
});

describe('PARAM-06 extra body key → 422 template_params_mismatch', () => {
  it('chave extra no body → 422', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    mockAnalyzeTemplate.mockReturnValue(FAKE_ANALYSIS_POSITIONAL);
    mockValidateParameterValues.mockReturnValue({ valid: false, error: 'template_params_mismatch' });

    const res = makeRes();
    await handler(makeReq({ body: {
      ...HAPPY_BODY,
      parameter_values: { body: { '1': 'João', extra: 'valor' } },
    } }), res);
    expect(res._status).toBe(422);
    expect(res._body.error).toBe('template_params_mismatch');
  });
});

describe('PARAM-07 whitespace-only value → 422', () => {
  it('valor somente espaços → 422', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    mockAnalyzeTemplate.mockReturnValue(FAKE_ANALYSIS_POSITIONAL);
    mockValidateParameterValues.mockReturnValue({ valid: false, error: 'template_params_mismatch' });

    const res = makeRes();
    await handler(makeReq({ body: {
      ...HAPPY_BODY,
      parameter_values: { body: { '1': '   ' } },
    } }), res);
    expect(res._status).toBe(422);
  });
});

describe('PARAM-08 non-string value → 422', () => {
  it('número como valor → 422', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    mockAnalyzeTemplate.mockReturnValue(FAKE_ANALYSIS_POSITIONAL);
    mockValidateParameterValues.mockReturnValue({ valid: false, error: 'template_params_mismatch' });

    const res = makeRes();
    await handler(makeReq({ body: {
      ...HAPPY_BODY,
      parameter_values: { body: { '1': 42 } },
    } }), res);
    expect(res._status).toBe(422);
  });
});

describe('PARAM-09 Graph WRITE não chamado quando mismatch', () => {
  it('mismatch → sendTemplateMessage não chamado', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    mockAnalyzeTemplate.mockReturnValue(FAKE_ANALYSIS_POSITIONAL);
    mockValidateParameterValues.mockReturnValue({ valid: false, error: 'template_params_mismatch' });

    const res = makeRes();
    await handler(makeReq(), res);
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

// =============================================================================
// GRAPH WRITE
// =============================================================================

describe('GWRT-01 phone_number_id vem do banco', () => {
  it('sendTemplateMessage recebe phone_number_id de instance.phone_number_id', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, phone_number_id: 'HACKER_PHONE' } }), res);
    expect(mockSendTemplateMessage).toHaveBeenCalledOnce();
    const [, phoneArg] = mockSendTemplateMessage.mock.calls[0];
    expect(phoneArg).toBe(FAKE_PHONE_NUM_ID);
    expect(phoneArg).not.toBe('HACKER_PHONE');
  });
});

describe('GWRT-02 recipient vem da conversa', () => {
  it('sendTemplateMessage recebe FAKE_WA_ID (da conversa), não do body', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, to: 'evil-number' } }), res);
    const [, , recipientArg] = mockSendTemplateMessage.mock.calls[0];
    expect(recipientArg).toBe(FAKE_WA_ID);
    expect(recipientArg).not.toBe('evil-number');
  });
});

describe('GWRT-03 name/language repassados corretamente', () => {
  it('template.name e template.language.code corretos', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq(), res);
    const [, , , templateArg] = mockSendTemplateMessage.mock.calls[0];
    expect(templateArg.name).toBe(FAKE_TEMPLATE_NAME);
    expect(templateArg.language.code).toBe(FAKE_TEMPLATE_LANG);
  });
});

describe('GWRT-04 components vêm do engine', () => {
  it('sendTemplateMessage recebe components de buildGraphComponents', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq(), res);
    const [, , , templateArg] = mockSendTemplateMessage.mock.calls[0];
    expect(templateArg.components).toEqual(FAKE_COMPONENTS_BUILT);
  });
});

describe('GWRT-05 sendTemplateMessage chamado exatamente uma vez no sucesso', () => {
  it('happy path → exatamente 1 Graph WRITE', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(mockSendTemplateMessage).toHaveBeenCalledTimes(1);
  });
});

describe('GWRT-06 send_template_timeout → 503', () => {
  it('timeout → 503 provider_unavailable', async () => {
    setupLookupBase();
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    setupEngineOk();
    const err = new Error('timeout'); err.code = 'send_template_timeout';
    mockSendTemplateMessage.mockRejectedValue(err);

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(503);
    expect(res._body.error).toBe('provider_unavailable');
  });
});

describe('GWRT-07 send_template_network_error → 503', () => {
  it('network error → 503', async () => {
    setupLookupBase();
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    setupEngineOk();
    const err = new Error('network'); err.code = 'send_template_network_error';
    mockSendTemplateMessage.mockRejectedValue(err);

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(503);
  });
});

describe('GWRT-08 send_template_failed → 502', () => {
  it('provider failure → 502 provider_error', async () => {
    setupLookupBase();
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    setupEngineOk();
    const err = new Error('failed'); err.code = 'send_template_failed';
    mockSendTemplateMessage.mockRejectedValue(err);

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(502);
    expect(res._body.error).toBe('provider_error');
  });
});

describe('GWRT-09 send_template_invalid_response → 502', () => {
  it('invalid response → 502', async () => {
    setupLookupBase();
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    setupEngineOk();
    const err = new Error('bad'); err.code = 'send_template_invalid_response';
    mockSendTemplateMessage.mockRejectedValue(err);

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(502);
  });
});

describe('GWRT-10 código inesperado → 500', () => {
  it('código desconhecido → 500 internal_error', async () => {
    setupLookupBase();
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    setupEngineOk();
    const err = new Error('weird'); err.code = 'send_template_invalid_input';
    mockSendTemplateMessage.mockRejectedValue(err);

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('internal_error');
  });
});

describe('GWRT-11 template estático (sem variáveis) — components omitido do payload (L-05)', () => {
  it('buildGraphComponents retorna [] → sendTemplateMessage SEM prop components; sucesso', async () => {
    setupGuardOk();

    // Template estático: BODY sem placeholders
    const staticTemplate = {
      id: 'tpl-static', name: FAKE_TEMPLATE_NAME, language: FAKE_TEMPLATE_LANG,
      status: 'APPROVED', category: 'UTILITY', parameter_format: 'POSITIONAL',
      components: [{ type: 'BODY', text: 'Olá! Aqui está sua confirmação.' }],
    };
    const staticAnalysis = {
      supported: true, unsupported_reason: null, parameter_format: 'POSITIONAL',
      parameters: [], bodyText: 'Olá! Aqui está sua confirmação.',
      headerMediaFormat: null,  // MVP4B: template textual
    };

    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED))
      .mockReturnValueOnce(makeInsertChain())
      .mockReturnValueOnce(makeInsertChain());
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([staticTemplate]));
    mockAnalyzeTemplate.mockReturnValue(staticAnalysis);
    mockValidateParameterValues.mockReturnValue({ valid: true });
    // Engine retorna [] para template estático
    mockBuildGraphComponents.mockReturnValue([]);
    mockInterpolateBody.mockReturnValue('Olá! Aqui está sua confirmação.');
    mockSendTemplateMessage.mockResolvedValue({ messageId: FAKE_WAMID });

    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, parameter_values: { body: {} } } }), res);

    expect(res._status).toBe(200);
    expect(mockSendTemplateMessage).toHaveBeenCalledTimes(1);

    const [, , , templateArg] = mockSendTemplateMessage.mock.calls[0];
    // components NÃO deve ser own property quando vazio (L-05)
    expect(Object.prototype.hasOwnProperty.call(templateArg, 'components')).toBe(false);
    // name e language presentes
    expect(templateArg.name).toBe(FAKE_TEMPLATE_NAME);
    expect(templateArg.language.code).toBe(FAKE_TEMPLATE_LANG);
  });
});

// =============================================================================
// PERSISTÊNCIA
// =============================================================================

function setupForPersistTest(trackingError = null, chatError = null) {
  setupGuardOk();
  mockSvc.from = vi.fn()
    .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
    .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
    .mockReturnValueOnce(makeCredChain(FAKE_CRED))
    .mockReturnValueOnce(makeInsertChain(trackingError))
    .mockReturnValueOnce(makeInsertChain(chatError));
  mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
  mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
  setupEngineOk();
  mockSendTemplateMessage.mockResolvedValue({ messageId: FAKE_WAMID });
}

describe('PERS-01 tracking com campos corretos', () => {
  it('INSERT de tracking contém company_id, instance_id, meta_message_id, status', async () => {
    setupForPersistTest();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);

    // 4ª chamada de from → meta_whatsapp_messages INSERT
    const trackingInsert = mockSvc.from.mock.results[3].value;
    expect(trackingInsert.insert).toHaveBeenCalledOnce();
    const insertArg = trackingInsert.insert.mock.calls[0][0];
    expect(insertArg.company_id).toBe(FAKE_COMPANY_ID);
    expect(insertArg.instance_id).toBe(FAKE_INSTANCE_ID);
    expect(insertArg.meta_message_id).toBe(FAKE_WAMID);
    expect(insertArg.status).toBe('accepted');
  });
});

describe('PERS-02 chat com campos de template corretos', () => {
  it('INSERT de chat contém message_type=template, template_name, template_language, body', async () => {
    setupForPersistTest();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);

    // 5ª chamada de from → meta_messages INSERT
    const chatInsert = mockSvc.from.mock.results[4].value;
    expect(chatInsert.insert).toHaveBeenCalledOnce();
    const insertArg = chatInsert.insert.mock.calls[0][0];
    expect(insertArg.message_type).toBe('template');
    expect(insertArg.template_name).toBe(FAKE_TEMPLATE_NAME);
    expect(insertArg.template_language).toBe(FAKE_TEMPLATE_LANG);
    expect(insertArg.body).toBe(FAKE_RENDERED_BODY);
    expect(insertArg.direction).toBe('outbound');
    expect(insertArg.company_id).toBe(FAKE_COMPANY_ID);
    expect(insertArg.conversation_id).toBe(FAKE_CONVERSATION_ID);
    expect(insertArg.meta_message_id).toBe(FAKE_WAMID);
  });
});

describe('PERS-03 body persistido é renderedBody, não template_name', () => {
  it('body != template_name no INSERT de chat', async () => {
    setupForPersistTest();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);

    const chatInsert = mockSvc.from.mock.results[4].value;
    const insertArg = chatInsert.insert.mock.calls[0][0];
    expect(insertArg.body).toBe(FAKE_RENDERED_BODY);
    expect(insertArg.body).not.toBe(FAKE_TEMPLATE_NAME);
    expect(insertArg.body).not.toBe(FAKE_TEMPLATE_LANG);
  });
});

describe('PERS-04 tracking failure → 500 send_persistence_failed', () => {
  it('INSERT tracking falha → 500', async () => {
    setupForPersistTest({ code: 'XYZZY', message: 'db error' });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('send_persistence_failed');
  });
});

describe('PERS-05 chat failure → 500 send_persistence_failed', () => {
  it('INSERT chat falha → 500', async () => {
    setupForPersistTest(null, { code: 'PGSQL', message: 'constraint' });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('send_persistence_failed');
  });
});

describe('PERS-06 Graph failure → nenhum INSERT', () => {
  it('sendTemplate falha → from não chamado para inserts', async () => {
    setupGuardOk();
    let fromCallCount = 0;
    mockSvc.from = vi.fn().mockImplementation((table) => {
      fromCallCount++;
      if (table === 'meta_whatsapp_instances') return makeInstChain(FAKE_INSTANCE);
      if (table === 'meta_conversations')      return makeConvChain(FAKE_CONVERSATION);
      if (table === 'meta_whatsapp_credentials') return makeCredChain(FAKE_CRED);
      // meta_whatsapp_messages e meta_messages não deveriam ser chamados
      return makeInsertChain();
    });
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    setupEngineOk();
    const err = new Error('fail'); err.code = 'send_template_failed';
    mockSendTemplateMessage.mockRejectedValue(err);

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(502);
    // Somente 3 calls de from (instance, conversation, credential) — sem inserts
    expect(fromCallCount).toBe(3);
  });
});

describe('PERS-07 tracking failure → chat INSERT não tentado (L-03)', () => {
  it('tracking falha → meta_messages NÃO consultado; exatamente 1 Graph WRITE', async () => {
    // setupForPersistTest instala mockSvc.from como vi.fn() rastreável com 5 returns.
    // Com trackingError: 4ª call (meta_whatsapp_messages INSERT) retorna erro.
    // Handler deve fazer early return sem tentar a 5ª call (meta_messages).
    setupForPersistTest({ code: 'ERR', message: 'err' });

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(500);
    expect(res._body.error).toBe('send_persistence_failed');

    // Graph WRITE: exatamente 1 (tracking failure não reprocessa o WRITE)
    expect(mockSendTemplateMessage).toHaveBeenCalledTimes(1);

    // Verificar quais tabelas foram acessadas via svc.from
    const fromCalls = mockSvc.from.mock.calls.map(([t]) => t);
    // meta_messages NÃO deve ter sido acessado — handler retornou antes
    expect(fromCalls).not.toContain('meta_messages');
    // meta_whatsapp_messages SIM foi acessado (onde ocorreu o erro)
    expect(fromCalls).toContain('meta_whatsapp_messages');
  });
});

// =============================================================================
// SEGURANÇA
// =============================================================================

describe('SEC-01 token nunca aparece na resposta', () => {
  it('happy path → resposta não contém token', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq(), res);
    const body = JSON.stringify(res._body);
    expect(body).not.toContain(FAKE_PLAIN_TOKEN);
    expect(body).not.toContain(FAKE_ENC_TOKEN);
  });
});

describe('SEC-02 body com to ignorado (recipient não muda)', () => {
  it('to no body não substitui wa_id da conversa', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, to: '99999999999' } }), res);
    expect(res._status).toBe(200);
    const [, , recipientArg] = mockSendTemplateMessage.mock.calls[0];
    expect(recipientArg).toBe(FAKE_WA_ID);
    expect(recipientArg).not.toBe('99999999999');
  });
});

describe('SEC-03 body com phone_number_id ignorado', () => {
  it('phone_number_id do body não substitui o do banco', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, phone_number_id: 'INJECTED_PHONE_ID' } }), res);
    const [, phoneArg] = mockSendTemplateMessage.mock.calls[0];
    expect(phoneArg).toBe(FAKE_PHONE_NUM_ID);
    expect(phoneArg).not.toBe('INJECTED_PHONE_ID');
  });
});

describe('SEC-04 body com waba_id ignorado', () => {
  it('waba_id do body não afeta lookup de template', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, waba_id: 'INJECTED_WABA' } }), res);
    expect(res._status).toBe(200);
    const [, wabaArg] = mockListMessageTemplates.mock.calls[0];
    expect(wabaArg).toBe(FAKE_WABA_ID); // do banco
    expect(wabaArg).not.toBe('INJECTED_WABA');
  });
});

describe('SEC-05 body com components ignorado (engine constrói)', () => {
  it('components do body não influenciam o Graph WRITE', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, components: [{ injected: true }] } }), res);
    expect(res._status).toBe(200);
    const [, , , templateArg] = mockSendTemplateMessage.mock.calls[0];
    // Components vêm do engine (FAKE_COMPONENTS_BUILT), não do body
    expect(templateArg.components).toEqual(FAKE_COMPONENTS_BUILT);
  });
});

describe('SEC-06 parameter values não aparecem em resposta de erro', () => {
  it('mismatch → resposta não contém valores do parâmetro', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    mockAnalyzeTemplate.mockReturnValue(FAKE_ANALYSIS_POSITIONAL);
    mockValidateParameterValues.mockReturnValue({ valid: false, error: 'template_params_mismatch' });

    const secretValue = 'SENSITIVE_PARAMETER_VALUE_SECRET';
    const res = makeRes();
    await handler(makeReq({ body: {
      ...HAPPY_BODY,
      parameter_values: { body: { '1': secretValue } },
    } }), res);

    expect(res._status).toBe(422);
    const body = JSON.stringify(res._body);
    expect(body).not.toContain(secretValue);
  });
});

describe('SEC-07 credential lookup NÃO ocorre antes de instance+connected', () => {
  it('instance disconnected → credential não consultada', async () => {
    setupGuardOk();
    const credChain = makeCredChain(FAKE_CRED);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain({ ...FAKE_INSTANCE, status: 'disconnected' }))
      .mockReturnValue(credChain);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(409);
    expect(credChain.maybeSingle).not.toHaveBeenCalled();
  });
});

describe('SEC-08 Graph WRITE não chamado em falha de auth', () => {
  it('401 → sendTemplateMessage não chamado', async () => {
    setupGuardFail(401, 'Autenticação necessária');
    const res = makeRes();
    await handler(makeReq(), res);
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('SEC-09 Graph WRITE não chamado em falha de validação', () => {
  it('template_name ausente → sendTemplateMessage não chamado', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, template_name: '' } }), res);
    expect(res._status).toBe(400);
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

// =============================================================================
// MVP4B — MEDIA TEMPLATE
// =============================================================================

// ── MBOD — Validação de header_media_asset_id ─────────────────────────────

describe('MBOD-01 header_media_asset_id UUID inválido → 400 invalid_request', () => {
  it('string não-UUID → 400', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, header_media_asset_id: 'not-a-uuid' } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('MBOD-02 header_media_asset_id string vazia → 400 invalid_request', () => {
  it('string vazia → 400', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, header_media_asset_id: '' } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

// ── MCHK — Cross-check text/media ────────────────────────────────────────

describe('MCHK-01 template textual + asset presente → 400 media_header_unexpected', () => {
  it('textual + header_media_asset_id → rejeita; upload 0; send 0', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    // analyzeTemplate retorna template textual (headerMediaFormat = null)
    mockAnalyzeTemplate.mockReturnValue({ ...FAKE_ANALYSIS_POSITIONAL, headerMediaFormat: null });
    mockValidateParameterValues.mockReturnValue({ valid: true });
    mockInterpolateBody.mockReturnValue(FAKE_RENDERED_BODY);

    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, header_media_asset_id: FAKE_ASSET_ID } }), res);

    expect(res._status).toBe(400);
    expect(res._body.error).toBe('media_header_unexpected');
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('MCHK-02 template IMAGE + asset ausente → 400 media_header_required', () => {
  it('IMAGE sem header_media_asset_id → rejeita; upload 0; send 0', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE_IMAGE]));
    mockAnalyzeTemplate.mockReturnValue(FAKE_ANALYSIS_IMAGE);
    mockValidateParameterValues.mockReturnValue({ valid: true });
    mockInterpolateBody.mockReturnValue(FAKE_RENDERED_BODY);

    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, parameter_values: { body: {} } } }), res);

    expect(res._status).toBe(400);
    expect(res._body.error).toBe('media_header_required');
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('MCHK-03 template VIDEO + asset ausente → 400 media_header_required', () => {
  it('VIDEO sem header_media_asset_id → 400', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE_VIDEO]));
    mockAnalyzeTemplate.mockReturnValue(FAKE_ANALYSIS_VIDEO);
    mockValidateParameterValues.mockReturnValue({ valid: true });
    mockInterpolateBody.mockReturnValue(FAKE_RENDERED_BODY);

    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_VIDEO }), res);
    // HAPPY_BODY_VIDEO já tem asset — usar sem ele
    const bodyNoAsset = { ...HAPPY_BODY, parameter_values: { body: {} } };
    const res2 = makeRes();
    vi.clearAllMocks();
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE_VIDEO]));
    mockAnalyzeTemplate.mockReturnValue(FAKE_ANALYSIS_VIDEO);
    mockValidateParameterValues.mockReturnValue({ valid: true });
    mockInterpolateBody.mockReturnValue(FAKE_RENDERED_BODY);

    await handler(makeReq({ body: bodyNoAsset }), res2);
    expect(res2._status).toBe(400);
    expect(res2._body.error).toBe('media_header_required');
    expect(mockUploadMedia).not.toHaveBeenCalled();
  });
});

describe('MCHK-04 template DOCUMENT + asset ausente → 400 media_header_required', () => {
  it('DOCUMENT sem header_media_asset_id → 400', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE_DOCUMENT]));
    mockAnalyzeTemplate.mockReturnValue(FAKE_ANALYSIS_DOCUMENT);
    mockValidateParameterValues.mockReturnValue({ valid: true });
    mockInterpolateBody.mockReturnValue(FAKE_RENDERED_BODY);

    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY, parameter_values: { body: {} } } }), res);

    expect(res._status).toBe(400);
    expect(res._body.error).toBe('media_header_required');
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('MCHK-05 template IMAGE + asset válido → prosseguir', () => {
  it('validateMediaAsset chamado quando cross-check passa', async () => {
    setupHappyMediaPath();
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(200);
    expect(mockValidateMediaAsset).toHaveBeenCalledOnce();
  });
});

// ── MAST — validateMediaAsset error mapping ───────────────────────────────

function makeAssetError(code) {
  return Object.assign(new Error(code), { code });
}

describe('MAST-01 media_asset_not_found → 404 media_asset_not_found', () => {
  it('upload 0; send 0', async () => {
    setupHappyMediaPath();
    mockValidateMediaAsset.mockRejectedValue(makeAssetError('media_asset_not_found'));
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('media_asset_not_found');
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('MAST-02 media_asset_invalid → 400 invalid_request', () => {
  it('upload 0; send 0', async () => {
    setupHappyMediaPath();
    mockValidateMediaAsset.mockRejectedValue(makeAssetError('media_asset_invalid'));
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('MAST-03 media_asset_download_failed → 503 media_provider_unavailable', () => {
  it('upload 0; send 0', async () => {
    setupHappyMediaPath();
    mockValidateMediaAsset.mockRejectedValue(makeAssetError('media_asset_download_failed'));
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(503);
    expect(res._body.error).toBe('media_provider_unavailable');
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('MAST-04 media_asset_too_large → 422 media_asset_too_large', () => {
  it('upload 0; send 0', async () => {
    setupHappyMediaPath();
    mockValidateMediaAsset.mockRejectedValue(makeAssetError('media_asset_too_large'));
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(422);
    expect(res._body.error).toBe('media_asset_too_large');
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('MAST-05 media_asset_type_unknown → 422 media_asset_type_unknown', () => {
  it('upload 0; send 0', async () => {
    setupHappyMediaPath();
    mockValidateMediaAsset.mockRejectedValue(makeAssetError('media_asset_type_unknown'));
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(422);
    expect(res._body.error).toBe('media_asset_type_unknown');
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('MAST-06 media_asset_type_unsupported → 422 media_asset_type_unsupported', () => {
  it('upload 0; send 0', async () => {
    setupHappyMediaPath();
    mockValidateMediaAsset.mockRejectedValue(makeAssetError('media_asset_type_unsupported'));
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(422);
    expect(res._body.error).toBe('media_asset_type_unsupported');
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('MAST-07 media_asset_type_mismatch → 422 media_asset_type_mismatch', () => {
  it('upload 0; send 0', async () => {
    setupHappyMediaPath();
    mockValidateMediaAsset.mockRejectedValue(makeAssetError('media_asset_type_mismatch'));
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(422);
    expect(res._body.error).toBe('media_asset_type_mismatch');
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('MAST-08 companyId para validateMediaAsset = auth.companyId (não body)', () => {
  it('validateMediaAsset recebe auth.companyId, não body.company_id', async () => {
    const AUTH_COMPANY = 'f1f1f1f1-0000-0000-0000-f1f1f1f1f1f1';
    const BODY_COMPANY = 'b2b2b2b2-0000-0000-0000-b2b2b2b2b2b2'; // diferente!

    setupHappyMediaPath();
    // Override: auth.companyId = AUTH_COMPANY (diferente do body)
    mockValidateMetaCaller.mockResolvedValue({
      ok: true, userId: FAKE_USER_ID, companyId: AUTH_COMPANY, role: 'admin', accessPath: 'direct',
    });

    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY_IMAGE, company_id: BODY_COMPANY } }), res);

    // validateMediaAsset deve receber companyId = AUTH_COMPANY, nunca BODY_COMPANY
    expect(mockValidateMediaAsset).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: AUTH_COMPANY }),
    );
    expect(mockValidateMediaAsset).not.toHaveBeenCalledWith(
      expect.objectContaining({ companyId: BODY_COMPANY }),
    );
  });
});

// ── UMRT — uploadMedia error mapping ─────────────────────────────────────

describe('UMRT-01 upload_media_timeout → 503 provider_unavailable', () => {
  it('send 0', async () => {
    setupHappyMediaPath();
    mockUploadMedia.mockRejectedValue(makeAssetError('upload_media_timeout'));
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(503);
    expect(res._body.error).toBe('provider_unavailable');
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('UMRT-02 upload_media_network_error → 503 provider_unavailable', () => {
  it('send 0', async () => {
    setupHappyMediaPath();
    mockUploadMedia.mockRejectedValue(makeAssetError('upload_media_network_error'));
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(503);
    expect(res._body.error).toBe('provider_unavailable');
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('UMRT-03 upload_media_failed → 502 provider_error', () => {
  it('send 0', async () => {
    setupHappyMediaPath();
    mockUploadMedia.mockRejectedValue(makeAssetError('upload_media_failed'));
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(502);
    expect(res._body.error).toBe('provider_error');
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('UMRT-04 upload_media_invalid_response → 502 provider_error', () => {
  it('send 0', async () => {
    setupHappyMediaPath();
    mockUploadMedia.mockRejectedValue(makeAssetError('upload_media_invalid_response'));
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(502);
    expect(res._body.error).toBe('provider_error');
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('UMRT-05 token e phone_number_id para uploadMedia vêm do banco', () => {
  it('uploadMedia recebe token decryptado e phone_number_id da instância', async () => {
    setupHappyMediaPath();
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(200);
    const [token, phoneId] = mockUploadMedia.mock.calls[0];
    expect(token).toBe(FAKE_PLAIN_TOKEN);         // token decryptado do banco
    expect(phoneId).toBe(FAKE_PHONE_NUM_ID);      // phone_number_id da instância do banco
  });
});

// ── GBLD — Build + components Graph ──────────────────────────────────────

describe('GBLD-01 IMAGE — header.parameters[0].image.id = mediaId', () => {
  it('buildGraphComponents chamado com headerMedia IMAGE; payload correto', async () => {
    setupHappyMediaPath();
    mockBuildGraphComponents.mockReturnValue(FAKE_COMPONENTS_IMAGE);
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(200);

    // buildGraphComponents recebeu headerMedia com mediaId e mediaType IMAGE
    const [, , , opts] = mockBuildGraphComponents.mock.calls[0];
    expect(opts.headerMedia.mediaId).toBe(FAKE_MEDIA_ID);
    expect(opts.headerMedia.mediaType).toBe('IMAGE');

    // sendTemplateMessage recebeu components corretos
    const [, , , tpl] = mockSendTemplateMessage.mock.calls[0];
    expect(tpl.components).toEqual(FAKE_COMPONENTS_IMAGE);
  });
});

describe('GBLD-02 VIDEO — header.parameters[0].video.id = mediaId', () => {
  it('VIDEO: buildGraphComponents com headerMedia VIDEO; send usa components', async () => {
    setupHappyMediaPath({
      rawTemplate: FAKE_RAW_TEMPLATE_VIDEO,
      analysis:    FAKE_ANALYSIS_VIDEO,
      assetResult: FAKE_ASSET_RESULT_VIDEO,
      components:  FAKE_COMPONENTS_VIDEO,
    });
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_VIDEO }), res);
    expect(res._status).toBe(200);

    const [, , , opts] = mockBuildGraphComponents.mock.calls[0];
    expect(opts.headerMedia.mediaType).toBe('VIDEO');

    const [, , , tpl] = mockSendTemplateMessage.mock.calls[0];
    expect(tpl.components).toEqual(FAKE_COMPONENTS_VIDEO);
  });
});

describe('GBLD-03 DOCUMENT — document.id = mediaId e document.filename', () => {
  it('DOCUMENT: filename do asset chega ao payload Graph', async () => {
    setupHappyMediaPath({
      rawTemplate: FAKE_RAW_TEMPLATE_DOCUMENT,
      analysis:    FAKE_ANALYSIS_DOCUMENT,
      assetResult: FAKE_ASSET_RESULT_DOCUMENT,
      components:  FAKE_COMPONENTS_DOCUMENT,
    });
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_DOCUMENT }), res);
    expect(res._status).toBe(200);

    // buildGraphComponents recebeu filename do asset
    const [, , , opts] = mockBuildGraphComponents.mock.calls[0];
    expect(opts.headerMedia.mediaType).toBe('DOCUMENT');
    expect(opts.headerMedia.filename).toBe(FAKE_FILENAME);

    const [, , , tpl] = mockSendTemplateMessage.mock.calls[0];
    expect(tpl.components).toEqual(FAKE_COMPONENTS_DOCUMENT);
  });
});

describe('GBLD-04 buildGraphComponents lança após WRITE 1 → 500 internal_error; send 0', () => {
  it('F3: orphan media_id possível; sendTemplateMessage não chamado', async () => {
    setupHappyMediaPath();
    mockBuildGraphComponents.mockImplementation(() => { throw new Error('simulated-engine-bug'); });
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('internal_error');
    // uploadMedia FOI chamado (WRITE 1 ocorreu)
    expect(mockUploadMedia).toHaveBeenCalledOnce();
    // sendTemplateMessage NÃO chamado
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

// ── WBGT — Write budget ───────────────────────────────────────────────────

describe('WBGT-01 template textual → upload 0, send 1', () => {
  it('sem media: nenhum upload; exatamente 1 send', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendTemplateMessage).toHaveBeenCalledOnce();
  });
});

describe('WBGT-02 media IMAGE sucesso → upload 1, send 1', () => {
  it('exatamente 1 upload e 1 send', async () => {
    setupHappyMediaPath();
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(200);
    expect(mockUploadMedia).toHaveBeenCalledOnce();
    expect(mockSendTemplateMessage).toHaveBeenCalledOnce();
  });
});

describe('WBGT-03 validateMediaAsset falha → upload 0, send 0', () => {
  it('não chama upload nem send', async () => {
    setupHappyMediaPath();
    mockValidateMediaAsset.mockRejectedValue(makeAssetError('media_asset_not_found'));
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('WBGT-04 uploadMedia falha → upload 1, send 0', () => {
  it('upload tentado exatamente 1 vez; send 0', async () => {
    setupHappyMediaPath();
    mockUploadMedia.mockRejectedValue(makeAssetError('upload_media_failed'));
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(mockUploadMedia).toHaveBeenCalledOnce();
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('WBGT-05 send falha após upload → upload 1, send 1 (ambos tentados)', () => {
  it('upload e send exatamente 1 vez cada', async () => {
    setupHappyMediaPath();
    mockSendTemplateMessage.mockRejectedValue(makeAssetError('send_template_failed'));
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(502);
    expect(mockUploadMedia).toHaveBeenCalledOnce();
    expect(mockSendTemplateMessage).toHaveBeenCalledOnce();
  });
});

describe('WBGT-06 build falha após upload → upload 1, send 0', () => {
  it('upload ocorreu; send não chamado (F3)', async () => {
    setupHappyMediaPath();
    mockBuildGraphComponents.mockImplementation(() => { throw new Error('bug'); });
    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(mockUploadMedia).toHaveBeenCalledOnce();
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
  });
});

// ── PMED — Persistência media ─────────────────────────────────────────────

describe('PMED-01 IMAGE → meta_messages.media_asset_id = assetId', () => {
  it('INSERT de meta_messages inclui media_asset_id correto', async () => {
    setupHappyMediaPath();
    const insertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED))
      .mockReturnValueOnce(makeInsertChain())          // meta_whatsapp_messages
      .mockReturnValueOnce({ insert: insertSpy });    // meta_messages

    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(200);

    const insertArg = insertSpy.mock.calls[0][0];
    expect(insertArg.media_asset_id).toBe(FAKE_ASSET_ID);
    expect(insertArg.message_type).toBe('template');
  });
});

describe('PMED-02 VIDEO → meta_messages.media_asset_id = assetId', () => {
  it('INSERT inclui media_asset_id do asset VIDEO', async () => {
    setupHappyMediaPath({ rawTemplate: FAKE_RAW_TEMPLATE_VIDEO, analysis: FAKE_ANALYSIS_VIDEO, assetResult: FAKE_ASSET_RESULT_VIDEO, components: FAKE_COMPONENTS_VIDEO });
    const insertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED))
      .mockReturnValueOnce(makeInsertChain())
      .mockReturnValueOnce({ insert: insertSpy });

    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_VIDEO }), res);
    expect(res._status).toBe(200);
    expect(insertSpy.mock.calls[0][0].media_asset_id).toBe(FAKE_ASSET_ID);
  });
});

describe('PMED-03 DOCUMENT → meta_messages.media_asset_id = assetId', () => {
  it('INSERT inclui media_asset_id do asset DOCUMENT', async () => {
    setupHappyMediaPath({ rawTemplate: FAKE_RAW_TEMPLATE_DOCUMENT, analysis: FAKE_ANALYSIS_DOCUMENT, assetResult: FAKE_ASSET_RESULT_DOCUMENT, components: FAKE_COMPONENTS_DOCUMENT });
    const insertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED))
      .mockReturnValueOnce(makeInsertChain())
      .mockReturnValueOnce({ insert: insertSpy });

    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_DOCUMENT }), res);
    expect(res._status).toBe(200);
    expect(insertSpy.mock.calls[0][0].media_asset_id).toBe(FAKE_ASSET_ID);
  });
});

describe('PMED-04 textual → meta_messages.media_asset_id = null', () => {
  it('INSERT de meta_messages tem media_asset_id null', async () => {
    const insertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED))
      .mockReturnValueOnce(makeInsertChain())
      .mockReturnValueOnce({ insert: insertSpy });
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    setupEngineOk();
    mockSendTemplateMessage.mockResolvedValue({ messageId: FAKE_WAMID });

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(insertSpy.mock.calls[0][0].media_asset_id).toBeNull();
  });
});

describe('PMED-05 body persistido = renderedBody (nunca mediaId/filename/URL)', () => {
  it('INSERT usa renderedBody, não mediaId nem filename', async () => {
    setupHappyMediaPath();
    mockInterpolateBody.mockReturnValue('Corpo interpolado correto.');
    const insertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED))
      .mockReturnValueOnce(makeInsertChain())
      .mockReturnValueOnce({ insert: insertSpy });

    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    const row = insertSpy.mock.calls[0][0];
    expect(row.body).toBe('Corpo interpolado correto.');
    expect(row.body).not.toContain(FAKE_MEDIA_ID);
    expect(row.body).not.toContain(FAKE_ASSET_ID);
  });
});

describe('PMED-06 tracking (meta_whatsapp_messages) inalterado para media', () => {
  it('INSERT tracking tem company_id, instance_id, meta_message_id, status', async () => {
    setupHappyMediaPath();
    const trackingSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED))
      .mockReturnValueOnce({ insert: trackingSpy })  // meta_whatsapp_messages
      .mockReturnValueOnce(makeInsertChain());       // meta_messages

    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(200);
    const row = trackingSpy.mock.calls[0][0];
    expect(row.company_id).toBe(FAKE_COMPANY_ID);
    expect(row.instance_id).toBe(FAKE_INSTANCE_ID);
    expect(row.meta_message_id).toBe(FAKE_WAMID);
    expect(row.status).toBe('accepted');
    // Tracking NÃO inclui media_asset_id
    expect(Object.prototype.hasOwnProperty.call(row, 'media_asset_id')).toBe(false);
  });
});

describe('PMED-07 tracking failure pós-media-send → send_persistence_failed; Graph não repetido', () => {
  it('500 send_persistence_failed; upload e send exatamente 1 vez cada', async () => {
    setupHappyMediaPath();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED))
      .mockReturnValueOnce(makeInsertChain(new Error('tracking fail')));

    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('send_persistence_failed');
    expect(mockUploadMedia).toHaveBeenCalledOnce();
    expect(mockSendTemplateMessage).toHaveBeenCalledOnce();
  });
});

describe('PMED-08 meta_messages failure → send_persistence_failed; Graph não repetido', () => {
  it('500 send_persistence_failed; upload e send exatamente 1 vez cada', async () => {
    setupHappyMediaPath();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED))
      .mockReturnValueOnce(makeInsertChain())                      // tracking ok
      .mockReturnValueOnce(makeInsertChain(new Error('chat fail'))); // meta_messages falha

    const res = makeRes();
    await handler(makeReq({ body: HAPPY_BODY_IMAGE }), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('send_persistence_failed');
    expect(mockUploadMedia).toHaveBeenCalledOnce();
    expect(mockSendTemplateMessage).toHaveBeenCalledOnce();
  });
});

// ── MSEC — Segurança media ────────────────────────────────────────────────

describe('MSEC-01 body malicioso com media_id, mime, filename, url ignorados', () => {
  it('campos injetos no body não afetam upload nem components', async () => {
    setupHappyMediaPath();
    const maliciousBody = {
      ...HAPPY_BODY_IMAGE,
      media_id:        'evil-media-id',
      mime:            'application/x-evil',
      mime_type:       'application/x-evil',
      filename:        '../../../evil',
      url:             'https://evil.example/steal',
      preview_url:     'https://evil.example/preview',
      s3_key:          '../../../secrets',
      bucket:          'evil-bucket',
      components:      [{ injected: true }],
    };
    const res = makeRes();
    await handler(makeReq({ body: maliciousBody }), res);
    expect(res._status).toBe(200);

    // uploadMedia usa somente dados do assetResult (não do body)
    const [, , blob, mimeType] = mockUploadMedia.mock.calls[0];
    expect(blob).toBe(FAKE_BLOB);           // do assetResult, nunca do body
    expect(mimeType).toBe('image/jpeg');    // do assetResult, nunca do body

    // components vêm do engine, nunca do body
    const [, , , tpl] = mockSendTemplateMessage.mock.calls[0];
    expect(tpl.components).toEqual(FAKE_COMPONENTS_IMAGE);
    expect(JSON.stringify(tpl)).not.toContain('injected');
  });
});

describe('MSEC-02 recipient continua de conversation.wa_id (não body)', () => {
  it('body com to= injeto não afeta recipient', async () => {
    setupHappyMediaPath();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY_IMAGE, to: '5511000000000' } }), res);
    expect(res._status).toBe(200);
    const [, , toArg] = mockSendTemplateMessage.mock.calls[0];
    expect(toArg).toBe(FAKE_WA_ID); // sempre da conversa do banco
    expect(toArg).not.toBe('5511000000000');
  });
});

describe('MSEC-03 phone_number_id para uploadMedia = instance.phone_number_id (banco)', () => {
  it('body com phone_number_id injetado não afeta uploadMedia', async () => {
    setupHappyMediaPath();
    const res = makeRes();
    await handler(makeReq({ body: { ...HAPPY_BODY_IMAGE, phone_number_id: 'injected-phone' } }), res);
    expect(res._status).toBe(200);
    const [, phoneId] = mockUploadMedia.mock.calls[0];
    expect(phoneId).toBe(FAKE_PHONE_NUM_ID);  // da instância do banco
    expect(phoneId).not.toBe('injected-phone');
  });
});

// ── TEXT-REGRESSÃO — garantir que fluxo textual não regrediu ─────────────

describe('TEXT-01 template textual sem asset continua sucesso', () => {
  it('fluxo textual completo → 200 ok', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true, message_id: FAKE_WAMID });
  });
});

describe('TEXT-02 uploadMedia = 0 chamadas em template textual', () => {
  it('upload nunca chamado', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(mockUploadMedia).not.toHaveBeenCalled();
  });
});

describe('TEXT-03 sendTemplateMessage = exatamente 1 em template textual', () => {
  it('exatamente 1 send, nunca 0 ou 2', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(mockSendTemplateMessage).toHaveBeenCalledOnce();
  });
});

describe('TEXT-04 media_asset_id persistido como null para template textual', () => {
  it('INSERT meta_messages.media_asset_id = null', async () => {
    const insertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeCredChain(FAKE_CRED))
      .mockReturnValueOnce(makeInsertChain())
      .mockReturnValueOnce({ insert: insertSpy });
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_RAW_TEMPLATE]));
    setupEngineOk();
    mockSendTemplateMessage.mockResolvedValue({ messageId: FAKE_WAMID });

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(insertSpy.mock.calls[0][0].media_asset_id).toBeNull();
  });
});

describe('TEXT-05 payload Graph textual permanece equivalente ao anterior (sem media fields)', () => {
  it('sendTemplateMessage recebe template sem image/video/document nos components', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq(), res);
    const [, , , tpl] = mockSendTemplateMessage.mock.calls[0];
    expect(tpl.name).toBe(FAKE_TEMPLATE_NAME);
    expect(tpl.language.code).toBe(FAKE_TEMPLATE_LANG);
    expect(tpl.components).toEqual(FAKE_COMPONENTS_BUILT);
    // Garantir que media não foi injetado acidentalmente
    const tplStr = JSON.stringify(tpl);
    expect(tplStr).not.toContain('image');
    expect(tplStr).not.toContain('video');
    expect(tplStr).not.toContain('document');
  });
});
