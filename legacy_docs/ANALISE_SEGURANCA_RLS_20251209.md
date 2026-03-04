# ANÁLISE CRÍTICA DE SEGURANÇA - RLS (Row Level Security)

**Data**: 09/12/2025  
**Objetivo**: Avaliar impacto da ativação do RLS em tabelas críticas  
**Status**: ⚠️ IMPLEMENTAÇÃO REQUER PLANEJAMENTO CUIDADOSO  

## 🚨 **SITUAÇÃO ATUAL - TABELAS SEM RLS**

### **CRÍTICAS (DADOS SENSÍVEIS)**

| Tabela | Registros | Risco | Dados Expostos |
|--------|-----------|-------|----------------|
| `leads` | ~1000+ | 🔴 ALTO | CPF, telefones, emails, dados pessoais |
| `chat_contacts` | ~500+ | 🔴 ALTO | Telefones, nomes, fotos de perfil |
| `chat_conversations` | ~300+ | 🔴 ALTO | Conversas privadas entre empresas |
| `chat_messages` | ~5000+ | 🔴 ALTO | Mensagens privadas, conteúdo sensível |
| `companies` | ~6 | 🔴 ALTO | API keys, dados empresariais |

### **MODERADAS (METADADOS)**

| Tabela | Registros | Risco | Dados Expostos |
|--------|-----------|-------|----------------|
| `lead_merge_history` | ~50 | 🟡 MÉDIO | Histórico de fusões de leads |
| `lead_record_types` | ~10 | 🟡 MÉDIO | Tipos de registro por empresa |
| `lead_tag_assignments` | ~200 | 🟡 MÉDIO | Atribuições de tags |
| `lead_tags` | ~50 | 🟡 MÉDIO | Tags do sistema |

### **BACKUPS (HISTÓRICOS)**

| Tabela | Registros | Risco | Observação |
|--------|-----------|-------|------------|
| `companies_backup_*` | ~4 | 🟢 BAIXO | Dados históricos |
| `chat_conversations_backup_*` | ~26 | 🟢 BAIXO | Backup de conversas |
| `leads_backup_*` | ~100 | 🟢 BAIXO | Backup de leads |

## 🔍 **ANÁLISE DE IMPACTO**

### **SISTEMAS QUE QUEBRARÃO (CRÍTICO)**

#### **1. Webhooks Externos**
```javascript
// api/uazapi-webhook-final.js - QUEBRA COM RLS
const { data: existingLead } = await supabase
  .from('leads')  // ❌ SEM CONTEXTO DE USUÁRIO
  .select('name')
  .eq('phone', phoneNumber);
```

#### **2. APIs Públicas**
```javascript
// api/webhook-lead.js - QUEBRA COM RLS  
const { data: company } = await supabase
  .from('companies')  // ❌ SEM SESSÃO AUTENTICADA
  .select('id, name')
  .eq('api_key', params.api_key);
```

#### **3. Integrações Externas**
- Uazapi webhook não tem contexto de usuário
- APIs de terceiros usam apenas API key
- Sistemas externos sem sessão Supabase

### **SISTEMAS QUE CONTINUARÃO FUNCIONANDO**

#### **1. Frontend Autenticado**
```javascript
// ✅ USUÁRIO LOGADO - FUNCIONA COM RLS
const { data: leads } = await supabase
  .from('leads')  // ✅ auth.uid() disponível
  .select('*');
```

#### **2. RPCs com SECURITY DEFINER**
```sql
-- ✅ BYPASS RLS - CONTINUA FUNCIONANDO
CREATE OR REPLACE FUNCTION chat_get_contact_info(...)
RETURNS jsonb
SECURITY DEFINER  -- ✅ EXECUTA COM PRIVILÉGIOS DO OWNER
```

## 🛡️ **ESTRATÉGIA DE IMPLEMENTAÇÃO SEGURA**

### **FASE 1: PREPARAÇÃO (3-5 DIAS)**

#### **1.1 Criar Políticas RLS (SEM ATIVAR)**
```sql
-- Política para isolamento por empresa
CREATE POLICY "leads_company_isolation" ON leads
FOR ALL USING (
  company_id IN (
    -- Usuário é owner da empresa
    SELECT id FROM companies 
    WHERE user_id = auth.uid()
    UNION
    -- Usuário é membro ativo da empresa
    SELECT company_id FROM company_users 
    WHERE user_id = auth.uid() AND is_active = true
    UNION
    -- Super admin tem acesso a tudo
    SELECT c.id FROM companies c
    JOIN companies super ON super.user_id = auth.uid()
    WHERE super.is_super_admin = true
  )
);
```

