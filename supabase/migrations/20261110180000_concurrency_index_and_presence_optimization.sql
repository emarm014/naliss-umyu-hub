-- =============================================================================
-- Migration: 20261110180000_concurrency_index_and_presence_optimization.sql
-- Purpose:
--   1. Drop redundant/duplicate indexes on high-write tables (messages,
--      group_members, notification_history) to reduce write amplification at
--      1,000+ users.
--   2. Add a partial index on messages(edited_at DESC) WHERE edited_at IS NOT NULL
--      so update_last_seen() never scans full group message histories.
--   3. Throttle public.update_last_seen() and public.update_last_active() so
--      UPDATE public.users SET last_active_at = NOW() only writes when
--      last_active_at is NULL or older than 3 minutes.
-- =============================================================================

-- 1. Drop redundant duplicate indexes
DROP INDEX IF EXISTS public.idx_messages_group_id;
DROP INDEX IF EXISTS public.idx_messages_flagged_deleted;
DROP INDEX IF EXISTS public.idx_group_members_group_user;
DROP INDEX IF EXISTS public.idx_group_members_user_id;
DROP INDEX IF EXISTS public.idx_notification_history_user_read;

-- 2. Partial index for edited messages lookup in update_last_seen()
CREATE INDEX IF NOT EXISTS idx_messages_edited_at
    ON public.messages (edited_at DESC)
    WHERE edited_at IS NOT NULL;

-- 3. Throttle update_last_active() to 3 minutes
CREATE OR REPLACE FUNCTION public.update_last_active()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  UPDATE public.users
  SET last_active_at = now()
  WHERE id = (SELECT auth.uid())
    AND (
      last_active_at IS NULL OR
      last_active_at < now() - interval '3 minutes'
    );
$function$;

-- 4. Throttle update_last_seen() write to 3 minutes while preserving alert & edit payloads
CREATE OR REPLACE FUNCTION public.update_last_seen()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_uid UUID := auth.uid();
    v_alert JSONB := NULL;
    v_recent_pool RECORD;
    v_edited_messages JSONB := '[]'::jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object(
            'active_alert', NULL,
            'edited_messages', '[]'::jsonb
        );
    END IF;

    -- Only write to public.users when last_active_at is older than 3 minutes
    UPDATE public.users
    SET last_active_at = NOW()
    WHERE id = v_uid
      AND (
          last_active_at IS NULL
          OR last_active_at < NOW() - INTERVAL '3 minutes'
      );

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
    WHERE gm.user_id = v_uid
      AND m.edited_at IS NOT NULL
      AND m.edited_at >= (NOW() - INTERVAL '1 minute');

    RETURN jsonb_build_object(
        'active_alert', v_alert,
        'edited_messages', v_edited_messages
    );
END;
$function$;
