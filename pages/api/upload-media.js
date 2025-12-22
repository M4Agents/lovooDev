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
    console.log('📋 Headers:', JSON.stringify(req.headers, null, 2));

    // Create Supabase client for authentication
    const supabase = createServerSupabaseClient({ req, res });

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('❌ Authentication failed:', authError);
      console.error('❌ Auth error details:', JSON.stringify(authError, null, 2));
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    console.log('✅ User authenticated successfully:', user.id);

    // Get user's company_id from team_members table
    const { data: userData, error: userError } = await supabase
      .from('team_members')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (userError || !userData) {
      console.error('❌ Team member data not found:', userError);
      console.error('❌ User error details:', JSON.stringify(userError, null, 2));
      console.error('❌ User ID searched:', user.id);
      return res.status(403).json({ success: false, error: 'User company not found' });
    }

    const companyId = userData.company_id;
    console.log('🏢 Company ID found:', companyId);
    console.log('🏢 User data:', JSON.stringify(userData, null, 2));

    // Parse form data
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB
      keepExtensions: true,
    });

    console.log('📋 Parsing form data...');
    const [fields, files] = await form.parse(req);
    
    console.log('📋 Form parsed - Fields:', JSON.stringify(fields, null, 2));
    console.log('📋 Form parsed - Files:', JSON.stringify(Object.keys(files), null, 2));
    
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    const conversationId = Array.isArray(fields.conversationId) ? fields.conversationId[0] : fields.conversationId;

    if (!file) {
      console.error('❌ No file provided in request');
      return res.status(400).json({ success: false, error: 'No file provided' });
    }

    console.log('📁 File received:', {
      originalFilename: file.originalFilename,
      size: file.size,
      mimetype: file.mimetype,
      filepath: file.filepath
    });
    console.log('📁 Conversation ID:', conversationId);

    // Read file buffer
    console.log('📖 Reading file buffer from:', file.filepath);
    const buffer = fs.readFileSync(file.filepath);
    console.log('📖 Buffer read successfully, size:', buffer.length);

    // Detect content type
    console.log('🔍 Detecting content type...');
    const contentType = S3Storage.detectContentType(buffer, file.originalFilename || 'unknown');
    console.log('🔍 Content type detected:', contentType);

    // Prepare S3 upload parameters
    const messageId = `frontend-${conversationId}-${Date.now()}`;
    const uploadParams = {
      companyId: companyId,
      messageId: messageId,
      originalFileName: file.originalFilename || 'unknown',
      buffer: buffer,
      contentType: contentType,
      source: 'frontend'
    };
    
    console.log('🚀 Starting S3 upload with params:', {
      companyId,
      messageId,
      originalFileName: file.originalFilename,
      contentType,
      bufferSize: buffer.length,
      source: 'frontend'
    });

    // Upload to S3
    const uploadResult = await S3Storage.uploadToS3(uploadParams);

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
