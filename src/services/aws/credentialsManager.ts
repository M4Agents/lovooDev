// AWS Credentials Manager
// Created: 2025-12-22
// Purpose: Manage AWS credentials securely from Supabase database

import { AWSCredentials, S3OperationResult } from './types.js';
import { supabase } from '../../lib/supabase-webhook.js';

export class CredentialsManager {
  /**
   * Get active AWS credentials for a company
   */
  static async getCredentials(companyId: string): Promise<S3OperationResult<AWSCredentials>> {
    try {
      console.log('🔐 Buscando credenciais AWS para company:', companyId);

      // Usar função SECURITY DEFINER para contornar RLS (mesmo padrão do webhook_get_company_by_id)
      const { data, error } = await supabase
        .rpc('webhook_get_aws_credentials', { p_company_id: companyId });

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

      // A função RPC retorna array, pegar primeiro item
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
      console.log('🔐 Atualizando credenciais AWS para company:', companyId);

      // First, deactivate any existing credentials
      await supabase
        .from('aws_credentials')
        .update({ is_active: false })
        .eq('company_id', companyId);

      // Insert new credentials
      const { data, error } = await supabase
        .from('aws_credentials')
        .insert({
          company_id: companyId,
          access_key_id: accessKeyId,
          secret_access_key: secretAccessKey, // TODO: Encrypt this
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
      // Import AWS SDK dynamically to avoid issues
      const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');

      const s3Client = new S3Client({
        region: credentials.region,
        credentials: {
          accessKeyId: credentials.access_key_id,
          secretAccessKey: credentials.secret_access_key,
        },
      });

      // Test bucket access
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
      const { data, error } = await supabase
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
