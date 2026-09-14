-- ========================================================================
-- 1. FIX 'user_sessions' UNIQUE CONSTRAINT FOR UPSERT
-- ========================================================================
-- Ensure the exact unique constraint expected by on_conflict=user_id,device_id exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_sessions_user_device'
    ) THEN
        -- Clean duplicates if any exist
        DELETE FROM public.user_sessions a USING public.user_sessions b
        WHERE a.id < b.id AND a.user_id = b.user_id AND a.device_id = b.device_id;

        ALTER TABLE public.user_sessions 
        ADD CONSTRAINT uq_user_sessions_user_device UNIQUE (user_id, device_id);
    END IF;
END $$;

-- ========================================================================
-- 2. PERMISSIVE RLS FOR PRE-REGISTRATION USERS
-- ========================================================================
-- Allow users with an active auth.uid() to insert/update their own device session 
-- even if public.users profile is still being finalized:
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can upsert own session" ON public.user_sessions;
CREATE POLICY "Users can upsert own session" ON public.user_sessions
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
