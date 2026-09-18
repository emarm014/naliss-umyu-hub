-- Migration: 20260918193000_fix_pool_quiz_leaderboard_security_invoker.sql
-- Description: Resolve Supabase Security Advisor lint error (0010_security_definer_view) for public.pool_quiz_leaderboard.

-- ========================================================================
-- 1. HARDEN pool_quiz_leaderboard (SECURITY INVOKER)
-- ========================================================================
-- In PostgreSQL 15+, views created without (security_invoker = true) default to
-- security definer behavior, running under the creator's privileges instead of 
-- the querying user's RLS policies. Setting security_invoker = true enforces
-- caller RLS policies and eliminates the Supabase Security Advisor ERROR.

ALTER VIEW IF EXISTS public.pool_quiz_leaderboard SET (security_invoker = true);

-- ========================================================================
-- 2. AUDIT & RE-VERIFY ALL OTHER VIEWS ACROSS SCHEMA
-- ========================================================================
ALTER VIEW IF EXISTS public.pool_quiz_questions_safe SET (security_invoker = true);
ALTER VIEW IF EXISTS public.cloud_archive SET (security_invoker = true);

-- ========================================================================
-- 3. PERMISSIONS & GRANTS
-- ========================================================================
GRANT SELECT ON public.pool_quiz_leaderboard TO authenticated;
GRANT SELECT ON public.pool_quiz_questions_safe TO authenticated;
GRANT SELECT ON public.cloud_archive TO authenticated;
