-- ============================================================================
-- RESILIENT REGISTRATION & GROUP AUTO-JOIN HARDENING
-- Migration: 20260914000000_resilient_registration_and_groups.sql
--
-- Fixes two gaps identified in the architectural audit:
-- 1. The create_user_profile RPC was untracked (created outside migrations).
--    This migration formalizes it as a SECURITY DEFINER function with input
--    sanitization, duplicate checks, and UPSERT semantics.
-- 2. The group auto-join trigger identified the department group by exact name
--    match ('NALISS FAMILY UMYUK'), which breaks if the group is renamed.
--    This migration replaces it with group_type-first lookup with name fallback.
-- ============================================================================

-- ========================================================================
-- 1. RESILIENT GROUP AUTO-JOIN TRIGGER FUNCTION
-- ========================================================================
-- Replaces the previous version that used exact name match for department group.
-- Now uses group_type = 'department' first, with ILIKE name fallback.
-- Level matching uses TRIM() to guard against whitespace inconsistencies.

CREATE OR REPLACE FUNCTION public.handle_student_group_auto_join()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_dept_group_id UUID;
    v_level_group_id UUID;
BEGIN
    -- Only run for active students with a valid level
    IF NEW.role != 'student' OR NEW.level IS NULL THEN
        RETURN NEW;
    END IF;

    -- 1. Find the canonical Department Group (official + oldest)
    --    Custom admin-created groups are excluded by is_official filter.
    --    ORDER BY created_at ASC ensures we always pick the original group
    --    even if multiple official department groups somehow exist.
    SELECT id INTO v_dept_group_id
    FROM public.groups
    WHERE group_type = 'department'
      AND is_official = true
      AND is_active = true
    ORDER BY created_at ASC
    LIMIT 1;

    -- Fallback: try name match if no official department group found
    IF v_dept_group_id IS NULL THEN
        SELECT id INTO v_dept_group_id
        FROM public.groups
        WHERE name ILIKE '%NALISS FAMILY%' AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1;
    END IF;

    -- Join Department Group
    IF v_dept_group_id IS NOT NULL THEN
        INSERT INTO public.group_members (group_id, user_id, role)
        VALUES (v_dept_group_id, NEW.id, 'member')
        ON CONFLICT (group_id, user_id) DO NOTHING;
    END IF;

    -- 2. Find the canonical Level Group (official + matching level)
    --    Same logic: only official level groups are used for auto-join.
    SELECT id INTO v_level_group_id
    FROM public.groups
    WHERE group_type = 'level'
      AND TRIM(level) = TRIM(NEW.level)
      AND is_official = true
      AND is_active = true
    ORDER BY created_at ASC
    LIMIT 1;

    -- Fallback: try without is_official if no official level group found
    IF v_level_group_id IS NULL THEN
        SELECT id INTO v_level_group_id
        FROM public.groups
        WHERE group_type = 'level'
          AND TRIM(level) = TRIM(NEW.level)
          AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1;
    END IF;

    -- Join Level Group
    IF v_level_group_id IS NOT NULL THEN
        INSERT INTO public.group_members (group_id, user_id, role)
        VALUES (v_level_group_id, NEW.id, 'member')
        ON CONFLICT (group_id, user_id) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

-- Ensure the trigger still fires on the correct events
DROP TRIGGER IF EXISTS on_student_registration_group_sync ON public.users;
CREATE TRIGGER on_student_registration_group_sync
    AFTER INSERT OR UPDATE OF level, role ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_student_group_auto_join();

-- ========================================================================
-- 2. FORMAL 'create_user_profile' SECURITY DEFINER RPC
-- ========================================================================
-- Previously untracked — created outside migrations. This formalizes the
-- function with input sanitization, caller verification, duplicate checks,
-- and UPSERT semantics. The INSERT fires the auto-join trigger above.

DROP FUNCTION IF EXISTS public.create_user_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_user_profile(
    p_id UUID,
    p_full_name TEXT,
    p_email TEXT,
    p_registration_number TEXT,
    p_level TEXT,
    p_avatar_url TEXT DEFAULT NULL,
    p_username TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_reg TEXT;
    v_clean_user TEXT;
BEGIN
    -- Verify caller matches target user or has admin rights
    IF auth.uid() IS NULL OR (auth.uid() != p_id AND NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )) THEN
        RAISE EXCEPTION 'Unauthorized: Caller cannot create profile for another user';
    END IF;

    v_clean_reg := UPPER(TRIM(p_registration_number));
    v_clean_user := LOWER(TRIM(p_username));

    -- Check for duplicate registration numbers
    IF EXISTS (SELECT 1 FROM public.users WHERE registration_number = v_clean_reg AND id != p_id) THEN
        RAISE EXCEPTION 'Registration number % is already in use by another account', v_clean_reg;
    END IF;

    -- Upsert Profile
    INSERT INTO public.users (
        id,
        full_name,
        email,
        registration_number,
        level,
        avatar_url,
        username,
        role,
        status,
        created_at,
        updated_at
    ) VALUES (
        p_id,
        TRIM(p_full_name),
        LOWER(TRIM(p_email)),
        v_clean_reg,
        TRIM(p_level),
        p_avatar_url,
        v_clean_user,
        'student',
        'active',
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        registration_number = EXCLUDED.registration_number,
        level = EXCLUDED.level,
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
        username = COALESCE(EXCLUDED.username, public.users.username),
        role = 'student',
        status = 'active',
        updated_at = NOW();

    -- Return confirmation (The on_student_registration_group_sync trigger auto-fires here)
    RETURN jsonb_build_object(
        'success', true,
        'user_id', p_id,
        'level', p_level,
        'registration_number', v_clean_reg
    );
END;
$$;

-- Permission grants (matches existing grants from 20260710225600)
REVOKE EXECUTE ON FUNCTION public.create_user_profile(uuid, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_user_profile(uuid, text, text, text, text, text, text) TO authenticated;

-- ========================================================================
-- 3. DROP OVERLY RESTRICTIVE UNIQUE INDEX ON OFFICIAL DEPARTMENT GROUPS
-- ========================================================================
-- The idx_unique_official_dept_hub index (created outside migrations) enforces
-- that only ONE official department-type group can exist. This blocks admins
-- from creating custom groups with group_type='department' and is_official=true.
-- The auto-join trigger identifies the department group by group_type, not by
-- uniqueness constraints, so this index serves no functional purpose.

DROP INDEX IF EXISTS public.idx_unique_official_dept_hub;
