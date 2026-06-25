-- Database Migration: user_push_tokens and active alerts

-- 1. Create Push Tokens Table
CREATE TABLE public.user_push_tokens (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    push_token TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Row Level Security for user_push_tokens
ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own push token"
    ON public.user_push_tokens FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own push token"
    ON public.user_push_tokens FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read their own push token"
    ON public.user_push_tokens FOR SELECT
    USING (auth.uid() = user_id);

-- 3. Replace update_last_seen RPC to return the active alert payload
CREATE OR REPLACE FUNCTION public.update_last_seen()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_alert JSONB := NULL;
    v_recent_pool RECORD;
BEGIN
    -- Update last seen for the authenticated user
    UPDATE public.users 
    SET last_seen = NOW() 
    WHERE id = auth.uid();

    -- Check for any event pools that went LIVE in the last 3 minutes
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

    -- Check for winner published
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

    RETURN jsonb_build_object('active_alert', v_alert);
END;
$$;
