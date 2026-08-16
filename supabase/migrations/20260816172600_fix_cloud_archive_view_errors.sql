-- Fix the cloud_archive view
-- 1. `user_notes.id` is TEXT, cast to UUID fails. Use md5 to generate a stable UUID.
-- 2. `user_notes.media_paths` might be a scalar string because of JSON.stringify double-encoding. Use a CASE statement to safely unnest.

DROP VIEW IF EXISTS public.cloud_archive;

CREATE VIEW public.cloud_archive WITH (security_invoker = true) AS

-- ── Resources (Vault uploads) ──────────────────────────────────────────────
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

-- ── Materials ──────────────────────────────────────────────────────────────
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

-- ── Past Questions ─────────────────────────────────────────────────────────
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

-- ── Announcements (cover images) ───────────────────────────────────────────
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

-- ── Events (cover images) ──────────────────────────────────────────────────
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

-- ── Lecturers (avatar photos) ──────────────────────────────────────────────
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

-- ── Executives (avatar photos) ─────────────────────────────────────────────
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
  WHERE (executives.avatar_url IS NOT NULL)

UNION ALL

-- ── User Avatars (profile photos uploaded to Cloudinary) ────────────────────
 SELECT u.id,
    u.full_name AS title,
    u.avatar_url AS file_url,
    0 AS file_size,
    'image'::text AS file_type,
    'user_avatars'::text AS category,
    u.id AS uploaded_by,
    u.full_name AS uploader_name,
    u.created_at,
    'user_avatar'::text AS origin_table
   FROM users u
  WHERE (u.avatar_url IS NOT NULL
    AND u.avatar_url LIKE '%cloudinary%')

UNION ALL

-- ── Group Chat Media (images, videos, documents, audio in messages) ─────────
 SELECT msg.id,
    COALESCE(g.name, 'Chat Media') AS title,
    msg.content AS file_url,
    COALESCE((msg.metadata->>'size')::bigint, 0) AS file_size,
    CASE
        WHEN msg.message_type = 'image' THEN 'image'::text
        WHEN msg.message_type = 'video' THEN 'video'::text
        WHEN msg.message_type IN ('document', 'audio') THEN 'document'::text
        ELSE 'other'::text
    END AS file_type,
    'group_chat'::text AS category,
    msg.sender_id AS uploaded_by,
    u.full_name AS uploader_name,
    msg.created_at,
    'group_chat'::text AS origin_table
   FROM messages msg
     LEFT JOIN users u ON (msg.sender_id = u.id)
     LEFT JOIN groups g ON (msg.group_id = g.id)
  WHERE (msg.message_type IN ('image', 'video', 'document', 'audio')
    AND msg.content IS NOT NULL
    AND msg.content LIKE '%cloudinary%'
    AND (msg.is_deleted IS NULL OR msg.is_deleted = false))

UNION ALL

-- ── Gallery Topics (cover images) ──────────────────────────────────────────
 SELECT gt.id,
    gt.title,
    gt.cover_image AS file_url,
    0 AS file_size,
    'image'::text AS file_type,
    'gallery'::text AS category,
    NULL::uuid AS uploaded_by,
    'Administrator'::text AS uploader_name,
    gt.created_at,
    'gallery_topic'::text AS origin_table
   FROM gallery_topics gt
  WHERE (gt.cover_image IS NOT NULL)

UNION ALL

-- ── Gallery Media (photos & videos in gallery topics) ───────────────────────
 SELECT gm.id,
    gt.title AS title,
    gm.media_url AS file_url,
    0 AS file_size,
    gm.media_type AS file_type,
    'gallery'::text AS category,
    NULL::uuid AS uploaded_by,
    'Administrator'::text AS uploader_name,
    gm.created_at,
    'gallery_media'::text AS origin_table
   FROM gallery_media gm
     LEFT JOIN gallery_topics gt ON (gm.topic_id = gt.id)
  WHERE (gm.media_url IS NOT NULL)

