-- Add allow_media column to public.groups table
-- Default is true (media uploads enabled). When set to false by an admin, media uploads are locked for that group.

ALTER TABLE public.groups 
ADD COLUMN IF NOT EXISTS allow_media BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.groups.allow_media IS 'Controls whether group members can upload media/files in this group chat. Only modifiable by Admins.';

-- Update get_groups_with_counts RPC to return allow_media
CREATE OR REPLACE FUNCTION public.get_groups_with_counts()
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  group_type text,
  level text,
  department_id uuid,
  avatar_url text,
  moderator_id uuid,
  created_by uuid,
  is_active boolean,
  is_official boolean,
  chat_enabled boolean,
  allow_media boolean,
  created_at timestamptz,
  updated_at timestamptz,
  member_count bigint,
  moderator_full_name text,
  moderator_email text,
  moderator_role text
) 
LANGUAGE sql
SECURITY INVOKER
AS $$
  SELECT 
    g.id,
    g.name,
    g.description,
    g.group_type,
    g.level,
    g.department_id,
    g.avatar_url,
    g.moderator_id,
    g.created_by,
    g.is_active,
    g.is_official,
    g.chat_enabled,
    COALESCE(g.allow_media, true) as allow_media,
    g.created_at,
    g.updated_at,
    COUNT(gm.id) as member_count,
    u.full_name as moderator_full_name,
    u.email as moderator_email,
    u.role as moderator_role
  FROM public.groups g
  LEFT JOIN public.group_members gm ON g.id = gm.group_id
  LEFT JOIN public.users u ON g.moderator_id = u.id
  GROUP BY g.id, u.id;
$$;
