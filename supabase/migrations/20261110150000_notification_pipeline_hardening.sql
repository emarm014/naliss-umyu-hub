-- Migration: 20261110150000_notification_pipeline_hardening.sql
-- Description: Production hardening of the Expo/Supabase push notification pipeline.
--
--   1. Discards the stale, never-processed notification backlog (fresh start).
--   2. Per-device delivery tracking (notification_telemetry unique per push token).
--   3. Atomic queue claiming (FOR UPDATE SKIP LOCKED) with reclaimable leases and
--      per-token retry lists for notification_jobs.
--   4. Atomic promotion of due scheduled_notifications into the job queue.
--   5. Safe push token registration/removal RPCs (Expo tokens only, one owner per device).
--   6. Removes the broad notification_telemetry policies.
--   7. Sender rate-limit audit table (used by the push-notification Edge Function).
--   8. Server-authoritative chat notifications (chunked, sticker-aware) and an
--      immediate worker "kick" whenever jobs are queued.
--   9. Secure recurring calls (pg_cron + pg_net) to notification-worker and push-receipts.
--
-- SECRETS: No secret values live in this file. The cron jobs and worker kick read the
-- project URL and the shared internal secret from Supabase Vault at runtime:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<same value as the PUSH_INTERNAL_SECRET edge secret>', 'push_internal_secret');
-- Until both secrets exist the calls are skipped with a WARNING (nothing breaks).

-- ========================================================================
-- 1. FRESH START: discard the stale backlog
-- ========================================================================
ALTER TABLE public.notification_jobs DROP CONSTRAINT IF EXISTS notification_jobs_status_check;
ALTER TABLE public.notification_jobs
  ADD CONSTRAINT notification_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired'));

UPDATE public.notification_jobs
SET status = 'expired',
    last_error = 'Discarded during notification pipeline upgrade (stale backlog)',
    updated_at = NOW()
WHERE status IN ('pending', 'processing');

UPDATE public.scheduled_notifications
SET status = 'expired',
    updated_at = NOW()
WHERE status = 'pending'
  AND send_at <= NOW();

-- ========================================================================
-- 2. QUEUE COLUMNS: leases + per-token retry list
-- ========================================================================
ALTER TABLE public.notification_jobs
  ADD COLUMN IF NOT EXISTS lease_token UUID,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retry_tokens TEXT[];

CREATE INDEX IF NOT EXISTS idx_notification_jobs_lease
  ON public.notification_jobs (lease_expires_at)
  WHERE status = 'processing';

-- ========================================================================
-- 3. PER-DEVICE TELEMETRY
-- ========================================================================
UPDATE public.notification_telemetry SET push_token = '' WHERE push_token IS NULL;
ALTER TABLE public.notification_telemetry ALTER COLUMN push_token SET DEFAULT '';
ALTER TABLE public.notification_telemetry ALTER COLUMN push_token SET NOT NULL;

ALTER TABLE public.notification_telemetry DROP CONSTRAINT IF EXISTS uq_user_notification;
ALTER TABLE public.notification_telemetry DROP CONSTRAINT IF EXISTS uq_telemetry_user_notification_device;
ALTER TABLE public.notification_telemetry
  ADD CONSTRAINT uq_telemetry_user_notification_device UNIQUE (user_id, notification_id, push_token);

CREATE INDEX IF NOT EXISTS idx_notification_telemetry_ticket_pending
  ON public.notification_telemetry (created_at)
  WHERE status = 'sent' AND expo_ticket_id IS NOT NULL;

