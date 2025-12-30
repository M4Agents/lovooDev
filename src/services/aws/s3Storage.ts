// AWS S3 Storage Operations
// Created: 2025-12-22
// Purpose: Upload, download and signed URL operations for S3

import { PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3ClientFactory } from './s3Client.js';
import { CredentialsManager } from './credentialsManager.js';
import { 
  S3UploadParams, 
  S3UploadResult, 
  MediaMetadata, 
  S3KeyStructure, 
  SignedUrlOptions, 
  UploadToS3Options,
  S3OperationResult 
} from './types.js';

export class S3Storage {
  /**
   * Generate S3 key structure based on company and metadata
   */
  static generateS3Key(options: {
    companyId: string;
    type: 'whatsapp' | 'profiles';
    messageId?: string;
    filename: string;
  }): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    if (options.type === 'whatsapp') {
      return `clientes/${options.companyId}/whatsapp/${year}/${month}/${day}/${options.messageId}/${options.filename}`;
    } else {
      return `clientes/${options.companyId}/profiles/${year}/${month}/${day}/${options.filename}`;
    }
  }

  /**
   * Upload file to S3
   */
  static async uploadToS3(options: UploadToS3Options): Promise<S3OperationResult<S3UploadResult>> {
    try {
      console.log('🚀 S3Storage.uploadToS3 - Iniciando upload:', {
        companyId: options.companyId,
        filename: options.originalFileName,
        size: options.buffer.length,
        contentType: options.contentType,
        source: options.source,
        messageId: options.messageId
      });

      // Get S3 client
      console.log('🔧 S3Storage - Obtendo S3 client para company:', options.companyId);
      const clientResult = await S3ClientFactory.getClient(options.companyId);
      
      if (!clientResult.success || !clientResult.data) {
        console.error('❌ S3Storage - Falha ao obter S3 client:', clientResult.error);
        return {
          success: false,
          error: clientResult.error || 'Erro ao obter S3 client'
        };
      }
      
      console.log('✅ S3Storage - S3 client obtido com sucesso');

      // Get credentials for bucket info
      console.log('🔧 S3Storage - Obtendo credenciais AWS para company:', options.companyId);
      const credentialsResult = await CredentialsManager.getCredentials(options.companyId);
      
      if (!credentialsResult.success || !credentialsResult.data) {
        console.error('❌ S3Storage - Falha ao obter credenciais:', credentialsResult.error);
        return {
          success: false,
          error: credentialsResult.error || 'Erro ao obter credenciais'
        };
      }

      const credentials = credentialsResult.data;
      const s3Client = clientResult.data;
      
      console.log('✅ S3Storage - Credenciais obtidas:', {
        bucket: credentials.bucket,
        region: credentials.region,
        hasAccessKey: !!credentials.access_key_id,
        hasSecretKey: !!credentials.secret_access_key
      });

      // Generate S3 key
      console.log('🔧 S3Storage - Gerando S3 key...');
      const s3Key = this.generateS3Key({
        companyId: options.companyId,
        type: options.source === 'profile' ? 'profiles' : 'whatsapp',
        messageId: options.messageId,
        filename: options.originalFileName
      });

      console.log('✅ S3Storage - S3 Key gerada:', s3Key);

      // Prepare upload command
      console.log('🔧 S3Storage - Preparando comando de upload...');
      const uploadCommand = new PutObjectCommand({
        Bucket: credentials.bucket,
        Key: s3Key,
        Body: options.buffer,
        ContentType: options.contentType,
        Metadata: {
          'company-id': options.companyId,
          'source': options.source,
          'message-id': options.messageId || '',
          'original-filename': options.originalFileName,
          'uploaded-at': new Date().toISOString()
        }
      });

      console.log('✅ S3Storage - Comando preparado:', {
        bucket: credentials.bucket,
        key: s3Key,
        contentType: options.contentType,
        bodySize: options.buffer.length
      });

      // Execute upload
      console.log('🚀 S3Storage - Executando upload para S3...');
      const uploadResult = await s3Client.send(uploadCommand);
      
      console.log('✅ S3Storage - Upload S3 concluído com sucesso!', {
        bucket: credentials.bucket,
        key: s3Key,
        etag: uploadResult.ETag,
        location: uploadResult.Location
      });

      return {
        success: true,
        data: {
          success: true,
          s3Key,
          bucket: credentials.bucket,
          region: credentials.region,
          contentType: options.contentType,
          sizeBytes: options.buffer.length,
          etag: uploadResult.ETag
        }
      };

    } catch (error: any) {
      console.error('❌ S3Storage - ERRO CRÍTICO no upload S3:', {
        message: error.message,
        name: error.name,
        code: error.code,
        statusCode: error.$metadata?.httpStatusCode,
        requestId: error.$metadata?.requestId,
        stack: error.stack
      });
      
      console.error('❌ S3Storage - Detalhes completos do erro:', error);
      
      return {
        success: false,
        error: `Erro no upload S3: ${error.message}`,
        details: error
      };
    }
  }

  /**
   * Generate direct public URL for S3 object (CORREÇÃO FINAL - SEM SIGNED URLS)
   */
  static async generateSignedUrl(
    companyId: string,
    s3Key: string,
    options: SignedUrlOptions = { expiresIn: 7200 }
  ): Promise<S3OperationResult<string>> {
    try {
      console.log('🔗 CORREÇÃO FINAL: Gerando URL direta (sem signed URL) para:', { companyId, s3Key });

      // Get credentials for bucket info
      const credentialsResult = await CredentialsManager.getCredentials(companyId);
      if (!credentialsResult.success || !credentialsResult.data) {
        return {
          success: false,
          error: credentialsResult.error || 'Erro ao obter credenciais'
        };
      }

      const credentials = credentialsResult.data;
      
      // CORREÇÃO FINAL: Gerar URL direta pública (sem signed URL)
      const directUrl = `https://${credentials.bucket}.s3.${credentials.region}.amazonaws.com/${s3Key}`;
      
      console.log('✅ CORREÇÃO FINAL: URL direta gerada (sem signed URL):', {
        bucket: credentials.bucket,
        region: credentials.region,
        s3Key: s3Key.substring(0, 50) + '...',
        directUrl: directUrl.substring(0, 100) + '...'
      });
      
      return {
        success: true,
        data: directUrl
      };

    } catch (error: any) {
      console.error('❌ Erro ao gerar URL direta:', error);
      return {
        success: false,
        error: `Erro ao gerar URL direta: ${error.message}`,
        details: error
      };
    }
  }

  /**
   * Check if object exists in S3
   */
  static async objectExists(companyId: string, s3Key: string): Promise<S3OperationResult<boolean>> {
    try {
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

      // Check object existence
      const headCommand = new HeadObjectCommand({
        Bucket: credentials.bucket,
        Key: s3Key
      });

      await s3Client.send(headCommand);
      return {
        success: true,
        data: true
      };

    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return {
          success: true,
          data: false
        };
      }

      console.error('❌ Erro ao verificar existência do objeto:', error);
      return {
        success: false,
        error: `Erro ao verificar objeto: ${error.message}`,
        details: error
      };
    }
  }

  /**
   * Get object metadata from S3
   */
  static async getObjectMetadata(companyId: string, s3Key: string): Promise<S3OperationResult<any>> {
    try {
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

      // Get object metadata
      const headCommand = new HeadObjectCommand({
        Bucket: credentials.bucket,
        Key: s3Key
      });

      const result = await s3Client.send(headCommand);
      return {
        success: true,
        data: {
          contentType: result.ContentType,
          contentLength: result.ContentLength,
          lastModified: result.LastModified,
          etag: result.ETag,
          metadata: result.Metadata
        }
      };

    } catch (error: any) {
      console.error('❌ Erro ao obter metadata do objeto:', error);
      return {
        success: false,
        error: `Erro ao obter metadata: ${error.message}`,
        details: error
      };
    }
  }

  /**
   * Helper to detect content type from buffer
   */
  static detectContentType(buffer: Buffer, filename: string): string {
    // Magic bytes detection
    const firstBytes = Array.from(buffer.slice(0, 8));
    
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (firstBytes[0] === 0x89 && firstBytes[1] === 0x50 && firstBytes[2] === 0x4E && firstBytes[3] === 0x47) {
      return 'image/png';
    }
    
    // JPEG: FF D8 FF
    if (firstBytes[0] === 0xFF && firstBytes[1] === 0xD8 && firstBytes[2] === 0xFF) {
      return 'image/jpeg';
    }
    
    // WebP: 52 49 46 46 ... 57 45 42 50
    if (firstBytes[0] === 0x52 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46 && firstBytes[3] === 0x46) {
      return 'image/webp';
    }
    
    // GIF: 47 49 46 38
    if (firstBytes[0] === 0x47 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46 && firstBytes[3] === 0x38) {
      return 'image/gif';
    }

    // MP4: Check for ftyp box
    if (buffer.length >= 12) {
      const ftypCheck = buffer.slice(4, 8).toString();
      if (ftypCheck === 'ftyp') {
        return 'video/mp4';
      }
    }

    // Fallback to extension-based detection
    const ext = filename.toLowerCase().split('.').pop();
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      case 'mp4':
        return 'video/mp4';
      case 'mp3':
        return 'audio/mpeg';
      case 'ogg':
        return 'audio/ogg';
      case 'wav':
        return 'audio/wav';
      case 'pdf':
        return 'application/pdf';
      default:
        return 'application/octet-stream';
    }
  }

  /**
   * List objects in S3 with prefix
   */
  static async listObjects(companyId: string, prefix: string): Promise<S3OperationResult<any[]>> {
    try {
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

      console.log('🔍 S3Storage.listObjects - Listando objetos:', {
        companyId,
        prefix,
        bucket: credentials.bucket
      });

      // List objects
      const listCommand = new ListObjectsV2Command({
        Bucket: credentials.bucket,
        Prefix: prefix,
        MaxKeys: 1000
      });

      const response = await s3Client.send(listCommand);
      
      if (!response.Contents) {
        console.log('📁 Nenhum objeto encontrado para prefix:', prefix);
        return {
          success: true,
          data: []
        };
      }

      // Process objects
      const objects = response.Contents
        .filter(obj => obj.Key && obj.Key !== prefix)
        .filter(obj => {
          const filename = obj.Key!.split('/').pop();
          const ext = filename?.split('.').pop()?.toLowerCase();
          return ext && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'ico', 'heic', 'heif',
                        'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', '3gp', 'mpg', 'mpeg',
                        'mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac', 'wma', 'amr',
                        'pdf', 'doc', 'docx', 'txt', 'rtf', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext);
        })
        .map(obj => {
          const filename = obj.Key!.split('/').pop()!;
          const ext = filename.split('.').pop()?.toLowerCase();
          
          let fileType = 'document';
          if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'ico', 'heic', 'heif'].includes(ext!)) {
            fileType = 'image';
          } else if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', '3gp', 'mpg', 'mpeg'].includes(ext!)) {
            fileType = 'video';
          } else if (['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac', 'wma', 'amr'].includes(ext!)) {
            fileType = 'audio';
          }

          return {
            id: `s3_real_${obj.Key!.replace(/[^a-zA-Z0-9]/g, '_')}`,
            s3_key: obj.Key!,
            original_filename: filename,
            file_type: fileType,
            mime_type: (() => {
              switch (ext) {
                case 'jpg':
                case 'jpeg':
                  return 'image/jpeg';
                case 'png':
                  return 'image/png';
                case 'gif':
                  return 'image/gif';
                case 'webp':
                  return 'image/webp';
                case 'mp4':
                  return 'video/mp4';
                case 'mp3':
                  return 'audio/mpeg';
                case 'ogg':
                  return 'audio/ogg';
                case 'wav':
                  return 'audio/wav';
                case 'pdf':
                  return 'application/pdf';
                default:
                  return 'application/octet-stream';
              }
            })(),
            file_size: obj.Size || 0,
            preview_url: `https://${credentials.bucket}.s3.${credentials.region}.amazonaws.com/${obj.Key}`,
            received_at: obj.LastModified?.toISOString() || new Date().toISOString(),
            created_at: obj.LastModified?.toISOString() || new Date().toISOString(),
            source: 'whatsapp_s3_real'
          };
        });

      console.log('✅ S3Storage.listObjects - Objetos processados:', objects.length);

      return {
        success: true,
        data: objects
      };

    } catch (error: any) {
      console.error('❌ Erro ao listar objetos S3:', error);
      return {
        success: false,
        error: `Erro ao listar objetos S3: ${error.message}`,
        details: error
      };
    }
  }
}
