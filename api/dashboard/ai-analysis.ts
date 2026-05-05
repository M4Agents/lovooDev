// =====================================================
// POST /api/dashboard/ai-analysis
//
// Dois modos via body:
//   • Novo:    { company_id, analysis_type, period, funnel_id? }
//   • Resume:  { analysis_id }  (status awaiting_credits ou credit_failed)
//
// Fluxo para análise nova:
//   auth → membership → canAiAnalysis → cooldown (APENAS novo) →
//   contexto → cache → mutex → saldo (margem 1.3x) →
//   INSERT processing → LLM → debit → UPDATE completed|credit_failed
//
// Segurança:
//   - company_id vem do membership, nunca do body/query
//   - Contexto LLM: apenas agregados/contagens/IDs opacos
//   - output bloqueado se status = credit_failed
//   - service_role apenas backend
//   - p_execution_log_id = dashboard_ai_analyses.id (sem FK em credit_transactions;
//     UPDATE em ai_agent_execution_logs afeta 0 linhas sem erro — verificado no RPC)
// =====================================================

import { getSupabaseAdmin }    from '../lib/automation/supabaseAdmin.js'
import { resolvePeriod }        from '../lib/dashboard/period.js'
import { canAiAnalysis }        from '../lib/dashboard/aiAnalysisAccess.js'
import {
  buildAnalysisContext,
  buildPromptsFromSummary,
  buildSystemPromptWithCustom,
  generateFinalPromptHash,
  MVP_ANALYSIS_TYPES,
  PROMPT_VERSION,
  MAX_TOKENS_BY_TYPE,
  type AnalysisType,
} from '../lib/dashboard/aiAnalysisContexts.js'
import {
  extractToken,
  assertMembership,
  assertFunnelBelongsToCompany,
  jsonError,
} from '../lib/dashboard/auth.js'
import { getOpenAIClient } from '../lib/openai/client.js'

const CREDIT_RATE         = 100
const INSIGHTS_MULTIPLIER = 6
const MARGIN_FACTOR       = 1.3   // saldo mínimo = estimado * 1.3
const COOLDOWN_SECONDS    = 10    // por user_id — APENAS para análise nova
const MUTEX_MINUTES       = 5     // por contexto idêntico
const CACHE_HOURS         = 24    // reutilização por input_hash
const AI_MODEL            = 'gpt-4o-mini'

// ---------------------------------------------------------------------------
// Helpers de crédito
// ---------------------------------------------------------------------------

function calculateCredits(totalTokens: number): number {
  return Math.ceil((totalTokens / 1000) * CREDIT_RATE * INSIGHTS_MULTIPLIER)
}

async function getCompanyBalance(svc: any, companyId: string): Promise<number> {
  const { data } = await svc
    .from('company_credits')
    .select('plan_credits, extra_credits')
    .eq('company_id', companyId)
    .maybeSingle()
  return (data?.plan_credits ?? 0) + (data?.extra_credits ?? 0)
}

// ---------------------------------------------------------------------------
// Helpers para query com funnel_id nullable
// Nunca usar .eq('funnel_id', null) — PostgREST requer .is('funnel_id', null)
// ---------------------------------------------------------------------------

function applyFunnelFilter(query: any, funnelId: string | null): any {
  return funnelId ? query.eq('funnel_id', funnelId) : query.is('funnel_id', null)
}

// ---------------------------------------------------------------------------
// Validação do schema da resposta LLM
// ---------------------------------------------------------------------------

const VALID_IMPACTS      = new Set(['high', 'medium', 'low'])
const VALID_ACTION_TYPES = new Set(['open_filtered_opportunities', 'open_funnel_stage'])

function validateLLMOutput(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Resposta LLM não é um objeto JSON válido')
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.title !== 'string' || !obj.title.trim()) {
    throw new Error('Campo "title" ausente ou inválido')
  }
  if (typeof obj.summary !== 'string' || !obj.summary.trim()) {
    throw new Error('Campo "summary" ausente ou inválido')
  }
  if (!Array.isArray(obj.findings))            obj.findings = []
  if (!Array.isArray(obj.recommended_actions)) obj.recommended_actions = []
  if (!Array.isArray(obj.limitations))         obj.limitations = []
  if (!Array.isArray(obj.next_best_actions))   obj.next_best_actions = []

  obj.next_best_actions = (obj.next_best_actions as unknown[]).map((a: any, i: number) => {
    if (typeof a.title !== 'string') throw new Error(`next_best_actions[${i}].title inválido`)
    if (!VALID_IMPACTS.has(a.impact)) a.impact = 'medium'
    if (!VALID_ACTION_TYPES.has(a.action_type)) {
      throw new Error(`next_best_actions[${i}].action_type inválido: ${a.action_type}`)
    }
    if (!a.filters || typeof a.filters !== 'object') a.filters = {}
    return {
      title:       a.title,
      description: a.description ?? '',
      action_type: a.action_type,
      filters:     a.filters,
      impact:      a.impact,
    }
  })

  return obj
}

