// AWS S3 Media Endpoint
// Created: 2025-12-22
// Purpose: Generate signed URLs for S3 media files with authentication

import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs';
import { S3Storage } from '../../../services/aws';

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

    // Create Supabase client with cookies for authentication
    const supabase = createServerSupabaseClient({ req, res });

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('❌ Authentication failed:', authError);
      return res.status(401).json({ error: 'Authentication required' });
    }

    console.log('✅ User authenticated:', user.id);

    // Get user's company_id with fallback
    let companyId;
    try {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', user.id)
        .single();

      if (userError || !userData) {
        console.error('❌ User data not found, trying company_users:', userError);
        
        // Fallback: try company_users table
        const { data: companyUserData, error: companyUserError } = await supabase
          .from('company_users')
          .select('company_id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .single();
          
        if (companyUserError || !companyUserData) {
          console.error('❌ Company user data not found:', companyUserError);
          return res.status(403).json({ error: 'User company not found' });
        }
        
        companyId = companyUserData.company_id;
      } else {
        companyId = userData.company_id;
      }
    } catch (dbError) {
      console.error('❌ Database error:', dbError);
      return res.status(500).json({ error: 'Database error' });
    }

    console.log('🏢 Company ID:', companyId);

    // ✅ BUSCAR S3_KEY NO BANCO DE DADOS
    let s3Key = filename;
    
    console.log('🔍 Buscando arquivo no banco:', filename);
    
    // Se filename já é um s3_key completo, usar diretamente
    if (filename.startsWith('clientes/')) {
      s3Key = filename;
      console.log('✅ Filename já é s3_key completo:', s3Key);
    } else {
      // Buscar s3_key no banco de dados
      try {
        // Tentar company_media_library primeiro
        const { data: fileData, error: fileError } = await supabase
          .from('company_media_library')
          .select('s3_key')
          .eq('company_id', companyId)
          .eq('original_filename', filename)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (fileData && fileData.s3_key) {
          s3Key = fileData.s3_key;
          console.log('✅ S3 key encontrado em company_media_library:', s3Key);
        } else {
          console.log('⚠️ Arquivo não encontrado em company_media_library, tentando lead_media_unified');
          
          // Fallback: tentar lead_media_unified
          const { data: leadFileData, error: leadFileError } = await supabase
            .from('lead_media_unified')
            .select('s3_key')
            .eq('company_id', companyId)
            .eq('original_filename', filename)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          
          if (leadFileData && leadFileData.s3_key) {
            s3Key = leadFileData.s3_key;
            console.log('✅ S3 key encontrado em lead_media_unified:', s3Key);
          } else {
            console.log('❌ Arquivo não encontrado no banco de dados');
            // Manter filename original como fallback
            s3Key = filename;
          }
        }
      } catch (dbError) {
        console.error('❌ Erro ao buscar arquivo no banco:', dbError);
        // Manter filename original como fallback
        s3Key = filename;
      }
    }

    console.log('🔑 S3 Key final:', s3Key);

    // Verify the S3 key belongs to the user's company
    if (s3Key.includes('clientes/') && !s3Key.includes(`clientes/${companyId}/`)) {
      console.error('❌ Access denied - wrong company');
      return res.status(403).json({ error: 'Access denied' });
    }

    // Generate signed URL with multiple attempts
    console.log('🔗 Attempting to generate signed URL for:', s3Key);
    
    let signedUrlResult = await S3Storage.generateSignedUrl(
      companyId,
      s3Key,
      { expiresIn: 7200 } // 2 hours
    );

    // If first attempt fails, try simpler key patterns
    if (!signedUrlResult.success) {
      console.log('⚠️ First attempt failed, trying alternative keys');
      
      const alternativeKeys = [
        filename, // Direct filename
        `clientes/${companyId}/whatsapp/${filename}`, // Simple path
        `${filename}` // Just the filename
      ];
      
      for (const altKey of alternativeKeys) {
        console.log('🔄 Trying alternative key:', altKey);
        
        const altResult = await S3Storage.generateSignedUrl(
          companyId,
          altKey,
          { expiresIn: 7200 }
        );
        
        if (altResult.success && altResult.data) {
          signedUrlResult = altResult;
          s3Key = altKey;
          console.log('✅ Alternative key worked:', altKey);
          break;
        }
      }
    }

    if (!signedUrlResult.success || !signedUrlResult.data) {
      console.log('⚠️ S3 failed, trying Supabase Storage fallback');
      
      // FALLBACK: Try Supabase Storage for existing media
      try {
        // Check if this looks like a Supabase Storage URL pattern
        if (filename.includes('supabase.co') || filename.includes('chat-media') || filename.includes('.jpg') || filename.includes('.png') || filename.includes('.jpeg')) {
          console.log('🔄 Attempting Supabase Storage fallback for:', filename);
          
          // Extract just the filename from Supabase URL if needed
          let supabaseFilename = filename;
          if (filename.includes('/storage/v1/object/public/chat-media/')) {
            supabaseFilename = filename.split('/storage/v1/object/public/chat-media/')[1];
          } else if (filename.includes('chat-media/')) {
            supabaseFilename = filename.split('chat-media/')[1];
          }
          
          console.log('📁 Supabase filename:', supabaseFilename);
          
          // Create Supabase client for storage access
          const { data: { publicUrl } } = supabase.storage
            .from('chat-media')
            .getPublicUrl(supabaseFilename);
          
          if (publicUrl) {
            console.log('✅ Supabase Storage fallback successful');
            return res.redirect(302, publicUrl);
          }
        }
      } catch (supabaseError) {
        console.error('❌ Supabase Storage fallback failed:', supabaseError);
      }
      
      console.error('❌ All attempts failed to generate signed URL:', {
        originalKey: s3Key,
        error: signedUrlResult.error,
        companyId
      });
      
      // Return a more helpful error
      return res.status(404).json({ 
        error: 'File not found',
        details: {
          filename,
          companyId,
          attemptedKey: s3Key,
          s3Error: signedUrlResult.error
        }
      });
    }

    console.log('✅ Signed URL generated successfully for key:', s3Key);

    // Redirect to the signed URL
    return res.redirect(302, signedUrlResult.data);

  } catch (error) {
    console.error('❌ S3 Media endpoint error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
