// AWS S3 Client
// Created: 2025-12-22
// Purpose: S3 client factory with credentials management

import { S3Client } from '@aws-sdk/client-s3';
import { CredentialsManager } from './credentialsManager';
import { S3ClientConfig, S3OperationResult } from './types';

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
      const s3Client = new S3Client({
        region: credentials.region,
        credentials: {
          accessKeyId: credentials.access_key_id,
          secretAccessKey: credentials.secret_access_key,
        },
      });

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
