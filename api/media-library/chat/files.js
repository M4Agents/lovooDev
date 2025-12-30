import { createClient } from '@supabase/supabase-js';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

// Inicializar Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Função para detectar tipo de arquivo baseado na extensão
function detectFileType(filename) {
  const extension = filename.split('.').pop()?.toLowerCase();
  
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) {
    return 'image';
  }
  if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'].includes(extension)) {
    return 'video';
  }
  if (['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'].includes(extension)) {
    return 'audio';
  }
  return 'document';
}

// Função para gerar URL de preview do S3
function generatePreviewUrl(s3Key, region = 'sa-east-1', bucket = 'aws-lovoocrm-media') {
  return `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`;
}

// Função para obter credenciais AWS (usando credenciais fixas do sistema)
function getCompanyAwsCredentials() {
  return {
    access_key_id: process.env.AWS_ACCESS_KEY_ID,
    secret_access_key: process.env.AWS_SECRET_ACCESS_KEY,
    region: 'sa-east-1',
    bucket: 'aws-lovoocrm-media'
  };
}

// Função para listar arquivos do S3 diretamente
async function listS3ChatFiles(companyId, credentials) {
  try {
    // Configurar cliente S3
    const s3Client = new S3Client({
      region: credentials.region,
      credentials: {
        accessKeyId: credentials.access_key_id,
        secretAccessKey: credentials.secret_access_key,
      },
    });

    // Prefixo para arquivos de chat da empresa
    const prefix = `clientes/${companyId}/whatsapp/`;
    
    console.log('🔍 Listando arquivos S3:', { bucket: credentials.bucket, prefix });

    const command = new ListObjectsV2Command({
      Bucket: credentials.bucket,
      Prefix: prefix,
      MaxKeys: 1000, // Limite de arquivos por página
    });

    const response = await s3Client.send(command);
    
    if (!response.Contents || response.Contents.length === 0) {
      console.log('📂 Nenhum arquivo encontrado no S3');
      return [];
    }

    // Processar arquivos encontrados
    const files = response.Contents
      .filter(object => {
        // Filtrar apenas arquivos (não pastas)
        return object.Key && !object.Key.endsWith('/');
      })
      .map(object => {
        const filename = object.Key.split('/').pop();
        const fileType = detectFileType(filename);
        
        return {
          id: object.Key, // Usar S3 key como ID único
          s3_key: object.Key,
          original_filename: filename,
          file_type: fileType,
          mime_type: getMimeType(fileType, filename),
          file_size: object.Size,
          preview_url: generatePreviewUrl(object.Key, credentials.region, credentials.bucket),
          received_at: object.LastModified,
          created_at: object.LastModified,
          source: 'whatsapp_s3_direct'
        };
      })
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at)); // Mais recentes primeiro

    console.log(`✅ Encontrados ${files.length} arquivos no S3`);
    return files;

  } catch (error) {
    console.error('❌ Erro ao listar arquivos S3:', error);
    throw error;
  }
}

// Função para obter MIME type baseado no tipo e filename
function getMimeType(fileType, filename) {
  const extension = filename.split('.').pop()?.toLowerCase();
  
  const mimeTypes = {
    // Images
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'bmp': 'image/bmp',
    'svg': 'image/svg+xml',
    
    // Videos
    'mp4': 'video/mp4',
    'avi': 'video/x-msvideo',
    'mov': 'video/quicktime',
    'wmv': 'video/x-ms-wmv',
    'flv': 'video/x-flv',
    'webm': 'video/webm',
    'mkv': 'video/x-matroska',
    
    // Audio
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'aac': 'audio/aac',
    'm4a': 'audio/mp4',
    'flac': 'audio/flac',
    
    // Documents
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'txt': 'text/plain',
  };
  
  return mimeTypes[extension] || 'application/octet-stream';
}

