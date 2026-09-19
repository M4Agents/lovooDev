# ADR-002 — Integração Meta WhatsApp Cloud API

**Status:** Aceito
**Data:** 2026-09-19
**Escopo:** MVP2 — Onboarding Embedded Signup + Outbound de Texto + Status Webhook

---

## Contexto

O LovooCRM já possui um subsistema de chat WhatsApp baseado em Uazapi (API não oficial). Para habilitar o uso da API oficial Meta WhatsApp Business Platform (Cloud API), foi necessária uma integração paralela — completamente isolada do subsistema Uazapi — que suporte o ciclo oficial: onboarding via Embedded Signup, envio outbound, e recebimento de webhooks de status.

O MVP2 cobre o ciclo mínimo validado em ambiente de desenvolvimento (LovooDev):

- Onboarding via Embedded Signup (Meta SDK frontend + backend)
- Envio de mensagem de texto outbound
- Persistência do wamid no banco
- Recebimento e processamento de webhooks de status outbound (`sent`, `delivered`, `read`, `failed`)

Inbound (mensagens recebidas), templates, mídia e chat integrado pertencem ao escopo do MVP3.

---

## Decisões

### 1. Isolamento total do subsistema Meta

Todo código Meta reside exclusivamente em:

- `api/lib/meta-whatsapp/` — bibliotecas compartilhadas (crypto, Graph client, auth, webhook)
- `api/whatsapp/meta/` — endpoints HTTP

O subsistema Uazapi não foi alterado em nenhuma das fases do MVP2. Os dois subsistemas são completamente independentes e não compartilham código, banco ou configuração.

**Racional:** prevenir regressão no canal de produção existente; garantir que falhas no sistema Meta não afetem o Uazapi e vice-versa.

---

### 2. Multi-tenant via company_id obrigatório em toda operação

Toda query de banco inclui `company_id` derivado do JWT validado — nunca do corpo da requisição. O `company_id` do body serve apenas para identificar o tenant solicitado; a autorização real ocorre via `validateMetaCaller`.

A tabela `meta_whatsapp_messages` usa uma foreign key composta `(company_id, instance_id)` referenciando `meta_whatsapp_instances(company_id, id)`, adicionando garantia declarativa de consistência de tenant no nível do banco.

---

### 3. RBAC baseado em company_users com três matrizes independentes

O sistema define três roles distintas para o subsistema Meta, todas verificadas em `validateMetaCaller`:

| Matriz | Roles | Uso |
|---|---|---|
| `META_VIEW_ROLES` | super_admin, system_admin, partner, admin, manager, seller | Listar instâncias |
| `META_CONNECT_ROLES` | super_admin, system_admin, partner, admin | Onboarding, recovery, PIN |
| `META_SEND_ROLES` | super_admin, system_admin, partner, admin, manager, seller | Envio de mensagens |

**Regra especial para `partner`:** o role sozinho não garante acesso — é obrigatória a existência de um assignment ativo em `partner_company_assignments`. Isso é verificado internamente por `validateMetaCaller`.

As matrizes são declaradas explicitamente e não derivadas umas das outras.

---

### 4. Feature flag como mecanismo de rollout — não como autorização

A flag `companies.meta_whatsapp_enabled` controla o acesso ao subsistema Meta. Ela é verificada por `validateMetaCaller` como etapa obrigatória em todos os endpoints, após a verificação de role.

A flag **não substitui** o RBAC — ela o complementa. Uma empresa com a flag desabilitada recebe `403` mesmo que o usuário tenha role suficiente.

---

### 5. Credenciais armazenadas somente no backend, cifradas em repouso

O `access_token` Meta e o PIN de registro de dois fatores são armazenados cifrados (AES-256-GCM) nas tabelas `meta_whatsapp_credentials`, usando a chave `META_TOKEN_ENC_KEY_V1` disponível apenas no backend.

O plaintext do token:
- nunca é retornado em nenhuma resposta
- nunca é logado
- é decriptado em memória apenas imediatamente antes da chamada ao Graph API

O PIN de registro (6 dígitos, gerado pelo backend via CSPRNG) é tratado da mesma forma pelo módulo `pinCrypto.js`, que reutiliza a mesma chave de criptografia.

---

### 6. Onboarding via Embedded Signup com state atômico

O fluxo de onboarding utiliza o SDK Meta no frontend, que emite um evento `FINISH` com o código de autorização. O backend completa o fluxo em `onboarding/complete` com claim atômico do estado via `UPDATE` condicional — prevenindo processamento duplicado em caso de retentativas.

O `company_id` é sempre derivado do estado claimado no banco — nunca do corpo da requisição — para prevenir CSRF e substituição de tenant.

---

### 7. Validação HMAC antes de qualquer acesso ao banco

O endpoint webhook (`POST /api/whatsapp/meta/webhook`) segue a ordem de segurança:

1. Leitura do raw body com limite de 1 MB (413 em caso de overflow)
2. Obtenção do `appSecret` via `getMetaServerConfig()`
3. Validação HMAC `X-Hub-Signature-256` com comparação timing-safe
4. Parse JSON
5. Validação do `object` raiz
6. Inicialização do cliente Supabase
7. Processamento dos eventos

