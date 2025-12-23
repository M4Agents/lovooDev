// AWS S3 CORS Configuration
// Created: 2025-12-23
// Purpose: Configure CORS for S3 bucket to allow web access

import { PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { S3ClientFactory } from './s3Client.js';
import { CredentialsManager } from './credentialsManager.js';
import { S3OperationResult } from './types.js';

export class S3CorsConfig {
  /**
   * Configure CORS for S3 bucket to allow web access
   */
  static async configureBucketCors(companyId: string): Promise<S3OperationResult<boolean>> {
    try {
      console.log('🔧 Configurando CORS para bucket S3 da company:', companyId);

      // Get S3 client
      const clientResult = await S3ClientFactory.getClient(companyId);
      if (!clientResult.success || !clientResult.data) {
        return {
          success: false,
          error: clientResult.error || 'Erro ao obter S3 client'
        };
      }

      // Get credentials for bucket info
      const credentialsResult = await CredentialsManager.getCredentials(companyId);
      if (!credentialsResult.success || !credentialsResult.data) {
        return {
          success: false,
          error: credentialsResult.error || 'Erro ao obter credenciais'
        };
      }

      const credentials = credentialsResult.data;
      const s3Client = clientResult.data;

      // CORS configuration for web access
      const corsConfiguration = {
        CORSRules: [
          {
            ID: 'AllowWebAccess',
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET', 'HEAD'],
            AllowedOrigins: [
              'https://lovoo-dev.vercel.app',
              'https://loovocrm.vercel.app',
              'https://*.vercel.app',
              'http://localhost:3000',
              'http://localhost:5173'
            ],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600
          },
          {
            ID: 'AllowSignedUrls',
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET'],
            AllowedOrigins: ['*'],
            MaxAgeSeconds: 3600
          }
        ]
      };

      // Apply CORS configuration
      const corsCommand = new PutBucketCorsCommand({
        Bucket: credentials.bucket,
        CORSConfiguration: corsConfiguration
      });

      await s3Client.send(corsCommand);

      console.log('✅ CORS configurado com sucesso para bucket:', credentials.bucket);
      console.log('🌐 Origens permitidas:', corsConfiguration.CORSRules[0].AllowedOrigins);

      return {
        success: true,
        data: true
      };

    } catch (error: any) {
      console.error('❌ Erro ao configurar CORS:', error);
      return {
        success: false,
        error: `Erro ao configurar CORS: ${error.message}`,
        details: error
      };
    }
  }

  /**
   * Verify CORS configuration
   */
  static async verifyCorsConfig(companyId: string): Promise<S3OperationResult<any>> {
    try {
      // Import GetBucketCorsCommand dynamically
      const { GetBucketCorsCommand } = await import('@aws-sdk/client-s3');

      const clientResult = await S3ClientFactory.getClient(companyId);
      if (!clientResult.success || !clientResult.data) {
        return {
          success: false,
          error: clientResult.error || 'Erro ao obter S3 client'
        };
      }

      const credentialsResult = await CredentialsManager.getCredentials(companyId);
      if (!credentialsResult.success || !credentialsResult.data) {
        return {
          success: false,
          error: credentialsResult.error || 'Erro ao obter credenciais'
        };
      }

      const credentials = credentialsResult.data;
      const s3Client = clientResult.data;

      const corsCommand = new GetBucketCorsCommand({
        Bucket: credentials.bucket
      });

      const result = await s3Client.send(corsCommand);

      console.log('📋 Configuração CORS atual:', result.CORSRules);

      return {
        success: true,
        data: result.CORSRules
      };

    } catch (error: any) {
      console.error('❌ Erro ao verificar CORS:', error);
      return {
        success: false,
        error: `Erro ao verificar CORS: ${error.message}`,
        details: error
      };
    }
  }
}
