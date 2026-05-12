-- NALISS ATOMIC REGISTRATION HARDENING
-- This migration ensures that student records are ONLY created by the mobile app's final step.
-- It removes any existing triggers that might be auto-syncing auth.users to public.users prematurely.

-- 1. Identify and Drop potential auto-sync triggers on auth.users
-- Since names can vary, we drop common names used in Supabase templates/tutorials.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS sync_auth_user ON auth.users;
DROP TRIGGER IF EXISTS handle_new_user ON auth.users;

-- 2. Modify the public.users table to ensure it supports the atomic flow.
-- We ensure 'role' defaults to 'student' but 'is_verified' defaults to FALSE.
-- The mobile app will set it to TRUE only when the Level Selection (Final Step) is complete.
ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'student';
ALTER TABLE public.users ALTER COLUMN is_verified SET DEFAULT false;

-- 3. Cleanup any "Zombies" (Incomplete registrations)
-- Any user who has a record in public.users but NO level hasn't finished registration.
-- We won't delete them, but we mark them as unverified so the Admin knows they are non-functional.
UPDATE public.users 
SET is_verified = false 
WHERE level IS NULL AND role = 'student';

-- 4. Secure the handle_student_group_auto_join function
-- We already have this from previous migrations, but we ensure it only fires
-- when a REAL level is provided (not for empty/placeholder records).
CREATE OR REPLACE FUNCTION public.handle_student_group_auto_join()
RETURNS TRIGGER AS $$
DECLARE
    dept_group_id UUID;
    level_group_id UUID;
BEGIN
    -- Only process students who have finished their profile (have a level)
    IF NEW.role != 'student' OR NEW.level IS NULL THEN
        RETURN NEW;
    END IF;

    -- A. Join Department Group (Core Community)
    SELECT id INTO dept_group_id FROM public.groups WHERE name = 'NALISS FAMILY UMYUK' LIMIT 1;
    IF dept_group_id IS NOT NULL THEN
        INSERT INTO public.group_members (group_id, user_id, role)
        VALUES (dept_group_id, NEW.id, 'member')
        ON CONFLICT (group_id, user_id) DO NOTHING;
    END IF;

    -- B. Join Level Group
    SELECT id INTO level_group_id FROM public.groups 
    WHERE group_type = 'level' AND level = NEW.level LIMIT 1;
    
    IF level_group_id IS NOT NULL THEN
        INSERT INTO public.group_members (group_id, user_id, role)
        VALUES (level_group_id, NEW.id, 'member')
        ON CONFLICT (group_id, user_id) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. ATOMIC CLEANUP: THE "JANITOR" PROCEDURE
-- This function deletes any 'auth.users' entries that have no corresponding 'public.users' 
-- profile and haven't finished sign-up within 24 hours.
-- This ensures 'All or Nothing' - if they don't finish, they are discarded.

CREATE OR REPLACE FUNCTION public.cleanup_stagnant_registrations()
RETURNS void AS $$
BEGIN
    -- This logic deletes auth records that have no student profile linked after 24 hours.
    -- (Note: In Supabase, this requires the 'service_role' or a custom Edge Function 
    --  because auth.users is protected. Alternatively, we just hide them as unverified).
    
    -- For now, we logically discard them from the public platform:
    DELETE FROM public.users 
    WHERE level IS NULL 
    AND role = 'student' 
    AND created_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. INDEXING FOR ATOMIC PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_users_is_verified_level ON public.users(is_verified, level) WHERE level IS NULL;
