-- Migration: Server-Authoritative Chat Push Notification Trigger
-- 
-- Description: Moves chat push notification generation from the client app to a
-- server-side PostgreSQL trigger on public.messages table insertion.
-- When a message is committed to the database, the trigger automatically fetches
-- recipients, formats WhatsApp-style previews, inserts a job into public.notification_jobs,
-- and dispatches it via Edge Functions.

CREATE OR REPLACE FUNCTION public.enqueue_chat_message_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_group_name TEXT;
    v_sender_name TEXT;
    v_target_user_ids UUID[];
    v_preview TEXT;
BEGIN
    -- Only trigger for non-deleted, active chat messages
    IF NEW.is_deleted IS TRUE THEN
        RETURN NEW;
    END IF;

    -- 1. Fetch group name
    SELECT name INTO v_group_name
    FROM public.groups
    WHERE id = NEW.group_id;

    IF v_group_name IS NULL THEN
        v_group_name := 'Group Chat';
    END IF;

    -- 2. Fetch sender display name
    SELECT COALESCE(NULLIF(username, ''), NULLIF(full_name, ''), 'Someone') INTO v_sender_name
    FROM public.users
    WHERE id = NEW.sender_id;

    IF v_sender_name IS NULL THEN
        v_sender_name := 'Someone';
    END IF;

    -- 3. Fetch recipient user IDs (group members excluding sender)
    SELECT ARRAY_AGG(user_id) INTO v_target_user_ids
    FROM public.group_members
    WHERE group_id = NEW.group_id
      AND user_id != NEW.sender_id;

    -- If no other group members exist, exit cleanly
    IF v_target_user_ids IS NULL OR ARRAY_LENGTH(v_target_user_ids, 1) IS NULL THEN
        RETURN NEW;
    END IF;

    -- 4. Format preview text based on message_type
    IF NEW.message_type = 'image' THEN
        v_preview := COALESCE(NULLIF(NEW.content, ''), '📷 Photo');
        IF v_preview NOT LIKE '📷%' THEN v_preview := '📷 ' || v_preview; END IF;
    ELSIF NEW.message_type = 'video' THEN
        v_preview := COALESCE(NULLIF(NEW.content, ''), '📹 Video');
        IF v_preview NOT LIKE '📹%' THEN v_preview := '📹 ' || v_preview; END IF;
    ELSIF NEW.message_type = 'audio' THEN
        v_preview := '🎙️ Voice message';
    ELSIF NEW.message_type = 'document' THEN
        v_preview := COALESCE(NULLIF(NEW.content, ''), '📄 Document');
        IF v_preview NOT LIKE '📄%' THEN v_preview := '📄 ' || v_preview; END IF;
    ELSE
        v_preview := COALESCE(NEW.content, 'Sent a message');
        IF LENGTH(v_preview) > 60 THEN
            v_preview := SUBSTRING(v_preview FROM 1 FOR 60) || '…';
        END IF;
    END IF;

    -- 5. Insert job into notification_jobs retry queue
    INSERT INTO public.notification_jobs (
        notification_id,
        target_user_ids,
        title,
        body,
        data,
        status,
        next_retry_at
    ) VALUES (
        NEW.id::text,
        v_target_user_ids,
        v_group_name,
        v_sender_name || ': ' || v_preview,
        jsonb_build_object(
            'type', 'message',
            'group_id', NEW.group_id::text,
            'id', NEW.id::text
        ),
        'pending',
        NOW()
    );

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Prevent notification generation failure from rolling back the message insert
    RAISE WARNING '[enqueue_chat_message_notification] Error: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS tr_enqueue_chat_message_notification ON public.messages;

-- Create AFTER INSERT trigger on public.messages
CREATE TRIGGER tr_enqueue_chat_message_notification
    AFTER INSERT ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION public.enqueue_chat_message_notification();