`getSupabaseAdmin()` e qualquer query ao banco são chamados **somente após** HMAC válido. HMAC inválido retorna `401` com zero acesso a DB.

**Nota de segurança:** o endpoint usa `export const config = { api: { bodyParser: false } }` para garantir que o body parser do Vercel não re-serialize o body, o que invalidaria a assinatura HMAC.

---

### 8. Tenant resolution no webhook exclusivamente por dados internos

O webhook resolve o tenant via:

```
value.metadata.phone_number_id
  → SELECT id, company_id FROM meta_whatsapp_instances
    WHERE phone_number_id = ? AND deleted_at IS NULL
```

`company_id` e `instance_id` **nunca** são extraídos do payload do webhook. O payload externo só contribui com o `phone_number_id` para lookup, e com o `statuses[].id` (wamid) para correlação.

---

### 9. Persistência outbound: INSERT explícito após Graph success

O endpoint `send` persiste o wamid no banco **somente após** confirmação de sucesso do Graph API. O INSERT inclui `company_id`, `instance_id`, `meta_message_id` e `status = 'accepted'`. Nenhum dado de destinatário, corpo da mensagem ou token é persistido.

Se o INSERT falhar (qualquer erro, incluindo violação de unicidade), o endpoint retorna `500 send_persistence_failed`. O Graph já executou — a mensagem foi enviada. Nenhuma retentativa de Graph ocorre após falha de persistência.

---

### 10. State machine explícita com NOOP para regressão

O processamento de status do webhook usa uma `TRANSITION_MATRIX` explícita. Cada célula é declarada individualmente — sem ranking numérico ou comparação ordinal.

```
accepted  → sent:      APPLY
accepted  → delivered: APPLY
accepted  → read:      APPLY
accepted  → failed:    APPLY

sent      → sent:      NOOP
sent      → delivered: APPLY
sent      → read:      APPLY
sent      → failed:    APPLY

delivered → sent:      NOOP
delivered → delivered: NOOP
delivered → read:      APPLY
delivered → failed:    NOOP  ← multi-device: delivered = entregue em ≥1 device

read      → *:         NOOP  ← estado terminal positivo

failed    → *:         NOOP  ← estado terminal negativo
```

NOOP significa **zero UPDATE** no banco — não um UPDATE idempotente.

`played` e statuses desconhecidos são ignorados silenciosamente.

---

### 11. Decisão B1 para wamid desconhecido

Se um webhook chega para um `phone_number_id` conhecido (instância resolvida) mas o wamid não existe em `meta_whatsapp_messages`, o endpoint retorna `200` e registra um log seguro — sem INSERT, sem UPDATE.

**Racional:** A Meta retenta webhooks por até 7 dias em caso de resposta não-200. Wamids desconhecidos provavelmente correspondem a mensagens enviadas fora do Lovoo. Retornar `5xx` causaria retry storm de 7 dias. A decisão B1 preserva a idempotência do batch e evita o storm.

---

### 12. Estratégia persist-before-call para definição de PIN de dois fatores (set-pin)

Para o endpoint de recovery `set-pin`, o PIN gerado é persistido no banco (`registration_pin_enc`) **antes** da chamada ao Graph API. Após confirmação de sucesso pela Meta, o campo `registration_pin_confirmed_at` é preenchido.

Isso permite recuperação em caso de falha ambígua (timeout, erro de rede): na próxima tentativa, o mesmo PIN é reutilizado em vez de gerar um novo, garantindo consistência com o estado da Meta.

---

## Consequências

### Confirmadas pelo MVP2

- Onboarding funcional via Embedded Signup
- Envio outbound de texto com persistência de wamid
- Pipeline webhook validado E2E: `accepted → sent → delivered`
- Pipeline de falha validado: `accepted → failed` (error_code 131047)
- State machine idempotente (NOOPs em retentativas)
- Isolamento Uazapi intacto

### Itens em aberto para MVP3

- Inbound: `messages[]` do webhook são ignorados nesta fase
- Templates HSM: necessários para mensagens business-initiated fora da janela de 24h
- Integração com o chat frontend (UI de conversas)
- Persistência de mensagens inbound
- Integração do registro de telefone (`registerPhoneNumber`) no fluxo de onboarding
- Rotação de token pós-onboarding

### Riscos conhecidos

- **Race condition send→webhook:** a janela entre Graph success e INSERT local é estreita mas não zero. Se um webhook de status chegar antes do INSERT, o status é descartado (B1). Statuses subsequentes (`delivered`, `read`) serão processados normalmente. Impacto prático baixo.
- **Timeout GRAPH_TIMEOUT_MS:** o timeout de 10 segundos compartilhado pode ser curto para chamadas de provisionamento (`/register`). Identificado durante o MVP2, aguarda endereçamento no MVP3.
- **Requisitos externos não controlados pelo Lovoo:** WABA subscription, forma de pagamento, janela de conversa de 24h, e requisitos de App Review da Meta são externos e podem bloquear operação comercial independentemente do estado do código.
