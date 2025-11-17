# 📱 DOCUMENTAÇÃO TÉCNICA COMPLETA - INTEGRAÇÃO WHATSAPP LOVOCRM

## 🎯 **VISÃO GERAL DO PROJETO**

Este documento contém **todos os detalhes técnicos** para implementação da integração WhatsApp no LovoCRM, suportando **duas APIs**:
- **Uazapi**: API não oficial premium com recursos avançados
- **WhatsApp Cloud API**: API oficial da Meta com compliance total

### **📊 ESTRATÉGIA HÍBRIDA**
O LovoCRM implementará uma **arquitetura híbrida** que permite às empresas:
1. **Escolher o provider** mais adequado ao seu perfil
2. **Migrar entre providers** sem perda de dados
3. **Usar ambos simultaneamente** com roteamento inteligente
4. **Backup automático** em caso de problemas

---

## 🚨 **REGRAS CRÍTICAS DE IMPLEMENTAÇÃO**

### **PRINCÍPIO INVIOLÁVEL - IMPLEMENTAÇÃO ISOLADA**
- ✅ **NUNCA modificar** funcionalidades existentes
- ✅ **NUNCA alterar** arquivos que já funcionam  
- ✅ **NUNCA quebrar** sistemas em produção
- ✅ **SEMPRE criar** novos arquivos isolados
- ✅ **SEMPRE testar** sem afetar o sistema atual

### **LIÇÕES CRÍTICAS CORS - OBRIGATÓRIAS**
- ❌ **JAMAIS fazer** chamadas diretas do frontend para APIs externas
- ❌ **JAMAIS usar** RPC calls diretas do React
- ❌ **JAMAIS ignorar** headers CORS
- ✅ **SEMPRE usar** webhook approach server-side
- ✅ **SEMPRE usar** SQL direto via funções RPC
- ✅ **SEMPRE usar** Supabase client nos endpoints

### **PADRÃO ANTI-CORS OBRIGATÓRIO**
```
Frontend → Webhook Isolado → Supabase Client → SQL Function → Banco
NUNCA: Frontend → API Externa (CORS BLOCK)
```

---

## 📋 **ÍNDICE DA DOCUMENTAÇÃO**

### **PARTE 1 - VISÃO GERAL** ✅ (Este arquivo)
- Estratégia híbrida
- Regras críticas
- Comparativo técnico

### **PARTE 2 - IMPLEMENTAÇÃO V1.0.0** ✅ (CONCLUÍDA)
- **Status**: ✅ FUNCIONAL EM PRODUÇÃO
- **Data**: 17/11/2025
- **URL**: https://app.lovoocrm.com/
- **Funcionalidades**: Criação, Conexão, Listagem, Edição, Exclusão

### **PARTE 3 - UAZAPI DETALHADA** (Próxima)
- OpenAPI specification completa
- Endpoints mapeados
- Estruturas de dados
- Exemplos de implementação

### **PARTE 3 - WHATSAPP CLOUD API** (Próxima)
- Documentação oficial Meta
- Recursos e limitações
- Configuração Business Account
- Compliance e verificação

### **PARTE 4 - ARQUITETURA HÍBRIDA** (Próxima)
- Provider Pattern
- Estrutura de banco unificada
- Endpoints unificados
- Roteamento inteligente

### **PARTE 5 - IMPLEMENTAÇÃO ANTI-CORS** (Próxima)
- Webhooks isolados
- Funções RPC obrigatórias
- Headers CORS corretos
- Padrões de segurança

### **PARTE 6 - ESTRUTURA DE BANCO** (Próxima)
- Tabelas unificadas
- Relacionamentos
- Índices e performance
- Migrações

### **PARTE 7 - ENDPOINTS API** (Próxima)
- Estrutura de pastas
- Implementações específicas
- Roteamento unificado
- Tratamento de erros

### **PARTE 8 - INTERFACE FRONTEND** (Próxima)
- Componentes isolados
- Provider selector
- Chat interface
- Configurações

### **PARTE 9 - SEQUÊNCIA DE IMPLEMENTAÇÃO** (Próxima)
- Fases detalhadas
- Cronograma
- Testes obrigatórios
- Validações

### **PARTE 10 - CASOS DE USO** (Próxima)
- Cenários de implementação
- Estratégias por perfil
- Migração entre providers
- Troubleshooting

---

## 📊 **COMPARATIVO TÉCNICO RESUMIDO**

| **Aspecto** | **Uazapi (Não Oficial)** | **WhatsApp Cloud API (Oficial)** |
|-------------|---------------------------|-----------------------------------|
| **Tipo** | API não oficial paga | API oficial da Meta |
| **Setup** | ✅ QR Code simples | ⚠️ Business verification complexa |
| **Recursos** | ✅ Completos (botões, listas, enquetes, carrossel) | ⚠️ Limitados mas oficiais |
| **Confiabilidade** | ⚠️ Média (pode quebrar com updates) | ✅ Alta (suporte oficial Meta) |
| **Compliance** | ❌ Pode violar ToS WhatsApp | ✅ 100% conforme ToS |
| **Custo** | 💰 Pago por instância/mês | 💰 Pago por mensagem enviada |
| **Suporte** | 📧 Suporte da Uazapi | 🏢 Suporte oficial Meta |
| **Limitações** | ⚠️ Dependente engenharia reversa | ⚠️ Menos recursos interativos |

---

## 🎯 **OBJETIVOS DO PROJETO**

### **Objetivos Primários:**
1. **Implementar módulo WhatsApp** completo no LovoCRM
2. **Suportar ambas as APIs** (Uazapi + Cloud API)
3. **Manter isolamento total** do sistema existente
4. **Garantir zero impacto** nas funcionalidades atuais

### **Objetivos Secundários:**
1. **Diferencial competitivo** único no mercado
2. **Flexibilidade total** para empresas
3. **Redução de risco** técnico e comercial
4. **Escalabilidade** para diferentes perfis

### **Objetivos de Compliance:**
1. **Opção oficial** para empresas regulamentadas
2. **Opção flexível** para startups e PMEs
3. **Migração suave** entre providers
4. **Backup automático** em caso de problemas

---

## 🏗️ **ARQUITETURA GERAL**

### **Camadas da Arquitetura:**
```
┌─────────────────────────────────────────┐
│           FRONTEND REACT                │
│     (Interface Unificada)               │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│         ENDPOINTS UNIFICADOS            │
│    (/api/whatsapp/unified/*)            │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│        PROVIDER ABSTRACTION             │
│     (Factory + Adapter Pattern)        │
└─────┬───────────────────────────┬───────┘
      │                           │
┌─────▼─────┐               ┌─────▼─────┐
│  UAZAPI   │               │ CLOUD API │
│ PROVIDER  │               │ PROVIDER  │
└─────┬─────┘               └─────┬─────┘
      │                           │
┌─────▼─────┐               ┌─────▼─────┐
│  UAZAPI   │               │   META    │
│    API    │               │ GRAPH API │
└───────────┘               └───────────┘
```

### **Fluxo de Dados:**
```
1. Recebimento: API → Webhook → Adapter → Banco Unificado
2. Envio: Frontend → Unified API → Provider → API Específica
3. Status: Frontend → Unified Status → Provider Status → API Status
```

---

## 📱 **FUNCIONALIDADES IMPLEMENTADAS**

### **Core Features:**
- ✅ **Envio de mensagens** (texto, mídia, documentos)
- ✅ **Recebimento via webhook** (tempo real)
- ✅ **Gestão de conversas** (histórico, busca)
- ✅ **Status de entrega** (enviado, entregue, lido)
- ✅ **Múltiplas instâncias** por empresa

### **Advanced Features:**
- ✅ **Mensagens interativas** (botões, listas, enquetes)
- ✅ **Templates de mensagem** (personalizáveis)
- ✅ **Integração com leads** (automática)
- ✅ **Campos personalizados** (placeholders dinâmicos)
- ✅ **Respostas automáticas** (configuráveis)

### **Enterprise Features:**
- ✅ **Multi-provider** (Uazapi + Cloud API)
- ✅ **Roteamento inteligente** (por tipo, volume, compliance)
- ✅ **Migração entre providers** (sem perda de dados)
- ✅ **Backup automático** (redundância)
- ✅ **Métricas comparativas** (performance por provider)

---

## 🔒 **SEGURANÇA E COMPLIANCE**

### **Segurança Implementada:**
- 🔐 **Tokens criptografados** no banco de dados
- 🔐 **Validação de origem** nos webhooks
- 🔐 **Rate limiting** em todos os endpoints
- 🔐 **Isolamento por empresa** (company_id obrigatório)
- 🔐 **Headers CORS** adequados

### **Compliance por Provider:**
- **Uazapi**: ⚠️ Não oficial, pode violar ToS
- **Cloud API**: ✅ 100% oficial, compliance total
- **Híbrido**: ✅ Empresa escolhe nível de compliance

---

## 📊 **MÉTRICAS E MONITORAMENTO**

### **Métricas por Provider:**
- 📈 **Mensagens enviadas/recebidas**
- 📈 **Taxa de entrega**
- 📈 **Tempo de resposta**
- 📈 **Uptime da conexão**
- 📈 **Custos por mensagem**

### **Alertas Configurados:**
- 🚨 **Instância desconectada**
- 🚨 **Webhook com falha**
- 🚨 **Rate limit atingido**
- 🚨 **Erro de autenticação**
- 🚨 **Falha na entrega**

---

## 🎯 **PRÓXIMOS PASSOS**

Este arquivo será **atualizado progressivamente** com:

### **PRÓXIMA ATUALIZAÇÃO - PARTE 2:**
- Documentação completa da Uazapi
- OpenAPI specification detalhada
- Todos os endpoints mapeados
- Estruturas de dados completas
- Exemplos de implementação

**Status**: 📝 Preparando PARTE 2 - UAZAPI DETALHADA

---

---

# 🔧 **PARTE 2 - UAZAPI DOCUMENTAÇÃO TÉCNICA DETALHADA**

## 🎯 **VISÃO GERAL UAZAPI**

### **Informações Básicas:**
- **Nome**: uazapiGO - WhatsApp API (v2.0)
- **Versão**: 1.0.0
- **Tipo**: API Premium não oficial para WhatsApp
- **Site**: https://uazapi.dev/
- **Documentação**: https://docs.uazapi.com/
- **Protocolo**: REST API sobre HTTPS

