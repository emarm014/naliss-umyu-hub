-- Migration: 20261110160000_enable_realtime_publication_tables.sql
-- Description: Adds missing application tables to the supabase_realtime publication
-- so single-channel multiplexed clients (realtimeManager) receive instant postgres_changes
-- events without requiring manual pull-to-refresh.

DO $$
DECLARE
    t TEXT;
    tables_to_enable TEXT[] := ARRAY[
        'announcements',
        'events',
        'event_pools',
        'pool_participants',
        'pool_votes',
        'materials',
        'past_questions',
        'courses',
        'lecturers',
        'executives',
        'graduates',
        'groups',
        'group_members',
        'messages',
        'featured_students',
        'student_congratulations',
        'news',
        'archives',
        'notification_history',
        'moderator_permissions',
        'system_settings',
        'users'
    ];
BEGIN
    FOREACH t IN ARRAY tables_to_enable LOOP
        IF EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = t
        ) AND NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END;
$$;
