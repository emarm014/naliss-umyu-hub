-- 1. Update the Email Format Registration Check
CREATE OR REPLACE FUNCTION public.check_registration_status(email_addr text)
RETURNS text AS $$
DECLARE
    user_status text;
BEGIN
    -- Strict Regex: (lis|blis) + 6 digits + @students.umyu.edu.ng
    IF email_addr !~* '^(lis|blis)[0-9]{6}@students\.umyu\.edu\.ng$' THEN
        RETURN 'INVALID_FORMAT';
    END IF;

    -- Check if user exists and is blocked (simulated placeholder for global block)
    SELECT onboarding_status INTO user_status 
    FROM public.users 
    WHERE email = email_addr 
    LIMIT 1;

    IF user_status IS NOT NULL THEN
        RETURN user_status; -- VERIFIED or PENDING_IDENTITY etc
    END IF;

    RETURN 'NOT_REGISTERED';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Ensure Group Sync Trigger handles UPDATES to level
DROP TRIGGER IF EXISTS on_user_onboarding_complete ON public.users;

CREATE TRIGGER on_user_onboarding_complete
AFTER UPDATE OF level, onboarding_status ON public.users
FOR EACH ROW
WHEN (NEW.onboarding_status = 'VERIFIED' AND OLD.onboarding_status != 'VERIFIED')
EXECUTE FUNCTION public.handle_user_group_sync();

-- 3. Ensure the function handle_user_group_sync also joins the General Group if not present
CREATE OR REPLACE FUNCTION public.handle_user_group_sync()
RETURNS TRIGGER AS $$
DECLARE
    general_group_id UUID;
    level_group_id UUID;
BEGIN
    -- Join Department General Group
    SELECT id INTO general_group_id FROM public.groups WHERE name = 'NALISS FAMILY UMYUK' LIMIT 1;
    IF general_group_id IS NOT NULL THEN
        INSERT INTO public.group_members (group_id, user_id, role)
        VALUES (general_group_id, NEW.id, 'member')
        ON CONFLICT DO NOTHING;
    END IF;

    -- Join Specific Level Group
    SELECT id INTO level_group_id FROM public.groups 
    WHERE group_type = 'level' AND level = NEW.level LIMIT 1;
    IF level_group_id IS NOT NULL THEN
        INSERT INTO public.group_members (group_id, user_id, role)
        VALUES (level_group_id, NEW.id, 'member')
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
