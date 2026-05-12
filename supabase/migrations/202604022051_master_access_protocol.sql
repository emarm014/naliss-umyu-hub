-- NALISS Master Protocol: Universal Admin & Moderator Freedom Migration (Simplified)
-- Fixes: "Permission Denied" and "net.http_post" missing bridge.

-- 1. Bridge Activation: Institutional Networking
CREATE EXTENSION IF NOT EXISTS pg_net;
GRANT USAGE ON SCHEMA net TO postgres, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA net TO postgres, authenticated, service_role;

-- 2. Clean Up Old Policies (Universal Reset)
DO $$ 
DECLARE 
  r RECORD;
BEGIN
  FOR r IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public') LOOP
    EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON ' || quote_ident(r.tablename);
  END LOOP;
END $$;

-- 3. Master Access for Admins & Moderators (Error-Proof Version)
DO $$ 
DECLARE 
  t text;
  tables text[] := ARRAY[
    'users', 'announcements', 'events', 'materials', 
    'past_questions', 'courses', 'groups', 'group_members', 
    'conversations', 'messages', 'lecturers', 'executives', 
    'graduates', 'activity_logs', 'announcement_reads'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE 'ALTER TABLE public.' || t || ' ENABLE ROW LEVEL SECURITY';
      
      -- Admin & Moderator Protocol
      EXECUTE 'CREATE POLICY "Admin Full Control ' || t || '" ON public.' || t || ' FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role IN (''super_admin'', ''moderator''))) WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role IN (''super_admin'', ''moderator'')))';
      
      -- Public Read access
      EXECUTE 'CREATE POLICY "Student Read Only ' || t || '" ON public.' || t || ' FOR SELECT TO authenticated USING (true)';
    END IF;
  END LOOP;
END $$;

-- 4. Search Path Configuration (Signals/Push Notifications)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_push_notification_trigger') THEN
     ALTER FUNCTION public.handle_push_notification_trigger() SET search_path = public, net;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_new_user_groups') THEN
     ALTER FUNCTION public.handle_new_user_groups() SET search_path = public, net;
  END IF;
END $$;

-- 5. Global Grants (Postgres Layer)
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, authenticated, service_role;
