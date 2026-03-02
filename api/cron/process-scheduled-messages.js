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
  console.log('🚀 DEPLOY TIMESTAMP: 2026-02-25 14:18 UTC - CORREÇÃO MÍDIA ATIVA')
  
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
          console.log('📝 Atualizando status para sent...')
          const { data: updateResult, error: updateError } = await supabase.rpc('mark_scheduled_message_sent', {
            p_message_id: message.id,
            p_sent_message_id: sendResult.message_id || null
          })

          if (updateError) {
            console.error('❌ Erro ao atualizar status para sent:', updateError)
            throw new Error(`Failed to update status: ${updateError.message}`)
          }

          console.log('✅ Status atualizado para sent com sucesso')

          // Verificar duplicação antes de criar
          console.log('🔍 Verificando duplicação...')
          const { data: existing } = await supabase
            .from('chat_messages')
            .select('id')
            .eq('conversation_id', message.conversation_id)
            .eq('content', message.content)
            .eq('direction', 'outbound')
            .gte('created_at', new Date(Date.now() - 10000).toISOString())
            .limit(1)

          if (existing && existing.length > 0) {
            console.log('⚠️ Mensagem já existe, pulando criação')
          } else {
            console.log('💬 Criando mensagem no chat...')
            const { data: chatMessage, error: chatError } = await supabase.rpc('chat_create_message', {
            p_conversation_id: message.conversation_id,
            p_company_id: message.company_id,
            p_content: message.content,
            p_message_type: message.message_type,
            p_direction: 'outbound',
            p_sent_by: message.created_by,
            p_media_url: message.media_url || null
          })

          if (chatError) {
            console.error('❌ Erro ao criar mensagem no chat:', chatError)
            // Não lançar exceção - mensagem foi enviada com sucesso
          } else if (chatMessage?.success) {
            console.log('✅ Mensagem criada no chat:', chatMessage.message_id)
            
            // Atualizar status para 'sent' já que a mensagem foi enviada
            console.log('🔄 Atualizando status da mensagem para sent...')
            const { error: updateStatusError } = await supabase
              .from('chat_messages')
              .update({ 
                status: 'sent',
                updated_at: new Date().toISOString()
              })
              .eq('id', chatMessage.message_id)
              .eq('company_id', message.company_id)

            if (updateStatusError) {
              console.error('❌ Erro ao atualizar status da mensagem:', updateStatusError)
            } else {
              console.log('✅ Status da mensagem atualizado para sent')
            }
          } else {
            console.error('❌ Falha ao criar mensagem no chat:', chatMessage)
          }
          }

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
          console.log('📝 Marcando mensagem como failed...')
          const { error: failError } = await supabase.rpc('mark_scheduled_message_failed', {
            p_message_id: message.id,
            p_error_message: sendResult.error || 'Unknown error'
          })

          if (failError) {
            console.error('❌ Erro ao marcar como failed:', failError)
          } else {
            console.log('✅ Status atualizado para failed')
          }

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
        console.log('📝 Marcando mensagem como failed (exception)...')
        const { error: failError } = await supabase.rpc('mark_scheduled_message_failed', {
          p_message_id: message.id,
          p_error_message: error.message
        })

        if (failError) {
          console.error('❌ Erro ao marcar como failed:', failError)
        } else {
          console.log('✅ Status atualizado para failed')
        }

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
      .select('provider_instance_id, provider_token')
      .eq('id', message.instance_id)
      .single()

    if (instanceError || !instance) {
      console.error('❌ Instance query error:', instanceError)
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
        payload.delay = 1000           // ALINHADO COM CHAT
        payload.linkPreview = true     // ALINHADO COM CHAT
        break

      case 'image':
        payload.type = 'image'
        payload.file = message.media_url
        payload.text = message.content || ''
        payload.delay = 1000
        break

      case 'video':
        payload.type = 'video'
        payload.file = message.media_url
        payload.text = message.content || ''
        payload.delay = 1000
        break

      case 'audio':
        payload.type = 'audio'
        payload.file = message.media_url
        payload.text = message.content || ''
        payload.delay = 1000
        break

      case 'document':
        payload.type = 'document'
        payload.file = message.media_url
        payload.text = message.content || 'document'
        payload.delay = 1000
        // Adicionar nome do documento
        if (message.media_url) {
          const fileName = message.media_url.split('/').pop()
          payload.docName = fileName
        }
        break

      default:
        return {
          success: false,
          error: `Unsupported message type: ${message.message_type}`
        }
    }

    // 🔍 DEBUG: Logs detalhados para diagnóstico em produção
    console.log('🔍 DEBUG PAYLOAD - message_type:', message.message_type)
    console.log('🔍 DEBUG PAYLOAD - payload:', JSON.stringify(payload, null, 2))
    console.log('🔍 DEBUG PAYLOAD - media_url:', message.media_url)

    // Determinar endpoint correto (ALINHADO COM CHAT)
    const endpoint = message.message_type === 'text' 
      ? 'https://lovoo.uazapi.com/send/text'
      : 'https://lovoo.uazapi.com/send/media'

    console.log('🔍 DEBUG PAYLOAD - endpoint:', endpoint)
    console.log('📤 UAZAPI Endpoint:', endpoint)

    // Enviar via UAZAPI
    const response = await fetch(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'token': instance.provider_token  // ALINHADO COM CHAT
        },
        body: JSON.stringify(payload)
      }
    )

    // TRATAMENTO ROBUSTO DE RESPOSTA (ALINHADO COM CHAT)
    console.log('📥 UAZAPI Response Status:', response.status)
    console.log('📥 UAZAPI Response Headers:', Object.fromEntries(response.headers.entries()))
    
    const responseText = await response.text()
    console.log('📥 UAZAPI Response Body:', responseText)

    // Tentar parsear JSON com fallback
    let result
    try {
      result = JSON.parse(responseText)
      console.log('✅ JSON parseado com sucesso:', result)
    } catch (parseError) {
      console.error('❌ Resposta não é JSON válido:', responseText.substring(0, 200))
      return {
        success: false,
        error: `UAZAPI retornou resposta inválida: ${responseText.substring(0, 100)}`
      }
    }

    if (!response.ok) {
      console.error('❌ UAZAPI erro HTTP:', response.status)
      return {
        success: false,
        error: result.message || `HTTP ${response.status}: ${responseText}`
      }
    }

    console.log('✅ Mensagem enviada com sucesso via UAZAPI')
    return {
      success: true,
      message_id: result.messageid || result.id || result.messageId
    }

  } catch (error) {
    console.error('💥 Erro inesperado no envio UAZAPI:', error)
    return {
      success: false,
      error: error.message
    }
  }
}
