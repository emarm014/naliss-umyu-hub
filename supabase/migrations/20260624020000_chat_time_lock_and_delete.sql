-- Migration: 20260624020000_chat_time_lock_and_delete.sql
-- Description: Adds strict 1-hour time-lock for editing and soft-delete capabilities.

-- 1. Alter public.messages to add is_deleted
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- 2. Enforce Time-Lock on Row-Level Security for updates
DROP POLICY IF EXISTS "Users can edit their own messages" ON public.messages;
CREATE POLICY "Users can edit their own messages" 
    ON public.messages FOR UPDATE 
    USING (auth.uid() = sender_id AND created_at > now() - interval '1 hour')
    WITH CHECK (auth.uid() = sender_id AND created_at > now() - interval '1 hour');

-- Ensure hard delete is not allowed for users
DROP POLICY IF EXISTS "Users can delete their own messages" ON public.messages;
CREATE POLICY "Users can delete their own messages"
    ON public.messages FOR DELETE
    USING (false); -- Hard deletes blocked for clients

-- 3. Create soft_delete_message RPC
CREATE OR REPLACE FUNCTION public.soft_delete_message(p_message_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sender_id UUID;
    v_created_at TIMESTAMPTZ;
BEGIN
    -- Get message details
    SELECT sender_id, created_at INTO v_sender_id, v_created_at
    FROM public.messages
    WHERE id = p_message_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Message not found';
    END IF;

    -- Verify ownership
    IF v_sender_id != auth.uid() THEN
        RAISE EXCEPTION 'Not authorized to delete this message';
    END IF;

    -- Verify time window (1 hour)
    IF v_created_at <= now() - interval '1 hour' THEN
        RAISE EXCEPTION 'Message is older than 1 hour and cannot be deleted';
    END IF;

    -- Perform soft delete
    UPDATE public.messages
    SET is_deleted = TRUE,
        content = '',
        edited_at = NOW() -- Optionally track when it was deleted
    WHERE id = p_message_id;
END;
$$;
