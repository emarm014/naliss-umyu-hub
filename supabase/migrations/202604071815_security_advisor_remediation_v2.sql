-- Security Advisor Remediation: Fixing Security Definer View
-- This view was flagged by Supabase Security Advisor because it uses SECURITY DEFINER,
-- which can bypass Row Level Security on the underlying tables.
-- We recreate it as a SECURITY INVOKER view (the default in modern Postgres/Supabase for security).

-- 1. Drop the offending view
DROP VIEW IF EXISTS public.cloud_archive;

-- 2. Recreate with security_invoker = true (Postgres 15+ feature)
-- or simply standard view which defaults to invoker in most contexts.
-- Supabase specifically asks for security_invoker to be explicit for the advisor to pass.
CREATE VIEW public.cloud_archive WITH (security_invoker = true) AS
 SELECT r.id,
    r.title,
    r.file_url,
    COALESCE(r.file_size, (0)::bigint) AS file_size,
    COALESCE(r.file_type, 'other'::text) AS file_type,
    r.category,
    r.uploaded_by,
    u.full_name AS uploader_name,
    r.created_at,
    'resource'::text AS origin_table
   FROM (resources r
     LEFT JOIN users u ON ((r.uploaded_by = u.id)))
UNION ALL
 SELECT m.id,
    m.title,
    m.file_url,
    COALESCE(m.file_size, (0)::bigint) AS file_size,
        CASE
            WHEN (m.material_type = 'video'::text) THEN 'media'::text
            WHEN (m.material_type = ANY (ARRAY['pdf'::text, 'doc'::text, 'docx'::text, 'ppt'::text, 'note'::text])) THEN 'document'::text
            ELSE 'other'::text
        END AS file_type,
    'materials'::text AS category,
    m.uploaded_by,
    u.full_name AS uploader_name,
    m.created_at,
    'material'::text AS origin_table
   FROM (materials m
     LEFT JOIN users u ON ((m.uploaded_by = u.id)))
  WHERE (m.file_url IS NOT NULL)
UNION ALL
 SELECT p.id,
    p.title,
    p.file_url,
    COALESCE(p.file_size, (0)::bigint) AS file_size,
    'document'::text AS file_type,
    'past_questions'::text AS category,
    p.uploaded_by,
    u.full_name AS uploader_name,
    p.created_at,
    'past_question'::text AS origin_table
   FROM (past_questions p
     LEFT JOIN users u ON ((p.uploaded_by = u.id)))
  WHERE (p.file_url IS NOT NULL)
UNION ALL
 SELECT a.id,
    a.title,
    a.cover_image_url AS file_url,
    0 AS file_size,
    'image'::text AS file_type,
    'announcements'::text AS category,
    a.author_id AS uploaded_by,
    u.full_name AS uploader_name,
    a.created_at,
    'announcement'::text AS origin_table
   FROM (announcements a
     LEFT JOIN users u ON ((a.author_id = u.id)))
  WHERE (a.cover_image_url IS NOT NULL)
UNION ALL
 SELECT e.id,
    e.title,
    e.cover_image_url AS file_url,
    0 AS file_size,
    'image'::text AS file_type,
    'events'::text AS category,
    e.created_by AS uploaded_by,
    u.full_name AS uploader_name,
    e.created_at,
    'event'::text AS origin_table
   FROM (events e
     LEFT JOIN users u ON ((e.created_by = u.id)))
  WHERE (e.cover_image_url IS NOT NULL)
UNION ALL
 SELECT lecturers.id,
    lecturers.full_name AS title,
    lecturers.avatar_url AS file_url,
    0 AS file_size,
    'image'::text AS file_type,
    'personnel'::text AS category,
    NULL::uuid AS uploaded_by,
    'Administrator'::text AS uploader_name,
    lecturers.created_at,
    'personnel'::text AS origin_table
   FROM lecturers
  WHERE (lecturers.avatar_url IS NOT NULL)
UNION ALL
 SELECT executives.id,
    COALESCE(executives.full_name, executives."position") AS title,
    executives.avatar_url AS file_url,
    0 AS file_size,
    'image'::text AS file_type,
    'personnel'::text AS category,
    NULL::uuid AS uploaded_by,
    'Administrator'::text AS uploader_name,
    executives.created_at,
    'personnel'::text AS origin_table
   FROM executives
  WHERE (executives.avatar_url IS NOT NULL);

-- 3. Hardening Functions against Search Path Mutability (CVE-2018-1058 remediation)
ALTER FUNCTION public.handle_student_group_auto_join() SET search_path = public;
ALTER FUNCTION public.fetch_admin_analytics() SET search_path = public;

-- Final Check
COMMENT ON VIEW public.cloud_archive IS 'Unified institution vault view - Security Invoker hardened.';
