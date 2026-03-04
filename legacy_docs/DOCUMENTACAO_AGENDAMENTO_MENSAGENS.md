# SISTEMA DE AGENDAMENTO DE MENSAGENS - DOCUMENTAÇÃO

**Data de Implementação:** 24/02/2026  
**Versão:** 4.0.0  
**Status:** ✅ Completo e Funcional  
**Última Atualização:** 02/03/2026 18:40

---

## 📋 VISÃO GERAL

Sistema completo para agendamento e envio automático de mensagens no chat WhatsApp, incluindo:
- ✅ Seleção de instância WhatsApp para envio
- ✅ Suporte para mensagens recorrentes (diárias, semanais, mensais)
- ✅ Upload de mídia (imagem, vídeo, áudio, documento)
- ✅ **Barra de progresso visual durante upload** (NOVO v3.0)
- ✅ **Detecção automática de tipo de mídia** (NOVO v3.0)
- ✅ **Suporte completo para vídeo e áudio** (NOVO v3.0)
- ✅ **Validação flexível: mídia sem texto obrigatório** (NOVO v3.0)
- ✅ **Cancelamento automático se lead responder** (NOVO v4.0)
- ✅ **Controle de escopo de cancelamento** (NOVO v4.0)
- ✅ Processamento automático via Vercel Cron
- ✅ Validações de segurança e isolamento por empresa

---

## 🏗️ ARQUITETURA

### **1. Frontend**
- **Componente:** `LeadPanel.tsx` → `ScheduleMessages`
- **Funcionalidades:**
  - ✅ **Seleção de Instância WhatsApp** (obrigatória)
    - Dropdown com instâncias conectadas da empresa
    - Validação: apenas instâncias com status 'connected'
    - Aviso se instância selecionada difere da conversa
    - Pré-seleção automática da instância da conversa
  - ✅ **Upload de Mídia com Barra de Progresso** (v3.0)
    - Feedback visual em tempo real (0-100%)
    - Botão desabilitado durante processamento
    - Previne múltiplos cliques
    - Mensagem "⏳ Enviando X%..."
  - ✅ **Detecção Automática de Tipo de Mídia** (v3.0)
    - Sistema detecta automaticamente: image, video, audio, document
    - Sem necessidade de seleção manual
    - Validação de tamanho por tipo
  - ✅ **Validação Flexível** (v3.0)
    - Permite agendar mídia sem texto
    - Permite agendar texto sem mídia
    - Validação: pelo menos um dos dois obrigatório
  - Criar agendamentos
  - Editar mensagens pendentes
  - Cancelar agendamentos
  - Filtrar por status (Todas, Pendentes, Enviadas, Falhas)
  - Configurar recorrência

### **2. Backend - API**
- **Endpoint Cron:** `/api/cron/process-scheduled-messages.js`
  - Executado a cada minuto via Vercel Cron
  - Processa mensagens pendentes
  - Envia via UAZAPI (alinhado com chat)
  - Atualiza status
  - Cria próximas ocorrências (recorrentes)

**Integração UAZAPI:**
- **Endpoint:** `https://lovoo.uazapi.com/send/text` (texto)
- **Endpoint:** `https://lovoo.uazapi.com/send/media` (mídia)
- **Autenticação:** Header `token: ${provider_token}`
- **Payload texto:**
  ```json
  {
    "number": "5511999999999",
    "text": "Mensagem",
    "delay": 1000,
    "linkPreview": true
  }
  ```
- **Tratamento robusto:**
  - Captura resposta como texto antes de parsear JSON
  - Logs detalhados de status, headers e body
  - Fallback para erros de parse JSON

### **3. Banco de Dados**

#### **Tabela: `chat_scheduled_messages`**
```sql
- id (UUID)
- conversation_id (UUID)
- company_id (UUID)
- instance_id (UUID)
- created_by (UUID)
- content (TEXT)
- message_type (TEXT) - 'text', 'image', 'video', 'audio', 'document'
  ✅ CONSTRAINT CORRIGIDO (v3.0): Agora aceita 'video' e 'audio'
- media_url (TEXT)
- scheduled_for (TIMESTAMPTZ)
- status (TEXT) - 'pending', 'sent', 'failed', 'cancelled'
- recurring_type (TEXT) - 'none', 'daily', 'weekly', 'monthly'
- recurring_config (JSONB)
- cancel_if_lead_replies (BOOLEAN) - ✅ NOVO v4.0: Habilita cancelamento automático
- cancel_scope (TEXT) - ✅ NOVO v4.0: 'next_only', 'all_future'
- recurring_parent_id (UUID) - ✅ NOVO v4.0: Referência para série recorrente
- sent_at (TIMESTAMPTZ)
- error_message (TEXT)
- created_at (TIMESTAMPTZ)
- updated_at (TIMESTAMPTZ)
```

