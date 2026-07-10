-- Fix: Unindexed foreign key warning from Supabase Advisors
CREATE INDEX IF NOT EXISTS pool_participants_user_id_idx ON public.pool_participants (user_id);

-- Fix: Auth RLS Initialization Plan warnings
-- Wrapping auth.uid() inside a (SELECT ...) prevents PostgreSQL from evaluating it on every single row
DROP POLICY IF EXISTS "user_downloads_select" ON public.user_downloads;
CREATE POLICY "user_downloads_select" ON public.user_downloads FOR SELECT USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_downloads_insert" ON public.user_downloads;
CREATE POLICY "user_downloads_insert" ON public.user_downloads FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_downloads_update" ON public.user_downloads;
CREATE POLICY "user_downloads_update" ON public.user_downloads FOR UPDATE USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_downloads_delete" ON public.user_downloads;
CREATE POLICY "user_downloads_delete" ON public.user_downloads FOR DELETE USING (user_id = (SELECT auth.uid()));

-- Fix user_notes policies
DROP POLICY IF EXISTS "user_notes_select" ON public.user_notes;
CREATE POLICY "user_notes_select" ON public.user_notes FOR SELECT USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_notes_insert" ON public.user_notes;
CREATE POLICY "user_notes_insert" ON public.user_notes FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_notes_update" ON public.user_notes;
CREATE POLICY "user_notes_update" ON public.user_notes FOR UPDATE USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_notes_delete" ON public.user_notes;
CREATE POLICY "user_notes_delete" ON public.user_notes FOR DELETE USING (user_id = (SELECT auth.uid()));

-- Fix activity_logs policy
DROP POLICY IF EXISTS "Student Read Activity Logs" ON public.activity_logs;
CREATE POLICY "Student Read Activity Logs" ON public.activity_logs FOR SELECT USING (user_id = (SELECT auth.uid()));
