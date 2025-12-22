-- Migration: Add AWS credentials table for S3 integration
-- Created: 2025-12-22
-- Purpose: Store AWS credentials securely per company for S3 media storage

-- Create aws_credentials table
CREATE TABLE IF NOT EXISTS aws_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  access_key_id TEXT NOT NULL,
  secret_access_key TEXT NOT NULL, -- Will be encrypted at application level
  region TEXT NOT NULL DEFAULT 'sa-east-1',
  bucket TEXT NOT NULL DEFAULT 'aws-lovoocrm-media',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure one active credential per company
  CONSTRAINT unique_active_credential_per_company 
    EXCLUDE (company_id WITH =) WHERE (is_active = true)
);

-- Enable RLS for security isolation
ALTER TABLE aws_credentials ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Companies can only access their own credentials
CREATE POLICY "aws_credentials_company_isolation" ON aws_credentials
  FOR ALL USING (
    company_id IN (
      SELECT company_id 
      FROM users 
      WHERE id = auth.uid()
    )
  );

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_aws_credentials_company_id ON aws_credentials(company_id);
CREATE INDEX IF NOT EXISTS idx_aws_credentials_active ON aws_credentials(company_id, is_active) WHERE is_active = true;

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_aws_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_aws_credentials_updated_at
  BEFORE UPDATE ON aws_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_aws_credentials_updated_at();

-- Add comments for documentation
COMMENT ON TABLE aws_credentials IS 'AWS S3 credentials stored per company for secure media storage';
COMMENT ON COLUMN aws_credentials.company_id IS 'Reference to company owning these credentials';
COMMENT ON COLUMN aws_credentials.access_key_id IS 'AWS Access Key ID';
COMMENT ON COLUMN aws_credentials.secret_access_key IS 'AWS Secret Access Key (encrypted at app level)';
COMMENT ON COLUMN aws_credentials.region IS 'AWS region for S3 bucket';
COMMENT ON COLUMN aws_credentials.bucket IS 'S3 bucket name for media storage';
COMMENT ON COLUMN aws_credentials.is_active IS 'Whether this credential set is currently active';
