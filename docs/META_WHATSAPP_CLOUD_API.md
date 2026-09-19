# Meta WhatsApp Cloud API — Documentação Técnica

**Versão implementada:** MVP2
**Ambiente de validação:** LovooDev (`lovoo-dev.vercel.app`)
**Graph API version:** v26.0
**Data de fechamento do MVP2:** 2026-09-19

---

## 1. Visão Geral

O LovooCRM integra a **Meta WhatsApp Business Platform (Cloud API)** como canal de comunicação oficial. Esta integração é independente e completamente isolada do subsistema Uazapi (canal WhatsApp não oficial que continua operando em paralelo).

### Escopo do MVP2 (implementado e validado)

- Onboarding via Embedded Signup (fluxo OAuth Meta)
- Envio de mensagem de texto outbound
- Persistência do identificador de mensagem (wamid) e seu status
- Recebimento e processamento de webhooks de status (`sent`, `delivered`, `read`, `failed`)

### Fora do escopo do MVP2 (MVP3+)

- Inbound: recebimento e persistência de mensagens enviadas pelo usuário final
- Templates HSM: mensagens business-initiated fora da janela de 24h
- Chat UI integrado ao frontend
- Integração do registro de telefone no fluxo de onboarding automático
- Rotação de token pós-onboarding

---

## 2. Arquitetura e Isolamento

### Estrutura de arquivos

```
api/
  lib/
    meta-whatsapp/
      config.js                  — variáveis de ambiente e versão Graph
      graphClient.js             — primitivos Graph API
      tokenCrypto.js             — AES-256-GCM para access tokens
      pinCrypto.js               — AES-256-GCM para PIN de registro
      validateMetaCaller.js      — auth + RBAC + feature flag
      verifyWebhookSignature.js  — HMAC SHA-256 + readRawBody
      selectionTokenCrypto.js    — crypto auxiliar de seleção de WABA
  whatsapp/
    meta/
      onboarding/
        start.js                 — inicia sessão de onboarding
        resolve-waba.js          — resolução de WABA em fluxo multi-WABA
        complete.js              — completa o Embedded Signup
      instances.js               — listagem de instâncias
      instances/
        register.js              — recovery: registrar número via Graph
        set-pin.js               — recovery: definir PIN dois fatores
      messages/
        send.js                  — envio outbound de texto
      webhook.js                 — GET verification + POST status processing
```

### Subsistemas paralelos — sem compartilhamento

| Subsistema | Provider | Código | Banco |
|---|---|---|---|
| WhatsApp oficial | Meta Cloud API | `api/whatsapp/meta/` | `meta_whatsapp_*` |
| WhatsApp não oficial | Uazapi | `api/whatsapp/` (demais) | `whatsapp_life_*`, `chat_*` |

Os dois subsistemas não compartilham código, bibliotecas, configuração ou tabelas de banco.

---

## 3. Fluxo de Onboarding (Embedded Signup)

```
Frontend (SDK Meta)          Backend                      Meta Graph API
     |                          |                               |
     |-- Embedded Signup UI --→ |                               |
     |                          |-- POST /onboarding/start --→  |
     |← session_token ----------|                               |
     |                          |                               |
     |-- OAuth code (FINISH) →  |                               |
     |                          |-- POST /onboarding/complete → |
     |                          |   1. Claim atômico do state   |
     |                          |   2. Code exchange            |
     |                          |   3. WABA + phone discovery   |
     |                          |   4. Encrypt token            |
     |                          |   5. rpc_create_meta_whatsapp_connection
     |← { ok: true } ---------- |                               |
```

**Regra crítica:** o `company_id` durante o onboarding é derivado do estado claimado no banco — nunca do corpo da requisição. Isso previne substituição de tenant.

Se uma conta Meta tiver múltiplos WABAs, o frontend apresenta seleção e chama `/onboarding/resolve-waba` antes de `/onboarding/complete`.

---

## 4. Modelo de Dados

### Tabelas principais

