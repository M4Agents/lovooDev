// AWS Services Index
// Created: 2025-12-22
// Purpose: Export all AWS services for easy importing

export { S3ClientFactory } from './s3Client';
export { S3Storage } from './s3Storage';
export { CredentialsManager } from './credentialsManager';
export * from './types';

// Re-export commonly used functions for convenience
export const {
  uploadToS3,
  generateSignedUrl,
  objectExists,
  getObjectMetadata,
  detectContentType,
  generateS3Key
} = S3Storage;

export const {
  getClient,
  clearCache,
  clearAllCache,
  getClientConfig
} = S3ClientFactory;

export const {
  getCredentials,
  upsertCredentials,
  validateCredentials,
  getAllCredentials
} = CredentialsManager;