#### **Funções SQL:**
1. `chat_schedule_message()` - Criar agendamento
2. `chat_get_scheduled_messages()` - Listar agendamentos
3. `get_pending_scheduled_messages()` - Buscar pendentes para processar
4. `mark_scheduled_message_sent()` - Marcar como enviada
5. `mark_scheduled_message_failed()` - Marcar como falha
6. `create_recurring_message()` - Criar próxima ocorrência
7. `auto_cancel_scheduled_messages_on_reply()` - ✅ NOVO v4.0: Cancelar mensagens quando lead responde

---

## 🔄 FLUXO DE FUNCIONAMENTO

### **1. Criação de Agendamento**
```
Usuário preenche formulário
  ↓
Frontend valida dados
  ↓
Chama chat_schedule_message()
  ↓
Registro criado com status 'pending'
  ↓
Mensagem aparece na lista
```

### **2. Processamento Automático (Cron)**
```
Vercel Cron executa a cada minuto
  ↓
Chama /api/cron/process-scheduled-messages
  ↓
Busca mensagens com scheduled_for <= NOW()
  ↓
Para cada mensagem:
  ├─ Envia via UAZAPI
  ├─ Se sucesso:
  │   ├─ Marca como 'sent'
  │   └─ Se recorrente: cria próxima ocorrência
  └─ Se falha:
      └─ Marca como 'failed' com erro
```

### **3. Mensagens Recorrentes**
```
Mensagem enviada com sucesso
  ↓
Verifica recurring_type != 'none'
  ↓
Calcula próxima data:
  ├─ daily: +1 dia
  ├─ weekly: +7 dias
  └─ monthly: +1 mês
  ↓
Verifica se não ultrapassou end_date
  ↓
Cria nova mensagem com status 'pending'
```

---

## ⚙️ CONFIGURAÇÃO

### **1. Variáveis de Ambiente**

**Vercel Dashboard → Settings → Environment Variables:**

```bash
# Supabase
VITE_SUPABASE_URL=https://etzdsywunlpbgxkphuil.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

# Cron Secret (gerar com: openssl rand -base64 32)
CRON_SECRET=seu-secret-aleatorio-aqui
```

### **2. Vercel Cron Configuration**

**vercel.json:**
```json
{
  "crons": [
    {
      "path": "/api/cron/process-scheduled-messages",
      "schedule": "* * * * *"
    }
  ]
}
```

**Schedule:** `* * * * *` = A cada minuto

---

## 📊 TIPOS DE MENSAGEM SUPORTADOS

| Tipo | Campos Necessários | Exemplo |
|------|-------------------|---------|
| text | content | "Olá, tudo bem?" |
| image | media_url, content (caption) | URL da imagem + legenda |
| video | media_url, content (caption) | URL do vídeo + legenda |
| audio | media_url | URL do áudio |
| document | media_url, content (fileName) | URL do doc + nome |

---

## 🔁 RECORRÊNCIA

### **Tipos Suportados:**
- **none:** Mensagem única
- **daily:** Repete diariamente
- **weekly:** Repete semanalmente
- **monthly:** Repete mensalmente

### **Configuração (recurring_config):**
```json
{
  "end_date": "2026-12-31T23:59:59Z",  // Opcional
  "days_of_week": [1, 3, 5],           // Apenas para weekly
  "day_of_month": 15                   // Apenas para monthly
}
```

---

## 🔒 SEGURANÇA

### **1. RLS (Row Level Security)**
- Todas as políticas isolam por `company_id`
- Usuário só vê/edita mensagens da própria empresa

### **2. Autenticação do Cron**
- Vercel envia header: `Authorization: Bearer ${CRON_SECRET}`
- Endpoint valida antes de processar

### **3. Validações**
- Frontend: Valida campos obrigatórios
- SQL: Valida empresa, conversa, permissões

---

## 📈 MONITORAMENTO

### **Logs do Cron Job**

**Vercel Dashboard → Deployments → [Deployment] → Functions → process-scheduled-messages**

Logs incluem:
- 🔄 Início do processamento
- 📨 Quantidade de mensagens encontradas
- ✅ Mensagens enviadas com sucesso
- ❌ Falhas com detalhes do erro
- 🔁 Recorrências criadas

### **Exemplo de Log:**
```
🔄 Starting scheduled messages processor...
📨 Found 3 pending messages to process
📤 Processing message b62dd23e-1a04-4e68-8cf7-bd3990f4114c...
✅ Message b62dd23e-1a04-4e68-8cf7-bd3990f4114c sent successfully
🔁 Created recurring message a1b2c3d4-5e6f-7g8h-9i0j-k1l2m3n4o5p6
✅ Processing completed: { total: 3, sent: 3, failed: 0, recurring_created: 1 }
```

---

## 🆕 NOVIDADES VERSÃO 4.0 (02/03/2026)

### **✨ FUNCIONALIDADE: Cancelamento Automático de Mensagens**

**Descrição:**
Sistema que cancela automaticamente mensagens agendadas quando o lead responde antes do horário programado.

