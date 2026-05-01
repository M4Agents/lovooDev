// =====================================================
// PROCESSADOR DE MENSAGENS AGENDADAS - CRON JOB
// =====================================================
// Executado a cada minuto via Vercel Cron
// Processa mensagens pendentes e envia via UAZAPI

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'

const supabase = getSupabaseAdmin()
const UAZAPI_BASE = 'https://lovoo.uazapi.com'

export default async function handler(req, res) {
  // #region agent log
  const runId = Math.random().toString(36).slice(2, 8)
  console.log(`[CRON-SCHED][${runId}] ▶ Invocation started at ${new Date().toISOString()}`)
  fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'254195'},body:JSON.stringify({sessionId:'254195',location:'process-scheduled-messages.js:handler-entry',message:'Cron invocation started',data:{runId,ts:new Date().toISOString()},timestamp:Date.now(),hypothesisId:'H-A'})}).catch(()=>{})
  // #endregion

  // Verificar se é chamada do cron do Vercel
  const authHeader = req.headers.authorization
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`
  
  if (authHeader !== expectedAuth) {
    console.error(`[CRON-SCHED][${runId}] ❌ Unauthorized`)
    return res.status(401).json({ error: 'Unauthorized' })
  }

  console.log('🔄 Starting scheduled messages processor...')
  
  try {
    // Buscar mensagens pendentes
    const { data: messages, error: fetchError } = await supabase
      .rpc('get_pending_scheduled_messages')

    // #region agent log
    console.log(`[CRON-SCHED][${runId}] RPC result: count=${messages?.length ?? 0} error=${fetchError?.message ?? 'none'} ids=${JSON.stringify(messages?.map(m => m.id))}`)
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'254195'},body:JSON.stringify({sessionId:'254195',location:'process-scheduled-messages.js:after-rpc',message:'get_pending_scheduled_messages result',data:{runId,count:messages?.length??0,ids:messages?.map(m=>m.id),error:fetchError?.message??null},timestamp:Date.now(),hypothesisId:'H-A'})}).catch(()=>{})
    // #endregion

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
          const { error: markError } = await supabase.rpc('mark_scheduled_message_sent', {
            p_message_id: message.id,
            p_sent_message_id: sendResult.message_id || null
          })

          // #region agent log
          console.log(`[CRON-SCHED][${runId}] mark_sent: messageId=${message.id} uazapiId=${sendResult.message_id} markError=${markError?.message ?? 'none'} markCode=${markError?.code ?? 'none'}`)
          fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'254195'},body:JSON.stringify({sessionId:'254195',location:'process-scheduled-messages.js:mark-sent',message:'mark_scheduled_message_sent result',data:{runId,messageId:message.id,uazapiMessageId:sendResult.message_id,markError:markError?.message??null,markCode:markError?.code??null},timestamp:Date.now(),hypothesisId:'H-D'})}).catch(()=>{})
          // #endregion

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

    // #region agent log
    console.log(`[CRON-SCHED] Uazapi response: status=${response.status} ok=${response.ok} messageid=${result?.messageid ?? result?.messageId ?? 'none'} keys=${JSON.stringify(Object.keys(result ?? {}))}`)
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'254195'},body:JSON.stringify({sessionId:'254195',location:'process-scheduled-messages.js:uazapi-response',message:'Uazapi send response',data:{status:response.status,ok:response.ok,messageid:result?.messageid??result?.messageId??null,resultKeys:Object.keys(result??{})},timestamp:Date.now(),hypothesisId:'H-B'})}).catch(()=>{})
    // #endregion

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
