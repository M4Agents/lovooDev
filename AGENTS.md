# AGENTS.md

Lovoo CRM é um SaaS multi-tenant: Vite, React, TypeScript e Functions em `/api`. O banco é Supabase, com RLS e RPC. Estas regras são autocontidas: `.cursor/rules` não está versionado.

- Toda operação relevante carrega `company_id`. Preservar RLS. A role autoriza; template de permissão não substitui o RBAC.
- `partner` só acessa empresas atribuídas. `service_role` fica restrito ao backend autorizado.
- `main` local acompanha a base oficial. Cada desenvolvimento usa branch e worktree exclusivos.
- Fluxo: análise, plano, aprovação, implementação, testes, commit, DEV, homologação e PROD.
- DEV e PROD recebem o mesmo SHA, uma publicação por vez, depois da homologação.
- O Supabase é compartilhado entre DEV e PROD. SQL exige aprovação específica. Sem `db push`, `migration repair` ou force push sem autorização.
- Não versionar `.env`, credenciais, `.cursor/` ou `node_modules`. Preservar alterações de outros agentes.
- Agente cloud não recebe credencial de produção. O orquestrador não delega execução sem autorização explícita.
- Não consultar a Vercel automaticamente. Reaproveitar o contexto e manter respostas curtas.
