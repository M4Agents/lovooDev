-- Add is_hidden column to funnel_stages table
-- This allows stages to be hidden from the visual funnel while maintaining their functionality

ALTER TABLE funnel_stages 
ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;

-- Add comment to document the column
COMMENT ON COLUMN funnel_stages.is_hidden IS 'Whether this stage should be hidden from the visual funnel board';