### **Características Principais:**
- ✅ **Multi-instância**: Suporte a múltiplas instâncias WhatsApp
- ✅ **QR Code**: Conexão simples via escaneamento
- ✅ **Webhooks**: Notificações em tempo real
- ✅ **Mensagens interativas**: Botões, listas, enquetes, carrossel
- ✅ **CRM integrado**: Sistema de leads com 20+ campos
- ✅ **Chatbot IA**: Integração com OpenAI e outros providers

### **⚠️ Recomendação Crítica:**
**É ALTAMENTE RECOMENDADO usar contas do WhatsApp Business** em vez do WhatsApp normal para integração. O WhatsApp normal pode apresentar inconsistências, desconexões, limitações e instabilidades.

---

## 🔐 **SISTEMA DE AUTENTICAÇÃO**

### **Tipos de Token:**
```yaml
# Token de Instância (endpoints regulares)
Headers:
  token: "instance-token-here"

# Token de Admin (endpoints administrativos)  
Headers:
  admintoken: "admin-token-here"
```

### **Configuração Base:**
```javascript
const uazapiConfig = {
  baseURL: 'https://{subdomain}.uazapi.com',
  adminToken: '[ADMIN-TOKEN]',
  instanceId: '[INSTANCE-ID]', 
  instanceToken: '[INSTANCE-TOKEN]'
}
```

### **Estados da Instância:**
- **`disconnected`**: Desconectado do WhatsApp
- **`connecting`**: Em processo de conexão (aguardando QR)
- **`connected`**: Conectado e autenticado com sucesso

---

## 📊 **ENDPOINTS PRINCIPAIS MAPEADOS**

### **1. ADMINISTRAÇÃO DE INSTÂNCIAS**

#### **Criar Nova Instância**
```javascript
POST /instance/create
Headers: { admintoken: 'admin-token' }
Body: {
  name: 'instancia-lovocrm',
  adminField01: 'metadata-1', // opcional
  adminField02: 'metadata-2'  // opcional
}

Response: {
  response: "Instance created successfully",
  instance: { /* dados da instância */ },
  token: "instance-token-gerado",
  connected: false,
  loggedIn: false
}
```

#### **Listar Todas as Instâncias (Admin)**
```javascript
GET /instance/all
Headers: { admintoken: 'admin-token' }

Response: [
  {
    id: "r183e2ef9597845",
    name: "instancia-1", 
    token: "abc123xyz",
    status: "connected",
    profileName: "Meu WhatsApp",
    isBusiness: true,
    created: "2024-01-01T12:00:00.000Z"
  }
]
```

#### **Obter Informações da Instância**
```javascript
GET /instance/info
Headers: { token: 'instance-token' }

Response: {
  instance: {
    id: "r183e2ef9597845",
    name: "minha-instancia",
    status: "connected",
    qrcode: "data:image/png;base64,iVBOR...", // se connecting
    profileName: "Meu WhatsApp",
    profilePicUrl: "https://...",
    isBusiness: true
  },
  status: {
    connected: true,
    loggedIn: true,
    jid: {
      user: "5511999999999",
      server: "s.whatsapp.net"
    }
  }
}
```

### **2. ENVIO DE MENSAGENS**

#### **Mensagem de Texto**
```javascript
POST /message/text
Headers: { token: 'instance-token' }
Body: {
  number: "5511999999999",
  text: "Mensagem do LovoCRM"
}

Response: {
  status: "success",
  message: "Message sent successfully"
}
```

#### **Mensagens Interativas**
```javascript
POST /message/interactive
Headers: { token: 'instance-token' }
Body: {
  number: "5511999999999",
  type: "button", // button, list, poll, carousel
  text: "Escolha uma opção:",
  choices: [
    "Sim|sim",
    "Não|nao", 
    "Talvez|talvez"
  ],
  footerText: "Rodapé opcional"
}
```

#### **Tipos de Mensagens Interativas:**

**Botões:**
```javascript
{
  type: "button",
  text: "Promoção Especial!",
  choices: [
    "Ver Ofertas|https://loja.com/ofertas",
    "Falar com Vendedor|reply:vendedor",
    "Copiar Cupom|copy:PROMO2024"
  ],
  footerText: "Válido até 31/12/2024",
  imageButton: "https://exemplo.com/banner.jpg"
}
```

**Listas:**
```javascript
{
  type: "list", 
  text: "Catálogo de Produtos",
  choices: [
    "[Eletrônicos]",
    "Smartphones|phones|Últimos lançamentos",
    "Notebooks|notes|Modelos 2024",
    "[Acessórios]", 
    "Fones|fones|Bluetooth e com fio"
  ],
  listButton: "Ver Catálogo"
}
```

**Enquetes:**
```javascript
{
  type: "poll",
  text: "Qual horário prefere?",
  choices: [
    "Manhã (8h-12h)",
    "Tarde (13h-17h)", 
    "Noite (18h-22h)"
  ],
  selectableCount: 1
}
```

#### **Envio de Mídia**
```javascript
// Imagem
POST /message/image
Body: {
  number: "5511999999999",
  image: "https://exemplo.com/imagem.jpg", // ou base64
  caption: "Legenda da imagem"
}

// Documento  
POST /message/document
Body: {
  number: "5511999999999",
  document: "https://exemplo.com/doc.pdf",
  docName: "Documento.pdf"
}

// Áudio
POST /message/audio
Body: {
  number: "5511999999999", 
  audio: "https://exemplo.com/audio.mp3"
}

// Vídeo
POST /message/video  
Body: {
  number: "5511999999999",
  video: "https://exemplo.com/video.mp4",
  caption: "Legenda do vídeo"
}
```

### **3. CONFIGURAÇÃO DE WEBHOOKS**

#### **Webhook da Instância**
```javascript
POST /webhook/set
Headers: { token: 'instance-token' }
Body: {
  url: "https://app.lovoocrm.com/api/whatsapp/webhook-receive",
  events: [
    "messages",
    "connection", 
    "presence",
    "groups"
  ],
  excludeMessages: [
    "wasSentByApi" // CRÍTICO: evita loops
  ],
  addUrlEvents: false,
  addUrlTypesMessages: false
}
```

#### **Webhook Global (Admin)**
```javascript
POST /webhook/setGlobal
Headers: { admintoken: 'admin-token' }
Body: {
  url: "https://app.lovoocrm.com/api/whatsapp/global-webhook",
  events: ["messages", "connection"],
  excludeMessages: ["wasSentByApi"]
}
```

### **4. GESTÃO DE CONVERSAS**

#### **Buscar Conversas**
```javascript
POST /chat/find
Headers: { token: 'instance-token' }
Body: {
  number: "5511999999999" // opcional
}

Response: {
  chats: [
    {
      id: "r7a8b9c0d1e",
      wa_chatid: "5511999999999@s.whatsapp.net",
      wa_contactName: "João Silva",
      wa_name: "João",
      name: "João Silva",
      wa_isGroup: false,
      wa_lastMsgTimestamp: 1640995200000
    }
  ]
}
```

#### **Editar Lead/Contato**
```javascript
POST /chat/editLead
Headers: { token: 'instance-token' }
Body: {
  number: "5511999999999",
  lead_name: "João Silva",
  lead_email: "joao@email.com",
  lead_field01: "Empresa XYZ",
  lead_field02: "Gerente"
}
```

### **5. DOWNLOAD DE ARQUIVOS**
```javascript
POST /message/download
Headers: { token: 'instance-token' }
Body: {
  id: "7EB0F01D7244B421048F0706368376E0",
  return_base64: true,
  generate_mp3: true, // para áudios
  transcribe: false,  // transcrever áudio
  return_link: true
}

Response: {
  fileURL: "https://api.exemplo.com/files/arquivo.mp3",
  mimetype: "audio/mpeg", 
  base64Data: "UklGRkj...",
  transcription: "Texto transcrito" // se transcribe=true
}
```

---

## 📡 **ESTRUTURAS DE DADOS DETALHADAS**

### **Schema Instance:**
```typescript
interface Instance {
  id: string;                    // UUID gerado automaticamente
  token: string;                 // Token de autenticação da instância
  status: 'disconnected' | 'connecting' | 'connected';
  paircode?: string;             // Código de pareamento
  qrcode?: string;               // QR Code em base64
  name: string;                  // Nome da instância
  profileName?: string;          // Nome do perfil WhatsApp
  profilePicUrl?: string;        // URL da foto do perfil
  isBusiness: boolean;           // Se é conta business
  plataform?: string;            // iOS/Android/Web
  systemName?: string;           // Nome do sistema operacional
  owner?: string;                // Proprietário da instância
  lastDisconnect?: string;       // Última desconexão
  created: string;               // Data de criação
  updated: string;               // Última atualização
}
```

### **Schema Message:**
```typescript
interface Message {
  id: string;                    // ID único interno (r + 7 hex)
  messageid: string;             // ID original da mensagem
  chatid: string;                // ID da conversa
  fromMe: boolean;               // Se foi enviada pelo usuário
  isGroup: boolean;              // Se é mensagem de grupo
  messageType: 'text' | 'image' | 'video' | 'document' | 'audio' | 'location' | 'button' | 'list' | 'reaction';
  messageTimestamp: number;      // Timestamp em milissegundos
  edited?: string;               // Histórico de edições
  quoted?: string;               // ID da mensagem citada
  reaction?: string;             // ID da mensagem reagida
  sender: string;                // ID do remetente
  senderName: string;            // Nome do remetente
  source?: 'ios' | 'web' | 'android';
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'deleted';
  text: string;                  // Texto da mensagem
  vote?: string;                 // Dados de votação
  buttonOrListid?: string;       // ID do botão/item selecionado
  fileURL?: string;              // URL de download de mídia
  content: string;               // Conteúdo completo em JSON
  owner?: string;                // Dono da mensagem
  track_source?: string;         // Origem do rastreamento
  track_id?: string;             // ID de rastreamento
  created: string;               // Data de criação
  updated: string;               // Última atualização
}
```

