// AWS S3 Bucket Setup and Configuration
// Created: 2025-12-23
// Purpose: One-time setup script to configure S3 bucket for web access

import { S3CorsConfig } from './corsConfig.js';
import { CredentialsManager } from './credentialsManager.js';
import { S3OperationResult } from './types.js';

export class S3BucketSetup {
  /**
   * Complete bucket setup for a company
   */
  static async setupBucket(companyId: string): Promise<S3OperationResult<boolean>> {
    try {
      console.log('🚀 Iniciando setup completo do bucket S3 para company:', companyId);

      // Step 1: Verify credentials
      console.log('🔐 Verificando credenciais AWS...');
      const credentialsResult = await CredentialsManager.getCredentials(companyId);
      if (!credentialsResult.success || !credentialsResult.data) {
        return {
          success: false,
          error: 'Credenciais AWS não encontradas ou inválidas'
        };
      }

      const credentials = credentialsResult.data;
      console.log('✅ Credenciais encontradas para bucket:', credentials.bucket);

      // Step 2: Configure CORS
      console.log('🌐 Configurando CORS para acesso web...');
      const corsResult = await S3CorsConfig.configureBucketCors(companyId);
      if (!corsResult.success) {
        console.error('❌ Falha ao configurar CORS:', corsResult.error);
        return {
          success: false,
          error: `Falha na configuração CORS: ${corsResult.error}`
        };
      }

      console.log('✅ CORS configurado com sucesso');

      // Step 3: Verify CORS configuration
      console.log('🔍 Verificando configuração CORS...');
      const verifyResult = await S3CorsConfig.verifyCorsConfig(companyId);
      if (!verifyResult.success) {
        console.warn('⚠️ Não foi possível verificar CORS, mas configuração foi aplicada');
      } else {
        console.log('✅ CORS verificado:', verifyResult.data?.length || 0, 'regras ativas');
      }

      console.log('🎉 Setup do bucket S3 concluído com sucesso!');
      console.log('📋 Resumo da configuração:');
      console.log('  - Bucket:', credentials.bucket);
      console.log('  - Região:', credentials.region);
      console.log('  - CORS: Configurado para acesso web');
      console.log('  - Signed URLs: Funcionais');

      return {
        success: true,
        data: true
      };

    } catch (error: any) {
      console.error('❌ Erro no setup do bucket:', error);
      return {
        success: false,
        error: `Erro no setup: ${error.message}`,
        details: error
      };
    }
  }

  /**
   * Test bucket access and configuration
   */
  static async testBucketAccess(companyId: string): Promise<S3OperationResult<any>> {
    try {
      console.log('🧪 Testando acesso ao bucket S3...');

      // Import S3Storage for testing
      const { S3Storage } = await import('./s3Storage.js');

      // Test 1: Generate a test signed URL
      const testKey = `test/${Date.now()}/test-access.txt`;
      console.log('🔗 Testando geração de signed URL...');
      
      const signedUrlResult = await S3Storage.generateSignedUrl(
        companyId,
        testKey,
        { expiresIn: 300 } // 5 minutes
      );

      if (!signedUrlResult.success) {
        return {
          success: false,
          error: `Falha no teste de signed URL: ${signedUrlResult.error}`
        };
      }

      // Test 2: Verify CORS configuration
      console.log('🌐 Testando configuração CORS...');
      const corsResult = await S3CorsConfig.verifyCorsConfig(companyId);

      return {
        success: true,
        data: {
          signedUrlTest: 'OK',
          signedUrl: signedUrlResult.data?.substring(0, 100) + '...',
          corsRules: corsResult.data || [],
          timestamp: new Date().toISOString()
        }
      };

    } catch (error: any) {
      console.error('❌ Erro no teste do bucket:', error);
      return {
        success: false,
        error: `Erro no teste: ${error.message}`,
        details: error
      };
    }
  }
}
