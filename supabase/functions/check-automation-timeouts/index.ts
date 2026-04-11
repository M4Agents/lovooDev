import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  // Validar segredo da função
  const expectedSecret = Deno.env.get('TIMEOUT_FUNCTION_SECRET')
  const authHeader = req.headers.get('Authorization')
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('🔍 Verificando execuções com timeout expirado...')

    // Buscar execuções pausadas com timeout expirado
    const { data: expiredExecutions, error } = await supabase
      .from('automation_executions')
      .select('id, flow_id, lead_id, timeout_at, variables')
      .eq('status', 'paused')
      .not('timeout_at', 'is', null)
      .lt('timeout_at', new Date().toISOString())

    if (error) {
      console.error('❌ Erro ao buscar execuções:', error)
      throw error
    }

    console.log(`📊 Encontradas ${expiredExecutions?.length || 0} execuções expiradas`)

    if (!expiredExecutions || expiredExecutions.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, errors: 0 }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Cancelar execuções expiradas
    const { error: updateError } = await supabase
      .from('automation_executions')
      .update({
        status: 'failed',
        error_message: 'Timeout - usuário não respondeu dentro do prazo',
        completed_at: new Date().toISOString()
      })
      .in('id', expiredExecutions.map(e => e.id))

    if (updateError) {
      console.error('❌ Erro ao cancelar execuções:', updateError)
      throw updateError
    }

    console.log(`✅ ${expiredExecutions.length} execuções canceladas por timeout`)

    return new Response(
      JSON.stringify({ processed: expiredExecutions.length, errors: 0 }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('❌ Erro ao verificar timeouts:', error)
    return new Response(
      JSON.stringify({ processed: 0, errors: 1 }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