#### `meta_whatsapp_instances`
Representa uma conexão Meta WhatsApp ativa por empresa.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | UUID PK | Identificador interno |
| `company_id` | UUID FK | Empresa proprietária (multi-tenant) |
| `waba_id` | TEXT | WhatsApp Business Account ID |
| `phone_number_id` | TEXT | Phone Number ID (único entre instâncias ativas) |
| `status` | TEXT | `connected`, `disconnected`, etc. |
| `deleted_at` | TIMESTAMPTZ | Soft delete |

Constraint adicionada no MVP2: `UNIQUE (company_id, id)` — necessária para FK composta em `meta_whatsapp_messages`.

#### `meta_whatsapp_credentials`
Armazena credenciais cifradas. Acesso exclusivo via `service_role`.

| Coluna | Tipo | Descrição |
|---|---|---|
| `instance_id` | UUID FK | Instância relacionada |
| `access_token_enc` | TEXT | Token cifrado (AES-256-GCM) |
| `registration_pin_enc` | TEXT NULL | PIN de registro cifrado (gerado no backend) |
| `registration_pin_confirmed_at` | TIMESTAMPTZ NULL | Momento de confirmação do PIN pela Meta |

#### `meta_whatsapp_messages`
Persistência de mensagens outbound. Sem PII (sem destinatário, corpo ou token).

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | UUID PK | Identificador interno |
| `company_id` | UUID FK | Empresa (multi-tenant) |
| `instance_id` | UUID FK | Instância Meta |
| `meta_message_id` | TEXT | wamid retornado pelo Graph API |
| `status` | TEXT | `accepted`, `sent`, `delivered`, `read`, `failed` |
| `error_code` | INTEGER NULL | Código de erro Meta (somente em `failed`) |
| `error_subcode` | INTEGER NULL | Sempre `null` (deprecated em webhooks v16.0+) |
| `accepted_at` | TIMESTAMPTZ | Momento do INSERT (Graph aceitou) |
| `sent_at` | TIMESTAMPTZ NULL | Preenchido pelo webhook `sent` |
| `delivered_at` | TIMESTAMPTZ NULL | Preenchido pelo webhook `delivered` |
| `read_at` | TIMESTAMPTZ NULL | Preenchido pelo webhook `read` |
| `failed_at` | TIMESTAMPTZ NULL | Preenchido pelo webhook `failed` |

FK composta: `(company_id, instance_id) → meta_whatsapp_instances(company_id, id)` garante consistência de tenant no nível do banco.

RLS habilitado. Acesso exclusivo para `service_role` (zero acesso para `anon`/`authenticated`).

#### `meta_whatsapp_onboarding`
Estado transiente do fluxo Embedded Signup. Claim atômico via `UPDATE` condicional.

### Migrations aplicadas (ordem cronológica)

| Arquivo | O que faz |
|---|---|
| `20260912100000_meta_whatsapp_feature_flag.sql` | Adiciona `meta_whatsapp_enabled` à tabela `companies` |
| `20260912110000_create_meta_whatsapp_instances.sql` | Cria tabela `meta_whatsapp_instances` |
| `20260912120000_create_meta_whatsapp_credentials.sql` | Cria tabela `meta_whatsapp_credentials` |
| `20260912130000_create_meta_whatsapp_onboarding.sql` | Cria tabela `meta_whatsapp_onboarding` |
| `20260914212046_create_meta_whatsapp_connect_rpc.sql` | Cria RPC `rpc_create_meta_whatsapp_connection` |
| `20260918120000_meta_whatsapp_credentials_add_registration_pin.sql` | Adiciona `registration_pin_enc` |
| `20260918130000_meta_whatsapp_credentials_add_pin_confirmed_at.sql` | Adiciona `registration_pin_confirmed_at` |
| `20260918140000_meta_whatsapp_instances_add_company_id_unique.sql` | Adiciona `UNIQUE (company_id, id)` em instances |
| `20260918141000_create_meta_whatsapp_messages.sql` | Cria tabela `meta_whatsapp_messages` |

---

