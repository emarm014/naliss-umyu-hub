-- Migration: 20260801150000_fix_analytics_direct_conversations.sql
-- Description: Fixes fetch_admin_analytics RPC which references non-existent
--   public.direct_conversations table (dropped in 20260626183000). Replaces
--   the broken SELECT with a constant assignment (conversations = 0).

CREATE OR REPLACE FUNCTION public.fetch_admin_analytics()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  users_total int;
  users_active int;
  users_suspended int;
  users_banned int;
  users_graduated int;
  users_pending int;
  external_moderators_total int;
  users_by_level json;
  users_by_role json;
  content_materials int;
  content_past_questions int;
  content_courses int;
  content_events int;
  content_announcements int;
  community_groups int;
  community_lecturers int;
  community_executives int;
  community_graduates int;
  community_messages int;
  community_conversations int;
  engagement_material_views int;
  engagement_material_downloads int;
  engagement_announcement_views int;
  storage_resources bigint;
  storage_materials bigint;
  storage_past_questions bigint;
  storage_total bigint;
BEGIN
  -- 1. User Census (Excludes external moderators from student total)
  SELECT count(*) INTO users_total FROM public.users WHERE role = 'student' OR (role = 'moderator' AND is_external IS NOT TRUE AND registration_number IS NOT NULL);
  SELECT count(*) INTO users_active FROM public.users WHERE status = 'active' AND (role = 'student' OR (role = 'moderator' AND is_external IS NOT TRUE));
  SELECT count(*) INTO users_suspended FROM public.users WHERE status = 'suspended';
  SELECT count(*) INTO users_banned FROM public.users WHERE status = 'banned';
  SELECT count(*) INTO users_graduated FROM public.users WHERE status = 'graduated';
  SELECT count(*) INTO users_pending FROM public.users WHERE status = 'pending';
  SELECT count(*) INTO external_moderators_total FROM public.users WHERE is_external IS TRUE OR (role = 'moderator' AND (registration_number IS NULL OR level IS NULL));
  
  -- Student census by level (excludes external moderators)
  SELECT json_object_agg(COALESCE(level, 'Unknown'), count) INTO users_by_level
  FROM (
    SELECT level, count(*) 
    FROM public.users 
    WHERE (role = 'student' OR (role = 'moderator' AND is_external IS NOT TRUE)) AND level IS NOT NULL 
    GROUP BY level
  ) t;
  
  SELECT json_object_agg(role, count) INTO users_by_role
  FROM (SELECT role, count(*) FROM public.users GROUP BY role) t;

  -- 2. Content Metrics
  SELECT count(*) INTO content_materials FROM public.materials;
  SELECT count(*) INTO content_past_questions FROM public.past_questions;
  SELECT count(*) INTO content_courses FROM public.courses;
  SELECT count(*) INTO content_events FROM public.events;
  SELECT count(*) INTO content_announcements FROM public.announcements;

  -- 3. Community Metrics
  SELECT count(*) INTO community_groups FROM public.groups WHERE is_active = true;
  SELECT count(*) INTO community_lecturers FROM public.lecturers WHERE is_active = true;
  SELECT count(*) INTO community_executives FROM public.executives WHERE is_active = true;
  SELECT count(*) INTO community_graduates FROM public.graduates;
  SELECT count(*) INTO community_messages FROM public.messages WHERE is_deleted = false;

  -- Conversations table was dropped in 20260626183000 — hardcode to 0
  community_conversations := 0;

  -- 4. Engagement Metrics
  SELECT COALESCE(sum(view_count), 0) INTO engagement_material_views FROM public.materials;
  SELECT COALESCE(sum(download_count), 0) INTO engagement_material_downloads FROM public.materials;
  SELECT COALESCE(sum(views_count), 0) INTO engagement_announcement_views FROM public.announcements;

  -- 5. Storage Metrics
  SELECT COALESCE(sum(file_size), 0) INTO storage_resources FROM public.cloud_archive;
  SELECT COALESCE(sum(file_size), 0) INTO storage_materials FROM public.materials;
  SELECT COALESCE(sum(file_size), 0) INTO storage_past_questions FROM public.past_questions;

  storage_total := storage_resources + storage_materials + storage_past_questions;

  -- Construct Final JSON
  result := json_build_object(
    'users', json_build_object(
      'total', users_total,
      'active', users_active,
      'suspended', users_suspended,
      'banned', users_banned,
      'graduated', users_graduated,
      'pending', users_pending,
      'external_moderators', external_moderators_total,
      'by_level', COALESCE(users_by_level, '{}'::json),
      'by_role', COALESCE(users_by_role, '{}'::json)
    ),
    'content', json_build_object(
      'materials', content_materials,
      'past_questions', content_past_questions,
      'courses', content_courses,
      'events', content_events,
      'announcements', content_announcements
    ),
    'community', json_build_object(
      'groups', community_groups,
      'lecturers', community_lecturers,
      'executives', community_executives,
      'graduates', community_graduates,
      'messages', community_messages,
      'conversations', community_conversations
    ),
    'engagement', json_build_object(
      'material_views', engagement_material_views,
      'material_downloads', engagement_material_downloads,
      'announcement_views', engagement_announcement_views
    ),
    'storage', json_build_object(
      'resources_bytes', storage_resources,
      'materials_bytes', storage_materials,
      'past_questions_bytes', storage_past_questions,
      'total_bytes', storage_total
    )
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_admin_analytics() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fetch_admin_analytics() FROM PUBLIC;
