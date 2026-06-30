-- Migration: 20260630202500_supabase_advisors_hardening.sql
-- Description: Resolves core security and performance issues identified by Supabase Advisor.

-- 1. Performance: Index covering foreign keys for query optimizations
CREATE INDEX IF NOT EXISTS idx_pool_applications_user_id ON public.pool_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_pool_participants_user_id ON public.pool_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_pool_submissions_user_id ON public.pool_submissions(user_id);

-- 2. Security: Enforce Security Invoker RLS constraints on Views
ALTER VIEW IF EXISTS public.pool_quiz_questions_safe SET (security_invoker = true);

-- 3. Security: Set search paths to public on mutable role-based functions
ALTER FUNCTION public.fetch_activity_trends() SET search_path = public;
ALTER FUNCTION public.fetch_admin_analytics() SET search_path = public;

-- 4. Security: Add read policies for tables with RLS enabled but no active policies
CREATE POLICY "Allow public read access to departments" 
  ON public.departments 
  FOR SELECT 
  USING (true);

CREATE POLICY "Allow public read access to muted_users" 
  ON public.muted_users 
  FOR SELECT 
  USING (true);

CREATE POLICY "Allow public read access to moderator_permissions" 
  ON public.moderator_permissions 
  FOR SELECT 
  USING (true);

CREATE POLICY "Allow authenticated users to insert message_reports" 
  ON public.message_reports 
  FOR INSERT 
  TO authenticated 
  WITH CHECK ((select auth.uid()) = reporter_id);

-- 5. Security: Revoke execute privileges on high-privilege administrative functions from PUBLIC role
REVOKE EXECUTE ON FUNCTION public.approve_pool_application(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.archive_executive_tenure(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_is_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_moderator() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_stagnant_registrations() FROM PUBLIC;