## 5. Variáveis de Ambiente

Todas as variáveis são exclusivas do backend (Vercel). Nenhuma delas pode ser exposta ao frontend.

| Variável | Uso | Observação |
|---|---|---|
| `META_APP_ID` | ID do app Meta | Exposto via `getMetaPublicConfig()` ao frontend somente para inicialização do SDK |
| `META_EMBEDDED_SIGNUP_CONFIG_ID` | ID de configuração Embedded Signup | Exposto via `getMetaPublicConfig()` ao frontend somente para inicialização do SDK |
| `META_APP_SECRET` | Validação HMAC de webhooks | Nunca exposto — backend only |
| `META_TOKEN_ENC_KEY_V1` | Chave AES-256-GCM (64 chars hex = 32 bytes) | Nunca exposto — backend only |
| `META_WEBHOOK_VERIFY_TOKEN` | Verificação GET do webhook | Nunca exposto — backend only |

**Nota:** `META_APP_ID` e `META_EMBEDDED_SIGNUP_CONFIG_ID` são os únicos valores expostos ao frontend — via função `getMetaPublicConfig()` — e somente para inicialização do SDK Embedded Signup. Não contêm credenciais.

---

## 6. Endpoints Implementados

### Autenticação e RBAC

Todos os endpoints de usuário usam `validateMetaCaller`, que verifica (nesta ordem):

1. Bearer token presente
2. JWT válido (Supabase)
3. Formato UUID do `company_id`
4. Membership ativo em `company_users` (`is_active = true`)
5. Role dentro da matriz correspondente
6. Para `partner`: assignment ativo em `partner_company_assignments`
7. Acesso parent→child (somente `super_admin` e `system_admin`)
8. Feature flag `companies.meta_whatsapp_enabled = true`

### Tabela de endpoints

| Endpoint | Método | Roles | Descrição |
|---|---|---|---|
| `/api/whatsapp/meta/onboarding/start` | POST | META_CONNECT_ROLES | Inicia sessão de onboarding, retorna session token |
| `/api/whatsapp/meta/onboarding/resolve-waba` | POST | META_CONNECT_ROLES | Resolve seleção de WABA em contas multi-WABA |
| `/api/whatsapp/meta/onboarding/complete` | POST | META_CONNECT_ROLES | Completa Embedded Signup, persiste instância e credencial |
| `/api/whatsapp/meta/instances` | GET | META_VIEW_ROLES | Lista instâncias ativas da empresa |
| `/api/whatsapp/meta/instances/register` | POST | META_CONNECT_ROLES | Recovery: registra número via `/{phone_number_id}/register` |
| `/api/whatsapp/meta/instances/set-pin` | POST | META_CONNECT_ROLES | Recovery: define PIN de dois fatores via Graph API |
| `/api/whatsapp/meta/messages/send` | POST | META_SEND_ROLES | Envia mensagem de texto outbound |
| `/api/whatsapp/meta/webhook` | GET | — (pública, verificada por token) | Verificação do challenge Meta |
| `/api/whatsapp/meta/webhook` | POST | — (pública, verificada por HMAC) | Recebimento de eventos de status |

### Matrizes de roles por endpoint

| Role | VIEW | CONNECT | SEND |
|---|---|---|---|
| `super_admin` | ✅ | ✅ | ✅ |
| `system_admin` | ✅ | ✅ | ✅ |
| `partner` | ✅ (+ assignment) | ✅ (+ assignment) | ✅ (+ assignment) |
| `admin` | ✅ | ✅ | ✅ |
| `manager` | ✅ | — | ✅ |
| `seller` | ✅ | — | ✅ |

---

## 7. Fluxo Outbound

