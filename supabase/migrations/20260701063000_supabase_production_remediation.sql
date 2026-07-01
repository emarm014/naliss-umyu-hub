-- Supabase Production Readiness Remediation Migration

-- 1. Enable RLS Policies on tables that have RLS enabled but no policies
CREATE POLICY "Super admins can manage cloudinary_usage_snapshot" 
ON public.cloudinary_usage_snapshot 
FOR ALL 
TO authenticated 
USING ((SELECT role FROM public.users WHERE id = (SELECT auth.uid())) = 'super_admin');

CREATE POLICY "Super admins can manage notification_jobs" 
ON public.notification_jobs 
FOR ALL 
TO authenticated 
USING ((SELECT role FROM public.users WHERE id = (SELECT auth.uid())) = 'super_admin');

CREATE POLICY "Super admins can manage scheduled_notifications" 
ON public.scheduled_notifications 
FOR ALL 
TO authenticated 
USING ((SELECT role FROM public.users WHERE id = (SELECT auth.uid())) = 'super_admin');


-- 2. Move pg_trgm extension to extensions schema to secure public namespace
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;


-- 3. Drop broad SELECT policies on public storage buckets to restrict listing
-- Public buckets serve files via direct public URLs without needing SELECT policies.
DROP POLICY IF EXISTS "Avatar Public View" ON storage.objects;
DROP POLICY IF EXISTS "Materials Download" ON storage.objects;


-- 4. Convert safe client functions from SECURITY DEFINER to SECURITY INVOKER
ALTER FUNCTION public.get_server_time() SECURITY INVOKER;
ALTER FUNCTION public.is_active_user() SECURITY INVOKER;
ALTER FUNCTION public.is_group_member(uuid, uuid) SECURITY INVOKER;
ALTER FUNCTION public.increment_announcement_view_count(uuid) SECURITY INVOKER;
ALTER FUNCTION public.increment_event_view_count(uuid) SECURITY INVOKER;
ALTER FUNCTION public.increment_material_download_count(uuid) SECURITY INVOKER;
ALTER FUNCTION public.increment_material_view_count(uuid) SECURITY INVOKER;
ALTER FUNCTION public.increment_pq_download_count(uuid) SECURITY INVOKER;
ALTER FUNCTION public.increment_pq_view_count(uuid) SECURITY INVOKER;


-- 5. Revoke EXECUTE on administrative/hook SECURITY DEFINER functions from PUBLIC & anon
REVOKE EXECUTE ON FUNCTION public.fetch_activity_trends() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_notification_analytics() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_group_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_push_notification_trigger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_student_group_auto_join() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_group_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_incomplete_account(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_message_type_to_content_type() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_push_token_from_users() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_push_token_to_users() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_event_pool_winner_announcement() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_send_email_swap_otp() FROM PUBLIC, anon, authenticated;


-- 6. Optimize RLS Policies using (SELECT auth.uid()) to avoid row-by-row re-evaluation

-- users
DROP POLICY IF EXISTS "Student Update Own Profile" ON public.users;
CREATE POLICY "Student Update Own Profile" ON public.users 
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = id) WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Student Insert Own Profile" ON public.users;
CREATE POLICY "Student Insert Own Profile" ON public.users 
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = id);

-- messages
DROP POLICY IF EXISTS "Student Insert Messages" ON public.messages;
CREATE POLICY "Student Insert Messages" ON public.messages 
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = sender_id);

DROP POLICY IF EXISTS "Student Update Own Messages" ON public.messages;
CREATE POLICY "Student Update Own Messages" ON public.messages 
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = sender_id);

DROP POLICY IF EXISTS "Student Delete Own Messages" ON public.messages;
CREATE POLICY "Student Delete Own Messages" ON public.messages 
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = sender_id);

DROP POLICY IF EXISTS "Users can edit their own messages" ON public.messages;
CREATE POLICY "Users can edit their own messages" ON public.messages 
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = sender_id);

DROP POLICY IF EXISTS "Student Read Group Messages" ON public.messages;
CREATE POLICY "Student Read Group Messages" ON public.messages 
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.group_members 
      WHERE group_id = messages.group_id 
      AND user_id = (SELECT auth.uid())
    )
  );

-- group_members
DROP POLICY IF EXISTS "Student Insert Group Member" ON public.group_members;
CREATE POLICY "Student Insert Group Member" ON public.group_members 
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

-- user_announcement_reads
DROP POLICY IF EXISTS "Student Insert Announcement Reads" ON public.user_announcement_reads;
CREATE POLICY "Student Insert Announcement Reads" ON public.user_announcement_reads 
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

