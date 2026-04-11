// =====================================================
// API: USER INPUT RESPONSE
// Data: 22/03/2026
// Objetivo: Endpoint para processar respostas de usuários em automações
// =====================================================

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  // Validar segredo interno — rejeitar antes de qualquer processamento
  const internalSecret = process.env.INTERNAL_SECRET
  const receivedSecret = req.headers['x-internal-secret']
  if (!internalSecret || receivedSecret !== internalSecret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Use POST' })
    return
  }

  try {
    // Aceitar apenas conversation_id e message_content do body
    const { conversation_id, message_content } = req.body

    if (!conversation_id || !message_content) {
      return res.status(400).json({ 
        success: false, 
        error: 'Parâmetros obrigatórios: conversation_id, message_content' 
      })
    }

    // Validar formato UUID antes de qualquer query
    if (!UUID_REGEX.test(conversation_id)) {
      return res.status(400).json({ success: false, error: 'conversation_id inválido' })
    }

    // Criar cliente Supabase com service role (bypass RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Derivar company_id e lead_id da conversa — não confiar no body
    const { data: conversation, error: convError } = await supabase
      .from('chat_conversations')
      .select('company_id, lead_id')
      .eq('id', conversation_id)
      .single()

    if (convError || !conversation) {
      console.error('❌ Conversa não encontrada:', conversation_id)
      return res.status(400).json({ success: false, error: 'Conversa não encontrada' })
    }

    const { company_id, lead_id } = conversation

    if (!company_id || !lead_id) {
      console.error('❌ Conversa sem company_id ou lead_id:', conversation_id)
      return res.status(400).json({ success: false, error: 'Conversa inválida' })
    }

    console.log('🔍 Processando resposta de usuário:', { 
      conversation_id, 
      lead_id, 
      company_id,
      message: message_content.substring(0, 50) 
    })

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
      return res.status(500).json({ success: false, error: 'Erro interno' })
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
      return res.status(500).json({ success: false, error: 'Erro interno' })
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
    return res.status(500).json({ success: false, error: 'Erro interno' })
  }
}