```
POST /api/whatsapp/meta/messages/send
  │
  ├─ 1. Method guard (POST only)
  ├─ 2. Extrair: company_id, instance_id, to, message do body
  ├─ 3. getSupabaseAdmin()
  ├─ 4. validateMetaCaller() → auth + RBAC + feature flag
  ├─ 5. Validar instance_id (UUID), to (somente dígitos, '+' removido), message.type = "text"
  ├─ 6. SELECT meta_whatsapp_instances WHERE id + company_id + deleted_at IS NULL
  ├─ 7. Verificar status = "connected"
  ├─ 8. SELECT meta_whatsapp_credentials WHERE instance_id
  ├─ 9. decryptMetaToken(access_token_enc)
  ├─ 10. sendTextMessage(token, phone_number_id, to, text) → wamid
  ├─ 11. INSERT meta_whatsapp_messages (company_id, instance_id, meta_message_id, status='accepted')
  │      ├─ Sucesso → continua
  │      └─ Falha (qualquer erro) → 500 send_persistence_failed
  └─ 12. Resposta: { ok: true, message_id: wamid }
```

**Campos NÃO persistidos:** destinatário (`to`), corpo da mensagem, token, `phone_number_id`.

**Timeout Graph:** 10 segundos (`GRAPH_TIMEOUT_MS`). Erros mapeados: `send_timeout` → 503, `send_failed` → 502, `send_network_error` → 503.

---

## 8. Webhook — GET Verification

Usado durante a configuração inicial da callback URL no Meta App Dashboard.

```
GET /api/whatsapp/meta/webhook
  ?hub.mode=subscribe
  &hub.verify_token=<segredo>
  &hub.challenge=<valor gerado pela Meta>
```

**Fluxo:**
1. Verificar `hub.mode === 'subscribe'`
2. Obter `META_WEBHOOK_VERIFY_TOKEN` via `getMetaWebhookConfig()` — fail-closed sem ENV
3. Comparação timing-safe do token (buffers de mesmo comprimento via `crypto.timingSafeEqual`)
4. Token inválido ou comprimento diferente → `403`
5. Token válido → `200` com o `hub.challenge` como corpo literal (sem JSON wrapper)

**ZERO acesso a banco no GET.**

---

## 9. Webhook — POST Status Processing

```
POST /api/whatsapp/meta/webhook
  Header: X-Hub-Signature-256: sha256=<64 hex chars>
  Body: { "object": "whatsapp_business_account", "entry": [...] }
```

**Ordem de processamento (segurança obrigatória):**

1. `readRawBody(req)` — leitura do raw body, limite 1 MB (413 em caso de overflow)
2. `getMetaServerConfig()` → `appSecret` — fail-closed sem ENV
3. `verifyMetaWebhookSignature(rawBody, signature, appSecret)` — comparação timing-safe; `401` se inválido
4. `JSON.parse(rawBody)` — `400` se malformado
5. `payload.object !== 'whatsapp_business_account'` → `200` silencioso
6. `getSupabaseAdmin()` — somente após HMAC válido
7. Para cada `entry → change → statuses[]`:
   - Resolver tenant: `phone_number_id → meta_whatsapp_instances`
   - Instância desconhecida → `continue` (B1)
   - Erro de DB → `500`
   - Correlacionar: `(instance_id, meta_message_id = wamid) → meta_whatsapp_messages`
   - Wamid desconhecido → `continue` sem INSERT/UPDATE (B1)
   - Aplicar `TRANSITION_MATRIX`
   - NOOP → `continue` sem UPDATE
   - APPLY → `UPDATE` status e timestamp correspondente
8. Resposta: `200 { received: true }`

**`bodyParser: false`** é obrigatório — declarado via `export const config = { api: { bodyParser: false } }`.

---

## 10. State Machine de Status

A `TRANSITION_MATRIX` é declarada explicitamente no `webhook.js`. Cada célula é independente — sem ranking numérico.

| Status atual \ Novo | `sent` | `delivered` | `read` | `failed` |
|---|---|---|---|---|
| `accepted` | APPLY | APPLY | APPLY | APPLY |
| `sent` | NOOP | APPLY | APPLY | APPLY |
| `delivered` | NOOP | NOOP | APPLY | **NOOP** |
| `read` | NOOP | NOOP | NOOP | NOOP |
| `failed` | NOOP | NOOP | NOOP | NOOP |

