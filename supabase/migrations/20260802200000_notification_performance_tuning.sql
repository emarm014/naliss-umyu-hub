-- Migration: Notification Performance Tuning & Partial Indexes
-- 
-- Description: Creates targeted partial indexes on notification_history, notification_jobs,
-- user_push_tokens, and notification_telemetry to accelerate unread badge counting, worker queue
-- polling, and receipt processing. Adds automatic stale token cleanup stored procedure.

-- 1. Partial index for ultra-fast unread count and OS badge calculations
CREATE INDEX IF NOT EXISTS idx_notification_history_user_unread 
    ON public.notification_history(user_id, is_read) 
    WHERE is_read = false;

-- 2. Index for fast notification history timeline pagination
CREATE INDEX IF NOT EXISTS idx_notification_history_user_created 
    ON public.notification_history(user_id, created_at DESC);

-- 3. Partial index for pending worker retry jobs
CREATE INDEX IF NOT EXISTS idx_notification_jobs_pending 
    ON public.notification_jobs(status, next_retry_at) 
    WHERE status = 'pending';

-- 4. Partial index for sent telemetry receipt worker lookups
CREATE INDEX IF NOT EXISTS idx_notification_telemetry_sent 
    ON public.notification_telemetry(status, created_at) 
    WHERE status = 'sent';

-- 5. Index for user push token resolution
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_id_updated 
    ON public.user_push_tokens(user_id, updated_at DESC);

-- 6. Index for active chat message queries
CREATE INDEX IF NOT EXISTS idx_messages_group_created 
    ON public.messages(group_id, created_at DESC) 
    WHERE is_deleted = false;

-- 7. Stored Procedure for Stale Push Token Maintenance
CREATE OR REPLACE FUNCTION public.cleanup_inactive_push_tokens()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted_count INT := 0;
BEGIN
    -- Delete push tokens not updated in over 90 days or orphaned
    WITH deleted_tokens AS (
        DELETE FROM public.user_push_tokens
        WHERE updated_at < NOW() - INTERVAL '90 days'
           OR user_id NOT IN (SELECT id FROM public.users WHERE status = 'active')
        RETURNING *
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted_tokens;

    RETURN v_deleted_count;
END;
$$;
