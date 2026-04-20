// =====================================================
// API: MEDIA MANAGEMENT - FILES UPLOAD - CACHE BYPASS FINAL
// =====================================================
// Solução definitiva para cache persistente do Vercel
// Baseado nas memórias de soluções bem-sucedidas anteriores

import formidable from 'formidable'
import { uploadToTemporal } from '../../../services/aws/s3Storage.js'
import { createClient } from '@supabase/supabase-js'
import AWS from 'aws-sdk'
import { assertStorageLimit, PlanEnforcementError } from '../../../lib/plans/limitChecker.js'

// =====================================================
// CONFIGURAÇÃO SUPABASE
// =====================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase configuration missing')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// =====================================================
// CONFIGURAÇÃO AWS S3
// =====================================================

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'sa-east-1'
})

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'aws-lovoocrm-media'

// =====================================================
// HELPER: UPLOAD PARA ESTRUTURA TEMPORAL
// =====================================================

const uploadToTemporal = async (file, companyId) => {
  try {
    console.log('📤 Upload para estrutura temporal:', file.originalFilename)
    
    const currentDate = new Date()
    const year = currentDate.getFullYear()
    const month = String(currentDate.getMonth() + 1).padStart(2, '0')
    const day = String(currentDate.getDate()).padStart(2, '0')
    
    const fileName = file.originalFilename || 'arquivo.jpg'
    const s3Key = `biblioteca/companies/${companyId}/${year}/${month}/${day}/${fileName}`
    
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: require('fs').createReadStream(file.filepath),
      ContentType: file.mimetype || 'application/octet-stream'
    }
    
    const result = await s3.upload(uploadParams).promise()
    
    console.log('✅ Upload temporal concluído:', s3Key)
    
    return {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      company_id: companyId,
      s3_key: s3Key,
      file_name: fileName,
      file_size: file.size,
      mime_type: file.mimetype,
      preview_url: result.Location,
      created_at: new Date().toISOString()
    }
    
  } catch (error) {
    console.error('❌ Erro no upload temporal:', error)
    throw error
  }
}

// =====================================================
// HANDLER PRINCIPAL - CACHE BYPASS FINAL
// =====================================================

