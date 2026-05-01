// =====================================================
// PROCESSADOR DE MENSAGENS AGENDADAS - CRON JOB
// =====================================================
// Executado a cada minuto via Vercel Cron
// Processa mensagens pendentes e envia via UAZAPI

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'

const supabase = getSupabaseAdmin()
const UAZAPI_BASE = 'https://lovoo.uazapi.com'

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
// FUNÇÃO: Normalizar telefone para formato brasileiro
// =====================================================

function cleanPhone(phone) {
  let clean = (phone || '').replace(/\D/g, '')
  if (!clean.startsWith('55') && clean.length <= 11) clean = '55' + clean
  return clean
}

// =====================================================
// FUNÇÃO: Enviar mensagem via UAZAPI
// =====================================================

async function sendMessageViaUAZAPI(message) {
  try {
    const { data: instance, error: instanceError } = await supabase
      .from('whatsapp_life_instances')
      .select('provider_token')
      .eq('id', message.instance_id)
      .single()

    if (instanceError || !instance?.provider_token) {
      return { success: false, error: 'Instance not found or missing provider_token' }
    }

    const isText   = message.message_type === 'text'
    const number   = cleanPhone(message.contact_phone)
    const endpoint = isText ? `${UAZAPI_BASE}/send/text` : `${UAZAPI_BASE}/send/media`
    const payload  = isText
      ? { number, text: message.content, delay: 1000 }
      : { number, type: message.message_type, file: message.media_url, text: message.content || '', delay: 1000 }

    if (!isText && !message.media_url) {
      return { success: false, error: `media_url ausente para tipo ${message.message_type}` }
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: instance.provider_token },
      body: JSON.stringify(payload),
    })

    const result = await response.json()

    if (!response.ok) {
      return { success: false, error: result.error || result.message || `HTTP ${response.status}` }
    }

    return {
      success: true,
      message_id: result.messageid || result.messageId || null,
    }

  } catch (error) {
    return { success: false, error: error.message }
  }
}