#### **1.2 Converter Webhooks para RPCs**
```sql
-- Nova função para webhook Uazapi
CREATE OR REPLACE FUNCTION webhook_uazapi_process_message(
  p_company_api_key uuid,
  p_message_data jsonb
)
RETURNS jsonb
SECURITY DEFINER  -- ✅ BYPASS RLS
LANGUAGE plpgsql
AS $$
DECLARE
  v_company_id uuid;
  v_result jsonb;
BEGIN
  -- Validar API key e obter company_id
  SELECT id INTO v_company_id
  FROM companies
  WHERE api_key = p_company_api_key;
  
  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid API key');
  END IF;
  
  -- Processar mensagem com contexto da empresa
  -- ... lógica do webhook ...
  
  RETURN jsonb_build_object('success', true, 'company_id', v_company_id);
END;
$$;
```

#### **1.3 Atualizar Webhooks**
```javascript
// api/uazapi-webhook-final.js - VERSÃO SEGURA
export default async function handler(req, res) {
  try {
    // Usar RPC em vez de acesso direto
    const { data, error } = await supabase.rpc('webhook_uazapi_process_message', {
      p_company_api_key: companyApiKey,
      p_message_data: messageData
    });
    
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
```

### **FASE 2: TESTE EM AMBIENTE ISOLADO (2-3 DIAS)**

#### **2.1 Ativar RLS em Ambiente de Teste**
```sql
-- Ativar RLS tabela por tabela
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_contacts ENABLE ROW LEVEL SECURITY;
-- ... outras tabelas
```

#### **2.2 Testes Críticos**
- ✅ Login e navegação no frontend
- ✅ Criação de leads via webhook
- ✅ Recebimento de mensagens WhatsApp
- ✅ Chat funcionando
- ✅ Relatórios carregando
- ✅ APIs externas funcionando

### **FASE 3: IMPLEMENTAÇÃO GRADUAL (1 SEMANA)**

#### **3.1 Ordem de Implementação**
1. **Dia 1**: `companies` (base do sistema)
2. **Dia 2**: `leads` (core business)
3. **Dia 3**: `chat_contacts` (comunicação)
4. **Dia 4**: `chat_conversations` (conversas)
5. **Dia 5**: `chat_messages` (mensagens)
6. **Dia 6**: Tabelas auxiliares
7. **Dia 7**: Validação final

#### **3.2 Monitoramento 24/7**
```sql
-- Query para monitorar erros RLS
SELECT 
  schemaname,
  tablename,
  COUNT(*) as rls_violations
FROM pg_stat_user_tables
WHERE schemaname = 'public'
GROUP BY schemaname, tablename;
```

## 📋 **POLÍTICAS RLS DETALHADAS**

### **LEADS**
```sql
-- Política principal para leads
CREATE POLICY "leads_access_policy" ON leads
FOR ALL USING (
  -- Verificar se usuário tem acesso à empresa do lead
  company_id IN (
    SELECT get_user_accessible_companies(auth.uid())
  )
);

-- Função auxiliar para obter empresas acessíveis
CREATE OR REPLACE FUNCTION get_user_accessible_companies(p_user_id uuid)
RETURNS TABLE(company_id uuid)
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id
  FROM companies c
  WHERE c.user_id = p_user_id  -- Owner da empresa
  
  UNION
  
  SELECT cu.company_id
  FROM company_users cu
  WHERE cu.user_id = p_user_id 
    AND cu.is_active = true  -- Membro ativo
  
  UNION
  
  SELECT c.id
  FROM companies c
  JOIN companies super ON super.user_id = p_user_id
  WHERE super.is_super_admin = true;  -- Super admin
END;
$$;
```

### **CHAT TABLES**
```sql
-- Chat contacts
CREATE POLICY "chat_contacts_policy" ON chat_contacts
FOR ALL USING (
  company_id IN (SELECT get_user_accessible_companies(auth.uid()))
);

-- Chat conversations  
CREATE POLICY "chat_conversations_policy" ON chat_conversations
FOR ALL USING (
  company_id IN (SELECT get_user_accessible_companies(auth.uid()))
);

-- Chat messages
CREATE POLICY "chat_messages_policy" ON chat_messages
FOR ALL USING (
  company_id IN (SELECT get_user_accessible_companies(auth.uid()))
);
```