export default async function handler(req, res) {
  // Log super agressivo com timestamp dinâmico para forçar reconhecimento
  const timestamp = new Date().toISOString()
  const randomId = Math.random().toString(36).substr(2, 9)
  
  console.log('🔥🔥🔥 CACHE BYPASS TOTAL - UPLOAD FINAL 🔥🔥🔥')
  console.log(`⚡ TIMESTAMP DINÂMICO: ${timestamp}`)
  console.log(`🎲 ID ÚNICO: ${randomId}`)
  console.log('✅ API CORRIGIDA - UPSERT COM .select() + VALIDAÇÃO FOLDER_ID')
  console.log('🔧 CORREÇÃO: Adicionado .select() ao UPSERT para retornar dados')
  console.log('🔧 CORREÇÃO: Validação rigorosa de folder_id pós-salvamento')
  console.log('🚀 SOLUÇÃO BASEADA NAS MEMÓRIAS DE SUCESSO ANTERIORES')
  
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Apenas POST é permitido'
    })
  }

  try {
    // Parse do formulário multipart
    const form = formidable({
      maxFileSize: 100 * 1024 * 1024, // 100MB
      keepExtensions: true,
    })

    const [fields, files] = await form.parse(req)
    
    const companyId = Array.isArray(fields.company_id) ? fields.company_id[0] : fields.company_id
    const folderId = Array.isArray(fields.folder_id) ? fields.folder_id[0] : fields.folder_id
    const organizeToFolder = Array.isArray(fields.organize_to_folder) ? fields.organize_to_folder[0] : fields.organize_to_folder
    
    if (!companyId) {
      return res.status(400).json({
        error: 'Company ID obrigatório',
        message: 'Parâmetro company_id é necessário'
      })
    }

    console.log('📤 Upload solicitado:', { 
      company_id: companyId, 
      folder_id: folderId,
      organize_to_folder: organizeToFolder,
      files_count: Object.keys(files).length,
      timestamp: timestamp,
      random_id: randomId
    })

    // Verificar se há arquivo
    const fileKeys = Object.keys(files)
    if (fileKeys.length === 0) {
      return res.status(400).json({
        error: 'Nenhum arquivo enviado',
        message: 'É necessário enviar pelo menos um arquivo'
      })
    }

    // Pegar primeiro arquivo
    const file = Array.isArray(files[fileKeys[0]]) ? files[fileKeys[0]][0] : files[fileKeys[0]]

    // Verificar limite de storage antes do upload
    try {
      await assertStorageLimit(supabase, companyId, file.size || 0)
    } catch (err) {
      if (err.isPlanError) {
        return res.status(err.httpStatus).json(err.data)
      }
      throw err
    }

    // Upload para estrutura temporal
    let uploadResult = await uploadToTemporal(file, companyId)
    
    // Se solicitado organização E há folder_id, salvar nos metadados (organização virtual)
    if (organizeToFolder === 'true' && folderId) {
      console.log('🔄 Organização virtual: salvando folder_id nos metadados')
      console.log(`⚡ PROCESSANDO COM TIMESTAMP: ${timestamp}`)
      
      // Determinar nome da pasta para logs
      let folderName = 'marketing' // padrão
      if (folderId.toLowerCase().includes('marketing') || folderId.includes('fe701f27-b4b0-4a97-b66a-0c0c2534fcec')) {
        folderName = 'marketing'
      } else if (folderId.toLowerCase().includes('chat')) {
        folderName = 'chat'
      } else if (folderId.toLowerCase().includes('teste')) {
        folderName = 'teste'
      }
      
      console.log('📂 Organização virtual para pasta:', folderName)
      
      // Persistência real no banco usando Supabase Client
      console.log('💾 Salvando folder_id no banco via Supabase Client')
      console.log('🔗 Conectando com projeto M4_digital')
      console.log(`🎲 ID da operação: ${randomId}`)
      
      try {
        // Determinar tipo de arquivo
        const fileType = uploadResult.mime_type?.startsWith('image/') ? 'image' : 
                        uploadResult.mime_type?.startsWith('video/') ? 'video' :
                        uploadResult.mime_type?.startsWith('audio/') ? 'audio' : 'document'
        
        console.log('🔄 Executando UPSERT na tabela lead_media_unified...')
        console.log('📊 Dados: arquivo_id =', uploadResult.id, ', folder_id =', folderId)
        console.log('🔧 DEBUG - Projeto M4_digital, usando UPSERT para evitar conflitos')
        console.log(`⚡ TIMESTAMP OPERAÇÃO: ${timestamp}`)
        
        // DEBUG: Verificar dados antes do UPSERT
        console.log('🔧 DEBUG UPSERT - Dados que serão enviados:')
        console.log('📊 ID:', uploadResult.id)
        console.log('🏢 Company ID:', companyId)
        console.log('📁 Folder ID:', folderId)
        console.log('📄 Filename:', uploadResult.file_name)
        console.log(`🎲 Random ID: ${randomId}`)
        
        // UPSERT registro na tabela lead_media_unified com folder_id
        const upsertData = {
          id: uploadResult.id,
          company_id: companyId,
          s3_key: uploadResult.s3_key,
          original_filename: uploadResult.file_name,
          file_type: fileType,
          mime_type: uploadResult.mime_type,
          file_size: uploadResult.file_size,
          preview_url: uploadResult.preview_url,
          received_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          folder_id: folderId
        }
        
        console.log('🔧 DEBUG UPSERT - Objeto completo:', JSON.stringify(upsertData, null, 2))
        console.log(`⚡ EXECUTANDO UPSERT COM TIMESTAMP: ${timestamp}`)
        
        // CORREÇÃO CRÍTICA: UPSERT COM .select() PARA RETORNAR DADOS
        const { data, error } = await supabase
          .from('lead_media_unified')
          .upsert(upsertData, {
            onConflict: 'id'
          })
          .select()  // 🔥 CORREÇÃO CRÍTICA - RETORNA DADOS
        
        if (error) {
          console.error('❌ Erro ao inserir no banco:', error)
          console.error('📋 Detalhes do erro:', error.message)
          console.error(`⚡ ERRO NO TIMESTAMP: ${timestamp}`)
          return res.status(500).json({
            success: false,
            error: 'Database error',
            message: 'Erro ao salvar metadados no banco',
            details: error.message,
            timestamp: timestamp,
            random_id: randomId
          })
        }
        
        console.log('✅ UPSERT executado com sucesso!')
        console.log('📊 Registro na tabela lead_media_unified:', data)
        console.log('🔧 DEBUG UPSERT - Resposta do Supabase:', JSON.stringify(data, null, 2))
        console.log(`⚡ SUCESSO NO TIMESTAMP: ${timestamp}`)
        
        // VALIDAÇÃO RIGOROSA: Verificar se folder_id foi realmente salvo
        if (data && data.length > 0 && data[0].folder_id) {
          console.log('✅ CONFIRMADO - folder_id salvo:', data[0].folder_id)
          console.log(`🎉 SUCESSO TOTAL - TIMESTAMP: ${timestamp}`)
        } else {
          console.error('❌ CRÍTICO - folder_id não foi salvo ou está null')
          console.error('🔧 DEBUG - Dados retornados:', data)
          console.error('🔧 DEBUG - folder_id esperado:', folderId)
          console.error(`⚡ FALHA NO TIMESTAMP: ${timestamp}`)
          
          // Falhar o upload se folder_id não foi salvo
          return res.status(500).json({
            success: false,
            error: 'Folder ID persistence failed',
            message: 'folder_id não foi salvo no banco de dados',
            debug: {
              expected_folder_id: folderId,
              actual_data: data,
              timestamp: timestamp,
              random_id: randomId
            }
          })
        }
        
      } catch (dbError) {
        console.error('❌ Erro na persistência:', dbError)
        console.error(`⚡ ERRO DB NO TIMESTAMP: ${timestamp}`)
        return res.status(500).json({
          success: false,
          error: 'Database connection error',
          message: 'Erro na conexão com banco de dados',
          timestamp: timestamp,
          random_id: randomId
        })
      }
      
      // Preparar metadados virtuais para resposta
      const virtualMetadata = {
        folder_path: `/${folderName}`,
        file_type: uploadResult.mime_type?.startsWith('image/') ? 'image' : 
                  uploadResult.mime_type?.startsWith('video/') ? 'video' :
                  uploadResult.mime_type?.startsWith('audio/') ? 'audio' : 'document',
        tags: [`pasta:${folderName}`],
        description: `Arquivo organizado virtualmente na pasta ${folderName}`,
        organization_method: 'database_persistence',
        timestamp: timestamp,
        random_id: randomId
      }
      
      console.log('📊 Metadados virtuais preparados:', virtualMetadata)
      console.log('✅ Organização virtual + persistência real no banco configurada')
      console.log('💾 folder_id persistido na tabela lead_media_unified via Supabase Client')
      console.log(`🎉 OPERAÇÃO COMPLETA - TIMESTAMP: ${timestamp}`)
      
      // Atualizar resultado com organização virtual
      uploadResult = {
        ...uploadResult,
        folder_id: folderId,
        folder_name: folderName,
        organized_at: new Date().toISOString(),
        organization_type: 'virtual', // Indicar que é organização virtual
        timestamp: timestamp,
        random_id: randomId
      }
      
      console.log('✅ Organização virtual concluída - arquivo permanece em estrutura temporal')
      console.log('📁 Arquivo físico em:', uploadResult.s3_key)
      console.log('📂 Organização virtual:', folderName)
      console.log('🔒 Sistema seguro - sem dependências de MCP ou credenciais temporárias')
      console.log('🚀 Funciona mesmo após expiração de credenciais externas')
      console.log(`⚡ FINALIZADO COM TIMESTAMP: ${timestamp}`)
    }
    
    console.log('🎉 Upload concluído com sucesso!')
    console.log(`🏁 OPERAÇÃO FINALIZADA - TIMESTAMP: ${timestamp}`)

    return res.status(200).json({
      success: true,
      message: 'Upload realizado com sucesso',
      data: uploadResult,
      cache_bypass: {
        timestamp: timestamp,
        random_id: randomId,
        api_version: 'cache-bypass-final'
      }
    })

  } catch (error) {
    console.error('❌ Erro no upload:', error)
    console.error(`⚡ ERRO GERAL NO TIMESTAMP: ${new Date().toISOString()}`)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro no upload do arquivo',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    })
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
}
