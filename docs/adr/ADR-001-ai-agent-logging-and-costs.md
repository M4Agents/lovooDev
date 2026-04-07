# ADR-001: Logging de Execução e Estimativa de Custo dos Agentes Lovoo

**Status:** Aceito  
**Data:** 2026-04-07  
**Autores:** Equipe de Engenharia — Lovoo CRM

---

## Contexto

Os Agentes Lovoo são entidades globais da plataforma, administradas exclusivamente pela empresa pai (`dcc99d3d-9def-4b93-aeb2-1a3be5f15413`). São consumidos por usuários de todas as empresas/tenants do SaaS através da função `runAgent(use_id, context)`.

O runner já suporta múltiplos `knowledge_mode` (`none`, `inline`, `rag`, `hybrid`) e é o ponto central obrigatório para execução de IA no sistema. Nenhuma feature deve chamar OpenAI diretamente.

Com o crescimento do uso, identificou-se a necessidade de observabilidade estruturada para:

- Entender padrões de uso por empresa/tenant
- Estimar custo operacional de IA
- Detectar erros e comportamentos inesperados
- Preparar a base para futuras regras de consumo, quotas e planos

---

## Decisão

Implementar logging estruturado de execuções no `runAgent()` com as seguintes características:

### 1. Tabela de logs

Criada a tabela `public.ai_agent_execution_logs` no Supabase com:

- `use_id` — uso funcional que disparou a execução
- `agent_id` — agente que executou (NULL quando não resolvido)
- `consumer_company_id` — empresa/tenant que consumiu a execução (**não** o owner do agente)
- `user_id` — usuário que disparou (NULL em webhooks/automações)
- `channel` — canal de origem (`whatsapp`, `web`, etc.)
- `model` — modelo OpenAI utilizado
- `knowledge_mode` — modo de conhecimento do agente
- `status` — status da execução (ver tabela abaixo)
- `is_fallback` — se a resposta foi um fallback estático
- `duration_ms` — duração total em milissegundos
- `input_tokens`, `output_tokens`, `total_tokens` — tokens da OpenAI
- `estimated_cost_usd` — estimativa operacional de custo (não é faturamento)
- `pricing_version` — versão do mapa de preços usado no cálculo
- `error_code` — código estruturado de erro/fallback

### 2. Statuses possíveis

| status | descrição | OpenAI chamada? | error_code obrigatório? |
|--------|-----------|-----------------|------------------------|
| `success` | OpenAI respondeu com sucesso | Sim | Não |
| `fallback_no_agent` | Sem binding ou agente inativo | Não | Sim |
| `fallback_openai_unavailable` | OpenAI indisponível/desabilitada | Não | Sim |
| `fallback_openai_failed` | OpenAI falhou, fallback estático retornado | Sim | Sim |
| `error_missing_context` | `requires_context=true`, contexto ausente | Não | Sim |
| `error_openai` | OpenAI falhou, sem fallback configurado | Sim | Sim |
| `error_db` | Falha na resolução do agente (DB/config) | Não | Sim |

**Decisão fechada:** `invalid_use_id` **não será logado** no MVP. Ocorre antes de qualquer resolução de agente e representa misuse da API, não uma execução de agente.

### 3. Error codes controlados

Valores válidos para `error_code`, enforçados via discriminated union TypeScript:

- `no_binding` — nenhum binding registrado para o use_id
- `agent_inactive` — agente encontrado, mas inativo
- `openai_not_configured` — integração OpenAI não configurada
- `openai_disabled` — OpenAI desabilitada explicitamente
- `openai_client_null` — cliente OpenAI não pôde ser inicializado
- `openai_execution_failed` — OpenAI falhou durante a execução
- `missing_required_context` — requires_context=true, extra_context ausente
- `db_error` — falha na resolução do agente (DB/config)

### 4. Estimativa de custo

Fonte oficial de preços: **https://openai.com/api/pricing/**

O arquivo `api/lib/agents/pricing.ts` mantém um mapa manual de preços com:

- `PRICING_REVISION` — identificador da revisão (formato: `YYYY-MM`)
- `PRICING_REVIEWED_AT` — data da última revisão manual (formato: `YYYY-MM-DD`)

O campo `estimated_cost_usd` é uma **estimativa operacional interna**. Não representa faturamento real, nem o valor cobrado pela OpenAI ao cliente.

Quando um modelo não está mapeado em `pricing.ts`, `estimated_cost_usd = null`. Nunca retorna custo falso.

O campo `pricing_version` nos logs permite rastrear qual revisão de preços foi usada em cada execução histórica.

### 5. Logging fire-and-forget

O módulo `api/lib/agents/logger.ts` usa `service_role` exclusivamente no backend. A operação de log nunca bloqueia a execução do runner. Falhas são silenciosas.

