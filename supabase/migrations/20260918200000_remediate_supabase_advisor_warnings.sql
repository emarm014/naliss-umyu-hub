-- Migration: 20260918200000_remediate_supabase_advisor_warnings.sql
-- Description: Comprehensive, non-breaking remediation of Supabase Advisor warnings.
-- Specifically addresses:
--   1. function_search_path_mutable (locks search_path to public on mutable functions)
--   2. rls_policy_always_true (tightens write access on notification_telemetry & pool_participants while keeping SELECT unrestricted)
--   3. anon_security_definer_function_executable (revokes anon access on triggers, admin functions, and authenticated-only functions while strictly preserving registration RPCs)

-- ========================================================================
-- SECTION 1: HARDEN FUNCTION SEARCH PATHS (function_search_path_mutable)
-- ========================================================================
ALTER FUNCTION public.trigger_event_pool_winner_announcement() SET search_path = public;
ALTER FUNCTION public.cast_pool_vote(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.cast_pool_vote(uuid, text) SET search_path = public;
ALTER FUNCTION public.cast_multi_post_ballot(uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.get_voting_candidates(uuid) SET search_path = public;
ALTER FUNCTION public.certify_voting_winners(uuid) SET search_path = public;
ALTER FUNCTION public.sync_featured_student_notifications() SET search_path = public;
ALTER FUNCTION public.submit_manual_evaluation(uuid, text, text) SET search_path = public;
ALTER FUNCTION public.submit_manual_evaluation(uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.submit_quiz(uuid, jsonb) SET search_path = public;

-- ========================================================================
-- SECTION 2: RESOLVE OVERLY PERMISSIVE RLS (rls_policy_always_true)
-- ========================================================================

-- 2A. notification_telemetry
-- Keep SELECT 100% open to authenticated users; scope INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS "Authenticated users access notification_telemetry" ON public.notification_telemetry;

CREATE POLICY "Authenticated users view notification_telemetry"
  ON public.notification_telemetry
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users insert notification_telemetry"
  ON public.notification_telemetry
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id 
    OR user_id IS NULL 
    OR public.is_admin_or_moderator()
  );

CREATE POLICY "Users update notification_telemetry"
  ON public.notification_telemetry
  FOR UPDATE
  TO authenticated
  USING (
    (select auth.uid()) = user_id 
    OR user_id IS NULL 
    OR public.is_admin_or_moderator()
  );

CREATE POLICY "Admins delete notification_telemetry"
  ON public.notification_telemetry
  FOR DELETE
  TO authenticated
  USING (public.is_admin_or_moderator());


-- 2B. pool_participants
-- Keep SELECT 100% open for leaderboards and general view; scope INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS "Authenticated users access pool_participants" ON public.pool_participants;

CREATE POLICY "Authenticated users view pool_participants"
  ON public.pool_participants
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users insert pool_participants"
  ON public.pool_participants
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id 
    OR public.is_admin_or_moderator()
  );

CREATE POLICY "Users update pool_participants"
  ON public.pool_participants
  FOR UPDATE
  TO authenticated
  USING (
    (select auth.uid()) = user_id 
    OR public.is_admin_or_moderator()
  );

CREATE POLICY "Admins delete pool_participants"
  ON public.pool_participants
  FOR DELETE
  TO authenticated
  USING (public.is_admin_or_moderator());


-- ========================================================================
-- SECTION 3: SECURE TRIGGER FUNCTIONS (NEVER EXPOSE TO REST API)
-- ========================================================================
-- Triggers are invoked internally by PostgreSQL and do not need REST execution privileges.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_student_group_auto_join() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_group_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_group_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_push_notification_trigger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_message_type_to_content_type() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_push_token_from_users() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_push_token_to_users() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_user_push_tokens() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_event_pool_winner_announcement() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_featured_student_notifications() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_chat_message_notification() FROM PUBLIC, anon, authenticated;


-- ========================================================================
-- SECTION 4: SECURE ADMIN FUNCTIONS (REVOKE ANON, KEEP AUTHENTICATED)
-- ========================================================================
REVOKE EXECUTE ON FUNCTION public.approve_all_pool_applications(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_all_pool_applications(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_pool_application(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_pool_application(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.unapprove_pool_application(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.unapprove_pool_application(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.certify_voting_winners(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.certify_voting_winners(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.save_moderator_permissions(uuid, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_moderator_permissions(uuid, jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.confirm_invite_only_participants(uuid, uuid[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_invite_only_participants(uuid, uuid[]) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fetch_activity_trends() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_activity_trends() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fetch_admin_analytics() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_admin_analytics() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_notification_analytics() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notification_analytics() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cleanup_inactive_push_tokens() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_inactive_push_tokens() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cleanup_stagnant_registrations() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_stagnant_registrations() TO authenticated;


-- ========================================================================
-- SECTION 5: SECURE AUTHENTICATED USER FUNCTIONS (REVOKE ANON, KEEP AUTHENTICATED)
-- ========================================================================
REVOKE EXECUTE ON FUNCTION public.advance_debate_turn(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_debate_turn(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cast_multi_post_ballot(uuid, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cast_multi_post_ballot(uuid, jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cast_pool_vote(uuid, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cast_pool_vote(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cast_pool_vote(uuid, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cast_pool_vote(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.check_quiz_answer(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_quiz_answer(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.congratulate_student(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.congratulate_student(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_user_account(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user_account(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.execute_email_swap_v2(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_email_swap_v2(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_group_unread_counts(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_group_unread_counts(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_safe_quiz_questions(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_safe_quiz_questions(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_unread_notification_count() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_voting_candidates(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_voting_candidates(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_voting_results(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_voting_results(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_announcement_view_count(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_announcement_view_count(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_event_view_count(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_event_view_count(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_material_download_count(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_material_download_count(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_material_view_count(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_material_view_count(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_pq_download_count(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_pq_download_count(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_pq_view_count(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_pq_view_count(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.log_notification_telemetry(text, text, text, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_notification_telemetry(text, text, text, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.mark_all_announcements_as_read(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_all_announcements_as_read(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.mark_announcement_as_read(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_announcement_as_read(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.mark_group_as_read(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_group_as_read(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.prewarm_critical_tables() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.prewarm_critical_tables() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.secure_event_ticket(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.secure_event_ticket(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.soft_delete_message(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_message(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.start_quiz(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_quiz(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_debate_entry(uuid, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_debate_entry(uuid, jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_manual_evaluation(uuid, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_manual_evaluation(uuid, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_manual_evaluation(uuid, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_manual_evaluation(uuid, jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_quiz(uuid, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_quiz(uuid, jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_vote(uuid, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_vote(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_device_heartbeat(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_device_heartbeat(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_last_active() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_last_active() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_last_seen() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_last_seen() TO authenticated;


-- ========================================================================
-- SECTION 6: PRESERVE PUBLIC / ONBOARDING REGISTRATION ACCESS
-- ========================================================================
-- These 9 RPCs are required by prospective students prior to full authentication.
-- We explicitly ensure both 'anon' and 'authenticated' roles have access.
GRANT EXECUTE ON FUNCTION public.check_existing_account(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_matric_availability(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_username_availability(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_registration_allowed() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_registration_status(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_user_profile(uuid, text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_institutional_email(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_failed_auth_attempt(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_incomplete_account(text) TO anon, authenticated;