**Nota `delivered → failed = NOOP`:** A Meta pode enviar `failed` após `delivered` em cenários multi-device (entregue em um dispositivo, falhou em outro). O estado `delivered` é preservado como o melhor estado conhecido.

**Statuses ignorados:** `played` e quaisquer outros não pertencentes ao conjunto `{sent, delivered, read, failed}` são descartados silenciosamente antes de qualquer acesso a banco.

---

## 11. Recovery: Registro e PIN de Dois Fatores

### `POST /api/whatsapp/meta/instances/register`

Chama `/{phone_number_id}/register` no Graph API para registrar um número que ficou em estado pendente após o onboarding.

- Gera PIN de 6 dígitos via CSPRNG (`crypto.randomInt`)
- Cifra o PIN com AES-256-GCM antes de qualquer chamada de rede
- Chama o Graph API com o PIN em memória
- Persiste `registration_pin_enc` somente após sucesso do Graph

### `POST /api/whatsapp/meta/instances/set-pin`

Define ou redefine o PIN de verificação em dois fatores via `/{phone_number_id}` (endpoint Set Two-Step Verification PIN da Meta).

Implementa a estratégia **persist-before-call**:

1. Gera e cifra um novo PIN
2. Persiste `registration_pin_enc` no banco **antes** da chamada Graph (UPDATE condicional)
3. Chama o Graph API com o PIN decifrado em memória
4. Preenche `registration_pin_confirmed_at` somente após confirmação `{ "success": true }` da Meta

**Estados do PIN:**

| Estado | `registration_pin_enc` | `registration_pin_confirmed_at` | Ação |
|---|---|---|---|
| A — Sem PIN | NULL | NULL | Gera novo PIN, persiste, chama Graph |
| B — PIN não confirmado | NOT NULL | NULL | Reutiliza PIN existente, chama Graph |
| C — PIN confirmado | NOT NULL | NOT NULL | Reutiliza PIN existente, chama Graph |

---

## 12. Configuração Externa Meta (Pré-requisitos)

Os itens abaixo são externos ao código Lovoo e devem ser verificados antes de operar em produção.

### Confirmados como necessários para o E2E MVP2

- **App inscrito no WABA:** `POST /{WABA_ID}/subscribed_apps` deve ser executado para que a Meta entregue webhooks de status para o endpoint cadastrado. Durante o MVP2, a ausência desta inscrição impediu o recebimento de webhooks na tentativa inicial.
- **Campo `messages` assinado:** no App Dashboard → WhatsApp → Configuration → Webhook Fields, o campo `messages` deve estar marcado como assinado.
- **Callback URL verificada:** a URL do webhook (`GET` challenge) deve estar configurada e verificada no App Dashboard.

### Impactos identificados durante o E2E — validação adicional recomendada

- **Forma de pagamento:** mensagens business-initiated (enviadas primeiro pela empresa) podem falhar com `error_code 131047` se o destinatário não tiver iniciado a conversa nas últimas 24 horas e não houver template HSM aprovado. Não diretamente relacionado à forma de pagamento — é uma restrição de janela de conversa da Meta.
- **App mode (Development vs Live):** a documentação oficial Meta indica que alguns webhooks podem não ser entregues em modo Development. A operabilidade em modo Development foi verificada no E2E MVP2, mas os limites exatos entre Development e Live não foram documentados de forma conclusiva para este caso específico. Validar com documentação oficial Meta antes de escalar.
- **App Review / Advanced Access:** requisitos de App Review para acesso avançado e escala comercial são externos e dependem de aprovação da Meta. Não cobertos pelo MVP2.

---

## 13. E2E MVP2 Validado

### Ambiente

- LovooDev (`lovoo-dev.vercel.app`)
- Banco Supabase compartilhado de desenvolvimento
- App Meta em modo de desenvolvimento

### Tentativa 1 — Infraestrutura de envio validada

- Graph API aceitou o envio e retornou wamid
- INSERT em `meta_whatsapp_messages` com `status = accepted` confirmado
- Nenhum webhook de status chegou ao endpoint

