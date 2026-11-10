-- ============================================================================
-- Migration: 20261110170000_rich_notification_previews_and_badges.sql
-- Purpose:
--   1. Enhance enqueue_chat_message_notification() so chat notifications show
--      clean text previews (caption or media label instead of raw Cloudinary URLs)
--      AND include image_url in notification data for rich Android/iOS image
--      previews when an image or video is sent.
--   2. Enhance get_unread_notification_counts(UUID[]) to count both unread
--      in-app notifications (notification_history) AND unread group chat
--      messages (messages created after group_members.last_read_at) so the
--      OS app-icon badge count sent in push notifications is always accurate.
-- ============================================================================

-- 1. Rich text & image previews for chat message notifications
CREATE OR REPLACE FUNCTION public.enqueue_chat_message_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_group_name TEXT;
    v_sender_name TEXT;
    v_target_user_ids UUID[];
    v_preview TEXT;
    v_caption TEXT;
    v_doc_name TEXT;
    v_image_url TEXT;
    v_data JSONB;
    v_total INT;
    v_offset INT;
BEGIN
    IF NEW.is_deleted IS TRUE OR NEW.sender_id IS NULL OR NEW.message_type = 'system' THEN
        RETURN NEW;
    END IF;

    SELECT name INTO v_group_name FROM public.groups WHERE id = NEW.group_id;
    v_group_name := COALESCE(NULLIF(v_group_name, ''), 'Group Chat');

    SELECT COALESCE(NULLIF(username, ''), NULLIF(full_name, ''), 'Someone') INTO v_sender_name
    FROM public.users
    WHERE id = NEW.sender_id;
    v_sender_name := COALESCE(v_sender_name, 'Someone');

    SELECT ARRAY_AGG(user_id) INTO v_target_user_ids
    FROM public.group_members
    WHERE group_id = NEW.group_id
      AND user_id <> NEW.sender_id;

    v_total := COALESCE(array_length(v_target_user_ids, 1), 0);
    IF v_total = 0 THEN
        RETURN NEW;
    END IF;

    v_caption := NULLIF(BTRIM(COALESCE(NEW.metadata->>'caption', '')), '');
    v_doc_name := NULLIF(BTRIM(COALESCE(NEW.metadata->>'name', '')), '');
    v_image_url := NULL;

    IF NEW.message_type = 'image' THEN
        v_preview := '📷 ' || COALESCE(v_caption, 'Photo');
        IF NEW.content IS NOT NULL AND NEW.content ~ '^https?://' THEN
            v_image_url := NEW.content;
        END IF;
    ELSIF NEW.message_type = 'video' THEN
        v_preview := '📹 ' || COALESCE(v_caption, 'Video');
        IF NEW.content IS NOT NULL AND NEW.content ~ '^https?://res\.cloudinary\.com/.+/video/upload/' THEN
            v_image_url := regexp_replace(
                replace(NEW.content, '/video/upload/', '/video/upload/so_0,w_600,h_400,c_fill,f_jpg/'),
                '\.(mp4|mov|avi|webm|mkv|m4v)$',
                '.jpg',
                'i'
            );
        END IF;
    ELSIF NEW.message_type = 'audio' THEN
        v_preview := '🎙️ Voice message';
    ELSIF NEW.message_type IN ('document', 'file') THEN
        v_preview := '📄 ' || COALESCE(v_caption, v_doc_name, 'Document');
    ELSIF NEW.message_type = 'sticker' THEN
        v_preview := '😊 ' || COALESCE(NULLIF(BTRIM(NEW.content), ''), 'Sticker');
    ELSE
        v_preview := COALESCE(NULLIF(BTRIM(NEW.content), ''), 'Sent a message');
    END IF;

    IF LENGTH(v_preview) > 100 THEN
        v_preview := SUBSTRING(v_preview FROM 1 FOR 100) || '…';
    END IF;

    v_data := jsonb_build_object(
        'type', 'message',
        'group_id', NEW.group_id::text,
        'id', NEW.id::text
    );

    IF v_image_url IS NOT NULL THEN
        v_data := v_data || jsonb_build_object('image_url', v_image_url);
    END IF;

    v_offset := 1;
    WHILE v_offset <= v_total LOOP
        INSERT INTO public.notification_jobs (notification_id, target_user_ids, title, body, data, status, next_retry_at)
        VALUES (
            NEW.id::text,
            v_target_user_ids[v_offset : LEAST(v_offset + 999, v_total)],
            v_group_name,
            v_sender_name || ': ' || v_preview,
            v_data,
            'pending',
            NOW()
        );
        v_offset := v_offset + 1000;
    END LOOP;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[enqueue_chat_message_notification] Error: %', SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_chat_message_notification() FROM PUBLIC, anon, authenticated;

-- 2. Unified unread badge count (unread notification_history + unread group chat messages)
CREATE OR REPLACE FUNCTION public.get_unread_notification_counts(p_user_ids UUID[])
RETURNS TABLE (user_id UUID, unread_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH target_users AS (
        SELECT UNNEST(p_user_ids) AS uid
    ),
    notif_counts AS (
        SELECT h.user_id AS uid, COUNT(*)::BIGINT AS cnt
        FROM public.notification_history h
        WHERE h.user_id = ANY (p_user_ids)
          AND h.is_read = false
          AND h.type NOT IN ('message', 'chat')
        GROUP BY h.user_id
    ),
    chat_counts AS (
        SELECT gm.user_id AS uid, COUNT(m.id)::BIGINT AS cnt
        FROM public.group_members gm
        JOIN public.messages m
          ON m.group_id = gm.group_id
         AND m.is_deleted = false
         AND m.sender_id IS DISTINCT FROM gm.user_id
         AND m.created_at > COALESCE(gm.last_read_at, '1970-01-01'::timestamptz)
        WHERE gm.user_id = ANY (p_user_ids)
        GROUP BY gm.user_id
    )
    SELECT
        tu.uid AS user_id,
        (COALESCE(nc.cnt, 0) + COALESCE(cc.cnt, 0))::BIGINT AS unread_count
    FROM target_users tu
    LEFT JOIN notif_counts nc ON nc.uid = tu.uid
    LEFT JOIN chat_counts cc ON cc.uid = tu.uid;
$$;

REVOKE ALL ON FUNCTION public.get_unread_notification_counts(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_counts(UUID[]) TO service_role;
