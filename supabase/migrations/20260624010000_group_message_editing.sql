-- Migration: 20260624010000_group_message_editing.sql
-- Description: Adds Message Editing capabilities to the group messages module and integrates it with the Heartbeat.

-- 1. Alter public.messages to add edited_at
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Enforce Row-Level Security for updates
-- Assuming RLS is already enabled on public.messages, we just add the policy.
DROP POLICY IF EXISTS "Users can edit their own messages" ON public.messages;
CREATE POLICY "Users can edit their own messages" 
    ON public.messages FOR UPDATE 
    USING (auth.uid() = sender_id)
    WITH CHECK (auth.uid() = sender_id);

-- 3. Update update_last_seen() RPC to also return edited_messages
CREATE OR REPLACE FUNCTION public.update_last_seen()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_alert JSONB := NULL;
    v_recent_pool RECORD;
    v_edited_messages JSONB := '[]'::jsonb;
BEGIN
    -- Update last seen for the authenticated user
    UPDATE public.users 
    SET last_seen = NOW() 
    WHERE id = auth.uid();

    -- Check for any event pools that went LIVE in the last 3 minutes
    SELECT id, title INTO v_recent_pool
    FROM public.event_pools
    WHERE status = 'live' 
      AND updated_at >= (NOW() - INTERVAL '3 minutes')
    ORDER BY updated_at DESC
    LIMIT 1;

    IF FOUND THEN
        v_alert := jsonb_build_object(
            'pool_id', v_recent_pool.id,
            'title', 'Event Pool is Live!',
            'body', 'The event "' || v_recent_pool.title || '" has just started. Join now.',
            'type', 'status_change'
        );
    END IF;

    -- Check for winner published
    IF v_alert IS NULL THEN
        SELECT id, title INTO v_recent_pool
        FROM public.event_pools
        WHERE status = 'completed'
          AND result_published_at >= (NOW() - INTERVAL '3 minutes')
        ORDER BY result_published_at DESC
        LIMIT 1;

        IF FOUND THEN
            v_alert := jsonb_build_object(
                'pool_id', v_recent_pool.id,
                'title', 'Results Published!',
                'body', 'The winners for "' || v_recent_pool.title || '" have been announced.',
                'type', 'winner_published'
            );
        END IF;
    END IF;

    -- Fetch messages edited in the last 60 seconds for the user's active groups
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', m.id,
            'group_id', m.group_id,
            'content', m.content,
            'edited_at', m.edited_at
        )
    ), '[]'::jsonb) INTO v_edited_messages
    FROM public.messages m
    JOIN public.group_members gm ON m.group_id = gm.group_id
    WHERE gm.user_id = auth.uid()
      AND m.edited_at >= (NOW() - INTERVAL '1 minute');

    RETURN jsonb_build_object(
        'active_alert', v_alert,
        'edited_messages', v_edited_messages
    );
END;
$$;