**Casos de Uso:**
- Lead responde antes da mensagem de follow-up → Cancelar automaticamente
- Lead responde durante sequência de nutrição → Cancelar próximas mensagens
- Evitar mensagens redundantes após interação do lead
- Melhorar experiência do cliente com comunicação contextual

**Implementação:**

**1. Campos Adicionados na Tabela:**
```sql
-- Migration: 20260302151500_add_auto_cancel_scheduled_messages.sql

ALTER TABLE chat_scheduled_messages
ADD COLUMN cancel_if_lead_replies BOOLEAN DEFAULT false,
ADD COLUMN cancel_scope TEXT DEFAULT 'next_only' 
  CHECK (cancel_scope IN ('next_only', 'all_future')),
ADD COLUMN recurring_parent_id UUID REFERENCES chat_scheduled_messages(id);
```

**2. Função SQL de Cancelamento:**
```sql
CREATE OR REPLACE FUNCTION auto_cancel_scheduled_messages_on_reply(
  p_conversation_id UUID,
  p_company_id UUID
)
RETURNS TABLE(cancelled_count INTEGER, cancelled_ids UUID[])
AS $$
DECLARE
  v_cancelled_count INTEGER := 0;
  v_cancelled_ids UUID[] := '{}';
  v_message RECORD;
  v_parent_id UUID;
BEGIN
  -- Buscar mensagens pendentes com cancelamento habilitado
  FOR v_message IN
    SELECT id, cancel_scope, recurring_parent_id, recurring_type
    FROM chat_scheduled_messages
    WHERE conversation_id = p_conversation_id
      AND company_id = p_company_id
      AND status = 'pending'
      AND cancel_if_lead_replies = true
      AND scheduled_for > NOW()
    ORDER BY scheduled_for ASC
  LOOP
    -- Cancelar mensagem
    UPDATE chat_scheduled_messages
    SET 
      status = 'cancelled',
      error_message = 'Cancelada automaticamente: lead respondeu antes do horário agendado',
      updated_at = NOW()
    WHERE id = v_message.id;
    
    v_cancelled_count := v_cancelled_count + 1;
    v_cancelled_ids := array_append(v_cancelled_ids, v_message.id);
    
    -- Se escopo 'all_future' e mensagem recorrente, cancelar série completa
    IF v_message.cancel_scope = 'all_future' AND v_message.recurring_type != 'none' THEN
      v_parent_id := COALESCE(v_message.recurring_parent_id, v_message.id);
      
      UPDATE chat_scheduled_messages
      SET 
        status = 'cancelled',
        error_message = 'Cancelada automaticamente: série recorrente cancelada após resposta do lead',
        updated_at = NOW()
      WHERE conversation_id = p_conversation_id
        AND company_id = p_company_id
        AND status = 'pending'
        AND scheduled_for > NOW()
        AND (recurring_parent_id = v_parent_id OR id = v_parent_id)
        AND id != v_message.id;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_cancelled_count, v_cancelled_ids;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**3. Integração nos Webhooks:**

**Webhook: `api/uazapi-webhook-final.js`**
```javascript
// Após processar mensagem inbound do lead
try {
  console.log('🔔 VERIFICANDO CANCELAMENTO AUTOMÁTICO DE MENSAGENS AGENDADAS...');
  
  const { data: cancelResult, error: cancelError } = await supabase
    .rpc('auto_cancel_scheduled_messages_on_reply', {
      p_conversation_id: conversationId,
      p_company_id: company.id
    });
  
  if (cancelError) {
    console.error('❌ ERRO NO CANCELAMENTO AUTOMÁTICO:', cancelError);
  } else if (cancelResult && cancelResult.cancelled_count > 0) {
    console.log(`✅ CANCELAMENTO AUTOMÁTICO: ${cancelResult.cancelled_count} mensagem(ns) cancelada(s)`);
    console.log('📋 IDs cancelados:', cancelResult.cancelled_ids);
  } else {
    console.log('ℹ️ CANCELAMENTO AUTOMÁTICO: Nenhuma mensagem para cancelar');
  }
} catch (cancelError) {
  console.error('❌ EXCEPTION no cancelamento automático:', cancelError);
}
```

**4. Interface do Usuário:**

**Frontend: `LeadPanel.tsx` → Formulário de Agendamento**
```tsx
{/* Cancelamento Automático */}
<div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
  <div className="flex items-start space-x-3">
    <input
      type="checkbox"
      checked={formData.cancel_if_lead_replies}
      onChange={(e) => setFormData(prev => ({
        ...prev,
        cancel_if_lead_replies: e.target.checked
      }))}
      className="mt-1"
    />
    <div className="flex-1">
      <label className="text-sm font-medium text-gray-900">
        🔔 Cancelar automaticamente se o lead responder
      </label>
      <p className="text-xs text-gray-600 mt-1">
        Se o lead enviar uma mensagem antes do horário agendado, 
        esta mensagem será cancelada automaticamente
      </p>
    </div>
  </div>
  
  {formData.cancel_if_lead_replies && (
    <div className="mt-3 ml-8 space-y-2">
      <label className="flex items-center space-x-2">
        <input
          type="radio"
          checked={formData.cancel_scope === 'next_only'}
          onChange={() => setFormData(prev => ({ ...prev, cancel_scope: 'next_only' }))}
        />
        <span className="text-sm text-gray-700">
          Cancelar apenas a próxima mensagem agendada
        </span>
      </label>
      <label className="flex items-center space-x-2">
        <input
          type="radio"
          checked={formData.cancel_scope === 'all_future'}
          onChange={() => setFormData(prev => ({ ...prev, cancel_scope: 'all_future' }))}
        />
        <span className="text-sm text-gray-700">
          Cancelar TODAS as mensagens futuras agendadas
        </span>
      </label>
    </div>
  )}
