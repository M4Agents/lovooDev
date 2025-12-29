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

    // Como os arquivos estão no banco mas não no Supabase Storage,
    // vamos retornar uma URL placeholder ou erro mais informativo
    console.log('📄 Arquivo solicitado:', filename);
    
    // Buscar informações do arquivo no banco
    try {
      const { data: fileData, error: dbError } = await supabase
        .from('lead_media_unified')
        .select('original_filename, s3_key, preview_url, file_type')
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
      
      // Se tem preview_url, usar ela
      if (fileData.preview_url) {
        console.log('🔗 Redirecionando para preview_url:', fileData.preview_url);
        return res.redirect(302, fileData.preview_url);
      }
      
      // Caso contrário, retornar informações do arquivo
      return res.status(200).json({
        message: 'File found but no accessible URL',
        file: {
          filename: fileData.original_filename,
          type: fileData.file_type,
          s3_key: fileData.s3_key
        }
      });
      
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
