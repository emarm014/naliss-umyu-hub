-- Migration: Fix notification_history permissions, user_announcement_reads grants, and RPC function column names

-- 1. Fix notification_history permissions and RLS
GRANT ALL ON TABLE public.notification_history TO authenticated, anon, service_role;
ALTER TABLE public.notification_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own notification_history" ON public.notification_history;
CREATE POLICY "Users manage own notification_history" ON public.notification_history
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 2. Fix user_announcement_reads permissions and RLS
GRANT ALL ON TABLE public.user_announcement_reads TO authenticated, anon, service_role;
ALTER TABLE public.user_announcement_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Student Select Announcement Reads" ON public.user_announcement_reads;
CREATE POLICY "Student Select Announcement Reads" ON public.user_announcement_reads
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Student Insert Announcement Reads" ON public.user_announcement_reads;
CREATE POLICY "Student Insert Announcement Reads" ON public.user_announcement_reads
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- 3. Fix update_last_seen function (column is last_active_at)
CREATE OR REPLACE FUNCTION public.update_last_seen()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_alert JSONB := NULL;
    v_recent_pool RECORD;
    v_edited_messages JSONB := '[]'::jsonb;
BEGIN
    UPDATE public.users 
    SET last_active_at = NOW() 
    WHERE id = auth.uid();

    SELECT id, title INTO v_recent_pool
    FROM public.event_pools
    WHERE status = 'live' 
      AND updated_at >= (NOW() - INTERVAL '3 minutes')
    ORDER BY updated_at DESC
    LIMIT 1;

    IF FOUND THEN
        v_alert := jsonb_build_object(
            'pool_id', v_recent_pool.id,
            'title', 'Event Pool is Live!',
            'body', 'The event "' || v_recent_pool.title || '" has just started. Join now.',
            'type', 'status_change'
        );
    END IF;

    IF v_alert IS NULL THEN
        SELECT id, title INTO v_recent_pool
        FROM public.event_pools
        WHERE status = 'completed'
          AND result_published_at >= (NOW() - INTERVAL '3 minutes')
        ORDER BY result_published_at DESC
        LIMIT 1;

        IF FOUND THEN
            v_alert := jsonb_build_object(
                'pool_id', v_recent_pool.id,
                'title', 'Results Published!',
                'body', 'The winners for "' || v_recent_pool.title || '" have been announced.',
                'type', 'winner_published'
            );
        END IF;
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', m.id,
            'group_id', m.group_id,
            'content', m.content,
            'edited_at', m.edited_at
        )
    ), '[]'::jsonb) INTO v_edited_messages
    FROM public.messages m
    JOIN public.group_members gm ON m.group_id = gm.group_id
    WHERE gm.user_id = auth.uid()
      AND m.edited_at >= (NOW() - INTERVAL '1 minute');

    RETURN jsonb_build_object(
        'active_alert', v_alert,
        'edited_messages', v_edited_messages
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_last_seen() TO authenticated, anon, service_role;

-- 4. Fix mark_all_announcements_as_read function (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.mark_all_announcements_as_read(u_level text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.user_announcement_reads (user_id, announcement_id)
  SELECT auth.uid(), a.id
  FROM public.announcements a
  WHERE a.is_published = true
  AND (u_level IS NULL OR a.target_level IS NULL OR a.target_level = u_level)
  ON CONFLICT (user_id, announcement_id) DO NOTHING;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mark_all_announcements_as_read(text) TO authenticated, anon, service_role;
