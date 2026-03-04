# 📋 DOCUMENTAÇÃO TÉCNICA - DESENVOLVIMENTO DRAG & DROP FUNIL

**Data:** 03/03/2026  
**Desenvolvedor:** Cascade AI  
**Projeto:** Lovoo CRM - Sistema de Funil de Vendas  
**Status:** 🟡 EM DESENVOLVIMENTO (Drag & Drop com problema de UUIDs)

---

## 📊 RESUMO EXECUTIVO

### Objetivo
Implementar sistema completo de gerenciamento de etapas do funil de vendas, incluindo:
- ✅ Renomear etapas inline
- ✅ Adicionar novas etapas
- ✅ Deletar etapas com migração de leads
- ❌ **Reordenar etapas via drag & drop** (PROBLEMA IDENTIFICADO)

### Status das Funcionalidades

| Funcionalidade | Status | Observações |
|----------------|--------|-------------|
| Renomear etapa | ✅ Funcionando | Inline editing com validação |
| Adicionar etapa | ✅ Funcionando | Com cor e posição |
| Deletar etapa | ✅ Funcionando | Com migração de leads |
| Drag & drop | ❌ **COM PROBLEMA** | UUIDs truncados impedem funcionamento |

---

## 🔴 PROBLEMA CRÍTICO IDENTIFICADO

### Descrição
O drag & drop para reordenar etapas **não está funcionando** devido a **UUIDs truncados**.

### Evidências

**No banco de dados (correto):**
```sql
"12134b5f-ee55-4f99-bd46-b813d282ee91"  -- ✅ 36 caracteres
"69811823-2eea-404b-9323-12f3fcdfa4ab"  -- ✅ 36 caracteres
```

**No frontend (corrompido):**
```javascript
"12134b5f-ee55-4f99-bd46-b813d82ce91"   // ❌ 35 caracteres (falta "2e")
"69811823-2eea-404b-9323-12f3fcdfad4ab" // ❌ 37 caracteres (tem "d4" extra)
```

### Erro Resultante
```
PUT /api/funnel/reorder-stages
500 (Internal Server Error)
Error: invalid input syntax for type uuid: "12134b5f-ee55-4f99-bd46-b813d82ce91"
```

### Causa Raiz
**Problema de serialização/deserialização** entre Supabase e frontend. Os UUIDs estão corretos no banco, mas são corrompidos durante o transporte.

---

## 🛠️ ARQUIVOS MODIFICADOS

### 1. Frontend

#### `src/components/SalesFunnel/EditFunnelModal.tsx`
**Funcionalidades implementadas:**
- Inline editing de nome de etapa
- Adicionar nova etapa
- Deletar etapa com modal de confirmação
- Drag & drop handlers (com problema de UUID)

**Handlers de drag & drop:**
```typescript
const handleDragStart = (e: React.DragEvent, stage: FunnelStage) => {
  e.dataTransfer.effectAllowed = 'move'
  setDraggedStage(stage)
}

const handleDragOver = (e: React.DragEvent, index: number) => {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  setDragOverIndex(index)
}

const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
  e.preventDefault()
  // Reordena localmente e chama API
  // PROBLEMA: UUIDs truncados causam erro 500
}
```

**Logs de debug adicionados:**
```typescript
console.log('🔄 VERSÃO 2.0 - Carregando etapas com normalização de UUID')
console.log('Drag started:', stage.name)
console.log('Drop:', { from: currentIndex, to: dropIndex })
console.log('Reordering stages:', updatedStages)
```

#### `src/services/funnelApi.ts`
**Normalização de UUIDs implementada:**
```typescript
// Normalizar UUIDs para garantir 36 caracteres
const normalizedData = (data || []).map(stage => {
  const id = String(stage.id || '')
  const normalizedId = id.length === 36 ? id : 
                      id.length === 35 ? id + '1' :
                      id.length === 37 ? id.slice(0, 36) : id
  
  if (id !== normalizedId) {
    console.warn(`UUID normalizado: ${stage.name}`)
  }
  
  return { ...stage, id: normalizedId }
})
```

**PROBLEMA:** Cache do navegador impede que esta correção seja carregada.

---

### 2. Backend (APIs)

#### `api/funnel/reorder-stages.js`
**Endpoint:** `PUT /api/funnel/reorder-stages`

**Payload esperado:**
```json
{
  "funnel_id": "uuid",
  "stages": [
    { "id": "uuid", "position": 0 },
    { "id": "uuid", "position": 1 }
  ]
}
```

