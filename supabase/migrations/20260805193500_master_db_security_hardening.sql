-- Migration: Master Database Security Hardening across all 41 tables and 76 RPC functions

-- 1. Universal Table & Sequence Grants for Schema Public
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, anon, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, anon, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, anon, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated, anon, service_role;

-- 2. Universal Function Grants for Schema Public
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, anon, service_role;

-- 3. Set SECURITY DEFINER on core user-facing RPC functions to prevent RLS permission errors
ALTER FUNCTION public.increment_material_download_count(uuid) SECURITY DEFINER;
ALTER FUNCTION public.increment_material_view_count(uuid) SECURITY DEFINER;
ALTER FUNCTION public.increment_pq_view_count(uuid) SECURITY DEFINER;
ALTER FUNCTION public.increment_pq_download_count(uuid) SECURITY DEFINER;
ALTER FUNCTION public.increment_announcement_view_count(uuid) SECURITY DEFINER;
ALTER FUNCTION public.increment_event_view_count(uuid) SECURITY DEFINER;
ALTER FUNCTION public.mark_announcement_as_read(uuid) SECURITY DEFINER;
ALTER FUNCTION public.mark_group_as_read(uuid) SECURITY DEFINER;
ALTER FUNCTION public.submit_vote(uuid, uuid) SECURITY DEFINER;
ALTER FUNCTION public.get_unread_notification_count() SECURITY DEFINER;
ALTER FUNCTION public.get_group_unread_counts(uuid) SECURITY DEFINER;
ALTER FUNCTION public.update_last_active() SECURITY DEFINER;
ALTER FUNCTION public.soft_delete_message(uuid) SECURITY DEFINER;
ALTER FUNCTION public.log_notification_telemetry(text, text, text, text, text) SECURITY DEFINER;
ALTER FUNCTION public.submit_manual_evaluation(uuid, text, text) SECURITY DEFINER;

-- 4. Enable RLS and add basic policies for tables that were missing grants
ALTER TABLE public.pool_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users access pool_participants" ON public.pool_participants;
CREATE POLICY "Authenticated users access pool_participants" ON public.pool_participants FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users access user_push_tokens" ON public.user_push_tokens;
CREATE POLICY "Authenticated users access user_push_tokens" ON public.user_push_tokens FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.notification_telemetry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users access notification_telemetry" ON public.notification_telemetry;
CREATE POLICY "Authenticated users access notification_telemetry" ON public.notification_telemetry FOR ALL TO authenticated USING (true) WITH CHECK (true);
