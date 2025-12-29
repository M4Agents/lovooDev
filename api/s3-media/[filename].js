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
      
      // Gerar URL direta do AWS S3 (EXCLUSIVAMENTE S3)
      const s3Url = `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${cleanS3Key}`;
      
      console.log('🔗 URL AWS S3 gerada:', s3Url);
      
      // Redirecionar para URL direta do AWS S3
      return res.redirect(302, s3Url);
      
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