### 6. Segurança e RLS

- INSERT: exclusivo via `service_role` no backend (`logger.ts`)
- SELECT: restrito a `admin`/`super_admin` da empresa pai via RLS
- Os logs de todas as empresas ficam na mesma tabela (isolamento via `consumer_company_id`)
- Nenhum dado sensível (prompts, mensagens, contexto) é salvo nos logs

---

## Semântica crítica: `consumer_company_id` vs `agent.company_id`

`consumer_company_id` = empresa/tenant que **consumiu** a execução.

**Não confundir com** `agent.company_id`, que é a empresa pai dona do agente.

Esta distinção é fundamental para queries de custo e consumo por tenant. Usar `agent.company_id` nos logs resultaria em todos os registros apontando para a empresa pai, impossibilitando análise por tenant.

---

## Separação de camadas — arquitetura futura

A tabela `ai_agent_execution_logs` é a camada de observabilidade operacional. Ela **não** é, e **não deve ser usada como**:

- Billing real
- Controle de plano contratado
- Mecanismo de bloqueio de uso
- Regras comerciais

A evolução prevista segue esta separação:

```
Camada 1: Logs (MVP — implementado)
  └── ai_agent_execution_logs
  └── observabilidade, tokens, custo estimado, status

Camada 2: Regras de consumo (futuro)
  └── limites por plano
  └── quota por empresa/tenant
  └── política de uso por use_id

Camada 3: Decisão (futuro)
  └── alertas
  └── bloqueios
  └── notificações
```

Os logs não substituem regras de consumo. Os logs não tomam decisão de bloqueio.

---

## Evolução futura de pricing

O `pricing.ts` atual é intencional para o MVP. A evolução planejada:

1. Criar tabela `ai_agent_pricing_versions`
2. Fluxo controlado:
   - Input manual (colar preços da URL oficial)
   - Parsing assistido por IA
   - Validação obrigatória no backend
   - Aprovação humana
   - Ativação de nova versão
3. Sem scraping automático em produção
4. Sem atualização automática sem validação
5. Versionamento e rastreabilidade obrigatórios

---

## Localização da UI administrativa futura

A funcionalidade de visualização de pricing, consumo e observabilidade de IA ficará em:

**Configurações → Agentes → Custos e Uso de IA**

Acessível apenas pela empresa pai. Separada da edição funcional dos agentes.

---

## Evolução para agentes por empresa (multi-tenant real)

Quando os Agentes Lovoo evoluírem para suportar agentes por empresa:

- `consumer_company_id` continuará sendo o campo correto de consumo
- A separação entre "agente global da empresa pai" e "agente do tenant" deve ser clara
- Os logs de agentes por empresa devem usar a mesma tabela (com `consumer_company_id` preenchido)
- A camada de regras de consumo (Camada 2) tratará a distinção de planos por tenant

---

## Arquivos criados/modificados

| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `supabase/migrations/20260407220000_ai_agent_execution_logs.sql` | Novo | Tabela, índices e RLS |
| `api/lib/agents/pricing.ts` | Novo | Mapa de preços e estimativa de custo |
| `api/lib/agents/logger.ts` | Novo | Logger fire-and-forget com service_role |
| `api/lib/agents/runner.ts` | Alterado | Instrumentação com logging e captura de usage |
| `docs/adr/ADR-001-ai-agent-logging-and-costs.md` | Novo | Este documento |

---

## Riscos identificados

| Risco | Severidade | Mitigação |
|-------|-----------|-----------|
| `service_role` exposto no frontend | Alta | `logger.ts` exclusivo no backend; nunca importar no frontend |
| `estimated_cost_usd` interpretado como faturamento real | Média | Comentários explícitos em `pricing.ts`, `logger.ts`, migration e ADR |
| Pricing desatualizado | Média | `PRICING_REVIEWED_AT` visível; procedimento de atualização documentado |
| Modelo sem preço mapeado | Baixa | `estimateCost()` retorna `null`; campo fica NULL no banco |
| Erro sem `error_code` | Média | Discriminated union TypeScript enforce em compile time |
| Confusão global vs tenant consumidor | Alta | `consumer_company_id` documentado; `agent.company_id` não usada no log |
| `user_id` null em contextos sem sessão | Baixa | Campo nullable por design; documentado em `AgentRunContext` |
| `invalid_use_id` não logado | Baixa | Decisão fechada de escopo; documentada aqui e no runner |

---

## Referências

- Fonte oficial de preços OpenAI: https://openai.com/api/pricing/
- Tabela de execuções: `public.ai_agent_execution_logs`
- Runner: `api/lib/agents/runner.ts`
- Logger: `api/lib/agents/logger.ts`
- Pricing: `api/lib/agents/pricing.ts`