### **Schema Chat:**
```typescript
interface Chat {
  id: string;                    // ID único (r + 7 hex)
  wa_fastid: string;             // ID rápido do WhatsApp
  wa_chatid: string;             // ID completo do chat
  wa_archived: boolean;          // Se está arquivado
  wa_contactName: string;        // Nome do contato
  wa_name: string;               // Nome do WhatsApp
  name: string;                  // Nome exibido
  image?: string;                // URL da imagem
  imagePreview?: string;         // Miniatura da imagem
  wa_ephemeralExpiration: number; // Expiração de mensagens efêmeras
  wa_isBlocked: boolean;         // Se está bloqueado
  wa_isGroup: boolean;           // Se é grupo
  wa_isGroup_admin: boolean;     // Se é admin do grupo
  wa_isGroup_announce: boolean;  // Se é grupo de anúncios
  wa_isGroup_community: boolean; // Se é comunidade
  wa_isGroup_member: boolean;    // Se é membro do grupo
  wa_isPinned: boolean;          // Se está fixado
  wa_label: string;              // Labels em JSON
  wa_lastMessageTextVote: string; // Texto/voto da última mensagem
  wa_lastMessageType: string;    // Tipo da última mensagem
  wa_lastMsgTimestamp: number;   // Timestamp da última mensagem
  wa_lastMessageSender: string;  // Remetente da última mensagem
}
```

---

## 🔗 **SISTEMA DE WEBHOOKS AVANÇADO**

### **Eventos Suportados:**
```javascript
const webhookEvents = [
  'connection',      // Alterações no estado da conexão
  'history',         // Recebimento de histórico
  'messages',        // Novas mensagens recebidas
  'messages_update', // Atualizações em mensagens
  'call',           // Eventos de chamadas VoIP
  'contacts',       // Atualizações na agenda
  'presence',       // Alterações no status de presença
  'groups',         // Modificações em grupos
  'labels',         // Gerenciamento de etiquetas
  'chats',          // Eventos de conversas
  'chat_labels',    // Alterações em etiquetas de conversas
  'blocks',         // Bloqueios/desbloqueios
  'leads',          // Atualizações de leads
  'sender'          // Campanhas de envio em massa
];
```

### **Filtros de Mensagens (CRÍTICO ANTI-LOOP):**
```javascript
const excludeMessages = [
  'wasSentByApi',     // ⚠️ OBRIGATÓRIO: Evita loops infinitos
  'wasNotSentByApi',  // Mensagens não da API
  'fromMeYes',        // Mensagens enviadas pelo usuário
  'fromMeNo',         // Mensagens recebidas de terceiros
  'isGroupYes',       // Mensagens em grupos
  'isGroupNo'         // Mensagens individuais
];
```

### **Estrutura do Webhook Event:**
```typescript
interface WebhookEvent {
  event: 'message' | 'status' | 'presence' | 'group' | 'connection';
  instance: string;              // ID da instância
  data: {
    // Dados específicos do evento
    message?: Message;
    chat?: Chat;
    status?: ConnectionStatus;
    // ... outros dados conforme evento
  };
}
```

---

## 🤖 **SISTEMA CRM INTEGRADO**

### **Campos Personalizados (20 campos):**
```javascript
POST /instance/updateFieldsMap
Headers: { token: 'instance-token' }
Body: {
  lead_field01: "nome",
  lead_field02: "email", 
  lead_field03: "telefone",
  lead_field04: "empresa",
  lead_field05: "cargo",
  lead_field06: "cidade",
  lead_field07: "estado",
  lead_field08: "interesse",
  lead_field09: "origem",
  lead_field10: "status",
  // ... até lead_field20
}
```

### **Placeholders Dinâmicos:**
```javascript
// Campos do Chat
"{{name}}"           // Nome do contato
"{{wa_name}}"        // Nome do perfil WhatsApp
"{{wa_contactName}}" // Nome salvo no WhatsApp

// Campos do Lead  
"{{lead_name}}"      // Nome do lead
"{{lead_email}}"     // Email do lead
"{{lead_field01}}"   // Campo personalizado 1
// ... até {{lead_field20}}

// Exemplo de uso
const message = {
  text: "Olá {{name}}! Vi que você trabalha na {{lead_field04}}. Seu email {{lead_email}} está correto?"
};
```

---

## 🚀 **FUNCIONALIDADES AVANÇADAS**

### **1. Chatbot e IA**
```javascript
// Configuração OpenAI
POST /instance/updatechatbotsettings
Body: {
  openai_apikey: "sk-1234567890abcdef...",
  chatbot_enabled: true,
  chatbot_ignoreGroups: true,
  chatbot_stopConversation: "stop",
  chatbot_stopMinutes: 30,
  chatbot_stopWhenYouSendMsg: 5
}

// Triggers automáticos
POST /trigger/edit
Body: {
  type: "agent", // ou "quickreply"
  agent_id: "agent-uuid",
  ignoreGroups: true,
  wordsToStart: "olá|bom dia|oi",
  responseDelay_seconds: 10,
  priority: 1
}
```

### **2. Mensagens em Massa**
```javascript
POST /sender/send
Body: {
  delayMin: 3,        // Delay mínimo entre mensagens
  delayMax: 6,        // Delay máximo entre mensagens
  scheduled_for: 1,   // Agendamento (horas)
  messages: [
    {
      number: "5511999999999",
      type: "text",
      text: "Mensagem em massa 1"
    },
    {
      number: "5511888888888", 
      type: "button",
      text: "Promoção especial!",
      choices: ["Ver Ofertas|link", "Contato|reply"]
    }
  ]
}
```

### **3. Gestão de Contatos**
```javascript
// Adicionar contato
POST /contact/add
Body: {
  phone: "5511999999999",
  name: "João Silva"
}

// Remover contato
POST /contact/remove  
Body: {
  phone: "5511999999999"
}

// Bloquear/desbloquear
POST /chat/block
Body: {
  number: "5511999999999",
  block: true
}
```

---

## ⚠️ **LIMITAÇÕES E CONSIDERAÇÕES**

### **Limitações Técnicas:**
- 🔴 **API não oficial**: Dependente de engenharia reversa
- 🔴 **Pode quebrar**: Updates do WhatsApp podem causar instabilidade
- 🔴 **Viola ToS**: Pode violar termos de serviço do WhatsApp
- 🔴 **Rate limits**: Limite de requisições por servidor
- 🔴 **Custo**: Pago por instância (valor não especificado)

### **Limitações de Recursos:**
- ⚠️ **Limite de instâncias**: Máximo por servidor
- ⚠️ **Recursos interativos**: Podem ser descontinuados sem aviso
- ⚠️ **Suporte**: Limitado ao suporte da Uazapi
- ⚠️ **Backup**: Não há garantia de continuidade

### **Recomendações de Uso:**
- ✅ **Ideal para**: Startups, PMEs, casos que precisam de recursos avançados
- ✅ **Não ideal para**: Empresas regulamentadas, casos críticos de compliance
- ✅ **Backup**: Sempre ter alternativa (Cloud API) configurada
- ✅ **Monitoramento**: Acompanhar status constantemente

---

---

# 🏢 **PARTE 3 - WHATSAPP CLOUD API OFICIAL (META)**

## 🎯 **VISÃO GERAL CLOUD API**

### **Informações Básicas:**
- **Nome**: WhatsApp Cloud API
- **Versão**: v17.0 (Graph API)
- **Tipo**: API oficial da Meta/Facebook
- **Documentação**: https://developers.facebook.com/docs/whatsapp/cloud-api/
- **Protocolo**: REST API baseada na Graph API
- **Base URL**: `https://graph.facebook.com/v17.0/`

### **Características Principais:**
- ✅ **100% Oficial**: Suportada diretamente pela Meta
- ✅ **Compliance Total**: Conforme todos os termos de serviço
- ✅ **Escalabilidade**: Suporte empresarial robusto
- ✅ **Confiabilidade**: Alta disponibilidade e suporte oficial
- ✅ **Segurança**: Padrões enterprise de segurança

### **⚠️ Limitações Importantes:**
- **Setup Complexo**: Requer verificação de negócio
- **Recursos Limitados**: Menos funcionalidades interativas
- **Custo por Mensagem**: Cobrança por mensagem enviada
- **Aprovação de Templates**: Templates precisam ser aprovados

---

## 🏗️ **ARQUITETURA E RECURSOS**

### **Recursos Principais:**
1. **Business Portfolios**: Container para WABAs
2. **WhatsApp Business Accounts (WABA)**: Conta empresarial
3. **Business Phone Numbers**: Números de telefone verificados
4. **Message Templates**: Templates aprovados para envio
5. **Webhooks**: Notificações em tempo real

### **Estrutura Hierárquica:**
```
Business Portfolio
├── WhatsApp Business Account (WABA)
│   ├── Business Phone Number 1
│   ├── Business Phone Number 2
│   └── Message Templates
└── Facebook App
    ├── Access Tokens
    └── Webhook Configuration
```

---

## 🔐 **SISTEMA DE AUTENTICAÇÃO**

### **Tipos de Token:**
```javascript
// System User Access Token (recomendado para produção)
Headers: {
  'Authorization': 'Bearer EAAJB...',
  'Content-Type': 'application/json'
}

// User Access Token (desenvolvimento)
Headers: {
  'Authorization': 'Bearer EAAG...',
  'Content-Type': 'application/json'
}
```

### **Configuração Base:**
```javascript
const cloudApiConfig = {
  baseURL: 'https://graph.facebook.com/v17.0',
  accessToken: 'EAAJB...', // System User Token
  phoneNumberId: '106540352242922',
  businessAccountId: '123456789',
  appId: '987654321',
  appSecret: 'app-secret-here',
  webhookVerifyToken: 'verify-token-here'
}
```

### **Verificação de Negócio:**
- **Obrigatória** para aumentar limites de mensagem
- **Necessária** para Official Business Account
- **Requerida** para display name personalizado
- **Processo**: Pode levar dias/semanas

---

## 📊 **ENDPOINTS PRINCIPAIS MAPEADOS**

### **1. GESTÃO DE NÚMEROS DE TELEFONE**

#### **Obter Informações do Número**
```javascript
GET /{phone_number_id}
Headers: { Authorization: 'Bearer ACCESS_TOKEN' }

Response: {
  verified_name: "Minha Empresa",
  display_phone_number: "+55 11 99999-9999",
  quality_rating: "GREEN",
  platform_type: "CLOUD_API",
  throughput: {
    level: "STANDARD"
  }
}
```

