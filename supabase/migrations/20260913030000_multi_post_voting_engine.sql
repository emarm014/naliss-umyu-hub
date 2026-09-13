-- Migration: Multi-Post Voting Engine

-- 1) Update 'pool_candidates'
ALTER TABLE public.pool_candidates ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
ALTER TABLE public.pool_candidates ALTER COLUMN position_title SET NOT NULL;
ALTER TABLE public.pool_candidates ALTER COLUMN position_title SET DEFAULT 'General';

-- 2) Update 'pool_votes' constraint
ALTER TABLE public.pool_votes ADD COLUMN IF NOT EXISTS position_title TEXT NOT NULL DEFAULT 'General';
ALTER TABLE public.pool_votes DROP CONSTRAINT IF EXISTS uq_voter_per_pool;
ALTER TABLE public.pool_votes ADD CONSTRAINT uq_voter_per_pool_post UNIQUE (pool_id, voter_user_id, position_title);

-- 3) Create RPC 'cast_multi_post_ballot'
CREATE OR REPLACE FUNCTION public.cast_multi_post_ballot(p_pool_id UUID, p_selections JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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

    -- Verify pool status = 'live' AND NOW() BETWEEN start_time AND (end_time + INTERVAL '30 seconds')
    SELECT * INTO v_pool FROM public.event_pools WHERE id = p_pool_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    IF v_pool.status != 'live' OR NOW() < v_pool.start_time OR NOW() > (v_pool.end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Voting is closed or not live';
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

-- 4) Update 'get_voting_candidates' RPC
CREATE OR REPLACE FUNCTION public.get_voting_candidates(p_pool_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_pool RECORD;
    v_is_public BOOLEAN;
    v_result JSONB;
BEGIN
    SELECT * INTO v_pool FROM public.event_pools WHERE id = p_pool_id;
    
    v_is_public := (v_pool.status = 'completed') OR 
                   (NOW() >= v_pool.end_time) OR 
                   COALESCE((v_pool.target_constraints->>'allow_live_tally')::boolean, false);

    SELECT jsonb_agg(
        jsonb_build_object(
            'id', c.id,
            'display_name', c.display_name,
            'position_title', c.position_title,
            'bio', c.bio,
            'photo_url', c.photo_url,
            'vote_count', CASE WHEN v_is_public THEN c.vote_count ELSE NULL END,
            'is_winner', c.is_winner,
            'podium_rank', c.podium_rank
        ) ORDER BY c.sort_order ASC, c.position_title ASC, CASE WHEN v_is_public THEN c.vote_count ELSE 0 END DESC, c.created_at ASC
    ) INTO v_result
    FROM public.pool_candidates c
    WHERE c.pool_id = p_pool_id;

    RETURN jsonb_build_object(
        'is_sealed', NOT v_is_public,
        'candidates', COALESCE(v_result, '[]'::jsonb),
        'total_votes', (SELECT COUNT(*) FROM public.pool_votes WHERE pool_id = p_pool_id)
    );
END;
$$;

-- 5) Update 'certify_voting_winners' RPC
CREATE OR REPLACE FUNCTION public.certify_voting_winners(p_pool_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    pos RECORD;
BEGIN
    -- Loop through each distinct position in the election
    FOR pos IN 
        SELECT DISTINCT position_title FROM public.pool_candidates WHERE pool_id = p_pool_id
    LOOP
        -- Update the candidate with the most votes in this category
        UPDATE public.pool_candidates
        SET is_winner = true, podium_rank = '1st'
        WHERE id = (
            SELECT id FROM public.pool_candidates
            WHERE pool_id = p_pool_id AND position_title = pos.position_title
            ORDER BY vote_count DESC, created_at ASC
            LIMIT 1
        );
    END LOOP;

    UPDATE public.event_pools
    SET status = 'completed'
    WHERE id = p_pool_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
