import { createClient } from '@supabase/supabase-js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Validar segredo interno — rejeitar antes de qualquer processamento
  const internalSecret = process.env.INTERNAL_SECRET;
  const receivedSecret = req.headers['x-internal-secret'];
  if (!internalSecret || receivedSecret !== internalSecret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Método não permitido. Use POST.' });
    return;
  }

  try {
    const { execution_id, user_response } = req.body;

    if (!execution_id || !user_response) {
      res.status(400).json({ 
        success: false, 
        error: 'execution_id e user_response são obrigatórios' 
      });
      return;
    }

    // Validar formato UUID antes de qualquer query
    if (!UUID_REGEX.test(execution_id)) {
      return res.status(400).json({ success: false, error: 'execution_id inválido' });
    }

    // Cliente com service_role — permite chamar RPCs após revogação do grant anon (T8)
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    console.log('🔄 ENDPOINT: Retomando execução:', execution_id);
    console.log('📝 ENDPOINT: Resposta do usuário:', user_response);
    
    // Chamar RPC para buscar execução e próximos nós (bypass RLS)
    const { data: executionData, error: rpcError } = await supabase
      .rpc('continue_automation_execution', {
        p_execution_id: execution_id,
        p_user_response: user_response
      });
    
    if (rpcError || !executionData?.success) {
      console.error('❌ Erro na RPC:', rpcError || executionData);
      res.status(500).json({ success: false, error: 'Erro ao buscar execução' });
      return;
    }
    
    console.log('✅ RPC executada com sucesso:', executionData);
    
    // Se não há próximos nós, retornar sucesso
    if (!executionData.next_nodes || executionData.next_nodes.length === 0) {
      console.log('✅ Não há próximos nós - Execução finalizada');
      res.status(200).json({ 
        success: true,
        message: 'Execução finalizada - sem próximos nós',
        execution_id
      });
      return;
    }
    
    const currentVariables = executionData.variables || {};
    const conversationId = executionData.conversation_id;
    const companyId = executionData.company_id;
    const flowId = executionData.flow_id;
    const flowNodes = executionData.flow_nodes || [];
    const flowEdges = executionData.flow_edges || [];
    
    // Função local para buscar próximos nós (sem query ao banco)
    function getNextNodesLocal(currentNodeId) {
      const nextEdges = flowEdges.filter(e => e.source === currentNodeId);
      const nextNodes = nextEdges
        .map(edge => flowNodes.find(n => n.id === edge.target))
        .filter(Boolean)
        .sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0));
      
      return nextNodes;
    }
    
    // Loop recursivo para processar todos os nós até o fim
    let currentNodeId = executionData.current_node_id;
    let hasMoreNodes = true;
    let nodesProcessed = 0;
    const maxNodes = 50; // Limite de segurança para evitar loops infinitos
    
    while (hasMoreNodes && nodesProcessed < maxNodes) {
      // Buscar próximos nós conectados ao nó atual (função local)
      const nextNodes = getNextNodesLocal(currentNodeId);
      
      console.log('📊 Próximos nós encontrados:', nextNodes.length, 'a partir de:', currentNodeId);
      
      if (nextNodes.length === 0) {
        console.log('✅ Não há mais nós - Finalizando execução');
        hasMoreNodes = false;
        break;
      }
      
      // Processar cada próximo nó
      for (const nextNode of nextNodes) {
        nodesProcessed++;
      const nodeData = nextNode.data || {};
      const nodeConfig = nodeData.config || {};
      const messageType = nodeConfig.messageType;
      
      console.log('📦 Processando nó:', nextNode.id, 'tipo:', messageType);
      
        // Processar DELAY
        if (messageType === 'delay') {
          const delaySeconds = nodeConfig.duration || 5;
          const delayUnit = nodeConfig.unit || 'seconds';
          const delayMs = delayUnit === 'seconds' ? delaySeconds * 1000 : delaySeconds * 60000;
          
          console.log(`⏱️ Delay de ${delaySeconds} ${delayUnit} - Aguardando...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          
          // Atualizar current_node_id e continuar para próximos nós
          currentNodeId = nextNode.id;
          console.log('✅ Delay processado, próximo nó:', currentNodeId);
          break; // Sair do for e buscar próximos nós no while
        }
      
        // Processar USER_INPUT (já foi processado, pular)
        if (messageType === 'user_input') {
          console.log('ℹ️ User input já processado, pulando...');
          currentNodeId = nextNode.id;
          break;
        }
      
        // Processar mensagens de texto
        if (messageType === 'text') {
        const messageContent = nodeConfig.message || '';
        
        // Substituir variáveis no conteúdo
        let processedContent = messageContent;
        Object.keys(currentVariables).forEach(key => {
          const placeholder = `{{${key}}}`;
          processedContent = processedContent.replace(new RegExp(placeholder, 'g'), currentVariables[key] || '');
        });
        
          console.log('💬 Enviando mensagem texto:', processedContent.substring(0, 50) + '...');
        
          // Criar mensagem no banco
          const { data: messageData, error: messageError } = await supabase
            .rpc('chat_create_message', {
              p_conversation_id: conversationId,
              p_company_id: companyId,
              p_content: processedContent,
              p_message_type: 'text',
              p_direction: 'outbound',
              p_sent_by: null,
              p_media_url: null
            });
        
          if (messageError || !messageData?.success) {
            console.error('❌ Erro ao criar mensagem:', messageError || messageData);
            currentNodeId = nextNode.id;
            break;
          }
          
          console.log('✅ Mensagem criada:', messageData.message_id);
        
          // Enviar via Uazapi
          if (messageData.message_id) {
            try {
              const sendResponse = await fetch('https://loovocrm.vercel.app/api/uazapi-send-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  message_id: messageData.message_id,
                  company_id: companyId
                })
              });
              
              if (sendResponse.ok) {
                console.log('✅ Mensagem enviada via Uazapi');
              } else {
                console.error('❌ Erro ao enviar via Uazapi:', sendResponse.status);
              }
            } catch (sendError) {
              console.error('❌ Exception ao enviar via Uazapi:', sendError);
            }
          }
          
          // Atualizar current_node_id e continuar
          currentNodeId = nextNode.id;
          console.log('✅ Mensagem texto processada, próximo nó:', currentNodeId);
          break;
        }
      
        // Processar mensagens de arquivo (imagem, vídeo, documento)
        if (messageType === 'file') {
          const fileUrl = nodeConfig.fileUrl || '';
          const fileType = nodeConfig.fileType || 'document';
          const caption = nodeConfig.caption || '';
          
          console.log('📎 Enviando arquivo:', fileType, fileUrl.substring(0, 50) + '...');
        
          // Criar mensagem no banco
          const { data: messageData, error: messageError } = await supabase
            .rpc('chat_create_message', {
              p_conversation_id: conversationId,
              p_company_id: companyId,
              p_content: caption,
              p_message_type: fileType,
              p_direction: 'outbound',
              p_sent_by: null,
              p_media_url: fileUrl
            });
        
          if (messageError || !messageData?.success) {
            console.error('❌ Erro ao criar mensagem de arquivo:', messageError || messageData);
            currentNodeId = nextNode.id;
            break;
          }
          
          console.log('✅ Mensagem de arquivo criada:', messageData.message_id);
        
          // Enviar via Uazapi
          if (messageData.message_id) {
            try {
              const sendResponse = await fetch('https://loovocrm.vercel.app/api/uazapi-send-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  message_id: messageData.message_id,
                  company_id: companyId
                })
              });
              
              if (sendResponse.ok) {
                console.log('✅ Arquivo enviado via Uazapi');
              } else {
                console.error('❌ Erro ao enviar arquivo via Uazapi:', sendResponse.status);
              }
            } catch (sendError) {
              console.error('❌ Exception ao enviar arquivo via Uazapi:', sendError);
            }
          }
          
          // Atualizar current_node_id e continuar
          currentNodeId = nextNode.id;
          console.log('✅ Arquivo processado, próximo nó:', currentNodeId);
          break;
        }
      
        // Processar mensagens de áudio
        if (messageType === 'audio') {
          const audioUrl = nodeConfig.audioUrl || '';
          
          console.log('🎤 Enviando áudio:', audioUrl.substring(0, 50) + '...');
        
          // Criar mensagem no banco
          const { data: messageData, error: messageError } = await supabase
            .rpc('chat_create_message', {
              p_conversation_id: conversationId,
              p_company_id: companyId,
              p_content: '',
              p_message_type: 'audio',
              p_direction: 'outbound',
              p_sent_by: null,
              p_media_url: audioUrl
            });
        
          if (messageError || !messageData?.success) {
            console.error('❌ Erro ao criar mensagem de áudio:', messageError || messageData);
            currentNodeId = nextNode.id;
            break;
          }
          
          console.log('✅ Mensagem de áudio criada:', messageData.message_id);
        
          // Enviar via Uazapi
          if (messageData.message_id) {
            try {
              const sendResponse = await fetch('https://loovocrm.vercel.app/api/uazapi-send-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  message_id: messageData.message_id,
                  company_id: companyId
                })
              });
              
              if (sendResponse.ok) {
                console.log('✅ Áudio enviado via Uazapi');
              } else {
                console.error('❌ Erro ao enviar áudio via Uazapi:', sendResponse.status);
              }
            } catch (sendError) {
              console.error('❌ Exception ao enviar áudio via Uazapi:', sendError);
            }
          }
          
          // Atualizar current_node_id e continuar
          currentNodeId = nextNode.id;
          console.log('✅ Áudio processado, próximo nó:', currentNodeId);
          break;
        }
      }
    }
    
    console.log('📊 Total de nós processados:', nodesProcessed);
    
    // Marcar execução como completa
    await supabase
      .from('automation_executions')
      .update({ 
        status: 'completed',
        completed_at: new Date().toISOString(),
        current_node_id: currentNodeId
      })
      .eq('id', execution_id);
    
    console.log('✅ ENDPOINT: Execução retomada e processada com sucesso');
    
    res.status(200).json({ 
      success: true,
      message: 'Execução retomada com sucesso',
      execution_id,
      nodes_processed: nodesProcessed
    });
    
  } catch (error) {
    console.error('❌ ENDPOINT: Erro ao retomar execução:', error);
    res.status(500).json({ success: false, error: 'Erro ao retomar execução' });
  }
}
