-- Migration: Add 'video' and 'audio' to chat_scheduled_messages message_type constraint
-- Created: 2026-02-25 15:06 UTC-03:00
-- Purpose: Fix constraint violation when scheduling video/audio messages

-- Drop existing constraint
ALTER TABLE chat_scheduled_messages 
DROP CONSTRAINT IF EXISTS chat_scheduled_messages_message_type_check;

-- Add new constraint with all supported types
ALTER TABLE chat_scheduled_messages 
ADD CONSTRAINT chat_scheduled_messages_message_type_check 
CHECK (message_type IN ('text', 'image', 'video', 'audio', 'document'));

-- Verify constraint was created
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM pg_constraint 
    WHERE conname = 'chat_scheduled_messages_message_type_check'
  ) THEN
    RAISE NOTICE '✅ Constraint chat_scheduled_messages_message_type_check criado com sucesso';
  ELSE
    RAISE EXCEPTION '❌ Falha ao criar constraint';
  END IF;
END $$;
