-- Supabase Additional Security Invokers Migration

-- Convert remaining client, notification, and admin helpers to SECURITY INVOKER
ALTER FUNCTION public.check_quiz_answer(p_question_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_unread_notification_count() SECURITY INVOKER;
ALTER FUNCTION public.log_notification_telemetry(p_notification_id text, p_type text, p_status text, p_platform text, p_device_info text) SECURITY INVOKER;
ALTER FUNCTION public.mark_all_announcements_as_read(u_level text) SECURITY INVOKER;
ALTER FUNCTION public.mark_announcement_as_read(a_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.mark_group_as_read(p_group_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.perform_academic_year_transition() SECURITY INVOKER;
ALTER FUNCTION public.perform_system_forensics() SECURITY INVOKER;
ALTER FUNCTION public.restrict_profile_updates() SECURITY INVOKER;
ALTER FUNCTION public.rls_auto_enable() SECURITY INVOKER;
ALTER FUNCTION public.toggle_device_block(p_user_id uuid, p_status boolean) SECURITY INVOKER;
ALTER FUNCTION public.is_admin_or_moderator() SECURITY INVOKER;
ALTER FUNCTION public.is_super_admin() SECURITY INVOKER;
