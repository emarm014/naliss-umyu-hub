-- Migration: Fix Auto-Live Voting
-- Allows users to cast votes in 'scheduled' pools if the start_time has passed.

CREATE OR REPLACE FUNCTION public.cast_pool_vote(p_pool_id UUID, p_candidate_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_pool RECORD;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT * INTO v_pool FROM public.event_pools WHERE id = p_pool_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    -- Allow voting if status is live OR if status is scheduled and start_time has passed
    IF v_pool.status NOT IN ('live', 'scheduled') THEN
        RAISE EXCEPTION 'Voting is only allowed while the event is live.';
    END IF;

    IF v_pool.status = 'scheduled' AND (v_pool.start_time IS NULL OR NOW() < v_pool.start_time) THEN
        RAISE EXCEPTION 'Voting has not started yet.';
    END IF;
    
    IF v_pool.end_time IS NOT NULL AND NOW() > (v_pool.end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Voting has concluded.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.pool_candidates WHERE id = p_candidate_id AND pool_id = p_pool_id) THEN
        RAISE EXCEPTION 'Candidate not found in this election';
    END IF;

    -- 3. Insert vote (atomic unique constraint check)
    BEGIN
        INSERT INTO public.pool_votes (pool_id, voter_user_id, candidate_id)
        VALUES (p_pool_id, auth.uid(), p_candidate_id);
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'You have already voted in this event';
    END;

    -- 4. Increment candidate vote count atomically
    UPDATE public.pool_candidates
    SET vote_count = vote_count + 1
    WHERE id = p_candidate_id;

    -- 5. Mark participant record as completed
    INSERT INTO public.pool_participants (pool_id, user_id, completed_at)
    VALUES (p_pool_id, auth.uid(), NOW())
    ON CONFLICT (pool_id, user_id)
    DO UPDATE SET completed_at = NOW();

    RETURN jsonb_build_object('success', true, 'voted_at', NOW());
END;
$$;
