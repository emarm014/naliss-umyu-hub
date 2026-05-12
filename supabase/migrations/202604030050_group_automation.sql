-- NALISS Group Automation: Auto-join students to their level and department groups
-- This script ensures students have immediate access to community chats upon registration.

-- 1. Ensure core groups exist (if not already created by seed/admin)
INSERT INTO public.groups (name, description, group_type, level, is_active)
VALUES 
  ('NALISS FAMILY UMYUK', 'General discussion for all NALISS students', 'department', null, true),
  ('Level 100', '100 Level student discourse and announcements', 'level', '100', true),
  ('Level 200', '200 Level student discourse and announcements', 'level', '200', true),
  ('Level 300', '300 Level student discourse and announcements', 'level', '300', true),
  ('Level 400', '400 Level student discourse and announcements', 'level', '400', true)
ON CONFLICT (name) DO UPDATE SET level = EXCLUDED.level;

-- 2. Function to auto-join student to their groups
CREATE OR REPLACE FUNCTION public.handle_student_group_auto_join()
RETURNS TRIGGER AS $$
DECLARE
    dept_group_id UUID;
    level_group_id UUID;
BEGIN
    -- Only process students
    IF NEW.role != 'student' THEN
        RETURN NEW;
    END IF;

    -- A. Join Department Group
    SELECT id INTO dept_group_id FROM public.groups WHERE name = 'NALISS FAMILY UMYUK' LIMIT 1;
    IF dept_group_id IS NOT NULL THEN
        INSERT INTO public.group_members (group_id, user_id, role)
        VALUES (dept_group_id, NEW.id, 'member')
        ON CONFLICT (group_id, user_id) DO NOTHING;
    END IF;

    -- B. Join Level Group (if level is set)
    IF NEW.level IS NOT NULL THEN
        SELECT id INTO level_group_id FROM public.groups 
        WHERE group_type = 'level' AND level = NEW.level LIMIT 1;
        
        IF level_group_id IS NOT NULL THEN
            INSERT INTO public.group_members (group_id, user_id, role)
            VALUES (level_group_id, NEW.id, 'member')
            ON CONFLICT (group_id, user_id) DO NOTHING;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Trigger for synchronization
DROP TRIGGER IF EXISTS on_student_registration_group_sync ON public.users;
CREATE TRIGGER on_student_registration_group_sync
    AFTER INSERT OR UPDATE OF level, role ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_student_group_auto_join();

-- 4. MESSAGES ACCESS - Ensure students can read messages in their groups
DROP POLICY IF EXISTS "Student Read Group Messages" ON public.messages;
CREATE POLICY "Student Read Group Messages" ON public.messages
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.group_members 
            WHERE group_id = messages.group_id AND user_id = auth.uid()
        )
        OR 
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND role IN ('super_admin', 'moderator')
        )
    );

-- 5. Retroactive join for existing students who might be stranded
DO $$
DECLARE
    user_record RECORD;
BEGIN
    FOR user_record IN SELECT id, role, level FROM public.users WHERE role = 'student' LOOP
        -- Repeat logic for each student
        -- (This is safe because of ON CONFLICT DO NOTHING)
        
        -- Dept Group
        INSERT INTO public.group_members (group_id, user_id, role)
        SELECT id, user_record.id, 'member' FROM public.groups WHERE name = 'NALISS FAMILY UMYUK'
        ON CONFLICT DO NOTHING;

        -- Level Group
        IF user_record.level IS NOT NULL THEN
            INSERT INTO public.group_members (group_id, user_id, role)
            SELECT id, user_record.id, 'member' FROM public.groups 
            WHERE group_type = 'level' AND level = user_record.level
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
END $$;
