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

    // Get user's company_id
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single();

    if (userError || !userData) {
      console.error('❌ User data not found:', userError);
      return res.status(403).json({ error: 'User data not found' });
    }

    const companyId = userData.company_id;
    console.log('🏢 Company ID:', companyId);

    // Extract S3 key from filename
    // Filename format: clientes/{company_id}/whatsapp/{yyyy}/{mm}/{dd}/{messageId}/{originalFileName}
    let s3Key = filename;
    
    // If filename doesn't contain the full path, construct it
    if (!filename.startsWith('clientes/')) {
      // Try to find the file in the company's S3 structure
      // This is a simplified approach - in production you might want to store the mapping
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      
      // Try common patterns
      const possibleKeys = [
        `clientes/${companyId}/whatsapp/${year}/${month}/${day}/*/${filename}`,
        `clientes/${companyId}/profiles/${year}/${month}/${day}/${filename}`
      ];
      
      // For now, use the filename as provided
      s3Key = filename;
    }

    console.log('🔑 S3 Key:', s3Key);

    // Verify the S3 key belongs to the user's company
    if (s3Key.includes('clientes/') && !s3Key.includes(`clientes/${companyId}/`)) {
      console.error('❌ Access denied - wrong company');
      return res.status(403).json({ error: 'Access denied' });
    }

    // Generate signed URL
    const signedUrlResult = await S3Storage.generateSignedUrl(
      companyId,
      s3Key,
      { expiresIn: 7200 } // 2 hours
    );

    if (!signedUrlResult.success || !signedUrlResult.data) {
      console.error('❌ Failed to generate signed URL:', signedUrlResult.error);
      return res.status(404).json({ error: 'File not found or access denied' });
    }

    console.log('✅ Signed URL generated successfully');

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
