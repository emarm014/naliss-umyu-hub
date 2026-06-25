-- Security Advisor Remediation: Hardening Functions & Auth
-- Fix for: Function Search Path Mutable warning (CVE-2018-1058 mitigation)

DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_new_user_groups') THEN
    ALTER FUNCTION public.handle_new_user_groups() SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_push_notification_trigger') THEN
    ALTER FUNCTION public.handle_push_notification_trigger() SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_material_download_count') THEN
    ALTER FUNCTION public.increment_material_download_count(uuid) SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_pq_download_count') THEN
    ALTER FUNCTION public.increment_pq_download_count(uuid) SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_announcement_view_count') THEN
    ALTER FUNCTION public.increment_announcement_view_count(uuid) SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_event_view_count') THEN
    ALTER FUNCTION public.increment_event_view_count(uuid) SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_material_view_count') THEN
    ALTER FUNCTION public.increment_material_view_count(uuid) SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_pq_view_count') THEN
    ALTER FUNCTION public.increment_pq_view_count(uuid) SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fetch_admin_analytics') THEN
    ALTER FUNCTION public.fetch_admin_analytics() SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'perform_system_forensics') THEN
    ALTER FUNCTION public.perform_system_forensics() SET search_path = public;
  END IF;
END $$;
