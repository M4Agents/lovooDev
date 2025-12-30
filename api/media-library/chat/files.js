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

// Função para obter credenciais AWS da empresa
async function getCompanyAwsCredentials(companyId) {
  try {
    const { data, error } = await supabase
      .from('aws_credentials')
      .select('access_key_id, secret_access_key, region, bucket')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .single();

    if (error) {
      console.error('❌ Erro ao buscar credenciais AWS:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('❌ Erro na busca de credenciais:', error);
    return null;
  }
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
    // Obter company_id do usuário autenticado (mesmo padrão dos outros endpoints)
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de autorização necessário' });
    }

    const token = authHeader.split(' ')[1];
    
    // Verificar token com Supabase
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error('❌ Erro de autenticação:', authError);
      return res.status(401).json({ error: 'Token inválido' });
    }

    // Buscar company_id do usuário
    const { data: companyUser, error: companyError } = await supabase
      .from('company_users')
      .select('company_id')
      .eq('user_id', user.id)
      .single();

    if (companyError || !companyUser) {
      console.error('❌ Usuário não associado a empresa:', companyError);
      return res.status(403).json({ error: 'Usuário não associado a uma empresa' });
    }

    const companyId = companyUser.company_id;
    console.log('🏢 Company ID:', companyId);

    // Obter credenciais AWS da empresa
    const credentials = await getCompanyAwsCredentials(companyId);
    if (!credentials) {
      return res.status(500).json({ error: 'Credenciais AWS não encontradas para a empresa' });
    }

    // Listar arquivos diretamente do S3
    const files = await listS3ChatFiles(companyId, credentials);

    // Processar parâmetros de paginação
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Aplicar paginação
    const paginatedFiles = files.slice(offset, offset + limit);
    
    // Calcular estatísticas por tipo
    const stats = files.reduce((acc, file) => {
      acc[file.file_type] = (acc[file.file_type] || 0) + 1;
      acc.total = (acc.total || 0) + 1;
      return acc;
    }, {});

    const response = {
      files: paginatedFiles,
      pagination: {
        page,
        limit,
        total: files.length,
        totalPages: Math.ceil(files.length / limit),
        hasNext: offset + limit < files.length,
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