// ---------------------------------------------------------------------------
// Fluxo de execução LLM + debit
// Reutilizado por análise nova e por resume de awaiting_credits.
// NÃO chamar para credit_failed (tem fluxo próprio no handleResume).
// ---------------------------------------------------------------------------

async function executeLLMAndDebit(
  svc: any,
  analysisId: string,
  companyId: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  systemPromptHash: string,
  customPromptUsed = false,
  customPromptId: string | null = null,
  skipDebit = false,
): Promise<void> {
  const openai = getOpenAIClient()
  if (!openai) throw new Error('OpenAI não configurado')

  let completion: any

  // Chamar LLM — em caso de erro: status = failed, créditos não debitados
  try {
    completion = await openai.chat.completions.create({
      model:           AI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      temperature: 0.3,
      max_tokens:  maxTokens,
    })
  } catch (llmErr: any) {
    await svc.from('dashboard_ai_analyses').update({
      status:        'failed',
      error_message: `LLM error: ${llmErr?.message ?? String(llmErr)}`,
    }).eq('id', analysisId)
    throw llmErr
  }

  const usage = completion.usage ?? { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 }

  // Validar schema da resposta LLM
  let validatedOutput: Record<string, unknown>
  try {
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? '{}')
    validatedOutput = validateLLMOutput(raw)
  } catch (schemaErr: any) {
    await svc.from('dashboard_ai_analyses').update({
      status:        'failed',
      error_message: `Schema inválido: ${schemaErr?.message ?? String(schemaErr)}`,
    }).eq('id', analysisId)
    throw schemaErr
  }

  const creditsToDebit = calculateCredits(usage.total_tokens)

  // Empresa pai — sem débito de créditos: marca completed com credits_used = 0
  if (skipDebit) {
    await svc.from('dashboard_ai_analyses').update({
      status:       'completed',
      output:       validatedOutput,
      credits_used: 0,
      model:        AI_MODEL,
      completed_at: new Date().toISOString(),
      metadata: {
        total_tokens:       usage.total_tokens,
        prompt_tokens:      usage.prompt_tokens,
        completion_tokens:  usage.completion_tokens,
        credits_to_charge:  0,
        model:              AI_MODEL,
        source:             'dashboard_ai_analysis',
        analysis_id:        analysisId,
        prompt_version:     PROMPT_VERSION,
        system_prompt_hash: systemPromptHash,
        custom_prompt_used: customPromptUsed,
        custom_prompt_id:   customPromptId,
        parent_company_no_debit: true,
      },
    }).eq('id', analysisId)
    return
  }

  // Debitar créditos (demais empresas)
  // p_execution_log_id = analysisId (dashboard_ai_analyses.id — UUID)
  // Seguro: credit_transactions.execution_log_id não tem FK.
  // O UPDATE em ai_agent_execution_logs afetará 0 linhas — sem erro.
  // Idempotência garantida via credit_transactions.execution_log_id.
  const { data: debitResult, error: debitError } = await svc.rpc('debit_credits_atomic', {
    p_company_id:       companyId,
    p_credits:          creditsToDebit,
    p_feature_type:     'insights',
    p_total_tokens:     usage.total_tokens,
    p_model:            AI_MODEL,
    p_execution_log_id: analysisId,
  })

  const debitOk = !debitError && debitResult?.ok === true

  if (debitOk) {
    await svc.from('dashboard_ai_analyses').update({
      status:       'completed',
      output:       validatedOutput,
      credits_used: creditsToDebit,
      model:        AI_MODEL,
      completed_at: new Date().toISOString(),
      metadata: {
        total_tokens:       usage.total_tokens,
        prompt_tokens:      usage.prompt_tokens,
        completion_tokens:  usage.completion_tokens,
        credits_to_charge:  creditsToDebit,
        model:              AI_MODEL,
        source:             'dashboard_ai_analysis',
        analysis_id:        analysisId,
        prompt_version:     PROMPT_VERSION,
        system_prompt_hash: systemPromptHash,
        custom_prompt_used: customPromptUsed,
        custom_prompt_id:   customPromptId,
      },
    }).eq('id', analysisId)
  } else {
    // LLM concluiu, mas débito falhou.
    // Output SALVO mas bloqueado via API (status = credit_failed).
    // credits_used e credits_to_charge persistidos para debit exato no resume.
    const failReason = debitError
      ? `RPC error: ${debitError.message}`
      : `Saldo insuficiente (ok=false, balance=${debitResult?.balance ?? 'unknown'})`

    await svc.from('dashboard_ai_analyses').update({
      status:        'credit_failed',
      output:        validatedOutput,   // salvo mas NÃO exposto via GET
      credits_used:  creditsToDebit,    // valor exato a debitar no resume
      model:         AI_MODEL,
      error_message: failReason,
      metadata: {
        total_tokens:       usage.total_tokens,
        prompt_tokens:      usage.prompt_tokens,
        completion_tokens:  usage.completion_tokens,
        credits_to_charge:  creditsToDebit,
        model:              AI_MODEL,
        source:             'dashboard_ai_analysis',
        analysis_id:        analysisId,
        debit_failed:       true,
        prompt_version:     PROMPT_VERSION,
        system_prompt_hash: systemPromptHash,
        custom_prompt_used: customPromptUsed,
        custom_prompt_id:   customPromptId,
      },
    }).eq('id', analysisId)

    throw new Error(`credit_failed: ${failReason}`)
  }
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST')    { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // 1. Auth
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const svc = getSupabaseAdmin()
    const { data: { user }, error: authError } = await svc.auth.getUser(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const body = req.body ?? {}

    // 2. Resume detectado → desvio direto para handleResume.
    //    COOLDOWN NÃO SE APLICA a resume — o check fica após este bloco.
    if (body.analysis_id) {
      return await handleResume(res, svc, user, body.analysis_id)
    }

    // ── A partir daqui: fluxo de análise NOVA ──────────────────────────────

    // 3. Validar campos obrigatórios
    const analysisType: AnalysisType = body.analysis_type
    if (!MVP_ANALYSIS_TYPES.includes(analysisType)) {
      jsonError(res, 400, `analysis_type inválido. Aceitos: ${MVP_ANALYSIS_TYPES.join(', ')}`)
      return
    }

    const period = typeof body.period === 'string' ? body.period.trim() : '30d'
    let resolvedRange: { start: string; end: string }
    try { resolvedRange = resolvePeriod(period) }
    catch (e: any) { jsonError(res, 400, e.message ?? 'Período inválido'); return }

    // 4. Membership — company_id extraído do body mas VALIDADO contra membership
    const companyId = typeof body.company_id === 'string' ? body.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // 4.1. Verificar se é empresa pai — isenta de controle de créditos
    const { data: companyRow } = await svc
      .from('companies')
      .select('company_type')
      .eq('id', companyId)
      .maybeSingle()
    const isParentCompany = companyRow?.company_type === 'parent'

    // 5. Feature flag
    const allowed = await canAiAnalysis(svc, companyId)
    if (!allowed) { jsonError(res, 403, 'Recurso de IA analítica não habilitado'); return }

    // 6. Validar funnel_id se fornecido
    const rawFunnelId = typeof body.funnel_id === 'string' ? body.funnel_id.trim() : null
    let funnelId: string | null = null
    if (rawFunnelId) {
      const valid = await assertFunnelBelongsToCompany(svc, rawFunnelId, companyId)
      if (!valid) { jsonError(res, 403, 'funnel_id não pertence à empresa'); return }
      funnelId = rawFunnelId
    }

    // Conversion_drop e funnel_overview exigem funnel_id
    if ((analysisType === 'conversion_drop' || analysisType === 'funnel_overview') && !funnelId) {
      jsonError(res, 400, `funnel_id é obrigatório para ${analysisType}`)
      return
    }

    // 7. Cooldown por user_id — APENAS análise nova (resume não passa por aqui)
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_SECONDS * 1000).toISOString()
    const { data: recentByUser } = await svc
      .from('dashboard_ai_analyses')
      .select('id')
      .eq('user_id', user.id)
      .eq('company_id', companyId)
      .gte('created_at', cooldownCutoff)
      .not('status', 'in', '("awaiting_credits","credit_failed")')
      .limit(1)

    if (recentByUser && recentByUser.length > 0) {
      return res.status(429).json({
        ok:    false,
        error: 'Aguarde alguns segundos antes de solicitar nova análise',
      })
    }

    // 8. Construir contexto seguro (sem dados sensíveis)
    const ctx = await buildAnalysisContext(
      svc, companyId, analysisType, period, resolvedRange, funnelId,
    )

    // 8.5. Carregar prompt complementar da empresa (se existir e ativo)
    //      Aplicado apenas se is_active = true; nunca substitui o prompt base.
    const { data: customPromptRow } = await svc
      .from('dashboard_ai_prompts')
      .select('id, custom_prompt')
      .eq('company_id', companyId)
      .eq('analysis_type', analysisType)
      .eq('is_active', true)
      .maybeSingle()

    const customPromptText = (customPromptRow as any)?.custom_prompt?.trim() || null
    const customPromptId   = (customPromptRow as any)?.id ?? null

    if (customPromptText) {
      ctx.system_prompt      = buildSystemPromptWithCustom(analysisType, customPromptText)
      ctx.system_prompt_hash = generateFinalPromptHash(analysisType, ctx.system_prompt)
    }

    // 9. Cache: análise completed com mesmo input_hash + funnel_id < 24h
    //    Usa IS NULL quando funnel_id é null — nunca .eq('funnel_id', null)
    const cacheCutoff = new Date(Date.now() - CACHE_HOURS * 3_600_000).toISOString()
    let cacheQuery = svc
      .from('dashboard_ai_analyses')
      .select('id, created_at')
      .eq('company_id', companyId)
      .eq('input_hash', ctx.input_hash)
      .eq('status', 'completed')
      .gte('created_at', cacheCutoff)
      .order('created_at', { ascending: false })
      .limit(1)
    cacheQuery = applyFunnelFilter(cacheQuery, funnelId)

    const { data: cached } = await cacheQuery

    if (cached && cached.length > 0) {
      // Cache hit: retorna referência sem output automático.
      // Frontend usa analysis_id para GET /ai-analysis/[id].
      return res.status(200).json({
        ok:              true,
        cache_available: true,
        analysis_id:     cached[0].id,
        created_at:      cached[0].created_at,
        message:         'Análise idêntica disponível. Use o analysis_id para visualizar.',
      })
    }

    // 10. Mutex: pending/processing com mesmo contexto (hash + funnel_id) < 5min
    const mutexCutoff = new Date(Date.now() - MUTEX_MINUTES * 60_000).toISOString()
    let mutexQuery = svc
      .from('dashboard_ai_analyses')
      .select('id, status')
      .eq('company_id', companyId)
      .eq('analysis_type', analysisType)
      .eq('period', period)
      .eq('input_hash', ctx.input_hash)
      .in('status', ['pending', 'processing'])
      .gte('created_at', mutexCutoff)
      .limit(1)
    mutexQuery = applyFunnelFilter(mutexQuery, funnelId)

    const { data: running } = await mutexQuery

    if (running && running.length > 0) {
      return res.status(200).json({
        ok:          true,
        processing:  true,
        analysis_id: running[0].id,
        status:      running[0].status,
        message:     'Análise em andamento. Aguarde ou consulte o status pelo analysis_id.',
      })
    }

    // 11. Verificar saldo com margem de 30% — ignorado para empresa pai
    const balance         = isParentCompany ? Infinity : await getCompanyBalance(svc, companyId)
    const requiredBalance = Math.ceil(ctx.estimated_credits * MARGIN_FACTOR)

    if (!isParentCompany && balance < requiredBalance) {
      const { data: awaitingRow } = await svc
        .from('dashboard_ai_analyses')
        .insert({
          company_id:        companyId,
          user_id:           user.id,
          analysis_type:     analysisType,
          funnel_id:         funnelId,
          period,
          context_version:   ctx.context_version,
          input_hash:        ctx.input_hash,
          input_summary:     ctx.input_summary,
          estimated_credits: ctx.estimated_credits,
          status:            'awaiting_credits',
          metadata:          {
            source:             'dashboard_ai_analysis',
            analysis_type:      analysisType,
            credits_to_charge:  ctx.estimated_credits,
            prompt_version:     PROMPT_VERSION,
            system_prompt_hash: ctx.system_prompt_hash,
            custom_prompt_used: !!customPromptText,
            custom_prompt_id:   customPromptId,
          },
        })
        .select('id')
        .single()

      return res.status(402).json({
        ok:                false,
        status:            'awaiting_credits',
        analysis_id:       awaitingRow?.id ?? null,
        balance_available: balance,
        estimated_credits: ctx.estimated_credits,
        required_balance:  requiredBalance,
        missing_credits:   requiredBalance - balance,
      })
    }

    // 12. INSERT com status = processing
    const { data: inserted, error: insertErr } = await svc
      .from('dashboard_ai_analyses')
      .insert({
        company_id:        companyId,
        user_id:           user.id,
        analysis_type:     analysisType,
        funnel_id:         funnelId,
        period,
        context_version:   ctx.context_version,
        input_hash:        ctx.input_hash,
        input_summary:     ctx.input_summary,
        estimated_credits: ctx.estimated_credits,
        status:            'processing',
        started_at:        new Date().toISOString(),
        metadata:          {
          source:             'dashboard_ai_analysis',
          analysis_type:      analysisType,
          credits_to_charge:  ctx.estimated_credits,
          prompt_version:     PROMPT_VERSION,
          system_prompt_hash: ctx.system_prompt_hash,
          custom_prompt_used: !!customPromptText,
          custom_prompt_id:   customPromptId,
        },
      })
      .select('id')
      .single()

    if (insertErr || !inserted) {
      jsonError(res, 500, 'Erro ao iniciar análise'); return
    }

    const analysisId = inserted.id

    // 13–17. LLM + debit (empresa pai: skipDebit=true → sem débito)
    try {
      await executeLLMAndDebit(
        svc, analysisId, companyId,
        ctx.system_prompt, ctx.user_prompt,
        ctx.max_tokens, ctx.system_prompt_hash,
        !!customPromptText, customPromptId,
        isParentCompany,
      )
    } catch (execErr: any) {
      const msg = execErr?.message ?? String(execErr)
      if (msg.startsWith('credit_failed')) {
        return res.status(402).json({
          ok:          false,
          status:      'credit_failed',
          analysis_id: analysisId,
          message:     'Análise concluída mas débito falhou. Compre créditos e retome com { analysis_id }.',
        })
      }
      return res.status(500).json({ ok: false, error: msg, analysis_id: analysisId })
    }

    // 18. Retornar resultado
    const { data: result } = await svc
      .from('dashboard_ai_analyses')
      .select('id, analysis_type, status, output, credits_used, model, completed_at, created_at')
      .eq('id', analysisId)
      .single()

    return res.status(200).json({ ok: true, analysis_id: analysisId, data: result })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[dashboard/ai-analysis] Erro inesperado:', msg)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}