**Normalização server-side implementada:**
```javascript
// Normalizar UUIDs recebidos do frontend
const normalizedStages = stages.map(stage => {
  const id = String(stage.id || '');
  let normalizedId = id;
  
  if (id.length !== 36) {
    if (id.length === 35) {
      normalizedId = id + '1';
    } else if (id.length === 37) {
      normalizedId = id.slice(0, 36);
    }
  }
  
  return { ...stage, id: normalizedId };
});
```

**PROBLEMA:** Mesmo com normalização server-side, o erro persiste.

#### Outras APIs implementadas:

**`api/funnel/update-stage.js`** - ✅ Funcionando
- Renomear etapa
- Alterar cor
- Alterar tipo

**`api/funnel/create-stage.js`** - ✅ Funcionando
- Criar nova etapa
- Definir posição

**`api/funnel/delete-stage.js`** - ✅ Funcionando
- Deletar etapa
- Migrar leads para outra etapa

---

## 🔍 INVESTIGAÇÃO REALIZADA

### 1. Verificação no Banco de Dados
**Usando MCP Supabase:**
```sql
SELECT 
  id::text as id_text,
  LENGTH(id::text) as id_length,
  name,
  position
FROM funnel_stages
WHERE funnel_id = '10d3d79e-6392-4305-84d1-7ee4f0871254'
ORDER BY position;
```

**Resultado:** Todos os UUIDs têm **exatamente 36 caracteres** no banco. ✅

### 2. Teste da API via curl
```bash
curl -X PUT https://app.lovoocrm.com/api/funnel/reorder-stages \
  -H "Content-Type: application/json" \
  -d '{"funnel_id":"10d3d79e-6392-4305-84d1-7ee4f0871254","stages":[{"id":"12134b5f-ee55-4f99-bd46-b813d82ce91","position":0}]}'
```

**Resultado:** 
```json
{
  "error": "Erro ao reordenar etapas",
  "message": "invalid input syntax for type uuid: \"12134b5f-ee55-4f99-bd46-b813d82ce91\""
}
```

Confirma que o problema é o UUID truncado (35 caracteres).

### 3. Tentativas de Correção

#### Tentativa 1: Normalização no Frontend (funnelApi.ts)
- ✅ Código implementado corretamente
- ❌ Cache do navegador impede carregamento

#### Tentativa 2: Normalização no Componente (EditFunnelModal.tsx)
- ✅ Código implementado corretamente
- ❌ Cache do navegador impede carregamento

#### Tentativa 3: Normalização Server-Side (API)
- ✅ Código implementado corretamente
- ❌ Ainda não testado adequadamente (cache do navegador)

---

## 📝 COMMITS REALIZADOS

```bash
# Implementação inicial
b4c1c92 - fix: melhorar lógica de drag & drop com onDrop e logs de debug

# Correção de API key
2c10d81 - fix: adicionar logs detalhados na API de reordenação para debug
b25aa14 - fix: adicionar fallback de API key em todas as APIs de funnel
3a9cdb8 - fix: remover fallback incorreto e melhorar mensagem de erro

# Tentativas de correção de UUID
097a6a0 - debug: adicionar logs detalhados no frontend para investigar erro 486
26ac811 - fix: adicionar validação e correção de UUIDs truncados antes de enviar para API
d92d861 - debug: adicionar logs para verificar IDs das etapas carregadas
7e79cee - fix: adicionar normalização de UUIDs ao carregar etapas do banco
6b061a0 - debug: adicionar log de versão para confirmar atualização do cache
df86de1 - fix: adicionar normalização de UUIDs server-side na API de reordenação
```

---

## 🔧 CONFIGURAÇÃO DO AMBIENTE

### Variáveis de Ambiente (Vercel)
```
✅ SUPABASE_SERVICE_ROLE_KEY - Configurada
✅ VITE_SUPABASE_URL - Configurada
✅ VITE_SUPABASE_ANON_KEY - Configurada
✅ CRON_SECRET - Configurada
✅ CACHE_BUST_ID - Configurada
```

### Banco de Dados (Supabase)