**Diagnóstico posterior:** o app correto não estava inscrito no WABA. A inscrição (`subscribed_apps`) estava ausente ou apontava para o app errado.

**Ação corretiva:** identificação do WABA ID correto, inscrição do app correto via `POST /{WABA_ID}/subscribed_apps`, confirmação via GET.

### Tentativa 2 — Pipeline de falha validado

Após a correção da subscription:

- Graph API aceitou e retornou wamid
- Webhook de status chegou ao endpoint
- HMAC validado, tenant resolvido por `phone_number_id`
- Transição `accepted → failed` aplicada pela state machine
- `error_code = 131047` persistido (destinatário não havia iniciado conversa — janela de 24h não aberta)

**Conclusão:** pipeline completo de falha funcionando corretamente.

### Tentativa 3 — Ciclo completo validado

Após o destinatário iniciar uma conversa com o número empresarial (abrindo a janela de 24h):

- Graph API aceitou e retornou wamid
- Mensagem fisicamente recebida no dispositivo do destinatário
- Webhook `sent` chegou ao endpoint → `status = sent`, `sent_at` preenchido
- Webhook `delivered` chegou ao endpoint → `status = delivered`, `delivered_at` preenchido

**Estado final no banco:**

```
status:       delivered
error_code:   null
accepted_at:  preenchido
sent_at:      preenchido (+1s)
delivered_at: preenchido (+2s)
failed_at:    null
```

**MVP2 outbound + persistência + status webhook validado E2E.**

---

## 14. Troubleshooting

### Mensagem aceita pelo Graph mas sem webhook de status

1. Verificar se o app está inscrito no WABA correto: `GET /{WABA_ID}/subscribed_apps`
2. Verificar se o campo `messages` está marcado no App Dashboard → Webhook Fields
3. Verificar se a callback URL está verificada e o endpoint está respondendo ao GET challenge

### Webhook chegando com `invalid signature` (HTTP 401)

1. Confirmar que `META_APP_SECRET` no Vercel corresponde ao App Secret do app Meta correto
2. Confirmar que o endpoint usa `bodyParser: false` (já configurado via `export const config`)
3. Confirmar que o `X-Hub-Signature-256` está sendo enviado pela Meta (App Dashboard → Webhook)

### Mensagem aceita mas não entregue — `error_code 131047`

A janela de sessão de 24h não está aberta. O destinatário precisa ter enviado uma mensagem para o número empresarial nas últimas 24 horas, ou é necessário um template HSM aprovado para mensagens business-initiated fora da janela.

### `send_persistence_failed` após HTTP 200 do Graph

O Graph enviou a mensagem com sucesso, mas o INSERT no banco falhou. A mensagem foi enviada — não reenviar. Verificar logs do Supabase para causa do erro de banco.

### `credential_unavailable` no send

A instância existe e está `connected`, mas a credencial está ausente ou o token não pôde ser decifrado. Possíveis causas: credencial não persistida durante onboarding, ou chave `META_TOKEN_ENC_KEY_V1` divergente entre ambientes.

---

## 15. Limites do MVP2 e Escopo do MVP3

### O que o MVP2 NÃO faz

- Não recebe nem persiste mensagens inbound (mensagens enviadas pelo usuário final)
- Não exibe conversas em nenhuma interface de chat
- Não suporta templates HSM
- Não suporta envio de mídia (imagens, documentos, áudio)
- Não integra o registro automático de telefone (`/register`) no fluxo de onboarding

### Candidatos ao MVP3

- Persistência de mensagens inbound (`messages[]` do webhook já chegam ao endpoint — atualmente ignorados)
- Interface de chat para operadores
- Envio de templates HSM
- Suporte a mídia outbound
- Integração de `registerPhoneNumber` no `onboarding/complete`
- Timeout dedicado para chamadas de provisionamento (`GRAPH_TIMEOUT_MS` atual é 10s)
- Rotação e revogação de tokens
