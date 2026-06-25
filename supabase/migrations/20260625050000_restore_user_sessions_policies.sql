-- ==========================================
-- Restore user_sessions Security Policies
-- ==========================================

-- Enable Row Level Security (just in case)
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- 1. Users can view their own login sessions, super_admins can view all sessions
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'Users can view their own sessions' AND polrelid = 'public.user_sessions'::regclass
  ) THEN
    CREATE POLICY "Users can view their own sessions"
    ON public.user_sessions
    FOR SELECT
    TO authenticated
    USING (
      auth.uid() = user_id 
      OR EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = auth.uid() AND role = 'super_admin'
      )
    );
  END IF;
END $$;

-- 2. Users can register new devices/sessions
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'Users can insert their own sessions' AND polrelid = 'public.user_sessions'::regclass
  ) THEN
    CREATE POLICY "Users can insert their own sessions"
    ON public.user_sessions
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 3. Users can update session activity or terminate sessions, super_admins can update all sessions
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'Users can update their own sessions' AND polrelid = 'public.user_sessions'::regclass
  ) THEN
    CREATE POLICY "Users can update their own sessions"
    ON public.user_sessions
    FOR UPDATE
    TO authenticated
    USING (
      auth.uid() = user_id 
      OR EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = auth.uid() AND role = 'super_admin'
      )
    )
    WITH CHECK (
      auth.uid() = user_id 
      OR EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = auth.uid() AND role = 'super_admin'
      )
    );
  END IF;
END $$;

-- 4. Users can delete their own sessions, super_admins can delete all sessions
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'Users can delete their own sessions' AND polrelid = 'public.user_sessions'::regclass
  ) THEN
    CREATE POLICY "Users can delete their own sessions"
    ON public.user_sessions
    FOR DELETE
    TO authenticated
    USING (
      auth.uid() = user_id 
      OR EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = auth.uid() AND role = 'super_admin'
      )
    );
  END IF;
END $$;
