-- Security Hardening: Apply explicit search_path to the remaining SECURITY DEFINER functions.
-- This prevents search path hijacking attacks (CVE-2018-1058).

ALTER FUNCTION public.mark_announcement_as_read(uuid) SET search_path = public;
ALTER FUNCTION public.mark_all_announcements_as_read(text) SET search_path = public;
ALTER FUNCTION public.cleanup_stagnant_registrations() SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;
