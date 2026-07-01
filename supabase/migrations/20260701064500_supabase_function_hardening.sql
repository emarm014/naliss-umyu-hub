-- Supabase Function Security Hardening Migration

-- 1. Convert client/admin RPC functions from SECURITY DEFINER to SECURITY INVOKER
-- This executes them under the caller's active database role (respecting RLS rules)
ALTER FUNCTION public.approve_pool_application(p_application_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.archive_executive_tenure(target_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.check_is_admin() SECURITY INVOKER;
ALTER FUNCTION public.cleanup_incomplete_signups() SECURITY INVOKER;
ALTER FUNCTION public.delete_incomplete_signup() SECURITY INVOKER;
ALTER FUNCTION public.fetch_admin_analytics() SECURITY INVOKER;
ALTER FUNCTION public.get_group_unread_counts(p_user_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_groups_with_counts() SECURITY INVOKER;
ALTER FUNCTION public.get_safe_quiz_questions(p_pool_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_system_stats() SECURITY INVOKER;
ALTER FUNCTION public.get_total_storage_usage() SECURITY INVOKER;
ALTER FUNCTION public.soft_delete_message(p_message_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.submit_manual_evaluation(p_pool_id uuid, p_content text, p_file_url text) SECURITY INVOKER;
ALTER FUNCTION public.submit_quiz(p_pool_id uuid, p_answers jsonb) SECURITY INVOKER;
ALTER FUNCTION public.submit_vote(p_pool_id uuid, p_candidate_user_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.update_last_active() SECURITY INVOKER;
ALTER FUNCTION public.update_last_seen() SECURITY INVOKER;
ALTER FUNCTION public.verify_email_swap_otp(p_otp_code text) SECURITY INVOKER;


-- 2. Restrict necessary SECURITY DEFINER functions to authenticated users only
-- Revoke from PUBLIC and anon, then grant explicitly to authenticated

-- execute_email_swap
REVOKE EXECUTE ON FUNCTION public.execute_email_swap(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_email_swap(uuid, text) TO authenticated;

-- execute_email_swap_v2
REVOKE EXECUTE ON FUNCTION public.execute_email_swap_v2(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_email_swap_v2(text) TO authenticated;

-- initiate_email_swap_auth
REVOKE EXECUTE ON FUNCTION public.initiate_email_swap_auth() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initiate_email_swap_auth() TO authenticated;