#### **Registrar Número de Telefone**
```javascript
POST /{phone_number_id}/register
Headers: { Authorization: 'Bearer ACCESS_TOKEN' }
Body: {
  messaging_product: "whatsapp",
  pin: "123456" // PIN recebido via SMS/chamada
}
```

#### **Solicitar Código de Verificação**
```javascript
POST /{phone_number_id}/request_code
Headers: { Authorization: 'Bearer ACCESS_TOKEN' }
Body: {
  code_method: "SMS", // ou "VOICE"
  language: "pt_BR"
}
```

### **2. ENVIO DE MENSAGENS**

#### **Mensagem de Texto Simples**
```javascript
POST /{phone_number_id}/messages
Headers: { Authorization: 'Bearer ACCESS_TOKEN' }
Body: {
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: "+5511999999999",
  type: "text",
  text: {
    preview_url: true,
    body: "Mensagem do LovoCRM via Cloud API"
  }
}

Response: {
  messaging_product: "whatsapp",
  contacts: [{
    input: "+5511999999999",
    wa_id: "5511999999999"
  }],
  messages: [{
    id: "wamid.HBgLMTU1NjE..."
  }]
}
```

#### **Mensagem com Template**
```javascript
POST /{phone_number_id}/messages
Headers: { Authorization: 'Bearer ACCESS_TOKEN' }
Body: {
  messaging_product: "whatsapp",
  to: "+5511999999999",
  type: "template",
  template: {
    name: "hello_world",
    language: {
      code: "pt_BR"
    },
    components: [
      {
        type: "body",
        parameters: [
          {
            type: "text",
            text: "João Silva"
          }
        ]
      }
    ]
  }
}
```

#### **Mensagem Interativa (Botões)**
```javascript
POST /{phone_number_id}/messages
Body: {
  messaging_product: "whatsapp",
  to: "+5511999999999",
  type: "interactive",
  interactive: {
    type: "button",
    body: {
      text: "Escolha uma opção:"
    },
    footer: {
      text: "LovoCRM"
    },
    action: {
      buttons: [
        {
          type: "reply",
          reply: {
            id: "sim",
            title: "Sim"
          }
        },
        {
          type: "reply", 
          reply: {
            id: "nao",
            title: "Não"
          }
        }
      ]
    }
  }
}
```

#### **Mensagem Interativa (Lista)**
```javascript
POST /{phone_number_id}/messages
Body: {
  messaging_product: "whatsapp",
  to: "+5511999999999",
  type: "interactive",
  interactive: {
    type: "list",
    header: {
      type: "text",
      text: "Produtos Disponíveis"
    },
    body: {
      text: "Selecione um produto:"
    },
    footer: {
      text: "LovoCRM"
    },
    action: {
      button: "Ver Produtos",
      sections: [
        {
          title: "Eletrônicos",
          rows: [
            {
              id: "smartphone",
              title: "Smartphones",
              description: "Últimos lançamentos"
            },
            {
              id: "notebook", 
              title: "Notebooks",
              description: "Modelos 2024"
            }
          ]
        }
      ]
    }
  }
}
```

### **3. ENVIO DE MÍDIA**

#### **Upload de Mídia**
```javascript
POST /{phone_number_id}/media
Headers: { 
  Authorization: 'Bearer ACCESS_TOKEN',
  'Content-Type': 'multipart/form-data'
}
Body: FormData {
  file: [arquivo],
  type: "image/jpeg", // ou video/mp4, audio/mpeg, etc.
  messaging_product: "whatsapp"
}

Response: {
  id: "1234567890" // Media ID
}
```

#### **Enviar Imagem**
```javascript
POST /{phone_number_id}/messages
Body: {
  messaging_product: "whatsapp",
  to: "+5511999999999",
  type: "image",
  image: {
    id: "1234567890", // Media ID do upload
    caption: "Legenda da imagem"
  }
}
```

#### **Enviar Documento**
```javascript
POST /{phone_number_id}/messages
Body: {
  messaging_product: "whatsapp",
  to: "+5511999999999",
  type: "document",
  document: {
    id: "1234567890",
    caption: "Documento importante",
    filename: "documento.pdf"
  }
}
```

### **4. DOWNLOAD DE MÍDIA**

#### **Obter URL de Mídia**
```javascript
GET /{media_id}
Headers: { Authorization: 'Bearer ACCESS_TOKEN' }

Response: {
  url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/...",
  mime_type: "image/jpeg",
  sha256: "sha256-hash",
  file_size: 123456,
  id: "1234567890"
}
```

#### **Download do Arquivo**
```javascript
GET {media_url}
Headers: { Authorization: 'Bearer ACCESS_TOKEN' }
// Retorna o arquivo binário
```

### **5. GESTÃO DE TEMPLATES**

#### **Criar Template**
```javascript
POST /{business_account_id}/message_templates
Headers: { Authorization: 'Bearer ACCESS_TOKEN' }
Body: {
  name: "promocao_especial",
  language: "pt_BR",
  category: "MARKETING",
  components: [
    {
      type: "HEADER",
      format: "TEXT",
      text: "🎉 Promoção Especial!"
    },
    {
      type: "BODY", 
      text: "Olá {{1}}, temos uma oferta especial para você! Desconto de {{2}}% em todos os produtos."
    },
    {
      type: "FOOTER",
      text: "LovoCRM - Válido até {{3}}"
    }
  ]
}
```

#### **Listar Templates**
```javascript
GET /{business_account_id}/message_templates
Headers: { Authorization: 'Bearer ACCESS_TOKEN' }

Response: {
  data: [
    {
      name: "hello_world",
      status: "APPROVED",
      category: "UTILITY",
      language: "pt_BR",
      id: "template_id"
    }
  ]
}
```

---

## 🔗 **SISTEMA DE WEBHOOKS**

### **Configuração do Webhook**
```javascript
// No Facebook App Dashboard
Webhook URL: https://app.lovoocrm.com/api/whatsapp/cloud-api-webhook
Verify Token: verify-token-here

// Eventos subscritos
Webhook Fields: [
  "messages",
  "message_deliveries", 
  "message_reads",
  "messaging_handovers"
]
```

### **Verificação do Webhook**
```javascript
// Endpoint de verificação
GET /api/whatsapp/cloud-api-webhook
Query: {
  'hub.mode': 'subscribe',
  'hub.challenge': 'challenge-string',
  'hub.verify_token': 'verify-token-here'
}

// Resposta esperada
Response: challenge-string (texto puro)
```

### **Estrutura do Webhook Event**
```typescript
interface CloudApiWebhookEvent {
  object: "whatsapp_business_account";
  entry: [
    {
      id: "business_account_id",
      changes: [
        {
          value: {
            messaging_product: "whatsapp";
            metadata: {
              display_phone_number: "+5511999999999";
              phone_number_id: "106540352242922";
            };
            contacts?: Contact[];
            messages?: Message[];
            statuses?: MessageStatus[];
          };
          field: "messages";
        }
      ];
    }
  ];
}
```

### **Tipos de Eventos:**

#### **Mensagem Recebida**
```javascript
{
  "messages": [
    {
      "from": "5511999999999",
      "id": "wamid.HBgLMTU1NjE...",
      "timestamp": "1640995200",
      "text": {
        "body": "Olá, preciso de ajuda"
      },
      "type": "text"
    }
  ]
}
```

#### **Status de Entrega**
```javascript
{
  "statuses": [
    {
      "id": "wamid.HBgLMTU1NjE...",
      "status": "delivered", // sent, delivered, read, failed
      "timestamp": "1640995200",
      "recipient_id": "5511999999999"
    }
  ]
}
```

---

## 📋 **ESTRUTURAS DE DADOS DETALHADAS**

### **Schema Contact:**
```typescript
interface Contact {
  profile: {
    name: string;           // Nome do contato
  };
  wa_id: string;            // WhatsApp ID
}
```

### **Schema Message (Recebida):**
```typescript
interface IncomingMessage {
  from: string;             // Número do remetente
  id: string;               // ID único da mensagem
  timestamp: string;        // Timestamp Unix
  type: 'text' | 'image' | 'video' | 'document' | 'audio' | 'interactive' | 'button' | 'location';
  
  // Conteúdo específico por tipo
  text?: {
    body: string;
  };
  image?: {
    mime_type: string;
    sha256: string;
    id: string;
    caption?: string;
  };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: {
      id: string;
      title: string;
    };
    list_reply?: {
      id: string;
      title: string;
      description?: string;
    };
  };
  context?: {
    from: string;           // ID da mensagem citada
    id: string;
  };
}
```

### **Schema MessageStatus:**
```typescript
interface MessageStatus {
  id: string;               // ID da mensagem
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;        // Timestamp Unix
  recipient_id: string;     // Número do destinatário
  
  // Dados de erro (se status = failed)
  errors?: [
    {
      code: number;
      title: string;
      message: string;
      error_data: {
        details: string;
      };
    }
  ];
}
```

---

## 🚀 **FUNCIONALIDADES AVANÇADAS**

### **1. Perfil de Negócio**
```javascript
// Obter perfil
GET /{phone_number_id}/whatsapp_business_profile
Headers: { Authorization: 'Bearer ACCESS_TOKEN' }

Response: {
  data: [
    {
      about: "Descrição da empresa",
      address: "Endereço completo",
      description: "Descrição detalhada",
      email: "contato@empresa.com",
      profile_picture_url: "https://...",
      websites: ["https://empresa.com"],
      vertical: "RETAIL"
    }
  ]
}

// Atualizar perfil
POST /{phone_number_id}/whatsapp_business_profile
Body: {
  messaging_product: "whatsapp",
  about: "Nova descrição",
  address: "Novo endereço",
  description: "Nova descrição detalhada",
  email: "novo@email.com",
  profile_picture_handle: "media_id",
  vertical: "RETAIL",
  websites: ["https://novosite.com"]
}
```

### **2. Autenticação de Dois Fatores**
```javascript
// Configurar 2FA
POST /{phone_number_id}/
Body: {
  pin: "123456" // PIN de 6 dígitos
}

// Remover 2FA  
DELETE /{phone_number_id}/
```