</div>
```

**5. Indicador Visual:**
```tsx
{/* Badge de cancelamento automático na lista */}
{message.cancel_if_lead_replies && (
  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
    🔔 Cancelamento automático ativo
  </span>
)}
```

**Fluxo de Funcionamento:**
```
1. Lead responde no WhatsApp
   ↓
2. Webhook recebe mensagem inbound
   ↓
3. Processa e salva mensagem no chat
   ↓
4. Chama auto_cancel_scheduled_messages_on_reply()
   ↓
5. Função busca mensagens pendentes com cancel_if_lead_replies=true
   ↓
6. Para cada mensagem encontrada:
   ├─ Atualiza status para 'cancelled'
   ├─ Adiciona mensagem de erro explicativa
   └─ Se cancel_scope='all_future': cancela série completa
   ↓
7. Retorna quantidade de mensagens canceladas
   ↓
8. Webhook registra log de sucesso
```

**Benefícios:**
- ✅ Evita mensagens redundantes após interação do lead
- ✅ Melhora experiência do cliente
- ✅ Reduz custos de envio desnecessário
- ✅ Comunicação mais contextual e inteligente
- ✅ Controle granular (próxima mensagem vs todas)
- ✅ Suporte para séries recorrentes
- ✅ Logs detalhados para auditoria

**Resultado:** 
- ✅ Sistema de cancelamento automático 100% funcional
- ✅ Testado em produção com sucesso
- ✅ Interface intuitiva para o usuário
- ✅ Logs detalhados para debug

---

## 🆕 NOVIDADES VERSÃO 3.0 (25/02/2026)

### **❌ PROBLEMA 3: Constraint violado ao agendar vídeos/áudios**

**Sintoma:**
```
Error: new row for relation "chat_scheduled_messages" 
violates check constraint "chat_scheduled_messages_message_type_check"
```

**Causa Raiz:**
1. **Constraint incompleto no banco:**
   - ❌ Constraint antigo: `CHECK (message_type IN ('text', 'image', 'document'))`
   - ❌ Faltavam tipos: `'video'`, `'audio'`
   - Sistema detectava tipo corretamente mas banco rejeitava

2. **Sem feedback de upload:**
   - Upload de vídeo/áudio leva tempo (10-20MB+)
   - Botão permanecia habilitado
   - Usuário clicava múltiplas vezes
   - Múltiplas tentativas de salvamento

**Solução Implementada (Commit: 22ca86b - 25/02/2026):**

**1. Migration SQL - Constraint Corrigido:**
```sql
-- Arquivo: 20260225150600_add_video_audio_to_message_type_constraint.sql

ALTER TABLE chat_scheduled_messages 
DROP CONSTRAINT IF EXISTS chat_scheduled_messages_message_type_check;

ALTER TABLE chat_scheduled_messages 
ADD CONSTRAINT chat_scheduled_messages_message_type_check 
CHECK (message_type IN ('text', 'image', 'video', 'audio', 'document'));
```

**2. Barra de Progresso Implementada:**

**Backend (`src/services/aws/s3Storage.ts`):**
```typescript
// Usar @aws-sdk/lib-storage para rastreamento de progresso
const { Upload } = await import('@aws-sdk/lib-storage');

const upload = new Upload({
  client: s3Client,
  params: { /* ... */ }
});

// Rastrear progresso do upload
if (options.onProgress) {
  upload.on('httpUploadProgress', (progress) => {
    if (progress.loaded && progress.total) {
      const percentage = Math.round((progress.loaded / progress.total) * 100);
      options.onProgress(percentage);
    }
  });
}

await upload.done();
```

**API (`src/services/chat/chatApi.ts`):**
```typescript
static async uploadMedia(
  file: File,
  companyId: string,
  conversationId: string,
  onProgress?: (progress: number) => void  // ✅ Callback de progresso
): Promise<string>
```

**Frontend (`LeadPanel.tsx`):**
```typescript
// Estados
const [isScheduling, setIsScheduling] = useState(false)
const [uploadProgress, setUploadProgress] = useState(0)

