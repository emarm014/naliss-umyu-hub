-- Enable Row Level Security (RLS) on all core public tables
ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.past_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.moderator_permissions ENABLE ROW LEVEL SECURITY;

-- Security Definer Functions hardening (enforcing search_path)
-- This ensures that functions execute with the correct search path, a common Supabase Advisor Warning
ALTER FUNCTION IF EXISTS public.check_existing_account(text, text, text) SET search_path = public;
ALTER FUNCTION IF EXISTS public.check_existing_account_rpc(text, text, text) SET search_path = public;
ALTER FUNCTION IF EXISTS public.handle_new_user() SET search_path = public;
ALTER FUNCTION IF EXISTS public.handle_student_group_auto_join() SET search_path = public;
ALTER FUNCTION IF EXISTS public.is_admin() SET search_path = public;
ALTER FUNCTION IF EXISTS public.is_admin_or_moderator() SET search_path = public;

-- To address "Auth policies: Security Invoker" warnings, we must ensure all views use security invoker if applicable.
-- If any views exist, we can alter them to use security invoker:
-- ALTER VIEW public.some_view SET (security_invoker = on);
