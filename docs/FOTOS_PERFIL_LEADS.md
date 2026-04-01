# Sistema de Fotos de Perfil de Leads

**Versão:** 2.0  
**Data:** Abril/2026  
**Status:** Produção

---

## Sumário

1. [Contexto e Problema](#1-contexto-e-problema)
2. [Arquitetura da Solução](#2-arquitetura-da-solução)
3. [Supabase Storage — Bucket `contact-avatars`](#3-supabase-storage--bucket-contact-avatars)
4. [Camada 1 — Webhook (tempo real)](#4-camada-1--webhook-tempo-real)
5. [Camada 2 — Batch Migration (histórico)](#5-camada-2--batch-migration-histórico)
6. [Camada 3 — Frontend (proteção e exibição)](#6-camada-3--frontend-proteção-e-exibição)
7. [Banco de Dados](#7-banco-de-dados)
8. [Arquivos Envolvidos](#8-arquivos-envolvidos)
9. [Como Executar a Migração em Lote](#9-como-executar-a-migração-em-lote)
10. [Regras de Negócio e Throttle](#10-regras-de-negócio-e-throttle)
11. [Riscos e Limitações](#11-riscos-e-limitações)

---

## 1. Contexto e Problema

### Problema Original

O WhatsApp disponibiliza fotos de perfil via **URLs temporárias de CDN** nos domínios:
- `pps.whatsapp.net`
- `mmg.whatsapp.net`

Essas URLs **expiram em poucas horas** e, ao serem renderizadas no navegador, retornam **HTTP 403**, causando:

- Imagens quebradas no Funil de Vendas (cards dos leads sem foto)
- Efeito de "piscar" nos cards ao carregar a página ou mover um card
- Erros 403 em cascata no console do navegador

### Solução Implementada

Armazenamento permanente das fotos no **Supabase Storage** (bucket público `contact-avatars`), com três pontos de entrada:

| Ponto | Quando ocorre | Arquivo |
|---|---|---|
| Webhook | A cada nova mensagem recebida | `api/webhook/uazapi/[company_id].js` |
| Batch migration | Execução manual para histórico | `api/sync-photos.js` |
| Frontend (fallback) | Proteção contra URLs expiradas | `src/utils/imageUtils.ts` |

---

## 2. Arquitetura da Solução

```
WhatsApp (CDN temporário)
        │
        │ payload do webhook (campo: chat.imagePreview)
        ▼
┌─────────────────────────────────────────┐
│  Webhook Uazapi  (fire-and-forget)      │
│  api/webhook/uazapi/[company_id].js     │
│                                         │
│  1. shouldSyncPhoto()   ← throttle 24h  │
│  2. downloadAndStoreContactAvatar()     │
│  3. UPDATE chat_contacts                │
└──────────────┬──────────────────────────┘
               │ URL permanente
               ▼
┌─────────────────────────────────────────┐
│  Supabase Storage                       │
│  Bucket: contact-avatars  (público)     │
│  Path:   avatars/{company_id}/{phone}.jpg│
└──────────────┬──────────────────────────┘
               │ URL pública estável
               ▼
┌─────────────────────────────────────────┐
│  chat_contacts.profile_picture_url      │
│  chat_contacts.photo_updated_at         │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  RPC get_funnel_positions_with_photos   │
│  → retorna foto junto com posições      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Frontend                               │
│  resolvePhotoUrl() → filtra CDN         │
│  Avatar.tsx → exibe placeholder se null │
└─────────────────────────────────────────┘
```

---

## 3. Supabase Storage — Bucket `contact-avatars`

### Configuração

| Propriedade | Valor |
|---|---|
| Nome | `contact-avatars` |
| Acesso | **Público** (sem autenticação para leitura) |
| Formato dos arquivos | JPEG |

### Convenção de Naming

```
avatars/{company_id}/{phone_normalizado}.jpg
```

**Regras de normalização do telefone:**
- Remove todos os caracteres não numéricos (`/\D/g`)
- Ex: `+55 (11) 99999-0000` → `5511999990000`

**Exemplos:**
```
avatars/3/5511999198369.jpg
avatars/3/5511988887777.jpg
avatars/7/5521999990000.jpg
```

### Por que nome estável sem timestamp?

- `upsert: true` garante que o arquivo seja sobrescrito na próxima atualização
- Evita acumulação de arquivos órfãos no bucket
- Mantém a URL sempre a mesma para o mesmo contato
- Permite que o browser faça cache da imagem de forma confiável

### Separação de Buckets

| Bucket | Tipo | Uso |
|---|---|---|
| `contact-avatars` | **Público** | Fotos de perfil dos contatos |
| `chat-media` | **Privado** | Mídias trocadas nas conversas (imagens, áudios, documentos) |

> O bucket `chat-media` permanece **privado e inalterado**. Nunca usar para avatares.

---

## 4. Camada 1 — Webhook (tempo real)

**Arquivo:** `api/webhook/uazapi/[company_id].js`

### Fluxo

Toda mensagem recebida via WhatsApp carrega o campo `chat.imagePreview` com a URL CDN da foto de perfil do remetente. O webhook intercepta esse campo e, de forma **assíncrona** (sem bloquear o retorno 200), realiza a migração.

```
Payload Uazapi recebido
        │
        ├─► Processar mensagem (síncrono)
        │   └─► Retornar 200 imediatamente
        │
        └─► Verificar imagePreview (assíncrono - fire-and-forget)
                │
                ├─► isWhatsAppCdnPhoto(imagePreview)?
                │     └─► NÃO → ignorar
                │
                └─► SIM → shouldSyncPhoto()
                            │
                            ├─► Throttle negado → ignorar
                            │
                            └─► Throttle aprovado
                                    │
                                    ▼
                              downloadAndStoreContactAvatar()
                                    │
                                    ▼
                              UPDATE chat_contacts
                              (profile_picture_url, photo_updated_at)
```

### Funções-chave

#### `isWhatsAppCdnPhoto(url)`
```javascript
// Retorna true para pps.whatsapp.net e mmg.whatsapp.net
function isWhatsAppCdnPhoto(url) {
  return url && (
    url.includes('pps.whatsapp.net') ||
    url.includes('mmg.whatsapp.net')
  );
}
```

#### `shouldSyncPhoto(supabase, companyId, phoneNumber, isNewContact)`

Lógica de decisão (em ordem de prioridade):

| Condição | Decisão |
|---|---|
| Contato novo | ✅ Sincronizar |
| Contato não encontrado no banco | ✅ Sincronizar (segurança) |
| Sem foto (`profile_picture_url` null) | ✅ Sincronizar |
| URL é do CDN WhatsApp | ✅ Sincronizar (migrar) |
| URL estável + `photo_updated_at` = hoje | ❌ Pular (throttle) |
| URL estável + `photo_updated_at` diferente de hoje | ✅ Sincronizar |

#### `downloadAndStoreContactAvatar({ supabase, profileUrl, companyId, phoneNumber })`

1. Download da imagem via `fetch` (GET na URL CDN)
2. Upload para `contact-avatars` com `upsert: true`
3. Retorna `publicUrl` permanente

> **Importante:** Se o download ou upload falhar, a função retorna `null` e o banco **não é atualizado**. O webhook continua operando normalmente.

### Garantias

- O webhook **sempre** retorna 200 antes do processo de foto iniciar
- Falhas no sync de foto não afetam o processamento da mensagem
- Multi-tenant: todos os filtros usam `company_id`

---

## 5. Camada 2 — Batch Migration (histórico)

**Arquivo:** `api/sync-photos.js`  
**Endpoint:** `POST /api/sync-photos` ou `GET /api/sync-photos`

Responsável por migrar contatos antigos que ainda possuem URLs expiradas ou que foram incorretamente armazenados no bucket privado `chat-media`.

### Tipos de contatos processados

| Tipo de URL | Estratégia |
|---|---|
| `pps.whatsapp.net` / `mmg.whatsapp.net` | Download direto da URL (se ainda válida) |
| `/chat-media/` | Download via service key do bucket privado + re-upload |
| Outros (já em `contact-avatars`) | Ignorado (não entra na query) |

### Paginação

O endpoint processa **10 contatos por chamada** com paginação por offset:

```
GET /api/sync-photos?offset=0   → processa contatos 0-9
GET /api/sync-photos?offset=N   → processa a partir do offset N
```

Resposta inclui `nextOffset` para encadeamento:
```json
{
  "success": true,
  "stats": {
    "total": 150,
    "success": 7,
    "skipped": 3,
    "failed": 0,
    "processed": 10,
    "remaining": 140,
    "nextOffset": 3
  }
}
```

> `nextOffset = offset + lote - sucessos`: os contatos migrados saem da query (URL trocada), portanto o offset avança pelo total menos os que foram removidos.

### Comportamento em URLs expiradas

Se uma URL CDN retornar **403 ou 404**, o contato é **pulado** (não falha). Ele será atualizado na próxima interação via webhook quando receber uma nova mensagem.

### Como executar a migração completa

Ver seção [9. Como Executar a Migração em Lote](#9-como-executar-a-migração-em-lote).

---

## 6. Camada 3 — Frontend (proteção e exibição)

### `src/utils/imageUtils.ts`

Utilitário central para tratamento de URLs de foto no frontend.

```typescript
// Hosts do CDN temporário do WhatsApp
const WA_CDN_HOSTS = ['pps.whatsapp.net', 'mmg.whatsapp.net']

// Detecta URL temporária do CDN
export function isWhatsAppCdnUrl(url: string | null | undefined): boolean

// Resolve URL para uso no Avatar:
// - URL CDN → undefined (força placeholder)
// - URL Storage ou null → retorna como está
export function resolvePhotoUrl(url: string | null | undefined): string | undefined
```

**Uso no `LeadCard.tsx`:**
```tsx
<Avatar
  src={resolvePhotoUrl(lead.profile_picture_url)}
  alt={lead.name}
  size="md"
/>
```

Se a URL ainda for do CDN (contato sem interação recente), `resolvePhotoUrl` retorna `undefined` e o `Avatar` exibe o placeholder com as iniciais do lead — sem tentativa de fetch, sem erro 403 no console.

### `src/components/Avatar.tsx`

O componente `Avatar` foi ajustado para eliminar o efeito de "piscar":

- `imageLoading` inicializa como `false` (sem overlay de loading inicial)
- O `useEffect` **não reseta** `imageLoading` para `true` no remount
- Resultado: imagens já em cache do browser são exibidas instantaneamente, sem flash do overlay, mesmo após drag-and-drop no Kanban

### Funil de Vendas — RPC com foto embutida

A foto **não** é carregada em uma query separada. Ela vem embutida na consulta principal do Funil via RPC:

```sql
-- supabase/migrations/20260401120000_create_get_funnel_positions_with_photos.sql
SELECT
  ofp.*,
  o.*,
  l.*,
  cc.profile_picture_url  -- ← foto já inclusa
FROM opportunity_funnel_positions ofp
JOIN opportunities o ON ...
JOIN leads l ON ...
LEFT JOIN chat_contacts cc ON
  REGEXP_REPLACE(l.phone, '\D', '', 'g') =
  REGEXP_REPLACE(cc.phone_number, '\D', '', 'g')
  AND cc.company_id = p_company_id
WHERE ofp.funnel_id = p_funnel_id
  AND ofp.company_id = p_company_id  -- isolamento multi-tenant
```

Zero queries adicionais para carregar fotos. Toda a página do Funil é carregada com **1 chamada RPC**.

---

## 7. Banco de Dados

### Tabela `chat_contacts`

Campos relevantes para o sistema de fotos:

| Campo | Tipo | Descrição |
|---|---|---|
| `profile_picture_url` | `text` | URL da foto de perfil (Storage ou CDN) |
| `photo_updated_at` | `timestamptz` | Última vez que a foto foi sincronizada |
| `updated_at` | `timestamptz` | Última atualização do registro |
| `phone_number` | `text` | Telefone (usado como chave de Storage) |
| `company_id` | `uuid` | Isolamento multi-tenant |

> **Sem novas colunas:** O sistema usa `photo_updated_at` (já existente) para controle de throttle. Nenhuma alteração de schema foi necessária.

### Como identificar o estado de um contato

```sql
SELECT
  phone_number,
  profile_picture_url,
  photo_updated_at,
  CASE
    WHEN profile_picture_url IS NULL THEN 'sem_foto'
    WHEN profile_picture_url ILIKE '%pps.whatsapp.net%'
      OR profile_picture_url ILIKE '%mmg.whatsapp.net%' THEN 'cdn_temporario'
    WHEN profile_picture_url ILIKE '%/chat-media/%' THEN 'bucket_privado_legado'
    WHEN profile_picture_url ILIKE '%/contact-avatars/%' THEN 'storage_permanente'
    ELSE 'outro'
  END AS status_foto
FROM chat_contacts
WHERE company_id = '<seu_company_id>'
ORDER BY status_foto, phone_number;
```

### Quantificar pendências de migração

```sql
SELECT
  COUNT(*) FILTER (WHERE profile_picture_url ILIKE '%pps.whatsapp.net%'
                      OR profile_picture_url ILIKE '%mmg.whatsapp.net%') AS cdn_temporario,
  COUNT(*) FILTER (WHERE profile_picture_url ILIKE '%/chat-media/%')      AS bucket_privado,
  COUNT(*) FILTER (WHERE profile_picture_url ILIKE '%/contact-avatars/%') AS storage_ok,
  COUNT(*) FILTER (WHERE profile_picture_url IS NULL)                      AS sem_foto,
  COUNT(*)                                                                  AS total
FROM chat_contacts
WHERE company_id = '<seu_company_id>';
```

---

## 8. Arquivos Envolvidos

| Arquivo | Responsabilidade |
|---|---|
| `api/webhook/uazapi/[company_id].js` | Sync em tempo real (fire-and-forget) ao receber mensagem |
| `api/sync-photos.js` | Batch migration para contatos históricos |
| `lib/photoSync.cjs` | Biblioteca compartilhada de sync (usada por outros webhooks) |
| `src/utils/imageUtils.ts` | Utilitários de URL no frontend (`isWhatsAppCdnUrl`, `resolvePhotoUrl`) |
| `src/components/Avatar.tsx` | Componente de exibição — sem flicker, com placeholder |
| `src/components/SalesFunnel/LeadCard.tsx` | Usa `resolvePhotoUrl` antes de passar para `Avatar` |
| `src/services/funnelApi.ts` | Chama RPC `get_funnel_positions_with_photos` |
| `supabase/migrations/20260401120000_create_get_funnel_positions_with_photos.sql` | RPC com foto embutida |

---

## 9. Como Executar a Migração em Lote

A migração deve ser executada quando há contatos com URLs pendentes (CDN ou `chat-media`). Primeiro, verifique a quantidade de pendências com a query da seção 7.

### Script shell para migração completa

```bash
#!/bin/bash
# migrate-photos.sh
# Executa em loop até que não haja mais pendências.

BASE_URL="https://seu-dominio.vercel.app"
OFFSET=0

while true; do
  echo "📸 Processando offset=$OFFSET..."

  RESPONSE=$(curl -s -X POST \
    "$BASE_URL/api/sync-photos" \
    -H "Content-Type: application/json" \
    -d "{\"offset\": $OFFSET}")

  echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

  NEXT_OFFSET=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['stats'].get('nextOffset') or 'null')" 2>/dev/null)

  if [ "$NEXT_OFFSET" = "null" ] || [ -z "$NEXT_OFFSET" ]; then
    echo "✅ Migração concluída!"
    break
  fi

  OFFSET=$NEXT_OFFSET
  sleep 2  # Aguarda 2 segundos entre lotes
done
```

### Execução manual via curl

```bash
# Primeiro lote
curl -X POST https://seu-dominio.vercel.app/api/sync-photos \
  -H "Content-Type: application/json" \
  -d '{"offset": 0}'

# Próximo lote (usar nextOffset da resposta anterior)
curl -X POST https://seu-dominio.vercel.app/api/sync-photos \
  -H "Content-Type: application/json" \
  -d '{"offset": 3}'
```

### Características da migração

| Propriedade | Valor |
|---|---|
| **Idempotente** | Sim — rodar duas vezes não duplica arquivos (`upsert: true`) |
| **Seguro em produção** | Sim — não altera contatos que já têm URL em `contact-avatars` |
| **URLs expiradas** | Puladas (não falham) — serão atualizadas pelo webhook |
| **Lote por chamada** | 10 contatos |
| **Delay entre contatos** | 500ms (evita rate limit do Storage) |

---

## 10. Regras de Negócio e Throttle

### Quando a foto É atualizada

1. Contato novo (primeira mensagem)
2. `profile_picture_url` está null
3. `profile_picture_url` é uma URL do CDN WhatsApp (`pps.` ou `mmg.whatsapp.net`)
4. `profile_picture_url` é estável (Storage) e `photo_updated_at` é de um dia anterior ao atual

### Quando a foto NÃO é atualizada (throttle)

- `profile_picture_url` já é uma URL do Storage **e** `photo_updated_at` é do dia de hoje

### Resumo do throttle

```
Foto estável no Storage + atualizada hoje → pular
Qualquer outra condição                  → sincronizar
```

O throttle protege contra:
- Múltiplas mensagens do mesmo contato no mesmo dia gerando N uploads desnecessários
- Rate limit do Supabase Storage

---

## 11. Riscos e Limitações

### Contatos sem interação recente

Contatos que **nunca mais enviarem mensagem** após a migração em lote terão a foto atualizada somente pela última execução do batch. Se a foto do WhatsApp deles mudar, o sistema não detectará automaticamente.

**Mitigação atual:** O batch pode ser reexecutado periodicamente para re-sincronizar contatos com fotos muito antigas.

### URLs CDN expiradas no momento do batch

Se a URL CDN de um contato expirou antes da migração batch, o contato é **pulado** (não falha). Ele será atualizado somente na próxima mensagem recebida.

### Contatos sem foto no WhatsApp

Se o contato não tem foto de perfil no WhatsApp, o campo `imagePreview` não virá no webhook. O contato permanecerá sem foto (`profile_picture_url` null) e o `Avatar` exibirá o placeholder com as iniciais.

### Buckets e permissões

- O bucket `contact-avatars` deve permanecer **público**. Torná-lo privado quebrará todas as fotos do sistema.
- O bucket `chat-media` deve permanecer **privado**. Ele contém mídias de chat (imagens, áudios, documentos) que não devem ser acessíveis publicamente sem autenticação.

### Multi-tenancy

Toda operação de leitura e escrita usa `company_id` como filtro obrigatório. O path do Storage (`avatars/{company_id}/...`) também garante isolamento físico entre tenants no bucket.
