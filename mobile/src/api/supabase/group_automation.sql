-- Modified function for cohort-based group evolution
-- Students stay in their groups; groups themselves grow (L100 -> L200)
CREATE OR REPLACE FUNCTION public.handle_user_group_sync()
RETURNS TRIGGER AS $$
DECLARE
    general_group_id UUID;
    level_group_id UUID;
    already_in_level_group boolean;
BEGIN
    -- 1. Ensure user is in the general "NALISS FAMILY UMYUK" group
    SELECT id INTO general_group_id FROM public.groups WHERE name = 'NALISS FAMILY UMYUK' LIMIT 1;
    
    IF general_group_id IS NOT NULL THEN
        INSERT INTO public.group_members (group_id, user_id, role)
        VALUES (general_group_id, NEW.id, 'member')
        ON CONFLICT (group_id, user_id) DO NOTHING;
    END IF;

    -- 2. Join Level Group (Initial Only)
    -- Check if user is already in ANY group of type 'level'
    SELECT EXISTS (
        SELECT 1 FROM public.group_members gm
        JOIN public.groups g ON g.id = gm.group_id
        WHERE gm.user_id = NEW.id AND g.group_type = 'level'
    ) INTO already_in_level_group;

    -- ONLY join a level group if they aren't in one yet
    -- This means initial registration puts them in a group, 
    -- but subsequent profile level changes won't trigger NEW group joins.
    IF NOT already_in_level_group THEN
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

-- Refined Annual Transition Logic
-- CRITICAL: This function should ONLY be called manually or by a scheduled worker 
-- at the EXACT END of the academic year (e.g., December 2026 for the current L400s).
-- It will permanently shift cohorts to the next level and archive the graduands.
CREATE OR REPLACE FUNCTION public.perform_academic_year_transition()
RETURNS void AS $$
DECLARE
    current_year text := to_char(now(), 'YYYY');
    new_archive_name text := 'Archive - Graduating Class of ' || current_year;
BEGIN
    -- 1. Evolve Groups Globally (Renaming)
    
    -- Level 400 Graduates
    UPDATE public.groups
    SET name = new_archive_name,
        group_type = 'archive',
        level = NULL,
        description = 'Archived cohort group for the graduating class of ' || current_year
    WHERE group_type = 'level' AND level = '400';

    -- Level 300 -> Level 400
    UPDATE public.groups
    SET name = 'Level 400',
        level = '400'
    WHERE group_type = 'level' AND level = '300';

    -- Level 200 -> Level 300
    UPDATE public.groups
    SET name = 'Level 300',
        level = '300'
    WHERE group_type = 'level' AND level = '200';

    -- Level 100 -> Level 200
    UPDATE public.groups
    SET name = 'Level 200',
        level = '200'
    WHERE group_type = 'level' AND level = '100';

    -- Create fresh Level 100 group for new intake
    INSERT INTO public.groups (name, group_type, level, description, is_active)
    VALUES ('Level 100', 'level', '100', 'Official group for new Level 100 students', true);

    -- 2. Evolve Users Globally (Level up)
    UPDATE public.users SET level = '400' WHERE level = '300';
    UPDATE public.users SET level = '300' WHERE level = '200';
    UPDATE public.users SET level = '200' WHERE level = '100';
    
    -- Level 400 students move to graduates
    UPDATE public.users SET role = 'alumni' WHERE level = '400';

    RAISE NOTICE 'Academic transition complete. Groups evolved to current academic year.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
