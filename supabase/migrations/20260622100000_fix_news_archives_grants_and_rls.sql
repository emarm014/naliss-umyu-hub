-- Migration: Fix GRANTS and Admin RLS Policies for News and Archives
-- Description: Ensures the API roles have access to the news and archives tables, and grants administrators full RLS bypass capabilities.

-- Grant usage and basic table permissions to the API roles
GRANT ALL ON TABLE public.news TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.archives TO anon, authenticated, service_role;
-- Adding Event Pools again just to be absolutely safe
GRANT ALL ON TABLE public.event_pools TO anon, authenticated, service_role;

-- 1. News Policies
DROP POLICY IF EXISTS "News can be inserted by admins" ON public.news;
DROP POLICY IF EXISTS "Admins can manage news" ON public.news;

CREATE POLICY "Admins can manage news"
    ON public.news FOR ALL
    TO authenticated
    USING ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') )
    WITH CHECK ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') );

-- 2. Archives Policies
DROP POLICY IF EXISTS "Admins can manage archives" ON public.archives;

CREATE POLICY "Admins can manage archives"
    ON public.archives FOR ALL
    TO authenticated
    USING ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') )
    WITH CHECK ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') );

-- 3. Event Pools Policies (Idempotent re-run to ensure safety)
DROP POLICY IF EXISTS "Admins can manage event_pools" ON public.event_pools;

CREATE POLICY "Admins can manage event_pools"
    ON public.event_pools FOR ALL
    TO authenticated
    USING ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') )
    WITH CHECK ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') );
