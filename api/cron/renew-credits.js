// =============================================================================
// POST /api/cron/renew-credits
//
// Cron de renovação de créditos de IA por billing cycle real.
//
// SEGURANÇA:
//   Authorization: Bearer <CRON_SECRET>
//   Rejeita qualquer requisição sem token válido.
//
// EXECUÇÃO:
//   1. Busca todos os company_id de company_credits
//   2. Para cada empresa: chama renew_company_credits(company_id) via RPC
//   3. A função RPC decide internamente se o ciclo está vencido (idempotente)
//      → "already_renewed_this_cycle" = skipped
//      → renewed: true = contabilizado como renovado
//   4. Retorna relatório com contagens de resultado
//
// IMPORTANTE:
//   - NÃO filtra empresas por data no SQL (a função RPC é a fonte de verdade)
//   - NÃO usa plan_slug como parâmetro (a RPC resolve o plano internamente)
//   - Erros por empresa NÃO interrompem o processamento das demais
//   - Recomendado agendar 1x por dia (ex: "0 3 * * *" — 3h da manhã)
//
// RESPOSTA (200):
//   {
//     "ok":              true,
//     "total_companies": number,
//     "renewed":         number,
//     "skipped":         number,
//     "errors":          number,
//     "details":         Array<{ company_id, result | error }>
//   }
// =============================================================================

import { createClient } from '@supabase/supabase-js'

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url.trim() || !key.trim()) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function validateCronAuth(req) {
  const auth     = req.headers.authorization ?? ''
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  // Rejeita se CRON_SECRET não estiver configurado
  if (!process.env.CRON_SECRET) return false
  return auth === expected
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  // ── Validar token do cron ─────────────────────────────────────────────────
  if (!validateCronAuth(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  const svc = getServiceSupabase()
  if (!svc) {
    return res.status(500).json({ ok: false, error: 'Supabase service_role não configurado' })
  }

  // ── Buscar todos os company_ids registrados ───────────────────────────────
  //
  // NÃO filtramos por data aqui — a RPC renew_company_credits decide se o
  // ciclo está vencido. Isso garante que empresas recém-criadas sem renovação
  // sejam inicializadas e que a lógica de billing cycle permaneça no banco.

  const { data: rows, error: listError } = await svc
    .from('company_credits')
    .select('company_id')

  if (listError) {
    return res.status(500).json({ ok: false, error: 'Erro ao listar empresas' })
  }

  const companies = rows ?? []

  // ── Processar cada empresa ────────────────────────────────────────────────
  //
  // Processamento sequencial intencional:
  //   - Evita sobrecarga no banco com muitas transações simultâneas
  //   - A RPC usa FOR UPDATE — paralelismo causaria contenção desnecessária
  //   - Empresas individuais com erro NÃO interrompem o lote

  let renewed = 0
  let skipped = 0
  let errors  = 0
  const details = []

  for (const { company_id } of companies) {
    try {
      const { data: result, error: rpcError } = await svc
        .rpc('renew_company_credits', { p_company_id: company_id })

      if (rpcError) {
        errors++
        details.push({ company_id, error: rpcError.message })
        continue
      }

      if (!result?.ok) {
        errors++
        details.push({ company_id, error: result?.error ?? 'RPC retornou ok: false' })
        continue
      }

      if (result.renewed === true) {
        renewed++
        details.push({ company_id, result: 'renewed' })
      } else {
        skipped++
        // Não incluir no details para manter o payload enxuto
      }
    } catch (err) {
      errors++
      details.push({ company_id, error: err?.message ?? 'Erro desconhecido' })
    }
  }

  return res.status(200).json({
    ok:              true,
    total_companies: companies.length,
    renewed,
    skipped,
    errors,
    details,
  })
}
