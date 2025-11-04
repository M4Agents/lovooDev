# DOCUMENTAÇÃO TÉCNICA - LOVOCRM
## Sistema SaaS para Análise Comportamental e CRM

**Versão:** 1.4.0 - Sistema Híbrido 100% Funcional - RLS Resolvido  
**Data:** Novembro 2025  
**Última Atualização:** 04/11/2025 - 09:54 - VERSÃO FINAL APROVADA  

---

## 📋 ÍNDICE

1. [Visão Geral do Sistema](#visão-geral)
2. [Arquitetura Técnica](#arquitetura)
3. [Frontend - React/TypeScript](#frontend)
4. [Backend - API Routes](#backend)
5. [Banco de Dados - Supabase](#banco)
6. [Sistema de Analytics](#analytics)
7. [Webhook Ultra-Simples](#webhook)
8. [Autenticação e Segurança](#auth)
9. [Deploy e Infraestrutura](#deploy)
10. [Configurações Críticas](#config)
11. [Troubleshooting](#troubleshooting)

---

## 🎯 VISÃO GERAL DO SISTEMA {#visão-geral}

### Objetivo
Sistema SaaS completo para análise comportamental de visitantes em landing pages e gestão de leads (CRM).

### Funcionalidades Principais
- **Analytics Comportamental**: Tracking de visitantes em tempo real
- **CRM Completo**: Gestão de leads, empresas, usuários
- **Sistema de Duplicatas**: Detecção automática e mesclagem inteligente
- **Webhook Ultra-Simples**: Captura automática de leads
- **Sistema Híbrido**: Captura automática de visitor_id e scoring comportamental
- **Landing Pages**: Sistema de criação e gerenciamento
- **Campos Personalizados**: Mapeamento inteligente automático
- **Interceptação Inteligente**: Compatibilidade total com React/SPA/HTML

### Stack Tecnológica
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Backend**: Vercel Edge Functions (Node.js)
- **Banco**: Supabase (PostgreSQL)
- **Deploy**: Vercel
- **Domínio**: https://app.lovoocrm.com

---

## 🏗️ ARQUITETURA TÉCNICA {#arquitetura}

### Fluxo de Dados
```
Landing Page → Script m4track-v5.js → Webhook Analytics → Supabase → Dashboard
Formulário → Webhook Lead → RPC Function → Banco → CRM
```

### Componentes Principais
1. **Frontend SPA**: Interface administrativa
2. **API Routes**: Endpoints serverless
3. **Scripts de Tracking**: Coleta de dados
4. **Webhooks**: Processamento de dados
5. **Banco de Dados**: Armazenamento estruturado

---

## 💻 FRONTEND - REACT/TYPESCRIPT {#frontend}

### Estrutura de Pastas
```
src/
├── components/          # Componentes reutilizáveis
├── contexts/           # Context API (Auth, etc)
├── pages/              # Páginas principais
├── services/           # Serviços (API calls)
├── types/              # Definições TypeScript
└── utils/              # Utilitários
```

### Páginas Principais
- **Dashboard**: `/` - Visão geral
- **Analytics**: `/analytics/:id` - Analytics básico
- **Analytics Pro**: `/advanced-analytics/:id` - Analytics avançado
- **Leads**: `/leads` - Gestão de leads
- **Landing Pages**: `/landing-pages` - Gerenciamento
- **Settings**: `/settings` - Configurações

### Componentes Críticos

#### AuthContext (`src/contexts/AuthContext.tsx`)
```typescript
interface AuthContextType {
  user: User | null;
  company: Company | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshCompany: () => Promise<void>;
}
```

#### API Service (`src/services/api.ts`)
- **Supabase Client**: Configuração centralizada
- **CRUD Operations**: Leads, companies, landing pages
- **Analytics**: Funções específicas para métricas

### Tecnologias Frontend
- **React Router**: Roteamento SPA
- **Lucide React**: Ícones
- **TailwindCSS**: Estilização
- **TypeScript**: Tipagem estática

---

## 🔧 BACKEND - API ROUTES {#backend}

### Estrutura API
```
api/
├── webhook-lead.js      # Webhook ultra-simples
├── webhook-visitor.js   # Analytics tracking
├── collect.js          # Fallback tracking
└── track.js            # Pixel tracking
```

### Endpoints Principais

#### 1. Webhook Lead (`/api/webhook-lead`)
**Método**: POST  
**Função**: Captura de leads via formulários externos

```javascript
// Payload esperado
{
  "api_key": "uuid-da-empresa",
  "nome": "Nome do lead",
  "email": "email@exemplo.com",
  "telefone": "(11) 99999-9999",
  // ... outros campos
}
```

**Funcionalidades**:
- Validação de API Key via RPC
- Mapeamento inteligente de campos
- Criação automática de campos personalizados
- Inserção de lead + valores personalizados

#### 2. Webhook Visitor (`/api/webhook-visitor`)
**Método**: POST  
**Função**: Tracking de visitantes

```javascript
// Payload esperado
{
  "tracking_code": "uuid-landing-page",
  "session_id": "uuid-sessao",
  "visitor_id": "uuid-visitante",
  "device_type": "mobile|tablet|desktop",
  // ... dados do visitante
}
```

### Padrões de Implementação

#### Headers CORS Padrão
```javascript
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-cache'
};
```

#### Supabase Client Configuration
```javascript
const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'; // anon key
const supabase = createClient(supabaseUrl, supabaseKey);
```

---

## 🗄️ BANCO DE DADOS - SUPABASE {#banco}

### Configuração do Projeto
- **Project ID**: etzdsywunlpbgxkphuil
- **URL**: https://etzdsywunlpbgxkphuil.supabase.co
- **Região**: sa-east-1
- **Status**: ACTIVE_HEALTHY

### Tabelas Principais

#### 1. companies
```sql
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  api_key UUID UNIQUE DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- ... outros campos
);
```

#### 2. leads
```sql
CREATE TABLE leads (
  id SERIAL PRIMARY KEY,
  company_id UUID REFERENCES companies(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  interest TEXT,
  status TEXT DEFAULT 'novo',
  origin TEXT,
  company_name TEXT,
  company_cnpj VARCHAR,
  company_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- ... outros campos
);
```

#### 3. visitors
```sql
CREATE TABLE visitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  landing_page_id UUID REFERENCES landing_pages(id),
  session_id UUID,
  visitor_id UUID, -- Para remarketing
  user_agent TEXT,
  device_type TEXT,
  referrer TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- ... outros campos
);
```

#### 4. lead_custom_fields
```sql
CREATE TABLE lead_custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  field_type TEXT DEFAULT 'text',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 5. lead_custom_values
```sql
CREATE TABLE lead_custom_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id INTEGER REFERENCES leads(id),
  field_id UUID REFERENCES lead_custom_fields(id),
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Funções RPC Críticas

#### 1. public_create_lead_webhook
```sql
CREATE OR REPLACE FUNCTION public_create_lead_webhook(lead_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  company_uuid UUID;
  lead_id_result INTEGER;
  api_key_text TEXT;
BEGIN
  -- Validação e criação de lead
  -- Contorna RLS automaticamente
  -- Retorna lead_id e company_id
END;
$$;
```

#### 2. public_create_visitor_enhanced
```sql
-- Função para criação de visitantes
-- Usado pelo sistema de analytics
-- Contorna RLS para tracking
```

### Row Level Security (RLS)
- **Habilitado** em todas as tabelas principais
- **Policies** baseadas em company_id
- **Contornado** via funções SECURITY DEFINER

---

## 📊 SISTEMA DE ANALYTICS {#analytics}

### Analytics Básico (`/analytics/:id`)
**Funcionalidades**:
- Total de visitantes
- Gráfico temporal
- Breakdown por dispositivo
- Tabela de visitantes recentes

### Analytics Pro (`/advanced-analytics/:id`)
**Funcionalidades**:
- Métricas profissionais
- Filtros de data avançados
- Segmentação por origem
- Tabela de remarketing
- Exportação CSV

### Script de Tracking (`public/m4track-v5.js`)

#### Funcionalidades
- **Detecção de dispositivo**: mobile, tablet, desktop
- **Coleta automática**: user agent, referrer, resolução
- **Visitor ID persistente**: Para remarketing
- **Fallback robusto**: Image request se webhook falhar

#### Implementação
```html
<!-- Código de instalação -->
<script src="https://app.lovoocrm.com/m4track-v5.js?v=TIMESTAMP"></script>
<script>
  LovoCRM.init('TRACKING_CODE', 'https://app.lovoocrm.com');
</script>
```

#### Compatibilidade
- **LovoCRM.init()**: Nome atual
- **LovooCRM.init()**: Compatibilidade
- **M4Track.init()**: Legacy support

### Métricas Coletadas
- **Visitantes únicos**: Por visitor_id
- **Sessões**: Por session_id
- **Dispositivos**: mobile/tablet/desktop
- **Origem**: direct, google, outros
- **Remarketing**: Visitantes recorrentes

---

## 🔗 WEBHOOK ULTRA-SIMPLES {#webhook}

### Conceito
Sistema para captura automática de leads de qualquer formulário externo via POST JSON.

### Endpoint
```
POST https://app.lovoocrm.com/api/webhook-lead
Content-Type: application/json
```

### Sistema Híbrido - Payload V5
```json
{
  "api_key": "582121bf-6661-4c70-81e0-f180f481a92b",
  "nome": "João Silva",
  "email": "joao@email.com",
  "telefone": "11999999999",
  "1": "R$ 50.000",        // Campo personalizado ID: 1
  "2": "30 dias",          // Campo personalizado ID: 2
  "3": "Desenvolvimento"   // Campo personalizado ID: 3
}
```

### Mapeamento Híbrido V5

#### Campos Padrão (Por Nome)
- **Nome**: name, nome, full_name, cliente
- **Email**: email, e-mail, mail
- **Telefone**: phone, telefone, celular, whatsapp
- **Empresa**: company, empresa, company_name
- **Interesse**: interest, interesse, mensagem, message
- **Origem**: origin, origem, source, fonte

#### Campos Personalizados (Por ID Numérico)
- **Sistema híbrido**: Campos padrão por nome + personalizados por ID
- **IDs incrementais**: 1, 2, 3, 4, 5... (auto-increment)
- **Criação manual**: Via interface de Campos Personalizados
- **Precisão absoluta**: Sem ambiguidade ou conflitos
- **Escalabilidade**: Suporta milhares de campos

### Fluxo de Processamento V5 (Sistema Híbrido) - ✅ 100% FUNCIONAL
1. **Recebe POST** com JSON
2. **Valida API Key** via chave anon (funcionando 100%)
3. **Detecta campos híbridos**:
   - Campos padrão: Processados por nome
   - IDs numéricos: Processados como campos personalizados
   - Nomes não-padrão: Logados (modo manual)
4. **Cria lead** com campos padrão
5. **Processa campos personalizados por ID**:
   - Busca campo via RPC `get_custom_field_by_id()` (SECURITY DEFINER)
   - Contorna RLS automaticamente
   - Valida existência na empresa
   - Insere valores em `lead_custom_values`
6. **Retorna sucesso** com lead_id e campos processados

### ✅ CORREÇÕES IMPLEMENTADAS (V1.4.0)
- **RLS Resolvido**: Via RPC com SECURITY DEFINER
- **Chave anon mantida**: Sistema estável preservado
- **Correção crítica**: `lcf.name` → `lcf.field_name AS name`
- **Status**: 100% funcional em produção

### Interface de Configuração
**Localização**: Settings → Integrações

**Elementos**:
- URL única para copiar
- Campo API Key com visibilidade controlada
- Instruções em 3 passos
- Exemplo JSON com placeholder seguro
- Teste automático integrado

---

## 🔐 AUTENTICAÇÃO E SEGURANÇA {#auth}

### Sistema de Autenticação
- **Provider**: Supabase Auth
- **Método**: Email/Password
- **Session**: JWT tokens
- **Context**: React Context API

### Segurança de API Keys
- **Geração**: UUID automático por empresa
- **Armazenamento**: Campo api_key na tabela companies
- **Validação**: Via funções RPC
- **Exposição**: Oculta por padrão na interface

### Row Level Security (RLS)
```sql
-- Exemplo de policy
CREATE POLICY "Users can only see their company data" 
ON leads FOR ALL 
USING (company_id = auth.jwt() ->> 'company_id');
```

### CORS Configuration
```javascript
// Headers padrão para todos os endpoints
{
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}
```

---

## 🚀 DEPLOY E INFRAESTRUTURA {#deploy}

### Vercel Configuration (`vercel.json`)
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    {
      "source": "/track.gif",
      "destination": "/api/track"
    },
    {
      "source": "/webhook/conversion",
      "destination": "/api/webhook"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

### Build Process
1. **TypeScript compilation**: `tsc`
2. **Vite build**: Otimização e bundling
3. **Static assets**: Geração para CDN
4. **API routes**: Deploy como Edge Functions

### Environment Variables
```bash
VITE_SUPABASE_URL=https://etzdsywunlpbgxkphuil.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
```

### Domain Configuration
- **Primary**: https://app.lovoocrm.com
- **SSL**: Automático via Vercel
- **CDN**: Global distribution

---

## ⚙️ CONFIGURAÇÕES CRÍTICAS {#config}

### Supabase Keys
```javascript
// Anon Key (Frontend + Webhooks)
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';
```

### API Endpoints Ativos
- `/api/webhook-lead` - Captura de leads
- `/api/webhook-visitor` - Tracking de visitantes
- `/api/collect` - Fallback tracking
- `/api/track` - Pixel tracking

### Scripts Públicos
- `/m4track-v5.js` - Script principal de tracking
- Cache-Control: `public, max-age=31536000`

---

## 🔧 TROUBLESHOOTING {#troubleshooting}

### Problemas Comuns

#### 1. CORS Errors
**Sintoma**: Blocked by CORS policy  
**Solução**: Verificar headers CORS nos endpoints  
**Prevenção**: Usar webhook approach server-side

#### 2. API Key Inválida
**Sintoma**: `{"success":false,"error":"API key inválida"}`  
**Diagnóstico**: 
```sql
SELECT id, name FROM companies WHERE api_key = 'KEY_AQUI';
```
**Solução**: Verificar se API key existe no banco

#### 3. RLS Policy Violation
**Sintoma**: `new row violates row-level security policy`  
**Solução**: Usar funções RPC com SECURITY DEFINER  
**Exemplo**: `public_create_lead_webhook`

#### 4. Deploy Não Atualiza
**Sintomas**: Mudanças não refletem em produção  
**Soluções**:
- Commit vazio: `git commit --allow-empty -m "Force deploy"`
- Alterar package.json version
- Verificar logs do Vercel

### Logs e Debugging
```javascript
// Adicionar logs nos webhooks
console.log('Debug info:', { param1, param2 });

// Verificar no Vercel Functions logs
// https://vercel.com/dashboard/functions
```

### Testes de Funcionalidade
```bash
# Teste webhook lead
curl -X POST "https://app.lovoocrm.com/api/webhook-lead" \
  -H "Content-Type: application/json" \
  -d '{"api_key":"API_KEY","nome":"Teste","email":"teste@test.com"}'

# Teste tracking
curl "https://app.lovoocrm.com/m4track-v5.js"
```

---

## 📝 HISTÓRICO DE VERSÕES

### v1.0.1 (Novembro 2025)
- ✅ Webhook Ultra-Simples implementado
- ✅ Mapeamento inteligente de campos
- ✅ Analytics Pro V1.0 funcional
- ✅ Sistema de tracking V5 estável
- ✅ Interface de segurança para API Keys

### Próximas Versões
- [ ] Sistema de notificações
- [ ] Integração com WhatsApp
- [ ] Dashboard de vendas
- [ ] Relatórios avançados

---

## 👥 EQUIPE E MANUTENÇÃO

### Responsabilidades
- **Frontend**: React/TypeScript development
- **Backend**: API routes e webhooks
- **Database**: Supabase management
- **Deploy**: Vercel configuration
- **Analytics**: Tracking implementation

### Processo de Atualização
1. **Desenvolvimento local**: Teste completo
2. **Commit estruturado**: Mensagens descritivas
3. **Deploy automático**: Via Vercel
4. **Testes produção**: Validação funcional
5. **Documentação**: Atualizar este arquivo

---

## 🚀 SISTEMA HÍBRIDO WEBHOOK + VISITOR ID V1.1.0 {#sistema-hibrido}

### Visão Geral
Sistema revolucionário que mantém a ultra-simplicidade do webhook (copiar/colar URL) mas adiciona automaticamente captura de visitor_id e scoring comportamental.

### Arquitetura de Interceptação

#### 1. Tripla Interceptação
```javascript
// 1. Interceptação DOM (Formulários HTML)
form.addEventListener('submit', enhanceFormSubmission);

// 2. Interceptação HTTP (React/SPA)
window.fetch = interceptedFetch;
XMLHttpRequest.prototype.send = interceptedSend;

// 3. Interceptação Submit (Capture Phase)
form.addEventListener('submit', ensureVisitorId, true);
```

#### 2. Compatibilidade Universal
- **✅ HTML Tradicional**: action + submit
- **✅ React/Vue/Angular**: useState + fetch
- **✅ Axios/Libraries**: XMLHttpRequest
- **✅ Fetch API**: window.fetch
- **✅ FormData/JSON**: Qualquer payload

### Fluxo Técnico

#### Detecção Automática
```javascript
// Critérios de detecção LovoCRM
const isLovoCRMForm = 
  action.includes('webhook-lead') ||
  form.querySelector('input[name="api_key"]') ||
  (hasLeadFields && hasApiKeyField);
```

#### Interceptação HTTP
```javascript
// Intercepta QUALQUER requisição para webhook
window.fetch = function(url, options) {
  if (isWebhookRequest(url)) {
    options.body = addVisitorId(options.body);
  }
  return originalFetch.apply(this, arguments);
};
```

### Arquivos Modificados

#### `/public/m4track-v5.js`
- **setupFormInterception()**: Detecção de formulários
- **setupHttpInterception()**: Interceptação fetch/XHR
- **enhanceFormSubmission()**: Adição de visitor_id
- **ensureVisitorIdPresent()**: Garantia em capture phase

#### `/api/webhook-lead.js`
- **Processamento visitor_id**: `params.form_data.visitor_id`
- **Conexão analytics**: `processVisitorConnection()`
- **Busca retroativa**: `processRetroactiveVisitorSearch()`
- **Score comportamental**: `calculateEngagementScore()`

#### Função RPC `public_create_lead_webhook`
```sql
INSERT INTO leads (
  company_id, name, email, phone, interest,
  company_name, company_cnpj, company_email,
  visitor_id, -- NOVO CAMPO
  status, origin, created_at
) VALUES (
  company_uuid,
  COALESCE(lead_data->>'name', 'Lead sem nome'),
  lead_data->>'email',
  lead_data->>'phone',
  lead_data->>'interest',
  lead_data->>'company_name',
  lead_data->>'company_cnpj',
  lead_data->>'company_email',
  lead_data->>'visitor_id', -- NOVO VALOR
  'novo', 'webhook_ultra_simples', NOW()
);
```

### Tabelas Envolvidas

#### `leads` (Modificada)
```sql
ALTER TABLE leads ADD COLUMN visitor_id TEXT;
```

#### `visitors` (Existente)
- **visitor_id**: UUID único do visitante
- **session_data**: Dados comportamentais
- **device_info**: Informações do dispositivo

#### `conversions` (Existente)
- **visitor_id**: Conexão com analytics
- **engagement_score**: Score calculado (0-10)
- **behavior_summary**: Resumo comportamental
- **lead_id**: Conexão com lead criado

### Logs de Debug

#### Inicialização
```
LovoCRM: Configurando interceptação HTTP...
LovoCRM: ✅ Interceptação fetch configurada
LovoCRM: ✅ Interceptação XMLHttpRequest configurada
```

#### Detecção de Formulário
```
LovoCRM: ✅ Interceptando formulário LovoCRM!
LovoCRM: ✅ Visitor ID adicionado: e952ff89-5d7f-4dc1-8086-6cb8c348d325
```

#### Interceptação HTTP
```
LovoCRM: Interceptando requisição fetch para webhook
LovoCRM: ✅ Visitor ID adicionado ao fetch: e952ff89-5d7f-4dc1-8086-6cb8c348d325
LovoCRM: 🚀 Requisição enriquecida com visitor_id
```

### Resultado Final
- **Ultra-simplicidade mantida**: Usuário apenas copia/cola webhook URL
- **Captura automática**: visitor_id adicionado automaticamente
- **Compatibilidade total**: Funciona com qualquer tecnologia
- **Score comportamental**: Leads enriquecidos automaticamente
- **Sistema robusto**: Múltiplos fallbacks à prova de falhas

---

## 🔄 SISTEMA DE DUPLICATAS COMPLETO {#duplicatas}

### Visão Geral
Sistema automático de detecção, notificação e mesclagem de leads duplicados baseado em telefone e email.

### Funcionalidades Implementadas

#### 🔍 Detecção Automática
- **Triggers SQL**: Detectam duplicatas em tempo real na inserção/atualização
- **Processamento Retroativo**: Analisa leads históricos automaticamente
- **Critérios**: Telefone e email dentro da mesma empresa
- **Performance**: Indexação otimizada para consultas rápidas

#### 📊 Interface de Notificações
- **Listagem Visual**: Exibe todas as duplicatas pendentes
- **Informações Completas**: Nomes reais, emails, telefones, campos duplicados
- **Filtros Automáticos**: Remove leads já mesclados da interface
- **Contagem Dinâmica**: Atualiza automaticamente após mesclagens

#### 🔧 Sistema de Mesclagem
- **3 Estratégias Disponíveis**:
  - Manter Lead Existente
  - Manter Lead Novo
  - Combinar Informações (Recomendado)
- **Processamento Seguro**: Via RPC para contornar RLS
- **Histórico Completo**: Registro de todas as mesclagens
- **Validações**: Verificações de integridade antes da mesclagem

### Arquitetura Técnica

#### 📋 Tabelas do Banco
```sql
-- Notificações de duplicatas
duplicate_notifications (
  id, company_id, lead_id, duplicate_of_lead_id, 
  reason, status, created_at, reviewed_at, reviewed_by_user_id
)

-- Histórico de mesclagens
lead_merge_history (
  source_lead_id, target_lead_id, merged_by_user_id, 
  merge_strategy, created_at
)
```

#### 🔧 Funções RPC Críticas
```sql
-- Detecção de duplicatas
detect_lead_duplicates(p_company_id UUID)

-- Busca de leads para notificações (contorna RLS)
get_leads_for_notifications(p_lead_ids INTEGER[], p_company_id UUID)

-- Mesclagem de leads (contorna RLS)
merge_leads_webhook(p_source_id, p_target_id, p_strategy, p_notification_id, p_user_id)

-- Notificações enriquecidas (contorna RLS)
get_pending_duplicate_notifications(p_company_id UUID)
```

#### 🌐 APIs Implementadas
```javascript
// Buscar notificações de duplicatas
GET /api/leads/duplicate-notifications?company_id=UUID
// Retorna: { success: true, notifications: [...], count: N }

// Mesclar leads duplicados
POST /api/leads/merge
// Body: { sourceId, targetId, strategy, notificationId?, userId? }
// Retorna: { success: true, resultLeadId, strategy, mergedData }
```

#### 📱 Componente Frontend
```typescript
// Componente principal
src/components/DuplicateNotifications.tsx
// Interface: Lista + Modal de mesclagem + Estratégias
// Estado: Loading, dados, erros, processamento
```

### Fluxo de Funcionamento

#### 1. Detecção Automática
```
Lead Inserido/Atualizado → Trigger SQL → Busca Duplicatas → 
Cria Notificação → Interface Atualizada
```

#### 2. Processamento pelo Usuário
```
Interface Lista Duplicatas → Usuário Clica Mesclar → 
Modal com Estratégias → Confirmação → API Mesclagem → 
RPC Processa → Leads Mesclados → Interface Atualizada
```

#### 3. Filtros Automáticos
```
API Notificações → Busca Leads Ativos → Filtra Mesclados → 
Retorna Apenas Válidos → Interface Limpa
```

### Correções Críticas Implementadas

#### ❌ Problemas Resolvidos
1. **RLS Blocking**: APIs usavam chave anônima bloqueada por RLS
2. **Campo Inexistente**: RPC tentava atualizar `updated_at` inexistente
3. **Leads Mesclados**: Interface mostrava "Lead não encontrado"
4. **Contagem Incorreta**: Incluía leads já processados

#### ✅ Soluções Aplicadas
1. **RPC com SECURITY DEFINER**: Contorna RLS automaticamente
2. **Campos Validados**: Apenas campos existentes nas tabelas
3. **Filtros Automáticos**: Remove leads mesclados da interface
4. **Contagem Dinâmica**: Atualiza automaticamente após ações

### Configurações Críticas

#### 🔑 Supabase
- **Project ID**: etzdsywunlpbgxkphuil
- **Tabelas**: duplicate_notifications, lead_merge_history
- **RLS**: Políticas configuradas para isolamento por empresa
- **Triggers**: Automáticos para detecção em tempo real

#### 📊 Performance
- **Índices**: Otimizados para consultas de duplicatas
- **Queries**: Eficientes com filtros por empresa
- **Cache**: Automático via Vercel Edge Functions
- **Logs**: Detalhados para debug e monitoramento

### Monitoramento e Logs

#### 📈 Métricas Importantes
- **Duplicatas Detectadas**: Contagem por empresa/período
- **Taxa de Mesclagem**: Percentual de duplicatas processadas
- **Tempo de Resposta**: APIs de notificação e mesclagem
- **Erros**: Falhas na detecção ou processamento

#### 🔍 Logs de Debug
```javascript
// API de notificações
console.log('Notificações encontradas:', count);
console.log('Leads filtrados:', leadsMap.size);

// API de mesclagem
console.log('Mesclagem via RPC:', sourceId, '→', targetId);
console.log('Resultado:', result.success, result.result_lead_id);
```

### Status Final
- **✅ Detecção**: 100% automática e em tempo real
- **✅ Interface**: Completa com informações detalhadas
- **✅ Mesclagem**: 3 estratégias funcionais
- **✅ Filtros**: Automáticos para leads processados
- **✅ Performance**: Otimizada e escalável
- **✅ Segurança**: RLS respeitado com contornos seguros

---

**📄 ARQUIVO**: `DOCUMENTACAO_TECNICA_LOVOCRM.md`  
**🔄 SEMPRE MANTER ATUALIZADO**: A cada nova implementação ou correção  
**📍 LOCALIZAÇÃO**: Raiz do projeto M4Track

---

*Documentação gerada automaticamente - Última atualização: 03/11/2025 - 22:43*
