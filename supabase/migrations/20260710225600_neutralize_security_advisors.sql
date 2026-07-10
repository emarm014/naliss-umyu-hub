-- Revoke EXECUTE on all SECURITY DEFINER functions from PUBLIC to enforce explicit grants
REVOKE EXECUTE ON FUNCTION public.check_existing_account(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_matric_availability(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_quiz_answer(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_registration_allowed() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_registration_status(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_username_availability(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_user_profile(uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_institutional_email(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_failed_auth_attempt(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_user_push_tokens() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_email_swap(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_email_swap_v2(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fetch_admin_analytics() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_notification_analytics() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_safe_quiz_questions(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.initiate_email_swap_auth() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.start_quiz(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_quiz(uuid, jsonb) FROM PUBLIC;

-- Explicitly Grant to ANON and AUTHENTICATED for public auth/registration endpoints
GRANT EXECUTE ON FUNCTION public.check_existing_account(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_matric_availability(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_registration_allowed() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_registration_status(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_username_availability(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_user_profile(uuid, text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_institutional_email(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_failed_auth_attempt(text) TO anon, authenticated;

-- Explicitly Grant to ONLY AUTHENTICATED for strictly internal/app features
GRANT EXECUTE ON FUNCTION public.check_quiz_answer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_email_swap(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_email_swap_v2(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fetch_admin_analytics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_analytics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_safe_quiz_questions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.initiate_email_swap_auth() TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_quiz(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quiz(uuid, jsonb) TO authenticated;

-- Ensure TRIGGER function is not executable by API at all
REVOKE EXECUTE ON FUNCTION public.sync_user_push_tokens() FROM anon, authenticated;
