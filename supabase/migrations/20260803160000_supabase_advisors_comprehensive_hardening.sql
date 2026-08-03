-- Comprehensive Supabase Security & Performance Advisor Hardening
-- Resolves all Security Advisor and Performance Advisor recommendations.

-- ── 1. Dynamic Search Path Hardening for 100% of SECURITY DEFINER Functions ──
DO $$
DECLARE
    func record;
BEGIN
    FOR func IN 
        SELECT p.oid::regprocedure::text AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef = true
    LOOP
        EXECUTE 'ALTER FUNCTION ' || func.signature || ' SET search_path = public';
    END LOOP;
END;
$$;

-- ── 2. Explicit Function Grant Hardening (Revoke from PUBLIC, Grant to Authenticated) ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_groups_with_counts') THEN
    REVOKE EXECUTE ON FUNCTION public.get_groups_with_counts() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.get_groups_with_counts() TO authenticated;
  END IF;
END $$;

-- ── 3. Enforce RLS on 100% of Public Schema Tables ──
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN 
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE 'ALTER TABLE public.' || quote_ident(t) || ' ENABLE ROW LEVEL SECURITY';
  END LOOP;
END $$;

-- ── 4. Remove Duplicate / Overlapping RLS Select Policies ──
DROP POLICY IF EXISTS "Admin Select groups" ON public.groups;
DROP POLICY IF EXISTS "Admin Select messages" ON public.messages;
DROP POLICY IF EXISTS "Admin Select user_sessions" ON public.user_sessions;
