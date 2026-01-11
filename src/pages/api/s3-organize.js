// =====================================================
// API: S3 ORGANIZE - BACKEND SEGURO
// =====================================================
// Endpoint simples na raiz para organizar arquivos S3
// Credenciais AWS seguras no servidor

import AWS from 'aws-sdk'

// =====================================================
// CONFIGURAÇÃO AWS S3 SEGURA
// =====================================================

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'sa-east-1'
})

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'aws-lovoocrm-media'

// =====================================================
// HELPER: IDENTIFICAR PASTA
// =====================================================

const getFolderName = (folderId) => {
  console.log('📂 Identificando pasta para folder_id:', folderId)
  
  let folderName = 'marketing' // padrão
  
  if (folderId.toLowerCase().includes('marketing') || folderId.includes('fc701f27')) {
    folderName = 'marketing'
  } else if (folderId.toLowerCase().includes('chat')) {
    folderName = 'chat'
  } else if (folderId.toLowerCase().includes('teste')) {
    folderName = 'teste'
  }
  
  console.log('📂 Pasta identificada:', folderName)
  return folderName
}

// =====================================================
// HELPER: BUSCAR ARQUIVO MAIS RECENTE
// =====================================================

const findLatestFile = async (companyId) => {
  try {
    console.log('🔍 Buscando arquivo mais recente para company:', companyId)
    
    // Buscar na estrutura temporal atual
    const currentDate = new Date()
    const year = currentDate.getFullYear()
    const month = String(currentDate.getMonth() + 1).padStart(2, '0')
    const day = String(currentDate.getDate()).padStart(2, '0')
    
    const basePath = `biblioteca/companies/${companyId}/${year}/${month}/${day}/`
    
    const listParams = {
      Bucket: BUCKET_NAME,
      Prefix: basePath
    }
    
    const objects = await s3.listObjects(listParams).promise()
    
    if (objects.Contents && objects.Contents.length > 0) {
      // Pegar o arquivo mais recente
      const latestFile = objects.Contents.sort((a, b) => 
        new Date(b.LastModified) - new Date(a.LastModified)
      )[0]
      
      console.log('📁 Arquivo mais recente encontrado:', latestFile.Key)
      return {
        s3_key: latestFile.Key,
        file_name: latestFile.Key.split('/').pop()
      }
    }
    
    throw new Error('Nenhum arquivo encontrado na estrutura temporal')
    
  } catch (error) {
    console.error('❌ Erro ao buscar arquivo:', error)
    throw error
  }
}

// =====================================================
// HELPER: MOVER ARQUIVO NO S3
// =====================================================

const moveFileInS3 = async (companyId, folderName, originalS3Key, fileName) => {
  try {
    console.log('📁 Movendo arquivo no S3:', {
      original: originalS3Key,
      folder: folderName,
      fileName: fileName
    })
    
    // Determinar novo caminho S3
    const newS3Key = `biblioteca/companies/${companyId}/${folderName}/${fileName}`
    
    console.log('📂 Novo caminho S3:', newS3Key)
    
    // Copiar arquivo para novo local
    const copyParams = {
      Bucket: BUCKET_NAME,
      CopySource: `${BUCKET_NAME}/${originalS3Key}`,
      Key: newS3Key,
      MetadataDirective: 'COPY'
    }
    
    await s3.copyObject(copyParams).promise()
    console.log('✅ Arquivo copiado com sucesso no S3:', newS3Key)
    
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
    
    return {
      success: true,
      old_s3_key: originalS3Key,
      new_s3_key: newS3Key,
      new_s3_url: `https://${BUCKET_NAME}.s3.sa-east-1.amazonaws.com/${newS3Key}`,
      folder_created: true
    }
    
  } catch (error) {
    console.error('❌ Erro no movimento S3:', error)
    throw error
  }
}

// =====================================================
// HANDLER PRINCIPAL
// =====================================================

export default async function handler(req, res) {
  console.log('📁 S3 ORGANIZE - 2026-01-11 09:14 - API BACKEND SEGURA')
  console.log('✅ ORGANIZANDO ARQUIVO COM CREDENCIAIS SEGURAS NO SERVIDOR')
  
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
    const { company_id, file_id, folder_id } = req.body
    
    if (!company_id || !file_id || !folder_id) {
      return res.status(400).json({
        error: 'Parâmetros obrigatórios',
        message: 'company_id, file_id e folder_id são necessários'
      })
    }

    console.log('📁 Organização solicitada:', { 
      company_id, 
      file_id,
      folder_id
    })

    // Identificar pasta de destino
    const folderName = getFolderName(folder_id)
    
    console.log('📂 Organizando para pasta:', folderName)

    // Buscar arquivo mais recente
    const currentFile = await findLatestFile(company_id)
    
    // Mover arquivo no S3
    const moveResult = await moveFileInS3(
      company_id, 
      folderName, 
      currentFile.s3_key, 
      currentFile.file_name
    )
    
    console.log('🎉 Organização concluída com sucesso!')

    return res.status(200).json({
      success: true,
      message: `Arquivo organizado na pasta ${folderName}`,
      data: {
        id: file_id,
        company_id: company_id,
        folder_id: folder_id,
        folder_name: folderName,
        s3_key: moveResult.new_s3_key,
        preview_url: moveResult.new_s3_url,
        old_s3_path: currentFile.s3_key,
        new_s3_path: moveResult.new_s3_key,
        organized_at: new Date().toISOString()
      }
    })

  } catch (error) {
    console.error('❌ Erro na organização:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro na organização do arquivo',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
