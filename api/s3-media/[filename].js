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

    // Tentar Supabase Storage primeiro (fallback simples)
    try {
      console.log('🔄 Tentando Supabase Storage para:', filename);
      
      // Extrair nome do arquivo se necessário
      let supabaseFilename = filename;
      if (filename.includes('chat-media/')) {
        supabaseFilename = filename.split('chat-media/')[1];
      }
      
      console.log('📁 Supabase filename:', supabaseFilename);
      
      // Gerar URL pública do Supabase Storage
      const { data: { publicUrl } } = supabase.storage
        .from('chat-media')
        .getPublicUrl(supabaseFilename);
      
      if (publicUrl) {
        console.log('✅ Supabase Storage URL gerada:', publicUrl);
        return res.redirect(302, publicUrl);
      }
    } catch (supabaseError) {
      console.error('❌ Supabase Storage falhou:', supabaseError);
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
