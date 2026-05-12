-- 1. Update the master trigger to skip profile creation if metadata is missing (Atomicity)
-- This prevents partial records when sending OTP or during initial Google login.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Only create profile if BOTH name and level are present in metadata
    -- (This happens if using auth.signUp with full data, otherwise we skip)
    IF (NEW.raw_user_meta_data->>'full_name') IS NULL OR (NEW.raw_user_meta_data->>'level') IS NULL THEN
        RETURN NEW;
    END IF;

    -- If we have enough data, create the record (for non-step-by-step flows)
    INSERT INTO public.users (
      id, 
      full_name, 
      email, 
      avatar_url, 
      registration_number, 
      level, 
      is_verified
    )
    VALUES (
      NEW.id,
      NEW.raw_user_meta_data->>'full_name',
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'avatar_url', 'https://api.dicebear.com/9.x/fun-emoji/svg?seed=' || NEW.id),
      NEW.raw_user_meta_data->>'reg_number',
      NEW.raw_user_meta_data->>'level',
      true
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Ensure General Hub join happens even if the profile was created manually in level.tsx
-- This handles both Google flow and the new OTP flow.
CREATE OR REPLACE FUNCTION public.handle_user_group_sync()
RETURNS TRIGGER AS $$
DECLARE
    general_group_id UUID;
    level_group_id UUID;
BEGIN
    -- 1. Always ensure user is in the General Hub
    SELECT id INTO general_group_id FROM public.groups WHERE group_type = 'department' LIMIT 1;
    IF general_group_id IS NOT NULL THEN
        INSERT INTO public.group_members (group_id, user_id, role)
        VALUES (general_group_id, NEW.id, 'member') ON CONFLICT DO NOTHING;
    END IF;

    -- 2. Join Level Group when level is set/updated
    IF NEW.level IS NOT NULL THEN
        SELECT id INTO level_group_id FROM public.groups 
        WHERE group_type = 'level' AND level = NEW.level LIMIT 1;
        
        IF level_group_id IS NOT NULL THEN
            INSERT INTO public.group_members (group_id, user_id, role)
            VALUES (level_group_id, NEW.id, 'member') ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Attach trigger to public.users for BOTH INSERT and UPDATE
-- This ensures that as soon as a row appears in users (level.tsx manual insert), 
-- they get joined to the groups.
DROP TRIGGER IF EXISTS on_user_profile_finalize ON public.users;
CREATE TRIGGER on_user_profile_finalize
AFTER INSERT ON public.users
FOR EACH ROW EXECUTE FUNCTION public.handle_user_group_sync();

-- (Keep the existing update trigger for level changes)
DROP TRIGGER IF EXISTS on_user_level_update ON public.users;
CREATE TRIGGER on_user_level_update
AFTER UPDATE OF level ON public.users
FOR EACH ROW
WHEN (NEW.level IS NOT NULL AND OLD.level IS DISTINCT FROM NEW.level)
EXECUTE FUNCTION public.handle_user_group_sync();
