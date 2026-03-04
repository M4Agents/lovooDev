# Migration: Adicionar campo last_contact_at

## Objetivo
Adicionar o campo `last_contact_at` na tabela `leads` para armazenar a data do último contato com cada lead.

## Como executar

### Via Supabase Dashboard (SQL Editor)

1. Acesse o Supabase Dashboard
2. Vá em **SQL Editor**
3. Clique em **New Query**
4. Cole o conteúdo do arquivo `add_last_contact_at_to_leads.sql`
5. Clique em **Run**

### Via Supabase CLI

```bash
supabase db push
```

## O que a migration faz

1. **Adiciona a coluna** `last_contact_at` (TIMESTAMP WITH TIME ZONE)
2. **Cria índice** para otimizar queries de ordenação
3. **Popula dados históricos** buscando a última mensagem de cada lead no chat
4. **Adiciona comentário** descritivo na coluna

## Dados populados

A migration busca automaticamente:
- Última mensagem de cada lead via `chat_messages`
- Relacionamento feito por telefone (leads.phone = chat_conversations.contact_phone)
- Apenas leads com telefone válido

## Resultado esperado

Após executar a migration:
- ✅ Campo `last_contact_at` criado
- ✅ Dados históricos populados automaticamente
- ✅ Campo aparecerá nos cards do funil quando selecionado
- ✅ Performance otimizada com índice

## Rollback (se necessário)

```sql
-- Remover índice
DROP INDEX IF EXISTS idx_leads_last_contact_at;

-- Remover coluna
ALTER TABLE leads DROP COLUMN IF EXISTS last_contact_at;
```

## Verificação

Para verificar se a migration funcionou:

```sql
-- Ver quantos leads têm last_contact_at preenchido
SELECT 
  COUNT(*) as total_leads,
  COUNT(last_contact_at) as leads_com_ultimo_contato,
  ROUND(COUNT(last_contact_at)::numeric / COUNT(*)::numeric * 100, 2) as percentual
FROM leads;

-- Ver exemplos de leads com último contato
SELECT 
  id,
  name,
  phone,
  last_contact_at,
  created_at
FROM leads
WHERE last_contact_at IS NOT NULL
ORDER BY last_contact_at DESC
LIMIT 10;
```