// Upload com callback
if (selectedFile) {
  mediaUrl = await chatApi.uploadMedia(
    selectedFile, 
    companyId, 
    conversationId,
    (progress) => setUploadProgress(progress)  // ✅ Atualizar progresso
  )
}

// Barra visual
{isScheduling && uploadProgress > 0 && uploadProgress < 100 && (
  <div className="mb-4">
    <div className="flex items-center justify-between mb-2">
      <span className="text-sm text-gray-600">Enviando arquivo...</span>
      <span className="text-sm font-medium text-blue-600">{uploadProgress}%</span>
    </div>
    <div className="w-full bg-gray-200 rounded-full h-2.5">
      <div 
        className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
        style={{ width: `${uploadProgress}%` }}
      />
    </div>
  </div>
)}

// Botão com feedback
<button disabled={isScheduling || /* ... */}>
  {isScheduling 
    ? uploadProgress > 0 && uploadProgress < 100 
      ? `⏳ Enviando ${uploadProgress}%...` 
      : '⏳ Processando...'
    : 'Confirmar Agendamento'
  }
</button>
```

**3. Detecção Automática de Tipo de Mídia:**
```typescript
const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0]
  if (!file) return
  
  // Detectar tipo automaticamente
  let messageType: 'image' | 'video' | 'audio' | 'document' = 'document'
  if (file.type.startsWith('image/')) messageType = 'image'
  else if (file.type.startsWith('video/')) messageType = 'video'
  else if (file.type.startsWith('audio/')) messageType = 'audio'
  
  setFormData(prev => ({ ...prev, media_file: file, message_type: messageType }))
}
```

**4. Validação Flexível:**
```typescript
// Permite mídia sem texto OU texto sem mídia
const hasContent = formData.content.trim()
const hasMedia = selectedFile || formData.media_url

if (!selectedInstanceId || (!hasContent && !hasMedia) || ...) {
  alert('Por favor, preencha todos os campos obrigatórios')
  return
}
```

**Resultado:** 
- ✅ Vídeos e áudios salvam corretamente
- ✅ Barra de progresso visual (0-100%)
- ✅ Botão desabilitado durante upload
- ✅ Previne múltiplos cliques
- ✅ Feedback profissional ao usuário
- ✅ Detecção automática de tipo
- ✅ Mídia sem texto permitida

---

### **❌ PROBLEMA 4: Erro de checksum CRC32 no upload de vídeos**

**Sintoma:**
```
S3 upload failed: The upload was created using a crc32 checksum. 
The complete request must include the checksum for each part. 
It was missing for part 1 in the request.
```

**Causa Raiz:**
1. **Bucket S3 exige checksums:**
   - Bucket `aws-lovoocrm-media` configurado para exigir validação de integridade
   - `@aws-sdk/lib-storage` usa multipart upload para arquivos grandes
   - Sem `ChecksumAlgorithm` especificado, AWS SDK tenta CRC32 mas não envia checksums
   - S3 rejeita upload por falta de validação

2. **Multipart upload automático:**
   - Vídeos maiores (>5MB) acionam multipart upload
   - Cada parte precisa de checksum individual
   - Sistema não estava configurando algoritmo de checksum

**Solução Implementada (Commit: a29f079 - 26/02/2026):**

**Backend (`src/services/aws/s3Storage.ts`):**
```typescript
const upload = new Upload({
  client: s3Client,
  params: {
    Bucket: credentials.bucket,
    Key: s3Key,
    Body: options.buffer,
    ContentType: options.contentType,
    ChecksumAlgorithm: 'SHA256',  // ✅ ADICIONADO
    Metadata: { /* ... */ }
  }
});
```

**Benefícios:**
- ✅ Resolve erro de checksum CRC32
- ✅ Compatível com requisitos de segurança do S3
- ✅ Mantém barra de progresso funcional
- ✅ Validação de integridade garantida (SHA256)
- ✅ Funciona para arquivos de qualquer tamanho
- ✅ Não quebra upload do chat existente

**Resultado:** 
- ✅ Upload de vídeos funcionando sem erros
- ✅ Multipart upload com checksums corretos
- ✅ Sistema totalmente funcional para todos os tipos de mídia

---

## 🐛 TROUBLESHOOTING

### **❌ PROBLEMA 1: Chat não abrindo após implementação**

**Sintoma:**
- Chat exibe tela "Conectar WhatsApp" mesmo com instâncias conectadas

**Causa Raiz:**
- Função `getCompanyInstances()` modificada para usar endpoint `/api/whatsapp/instances`
- Endpoint estava falhando, retornando array vazio
- Hook `useChatData` interpretava como "sem instâncias"

**Solução Implementada (Commit: eb0bb08):**
```typescript
// Reverter para busca direta no Supabase
static async getCompanyInstances(companyId: string) {
  const { data, error } = await supabase
    .from('whatsapp_life_instances')
    .select('*')
    .eq('company_id', companyId)
    .eq('status', 'connected')
    .order('created_at', { ascending: false })
  
  return data || []
}
```

**Resultado:** ✅ Chat restaurado, carrega instâncias corretamente

---

### **❌ PROBLEMA 2: Mensagens agendadas falhando com erro JSON**

**Sintoma:**
```
error_message: "Unexpected non-whitespace character after JSON at position 4"
status: failed
```

**Causa Raiz:**
1. **Endpoint UAZAPI incorreto:**
   - ❌ Usado: `https://api.uazapi.com/instances/${id}/messages/send-text`
   - ✅ Correto: `https://lovoo.uazapi.com/send/text`

