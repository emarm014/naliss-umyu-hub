-- Enable Row Level Security
ALTER TABLE public.pool_candidates ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any to avoid conflicts
DROP POLICY IF EXISTS "Enable read access for all authenticated users to pool_candidates" ON public.pool_candidates;
DROP POLICY IF EXISTS "Admins can insert pool_candidates" ON public.pool_candidates;
DROP POLICY IF EXISTS "Admins can update pool_candidates" ON public.pool_candidates;
DROP POLICY IF EXISTS "Admins can delete pool_candidates" ON public.pool_candidates;

-- 1. Anyone authenticated can read candidates
CREATE POLICY "Enable read access for all authenticated users to pool_candidates" 
ON public.pool_candidates FOR SELECT TO authenticated USING (true);

-- 2. Admins can insert new candidates
CREATE POLICY "Admins can insert pool_candidates" 
ON public.pool_candidates FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_moderator());

-- 3. Admins can update candidates (e.g., bio, photo, manual score)
CREATE POLICY "Admins can update pool_candidates" 
ON public.pool_candidates FOR UPDATE TO authenticated USING (public.is_admin_or_moderator()) WITH CHECK (public.is_admin_or_moderator());

-- 4. Admins can delete candidates
CREATE POLICY "Admins can delete pool_candidates" 
ON public.pool_candidates FOR DELETE TO authenticated USING (public.is_admin_or_moderator());