export default async function handler(req, res) {
  // Apenas método GET é suportado
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🚀 API Chat Files chamada:', new Date().toISOString());
    
    // VERSÃO SIMPLIFICADA: Retornar dados mock para testar se frontend funciona
    const mockFiles = [
      {
        id: 'mock1',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/image1.jpg',
        original_filename: 'whatsapp_image1.jpg',
        file_type: 'image',
        mime_type: 'image/jpeg',
        file_size: 150000,
        preview_url: 'https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/image1.jpg',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        source: 'whatsapp_s3_mock'
      },
      {
        id: 'mock2',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/image2.jpg',
        original_filename: 'whatsapp_image2.jpg',
        file_type: 'image',
        mime_type: 'image/jpeg',
        file_size: 200000,
        preview_url: 'https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/image2.jpg',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        source: 'whatsapp_s3_mock'
      },
      {
        id: 'mock3',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/video1.mp4',
        original_filename: 'whatsapp_video1.mp4',
        file_type: 'video',
        mime_type: 'video/mp4',
        file_size: 500000,
        preview_url: 'https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/video1.mp4',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        source: 'whatsapp_s3_mock'
      },
      {
        id: 'mock4',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/audio1.ogg',
        original_filename: 'whatsapp_audio1.ogg',
        file_type: 'audio',
        mime_type: 'audio/ogg',
        file_size: 80000,
        preview_url: 'https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/audio1.ogg',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        source: 'whatsapp_s3_mock'
      },
      {
        id: 'mock5',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/document1.pdf',
        original_filename: 'whatsapp_document1.pdf',
        file_type: 'document',
        mime_type: 'application/pdf',
        file_size: 300000,
        preview_url: 'https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/document1.pdf',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        source: 'whatsapp_s3_mock'
      },
      {
        id: 'mock6',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/image3.jpg',
        original_filename: 'whatsapp_image3.jpg',
        file_type: 'image',
        mime_type: 'image/jpeg',
        file_size: 180000,
        preview_url: 'https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/image3.jpg',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        source: 'whatsapp_s3_mock'
      },
      {
        id: 'mock7',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/image4.jpg',
        original_filename: 'whatsapp_image4.jpg',
        file_type: 'image',
        mime_type: 'image/jpeg',
        file_size: 220000,
        preview_url: 'https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/image4.jpg',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        source: 'whatsapp_s3_mock'
      },
      {
        id: 'mock8',
        s3_key: 'clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/video2.mp4',
        original_filename: 'whatsapp_video2.mp4',
        file_type: 'video',
        mime_type: 'video/mp4',
        file_size: 750000,
        preview_url: 'https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/clientes/dcc99d3d-9def-4b93-aeb2-1a3be5f15413/whatsapp/2025/12/video2.mp4',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        source: 'whatsapp_s3_mock'
      }
    ];

    // Processar parâmetros de paginação
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Aplicar paginação
    const paginatedFiles = mockFiles.slice(offset, offset + limit);
    
    // Calcular estatísticas por tipo
    const stats = mockFiles.reduce((acc, file) => {
      acc[file.file_type] = (acc[file.file_type] || 0) + 1;
      acc.total = (acc.total || 0) + 1;
      return acc;
    }, {});

    const response = {
      files: paginatedFiles,
      pagination: {
        page,
        limit,
        total: mockFiles.length,
        totalPages: Math.ceil(mockFiles.length / limit),
        hasNext: offset + limit < mockFiles.length,
        hasPrev: page > 1
      },
      stats: {
        total: stats.total || 0,
        image: stats.image || 0,
        video: stats.video || 0,
        audio: stats.audio || 0,
        document: stats.document || 0
      },
      source: 's3_direct_listing'
    };

    console.log('✅ Resposta da pasta Chat:', {
      totalFiles: response.stats.total,
      page: response.pagination.page,
      returnedFiles: paginatedFiles.length
    });

    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ Erro no endpoint da pasta Chat:', error);
    return res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: error.message 
    });
  }
}