2. **Header de autenticação incorreto:**
   - ❌ Usado: `'Authorization': 'Bearer ${token}'`
   - ✅ Correto: `'token': token`

3. **Payload incompleto:**
   - ❌ Faltavam campos `delay` e `linkPreview`

4. **Tratamento de resposta frágil:**
   - ❌ `await response.json()` falhava se resposta não fosse JSON

**Solução Implementada (Commit: 646a5f4):**

**1. Endpoint corrigido:**
```javascript
const endpoint = message.message_type === 'text' 
  ? 'https://lovoo.uazapi.com/send/text'
  : 'https://lovoo.uazapi.com/send/media'
```

**2. Header corrigido:**
```javascript
headers: {
  'Content-Type': 'application/json',
  'token': instance.provider_token  // Alinhado com chat
}
```

**3. Payload completo:**
```javascript
{
  number: message.contact_phone.replace(/\D/g, ''),
  text: message.content,
  delay: 1000,           // Novo
  linkPreview: true      // Novo
}
```

**4. Tratamento robusto:**
```javascript
// Capturar texto antes de parsear
const responseText = await response.text()
console.log('📥 UAZAPI Response Body:', responseText)

// Tentar parsear com fallback
try {
  result = JSON.parse(responseText)
} catch (parseError) {
  return {
    success: false,
    error: `UAZAPI retornou resposta inválida: ${responseText.substring(0, 100)}`
  }
}
```

**Resultado:** ✅ Mensagens sendo enviadas com sucesso

---

### **Mensagem não foi enviada**

**1. Verificar status no banco:**
```sql
SELECT * FROM chat_scheduled_messages 
WHERE id = 'message-id';
```

**2. Verificar logs do cron:**
- Vercel Dashboard → Functions → Logs

**3. Causas comuns:**
- ❌ Cron não configurado (verificar vercel.json)
- ❌ CRON_SECRET incorreto
- ❌ Instância WhatsApp desconectada
- ❌ Token UAZAPI inválido
- ❌ scheduled_for no futuro
- ❌ Endpoint UAZAPI incorreto
- ❌ Header de autenticação incorreto

### **Mensagem marcada como 'failed'**

**Verificar campo `error_message`:**
```sql
SELECT id, content, error_message, scheduled_for, updated_at
FROM chat_scheduled_messages 
WHERE status = 'failed'
ORDER BY updated_at DESC;
```

**Erros comuns:**
- "Instance not found" → instance_id inválido ou instância desconectada
- "HTTP 401" → Token UAZAPI expirado
- "HTTP 404" → Endpoint incorreto
- "Unsupported message type" → Tipo não implementado
- "Unexpected non-whitespace character" → Resposta UAZAPI não é JSON válido
- "UAZAPI retornou resposta inválida" → API retornou HTML/texto em vez de JSON

---

## 🔧 MANUTENÇÃO

### **Reprocessar mensagem falhada**

```sql
-- Resetar para pending
UPDATE chat_scheduled_messages
SET 
  status = 'pending',
  error_message = NULL,
  updated_at = NOW()
WHERE id = 'message-id';
```

### **Cancelar todas as recorrências futuras**

```sql
UPDATE chat_scheduled_messages
SET status = 'cancelled'
WHERE recurring_type != 'none'
  AND status = 'pending'
  AND conversation_id = 'conversation-id';
```

### **Limpar mensagens antigas**

```sql
-- Deletar mensagens enviadas há mais de 90 dias
DELETE FROM chat_scheduled_messages
WHERE status = 'sent'
  AND sent_at < NOW() - INTERVAL '90 days';
```

---

## 📝 MIGRATIONS

**Arquivos:**
1. `20260224145700_create_chat_scheduled_messages.sql`
   - Tabela principal
   - Funções de agendamento
   - Políticas RLS

2. `20260224155100_create_scheduled_messages_processor.sql`
   - Funções de processamento
   - Funções de recorrência

3. `20260225150600_add_video_audio_to_message_type_constraint.sql` **(NOVO v3.0)**
   - Corrige constraint de message_type
   - Adiciona suporte para 'video' e 'audio'
   - Permite agendamento de todos os tipos de mídia

