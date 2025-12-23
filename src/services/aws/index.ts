// AWS Services Index
// Created: 2025-12-22
// Purpose: Export all AWS services for easy importing

export { S3ClientFactory } from './s3Client.js';
export { S3Storage } from './s3Storage.js';
export { CredentialsManager } from './credentialsManager.js';
export * from './types.js';

// Re-export commonly used functions for convenience
export const uploadToS3 = S3Storage.uploadToS3.bind(S3Storage);
export const generateSignedUrl = S3Storage.generateSignedUrl.bind(S3Storage);
export const objectExists = S3Storage.objectExists.bind(S3Storage);
export const getObjectMetadata = S3Storage.getObjectMetadata.bind(S3Storage);
export const detectContentType = S3Storage.detectContentType.bind(S3Storage);
export const generateS3Key = S3Storage.generateS3Key.bind(S3Storage);

export const getClient = S3ClientFactory.getClient.bind(S3ClientFactory);
export const clearCache = S3ClientFactory.clearCache.bind(S3ClientFactory);
export const clearAllCache = S3ClientFactory.clearAllCache.bind(S3ClientFactory);
export const getClientConfig = S3ClientFactory.getClientConfig.bind(S3ClientFactory);

export const getCredentials = CredentialsManager.getCredentials.bind(CredentialsManager);
export const upsertCredentials = CredentialsManager.upsertCredentials.bind(CredentialsManager);
export const validateCredentials = CredentialsManager.validateCredentials.bind(CredentialsManager);
export const getAllCredentials = CredentialsManager.getAllCredentials.bind(CredentialsManager);