// ---------------------------------------------------------------------------
// handleResume — retomada para awaiting_credits e credit_failed
// Cooldown NÃO aplicado aqui (chamado antes do bloco de cooldown no handler).
// ---------------------------------------------------------------------------

async function handleResume(
  res: any,
  svc: any,
  user: any,
  analysisId: string,
): Promise<void> {
  // Buscar análise
  const { data: analysis, error: fetchErr } = await svc
    .from('dashboard_ai_analyses')
    .select('*')
    .eq('id', analysisId)
    .single()

  if (fetchErr || !analysis) { jsonError(res, 404, 'Análise não encontrada'); return }

  // Validar membership com o company_id DA ANÁLISE (não do body)
  const membership = await assertMembership(svc, user.id, analysis.company_id)
  if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

  if (!['awaiting_credits', 'credit_failed'].includes(analysis.status)) {
    return res.status(200).json({
      ok:          true,
      analysis_id: analysisId,
      status:      analysis.status,
      message:     `Análise não pode ser retomada com status "${analysis.status}"`,
    })
  }

  // Verificar se empresa pai — isenta de controle de créditos no resume
  const { data: resumeCompanyRow } = await svc
    .from('companies')
    .select('company_type')
    .eq('id', analysis.company_id)
    .maybeSingle()
  const isParentResume = resumeCompanyRow?.company_type === 'parent'

  // Verificar saldo — ignorado para empresa pai
  const balance = isParentResume ? Infinity : await getCompanyBalance(svc, analysis.company_id)

  // Para credit_failed: usar credits_used exato (ou credits_to_charge do metadata)
  // Para awaiting_credits: usar estimated_credits
  const creditsNeeded = analysis.status === 'credit_failed'
    ? (analysis.credits_used ?? analysis.metadata?.credits_to_charge ?? analysis.estimated_credits ?? 0)
    : (analysis.estimated_credits ?? 0)

  const requiredBalance = Math.ceil(creditsNeeded * MARGIN_FACTOR)

  if (!isParentResume && balance < requiredBalance) {
    return res.status(402).json({
      ok:                false,
      status:            analysis.status,
      analysis_id:       analysisId,
      balance_available: balance,
      estimated_credits: creditsNeeded,
      required_balance:  requiredBalance,
      missing_credits:   requiredBalance - balance,
    })
  }

  // ── credit_failed: reutiliza output salvo, NÃO chama LLM novamente ────────
  if (analysis.status === 'credit_failed') {
    // Empresa pai — sem débito: marca completed diretamente
    if (isParentResume) {
      await svc.from('dashboard_ai_analyses').update({
        status:       'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', analysisId)

      const { data: result } = await svc
        .from('dashboard_ai_analyses')
        .select('id, analysis_type, status, output, credits_used, model, completed_at, created_at')
        .eq('id', analysisId)
        .single()

      return res.status(200).json({ ok: true, analysis_id: analysisId, data: result })
    }

    // Débito com o valor exato original (idempotente via execution_log_id = analysisId)
    const creditsToDebit = analysis.credits_used
      ?? analysis.metadata?.credits_to_charge
      ?? creditsNeeded

    const { data: debitResult, error: debitError } = await svc.rpc('debit_credits_atomic', {
      p_company_id:       analysis.company_id,
      p_credits:          creditsToDebit,
      p_feature_type:     'insights',
      p_total_tokens:     analysis.metadata?.total_tokens ?? 0,
      p_model:            analysis.model ?? AI_MODEL,
      p_execution_log_id: analysisId, // idempotência: mesmo UUID já registrado
    })

    const debitOk = !debitError && (debitResult?.ok === true || debitResult?.idempotent === true)

    if (debitOk) {
      await svc.from('dashboard_ai_analyses').update({
        status:       'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', analysisId)

      const { data: result } = await svc
        .from('dashboard_ai_analyses')
        .select('id, analysis_type, status, output, credits_used, model, completed_at, created_at')
        .eq('id', analysisId)
        .single()

      return res.status(200).json({ ok: true, analysis_id: analysisId, data: result })
    }

    return res.status(402).json({
      ok:          false,
      status:      'credit_failed',
      analysis_id: analysisId,
      message:     'Débito ainda falhou. Verifique o saldo e tente novamente.',
    })
  }

  // ── awaiting_credits: reconstruir prompt do input_summary salvo → chama LLM ─
  await svc.from('dashboard_ai_analyses').update({
    status:     'processing',
    started_at: new Date().toISOString(),
  }).eq('id', analysisId)

  const { system_prompt, user_prompt, system_prompt_hash, max_tokens } = buildPromptsFromSummary(analysis.input_summary)

  // Recarregar prompt customizado (pode ter sido atualizado desde a análise original)
  const { data: customPromptRowResume } = await svc
    .from('dashboard_ai_prompts')
    .select('id, custom_prompt')
    .eq('company_id', analysis.company_id)
    .eq('analysis_type', analysis.analysis_type)
    .eq('is_active', true)
    .maybeSingle()

  const customTextResume = (customPromptRowResume as any)?.custom_prompt?.trim() || null
  const customIdResume   = (customPromptRowResume as any)?.id ?? null

  let finalSystemPrompt      = system_prompt
  let finalSystemPromptHash  = system_prompt_hash

  if (customTextResume) {
    finalSystemPrompt     = buildSystemPromptWithCustom(analysis.analysis_type, customTextResume)
    finalSystemPromptHash = generateFinalPromptHash(analysis.analysis_type, finalSystemPrompt)
  }

  try {
    await executeLLMAndDebit(
      svc, analysisId, analysis.company_id,
      finalSystemPrompt, user_prompt,
      max_tokens, finalSystemPromptHash,
      !!customTextResume, customIdResume,
      isParentResume,
    )
  } catch (execErr: any) {
    const msg = execErr?.message ?? String(execErr)
    if (msg.startsWith('credit_failed')) {
      return res.status(402).json({
        ok:          false,
        status:      'credit_failed',
        analysis_id: analysisId,
        message:     'Análise concluída mas débito falhou. Retome com { analysis_id }.',
      })
    }
    return res.status(500).json({ ok: false, error: msg, analysis_id: analysisId })
  }

  const { data: result } = await svc
    .from('dashboard_ai_analyses')
    .select('id, analysis_type, status, output, credits_used, model, completed_at, created_at')
    .eq('id', analysisId)
    .single()

  return res.status(200).json({ ok: true, analysis_id: analysisId, data: result })
}
