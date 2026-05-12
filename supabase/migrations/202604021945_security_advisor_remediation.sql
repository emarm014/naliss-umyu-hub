-- Security Advisor Remediation: Hardening Functions & Auth
-- Fix for: Function Search Path Mutable warning (CVE-2018-1058 mitigation)

-- 1. Hardening public.handle_new_user_groups()
-- This function is likely a trigger function. We set search_path to empty to force fully-qualified names
-- or to 'public' to ensure it only looks there.
ALTER FUNCTION public.handle_new_user_groups() SET search_path = public;

-- 2. Hardening public.handle_push_notification_trigger()
ALTER FUNCTION public.handle_push_notification_trigger() SET search_path = public;

-- 3. Hardening existing telemetry functions (proactive)
ALTER FUNCTION public.increment_material_download_count(uuid) SET search_path = public;
ALTER FUNCTION public.increment_pq_download_count(uuid) SET search_path = public;
ALTER FUNCTION public.increment_announcement_view_count(uuid) SET search_path = public;
ALTER FUNCTION public.increment_event_view_count(uuid) SET search_path = public;
ALTER FUNCTION public.increment_material_view_count(uuid) SET search_path = public;
ALTER FUNCTION public.increment_pq_view_count(uuid) SET search_path = public;
ALTER FUNCTION public.fetch_admin_analytics() SET search_path = public;
ALTER FUNCTION public.perform_system_forensics() SET search_path = public;

-- Note on "Leaked Password Protection Disabled":
-- This must be enabled in the Supabase Dashboard under Auth -> Settings -> Password protection.
-- Currently, there is No SQL command to enable this global auth setting.
