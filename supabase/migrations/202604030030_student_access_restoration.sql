-- NALISS Critical Fix: Restore Student Access
-- The admin_bypass migration (202604022359) accidentally removed the
-- "Student Read Only" SELECT policies when it dropped "Admin Full Control".
-- This migration restores full student access across all tables.

-- ============================================================
-- 1. STUDENT READ ACCESS (SELECT) - All public tables
-- ============================================================
DO $$ 
DECLARE 
  t text;
  tables text[] := ARRAY[
    'announcements', 'events', 'materials', 
    'past_questions', 'courses', 'groups', 'group_members', 
    'lecturers', 'executives', 'graduates',
    'announcement_reads', 'photos'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      -- Drop if exists to avoid duplicates
      EXECUTE 'DROP POLICY IF EXISTS "Student Read Only ' || t || '" ON public.' || t;
      -- Recreate: All authenticated users can read
      EXECUTE 'CREATE POLICY "Student Read Only ' || t || '" ON public.' || t || ' FOR SELECT TO authenticated USING (true)';
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 2. USERS TABLE - Students can read all profiles AND update their own
-- ============================================================
DROP POLICY IF EXISTS "Student Read Only users" ON public.users;
CREATE POLICY "Student Read Only users" ON public.users
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Student Update Own Profile" ON public.users;
CREATE POLICY "Student Update Own Profile" ON public.users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Allow new user profile creation during signup
DROP POLICY IF EXISTS "Student Insert Own Profile" ON public.users;
CREATE POLICY "Student Insert Own Profile" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- ============================================================
-- 3. MESSAGES - Students can send and manage their own messages
-- ============================================================
DROP POLICY IF EXISTS "Student Insert Messages" ON public.messages;
CREATE POLICY "Student Insert Messages" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "Student Update Own Messages" ON public.messages;
CREATE POLICY "Student Update Own Messages" ON public.messages
  FOR UPDATE TO authenticated
  USING (auth.uid() = sender_id)
  WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "Student Delete Own Messages" ON public.messages;
CREATE POLICY "Student Delete Own Messages" ON public.messages
  FOR DELETE TO authenticated
  USING (auth.uid() = sender_id);

-- ============================================================
-- 4. GROUP MEMBERS - Students can join groups
-- ============================================================
DROP POLICY IF EXISTS "Student Insert Group Member" ON public.group_members;
CREATE POLICY "Student Insert Group Member" ON public.group_members
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 5. CONVERSATIONS - Students can read/write their conversations
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'conversations') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Student Read Own Conversations" ON public.conversations';
    EXECUTE 'CREATE POLICY "Student Read Own Conversations" ON public.conversations FOR SELECT TO authenticated USING (true)';
    
    EXECUTE 'DROP POLICY IF EXISTS "Student Insert Conversations" ON public.conversations';
    EXECUTE 'CREATE POLICY "Student Insert Conversations" ON public.conversations FOR INSERT TO authenticated WITH CHECK (true)';
  END IF;
END $$;

-- ============================================================
-- 6. ANNOUNCEMENT READS - Students can mark announcements as read
-- ============================================================
DROP POLICY IF EXISTS "Student Insert Announcement Reads" ON public.announcement_reads;
CREATE POLICY "Student Insert Announcement Reads" ON public.announcement_reads
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 7. SYSTEM SETTINGS - Everyone can read (needed for maintenance mode check)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'system_settings') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Public Read Settings" ON public.system_settings';
    EXECUTE 'CREATE POLICY "Public Read Settings" ON public.system_settings FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;

-- ============================================================
-- 8. ACTIVITY LOGS - Students can read their own logs
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'activity_logs') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Student Read Activity Logs" ON public.activity_logs';
    EXECUTE 'CREATE POLICY "Student Read Activity Logs" ON public.activity_logs FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;