### **3. Métricas e Analytics**
```javascript
// Métricas de conversas
GET /{phone_number_id}/analytics
Query: {
  start: "1640995200", // Timestamp início
  end: "1641081600",   // Timestamp fim
  granularity: "DAY",  // DAY, HOUR
  metric_types: ["SENT", "DELIVERED", "READ"]
}

Response: {
  data: [
    {
      data_points: [
        {
          start: "1640995200",
          end: "1641081600", 
          sent: 150,
          delivered: 145,
          read: 120
        }
      ]
    }
  ]
}
```

---

## ⚠️ **LIMITAÇÕES E CONSIDERAÇÕES**

### **Limitações Técnicas:**
- 🔴 **Setup Complexo**: Verificação de negócio obrigatória
- 🔴 **Templates Obrigatórios**: Para mensagens proativas
- 🔴 **Aprovação Manual**: Templates precisam ser aprovados
- 🔴 **Recursos Limitados**: Menos opções interativas que Uazapi
- 🔴 **Custo por Mensagem**: Cobrança por mensagem enviada

### **Limitações de Recursos:**
- ⚠️ **Botões**: Máximo 3 botões por mensagem
- ⚠️ **Listas**: Máximo 10 itens por seção, 10 seções
- ⚠️ **Templates**: Processo de aprovação pode demorar
- ⚠️ **Mídia**: Limites de tamanho por tipo
- ⚠️ **Rate Limits**: Baseado no nível de throughput

### **Vantagens:**
- ✅ **100% Oficial**: Suporte direto da Meta
- ✅ **Compliance Total**: Conforme todos os ToS
- ✅ **Escalabilidade**: Suporte empresarial robusto
- ✅ **Confiabilidade**: Alta disponibilidade
- ✅ **Segurança**: Padrões enterprise

### **Recomendações de Uso:**
- ✅ **Ideal para**: Empresas grandes, casos regulamentados, compliance crítico
- ✅ **Não ideal para**: Startups, casos que precisam de recursos avançados
- ✅ **Backup**: Pode ser usado como backup da Uazapi
- ✅ **Monitoramento**: Métricas oficiais disponíveis

---

## 💰 **MODELO DE COBRANÇA**

### **Cobrança por Conversas:**
- **Conversas iniciadas pelo negócio**: Cobradas
- **Conversas iniciadas pelo usuário**: Gratuitas (24h)
- **Preços**: Variam por país e tipo de conversa
- **Templates**: Necessários para conversas iniciadas pelo negócio

### **Tipos de Conversa:**
- **Marketing**: Promoções, ofertas, anúncios
- **Utility**: Confirmações, atualizações, alertas
- **Authentication**: Códigos de verificação, senhas
- **Service**: Suporte ao cliente, atendimento

---

---

# 🏗️ **PARTE 4 - ARQUITETURA HÍBRIDA DETALHADA**

## 🎯 **VISÃO GERAL DA ARQUITETURA HÍBRIDA**

### **Conceito Principal:**
A arquitetura híbrida permite que o LovoCRM suporte **ambas as APIs** (Uazapi + Cloud API) de forma **transparente** para o usuário final, utilizando **padrões de design** robustos para abstração e unificação.

### **Benefícios Estratégicos:**
- 🏆 **Diferencial competitivo único** no mercado
- 🛡️ **Redução de risco** técnico e comercial
- 📈 **Escalabilidade** para diferentes perfis de cliente
- 🔄 **Migração suave** entre providers sem perda de dados
- 💰 **Otimização de custos** por tipo de uso

---

## 🏛️ **PADRÕES DE DESIGN IMPLEMENTADOS**

### **1. Provider Pattern (Strategy)**
```typescript
// Interface base para todos os providers
interface WhatsAppProvider {
  readonly type: 'uazapi' | 'cloud-api';
  readonly name: string;
  
  // Métodos obrigatórios
  sendMessage(message: UnifiedMessage): Promise<SendResult>;
  getStatus(): Promise<ConnectionStatus>;
  configureWebhook(url: string, events: string[]): Promise<void>;
  uploadMedia(file: MediaFile): Promise<MediaResult>;
  downloadMedia(mediaId: string): Promise<MediaFile>;
  
  // Métodos específicos
  createInstance?(config: InstanceConfig): Promise<InstanceResult>;
  registerPhone?(phoneNumber: string): Promise<RegisterResult>;
}
```

### **2. Factory Pattern**
```typescript
class WhatsAppProviderFactory {
  private static providers = new Map<string, typeof WhatsAppProvider>();
  
  static register(type: string, providerClass: typeof WhatsAppProvider) {
    this.providers.set(type, providerClass);
  }
  
  static create(config: ProviderConfig): WhatsAppProvider {
    const ProviderClass = this.providers.get(config.type);
    if (!ProviderClass) {
      throw new Error(`Provider type ${config.type} not supported`);
    }
    return new ProviderClass(config);
  }
}

// Registro dos providers
WhatsAppProviderFactory.register('uazapi', UazapiProvider);
WhatsAppProviderFactory.register('cloud-api', CloudApiProvider);
```

### **3. Adapter Pattern**
```typescript
class MessageAdapter {
  // Converte mensagem específica do provider para formato unificado
  static toUnified(
    providerMessage: any, 
    providerType: 'uazapi' | 'cloud-api'
  ): UnifiedMessage {
    switch (providerType) {
      case 'uazapi':
        return this.fromUazapi(providerMessage);
      case 'cloud-api':
        return this.fromCloudApi(providerMessage);
      default:
        throw new Error(`Unsupported provider type: ${providerType}`);
    }
  }
  
  // Converte mensagem unificada para formato específico do provider
  static fromUnified(
    unifiedMessage: UnifiedMessage,
    targetProvider: 'uazapi' | 'cloud-api'
  ): any {
    switch (targetProvider) {
      case 'uazapi':
        return this.toUazapi(unifiedMessage);
      case 'cloud-api':
        return this.toCloudApi(unifiedMessage);
      default:
        throw new Error(`Unsupported target provider: ${targetProvider}`);
    }
  }
  
  private static fromUazapi(uazapiMessage: any): UnifiedMessage {
    return {
      id: uazapiMessage.id,
      messageId: uazapiMessage.messageid,
      chatId: uazapiMessage.chatid,
      fromMe: uazapiMessage.fromMe,
      isGroup: uazapiMessage.isGroup,
      messageType: uazapiMessage.messageType,
      timestamp: new Date(uazapiMessage.messageTimestamp),
      sender: uazapiMessage.sender,
      senderName: uazapiMessage.senderName,
      text: uazapiMessage.text,
      status: uazapiMessage.status,
      content: JSON.parse(uazapiMessage.content || '{}'),
      providerData: uazapiMessage
    };
  }
  
  private static fromCloudApi(cloudApiMessage: any): UnifiedMessage {
    return {
      id: cloudApiMessage.id,
      messageId: cloudApiMessage.id,
      chatId: cloudApiMessage.from,
      fromMe: false,
      isGroup: false,
      messageType: cloudApiMessage.type,
      timestamp: new Date(parseInt(cloudApiMessage.timestamp) * 1000),
      sender: cloudApiMessage.from,
      senderName: cloudApiMessage.profile?.name || cloudApiMessage.from,
      text: cloudApiMessage.text?.body || '',
      status: 'received',
      content: cloudApiMessage,
      providerData: cloudApiMessage
    };
  }
}
```

---

## 🗄️ **ESTRUTURA DE BANCO UNIFICADA**

### **Tabela Principal de Providers**
```sql
CREATE TABLE whatsapp_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('uazapi', 'cloud-api')),
  provider_name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  is_primary BOOLEAN DEFAULT false,
  priority INTEGER DEFAULT 1,
  config JSONB NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(company_id, provider_name),
  UNIQUE(company_id, is_primary) WHERE is_primary = true
);

-- Índices para performance
CREATE INDEX idx_whatsapp_providers_company_active ON whatsapp_providers(company_id, is_active);
CREATE INDEX idx_whatsapp_providers_type ON whatsapp_providers(provider_type);
```

### **Configurações por Tipo de Provider**
```sql
-- Configuração Uazapi (armazenada em config JSONB)
{
  "base_url": "https://subdomain.uazapi.com",
  "admin_token": "encrypted:admin_token_here",
  "webhook_url": "https://app.lovoocrm.com/api/whatsapp/webhooks/uazapi",
  "webhook_events": ["messages", "connection", "presence"],
  "exclude_messages": ["wasSentByApi"],
  "auto_create_instances": true,
  "max_instances": 10
}

-- Configuração Cloud API (armazenada em config JSONB)
{
  "app_id": "987654321",
  "app_secret": "encrypted:app_secret_here",
  "access_token": "encrypted:access_token_here",
  "business_account_id": "123456789",
  "webhook_url": "https://app.lovoocrm.com/api/whatsapp/webhooks/cloud-api",
  "webhook_verify_token": "encrypted:verify_token_here",
  "webhook_fields": ["messages", "message_deliveries", "message_reads"],
  "auto_register_phones": false
}
```

### **Tabela de Instâncias Unificada**
```sql
CREATE TABLE whatsapp_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES whatsapp_providers(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  status TEXT DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connecting', 'connected', 'error')),
  
  -- IDs específicos do provider
  provider_instance_id TEXT, -- Para Uazapi: instance ID
  provider_phone_id TEXT,    -- Para Cloud API: phone_number_id
  provider_token TEXT,       -- Para Uazapi: instance token
  
  -- Metadados do WhatsApp
  profile_name TEXT,
  profile_pic_url TEXT,
  is_business BOOLEAN DEFAULT false,
  verified_name TEXT,
  quality_rating TEXT,
  
  -- Dados específicos do provider
  qr_code TEXT,              -- Para Uazapi: QR code base64
  pair_code TEXT,            -- Para Uazapi: código de pareamento
  webhook_configured BOOLEAN DEFAULT false,
  
  -- Metadados e controle
  metadata JSONB DEFAULT '{}',
  last_connected_at TIMESTAMP,
  last_disconnected_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(company_id, phone_number),
  UNIQUE(provider_id, provider_instance_id) WHERE provider_instance_id IS NOT NULL,
  UNIQUE(provider_id, provider_phone_id) WHERE provider_phone_id IS NOT NULL
);

-- Índices para performance
CREATE INDEX idx_whatsapp_instances_company ON whatsapp_instances(company_id);
CREATE INDEX idx_whatsapp_instances_provider ON whatsapp_instances(provider_id);
CREATE INDEX idx_whatsapp_instances_phone ON whatsapp_instances(phone_number);
CREATE INDEX idx_whatsapp_instances_status ON whatsapp_instances(status);
```

