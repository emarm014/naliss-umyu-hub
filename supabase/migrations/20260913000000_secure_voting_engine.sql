-- Migration: Secure Voting Engine — Atomic Cast & Sealed Results
-- Phase 3 of Event Engine Stabilization

-- =====================================================================
-- 1. cast_pool_vote: Atomic ballot cast with anti-tamper protections
-- =====================================================================
CREATE OR REPLACE FUNCTION public.cast_pool_vote(p_pool_id UUID, p_option_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_pool_status TEXT;
    v_pool_start_time TIMESTAMPTZ;
    v_pool_end_time TIMESTAMPTZ;
    v_existing_submission UUID;
    v_existing_participant UUID;
BEGIN
    -- 1. Ensure the voter is authenticated
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 2. Fetch pool status and time boundaries
    SELECT status, start_time, end_time
    INTO v_pool_status, v_pool_start_time, v_pool_end_time
    FROM public.event_pools
    WHERE id = p_pool_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    -- 3. Verify pool is live
    IF v_pool_status != 'live' THEN
        RAISE EXCEPTION 'Voting is closed';
    END IF;

    -- 4. Verify current time is within the voting window (30s grace for latency)
    IF v_pool_start_time IS NOT NULL AND NOW() < v_pool_start_time THEN
        RAISE EXCEPTION 'Voting is closed';
    END IF;

    IF v_pool_end_time IS NOT NULL AND NOW() > (v_pool_end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Voting is closed';
    END IF;

    -- 5. Check if user already voted via pool_submissions
    SELECT id INTO v_existing_submission
    FROM public.pool_submissions
    WHERE pool_id = p_pool_id AND user_id = v_user_id;

    IF FOUND THEN
        RAISE EXCEPTION 'You have already voted in this election';
    END IF;

    -- 6. Check if user already has a completed participant record
    SELECT id INTO v_existing_participant
    FROM public.pool_participants
    WHERE pool_id = p_pool_id AND user_id = v_user_id AND completed_at IS NOT NULL;

    IF FOUND THEN
        RAISE EXCEPTION 'You have already voted in this election';
    END IF;

    -- 7. Insert the ballot into pool_submissions (atomic, UNIQUE constraint prevents duplicates)
    INSERT INTO public.pool_submissions (pool_id, user_id, answers, score)
    VALUES (
        p_pool_id,
        v_user_id,
        jsonb_build_object('selected_option', p_option_id),
        NULL
    );

    -- 8. Insert or update pool_participants to mark completion
    INSERT INTO public.pool_participants (pool_id, user_id, final_score, completed_at)
    VALUES (p_pool_id, v_user_id, 0, NOW())
    ON CONFLICT (pool_id, user_id) DO UPDATE
    SET completed_at = EXCLUDED.completed_at;

    -- 9. Return success receipt
    RETURN jsonb_build_object('success', true, 'voted_at', NOW());
END;
$$;

GRANT EXECUTE ON FUNCTION public.cast_pool_vote(UUID, TEXT) TO authenticated;


-- =====================================================================
-- 2. get_voting_results: Sealed ballot privacy during live voting
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_voting_results(p_pool_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pool_status TEXT;
    v_pool_end_time TIMESTAMPTZ;
    v_total_votes BIGINT;
    v_tallies JSONB;
BEGIN
    -- 1. Fetch pool record
    SELECT status, end_time
    INTO v_pool_status, v_pool_end_time
    FROM public.event_pools
    WHERE id = p_pool_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    -- 2. Count total votes
    SELECT COUNT(*) INTO v_total_votes
    FROM public.pool_submissions
    WHERE pool_id = p_pool_id;

    -- 3. If voting is still active, return sealed (turnout only, no per-option breakdown)
    IF v_pool_status != 'completed' AND (v_pool_end_time IS NULL OR NOW() < v_pool_end_time) THEN
        RETURN jsonb_build_object(
            'is_sealed', true,
            'total_votes', v_total_votes
        );
    END IF;

    -- 4. Voting is over — aggregate and return full unsealed tallies
    SELECT jsonb_object_agg(sub.opt, sub.cnt)
    INTO v_tallies
    FROM (
        SELECT answers->>'selected_option' AS opt, COUNT(*) AS cnt
        FROM public.pool_submissions
        WHERE pool_id = p_pool_id
        GROUP BY opt
    ) sub;

    RETURN jsonb_build_object(
        'is_sealed', false,
        'total_votes', v_total_votes,
        'tallies', COALESCE(v_tallies, '{}'::jsonb)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_voting_results(UUID) TO authenticated;
