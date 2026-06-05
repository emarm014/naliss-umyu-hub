-- Migration to convert existing default avatars from SVG to PNG
-- This updates all user and group records using DiceBear SVG URLs.

-- 1. Update existing users' default DiceBear SVG avatars to PNG format
UPDATE public.users 
SET avatar_url = REPLACE(REPLACE(avatar_url, '/svg?', '/png?'), '/svg', '/png') || 
                 CASE WHEN avatar_url NOT LIKE '%size=%' THEN '&size=200' ELSE '' END
WHERE avatar_url LIKE '%api.dicebear.com%' AND (avatar_url LIKE '%/svg%' OR avatar_url LIKE '%.svg%');

-- 2. Update existing groups' default DiceBear SVG avatars to PNG format
UPDATE public.groups 
SET avatar_url = REPLACE(REPLACE(avatar_url, '/svg?', '/png?'), '/svg', '/png') || 
                 CASE WHEN avatar_url NOT LIKE '%size=%' THEN '&size=200' ELSE '' END
WHERE avatar_url LIKE '%api.dicebear.com%' AND (avatar_url LIKE '%/svg%' OR avatar_url LIKE '%.svg%');

-- 3. Update public.handle_new_user() trigger function if it exists
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    final_avatar text;
    general_group_id UUID;
    level_group_id UUID;
BEGIN
    final_avatar := NEW.raw_user_meta_data->>'avatar_url';
    
    -- If no avatar provided, use a sticker/emoji generator based on user ID in PNG format
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
    )
    ON CONFLICT (id) DO UPDATE SET
      avatar_url = COALESCE(public.users.avatar_url, EXCLUDED.avatar_url);

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
