// AWS S3 Types and Interfaces
// Created: 2025-12-22
// Purpose: TypeScript interfaces for AWS S3 integration

export interface AWSCredentials {
  id: string;
  company_id: string;
  access_key_id: string;
  secret_access_key: string;
  region: string;
  bucket: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface S3UploadParams {
  key: string;
  buffer: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface S3UploadResult {
  success: boolean;
  s3Key: string;
  bucket: string;
  region: string;
  contentType: string;
  sizeBytes: number;
  etag?: string;
  error?: string;
}

export interface MediaMetadata {
  tenantId: string;        // company_id
  s3Key: string;          // Full S3 key
  bucket: string;         // aws-lovoocrm-media
  region: string;         // sa-east-1
  contentType: string;    // image/jpeg, video/mp4, etc.
  sizeBytes: number;      // File size in bytes
  source: 'whatsapp' | 'frontend' | 'profile';
  messageId?: string;     // WhatsApp message ID (if applicable)
  createdAt: string;      // ISO timestamp
}

export interface S3KeyStructure {
  companyId: string;
  type: 'whatsapp' | 'profiles';
  year: string;
  month: string;
  day: string;
  messageId?: string;
  filename: string;
}

export interface SignedUrlOptions {
  expiresIn: number;      // Seconds (default: 7200 = 2 hours)
  responseContentType?: string;
  responseContentDisposition?: string;
}

export interface S3ClientConfig {
  region: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

export interface UploadToS3Options {
  companyId: string;
  messageId?: string;
  originalFileName: string;
  buffer: Buffer;
  contentType: string;
  source: MediaMetadata['source'];
}

export interface S3OperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  details?: any;
}
