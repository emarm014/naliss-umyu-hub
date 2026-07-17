-- Migration to neutralize Supabase Advisor warnings
-- 1. Drop Duplicate Index on pool_submissions (Constraint)
ALTER TABLE public.pool_submissions DROP CONSTRAINT IF EXISTS unique_user_pool_submission;

-- 2. Drop Redundant Admin Select policies where a permissive public/student read policy already exists (which makes the Admin policy redundant and causes performance issues)
DROP POLICY IF EXISTS "Admin Select activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Admin Select announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admin Select courses" ON public.courses;
DROP POLICY IF EXISTS "Admin Select events" ON public.events;
DROP POLICY IF EXISTS "Admin Select executives" ON public.executives;
DROP POLICY IF EXISTS "Admin Select graduates" ON public.graduates;
DROP POLICY IF EXISTS "Admin Select group_members" ON public.group_members;
DROP POLICY IF EXISTS "Admin Select groups" ON public.groups;
DROP POLICY IF EXISTS "Admin Select lecturers" ON public.lecturers;
DROP POLICY IF EXISTS "Admin Select materials" ON public.materials;
DROP POLICY IF EXISTS "Admin Select messages" ON public.messages;
DROP POLICY IF EXISTS "Admin Select past_questions" ON public.past_questions;
DROP POLICY IF EXISTS "Admin Select photos" ON public.photos;
DROP POLICY IF EXISTS "Admin Select users" ON public.users;

-- 3. Drop Redundant Admin policies on tables with full access enabled for all authenticated users
-- "Admins can manage event_pools" vs "Enable read access for all authenticated users to event_pools"
-- Actually "Admins can manage event_pools" is for ALL actions. So it includes SELECT. We can't drop it entirely.
-- We can alter it to only apply to INSERT, UPDATE, DELETE, but Supabase doesn't support ALTER POLICY ... FOR.
-- So we drop it and recreate it for INSERT, UPDATE, DELETE.

DROP POLICY IF EXISTS "Admins can manage event_pools" ON public.event_pools;
CREATE POLICY "Admins can insert event_pools" ON public.event_pools FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_moderator());
CREATE POLICY "Admins can update event_pools" ON public.event_pools FOR UPDATE TO authenticated USING (public.is_admin_or_moderator()) WITH CHECK (public.is_admin_or_moderator());
CREATE POLICY "Admins can delete event_pools" ON public.event_pools FOR DELETE TO authenticated USING (public.is_admin_or_moderator());

DROP POLICY IF EXISTS "Admins can manage archives" ON public.archives;
CREATE POLICY "Admins can insert archives" ON public.archives FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_moderator());
CREATE POLICY "Admins can update archives" ON public.archives FOR UPDATE TO authenticated USING (public.is_admin_or_moderator()) WITH CHECK (public.is_admin_or_moderator());
CREATE POLICY "Admins can delete archives" ON public.archives FOR DELETE TO authenticated USING (public.is_admin_or_moderator());

DROP POLICY IF EXISTS "Admins can manage news" ON public.news;
CREATE POLICY "Admins can insert news" ON public.news FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_moderator());
CREATE POLICY "Admins can update news" ON public.news FOR UPDATE TO authenticated USING (public.is_admin_or_moderator()) WITH CHECK (public.is_admin_or_moderator());
CREATE POLICY "Admins can delete news" ON public.news FOR DELETE TO authenticated USING (public.is_admin_or_moderator());

-- 4. Clean up duplicate user policies on messages
-- "Users can delete their own messages" vs "Student Delete Own Messages"
DROP POLICY IF EXISTS "Users can delete their own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can edit their own messages" ON public.messages;

-- 5. Note on Unused Indexes: 
-- The advisor reported ~40 unused indexes. We are intentionally NOT dropping them.
-- They are only marked as 'unused' because the database is new and hasn't received 
-- production query traffic yet. Dropping them now would harm performance later.
