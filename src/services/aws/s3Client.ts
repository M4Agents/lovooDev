// AWS S3 Client
// Created: 2025-12-22
// Purpose: S3 client factory with credentials management

import { S3Client } from '@aws-sdk/client-s3';
import { CredentialsManager } from './credentialsManager.js';
import { S3ClientConfig, S3OperationResult } from './types.js';

export class S3ClientFactory {
  private static clientCache = new Map<string, S3Client>();

  /**
   * Get or create S3 client for a company
   */
  static async getClient(companyId: string): Promise<S3OperationResult<S3Client>> {
    try {
      // Check cache first
      const cacheKey = `s3_client_${companyId}`;
      if (this.clientCache.has(cacheKey)) {
        console.log('🔄 Usando S3 client do cache para company:', companyId);
        return {
          success: true,
          data: this.clientCache.get(cacheKey)!
        };
      }

      // Get credentials from database
      const credentialsResult = await CredentialsManager.getCredentials(companyId);
      if (!credentialsResult.success || !credentialsResult.data) {
        return {
          success: false,
          error: credentialsResult.error || 'Credenciais não encontradas'
        };
      }

      const credentials = credentialsResult.data;

      // Create S3 client
      // requestChecksumCalculation: 'WHEN_REQUIRED' desativa o comportamento padrão
      // do SDK v3 >= 3.577 que adiciona SHA256 ao CreateMultipartUpload mas não
      // propaga para as partes individuais, causando erro 400 do S3.
      const s3Client = new S3Client({
        region: credentials.region,
        credentials: {
          accessKeyId: credentials.access_key_id,
          secretAccessKey: credentials.secret_access_key,
        },
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });

      // #region agent log
      fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f28051'},body:JSON.stringify({sessionId:'f28051',location:'s3Client.ts:new-client',message:'S3Client criado com requestChecksumCalculation WHEN_REQUIRED',data:{companyId,region:credentials.region,checksumFix:'WHEN_REQUIRED'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      // Cache the client
      this.clientCache.set(cacheKey, s3Client);
      console.log('✅ S3 client criado e cacheado para company:', companyId);

      return {
        success: true,
        data: s3Client
      };

    } catch (error: any) {
      console.error('❌ Erro ao criar S3 client:', error);
      return {
        success: false,
        error: `Erro ao criar S3 client: ${error.message}`,
        details: error
      };
    }
  }

  /**
   * Clear client cache for a company (useful when credentials change)
   */
  static clearCache(companyId: string): void {
    const cacheKey = `s3_client_${companyId}`;
    this.clientCache.delete(cacheKey);
    console.log('🗑️ Cache do S3 client limpo para company:', companyId);
  }

  /**
   * Clear all cached clients
   */
  static clearAllCache(): void {
    this.clientCache.clear();
    console.log('🗑️ Cache de todos os S3 clients limpo');
  }

  /**
   * Get client configuration for a company
   */
  static async getClientConfig(companyId: string): Promise<S3OperationResult<S3ClientConfig>> {
    try {
      const credentialsResult = await CredentialsManager.getCredentials(companyId);
      if (!credentialsResult.success || !credentialsResult.data) {
        return {
          success: false,
          error: credentialsResult.error || 'Credenciais não encontradas'
        };
      }

      const credentials = credentialsResult.data;

      return {
        success: true,
        data: {
          region: credentials.region,
          credentials: {
            accessKeyId: credentials.access_key_id,
            secretAccessKey: credentials.secret_access_key,
          },
        }
      };

    } catch (error: any) {
      return {
        success: false,
        error: `Erro ao obter configuração: ${error.message}`,
        details: error
      };
    }
  }
}