-- Client-side telemetry (delivered / opened / dismissed), now device-aware.
DROP FUNCTION IF EXISTS public.log_notification_telemetry(TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.log_notification_telemetry(
    p_notification_id TEXT,
    p_type TEXT,
    p_status TEXT,
    p_platform TEXT,
    p_device_info TEXT,
    p_push_token TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_token TEXT := COALESCE(NULLIF(p_push_token, ''), '');
BEGIN
    IF v_uid IS NULL OR p_notification_id IS NULL OR p_notification_id = '' THEN
        RETURN;
    END IF;

    IF p_status NOT IN ('delivered', 'opened', 'dismissed', 'failed') THEN
        RAISE EXCEPTION 'Invalid telemetry status: %', p_status;
    END IF;

    -- Without a device token, update this user's existing device rows (never downgrade "opened").
    IF v_token = '' THEN
        UPDATE public.notification_telemetry
        SET status = CASE WHEN status = 'opened' AND p_status = 'delivered' THEN status ELSE p_status END,
            platform = COALESCE(p_platform, platform),
            device_info = COALESCE(p_device_info, device_info),
            updated_at = NOW()
        WHERE user_id = v_uid
          AND notification_id = p_notification_id;
        IF FOUND THEN
            RETURN;
        END IF;
    END IF;

    INSERT INTO public.notification_telemetry (notification_id, user_id, type, status, platform, device_info, push_token)
    VALUES (p_notification_id, v_uid, COALESCE(NULLIF(p_type, ''), 'general'), p_status, p_platform, p_device_info, v_token)
    ON CONFLICT (user_id, notification_id, push_token) DO UPDATE
    SET status = CASE
                    WHEN notification_telemetry.status = 'opened' AND EXCLUDED.status = 'delivered' THEN notification_telemetry.status
                    ELSE EXCLUDED.status
                 END,
        platform = COALESCE(EXCLUDED.platform, notification_telemetry.platform),
        device_info = COALESCE(EXCLUDED.device_info, notification_telemetry.device_info),
        updated_at = NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.log_notification_telemetry(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_notification_telemetry(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ========================================================================
-- 4. TELEMETRY RLS: remove the broad policies
-- ========================================================================
DROP POLICY IF EXISTS "Authenticated users access notification_telemetry" ON public.notification_telemetry;
DROP POLICY IF EXISTS "Authenticated users view notification_telemetry" ON public.notification_telemetry;
DROP POLICY IF EXISTS "Users insert notification_telemetry" ON public.notification_telemetry;
DROP POLICY IF EXISTS "Users update notification_telemetry" ON public.notification_telemetry;
DROP POLICY IF EXISTS "Admins delete notification_telemetry" ON public.notification_telemetry;
DROP POLICY IF EXISTS "Users can insert their own telemetry" ON public.notification_telemetry;
DROP POLICY IF EXISTS "Users can update their own telemetry" ON public.notification_telemetry;
DROP POLICY IF EXISTS "Users can read their own telemetry" ON public.notification_telemetry;

-- Users see only their own rows; admins/moderators can audit. All writes go through
-- the SECURITY DEFINER RPC above or the service role (Edge Functions).
CREATE POLICY "Users read own notification_telemetry"
  ON public.notification_telemetry
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id OR public.is_admin_or_moderator());

CREATE POLICY "Admins delete notification_telemetry"
  ON public.notification_telemetry
  FOR DELETE
  TO authenticated
  USING (public.is_admin_or_moderator());

REVOKE INSERT, UPDATE ON public.notification_telemetry FROM anon, authenticated;

-- Aggregated analytics are admin-only.
CREATE OR REPLACE FUNCTION public.get_notification_analytics()
RETURNS TABLE (
    total_sent BIGINT,
    total_delivered BIGINT,
    total_opened BIGINT,
    total_failed BIGINT,
    delivery_rate NUMERIC,
    open_rate NUMERIC,
    failure_rate NUMERIC,
    android_count BIGINT,
    ios_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin_or_moderator() THEN
        RAISE EXCEPTION 'Forbidden';
    END IF;

    RETURN QUERY
    SELECT
        count(*) AS total_sent,
        count(*) FILTER (WHERE status = 'delivered') AS total_delivered,
        count(*) FILTER (WHERE status = 'opened') AS total_opened,
        count(*) FILTER (WHERE status = 'failed') AS total_failed,
        round(COALESCE((count(*) FILTER (WHERE status = 'delivered')::numeric / nullif(count(*), 0) * 100), 0), 2) AS delivery_rate,
        round(COALESCE((count(*) FILTER (WHERE status = 'opened')::numeric / nullif(count(*), 0) * 100), 0), 2) AS open_rate,
        round(COALESCE((count(*) FILTER (WHERE status = 'failed')::numeric / nullif(count(*), 0) * 100), 0), 2) AS failure_rate,
        count(*) FILTER (WHERE platform = 'android') AS android_count,
        count(*) FILTER (WHERE platform = 'ios') AS ios_count
    FROM public.notification_telemetry;
END;
$$;

REVOKE ALL ON FUNCTION public.get_notification_analytics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_notification_analytics() TO authenticated;

-- ========================================================================
-- 5. PUSH TOKENS: purge invalid (non-Expo) tokens, safe register/remove RPCs
-- ========================================================================
DELETE FROM public.user_push_tokens
WHERE push_token IS NULL
   OR push_token !~ '^Expo(nent)?PushToken\[.+\]$';

UPDATE public.users u
SET push_token = (
    SELECT t.push_token
    FROM public.user_push_tokens t
    WHERE t.user_id = u.id
    ORDER BY t.updated_at DESC NULLS LAST
    LIMIT 1
)
WHERE u.push_token IS NOT NULL
  AND u.push_token !~ '^Expo(nent)?PushToken\[.+\]$';

-- Registers the caller's Expo push token. A physical device belongs to exactly one
-- account: the token is detached from any other account first (prevents user A's
-- chats from appearing on user B's phone after an offline logout).
CREATE OR REPLACE FUNCTION public.register_push_token(p_token TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF p_token IS NULL OR p_token !~ '^Expo(nent)?PushToken\[.+\]$' THEN
        RAISE EXCEPTION 'Invalid Expo push token';
    END IF;

    DELETE FROM public.user_push_tokens
    WHERE push_token = p_token
      AND user_id <> v_uid;

    UPDATE public.users u
    SET push_token = (
        SELECT t.push_token
        FROM public.user_push_tokens t
        WHERE t.user_id = u.id
        ORDER BY t.updated_at DESC NULLS LAST
        LIMIT 1
    )
    WHERE u.id <> v_uid
      AND u.push_token = p_token;

    INSERT INTO public.user_push_tokens (user_id, push_token, updated_at)
    VALUES (v_uid, p_token, NOW())
    ON CONFLICT (user_id, push_token) DO UPDATE
    SET updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_token(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT) TO authenticated;

-- Removes a token that Expo reported as DeviceNotRegistered (service role only).
CREATE OR REPLACE FUNCTION public.remove_push_token(p_token TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INT;
BEGIN
    IF p_token IS NULL OR p_token = '' THEN
        RETURN 0;
    END IF;

    DELETE FROM public.user_push_tokens WHERE push_token = p_token;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    UPDATE public.users u
    SET push_token = (
        SELECT t.push_token
        FROM public.user_push_tokens t
        WHERE t.user_id = u.id
        ORDER BY t.updated_at DESC NULLS LAST
        LIMIT 1
    )
    WHERE u.push_token = p_token;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_push_token(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_push_token(TEXT) TO service_role;

-- ========================================================================
-- 6. ATOMIC QUEUE CLAIM WITH RECLAIMABLE LEASES
-- ========================================================================
CREATE OR REPLACE FUNCTION public.claim_notification_jobs(
    p_limit INT DEFAULT 20,
    p_lease_seconds INT DEFAULT 120
)
RETURNS SETOF public.notification_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Jobs whose lease expired too many times are failed permanently (poison-pill guard).
    UPDATE public.notification_jobs
    SET status = 'failed',
        last_error = COALESCE(last_error, 'Lease expired too many times'),
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = NOW()
    WHERE status = 'processing'
      AND lease_expires_at < NOW()
      AND retry_count + 1 >= max_retry;

    RETURN QUERY
    WITH candidates AS (
        SELECT j.id
        FROM public.notification_jobs j
        WHERE (j.status = 'pending' AND j.next_retry_at <= NOW())
           OR (j.status = 'processing' AND j.lease_expires_at < NOW())
        ORDER BY j.next_retry_at ASC
        LIMIT GREATEST(1, LEAST(p_limit, 100))
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.notification_jobs j
    SET status = 'processing',
        -- A reclaimed (crashed) lease counts as an attempt.
        retry_count = CASE WHEN j.status = 'processing' THEN j.retry_count + 1 ELSE j.retry_count END,
        lease_token = gen_random_uuid(),
        lease_expires_at = NOW() + make_interval(secs => GREATEST(30, p_lease_seconds)),
        updated_at = NOW()
    FROM candidates c
    WHERE j.id = c.id
    RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_notification_jobs(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_jobs(INT, INT) TO service_role;

-- ========================================================================
-- 7. ATOMIC PROMOTION OF DUE SCHEDULED NOTIFICATIONS
-- ========================================================================
CREATE OR REPLACE FUNCTION public.promote_due_scheduled_notifications(p_limit INT DEFAULT 50)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r RECORD;
    v_total INT;
    v_offset INT;
    v_promoted INT := 0;
BEGIN
    FOR r IN
        SELECT *
        FROM public.scheduled_notifications
        WHERE status = 'pending'
          AND send_at <= NOW()
        ORDER BY send_at ASC
        LIMIT GREATEST(1, LEAST(p_limit, 200))
        FOR UPDATE SKIP LOCKED
    LOOP
        IF r.expires_at IS NOT NULL AND r.expires_at <= NOW() THEN
            UPDATE public.scheduled_notifications
            SET status = 'expired', updated_at = NOW()
            WHERE id = r.id;
            CONTINUE;
        END IF;

        v_total := COALESCE(array_length(r.target_user_ids, 1), 0);
        v_offset := 1;
        -- Chunk large audiences (1000 recipients per job).
        WHILE v_offset <= v_total LOOP
            INSERT INTO public.notification_jobs (notification_id, target_user_ids, title, body, data, status, next_retry_at)
            VALUES (
                r.id::text,
                r.target_user_ids[v_offset : LEAST(v_offset + 999, v_total)],
                r.title,
                r.body,
                COALESCE(r.data, '{}'::jsonb),
                'pending',
                NOW()
            );
            v_offset := v_offset + 1000;
        END LOOP;

        UPDATE public.scheduled_notifications
        SET status = 'sent', updated_at = NOW()
        WHERE id = r.id;

        v_promoted := v_promoted + 1;
    END LOOP;

    RETURN v_promoted;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_due_scheduled_notifications(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_due_scheduled_notifications(INT) TO service_role;

-- ========================================================================
-- 8. BADGE COUNTS (one grouped query instead of fetching every unread row)
-- ========================================================================
CREATE OR REPLACE FUNCTION public.get_unread_notification_counts(p_user_ids UUID[])
RETURNS TABLE (user_id UUID, unread_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT h.user_id, count(*)::BIGINT
    FROM public.notification_history h
    WHERE h.user_id = ANY (p_user_ids)
      AND h.is_read = false
    GROUP BY h.user_id;
$$;

REVOKE ALL ON FUNCTION public.get_unread_notification_counts(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_counts(UUID[]) TO service_role;

-- ========================================================================
-- 9. SENDER RATE-LIMIT AUDIT (service role only)
-- ========================================================================
CREATE TABLE IF NOT EXISTS public.push_send_audit (
    id BIGSERIAL PRIMARY KEY,
    sender_id UUID NOT NULL,
    notif_type TEXT NOT NULL,
    recipient_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_send_audit_sender_time
  ON public.push_send_audit (sender_id, created_at DESC);

ALTER TABLE public.push_send_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_send_audit FROM anon, authenticated;

-- ========================================================================
-- 10. SECURE EDGE FUNCTION INVOKER (reads URL + secret from Vault)
-- ========================================================================
CREATE OR REPLACE FUNCTION public.invoke_notification_function(
    p_function TEXT,
    p_body JSONB DEFAULT '{}'::jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_url TEXT;
    v_secret TEXT;
    v_request_id BIGINT;
BEGIN
    IF p_function NOT IN ('notification-worker', 'push-receipts') THEN
        RAISE EXCEPTION 'Function % is not allowed', p_function;
    END IF;

    SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
    WHERE name = 'project_url'
    LIMIT 1;

    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'push_internal_secret'
    LIMIT 1;

    IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
        RAISE WARNING '[invoke_notification_function] Vault secrets project_url / push_internal_secret are not configured; skipping %', p_function;
        RETURN NULL;
    END IF;

    SELECT net.http_post(
        url := rtrim(v_url, '/') || '/functions/v1/' || p_function,
        body := COALESCE(p_body, '{}'::jsonb),
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-internal-secret', v_secret
        ),
        timeout_milliseconds := 60000
    ) INTO v_request_id;

    RETURN v_request_id;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[invoke_notification_function] % failed: %', p_function, SQLERRM;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_notification_function(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_notification_function(TEXT, JSONB) TO service_role;

-- Kick the worker as soon as new jobs are queued (one HTTP call per INSERT statement).
-- pg_net sends the request after the transaction commits, so it never delays the writer.
CREATE OR REPLACE FUNCTION public.kick_notification_worker()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.invoke_notification_function('notification-worker');
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[kick_notification_worker] %', SQLERRM;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.kick_notification_worker() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_kick_notification_worker ON public.notification_jobs;
CREATE TRIGGER tr_kick_notification_worker
    AFTER INSERT ON public.notification_jobs
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.kick_notification_worker();

-- ========================================================================
-- 11. SERVER-AUTHORITATIVE CHAT NOTIFICATIONS (chunked, sticker-aware)
-- ========================================================================
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
    v_total INT;
    v_offset INT;
BEGIN
    IF NEW.is_deleted IS TRUE OR NEW.sender_id IS NULL OR NEW.message_type = 'system' THEN
        RETURN NEW;
    END IF;

    SELECT name INTO v_group_name FROM public.groups WHERE id = NEW.group_id;
    v_group_name := COALESCE(NULLIF(v_group_name, ''), 'Group Chat');

    SELECT COALESCE(NULLIF(username, ''), NULLIF(full_name, ''), 'Someone') INTO v_sender_name
    FROM public.users
    WHERE id = NEW.sender_id;
    v_sender_name := COALESCE(v_sender_name, 'Someone');

    SELECT ARRAY_AGG(user_id) INTO v_target_user_ids
    FROM public.group_members
    WHERE group_id = NEW.group_id
      AND user_id <> NEW.sender_id;

    v_total := COALESCE(array_length(v_target_user_ids, 1), 0);
    IF v_total = 0 THEN
        RETURN NEW;
    END IF;

    IF NEW.message_type = 'image' THEN
        v_preview := COALESCE(NULLIF(NEW.content, ''), 'Photo');
        v_preview := '📷 ' || v_preview;
    ELSIF NEW.message_type = 'video' THEN
        v_preview := '📹 ' || COALESCE(NULLIF(NEW.content, ''), 'Video');
    ELSIF NEW.message_type = 'audio' THEN
        v_preview := '🎙️ Voice message';
    ELSIF NEW.message_type IN ('document', 'file') THEN
        v_preview := '📄 ' || COALESCE(NULLIF(NEW.content, ''), 'Document');
    ELSIF NEW.message_type = 'sticker' THEN
        v_preview := '😊 Sticker';
    ELSE
        v_preview := COALESCE(NULLIF(NEW.content, ''), 'Sent a message');
    END IF;

    IF LENGTH(v_preview) > 100 THEN
        v_preview := SUBSTRING(v_preview FROM 1 FOR 100) || '…';
    END IF;

    v_offset := 1;
    WHILE v_offset <= v_total LOOP
        INSERT INTO public.notification_jobs (notification_id, target_user_ids, title, body, data, status, next_retry_at)
        VALUES (
            NEW.id::text,
            v_target_user_ids[v_offset : LEAST(v_offset + 999, v_total)],
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
        v_offset := v_offset + 1000;
    END LOOP;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Never roll back the chat message because of a notification problem.
    RAISE WARNING '[enqueue_chat_message_notification] Error: %', SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_chat_message_notification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_enqueue_chat_message_notification ON public.messages;
CREATE TRIGGER tr_enqueue_chat_message_notification
    AFTER INSERT ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION public.enqueue_chat_message_notification();

-- ========================================================================
-- 12. HOUSEKEEPING (keeps queue/telemetry tables small and fast)
-- ========================================================================
CREATE OR REPLACE FUNCTION public.cleanup_notification_tables()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.notification_jobs
    WHERE status IN ('completed', 'failed', 'expired')
      AND updated_at < NOW() - INTERVAL '7 days';

    DELETE FROM public.notification_telemetry
    WHERE created_at < NOW() - INTERVAL '30 days';

    DELETE FROM public.push_send_audit
    WHERE created_at < NOW() - INTERVAL '1 day';
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_notification_tables() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_notification_tables() TO service_role;

-- ========================================================================
-- 13. RECURRING CALLS (pg_cron)
-- ========================================================================
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
DECLARE
    v_job RECORD;
BEGIN
    FOR v_job IN
        SELECT jobid FROM cron.job
        WHERE jobname IN ('notification-worker-every-minute', 'push-receipts-every-15-minutes', 'notification-cleanup-daily')
    LOOP
        PERFORM cron.unschedule(v_job.jobid);
    END LOOP;
END;
$$;

-- Safety net: retries + scheduled notifications (new jobs are processed instantly via the kick trigger).
SELECT cron.schedule(
    'notification-worker-every-minute',
    '* * * * *',
    $cron$SELECT public.invoke_notification_function('notification-worker');$cron$
);

-- Expo receipts are available shortly after sending and kept for 24 hours.
SELECT cron.schedule(
    'push-receipts-every-15-minutes',
    '*/15 * * * *',
    $cron$SELECT public.invoke_notification_function('push-receipts');$cron$
);

SELECT cron.schedule(
    'notification-cleanup-daily',
    '17 3 * * *',
    $cron$SELECT public.cleanup_notification_tables();$cron$
);
