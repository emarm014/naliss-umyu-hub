-- Migration: Notification Security Hardening & RLS Lock Down
-- 
-- Description: Hardens database permissions for notification queue tables (notification_jobs),
-- push tokens (user_push_tokens), notification history (notification_history), and telemetry.
-- Prevents authenticated users from directly accessing or manipulating system retry queues or other users' tokens.

-- 1. Lock down notification_jobs table
ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;

-- Revoke direct REST client permissions on notification_jobs from standard users
REVOKE ALL ON TABLE public.notification_jobs FROM anon, authenticated;
GRANT ALL ON TABLE public.notification_jobs TO service_role;

-- 2. Audit and enforce RLS policies on user_push_tokens
ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert their own push token" ON public.user_push_tokens;
CREATE POLICY "Users can insert their own push token"
    ON public.user_push_tokens FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own push token" ON public.user_push_tokens;
CREATE POLICY "Users can update their own push token"
    ON public.user_push_tokens FOR UPDATE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read their own push token" ON public.user_push_tokens;
CREATE POLICY "Users can read their own push token"
    ON public.user_push_tokens FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own push token" ON public.user_push_tokens;
CREATE POLICY "Users can delete their own push token"
    ON public.user_push_tokens FOR DELETE
    USING (auth.uid() = user_id);

-- 3. Audit and enforce RLS policies on notification_history
ALTER TABLE public.notification_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own notification history" ON public.notification_history;
CREATE POLICY "Users can read their own notification history"
    ON public.notification_history FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own notification history" ON public.notification_history;
CREATE POLICY "Users can insert their own notification history"
    ON public.notification_history FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notification history" ON public.notification_history;
CREATE POLICY "Users can update their own notification history"
    ON public.notification_history FOR UPDATE
    USING (auth.uid() = user_id);

-- 4. Audit and enforce RLS policies on notification_telemetry
ALTER TABLE public.notification_telemetry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert their own telemetry" ON public.notification_telemetry;
CREATE POLICY "Users can insert their own telemetry"
    ON public.notification_telemetry FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read their own telemetry" ON public.notification_telemetry;
CREATE POLICY "Users can read their own telemetry"
    ON public.notification_telemetry FOR SELECT
    USING (auth.uid() = user_id);
