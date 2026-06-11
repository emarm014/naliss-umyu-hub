-- Add reply_from_meta column to messages table to store parent message metadata for replies
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reply_from_meta JSONB;