### **COMPANIES**
```sql
-- Política mais restritiva para companies
CREATE POLICY "companies_access_policy" ON companies
FOR SELECT USING (
  user_id = auth.uid()  -- Owner
  OR id IN (
    SELECT company_id FROM company_users 
    WHERE user_id = auth.uid() AND is_active = true
  )  -- Membro
  OR EXISTS (
    SELECT 1 FROM companies 
    WHERE user_id = auth.uid() AND is_super_admin = true
  )  -- Super admin
);

-- Política separada para UPDATE (mais restritiva)
CREATE POLICY "companies_update_policy" ON companies
FOR UPDATE USING (
  user_id = auth.uid()  -- Apenas owner pode alterar
  OR EXISTS (
    SELECT 1 FROM companies 
    WHERE user_id = auth.uid() AND is_super_admin = true
  )  -- Ou super admin
);
```

## ⚠️ **RISCOS E MITIGAÇÕES**

### **ALTO RISCO**

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Webhooks param | 🔴 Alta | 🔴 Crítico | Converter para RPCs antes |
| APIs quebram | 🔴 Alta | 🔴 Crítico | Testar todas integrações |
| Chat para | 🟡 Média | 🔴 Crítico | Monitoramento em tempo real |
| Performance degrada | 🟡 Média | 🟡 Médio | Otimizar políticas RLS |

### **PLANO DE ROLLBACK**
```sql
-- Rollback imediato se necessário
ALTER TABLE leads DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_contacts DISABLE ROW LEVEL SECURITY;
-- ... outras tabelas

-- Script de rollback completo
\i rollback_rls.sql
```

## 🚀 **CRONOGRAMA DETALHADO**

### **SEMANA 1: PREPARAÇÃO**
- **Segunda**: Análise completa de dependências
- **Terça**: Criação de todas as políticas RLS
- **Quarta**: Conversão de webhooks para RPCs
- **Quinta**: Criação de funções SECURITY DEFINER
- **Sexta**: Testes unitários das políticas

### **SEMANA 2: IMPLEMENTAÇÃO**
- **Segunda**: Ambiente de teste + validação
- **Terça**: Implementação gradual (companies + leads)
- **Quarta**: Chat tables (contacts, conversations, messages)
- **Quinta**: Tabelas auxiliares + monitoramento
- **Sexta**: Validação final + documentação

## 📊 **MÉTRICAS DE SUCESSO**

### **SEGURANÇA**
- ✅ 100% das tabelas com RLS ativo
- ✅ Zero vazamentos entre empresas
- ✅ Auditoria completa de acessos

### **FUNCIONALIDADE**
- ✅ Todos os webhooks funcionando
- ✅ Frontend 100% operacional
- ✅ APIs externas funcionando
- ✅ Performance mantida

### **MONITORAMENTO**
- ✅ Logs de RLS violations = 0
- ✅ Tempo de resposta < 200ms
- ✅ Uptime > 99.9%

## 🎯 **CONCLUSÃO**

### **RECOMENDAÇÃO**: ✅ IMPLEMENTAR COM PLANEJAMENTO

**A ativação do RLS é ESSENCIAL para a segurança do sistema, mas requer:**

1. **Preparação cuidadosa** (1-2 semanas)
2. **Conversão de webhooks** para RPCs
3. **Implementação gradual** com monitoramento
4. **Plano de rollback** robusto

### **BENEFÍCIOS**
- 🛡️ **Segurança máxima**: Isolamento total entre empresas
- 🔒 **Compliance**: Atendimento a LGPD/GDPR
- 🎯 **Auditoria**: Controle total de acessos
- 🚀 **Escalabilidade**: Sistema preparado para crescimento

### **PRÓXIMOS PASSOS**
1. **Aprovação** do plano de implementação
2. **Alocação** de recursos (dev + infra)
3. **Início** da Fase 1 (preparação)
4. **Monitoramento** contínuo durante implementação

---

**Documento preparado por**: Cascade AI  
**Revisão técnica**: Pendente  
**Aprovação**: Pendente  
**Status**: 📋 AGUARDANDO DECISÃO
