-- Migration: Fix Auto-Live Multi-Post Voting
-- Allows users to cast multi-post ballots in 'scheduled' pools if the start_time has passed,
-- matching the behavior of single-post voting in '20260919000000_fix_auto_live_voting.sql'.

CREATE OR REPLACE FUNCTION public.cast_multi_post_ballot(p_pool_id UUID, p_selections JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pool RECORD;
    v_selection JSONB;
    v_cand_id UUID;
    v_pos_title TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Fetch event pool details
    SELECT * INTO v_pool FROM public.event_pools WHERE id = p_pool_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    -- Allow voting if status is live OR if status is scheduled and start_time has passed
    IF v_pool.status NOT IN ('live', 'scheduled') THEN
        RAISE EXCEPTION 'Voting is closed or not live';
    END IF;

    IF v_pool.status = 'scheduled' AND (v_pool.start_time IS NULL OR NOW() < v_pool.start_time) THEN
        RAISE EXCEPTION 'Voting has not started yet.';
    END IF;

    IF v_pool.end_time IS NOT NULL AND NOW() > (v_pool.end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Voting has concluded.';
    END IF;

    IF jsonb_array_length(p_selections) = 0 THEN
        RAISE EXCEPTION 'Ballot cannot be empty';
    END IF;

    -- Loop through p_selections
    FOR v_selection IN SELECT * FROM jsonb_array_elements(p_selections)
    LOOP
        v_cand_id := (v_selection->>'candidate_id')::UUID;
        v_pos_title := v_selection->>'position_title';

        -- Verify candidate_id belongs to p_pool_id and matches position_title
        IF NOT EXISTS (
            SELECT 1 FROM public.pool_candidates 
            WHERE id = v_cand_id AND pool_id = p_pool_id AND position_title = v_pos_title
        ) THEN
            RAISE EXCEPTION 'Invalid candidate % for position %', v_cand_id, v_pos_title;
        END IF;

        -- Insert into public.pool_votes
        BEGIN
            INSERT INTO public.pool_votes (pool_id, voter_user_id, candidate_id, position_title)
            VALUES (p_pool_id, auth.uid(), v_cand_id, v_pos_title);
        EXCEPTION WHEN unique_violation THEN
            RAISE EXCEPTION 'You have already voted for the position %', v_pos_title;
        END;

        -- Increment vote_count
        UPDATE public.pool_candidates 
        SET vote_count = vote_count + 1 
        WHERE id = v_cand_id;
    END LOOP;

    -- Mark participant completed
    INSERT INTO public.pool_participants (pool_id, user_id, completed_at)
    VALUES (p_pool_id, auth.uid(), NOW())
    ON CONFLICT (pool_id, user_id) DO UPDATE SET completed_at = NOW();

    RETURN jsonb_build_object('success', true, 'ballot_count', jsonb_array_length(p_selections), 'voted_at', NOW());
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cast_multi_post_ballot(uuid, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cast_multi_post_ballot(uuid, jsonb) TO authenticated;