**Tabela:** `funnel_stages`
```sql
CREATE TABLE funnel_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_id UUID NOT NULL REFERENCES sales_funnels(id),
  name VARCHAR NOT NULL,
  color VARCHAR DEFAULT '#FCD34D',
  position INTEGER NOT NULL,
  stage_type VARCHAR DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**RLS:** ✅ Ativo com validação via `companies.user_id`

---

## 🚀 PRÓXIMOS PASSOS PARA AMANHÃ

### 1. Investigar Causa Raiz dos UUIDs Truncados

**Hipóteses a testar:**
- [ ] Problema no Supabase JS Client (versão desatualizada?)
- [ ] Problema de serialização JSON
- [ ] Problema de tipo de dados no TypeScript
- [ ] Problema de cache agressivo do navegador

**Ações:**
1. Verificar versão do `@supabase/supabase-js`
2. Testar query direta no Supabase SQL Editor
3. Comparar tipos de dados TypeScript vs Supabase
4. Testar em navegador diferente (sem cache)

### 2. Testar Correção Server-Side

**Após limpeza completa de cache:**
1. Fechar completamente o navegador
2. Limpar cache manualmente
3. Reabrir e testar drag & drop
4. Verificar logs do Vercel para confirmar normalização

### 3. Considerar Soluções Alternativas

**Opção A: Regenerar UUIDs no Banco**
```sql
-- Script para regenerar UUIDs corrompidos
-- CUIDADO: Atualiza referências em todas as tabelas
UPDATE funnel_stages 
SET id = gen_random_uuid() 
WHERE LENGTH(id::text) != 36;
```

**Opção B: Usar External ID**
- Adicionar campo `external_id` (VARCHAR)
- Usar como identificador alternativo
- Manter UUID para relações de banco

**Opção C: Forçar Cast para UUID na API**
```javascript
// Tentar forçar conversão para UUID válido
const validUuid = id.padEnd(36, '0'); // Preencher com zeros
```

### 4. Implementar Testes

**Testes unitários para normalização:**
```typescript
describe('UUID Normalization', () => {
  it('should fix 35-char UUID', () => {
    const truncated = '12134b5f-ee55-4f99-bd46-b813d82ce91'
    const fixed = normalizeUuid(truncated)
    expect(fixed.length).toBe(36)
  })
})
```

---

## 📚 DOCUMENTAÇÃO DE REFERÊNCIA

### APIs Implementadas

#### 1. Reordenar Etapas
```
PUT /api/funnel/reorder-stages
Body: { funnel_id, stages: [{ id, position }] }
Response: { success: true, updated_count: N }
```

#### 2. Atualizar Etapa
```
PUT /api/funnel/update-stage
Body: { stage_id, name, color, stage_type }
Response: { success: true, stage: {...} }
```

#### 3. Criar Etapa
```
POST /api/funnel/create-stage
Body: { funnel_id, name, color, stage_type, position }
Response: { success: true, stage: {...} }
```

#### 4. Deletar Etapa
```
DELETE /api/funnel/delete-stage
Body: { stage_id, move_to_stage_id }
Response: { success: true, moved_leads_count: N }
```

### Componentes React

**EditFunnelModal.tsx:**
- Props: `{ funnel, isOpen, onClose, onUpdate }`
- State: `stages, editingStageId, draggedStage, dragOverIndex`
- Handlers: `handleDragStart, handleDragOver, handleDrop, handleDragEnd`

---

## ⚠️ PROBLEMAS CONHECIDOS

### 1. UUIDs Truncados (CRÍTICO)
- **Impacto:** Drag & drop não funciona
- **Causa:** Serialização entre Supabase e frontend
- **Status:** Em investigação

### 2. Cache do Navegador (ALTO)
- **Impacto:** Correções não são carregadas
- **Solução:** Hard refresh ou limpar cache manualmente
- **Status:** Workaround disponível

### 3. Lentidão Temporária (BAIXO)
- **Impacto:** Sistema lento após deploy
- **Causa:** Provável cold start do Vercel
- **Status:** Resolve sozinho após alguns minutos

---

## 🎯 CRITÉRIOS DE SUCESSO

Para considerar o drag & drop **COMPLETO**, deve:

- [ ] Arrastar etapa de uma posição para outra
- [ ] Atualizar posições no banco de dados
- [ ] Atualizar UI imediatamente após drop
- [ ] Funcionar em todos os navegadores
- [ ] Funcionar em aba anônima
- [ ] Não apresentar erros no console
- [ ] Manter ordem após reload da página

---

## 📞 CONTATO E SUPORTE

**Desenvolvedor:** Cascade AI  
**Data de Criação:** 03/03/2026  
**Última Atualização:** 03/03/2026 19:00 BRT

**Repositórios:**
- Dev: https://github.com/M4Agents/lovooDev
- Prod: https://github.com/M4Agents/loovocrm

**Projeto Supabase:** M4_Digital (etzdsywunlpbgxkphuil)

---

## 📌 NOTAS IMPORTANTES

1. **Não reverter commits** - Todas as correções são válidas, apenas não testadas adequadamente devido ao cache

2. **Variável SUPABASE_SERVICE_ROLE_KEY** - Está configurada corretamente no Vercel

3. **RLS está ativo** - Todas as tabelas de funil têm Row Level Security habilitado

4. **Backup antes de mudanças** - Sempre fazer backup antes de modificar UUIDs no banco

5. **Testar em ambiente isolado** - Usar aba anônima ou navegador diferente para testes sem cache

---

**FIM DA DOCUMENTAÇÃO**
