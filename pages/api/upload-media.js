// Upload Media API Endpoint
// Created: 2025-12-22
// Purpose: Backend endpoint for S3 media uploads (called from frontend)

import { S3Storage } from '../../src/services/aws';
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs';
import formidable from 'formidable';
import fs from 'fs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    console.log('🚀 Upload media endpoint called');
    console.log('📋 Request method:', req.method);
    console.log('📋 Content-Type:', req.headers['content-type']);

    // Create Supabase client for authentication
    const supabase = createServerSupabaseClient({ req, res });

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('❌ Authentication failed:', authError);
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    // Get user's company_id from team_members table
    const { data: userData, error: userError } = await supabase
      .from('team_members')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (userError || !userData) {
      console.error('❌ Team member data not found:', userError);
      return res.status(403).json({ success: false, error: 'User company not found' });
    }

    const companyId = userData.company_id;
    console.log('🏢 Company ID:', companyId);

    // Parse form data
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB
      keepExtensions: true,
    });

    const [fields, files] = await form.parse(req);
    
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    const conversationId = Array.isArray(fields.conversationId) ? fields.conversationId[0] : fields.conversationId;

    if (!file) {
      return res.status(400).json({ success: false, error: 'No file provided' });
    }

    console.log('📁 File received:', {
      originalFilename: file.originalFilename,
      size: file.size,
      mimetype: file.mimetype
    });

    // Read file buffer
    const buffer = fs.readFileSync(file.filepath);

    // Detect content type
    const contentType = S3Storage.detectContentType(buffer, file.originalFilename || 'unknown');

    // Upload to S3
    const uploadResult = await S3Storage.uploadToS3({
      companyId: companyId,
      messageId: `frontend-${conversationId}-${Date.now()}`,
      originalFileName: file.originalFilename || 'unknown',
      buffer: buffer,
      contentType: contentType,
      source: 'frontend'
    });

    // Clean up temp file
    fs.unlinkSync(file.filepath);

    if (!uploadResult.success || !uploadResult.data) {
      console.error('❌ S3 upload failed:', uploadResult.error);
      return res.status(500).json({ 
        success: false, 
        error: uploadResult.error || 'Upload failed' 
      });
    }

    // Generate signed URL for immediate use
    const signedUrlResult = await S3Storage.generateSignedUrl(
      companyId,
      uploadResult.data.s3Key,
      { expiresIn: 7200 } // 2 hours
    );

    if (!signedUrlResult.success || !signedUrlResult.data) {
      console.error('❌ Failed to generate signed URL:', signedUrlResult.error);
      return res.status(500).json({ 
        success: false, 
        error: signedUrlResult.error || 'Failed to generate signed URL' 
      });
    }

    console.log('✅ Upload successful:', {
      s3Key: uploadResult.data.s3Key,
      size: uploadResult.data.sizeBytes
    });

    return res.status(200).json({
      success: true,
      url: signedUrlResult.data,
      metadata: {
        s3Key: uploadResult.data.s3Key,
        bucket: uploadResult.data.bucket,
        contentType: uploadResult.data.contentType,
        sizeBytes: uploadResult.data.sizeBytes
      }
    });

  } catch (error) {
    console.error('❌ Upload media error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

export const config = {
  api: {
    bodyParser: false, // Disable default body parser for formidable
  },
}