### **Tabela de Conversas Unificada**
```sql
CREATE TABLE whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES whatsapp_providers(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  -- Identificação do contato
  contact_phone TEXT NOT NULL,
  contact_name TEXT,
  contact_wa_id TEXT,        -- WhatsApp ID oficial
  
  -- IDs específicos do provider
  provider_chat_id TEXT,     -- Para Uazapi: chat ID
  provider_contact_id TEXT,  -- Para Cloud API: contact ID
  
  -- Metadados da conversa
  is_group BOOLEAN DEFAULT false,
  group_name TEXT,
  is_archived BOOLEAN DEFAULT false,
  is_pinned BOOLEAN DEFAULT false,
  is_blocked BOOLEAN DEFAULT false,
  
  -- Controle de mensagens
  last_message_at TIMESTAMP,
  last_message_from_me BOOLEAN,
  unread_count INTEGER DEFAULT 0,
  
  -- Integração com leads
  lead_id UUID REFERENCES leads(id),
  lead_auto_created BOOLEAN DEFAULT false,
  
  -- Metadados e controle
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(instance_id, contact_phone),
  UNIQUE(provider_id, provider_chat_id) WHERE provider_chat_id IS NOT NULL
);

-- Índices para performance
CREATE INDEX idx_whatsapp_conversations_instance ON whatsapp_conversations(instance_id);
CREATE INDEX idx_whatsapp_conversations_company ON whatsapp_conversations(company_id);
CREATE INDEX idx_whatsapp_conversations_phone ON whatsapp_conversations(contact_phone);
CREATE INDEX idx_whatsapp_conversations_lead ON whatsapp_conversations(lead_id);
CREATE INDEX idx_whatsapp_conversations_last_message ON whatsapp_conversations(last_message_at DESC);
```

### **Tabela de Mensagens Unificada**
```sql
CREATE TABLE whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  instance_id UUID NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES whatsapp_providers(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  -- IDs da mensagem
  provider_message_id TEXT NOT NULL,
  quoted_message_id UUID REFERENCES whatsapp_messages(id),
  
  -- Dados básicos da mensagem
  message_type TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'video', 'document', 'audio', 'location', 'contact', 'interactive', 'template', 'reaction', 'sticker')),
  content JSONB NOT NULL,
  text_content TEXT,
  
  -- Remetente e destinatário
  sender_phone TEXT NOT NULL,
  sender_name TEXT,
  recipient_phone TEXT NOT NULL,
  from_me BOOLEAN NOT NULL DEFAULT false,
  
  -- Status e controle
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed', 'deleted')),
  timestamp TIMESTAMP NOT NULL,
  
  -- Dados de mídia
  media_id TEXT,
  media_url TEXT,
  media_mime_type TEXT,
  media_size BIGINT,
  media_caption TEXT,
  
  -- Dados interativos
  interactive_type TEXT, -- button, list, etc.
  interactive_data JSONB,
  
  -- Metadados específicos do provider
  provider_metadata JSONB DEFAULT '{}',
  
  -- Controle
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(provider_id, provider_message_id)
);

-- Índices para performance
CREATE INDEX idx_whatsapp_messages_conversation ON whatsapp_messages(conversation_id, timestamp DESC);
CREATE INDEX idx_whatsapp_messages_instance ON whatsapp_messages(instance_id);
CREATE INDEX idx_whatsapp_messages_company ON whatsapp_messages(company_id);
CREATE INDEX idx_whatsapp_messages_timestamp ON whatsapp_messages(timestamp DESC);
CREATE INDEX idx_whatsapp_messages_status ON whatsapp_messages(status);
CREATE INDEX idx_whatsapp_messages_type ON whatsapp_messages(message_type);
```

---

## 🔧 **IMPLEMENTAÇÕES DOS PROVIDERS**

### **UazapiProvider Implementation**
```typescript
class UazapiProvider implements WhatsAppProvider {
  readonly type = 'uazapi' as const;
  readonly name: string;
  private config: UazapiConfig;
  private httpClient: HttpClient;
  
  constructor(config: UazapiConfig) {
    this.name = config.name;
    this.config = config;
    this.httpClient = new HttpClient(config.baseUrl);
  }
  
  async sendMessage(message: UnifiedMessage): Promise<SendResult> {
    const uazapiMessage = MessageAdapter.fromUnified(message, 'uazapi');
    
    try {
      const response = await this.httpClient.post('/message/text', uazapiMessage, {
        headers: { token: this.config.instanceToken }
      });
      
      return {
        success: true,
        messageId: response.data.messageId,
        provider: 'uazapi',
        providerResponse: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        provider: 'uazapi',
        providerResponse: error.response?.data
      };
    }
  }
  
  async getStatus(): Promise<ConnectionStatus> {
    try {
      const response = await this.httpClient.get('/instance/info', {
        headers: { token: this.config.instanceToken }
      });
      
      return {
        connected: response.data.status.connected,
        status: response.data.instance.status,
        profileName: response.data.instance.profileName,
        qrCode: response.data.instance.qrcode,
        provider: 'uazapi'
      };
    } catch (error) {
      return {
        connected: false,
        status: 'error',
        error: error.message,
        provider: 'uazapi'
      };
    }
  }
  
  async configureWebhook(url: string, events: string[]): Promise<void> {
    await this.httpClient.post('/webhook/set', {
      url,
      events,
      excludeMessages: ['wasSentByApi'] // CRÍTICO: evita loops
    }, {
      headers: { token: this.config.instanceToken }
    });
  }
  
  async createInstance(config: InstanceConfig): Promise<InstanceResult> {
    const response = await this.httpClient.post('/instance/create', {
      name: config.name
    }, {
      headers: { admintoken: this.config.adminToken }
    });
    
    return {
      success: true,
      instanceId: response.data.instance.id,
      instanceToken: response.data.token,
      provider: 'uazapi'
    };
  }
}
```

### **CloudApiProvider Implementation**
```typescript
class CloudApiProvider implements WhatsAppProvider {
  readonly type = 'cloud-api' as const;
  readonly name: string;
  private config: CloudApiConfig;
  private httpClient: HttpClient;
  
  constructor(config: CloudApiConfig) {
    this.name = config.name;
    this.config = config;
    this.httpClient = new HttpClient('https://graph.facebook.com/v17.0');
  }
  
  async sendMessage(message: UnifiedMessage): Promise<SendResult> {
    const cloudApiMessage = MessageAdapter.fromUnified(message, 'cloud-api');
    
    try {
      const response = await this.httpClient.post(
        `/${this.config.phoneNumberId}/messages`,
        cloudApiMessage,
        {
          headers: { 
            'Authorization': `Bearer ${this.config.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return {
        success: true,
        messageId: response.data.messages[0].id,
        provider: 'cloud-api',
        providerResponse: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        provider: 'cloud-api',
        providerResponse: error.response?.data
      };
    }
  }
  
  async getStatus(): Promise<ConnectionStatus> {
    try {
      const response = await this.httpClient.get(
        `/${this.config.phoneNumberId}`,
        {
          headers: { 'Authorization': `Bearer ${this.config.accessToken}` }
        }
      );
      
      return {
        connected: true,
        status: 'connected',
        profileName: response.data.verified_name,
        phoneNumber: response.data.display_phone_number,
        qualityRating: response.data.quality_rating,
        provider: 'cloud-api'
      };
    } catch (error) {
      return {
        connected: false,
        status: 'error',
        error: error.message,
        provider: 'cloud-api'
      };
    }
  }
  
  async configureWebhook(url: string, events: string[]): Promise<void> {
    // Cloud API webhooks são configurados no Facebook App Dashboard
    // Este método pode validar se o webhook está configurado corretamente
    throw new Error('Cloud API webhooks must be configured in Facebook App Dashboard');
  }
  
  async registerPhone(phoneNumber: string): Promise<RegisterResult> {
    const response = await this.httpClient.post(
      `/${this.config.phoneNumberId}/register`,
      {
        messaging_product: 'whatsapp',
        pin: '123456' // PIN recebido via SMS/chamada
      },
      {
        headers: { 'Authorization': `Bearer ${this.config.accessToken}` }
      }
    );
    
    return {
      success: true,
      phoneNumberId: this.config.phoneNumberId,
      provider: 'cloud-api'
    };
  }
}
```

---

## 🔄 **SERVIÇO UNIFICADO**

### **WhatsAppService - Orquestrador Principal**
```typescript
class WhatsAppService {
  private providers = new Map<string, WhatsAppProvider>();
  private routingStrategy: RoutingStrategy;
  
  constructor(routingStrategy: RoutingStrategy = new DefaultRoutingStrategy()) {
    this.routingStrategy = routingStrategy;
  }
  
  async initializeProviders(companyId: string): Promise<void> {
    const providerConfigs = await this.getProviderConfigs(companyId);
    
    for (const config of providerConfigs) {
      if (config.isActive) {
        const provider = WhatsAppProviderFactory.create(config);
        this.providers.set(config.id, provider);
      }
    }
  }
  
  async sendMessage(
    companyId: string,
    message: UnifiedMessage,
    options?: SendOptions
  ): Promise<SendResult> {
    const provider = await this.selectProvider(companyId, message, options);
    
    if (!provider) {
      throw new Error('No active WhatsApp provider found');
    }
    
    const result = await provider.sendMessage(message);
    
    // Salvar no banco de dados unificado
    await this.saveMessage(companyId, message, result);
    
    return result;
  }
  
  async getConversations(companyId: string, filters?: ConversationFilters): Promise<UnifiedConversation[]> {
    // Buscar conversas unificadas do banco
    const conversations = await this.database.query(`
      SELECT c.*, i.phone_number, i.profile_name, p.provider_type, p.provider_name
      FROM whatsapp_conversations c
      JOIN whatsapp_instances i ON c.instance_id = i.id
      JOIN whatsapp_providers p ON c.provider_id = p.id
      WHERE c.company_id = $1
      ORDER BY c.last_message_at DESC
    `, [companyId]);
    
    return conversations.map(conv => this.mapToUnifiedConversation(conv));
  }
  
