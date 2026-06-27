-- Migration: 20260627160000_enterprise_notifications.sql
-- Description: Advanced database features for Enterprise Notifications

-- 1. Multi-Device Push Tokens Support
ALTER TABLE public.user_push_tokens DROP CONSTRAINT IF EXISTS user_push_tokens_pkey;
ALTER TABLE public.user_push_tokens ADD PRIMARY KEY (user_id, push_token);

-- 2. Notification History Table
CREATE TABLE IF NOT EXISTS public.notification_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    notification_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    type TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_history_user_notification UNIQUE(user_id, notification_id)
);

-- Index on history user/read state
CREATE INDEX IF NOT EXISTS idx_notification_history_user_read ON public.notification_history(user_id, is_read);

-- Enable RLS for history
ALTER TABLE public.notification_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own notification history"
    ON public.notification_history FOR SELECT
    USING (auth.uid() = user_id);
    
CREATE POLICY "Users can update their own notification history"
    ON public.notification_history FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert their own notification history"
    ON public.notification_history FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 3. Notification Jobs (Retry Queue)
CREATE TABLE IF NOT EXISTS public.notification_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id TEXT NOT NULL,
    target_user_ids UUID[] NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    retry_count INT DEFAULT 0,
    max_retry INT DEFAULT 5,
    next_retry_at TIMESTAMPTZ DEFAULT NOW(),
    last_error TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_jobs_status_retry ON public.notification_jobs(status, next_retry_at);
ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;

-- 4. Scheduled Notifications Table
CREATE TABLE IF NOT EXISTS public.scheduled_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_user_ids UUID[] NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    send_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'expired')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_send_at ON public.scheduled_notifications(status, send_at);
ALTER TABLE public.scheduled_notifications ENABLE ROW LEVEL SECURITY;

-- 5. Extend Telemetry Columns
ALTER TABLE public.notification_telemetry 
ADD COLUMN IF NOT EXISTS expo_ticket_id TEXT,
ADD COLUMN IF NOT EXISTS expo_receipt_id TEXT,
ADD COLUMN IF NOT EXISTS provider_status TEXT,
ADD COLUMN IF NOT EXISTS provider_error TEXT,
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;

-- 6. Privacy Mode Setting Column
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS privacy_mode BOOLEAN DEFAULT false;

-- 7. Redefine Bidirectional sync trigger functions to support one-to-many relationship
CREATE OR REPLACE FUNCTION public.sync_push_token_to_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_newest_token TEXT;
BEGIN
    -- Select the most recently updated active token for this user
    SELECT push_token INTO v_newest_token
    FROM public.user_push_tokens
    WHERE user_id = NEW.user_id
    ORDER BY updated_at DESC
    LIMIT 1;

    UPDATE public.users
    SET push_token = v_newest_token,
        updated_at = NOW()
    WHERE id = NEW.user_id;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_push_token_from_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.push_token IS NULL THEN
        DELETE FROM public.user_push_tokens
        WHERE user_id = NEW.id;
    ELSE
        INSERT INTO public.user_push_tokens (user_id, push_token, updated_at)
        VALUES (NEW.id, NEW.push_token, NOW())
        ON CONFLICT (user_id, push_token) DO UPDATE
        SET updated_at = EXCLUDED.updated_at;
    END IF;
    RETURN NEW;
END;
$$;

-- 8. Secure RPC for Unread Notification Badge Count
CREATE OR REPLACE FUNCTION public.get_unread_notification_count()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN (SELECT count(*) FROM public.notification_history WHERE user_id = auth.uid() AND is_read = false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unread_notification_count() TO authenticated;

-- 9. Secure RPC for Telemetry Analytics Export
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
    RETURN QUERY
    SELECT 
        count(*) AS total_sent,
        count(*) FILTER (WHERE status = 'delivered') AS total_delivered,
        count(*) FILTER (WHERE status = 'opened') AS total_opened,
        count(*) FILTER (WHERE status = 'failed') AS total_failed,
        round(COALESCE((count(*) FILTER (WHERE status = 'delivered')::numeric / nullif(count(*), 0) * 100), 0), 2) AS delivery_rate,
        round(COALESCE((count(*) FILTER (WHERE status = 'opened')::numeric / nullif(count(*), 0) * 100), 2) AS open_rate,
        round(COALESCE((count(*) FILTER (WHERE status = 'failed')::numeric / nullif(count(*), 0) * 100), 2) AS failure_rate,
        count(*) FILTER (WHERE platform = 'android') AS android_count,
        count(*) FILTER (WHERE platform = 'ios') AS ios_count
    FROM public.notification_telemetry;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_notification_analytics() TO authenticated;
