// AWS S3 Client
// Created: 2025-12-22
// Purpose: S3 client factory with credentials management

import { S3Client } from '@aws-sdk/client-s3';
import { CredentialsManager } from './credentialsManager.js';
import { AWSCredentials, S3ClientConfig, S3OperationResult } from './types.js';

type CacheEntry = {
  client: S3Client;
  credentialId: string;
  updatedAt: string;
  identity: string;
  seq: number;
};

function credentialIdentity(credentials: AWSCredentials): string {
  const material = [
    credentials.id,
    credentials.access_key_id,
    credentials.secret_access_key,
  ].join('\0');
  let hash = 2166136261;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function sameCredential(entry: CacheEntry, credentials: AWSCredentials): boolean {
  return entry.credentialId === credentials.id
    && entry.updatedAt === credentials.updated_at
    && entry.identity === credentialIdentity(credentials);
}

function cachedIsNewer(entry: CacheEntry, credentials: AWSCredentials, seq: number): boolean {
  const cachedTime = Date.parse(entry.updatedAt);
  const fetchedTime = Date.parse(credentials.updated_at);
  if (Number.isFinite(cachedTime) && Number.isFinite(fetchedTime) && cachedTime !== fetchedTime) {
    return cachedTime > fetchedTime;
  }
  if (sameCredential(entry, credentials)) return false;
  return entry.seq > seq;
}

export class S3ClientFactory {
  private static clientCache = new Map<string, CacheEntry>();
  private static requestSeq = new Map<string, number>();

  /**
   * Get or create S3 client for a company.
   * A credencial é consultada antes de reutilizar o cliente.
   * A entrada é da empresa solicitada; a RPC resolve a credencial da empresa pai.
   */
  static async getClient(companyId: string): Promise<S3OperationResult<S3Client>> {
    const seq = (this.requestSeq.get(companyId) ?? 0) + 1;
    this.requestSeq.set(companyId, seq);

    try {
      const credentialsResult = await CredentialsManager.getCredentials(companyId);
      if (!credentialsResult.success || !credentialsResult.data) {
        return {
          success: false,
          error: credentialsResult.error || 'Credenciais não encontradas'
        };
      }

      const credentials = credentialsResult.data;
      const cached = this.clientCache.get(companyId);
      if (cached && sameCredential(cached, credentials)) {
        console.log('🔄 Usando S3 client do cache para company:', companyId);
        return {
          success: true,
          data: cached.client
        };
      }

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

      const current = this.clientCache.get(companyId);
      if (current && (sameCredential(current, credentials) || cachedIsNewer(current, credentials, seq))) {
        console.log('🔄 S3 client recente preservado para company:', companyId);
        return {
          success: true,
          data: current.client
        };
      }

      this.clientCache.set(companyId, {
        client: s3Client,
        credentialId: credentials.id,
        updatedAt: credentials.updated_at,
        identity: credentialIdentity(credentials),
        seq,
      });
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
   * Remove a entrada da empresa sem destruir o cliente já entregue.
   */
  static clearCache(companyId: string): void {
    this.clientCache.delete(companyId);
    console.log('🗑️ Cache do S3 client limpo para company:', companyId);
  }

  /**
   * Remove as entradas sem destruir clientes já entregues.
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
