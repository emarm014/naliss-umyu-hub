-- ========================================================================
-- TASK 1: SECURITY HARDENING
-- ========================================================================

-- Drop unrestricted 'USING (true)' policy and replace with a tight ownership policy
DROP POLICY IF EXISTS "Student Read Activity Logs" ON public.activity_logs;
CREATE POLICY "Student Read Activity Logs" ON public.activity_logs 
FOR SELECT USING (auth.uid() = user_id);

-- Drop the obsolete, legacy 'conversations' table completely
DROP TABLE IF EXISTS public.conversations CASCADE;

-- Explicitly append 'WITH search_path = public' to 100% of SECURITY DEFINER functions
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

-- ========================================================================
-- TASK 2: RESOLVE PUSH NOTIFICATION ARCHITECTURE
-- ========================================================================

-- Implement high-performance database trigger to sync tokens
CREATE OR REPLACE FUNCTION public.sync_user_push_tokens()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.users 
    SET push_token = NEW.push_token 
    WHERE id = NEW.user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS tr_sync_push_tokens ON public.user_push_tokens;
CREATE TRIGGER tr_sync_push_tokens
AFTER INSERT OR UPDATE ON public.user_push_tokens
FOR EACH ROW EXECUTE FUNCTION public.sync_user_push_tokens();
