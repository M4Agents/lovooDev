// AWS S3 CORS Setup Endpoint
// Created: 2025-12-23
// Purpose: One-time setup endpoint to configure S3 bucket CORS

import { S3BucketSetup } from '../src/services/aws/bucketSetup.js';

export default async function handler(req, res) {
  console.log('🚀 S3 CORS Setup Endpoint - Iniciando configuração');
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ success: false, error: 'Método não permitido. Use POST ou GET.' });
    return;
  }

  try {
    const companyId = req.body?.company_id || req.query?.company_id || 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413';
    
    console.log('🏢 Configurando S3 CORS para company:', companyId);

    if (req.method === 'POST') {
      // Setup complete bucket configuration
      console.log('🛠️ Executando setup completo do bucket...');
      const setupResult = await S3BucketSetup.setupBucket(companyId);
      
      if (!setupResult.success) {
        console.error('❌ Falha no setup:', setupResult.error);
        res.status(500).json({
          success: false,
          error: setupResult.error,
          details: setupResult.details
        });
        return;
      }

      console.log('✅ Setup do bucket concluído com sucesso');
      res.status(200).json({
        success: true,
        message: 'Bucket S3 configurado com sucesso',
        company_id: companyId,
        timestamp: new Date().toISOString()
      });

    } else if (req.method === 'GET') {
      // Test bucket access and configuration
      console.log('🧪 Testando acesso ao bucket...');
      const testResult = await S3BucketSetup.testBucketAccess(companyId);
      
      if (!testResult.success) {
        console.error('❌ Falha no teste:', testResult.error);
        res.status(500).json({
          success: false,
          error: testResult.error,
          details: testResult.details
        });
        return;
      }

      console.log('✅ Teste do bucket concluído');
      res.status(200).json({
        success: true,
        message: 'Teste do bucket executado com sucesso',
        company_id: companyId,
        test_results: testResult.data,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('❌ Erro no endpoint de setup S3:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.stack
    });
  }
}
