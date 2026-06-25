CREATE OR REPLACE FUNCTION public.fetch_admin_analytics()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  users_total int;
  users_active int;
  users_suspended int;
  users_banned int;
  users_graduated int;
  users_pending int;
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
  SELECT count(*) INTO users_total FROM public.users;
  SELECT count(*) INTO users_active FROM public.users WHERE status = 'active';
  SELECT count(*) INTO users_suspended FROM public.users WHERE status = 'suspended';
  SELECT count(*) INTO users_banned FROM public.users WHERE status = 'banned';
  SELECT count(*) INTO users_graduated FROM public.users WHERE status = 'graduated';
  SELECT count(*) INTO users_pending FROM public.users WHERE status = 'pending';
  
  SELECT json_object_agg(COALESCE(level, 'Unknown'), count) INTO users_by_level
  FROM (SELECT level, count(*) FROM public.users GROUP BY level) t;
  
  SELECT json_object_agg(role, count) INTO users_by_role
  FROM (SELECT role, count(*) FROM public.users GROUP BY role) t;

  SELECT count(*) INTO content_materials FROM public.materials WHERE is_active = true;
  SELECT count(*) INTO content_past_questions FROM public.past_questions;
  SELECT count(*) INTO content_courses FROM public.courses WHERE is_active = true;
  SELECT count(*) INTO content_events FROM public.events;
  SELECT count(*) INTO content_announcements FROM public.announcements WHERE is_published = true;

  SELECT count(*) INTO community_groups FROM public.groups;
  SELECT count(*) INTO community_lecturers FROM public.lecturers;
  SELECT count(*) INTO community_executives FROM public.executives;
  SELECT count(*) INTO community_graduates FROM public.graduates;
  SELECT count(*) INTO community_messages FROM public.messages;
  SELECT count(*) INTO community_conversations FROM public.conversations WHERE is_active = true;

  SELECT COALESCE(sum(view_count), 0) INTO engagement_material_views FROM public.materials;
  SELECT COALESCE(sum(download_count), 0) INTO engagement_material_downloads FROM public.materials;
  SELECT COALESCE(sum(view_count), 0) INTO engagement_announcement_views FROM public.announcements;

  -- 5. Storage Estimates bypassed due to missing columns
  storage_materials := 0;
  storage_past_questions := 0;
  storage_resources := 0; 
  storage_total := 0;

  result := json_build_object(
    'users', json_build_object(
      'total', users_total,
      'active', users_active,
      'suspended', users_suspended,
      'banned', users_banned,
      'graduated', users_graduated,
      'pending', users_pending,
      'by_level', users_by_level,
      'by_role', users_by_role
    ),
    'content', json_build_object(
      'materials', content_materials,
      'pastQuestions', content_past_questions,
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
      'materials', storage_materials,
      'past_questions', storage_past_questions,
      'resources', storage_resources,
      'total', storage_total,
      'backups', 0
    )
  );

  RETURN result;
END;
$$;