4. `20260302151500_add_auto_cancel_scheduled_messages.sql` **(NOVO v4.0)**
   - Adiciona campos cancel_if_lead_replies e cancel_scope
   - Adiciona campo recurring_parent_id
   - Cria função auto_cancel_scheduled_messages_on_reply()
   - Implementa cancelamento automático inteligente

---

## 🚀 DEPLOY

**Checklist:**
- [ ] Migrations aplicadas no Supabase
- [ ] CRON_SECRET configurado no Vercel
- [ ] vercel.json com configuração de cron
- [ ] Código deployado
- [ ] Testar envio manual
- [ ] Verificar logs do cron após 1 minuto

---

## 📞 SUPORTE

**Em caso de problemas:**
1. Verificar logs do Vercel
2. Verificar status no banco de dados
3. Testar instância WhatsApp manualmente
4. Verificar variáveis de ambiente

---

## 📚 HISTÓRICO DE IMPLEMENTAÇÃO

### **Commits Principais:**

**1. Commit: 8f66957 (24/02/2026)**
- ✅ Implementação inicial da seleção de instância WhatsApp
- ✅ Dropdown obrigatório no formulário de agendamento
- ✅ Validação de instância conectada
- ✅ Aviso quando instância difere da conversa
- ✅ Pré-seleção automática da instância da conversa
- ❌ Problema: Quebrou carregamento do chat

**2. Commit: eb0bb08 (24/02/2026)**
- ✅ Correção: Reverter `getCompanyInstances()` para busca direta
- ✅ Removido endpoint `/api/whatsapp/instances` desnecessário
- ✅ Chat restaurado e funcionando
- ✅ Seleção de instância mantida no agendamento

**3. Commit: 646a5f4 (24/02/2026)**
- ✅ Correção: Alinhar envio UAZAPI com lógica do chat
- ✅ Endpoint corrigido: `lovoo.uazapi.com/send/text`
- ✅ Header corrigido: `'token'` em vez de `'Authorization: Bearer'`
- ✅ Payload completo com `delay` e `linkPreview`
- ✅ Tratamento robusto de resposta (texto → JSON)
- ✅ Logs detalhados para debug
- ✅ **Resultado:** Mensagens sendo enviadas com sucesso!

**4. Commit: 22ca86b (25/02/2026) - VERSÃO 3.0**
- ✅ Migration SQL: Constraint corrigido para aceitar 'video' e 'audio'
- ✅ Dependência: Instalado @aws-sdk/lib-storage
- ✅ Backend: S3Storage com rastreamento de progresso
- ✅ API: chatApi.uploadMedia com callback de progresso
- ✅ Frontend: Barra de progresso visual (0-100%)
- ✅ Frontend: Detecção automática de tipo de mídia
- ✅ Frontend: Validação flexível (mídia sem texto permitida)
- ✅ UX: Botão desabilitado durante upload
- ✅ UX: Previne múltiplos cliques
- ✅ **Resultado:** Sistema completo para todos os tipos de mídia!

**5. Commit: a29f079 (26/02/2026) - CORREÇÃO CHECKSUM**
- ✅ Adicionado `ChecksumAlgorithm: 'SHA256'` ao Upload S3
- ✅ Resolve erro: "The upload was created using a crc32 checksum"
- ✅ Compatível com requisitos de segurança do bucket S3
- ✅ Mantém barra de progresso funcional
- ✅ Validação de integridade garantida
- ✅ **Resultado:** Upload de vídeos funcionando sem erros!

**6. Commit: dee85e0 (02/03/2026) - VERSÃO 4.0 - CANCELAMENTO AUTOMÁTICO**
- ✅ Migration SQL: Campos cancel_if_lead_replies e cancel_scope
- ✅ Função SQL: auto_cancel_scheduled_messages_on_reply()
- ✅ Frontend: Checkbox e radio buttons para controle de cancelamento
- ✅ Frontend: Badge visual indicando cancelamento ativo
- ✅ Webhook: Integração com função de cancelamento
- ✅ Webhook: Logs detalhados de cancelamento
- ✅ Suporte para mensagens únicas e recorrentes
- ✅ Escopo configurável: próxima mensagem ou todas
- ✅ **Resultado:** Sistema de cancelamento automático funcional!

**7. Commit: bf0791c (02/03/2026) - UI CANCELAMENTO**
- ✅ Interface aprimorada para todas as mensagens
- ✅ Controles de cancelamento visíveis
- ✅ Validações de formulário atualizadas
- ✅ **Resultado:** UX completa e intuitiva!

**8. Commit: e537b38 (02/03/2026) - LOG IDENTIFICADOR**
- ✅ Log único para forçar redeploy: "2026-03-02-17:40"
- ✅ Confirmação de versão ativa em produção
- ✅ **Resultado:** Deploy verificado com sucesso!

**9. Commit: 00f2dcd (02/03/2026) - WEBHOOK [company_id]**
- ✅ Cancelamento automático em webhook alternativo
- ✅ Cobertura completa de todos os webhooks
- ✅ **Resultado:** Sistema redundante e robusto!