  private async selectProvider(
    companyId: string,
    message: UnifiedMessage,
    options?: SendOptions
  ): Promise<WhatsAppProvider | null> {
    return this.routingStrategy.selectProvider(
      Array.from(this.providers.values()),
      { companyId, message, options }
    );
  }
}
```

### **Estratégias de Roteamento**
```typescript
interface RoutingStrategy {
  selectProvider(
    providers: WhatsAppProvider[],
    context: RoutingContext
  ): Promise<WhatsAppProvider | null>;
}

class DefaultRoutingStrategy implements RoutingStrategy {
  async selectProvider(providers: WhatsAppProvider[], context: RoutingContext): Promise<WhatsAppProvider | null> {
    // 1. Provider preferido se especificado
    if (context.options?.preferredProvider) {
      const preferred = providers.find(p => p.type === context.options.preferredProvider);
      if (preferred) return preferred;
    }
    
    // 2. Provider primário da empresa
    const primaryProvider = await this.getPrimaryProvider(context.companyId);
    if (primaryProvider) {
      const provider = providers.find(p => p.name === primaryProvider.name);
      if (provider) return provider;
    }
    
    // 3. Primeiro provider ativo
    return providers.find(p => true) || null;
  }
}

class SmartRoutingStrategy implements RoutingStrategy {
  async selectProvider(providers: WhatsAppProvider[], context: RoutingContext): Promise<WhatsAppProvider | null> {
    const { message } = context;
    
    // Roteamento por tipo de mensagem
    if (message.messageType === 'interactive') {
      // Mensagens interativas → Uazapi (mais recursos)
      const uazapi = providers.find(p => p.type === 'uazapi');
      if (uazapi) return uazapi;
    }
    
    if (message.messageType === 'template') {
      // Templates → Cloud API (oficial)
      const cloudApi = providers.find(p => p.type === 'cloud-api');
      if (cloudApi) return cloudApi;
    }
    
    // Fallback para estratégia padrão
    return new DefaultRoutingStrategy().selectProvider(providers, context);
  }
}

class ComplianceRoutingStrategy implements RoutingStrategy {
  async selectProvider(providers: WhatsAppProvider[], context: RoutingContext): Promise<WhatsAppProvider | null> {
    // Sempre preferir Cloud API para compliance
    const cloudApi = providers.find(p => p.type === 'cloud-api');
    if (cloudApi) return cloudApi;
    
    // Fallback para Uazapi se necessário
    return providers.find(p => p.type === 'uazapi') || null;
  }
}
```

---

## 📡 **ENDPOINTS UNIFICADOS**

### **Estrutura de Pastas API**
```
api/whatsapp/
├── unified/
│   ├── send-message.js          ✅ Envio unificado
│   ├── get-conversations.js     ✅ Listar conversas
│   ├── get-messages.js          ✅ Listar mensagens
│   ├── get-status.js            ✅ Status das instâncias
│   ├── upload-media.js          ✅ Upload de mídia
│   └── manage-providers.js      ✅ CRUD providers
├── providers/
│   ├── uazapi/
│   │   ├── webhook-receive.js   ✅ Webhook Uazapi
│   │   ├── create-instance.js   ✅ Criar instância
│   │   └── get-qr-code.js       ✅ Obter QR code
│   └── cloud-api/
│       ├── webhook-receive.js   ✅ Webhook Cloud API
│       ├── register-phone.js    ✅ Registrar telefone
│       └── verify-webhook.js    ✅ Verificar webhook
└── webhooks/
    ├── uazapi.js               ✅ Endpoint webhook Uazapi
    └── cloud-api.js            ✅ Endpoint webhook Cloud API
```

### **Endpoint de Envio Unificado**
```javascript
// api/whatsapp/unified/send-message.js
import { createClient } from '@supabase/supabase-js';
import { WhatsAppService } from '../../../services/WhatsAppService';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { company_id, to, message_type, content, options } = req.body;
    
    // Validações
    if (!company_id || !to || !message_type || !content) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Criar mensagem unificada
    const unifiedMessage = {
      id: crypto.randomUUID(),
      chatId: to,
      messageType: message_type,
      text: content.text || '',
      content: content,
      timestamp: new Date(),
      fromMe: true
    };
    
    // Enviar via serviço unificado
    const whatsappService = new WhatsAppService();
    await whatsappService.initializeProviders(company_id);
    
    const result = await whatsappService.sendMessage(
      company_id,
      unifiedMessage,
      options
    );
    
    res.status(200).json({
      success: result.success,
      message_id: result.messageId,
      provider: result.provider,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ 
      error: 'Failed to send message',
      details: error.message 
    });
  }
}
```

---

---

# 🛡️ **PARTE 5 - IMPLEMENTAÇÃO ANTI-CORS E WEBHOOKS**

## 🚨 **PADRÃO ANTI-CORS OBRIGATÓRIO**

### **Regra Fundamental:**
**JAMAIS fazer chamadas diretas do frontend para APIs externas**. Todo acesso deve ser via webhooks server-side.

### **Fluxo Anti-CORS Correto:**
```
Frontend → Endpoint Isolado → Supabase Client → SQL Function → Banco
NUNCA: Frontend → API Externa (CORS BLOCK)
```

### **Arquitetura Obrigatória:**
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   FRONTEND      │    │   WEBHOOK       │    │   SUPABASE      │
│   (React)       │───▶│   ISOLADO       │───▶│   CLIENT        │
│                 │    │   (Vercel)      │    │   (Server)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   SQL FUNCTION  │    │   POSTGRESQL    │
                       │   (RPC)         │───▶│   (Database)    │
                       │   SECURITY      │    │                 │
                       │   DEFINER       │    │                 │
                       └─────────────────┘    └─────────────────┘
```

---

## 🔧 **FUNÇÕES RPC ANTI-CORS**

### **1. Função para Salvar Mensagem Recebida**
```sql
CREATE OR REPLACE FUNCTION save_whatsapp_message_received(
  p_provider_type TEXT,
  p_provider_data JSONB,
  p_company_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider_id UUID;
  v_instance_id UUID;
  v_conversation_id UUID;
  v_message_id UUID;
  v_result JSONB;
BEGIN
  -- Log da entrada
  INSERT INTO webhook_logs (
    provider_type, 
    raw_data, 
    processed_at
  ) VALUES (
    p_provider_type, 
    p_provider_data, 
    NOW()
  );

  -- Processar baseado no provider
  IF p_provider_type = 'uazapi' THEN
    SELECT * INTO v_result FROM process_uazapi_message(p_provider_data, p_company_id);
  ELSIF p_provider_type = 'cloud-api' THEN
    SELECT * INTO v_result FROM process_cloudapi_message(p_provider_data, p_company_id);
  ELSE
    RAISE EXCEPTION 'Unsupported provider type: %', p_provider_type;
  END IF;

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    -- Log do erro
    INSERT INTO webhook_errors (
      provider_type,
      error_message,
      raw_data,
      occurred_at
    ) VALUES (
      p_provider_type,
      SQLERRM,
      p_provider_data,
      NOW()
    );
    
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;
```

### **2. Função para Processar Mensagem Uazapi**
```sql
CREATE OR REPLACE FUNCTION process_uazapi_message(
  p_data JSONB,
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instance_id UUID;
  v_conversation_id UUID;
  v_message_id UUID;
  v_message_data JSONB;
  v_chat_data JSONB;
BEGIN
  -- Extrair dados da mensagem
  v_message_data := p_data->'data'->'message';
  v_chat_data := p_data->'data'->'chat';
  
  -- Buscar instância pelo provider_instance_id
  SELECT id INTO v_instance_id
  FROM whatsapp_instances
  WHERE provider_instance_id = p_data->>'instance'
    AND company_id = p_company_id;
    
  IF v_instance_id IS NULL THEN
    RAISE EXCEPTION 'Instance not found: %', p_data->>'instance';
  END IF;
  
  -- Buscar ou criar conversa
  SELECT id INTO v_conversation_id
  FROM whatsapp_conversations
  WHERE instance_id = v_instance_id
    AND contact_phone = v_message_data->>'sender';
    
  IF v_conversation_id IS NULL THEN
    INSERT INTO whatsapp_conversations (
      instance_id,
      provider_id,
      company_id,
      contact_phone,
      contact_name,
      provider_chat_id,
      is_group,
      created_at
    ) VALUES (
      v_instance_id,
      (SELECT provider_id FROM whatsapp_instances WHERE id = v_instance_id),
      p_company_id,
      v_message_data->>'sender',
      v_message_data->>'senderName',
      v_chat_data->>'id',
      (v_message_data->>'isGroup')::BOOLEAN,
      NOW()
    ) RETURNING id INTO v_conversation_id;
  END IF;
  
  -- Inserir mensagem
  INSERT INTO whatsapp_messages (
    conversation_id,
    instance_id,
    provider_id,
    company_id,
    provider_message_id,
    message_type,
    content,
    text_content,
    sender_phone,
    sender_name,
    recipient_phone,
    from_me,
    status,
    timestamp,
    provider_metadata
  ) VALUES (
    v_conversation_id,
    v_instance_id,
    (SELECT provider_id FROM whatsapp_instances WHERE id = v_instance_id),
    p_company_id,
    v_message_data->>'id',
    v_message_data->>'messageType',
    v_message_data,
    v_message_data->>'text',
    v_message_data->>'sender',
    v_message_data->>'senderName',
    (SELECT phone_number FROM whatsapp_instances WHERE id = v_instance_id),
    (v_message_data->>'fromMe')::BOOLEAN,
    'received',
    TO_TIMESTAMP((v_message_data->>'messageTimestamp')::BIGINT / 1000),
    p_data
  ) RETURNING id INTO v_message_id;
  
  -- Atualizar última mensagem da conversa
  UPDATE whatsapp_conversations
  SET 
    last_message_at = NOW(),
    last_message_from_me = false,
    unread_count = unread_count + 1
  WHERE id = v_conversation_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'message_id', v_message_id,
    'conversation_id', v_conversation_id
  );
END;
$$;
```

