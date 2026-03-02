// =====================================================
// PROCESSADOR DE MENSAGENS AGENDADAS - CRON JOB
// =====================================================
// Executado a cada minuto via Vercel Cron
// Processa mensagens pendentes e envia via UAZAPI

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  // DEBUG: Log completo para diagnóstico
  console.log('🔍 CRON DEBUG - Headers:', JSON.stringify(req.headers, null, 2))
  console.log('🔍 CRON DEBUG - CRON_SECRET exists:', !!process.env.CRON_SECRET)
  console.log('🔍 CRON DEBUG - CRON_SECRET length:', process.env.CRON_SECRET?.length)
  
  // Verificar se é chamada do cron do Vercel
  const authHeader = req.headers.authorization
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`
  
  console.log('🔍 CRON DEBUG - Auth header:', authHeader)
  console.log('🔍 CRON DEBUG - Expected:', expectedAuth)
  console.log('🔍 CRON DEBUG - Match:', authHeader === expectedAuth)
  
  if (authHeader !== expectedAuth) {
    console.error('❌ Unauthorized cron request')
    console.error('❌ Received:', authHeader)
    console.error('❌ Expected:', expectedAuth)
    return res.status(401).json({ error: 'Unauthorized' })
  }

  console.log('🔄 Starting scheduled messages processor...')
  
  try {
    // Buscar mensagens pendentes
    const { data: messages, error: fetchError } = await supabase
      .rpc('get_pending_scheduled_messages')

    if (fetchError) {
      console.error('❌ Error fetching pending messages:', fetchError)
      return res.status(500).json({ 
        success: false, 
        error: fetchError.message 
      })
    }

    if (!messages || messages.length === 0) {
      console.log('✅ No pending messages to process')
      return res.status(200).json({ 
        success: true, 
        processed: 0,
        message: 'No pending messages'
      })
    }

    console.log(`📨 Found ${messages.length} pending messages to process`)

    const results = {
      total: messages.length,
      sent: 0,
      failed: 0,
      recurring_created: 0,
      errors: []
    }

    // Processar cada mensagem
    for (const message of messages) {
      try {
        console.log(`📤 Processing message ${message.id}...`)

        // Enviar mensagem via UAZAPI
        const sendResult = await sendMessageViaUAZAPI(message)

        if (sendResult.success) {
          // Marcar como enviada
          await supabase.rpc('mark_scheduled_message_sent', {
            p_message_id: message.id,
            p_sent_message_id: sendResult.message_id || null
          })

          results.sent++
          console.log(`✅ Message ${message.id} sent successfully`)

          // Criar próxima ocorrência se for recorrente
          if (message.recurring_type && message.recurring_type !== 'none') {
            const { data: newMessageId } = await supabase.rpc('create_recurring_message', {
              p_original_message_id: message.id
            })

            if (newMessageId) {
              results.recurring_created++
              console.log(`🔁 Created recurring message ${newMessageId}`)
            }
          }
        } else {
          // Marcar como falha
          await supabase.rpc('mark_scheduled_message_failed', {
            p_message_id: message.id,
            p_error_message: sendResult.error || 'Unknown error'
          })

          results.failed++
          results.errors.push({
            message_id: message.id,
            error: sendResult.error
          })
          console.error(`❌ Failed to send message ${message.id}:`, sendResult.error)
        }
      } catch (error) {
        console.error(`❌ Error processing message ${message.id}:`, error)
        
        // Marcar como falha
        await supabase.rpc('mark_scheduled_message_failed', {
          p_message_id: message.id,
          p_error_message: error.message
        })

        results.failed++
        results.errors.push({
          message_id: message.id,
          error: error.message
        })
      }
    }

    console.log('✅ Processing completed:', results)

    return res.status(200).json({
      success: true,
      ...results
    })

  } catch (error) {
    console.error('❌ Fatal error in scheduled messages processor:', error)
    return res.status(500).json({
      success: false,
      error: error.message
    })
  }
}

// =====================================================
// FUNÇÃO: Enviar mensagem via UAZAPI
// =====================================================

async function sendMessageViaUAZAPI(message) {
  try {
    // Buscar credenciais da instância
    const { data: instance, error: instanceError } = await supabase
      .from('whatsapp_life_instances')
      .select('instance_name, token')
      .eq('id', message.instance_id)
      .single()

    if (instanceError || !instance) {
      return {
        success: false,
        error: 'Instance not found'
      }
    }

    // Preparar payload baseado no tipo de mensagem
    let payload = {
      number: message.contact_phone.replace(/\D/g, ''), // Apenas números
    }

    // Adicionar conteúdo baseado no tipo
    switch (message.message_type) {
      case 'text':
        payload.text = message.content
        break

      case 'image':
        payload.image = message.media_url
        payload.caption = message.content || ''
        break

      case 'video':
        payload.video = message.media_url
        payload.caption = message.content || ''
        break

      case 'audio':
        payload.audio = message.media_url
        break

      case 'document':
        payload.document = message.media_url
        payload.fileName = message.content || 'document'
        break

      default:
        return {
          success: false,
          error: `Unsupported message type: ${message.message_type}`
        }
    }

    // Determinar endpoint correto
    const endpoint = message.message_type === 'text' 
      ? 'send-text' 
      : `send-${message.message_type}`

    // Enviar via UAZAPI
    const response = await fetch(
      `https://api.uazapi.com/instances/${instance.instance_name}/messages/${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${instance.token}`
        },
        body: JSON.stringify(payload)
      }
    )

    const result = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: result.message || `HTTP ${response.status}`
      }
    }

    return {
      success: true,
      message_id: result.id || result.messageId
    }

  } catch (error) {
    return {
      success: false,
      error: error.message
    }
  }
}
