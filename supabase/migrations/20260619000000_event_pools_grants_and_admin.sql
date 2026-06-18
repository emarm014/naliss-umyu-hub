-- Migration: Add GRANTS and Admin RLS Policies for Event Pools
-- Description: Ensures the API roles have access to the new tables, and grants administrators full RLS bypass capabilities.

-- Grant usage and basic table permissions to the API roles
GRANT ALL ON TABLE public.event_pools TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.pool_quiz_questions TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.pool_submissions TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.pool_participants TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.pool_applications TO anon, authenticated, service_role;

-- Allow all authenticated users to select event pools
DROP POLICY IF EXISTS "Enable read access for all authenticated users to event_pools" ON public.event_pools;
CREATE POLICY "Enable read access for all authenticated users to event_pools" 
    ON public.event_pools FOR SELECT 
    TO authenticated 
    USING (true);

-- Allow admins to bypass RLS for event_pools and related tables
CREATE POLICY "Admins can manage event_pools"
    ON public.event_pools FOR ALL
    TO authenticated
    USING ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') )
    WITH CHECK ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') );

CREATE POLICY "Admins can manage pool_quiz_questions"
    ON public.pool_quiz_questions FOR ALL
    TO authenticated
    USING ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') )
    WITH CHECK ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') );

CREATE POLICY "Admins can manage pool_submissions"
    ON public.pool_submissions FOR ALL
    TO authenticated
    USING ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') )
    WITH CHECK ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') );

CREATE POLICY "Admins can manage pool_participants"
    ON public.pool_participants FOR ALL
    TO authenticated
    USING ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') )
    WITH CHECK ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') );

CREATE POLICY "Admins can manage pool_applications"
    ON public.pool_applications FOR ALL
    TO authenticated
    USING ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') )
    WITH CHECK ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') );
