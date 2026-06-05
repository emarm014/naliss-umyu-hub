-- 1. Ensure Groups Exist with Proper DPs (Display Pictures)
-- General Group
INSERT INTO public.groups (name, description, group_type, avatar_url, is_active)
VALUES (
    'NALISS General Hub', 
    'Official group for all NALISS members', 
    'department', 
    'https://api.dicebear.com/9.x/shapes/png?seed=NalissGeneral&size=200',
    true
)
ON CONFLICT DO NOTHING;

-- Level Groups
INSERT INTO public.groups (name, level, group_type, avatar_url, is_active)
VALUES 
    ('100 Level Hub', '100', 'level', 'https://api.dicebear.com/9.x/shapes/png?seed=Level100&size=200', true),
    ('200 Level Hub', '200', 'level', 'https://api.dicebear.com/9.x/shapes/png?seed=Level200&size=200', true),
    ('300 Level Hub', '300', 'level', 'https://api.dicebear.com/9.x/shapes/png?seed=Level300&size=200', true),
    ('400 Level Hub', '400', 'level', 'https://api.dicebear.com/9.x/shapes/png?seed=Level400&size=200', true),

ON CONFLICT DO NOTHING;

-- Update existing groups with stickers just in case they were missing
UPDATE public.groups SET avatar_url = 'https://api.dicebear.com/9.x/shapes/png?seed=Level100&size=200' WHERE group_type = 'level' AND level = '100' AND avatar_url IS NULL;
UPDATE public.groups SET avatar_url = 'https://api.dicebear.com/9.x/shapes/png?seed=NalissGeneral&size=200' WHERE group_type = 'department' AND avatar_url IS NULL;


-- 2. Master Trigger for New Users (Handles General Group + Sticker DP)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    final_avatar text;
    general_group_id UUID;
    level_group_id UUID;
BEGIN
    final_avatar := NEW.raw_user_meta_data->>'avatar_url';
    
    -- If no avatar provided, use a sticker/emoji generator based on user ID
    IF final_avatar IS NULL OR final_avatar = '' THEN
        final_avatar := 'https://api.dicebear.com/9.x/fun-emoji/png?seed=' || NEW.id || '&size=200';
    END IF;

    -- Create public.users profile
    INSERT INTO public.users (
      id, 
      full_name, 
      email, 
      avatar_url, 
      role, 
      registration_number, 
      level, 
      department,
      onboarding_status,
      is_verified
    )
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', 'Student'),
      NEW.email,
      final_avatar,
      COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
      NEW.raw_user_meta_data->>'reg_number',
      NEW.raw_user_meta_data->>'level',
      COALESCE(NEW.raw_user_meta_data->>'department', 'Library and Information Science'),
      'VERIFIED',
      true
    );

    -- AUTO JOIN GROUPS (Atomic Group Join on User Creation)
    
    -- 1. General Group
    SELECT id INTO general_group_id FROM public.groups WHERE group_type = 'department' LIMIT 1;
    IF general_group_id IS NOT NULL THEN
        INSERT INTO public.group_members (group_id, user_id, role)
        VALUES (general_group_id, NEW.id, 'member') ON CONFLICT DO NOTHING;
    END IF;

    -- 2. Level Group (If level is already provided via Email Sign Up atomic flow)
    IF NEW.raw_user_meta_data->>'level' IS NOT NULL THEN
        SELECT id INTO level_group_id FROM public.groups 
        WHERE group_type = 'level' AND level = NEW.raw_user_meta_data->>'level' LIMIT 1;
        
        IF level_group_id IS NOT NULL THEN
            INSERT INTO public.group_members (group_id, user_id, role)
            VALUES (level_group_id, NEW.id, 'member') ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Trigger for Level Updates (Handles Google Flow where level is added AFTER user creation)
CREATE OR REPLACE FUNCTION public.handle_user_group_sync()
RETURNS TRIGGER AS $$
DECLARE
    level_group_id UUID;
BEGIN
    -- Join Specific Level Group based on the newly updated Level
    IF NEW.level IS NOT NULL THEN
        SELECT id INTO level_group_id FROM public.groups 
        WHERE group_type = 'level' AND level = NEW.level LIMIT 1;
        
        IF level_group_id IS NOT NULL THEN
            INSERT INTO public.group_members (group_id, user_id, role)
            VALUES (level_group_id, NEW.id, 'member')
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to public.users for level updates
DROP TRIGGER IF EXISTS on_user_level_update ON public.users;
CREATE TRIGGER on_user_level_update
AFTER UPDATE OF level ON public.users
FOR EACH ROW
WHEN (NEW.level IS NOT NULL AND OLD.level IS DISTINCT FROM NEW.level)
EXECUTE FUNCTION public.handle_user_group_sync();


-- 4. STRICT PRIVACY: Restrict Group Visibility
-- Users should only see their own level group and the general hub.
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active groups" ON public.groups;
DROP POLICY IF EXISTS "Users can only see their own level group and general groups" ON public.groups;

CREATE POLICY "Users can only see their own level group and general groups"
ON public.groups
FOR SELECT
TO authenticated
USING (
    is_active = true 
    AND (
        group_type = 'department' -- General Hub
        OR (group_type = 'level' AND level = (SELECT level FROM public.users WHERE id = auth.uid())) -- Matches User's Level
        OR id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid()) -- User is already a member
    )
);
