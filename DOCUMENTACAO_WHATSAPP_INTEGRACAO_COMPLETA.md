# 📱 DOCUMENTAÇÃO WHATSAPP INTEGRATION - LOVOCRM

## 🎯 **VISÃO GERAL**

Sistema de integração WhatsApp implementado no LovoCRM usando **Uazapi** como provider principal.

### **✅ STATUS ATUAL (06/12/2025)**
- **Versão**: V2.0.0 + Chat Completo + Preview de Mídia
- **Ambiente**: Produção (https://app.lovoocrm.com/)
- **Status**: 100% Funcional e Testado
- **Provider**: Uazapi (API não oficial premium)
- **Novidades**: Sistema de chat com preview de imagens e vídeos

---

## 🚨 **REGRAS CRÍTICAS DE IMPLEMENTAÇÃO**

### **PRINCÍPIO INVIOLÁVEL - IMPLEMENTAÇÃO ISOLADA**
- ✅ **NUNCA modificar** funcionalidades existentes
- ✅ **NUNCA alterar** arquivos que já funcionam  
- ✅ **SEMPRE criar** novos arquivos isolados
- ✅ **SEMPRE testar** sem afetar o sistema atual

### **LIÇÕES CRÍTICAS CORS - OBRIGATÓRIAS**
- ❌ **JAMAIS fazer** chamadas diretas do frontend para APIs externas
- ✅ **SEMPRE usar** funções RPC via Supabase
- ✅ **SEMPRE usar** SQL direto via funções RPC

### **PADRÃO ANTI-CORS OBRIGATÓRIO**
```
Frontend → Supabase RPC → SQL Function → HTTP Extension → Uazapi
NUNCA: Frontend → API Externa (CORS BLOCK)
```

---

## 🚀 **FUNCIONALIDADES IMPLEMENTADAS**

### **1. ✅ Criação de Instâncias**
- QR Code assíncrono com timeout de 180 segundos
- Modal responsivo com loading spinner
- Polling inteligente a cada 15 segundos
- Integração completa com Uazapi

### **2. ✅ Conexão Automática**
- Detecção automática via polling
- Mensagem: "WhatsApp conectado com sucesso!"
- Atualização automática da lista
- Sync de profile (nome + telefone)

### **3. ✅ Listagem de Instâncias**
- Lista dinâmica em tempo real
- Status visual: Conectado (verde), Conectando (amarelo), Desconectado (vermelho)
- Informações: Nome, telefone, data de conexão
- Sincronização 100% com Uazapi

### **4. ✅ Edição de Instâncias**
- Botão "Alterar" com prompt
- Validação de nome único
- Feedback de sucesso/erro
- Atualização imediata da lista

### **5. ✅ Exclusão de Instâncias**
- Botão "Excluir" com confirmação
- Remoção local + Uazapi
- Mensagens amigáveis (sem termos técnicos)
- Consistência garantida

### **6. ✅ Foto de Perfil Automática**
- Sincronização automática após conexão
- Sincronização automática no carregamento
- Avatar com foto real da Uazapi
- Fallback elegante com iniciais coloridas
- Botão manual de sincronização (backup)

### **7. ✅ Sistema de Chat Completo**
- Interface de chat em tempo real
- Recebimento automático de mensagens via webhook
- Criação automática de leads para novos contatos
- Histórico completo de conversas
- Interface responsiva e moderna

### **8. ✅ Preview de Mídia (NOVO)**
- **Imagens**: PNG, JPG, WebP com preview automático
- **Vídeos**: MP4, WebM com player integrado
- **Descriptografia**: URLs do WhatsApp processadas via Uazapi
- **Supabase Storage**: Armazenamento seguro de arquivos
- **Formato preservado**: PNG mantido como PNG, MP4 como MP4

---

## 🏗️ **ARQUITETURA IMPLEMENTADA**

### **Frontend (React + TypeScript)**
```
src/components/WhatsAppLife/
├── WhatsAppLifeModule.tsx       # Componente principal
├── InstanceAvatar.tsx           # Avatar com foto
├── QRCodeModal.tsx             # Modal QR Code  
└── AddInstanceModal.tsx        # Modal criação

src/components/WhatsAppChat/
├── ChatArea/
│   └── ChatArea.tsx            # Interface de chat principal
├── MessageBubble.tsx           # Componente de mensagem
└── MediaPreview.tsx            # Preview de mídia

src/hooks/
├── useWhatsAppInstancesWebhook100.ts  # Hook instâncias
└── useChatMessages.ts          # Hook mensagens

src/types/
├── whatsapp-life.ts            # Tipos instâncias
└── chat.ts                     # Tipos chat
```

### **Backend (Supabase + PostgreSQL)**
```sql
-- Tabelas
whatsapp_temp_instances         -- Instâncias temporárias (QR Code)
whatsapp_life_instances         -- Instâncias permanentes (conectadas)
chat_contacts                   -- Contatos do chat
chat_conversations              -- Conversas
chat_messages                   -- Mensagens

-- RPCs Implementados
generate_whatsapp_qr_code_async     -- Geração QR Code
check_instance_connection_status    -- Verificação de conexão  
sync_instances_with_uazapi         -- Sincronização
delete_whatsapp_instance           -- Exclusão (V2)
update_instance_name               -- Alteração de nome
sync_instance_profile_data         -- Sincronização foto perfil
chat_get_messages                  -- Buscar mensagens do chat
```

### **Webhooks (Next.js API Routes)**
```javascript
api/uazapi-webhook-final.js         -- Webhook principal Uazapi
api/webhook/uazapi/[company_id].js  -- Webhook por empresa

// Funcionalidades dos webhooks:
- Recebimento de mensagens WhatsApp
- Criação automática de leads
- Processamento de mídia (imagens/vídeos)
- Descriptografia via API /message/download
- Upload para Supabase Storage
```

### **Integração Uazapi**
```
Base URL: https://lovoo.uazapi.com

Endpoints utilizados:
├── POST /instance/init        # Criar instância
├── GET  /instance/connect     # Gerar QR Code
├── GET  /instance/status      # Verificar status + foto
├── DELETE /instance           # Excluir instância
└── POST /message/download     # Descriptografar mídia (NOVO)

Autenticação: Token por instância
Rate Limits: Respeitados
Error Handling: Códigos 200, 401, 404, 500
Webhook: Configurado para receber mensagens
```

---

## 🔄 **FLUXOS FUNCIONAIS**

### **Fluxo de Criação**
```
1. Usuário clica "Conectar WhatsApp"
2. Modal abre com loading spinner
3. RPC generate_whatsapp_qr_code_async executa
4. QR Code aparece automaticamente
5. Polling verifica conexão a cada 15s
6. Ao conectar: "WhatsApp conectado com sucesso!"
7. Foto sincronizada automaticamente
8. Lista recarregada com nova instância
```

### **Fluxo de Exclusão**
```
1. Usuário clica botão "Excluir"
2. Confirmação amigável exibida
3. RPC delete_whatsapp_instance V2 executa:
   - Busca instância local
   - Tenta excluir da Uazapi (token correto)
   - Remove do banco local
   - Retorna debug info
4. Feedback de sucesso/erro
5. Lista atualizada automaticamente
```

### **Fluxo de Sincronização de Foto**
```
1. Sistema detecta instância sem foto
2. RPC sync_instance_profile_data executa:
   - Chama GET /instance/status na Uazapi
   - Extrai profilePicUrl + profileName
   - Atualiza tabela local
3. Avatar atualizado automaticamente
4. Fallback para iniciais se sem foto
```

### **Fluxo de Recebimento de Mensagens (NOVO)**
```
1. WhatsApp envia mensagem para instância conectada
2. Uazapi recebe e envia webhook para sistema
3. Webhook api/uazapi-webhook-final.js processa:
   - Identifica empresa pela instância
   - Cria/atualiza contato automaticamente
   - Cria lead se for novo contato
   - Salva mensagem na tabela chat_messages
4. Se mensagem contém mídia:
   - Chama API /message/download da Uazapi
   - Descriptografa URL da mídia
   - Faz upload para Supabase Storage
   - Atualiza mensagem com URL do Storage
5. Frontend atualiza chat em tempo real
```

### **Fluxo de Preview de Mídia (NOVO)**
```
1. Usuário recebe imagem/vídeo via WhatsApp
2. Sistema detecta tipo de mídia (image, video, audio)
3. Função processMediaMessageRobust executa:
   - Detecta formato real (PNG, MP4, etc.)
   - Usa URL descriptografada da Uazapi
   - Define content-type correto
   - Faz upload para Supabase Storage
4. Frontend renderiza preview:
   - Imagens: <img> com preview automático
   - Vídeos: <video> com controles
   - Fallback para "Mídia indisponível" se erro
5. Usuário pode clicar para abrir em nova aba
```

---

## 🧪 **CONFIGURAÇÕES DE PRODUÇÃO**

### **Supabase (M4_Digital)**
```
Projeto ID: etzdsywunlpbgxkphuil
Extensões: http (instalada)
RLS: Habilitado nas tabelas
Migrations: Todas aplicadas
Storage: Bucket 'chat-media' configurado
Webhook: URLs configuradas para receber da Uazapi
```

### **Vercel**
```
URL: https://app.lovoocrm.com/
Build: Sem erros
Deploy: Automático via GitHub
Performance: Otimizada
```

### **GitHub**
```
Repositório: https://github.com/M4Agents/loovocrm
Branch: main
Tag: v2.0.0
Status: Sincronizado
```

---

## 🎯 **CORREÇÕES TÉCNICAS IMPLEMENTADAS (06/12/2025)**

### **Problema 1: Imagens Corrompidas ✅ RESOLVIDO**
```javascript
// ❌ ANTES: URLs criptografadas do WhatsApp
const response = await fetch(whatsappUrl); // Imagem corrompida

// ✅ DEPOIS: Descriptografia via Uazapi
const uazapiResponse = await fetch('/message/download', { id: messageId });
const descriptografedUrl = uazapiResponse.fileURL;
const response = await fetch(descriptografedUrl); // Imagem válida
```

### **Problema 2: Formato PNG → JPG ✅ RESOLVIDO**
```javascript
// ❌ ANTES: Hardcode que convertia tudo para JPG
const extension = 'jpg'; // Sempre JPG

// ✅ DEPOIS: Detecção inteligente de formato
function getFileExtensionRobust(mediaType, originalUrl) {
  if (mediaType === 'image' && originalUrl.includes('whatsapp.net')) {
    return 'png'; // Preserva PNG original
  }
}
```

### **Problema 3: Vídeos "Indisponíveis" ✅ RESOLVIDO**
```javascript
// ❌ ANTES: Hardcode para 'image'
const processedUrl = await processMediaMessageRobust(null, 'image', supabase);

// ✅ DEPOIS: Tipo dinâmico
const processedUrl = await processMediaMessageRobust(null, mediaType, supabase);
```

## 🚀 **PRÓXIMAS IMPLEMENTAÇÕES**

### **Fase 3 - Melhorias (Planejado)**
1. **Envio de mensagens** via interface
2. **Templates de mensagem** pré-definidos
3. **Notificações push** para novas mensagens
4. **Relatórios** de conversas

### **Fase 4 - WhatsApp Cloud API (Planejado)**
1. **Integração oficial** Meta
2. **Arquitetura híbrida** (Uazapi + Cloud API)
3. **Migração** entre providers
4. **Compliance** total

---

**Documento atualizado em**: 06/12/2025 06:48  
**Versão**: 4.0 - Sistema Completo com Chat e Mídia  
**Status**: Todas as funcionalidades implementadas e funcionais  
**Última correção**: Preview de mídia (imagens e vídeos) 100% operacional
