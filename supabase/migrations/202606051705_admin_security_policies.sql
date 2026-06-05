-- ==========================================
-- User Sessions Table & Security Definition
-- ==========================================

-- 1. Create the user_sessions table
CREATE TABLE IF NOT EXISTS public.user_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    device_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    os TEXT NOT NULL,
    ip_address TEXT,
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Guarantee a user has at most one record per unique physical device
    CONSTRAINT user_device_unique UNIQUE(user_id, device_id)
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
-- Users can view their own login sessions, super_admins can view all sessions
DROP POLICY IF EXISTS "Users can view their own sessions" ON public.user_sessions;
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

-- Users can register new devices/sessions
DROP POLICY IF EXISTS "Users can insert their own sessions" ON public.user_sessions;
CREATE POLICY "Users can insert their own sessions"
ON public.user_sessions
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Users can update session activity or terminate sessions, super_admins can update all sessions
DROP POLICY IF EXISTS "Users can update their own sessions" ON public.user_sessions;
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

-- 4. Indices for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON public.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON public.user_sessions(user_id) WHERE is_active = true;
