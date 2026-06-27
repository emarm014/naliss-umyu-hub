-- Migration: 20260626185000_harden_all_remaining_rpc_search_paths.sql
-- Description: Harden all remaining SECURITY DEFINER functions by setting explicit search_paths.

ALTER FUNCTION public.mark_all_announcements_as_read(text) SET search_path = public;
ALTER FUNCTION public.mark_announcement_as_read(uuid) SET search_path = public;
ALTER FUNCTION public.trigger_send_email_swap_otp() SET search_path = public;
ALTER FUNCTION public.initiate_email_swap_auth() SET search_path = public;
ALTER FUNCTION public.verify_email_swap_otp(text) SET search_path = public;
ALTER FUNCTION public.execute_email_swap(uuid, text) SET search_path = public;
ALTER FUNCTION public.check_registration_allowed() SET search_path = public;
ALTER FUNCTION public.archive_executive_tenure(uuid) SET search_path = public;
ALTER FUNCTION public.submit_vote(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.get_server_time() SET search_path = public;
ALTER FUNCTION public.fetch_admin_analytics() SET search_path = public;
ALTER FUNCTION public.submit_quiz(uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.submit_manual_evaluation(uuid, text, text) SET search_path = public;
ALTER FUNCTION public.trigger_event_pool_winner_announcement() SET search_path = public;
ALTER FUNCTION public.approve_pool_application(uuid) SET search_path = public;
ALTER FUNCTION public.cleanup_stagnant_registrations() SET search_path = public;
ALTER FUNCTION public.get_safe_quiz_questions(uuid) SET search_path = public;
ALTER FUNCTION public.update_last_seen() SET search_path = public;
ALTER FUNCTION public.soft_delete_message(uuid) SET search_path = public;
