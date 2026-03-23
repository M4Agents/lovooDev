// =====================================================
// API: USER INPUT RESPONSE
// Data: 22/03/2026
// Objetivo: Endpoint para processar respostas de usuários em automações
// =====================================================

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }
  
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Use POST' })
    return
  }

  try {
    const { conversation_id, message_content, lead_id, company_id } = req.body

    if (!conversation_id || !message_content || !lead_id || !company_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'Parâmetros obrigatórios: conversation_id, message_content, lead_id, company_id' 
      })
    }

    console.log('🔍 Processando resposta de usuário:', { 
      conversation_id, 
      lead_id, 
      company_id,
      message: message_content.substring(0, 50) 
    })

    // Criar cliente Supabase com service role (bypass RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Buscar execuções pausadas para este lead
    const { data: pausedExecutions, error: fetchError } = await supabase
      .from('automation_executions')
      .select('*')
      .eq('company_id', company_id)
      .eq('lead_id', lead_id)
      .eq('status', 'paused')
      .order('paused_at', { ascending: false })
      .limit(1)

    if (fetchError) {
      console.error('❌ Erro ao buscar execuções pausadas:', fetchError)
      return res.status(500).json({ success: false, error: fetchError.message })
    }

    if (!pausedExecutions || pausedExecutions.length === 0) {
      console.log('ℹ️ Nenhuma execução pausada encontrada')
      return res.status(200).json({ 
        success: false, 
        message: 'Nenhuma execução pausada encontrada' 
      })
    }

    const execution = pausedExecutions[0]
    console.log('✅ Execução pausada encontrada:', execution.id)

    // Verificar se está aguardando input
    const awaitingInput = execution.variables?._awaiting_input
    if (!awaitingInput) {
      console.log('⚠️ Execução pausada mas não está aguardando input')
      return res.status(200).json({ 
        success: false, 
        message: 'Execução não está aguardando input' 
      })
    }

    const variableName = awaitingInput.variable_name

    // Salvar resposta do usuário na variável
    const updatedVariables = {
      ...execution.variables,
      [variableName]: message_content
    }
    delete updatedVariables._awaiting_input

    // Atualizar execução para running
    const { error: updateError } = await supabase
      .from('automation_executions')
      .update({
        status: 'running',
        variables: updatedVariables,
        paused_at: null
      })
      .eq('id', execution.id)

    if (updateError) {
      console.error('❌ Erro ao atualizar execução:', updateError)
      return res.status(500).json({ success: false, error: updateError.message })
    }

    console.log(`✅ Resposta salva: ${variableName} = "${message_content}"`)

    // Chamar função RPC para retomar execução (processamento assíncrono)
    const { error: resumeError } = await supabase.rpc('resume_automation_execution', {
      p_execution_id: execution.id,
      p_user_response: message_content
    })

    if (resumeError) {
      console.error('⚠️ Erro ao retomar execução (será processada em background):', resumeError)
      // Não retornar erro, pois a resposta já foi salva
    }

    return res.status(200).json({ 
      success: true, 
      execution_id: execution.id,
      variable: variableName,
      message: 'Resposta processada e execução retomada'
    })

  } catch (error) {
    console.error('❌ Erro ao processar resposta:', error)
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    })
  }
}