-- user_push_tokens
DROP POLICY IF EXISTS "Users can insert their own push token" ON public.user_push_tokens;
CREATE POLICY "Users can insert their own push token" ON public.user_push_tokens 
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own push token" ON public.user_push_tokens;
CREATE POLICY "Users can update their own push token" ON public.user_push_tokens 
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read their own push token" ON public.user_push_tokens;
CREATE POLICY "Users can read their own push token" ON public.user_push_tokens 
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- email_change_challenges
DROP POLICY IF EXISTS "Users can manage their own email challenges" ON public.email_change_challenges;
CREATE POLICY "Users can manage their own email challenges" ON public.email_change_challenges 
  FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id);

-- user_sessions
DROP POLICY IF EXISTS "Users can view their own sessions" ON public.user_sessions;
CREATE POLICY "Users can view their own sessions" ON public.user_sessions 
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own sessions" ON public.user_sessions;
CREATE POLICY "Users can insert their own sessions" ON public.user_sessions 
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own sessions" ON public.user_sessions;
CREATE POLICY "Users can update their own sessions" ON public.user_sessions 
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their own sessions" ON public.user_sessions;
CREATE POLICY "Users can delete their own sessions" ON public.user_sessions 
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- activity_logs
DROP POLICY IF EXISTS "Student Read Activity Logs" ON public.activity_logs;
CREATE POLICY "Student Read Activity Logs" ON public.activity_logs 
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- notification_telemetry
DROP POLICY IF EXISTS "Users can insert their own telemetry" ON public.notification_telemetry;
CREATE POLICY "Users can insert their own telemetry" ON public.notification_telemetry 
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own telemetry" ON public.notification_telemetry;
CREATE POLICY "Users can update their own telemetry" ON public.notification_telemetry 
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read their own telemetry" ON public.notification_telemetry;
CREATE POLICY "Users can read their own telemetry" ON public.notification_telemetry 
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- notification_history
DROP POLICY IF EXISTS "Users can read their own notification history" ON public.notification_history;
CREATE POLICY "Users can read their own notification history" ON public.notification_history 
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own notification history" ON public.notification_history;
CREATE POLICY "Users can update their own notification history" ON public.notification_history 
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own notification history" ON public.notification_history;
CREATE POLICY "Users can insert their own notification history" ON public.notification_history 
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

-- pool_submissions
DROP POLICY IF EXISTS "Admins can manage pool_submissions" ON public.pool_submissions;
CREATE POLICY "Admins can manage pool_submissions" ON public.pool_submissions 
  FOR ALL TO authenticated USING ((SELECT role FROM public.users WHERE id = (SELECT auth.uid())) = 'super_admin');

-- pool_participants
DROP POLICY IF EXISTS "Admins can manage pool_participants" ON public.pool_participants;
CREATE POLICY "Admins can manage pool_participants" ON public.pool_participants 
  FOR ALL TO authenticated USING ((SELECT role FROM public.users WHERE id = (SELECT auth.uid())) = 'super_admin');

-- pool_applications
DROP POLICY IF EXISTS "Admins can manage pool_applications" ON public.pool_applications;
CREATE POLICY "Admins can manage pool_applications" ON public.pool_applications 
  FOR ALL TO authenticated USING ((SELECT role FROM public.users WHERE id = (SELECT auth.uid())) = 'super_admin');

-- news
DROP POLICY IF EXISTS "Admins can manage news" ON public.news;
CREATE POLICY "Admins can manage news" ON public.news 
  FOR ALL TO authenticated USING ((SELECT role FROM public.users WHERE id = (SELECT auth.uid())) = 'super_admin');

-- archives
DROP POLICY IF EXISTS "Admins can manage archives" ON public.archives;
CREATE POLICY "Admins can manage archives" ON public.archives 
  FOR ALL TO authenticated USING ((SELECT role FROM public.users WHERE id = (SELECT auth.uid())) = 'super_admin');

-- event_pools
DROP POLICY IF EXISTS "Admins can manage event_pools" ON public.event_pools;
CREATE POLICY "Admins can manage event_pools" ON public.event_pools 
  FOR ALL TO authenticated USING ((SELECT role FROM public.users WHERE id = (SELECT auth.uid())) = 'super_admin');

-- pool_quiz_questions
DROP POLICY IF EXISTS "Admins can manage pool_quiz_questions" ON public.pool_quiz_questions;
CREATE POLICY "Admins can manage pool_quiz_questions" ON public.pool_quiz_questions 
  FOR ALL TO authenticated USING ((SELECT role FROM public.users WHERE id = (SELECT auth.uid())) = 'super_admin');