UNION ALL

-- ── Featured Students (custom flyers/photos) ────────────────────────────────
 SELECT fs.id,
    fs.title,
    fs.custom_image_url AS file_url,
    0 AS file_size,
    'image'::text AS file_type,
    'featured_students'::text AS category,
    fs.created_by AS uploaded_by,
    u.full_name AS uploader_name,
    fs.created_at,
    'featured_student'::text AS origin_table
   FROM featured_students fs
     LEFT JOIN users u ON (fs.created_by = u.id)
  WHERE (fs.custom_image_url IS NOT NULL)

UNION ALL

-- ── News (article images) ──────────────────────────────────────────────────
 SELECT n.id,
    n.title,
    n.image_url AS file_url,
    0 AS file_size,
    'image'::text AS file_type,
    'news'::text AS category,
    NULL::uuid AS uploaded_by,
    'Administrator'::text AS uploader_name,
    n.created_at,
    'news'::text AS origin_table
   FROM news n
  WHERE (n.image_url IS NOT NULL)

UNION ALL

-- ── Archives (archived documents & media) ───────────────────────────────────
 SELECT ar.id,
    ar.title,
    ar.file_url,
    0 AS file_size,
    COALESCE(ar.file_type, 'other'::text) AS file_type,
    'archives'::text AS category,
    NULL::uuid AS uploaded_by,
    'Administrator'::text AS uploader_name,
    ar.created_at,
    'archive'::text AS origin_table
   FROM archives ar
  WHERE (ar.file_url IS NOT NULL)

UNION ALL

-- ── Personnel Gallery Photos (lecturer & executive galleries) ───────────────
 SELECT ph.id,
    COALESCE(ph.entity_type || ' Gallery Photo', 'Gallery Photo') AS title,
    ph.url AS file_url,
    0 AS file_size,
    'image'::text AS file_type,
    'personnel_gallery'::text AS category,
    NULL::uuid AS uploaded_by,
    'Administrator'::text AS uploader_name,
    ph.created_at,
    'personnel_gallery'::text AS origin_table
   FROM photos ph
  WHERE (ph.url IS NOT NULL)

UNION ALL

-- ── Group Avatars (group profile pictures) ──────────────────────────────────
 SELECT g.id,
    g.name AS title,
    g.avatar_url AS file_url,
    0 AS file_size,
    'image'::text AS file_type,
    'group_avatars'::text AS category,
    NULL::uuid AS uploaded_by,
    'Administrator'::text AS uploader_name,
    g.created_at,
    'group_avatar'::text AS origin_table
   FROM groups g
  WHERE (g.avatar_url IS NOT NULL
    AND g.avatar_url LIKE '%cloudinary%')

UNION ALL

-- ── User Notes / Notepad (media attachments stored as JSONB array) ──────────
 SELECT md5(un.id || media_url.url)::uuid AS id,
    COALESCE(un.subject, 'Notepad Attachment') AS title,
    media_url.url AS file_url,
    0 AS file_size,
    'image'::text AS file_type,
    'notepad'::text AS category,
    un.user_id AS uploaded_by,
    u.full_name AS uploader_name,
    un.created_at,
    'notepad'::text AS origin_table
   FROM user_notes un
     CROSS JOIN LATERAL jsonb_array_elements_text(
       CASE 
         WHEN jsonb_typeof(un.media_paths) = 'array' THEN un.media_paths 
         WHEN jsonb_typeof(un.media_paths) = 'string' AND un.media_paths::text LIKE '"[%]"' THEN (un.media_paths#>>'{}')::jsonb 
         ELSE '[]'::jsonb 
       END
     ) AS media_url(url)
     LEFT JOIN users u ON (un.user_id = u.id)
  WHERE (media_url.url IS NOT NULL
    AND media_url.url LIKE '%cloudinary%');
