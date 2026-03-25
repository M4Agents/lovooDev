import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
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
        JSON.stringify({ 
          success: true, 
          message: 'Nenhuma execução expirada',
          count: 0 
        }),
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
      JSON.stringify({ 
        success: true, 
        message: `${expiredExecutions.length} execuções canceladas`,
        count: expiredExecutions.length,
        executions: expiredExecutions.map(e => ({
          id: e.id,
          flow_id: e.flow_id,
          lead_id: e.lead_id,
          timeout_at: e.timeout_at
        }))
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('❌ Erro ao verificar timeouts:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
