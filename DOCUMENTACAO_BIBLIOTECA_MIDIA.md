# 📚 DOCUMENTAÇÃO COMPLETA - BIBLIOTECA DE MÍDIA

**Data de Criação:** 24 de Dezembro de 2025  
**Versão:** 1.0  
**Autor:** Sistema de IA Cascade  
**Projeto:** M4Track - CRM WhatsApp  

---

## 📋 ÍNDICE

1. [Visão Geral](#visão-geral)
2. [Arquitetura do Sistema](#arquitetura-do-sistema)
3. [Estrutura de Dados](#estrutura-de-dados)
4. [Componentes Frontend](#componentes-frontend)
5. [APIs e Endpoints](#apis-e-endpoints)
6. [Migração de Dados](#migração-de-dados)
7. [Funcionalidades Implementadas](#funcionalidades-implementadas)
8. [Deploy e Versionamento](#deploy-e-versionamento)
9. [Próximos Passos](#próximos-passos)
10. [Troubleshooting](#troubleshooting)

---

## 🎯 VISÃO GERAL

### **Objetivo**
Implementar uma biblioteca de mídia unificada no sistema M4Track que permite:
- Visualizar todas as mídias recebidas de leads organizadas por tipo
- Gerenciar biblioteca da empresa com pastas organizadas
- Upload de arquivos para AWS S3 com validações
- Integração não-destrutiva com sistema existente

### **Contexto**
A biblioteca foi integrada como uma nova aba "📚 Biblioteca" na sidebar direita do chat, mantendo total compatibilidade com o sistema existente e preservando todas as funcionalidades anteriores.

### **Princípios de Desenvolvimento**
- ✅ **Não-destrutivo:** Preservar sistema existente
- ✅ **Segurança:** RLS e isolamento por empresa
- ✅ **Performance:** Índices otimizados e paginação
- ✅ **Escalabilidade:** Estrutura preparada para crescimento

---

## 🏗️ ARQUITETURA DO SISTEMA

### **Fluxo de Dados**
```
WhatsApp → Webhook → chat_messages (existente)
                  ↓
            lead_media_unified (nova)
                  ↓
            MediaLibraryTab → APIs → Supabase
```

### **Componentes Principais**
1. **Frontend:** `MediaLibraryTab.tsx` - Interface da biblioteca
2. **Backend:** APIs RESTful para dados e operações
3. **Banco:** Tabelas Supabase com RLS
4. **Storage:** AWS S3 para arquivos

### **Integração com Sistema Existente**
- **LeadPanel.tsx:** Modificado para incluir nova aba
- **chat_messages:** Mantida intacta, fonte de dados migrados
- **AWS S3:** Reutilizado bucket existente `aws-lovoocrm-media`

---

## 🗄️ ESTRUTURA DE DADOS

### **Tabelas Criadas no Supabase**

#### **1. lead_media_unified**
```sql
CREATE TABLE lead_media_unified (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  lead_id SMALLINT REFERENCES leads(id),
  s3_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_type VARCHAR(20) NOT NULL CHECK (file_type IN ('image', 'video', 'audio', 'document')),
  mime_type VARCHAR(100) NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  metadata JSONB,
  source_message_id UUID,
  source_conversation_id UUID,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL,
  migrated_from VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Índices:**
- `idx_lead_media_company_lead` (company_id, lead_id)
- `idx_lead_media_type` (file_type)
- `idx_lead_media_received` (received_at DESC)
- `idx_lead_media_conversation` (source_conversation_id)

#### **2. company_media_library**
```sql
CREATE TABLE company_media_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  folder_id UUID REFERENCES company_folders(id),
  s3_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_type VARCHAR(20) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  tags TEXT[],
  description TEXT,
  metadata JSONB,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### **3. company_folders**
```sql
CREATE TABLE company_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name VARCHAR(255) NOT NULL,
  path TEXT NOT NULL,
  parent_id UUID REFERENCES company_folders(id),
  icon VARCHAR(10) DEFAULT '📁',
  description TEXT,
  file_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(company_id, path)
);
```

### **RLS (Row Level Security)**
Todas as tabelas implementam RLS com isolamento por `company_id`:
```sql
ALTER TABLE lead_media_unified ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON lead_media_unified 
  FOR ALL USING (company_id = current_setting('app.current_company_id')::uuid);
```

---

## 🎨 COMPONENTES FRONTEND

### **MediaLibraryTab.tsx**
**Localização:** `src/components/WhatsAppChat/LeadPanel/MediaLibraryTab.tsx`

#### **Props Interface**
```typescript
interface MediaLibraryTabProps {
  conversationId: string
  companyId: string
  leadId?: string
}
```

#### **Estados Principais**
```typescript
const [mediaSummary, setMediaSummary] = useState<MediaSummary>()
const [recentMedia, setRecentMedia] = useState<MediaFile[]>([])
const [companyFolders, setCompanyFolders] = useState<CompanyFolder[]>([])
const [activeSection, setActiveSection] = useState<'lead' | 'company'>('lead')
const [searchQuery, setSearchQuery] = useState('')
const [showNewFolderModal, setShowNewFolderModal] = useState(false)
const [uploading, setUploading] = useState(false)
```

#### **Funcionalidades Implementadas**
- ✅ **Contadores de mídia** por tipo (imagem, vídeo, áudio, documento)
- ✅ **Lista de arquivos recentes** do lead
- ✅ **Biblioteca da empresa** com pastas organizadas
- ✅ **Campo de busca** integrado
- ✅ **Upload de arquivos** com validações
- ✅ **Criação de pastas** via modal
- ✅ **Estados de loading** e feedback visual

#### **Validações de Upload**
```typescript
const maxSizes = {
  image: 25 * 1024 * 1024,    // 25MB
  video: 100 * 1024 * 1024,   // 100MB
  audio: 50 * 1024 * 1024,    // 50MB
  document: 20 * 1024 * 1024  // 20MB
}
```

### **Integração com LeadPanel**
**Arquivo:** `src/components/WhatsAppChat/LeadPanel/LeadPanel.tsx`

#### **Modificações Realizadas**
```typescript
// Estado atualizado para incluir 'media'
const [activeTab, setActiveTab] = useState<'info' | 'schedule' | 'media'>('info')

// Novo botão na interface
<button onClick={() => setActiveTab('media')}>
  Biblioteca
</button>

// Renderização condicional
{activeTab === 'media' && (
  <MediaLibraryTab
    conversationId={conversationId}
    companyId={companyId}
    leadId={contact?.id}
  />
)}
```

---

## 🔌 APIS E ENDPOINTS

### **Serviço Principal**
**Arquivo:** `src/services/mediaLibraryApi.ts`

#### **Classe MediaLibraryApi**
```typescript
class MediaLibraryApi {
  private baseUrl = '/api/media-library'
  
  // Métodos principais
  async getLeadMediaSummary(leadId: string | undefined, companyId: string): Promise<MediaSummary>
  async getLeadMediaFiles(leadId: string | undefined, companyId: string, options): Promise<MediaFilesResponse>
  async getCompanyFolders(companyId: string): Promise<CompanyFolder[]>
  async createFolder(companyId: string, folderData): Promise<CompanyFolder>
}
```

### **Endpoints Implementados**

#### **1. GET /api/media-library/leads/[leadId]/summary**
**Arquivo:** `src/pages/api/media-library/leads/[leadId]/summary.js`

**Funcionalidade:** Retorna contadores de mídia por tipo para um lead específico

**Resposta:**
```json
{
  "success": true,
  "data": {
    "images": 124,
    "videos": 21,
    "audios": 20,
    "documents": 18,
    "total": 183
  }
}
```

#### **2. GET /api/media-library/leads/[leadId]/files**
**Arquivo:** `src/pages/api/media-library/leads/[leadId]/files.js`

**Funcionalidade:** Lista arquivos de mídia com paginação e filtros

**Parâmetros:**
- `file_type`: image|video|audio|document
- `page`: número da página
- `limit`: itens por página
- `search`: termo de busca

**Resposta:**
```json
{
  "success": true,
  "data": {
    "files": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 183,
      "totalPages": 10
    }
  }
}
```

#### **3. GET/POST /api/media-library/company/folders**
**Arquivo:** `src/pages/api/media-library/company/folders.js`

**GET - Listar pastas:**
```json
{
  "success": true,
  "data": {
    "folders": [
      {
        "id": "uuid",
        "name": "Marketing",
        "path": "/marketing",
        "icon": "📢",
        "description": "Materiais de marketing",
        "file_count": 0
      }
    ]
  }
}
```

**POST - Criar pasta:**
```json
{
  "name": "Nova Pasta",
  "description": "Descrição da pasta",
  "icon": "📁"
}
```

---

## 🔄 MIGRAÇÃO DE DADOS

### **Script de Migração Aplicado**
**Data:** 24/12/2025  
**Arquivo:** `supabase/migrations/migrate_existing_media_with_lead_mapping.sql`

#### **Processo de Migração**
1. **Mapeamento de dados:** `chat_messages` → `lead_media_unified`
2. **Conversão de IDs:** `conversation_id` → `lead_id` via `chat_contacts`
3. **Extração de metadados:** URLs, tipos MIME, nomes de arquivo
4. **Preservação de referências:** `source_message_id`, `source_conversation_id`

#### **Dados Migrados**
- ✅ **228 mídias** migradas com sucesso
- ✅ **Lead 161 (Marcio):** 183 mídias (124 imagens, 21 vídeos, 20 áudios, 18 docs)
- ✅ **Arquivos mantidos no AWS S3** - apenas referências criadas
- ✅ **Metadados preservados** com informações originais

#### **Query de Migração**
```sql
INSERT INTO lead_media_unified (
  company_id, lead_id, s3_key, original_filename, 
  file_type, mime_type, file_size, metadata,
  source_message_id, source_conversation_id, 
  received_at, migrated_from
)
SELECT 
  cm.company_id,
  l.id as lead_id,
  CASE 
    WHEN cm.media_url LIKE '%amazonaws.com%' THEN 
      regexp_replace(cm.media_url, '^https://[^/]+/', '')
    ELSE 
      'supabase/' || regexp_replace(cm.media_url, '^https://[^/]+/storage/v1/object/public/', '')
  END as s3_key,
  regexp_replace(cm.media_url, '^.*/', '') as original_filename,
  -- ... resto da query
FROM chat_messages cm
JOIN chat_conversations conv ON cm.conversation_id = conv.id
JOIN chat_contacts cc ON conv.contact_phone = cc.phone_number
JOIN leads l ON cc.phone_number = l.phone AND cc.company_id = l.company_id
WHERE cm.media_url IS NOT NULL;
```

### **Pastas Padrão Criadas**
Automaticamente criadas para todas as empresas ativas:
- 📢 **Marketing** - Materiais de marketing e campanhas
- 📦 **Produtos** - Imagens e documentos de produtos  
- 📄 **Documentos** - Documentos gerais da empresa
- 📋 **Templates** - Templates e modelos reutilizáveis

---

## ⚙️ FUNCIONALIDADES IMPLEMENTADAS

### **✅ Funcionalidades Completas**

#### **1. Visualização de Mídias**
- Contadores por tipo (imagem, vídeo, áudio, documento)
- Lista de arquivos recentes do lead
- Estados vazios informativos
- Loading states com spinners

#### **2. Biblioteca da Empresa**
- Listagem de pastas organizadas
- Contadores de arquivos por pasta
- Ícones personalizados para cada pasta
- Navegação hierárquica (preparada)

#### **3. Upload de Arquivos**
- Seletor de múltiplos arquivos
- Validações de tipo e tamanho
- Estados de loading durante upload
- Feedback de erro com alertas
- Tipos aceitos: imagens, vídeos, áudios, documentos

#### **4. Criação de Pastas**
- Modal responsivo com validação
- Input com foco automático
- Confirmação via Enter ou botão
- Integração com API existente
- Recarregamento automático da lista

#### **5. Busca e Filtros**
- Campo de busca integrado
- Preparado para busca em tempo real
- Filtros por tipo de arquivo (preparado)

### **🔄 Funcionalidades Pendentes**

#### **1. Upload Real para AWS S3**
- Atualmente simulado com delay
- Necessita integração com AWS SDK
- Geração de URLs assinadas
- Salvamento de referências no Supabase

#### **2. Preview de Arquivos**
- Visualização de imagens
- Player de vídeo/áudio
- Visualizador de documentos PDF

#### **3. Drag & Drop**
- Arrastar arquivos da biblioteca para o chat
- Upload via drag & drop na interface

#### **4. Navegação em Pastas**
- Entrar em pastas específicas
- Breadcrumb de navegação
- Subpastas hierárquicas

---

## 🚀 DEPLOY E VERSIONAMENTO

### **Histórico de Commits**

#### **Commit Inicial - d913459**
```
feat(media-library): implementar biblioteca de mídia na sidebar do chat
- Criar componente MediaLibraryTab isolado
- Adicionar nova aba "Biblioteca" no LeadPanel
- Implementar APIs para resumo, arquivos e pastas
- Criar serviço mediaLibraryApi centralizado
- Backup de segurança do LeadPanel original
```

#### **Correção de Dados Mock - a6898b1**
```
fix(media-library): corrigir dados mock e implementar contadores zerados
- Substituir dados mock por contadores zerados quando não há leadId
- Corrigir APIs para retornar listas vazias em vez de dados fictícios
- Remover status 'Biblioteca em desenvolvimento'
- Adicionar tratamento para leadId undefined
```

#### **Funcionalidades dos Botões - c61186b**
```
feat(media-library): implementar funcionalidades dos botões Upload e Nova Pasta
- Adicionar handlers onClick para botões Upload Arquivo e Nova Pasta
- Implementar sistema de upload com validações de tipo e tamanho
- Criar modal para criação de nova pasta com validação
- Validações: imagens 25MB, vídeos 100MB, áudios 50MB, docs 20MB
```

### **Migrações Supabase Aplicadas**

#### **1. Criação das Tabelas - 20251224074200**
```sql
-- Tabelas: lead_media_unified, company_media_library, company_folders
-- RLS habilitado em todas as tabelas
-- Índices de performance implementados
-- Triggers para updated_at automático
```

#### **2. Migração de Dados - migrate_existing_media_with_lead_mapping**
```sql
-- 228 mídias migradas de chat_messages para lead_media_unified
-- Mapeamento correto de conversation_id para lead_id
-- Preservação de metadados e referências originais
```

### **Ambiente de Deploy**
- **Repositório:** https://github.com/M4Agents/lovooDev
- **Branch:** main
- **Deploy:** Automático via Vercel
- **Supabase:** Projeto M4_Digital (etzdsywunlpbgxkphuil)

---

## 🔮 PRÓXIMOS PASSOS

### **Alta Prioridade**
1. **Implementar upload real para AWS S3**
   - Integrar AWS SDK no frontend
   - Gerar URLs assinadas para upload
   - Salvar referências no Supabase após upload

2. **Corrigir exibição de pastas da empresa**
   - Investigar por que as 5 pastas criadas não aparecem
   - Verificar APIs e parâmetros de consulta

3. **Integração automática de novas mídias**
   - Modificar webhook para salvar em ambas as tabelas
   - Garantir que novas mídias apareçam automaticamente

### **Média Prioridade**
1. **Sistema de preview**
   - Visualização de imagens em modal
   - Player de vídeo/áudio integrado
   - Visualizador de PDF

2. **Drag & Drop**
   - Arrastar da biblioteca para o chat
   - Upload via drag & drop

3. **Navegação em pastas**
   - Entrar em pastas específicas
   - Sistema de breadcrumb
   - Subpastas hierárquicas

### **Baixa Prioridade**
1. **Busca avançada**
   - Busca em tempo real
   - Filtros por data, tipo, tamanho
   - Tags e categorização

2. **Relatórios e analytics**
   - Estatísticas de uso
   - Arquivos mais acessados
   - Crescimento da biblioteca

---

## 🔧 TROUBLESHOOTING

### **Problemas Conhecidos**

#### **1. Pastas da empresa não aparecem**
**Sintoma:** Lista vazia mesmo com pastas no Supabase  
**Investigação:** Verificar logs da API e parâmetros de consulta  
**Status:** Pendente

#### **2. Upload simulado**
**Sintoma:** Arquivos não vão para AWS S3  
**Causa:** Implementação ainda não conectada ao AWS SDK  
**Status:** Funcionalidade pendente

#### **3. leadId undefined**
**Sintoma:** Contadores zerados para alguns leads  
**Causa:** Mapeamento entre chat_contacts e leads  
**Solução:** Implementada - retorna contadores zerados graciosamente

### **Logs Importantes**
```javascript
// MediaLibraryTab.tsx
console.log('📊 Dados disponíveis:', { leadId, companyId, conversationId })
console.log('📊 Buscando resumo de mídia para lead:', { leadId, companyId })
console.log('📁 Buscando pastas da empresa:', companyId)

// APIs
console.log('✅ Resumo de mídia recebido:', data)
console.log('✅ Pastas obtidas:', data.data.folders.length)
```

### **Comandos de Debug**
```sql
-- Verificar mídias migradas
SELECT COUNT(*) FROM lead_media_unified;

-- Verificar pastas criadas
SELECT * FROM company_folders WHERE company_id = 'uuid';

-- Verificar mídias de um lead específico
SELECT file_type, COUNT(*) FROM lead_media_unified 
WHERE lead_id = 161 GROUP BY file_type;
```

---

## 📞 SUPORTE E MANUTENÇÃO

### **Arquivos Críticos**
- `src/components/WhatsAppChat/LeadPanel/MediaLibraryTab.tsx`
- `src/services/mediaLibraryApi.ts`
- `src/pages/api/media-library/`
- `supabase/migrations/`

### **Backup de Segurança**
- `src/components/WhatsAppChat/LeadPanel/LeadPanel.backup.tsx`

### **Monitoramento**
- Logs do Vercel para APIs
- Logs do Supabase para queries
- Console do navegador para frontend

---

**Documentação criada em:** 24 de Dezembro de 2025  
**Última atualização:** 24 de Dezembro de 2025  
**Versão do sistema:** 1.0  
**Status:** Funcional com pendências documentadas
