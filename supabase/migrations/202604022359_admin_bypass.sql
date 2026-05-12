-- Fix infinite recursion on users table and missing delete permissions
CREATE OR REPLACE FUNCTION public.is_admin_or_moderator()
RETURNS BOOLEAN AS $$
DECLARE
  role_val text;
BEGIN
  -- Avoid reading the whole table to prevent recursion
  SELECT role INTO role_val FROM public.users WHERE id = auth.uid() LIMIT 1;
  RETURN role_val IN ('super_admin', 'moderator');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Update ALL policies to use the bypass function
DO $$ 
DECLARE 
  t text;
  tables text[] := ARRAY[
    'users', 'announcements', 'events', 'materials', 
    'past_questions', 'courses', 'groups', 'group_members', 
    'conversations', 'messages', 'lecturers', 'executives', 
    'graduates', 'activity_logs', 'announcement_reads',
    'photos'
  ];
BEGIN
  FOR t IN SELECT unnest(tables) LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      
      -- Drop the previous recursive policies if they exist (Admin Full Control was combined ALL)
      EXECUTE 'DROP POLICY IF EXISTS "Admin Full Control ' || t || '" ON public.' || t;
      
      -- Instead of combining ALL which requires WITH CHECK to be satisfied on DELETE (impossible), split them into precise CRUD
      -- First drop them if they previously existed to avoid duplicate names
      EXECUTE 'DROP POLICY IF EXISTS "Admin Delete ' || t || '" ON public.' || t;
      EXECUTE 'DROP POLICY IF EXISTS "Admin Insert ' || t || '" ON public.' || t;
      EXECUTE 'DROP POLICY IF EXISTS "Admin Update ' || t || '" ON public.' || t;
      EXECUTE 'DROP POLICY IF EXISTS "Admin Select ' || t || '" ON public.' || t;

      -- Add the bypass policy for explicit CRUD operations
      EXECUTE 'CREATE POLICY "Admin Delete ' || t || '" ON public.' || t || ' FOR DELETE TO authenticated USING (public.is_admin_or_moderator())';
      EXECUTE 'CREATE POLICY "Admin Insert ' || t || '" ON public.' || t || ' FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_moderator())';
      EXECUTE 'CREATE POLICY "Admin Update ' || t || '" ON public.' || t || ' FOR UPDATE TO authenticated USING (public.is_admin_or_moderator()) WITH CHECK (public.is_admin_or_moderator())';
      EXECUTE 'CREATE POLICY "Admin Select ' || t || '" ON public.' || t || ' FOR SELECT TO authenticated USING (public.is_admin_or_moderator())';
      
    END IF;
  END LOOP;
END $$;
