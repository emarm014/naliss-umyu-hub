-- Migration: Fix Admin RLS Policies for pool_quiz_questions
-- Description: Ensures the API roles have access and administrators have full management bypass.

GRANT ALL ON TABLE public.pool_quiz_questions TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Admins can manage pool_quiz_questions" ON public.pool_quiz_questions;

CREATE POLICY "Admins can manage pool_quiz_questions"
    ON public.pool_quiz_questions FOR ALL
    TO authenticated
    USING ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') )
    WITH CHECK ( (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'super_admin', 'executive', 'moderator') );
