// AWS Credentials Manager
// Created: 2025-12-22
// Purpose: Manage AWS credentials securely from Supabase database

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AWSCredentials, S3OperationResult } from './types.js';

// Server-side Supabase client (Node.js / Vercel serverless) — lazy initialized.
// Using process.env because import.meta.env is a Vite-only construct unavailable at runtime.
let _serverClient: SupabaseClient | null = null;

function getServerSupabaseClient(): SupabaseClient {
  if (!_serverClient) {
    _serverClient = createClient(
      process.env.VITE_SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return _serverClient;
}

/**
 * Resolves the Supabase client to use for credential lookups.
 * - Node.js / Vercel serverless: service_role client via process.env
 * - Browser (Vite): frontend client loaded lazily (avoids importing import.meta.env in Node.js)
 * - Explicit override: provided client takes highest priority
 */
async function resolveClient(provided?: SupabaseClient): Promise<SupabaseClient> {
  if (provided) return provided;
  if (typeof window === 'undefined') {
    // Node.js context — must NOT use import.meta.env
    return getServerSupabaseClient();
  }
  // Browser context — safe to lazy-import Vite-built module
  const { supabase } = await import('../../lib/supabase');
  return supabase;
}

export class CredentialsManager {
  /**
   * Get active AWS credentials for a company.
   * @param supabaseClient Optional explicit client (useful when caller already has one)
   */
  static async getCredentials(
    companyId: string,
    supabaseClient?: SupabaseClient
  ): Promise<S3OperationResult<AWSCredentials>> {
    try {
      const client = await resolveClient(supabaseClient);
      console.log('🔐 Buscando credenciais AWS para company:', companyId);

      const { data, error } = await client
        .rpc('webhook_resolve_aws_credentials', { p_company_id: companyId });

      if (error) {
        console.error('❌ Erro ao buscar credenciais AWS:', error);
        return {
          success: false,
          error: `Erro ao buscar credenciais: ${error.message}`,
          details: error
        };
      }

      if (!data || data.length === 0) {
        console.error('❌ Nenhuma credencial AWS encontrada para company:', companyId);
        return {
          success: false,
          error: 'Nenhuma credencial AWS ativa encontrada para esta empresa'
        };
      }

      const credentials = data[0] as AWSCredentials;
      console.log('✅ Credenciais AWS encontradas para company:', companyId);
      return {
        success: true,
        data: credentials
      };

    } catch (error) {
      console.error('❌ Erro inesperado ao buscar credenciais:', error);
      return {
        success: false,
        error: 'Erro interno ao buscar credenciais AWS',
        details: error
      };
    }
  }

  /**
   * Create or update AWS credentials for a company
   */
  static async upsertCredentials(
    companyId: string,
    accessKeyId: string,
    secretAccessKey: string,
    region: string = 'sa-east-1',
    bucket: string = 'aws-lovoocrm-media'
  ): Promise<S3OperationResult<AWSCredentials>> {
    try {
      const client = await resolveClient();
      console.log('🔐 Atualizando credenciais AWS para company:', companyId);

      await client
        .from('aws_credentials')
        .update({ is_active: false })
        .eq('company_id', companyId);

      const { data, error } = await client
        .from('aws_credentials')
        .insert({
          company_id: companyId,
          access_key_id: accessKeyId,
          secret_access_key: secretAccessKey,
          region,
          bucket,
          is_active: true
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Erro ao salvar credenciais AWS:', error);
        return {
          success: false,
          error: `Erro ao salvar credenciais: ${error.message}`,
          details: error
        };
      }

      console.log('✅ Credenciais AWS salvas com sucesso para company:', companyId);
      return {
        success: true,
        data: data as AWSCredentials
      };

    } catch (error) {
      console.error('❌ Erro inesperado ao salvar credenciais:', error);
      return {
        success: false,
        error: 'Erro interno ao salvar credenciais AWS',
        details: error
      };
    }
  }

  /**
   * Validate AWS credentials by testing S3 access
   */
  static async validateCredentials(credentials: AWSCredentials): Promise<S3OperationResult<boolean>> {
    try {
      const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');

      const s3Client = new S3Client({
        region: credentials.region,
        credentials: {
          accessKeyId: credentials.access_key_id,
          secretAccessKey: credentials.secret_access_key,
        },
      });

      const command = new HeadBucketCommand({ Bucket: credentials.bucket });
      await s3Client.send(command);

      console.log('✅ Credenciais AWS validadas com sucesso');
      return {
        success: true,
        data: true
      };

    } catch (error: any) {
      console.error('❌ Erro na validação das credenciais AWS:', error);
      return {
        success: false,
        error: `Credenciais inválidas: ${error.message}`,
        details: error
      };
    }
  }

  /**
   * Get all credentials for a company (for admin purposes)
   */
  static async getAllCredentials(companyId: string): Promise<S3OperationResult<AWSCredentials[]>> {
    try {
      const client = await resolveClient();

      const { data, error } = await client
        .from('aws_credentials')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) {
        return {
          success: false,
          error: `Erro ao buscar credenciais: ${error.message}`,
          details: error
        };
      }

      return {
        success: true,
        data: data as AWSCredentials[]
      };

    } catch (error) {
      return {
        success: false,
        error: 'Erro interno ao buscar credenciais AWS',
        details: error
      };
    }
  }
}