### **3. Função para Processar Mensagem Cloud API**
```sql
CREATE OR REPLACE FUNCTION process_cloudapi_message(
  p_data JSONB,
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instance_id UUID;
  v_conversation_id UUID;
  v_message_id UUID;
  v_entry JSONB;
  v_change JSONB;
  v_message JSONB;
  v_contact JSONB;
BEGIN
  -- Extrair dados do webhook Cloud API
  v_entry := p_data->'entry'->0;
  v_change := v_entry->'changes'->0;
  
  -- Buscar instância pelo phone_number_id
  SELECT id INTO v_instance_id
  FROM whatsapp_instances
  WHERE provider_phone_id = v_change->'value'->'metadata'->>'phone_number_id'
    AND company_id = p_company_id;
    
  IF v_instance_id IS NULL THEN
    RAISE EXCEPTION 'Instance not found for phone_number_id: %', 
      v_change->'value'->'metadata'->>'phone_number_id';
  END IF;
  
  -- Processar mensagens
  FOR v_message IN SELECT * FROM jsonb_array_elements(v_change->'value'->'messages')
  LOOP
    -- Buscar dados do contato
    SELECT * INTO v_contact
    FROM jsonb_array_elements(v_change->'value'->'contacts')
    WHERE jsonb_extract_path_text(value, 'wa_id') = v_message->>'from';
    
    -- Buscar ou criar conversa
    SELECT id INTO v_conversation_id
    FROM whatsapp_conversations
    WHERE instance_id = v_instance_id
      AND contact_phone = v_message->>'from';
      
    IF v_conversation_id IS NULL THEN
      INSERT INTO whatsapp_conversations (
        instance_id,
        provider_id,
        company_id,
        contact_phone,
        contact_name,
        contact_wa_id,
        provider_contact_id,
        created_at
      ) VALUES (
        v_instance_id,
        (SELECT provider_id FROM whatsapp_instances WHERE id = v_instance_id),
        p_company_id,
        v_message->>'from',
        v_contact->'profile'->>'name',
        v_contact->>'wa_id',
        v_contact->>'wa_id',
        NOW()
      ) RETURNING id INTO v_conversation_id;
    END IF;
    
    -- Inserir mensagem
    INSERT INTO whatsapp_messages (
      conversation_id,
      instance_id,
      provider_id,
      company_id,
      provider_message_id,
      message_type,
      content,
      text_content,
      sender_phone,
      sender_name,
      recipient_phone,
      from_me,
      status,
      timestamp,
      provider_metadata
    ) VALUES (
      v_conversation_id,
      v_instance_id,
      (SELECT provider_id FROM whatsapp_instances WHERE id = v_instance_id),
      p_company_id,
      v_message->>'id',
      v_message->>'type',
      v_message,
      v_message->'text'->>'body',
      v_message->>'from',
      v_contact->'profile'->>'name',
      (SELECT phone_number FROM whatsapp_instances WHERE id = v_instance_id),
      false,
      'received',
      TO_TIMESTAMP((v_message->>'timestamp')::BIGINT),
      p_data
    ) RETURNING id INTO v_message_id;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'processed_messages', jsonb_array_length(v_change->'value'->'messages')
  );
END;
$$;
```

---

## 📡 **WEBHOOKS ISOLADOS**

### **1. Webhook Uazapi**
```javascript
// api/whatsapp/webhooks/uazapi.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Headers CORS obrigatórios
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const webhookData = req.body;
    
    // Validação básica
    if (!webhookData.event || !webhookData.instance) {
      return res.status(400).json({ error: 'Invalid webhook data' });
    }
    
    // Log do webhook recebido
    console.log('Uazapi webhook received:', {
      event: webhookData.event,
      instance: webhookData.instance,
      timestamp: new Date().toISOString()
    });
    
    // Determinar company_id pela instância
    const { data: instance } = await supabase
      .from('whatsapp_instances')
      .select('company_id')
      .eq('provider_instance_id', webhookData.instance)
      .single();
    
    if (!instance) {
      console.error('Instance not found:', webhookData.instance);
      return res.status(404).json({ error: 'Instance not found' });
    }
    
    // Processar via função RPC (ANTI-CORS)
    const { data, error } = await supabase.rpc(
      'save_whatsapp_message_received',
      {
        p_provider_type: 'uazapi',
        p_provider_data: webhookData,
        p_company_id: instance.company_id
      }
    );
    
    if (error) {
      console.error('RPC error:', error);
      return res.status(500).json({ error: 'Processing failed' });
    }
    
    // Resposta de sucesso
    res.status(200).json({
      success: true,
      processed: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
}
```

### **2. Webhook Cloud API**
```javascript
// api/whatsapp/webhooks/cloud-api.js
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Headers CORS obrigatórios
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Verificação do webhook (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
      console.log('Webhook verified successfully');
      return res.status(200).send(challenge);
    } else {
      console.error('Webhook verification failed');
      return res.status(403).send('Forbidden');
    }
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const webhookData = req.body;
    
    // Validação da assinatura (opcional mas recomendado)
    const signature = req.headers['x-hub-signature-256'];
    if (signature && process.env.WHATSAPP_APP_SECRET) {
      const expectedSignature = crypto
        .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
        .update(JSON.stringify(webhookData))
        .digest('hex');
        
      if (`sha256=${expectedSignature}` !== signature) {
        console.error('Invalid signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }
    
    // Validação básica
    if (!webhookData.object || webhookData.object !== 'whatsapp_business_account') {
      return res.status(400).json({ error: 'Invalid webhook object' });
    }
    
    // Log do webhook recebido
    console.log('Cloud API webhook received:', {
      object: webhookData.object,
      entries: webhookData.entry?.length || 0,
      timestamp: new Date().toISOString()
    });
    
    // Processar cada entry
    for (const entry of webhookData.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === 'messages') {
          // Determinar company_id pelo phone_number_id
          const phoneNumberId = change.value.metadata?.phone_number_id;
          
          const { data: instance } = await supabase
            .from('whatsapp_instances')
            .select('company_id')
            .eq('provider_phone_id', phoneNumberId)
            .single();
          
          if (!instance) {
            console.error('Instance not found for phone_number_id:', phoneNumberId);
            continue;
          }
          
          // Processar via função RPC (ANTI-CORS)
          const { data, error } = await supabase.rpc(
            'save_whatsapp_message_received',
            {
              p_provider_type: 'cloud-api',
              p_provider_data: webhookData,
              p_company_id: instance.company_id
            }
          );
          
          if (error) {
            console.error('RPC error:', error);
          }
        }
      }
    }
    
    // Resposta de sucesso
    res.status(200).json({
      success: true,
      processed: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
}
```

---

## 🔒 **HEADERS CORS OBRIGATÓRIOS**

### **Headers Padrão para Todos os Endpoints:**
```javascript
// Função utilitária para headers CORS
export function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 horas
}

// Uso em todos os endpoints
export default async function handler(req, res) {
  setCorsHeaders(res);
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // ... resto da implementação
}
```

### **Headers Específicos por Tipo:**
```javascript
// Para endpoints de upload de mídia
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Content-Length');

// Para endpoints com autenticação
res.setHeader('Access-Control-Allow-Credentials', 'true');
res.setHeader('Access-Control-Allow-Origin', 'https://app.lovoocrm.com');

// Para endpoints de webhook
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
```

---

## 📊 **TABELAS DE LOG E MONITORAMENTO**

### **Tabela de Logs de Webhook**
```sql
CREATE TABLE webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_type TEXT NOT NULL,
  event_type TEXT,
  instance_id TEXT,
  raw_data JSONB NOT NULL,
  processed_successfully BOOLEAN DEFAULT false,
  processing_time_ms INTEGER,
  processed_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_webhook_logs_provider ON webhook_logs(provider_type);
CREATE INDEX idx_webhook_logs_processed_at ON webhook_logs(processed_at DESC);
CREATE INDEX idx_webhook_logs_success ON webhook_logs(processed_successfully);
```

### **Tabela de Erros de Webhook**
```sql
CREATE TABLE webhook_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_code TEXT,
  raw_data JSONB,
  stack_trace TEXT,
  retry_count INTEGER DEFAULT 0,
  resolved BOOLEAN DEFAULT false,
  occurred_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);

CREATE INDEX idx_webhook_errors_provider ON webhook_errors(provider_type);
CREATE INDEX idx_webhook_errors_occurred ON webhook_errors(occurred_at DESC);
CREATE INDEX idx_webhook_errors_resolved ON webhook_errors(resolved);
```

---

## 🔄 **SISTEMA DE RETRY E RECUPERAÇÃO**

### **Função de Retry para Webhooks**
```sql
CREATE OR REPLACE FUNCTION retry_failed_webhook(
  p_webhook_error_id UUID,
  p_max_retries INTEGER DEFAULT 3
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_error_record RECORD;
  v_result JSONB;
BEGIN
  -- Buscar erro
  SELECT * INTO v_error_record
  FROM webhook_errors
  WHERE id = p_webhook_error_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Error record not found');
  END IF;
  
  -- Verificar limite de retry
  IF v_error_record.retry_count >= p_max_retries THEN
    RETURN jsonb_build_object('success', false, 'error', 'Max retries exceeded');
  END IF;
  
  -- Tentar reprocessar
  BEGIN
    SELECT * INTO v_result FROM save_whatsapp_message_received(
      v_error_record.provider_type,
      v_error_record.raw_data
    );
    
    -- Marcar como resolvido se sucesso
    IF v_result->>'success' = 'true' THEN
      UPDATE webhook_errors
      SET 
        resolved = true,
        resolved_at = NOW(),
        retry_count = retry_count + 1
      WHERE id = p_webhook_error_id;
    END IF;
    
    RETURN v_result;
    
  EXCEPTION
    WHEN OTHERS THEN
      -- Incrementar contador de retry
      UPDATE webhook_errors
      SET retry_count = retry_count + 1
      WHERE id = p_webhook_error_id;
      
      RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM,
        'retry_count', v_error_record.retry_count + 1
      );
  END;
END;
$$;
```

---

**Documento atualizado em**: 13/11/2025 10:50  
**Versão**: 1.4 - Estrutura Principal + Uazapi + Cloud API + Arquitetura Híbrida + Anti-CORS  
**Próxima atualização**: PARTE 6 - INTERFACE FRONTEND E COMPONENTES
