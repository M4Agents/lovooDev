// AWS S3 Media Endpoint
// Created: 2025-12-22
// Purpose: Generate signed URLs for S3 media files with authentication

import { createClient } from '@supabase/supabase-js';

// Configuração do Supabase
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase configuration missing')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { filename } = req.query;

  if (!filename) {
    return res.status(400).json({ error: 'Filename is required' });
  }

  try {
    console.log('🔗 S3 Media Request:', { filename });

    // Buscar s3_key no banco e gerar URL direta do AWS S3
    console.log('📄 Arquivo solicitado:', filename);
    
    try {
      const { data: fileData, error: dbError } = await supabase
        .from('lead_media_unified')
        .select('original_filename, s3_key, file_type')
        .eq('original_filename', filename)
        .single();
      
      if (dbError || !fileData) {
        console.log('❌ Arquivo não encontrado no banco:', filename);
        return res.status(404).json({ 
          error: 'File not found in database',
          filename
        });
      }
      
      console.log('✅ Arquivo encontrado no banco:', fileData);
      
      // Limpar prefixo "supabase/" da chave S3
      let cleanS3Key = fileData.s3_key;
      if (cleanS3Key && cleanS3Key.startsWith('supabase/')) {
        cleanS3Key = cleanS3Key.replace('supabase/', '');
      }
      
      console.log('🔑 S3 Key original:', fileData.s3_key);
      console.log('🔑 S3 Key limpa:', cleanS3Key);
      
      // Fazer proxy do arquivo do AWS S3 (contorna CORS)
      const s3Url = `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${cleanS3Key}`;
      
      console.log('🔗 Fazendo proxy do AWS S3:', s3Url);
      
      try {
        // Fazer requisição server-side para o S3
        const s3Response = await fetch(s3Url);
        
        if (!s3Response.ok) {
          console.error('❌ Erro ao buscar arquivo no S3:', s3Response.status, s3Response.statusText);
          return res.status(404).json({ 
            error: 'File not found in S3',
            s3Status: s3Response.status,
            s3StatusText: s3Response.statusText
          });
        }
        
        console.log('✅ Arquivo obtido do S3 com sucesso');
        
        // Obter tipo de conteúdo do S3
        const contentType = s3Response.headers.get('content-type') || 'application/octet-stream';
        const contentLength = s3Response.headers.get('content-length');
        
        // Configurar headers da resposta
        res.setHeader('Content-Type', contentType);
        if (contentLength) {
          res.setHeader('Content-Length', contentLength);
        }
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache por 1 ano
        
        // Fazer stream do arquivo do S3 para o cliente
        const reader = s3Response.body.getReader();
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        
        res.end();
        return;
        
      } catch (fetchError) {
        console.error('❌ Erro ao fazer proxy do S3:', fetchError);
        return res.status(500).json({ 
          error: 'Failed to proxy file from S3',
          details: fetchError.message
        });
      }
      
    } catch (error) {
      console.error('❌ Erro ao buscar arquivo no banco:', error);
    }
    
    // Se chegou aqui, arquivo não encontrado
    console.error('❌ Arquivo não encontrado:', filename);
    return res.status(404).json({ 
      error: 'File not found',
      filename
    });

  } catch (error) {
    console.error('❌ S3 Media endpoint error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