**10. Commit: 98a3a79 (02/03/2026) - FIX PARÂMETRO**
- ✅ Corrigido parâmetro p_created_by faltante
- ✅ Resolve erro 404 ao agendar mensagens
- ✅ **Resultado:** Agendamento funcionando 100% em produção!

### **Arquivos Modificados:**

**Frontend:**
- `src/components/WhatsAppChat/LeadPanel/LeadPanel.tsx`
  - Adicionado dropdown de seleção de instância
  - Validações e avisos implementados
  - Estados para instâncias disponíveis
  - **v3.0:** Estados `isScheduling` e `uploadProgress`
  - **v3.0:** Barra de progresso visual
  - **v3.0:** Detecção automática de tipo de mídia
  - **v3.0:** Validação flexível (mídia sem texto)
  - **v4.0:** Checkbox de cancelamento automático
  - **v4.0:** Radio buttons para escopo de cancelamento
  - **v4.0:** Badge visual de cancelamento ativo
  - **v4.0:** Estados cancel_if_lead_replies e cancel_scope

**Backend:**
- `api/cron/process-scheduled-messages.js`
  - Endpoint UAZAPI corrigido
  - Headers de autenticação alinhados
  - Payload completo
  - Tratamento robusto de erro

- `api/uazapi-webhook-final.js`
  - **v4.0:** Integração com auto_cancel_scheduled_messages_on_reply()
  - **v4.0:** Logs detalhados de cancelamento
  - **v4.0:** Tratamento de erros robusto

- `api/webhook/uazapi/[company_id].js`
  - **v4.0:** Cancelamento automático implementado
  - **v4.0:** Cobertura redundante

**Services:**
- `src/services/chat/chatApi.ts`
  - Função `getCompanyInstances()` restaurada para busca direta
  - **v3.0:** Método `uploadMedia()` com callback de progresso

- `src/services/aws/s3Storage.ts`
  - **v3.0:** Upload com rastreamento de progresso
  - **v3.0:** Integração com @aws-sdk/lib-storage
  - **v3.0:** Evento `httpUploadProgress`

- `src/services/aws/types.ts`
  - **v3.0:** Interface `UploadToS3Options` com `onProgress`

**Migrations:**
- `supabase/migrations/20260225150600_add_video_audio_to_message_type_constraint.sql`
  - **v3.0:** Constraint corrigido para todos os tipos de mídia

**Dependências:**
- `package.json`
  - **v3.0:** Adicionado @aws-sdk/lib-storage

**Removidos:**
- `src/pages/api/whatsapp/instances.js` (desnecessário)

---

## ✅ TESTES REALIZADOS

### **Teste 1: Agendamento com seleção de instância**
- ✅ Dropdown carrega instâncias conectadas
- ✅ Pré-seleção automática funciona
- ✅ Validação de instância obrigatória
- ✅ Mensagem salva com instance_id correto

### **Teste 2: Processamento automático via cron**
- ✅ Cron executa a cada minuto
- ✅ Mensagens pendentes são encontradas
- ✅ Envio via UAZAPI bem-sucedido
- ✅ Status atualizado para 'sent'
- ✅ Logs detalhados no Vercel

### **Teste 3: Integração UAZAPI**
- ✅ Endpoint correto usado
- ✅ Header de autenticação aceito
- ✅ Payload processado corretamente
- ✅ Resposta JSON parseada com sucesso
- ✅ Mensagem entregue ao lead

### **Log de Sucesso (24/02/2026 21:55:32):**
```
📨 Found 1 pending messages to process
📤 UAZAPI Endpoint: https://lovoo.uazapi.com/send/text
📥 UAZAPI Response Status: 200
✅ JSON parseado com sucesso
✅ Mensagem enviada com sucesso via UAZAPI
✅ Processing completed: { total: 1, sent: 1, failed: 0 }
```

---

**Sistema implementado e testado em:** 24/02/2026  
**Última atualização:** 02/03/2026 18:40  
**Status:** ✅ 100% Funcional - Produção

---

## 🎉 VERSÃO 4.0 - CANCELAMENTO AUTOMÁTICO

**Deploy em Produção:** 02/03/2026  
**Repositório:** M4Agents/loovocrm  
**Commits Deployados:** 5 commits (dee85e0, bf0791c, e537b38, 00f2dcd, 98a3a79)  
**Teste em Produção:** ✅ Sucesso - Mensagem cancelada automaticamente  
**Ambiente:** https://app.lovoocrm.com/chat  

**Funcionalidade Validada:**
- ✅ Mensagem agendada com cancelamento automático
- ✅ Lead respondeu antes do horário
- ✅ Sistema cancelou automaticamente
- ✅ Status atualizado para 'cancelled'
- ✅ Mensagem de erro explicativa registrada
- ✅ Logs detalhados no webhook

**Sistema 100% operacional e pronto para uso em produção!**
