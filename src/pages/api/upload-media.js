// Upload Media API Endpoint
// Created: 2025-12-22
// Purpose: Backend endpoint for S3 media uploads (called from frontend)

import { S3Storage } from '../../services/aws';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // TODO: Implementar upload S3 via backend
    // Por enquanto, retornar erro para usar fallback
    return res.status(500).json({ 
      success: false, 
      error: 'S3 upload endpoint not implemented yet - using fallback' 
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
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}
