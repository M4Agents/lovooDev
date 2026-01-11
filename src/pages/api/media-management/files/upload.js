// =====================================================
// API: MEDIA MANAGEMENT - FILES UPLOAD
// =====================================================
// API de upload que funciona + organização opcional

import formidable from 'formidable'
import AWS from 'aws-sdk'

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
// HELPER: ORGANIZAR PARA PASTA
// =====================================================

const organizeToFolder = async (uploadResult, folderId) => {
  try {
    console.log('📁 Organizando para pasta:', folderId)
    
    // Determinar nome da pasta
    let folderName = 'marketing' // padrão
    if (folderId.toLowerCase().includes('marketing') || folderId.includes('fc701f27')) {
      folderName = 'marketing'
    } else if (folderId.toLowerCase().includes('chat')) {
      folderName = 'chat'
    } else if (folderId.toLowerCase().includes('teste')) {
      folderName = 'teste'
    }
    
    console.log('📂 Pasta de destino:', folderName)
    
    const originalS3Key = uploadResult.s3_key
    const fileName = uploadResult.file_name
    const newS3Key = `biblioteca/companies/${uploadResult.company_id}/${folderName}/${fileName}`
    
    console.log('📁 Movendo de:', originalS3Key)
    console.log('📁 Para:', newS3Key)
    
    // Copiar arquivo para nova localização
    const copyParams = {
      Bucket: BUCKET_NAME,
      CopySource: `${BUCKET_NAME}/${originalS3Key}`,
      Key: newS3Key,
      MetadataDirective: 'COPY'
    }
    
    await s3.copyObject(copyParams).promise()
    console.log('✅ Arquivo copiado para pasta:', newS3Key)
    
    // Remover arquivo original
    try {
      const deleteParams = {
        Bucket: BUCKET_NAME,
        Key: originalS3Key
      }
      
      await s3.deleteObject(deleteParams).promise()
      console.log('✅ Arquivo original removido:', originalS3Key)
    } catch (deleteError) {
      console.warn('⚠️ Não foi possível remover arquivo original:', deleteError.message)
    }
    
    // Atualizar resultado
    return {
      ...uploadResult,
      s3_key: newS3Key,
      preview_url: `https://${BUCKET_NAME}.s3.sa-east-1.amazonaws.com/${newS3Key}`,
      folder_id: folderId,
      folder_name: folderName,
      organized_at: new Date().toISOString()
    }
    
  } catch (error) {
    console.error('❌ Erro na organização:', error)
    // Retornar resultado original se organização falhar
    return uploadResult
  }
}

// =====================================================
// HANDLER PRINCIPAL
// =====================================================

export default async function handler(req, res) {
  console.log('📤 MEDIA MANAGEMENT - FILES UPLOAD - 2026-01-11 09:24')
  console.log('✅ API QUE FUNCIONA + ORGANIZAÇÃO OPCIONAL')
  
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
      files_count: Object.keys(files).length
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
    
    // Upload para estrutura temporal
    let uploadResult = await uploadToTemporal(file, companyId)
    
    // Se solicitado organização E há folder_id, organizar
    if (organizeToFolder === 'true' && folderId) {
      console.log('🔄 Organizando arquivo após upload...')
      uploadResult = await organizeToFolder(uploadResult, folderId)
    }
    
    console.log('🎉 Upload concluído com sucesso!')

    return res.status(200).json({
      success: true,
      message: 'Upload realizado com sucesso',
      data: uploadResult
    })

  } catch (error) {
    console.error('❌ Erro no upload:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro no upload do arquivo',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
}
