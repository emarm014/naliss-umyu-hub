-- Migration: Dedicated Voting Tables (pool_candidates and pool_votes)
-- Separating Candidates from Voter Ballots to resolve architectural flaws.

-- =====================================================================
-- 1. CREATE 'pool_candidates' TABLE
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.pool_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id UUID NOT NULL REFERENCES public.event_pools(id) ON DELETE CASCADE,
    candidate_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    display_name TEXT NOT NULL,
    position_title TEXT DEFAULT 'General',
    bio TEXT,
    photo_url TEXT,
    vote_count INTEGER NOT NULL DEFAULT 0,
    judge_score NUMERIC(5,2) DEFAULT 0.00,
    final_score NUMERIC(5,2) DEFAULT 0.00,
    podium_rank TEXT, -- '1st', '2nd', '3rd'
    is_winner BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pool_candidates_pool ON public.pool_candidates(pool_id);

-- =====================================================================
-- 2. CREATE 'pool_votes' TABLE (DEDICATED BALLOT BOX)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.pool_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id UUID NOT NULL REFERENCES public.event_pools(id) ON DELETE CASCADE,
    voter_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES public.pool_candidates(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_voter_per_pool UNIQUE (pool_id, voter_user_id)
);

CREATE INDEX idx_pool_votes_pool ON public.pool_votes(pool_id);
CREATE INDEX idx_pool_votes_candidate ON public.pool_votes(candidate_id);

-- Enable RLS: Block direct reads from voters to prevent ballot leaking
ALTER TABLE public.pool_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert their own vote" ON public.pool_votes
    FOR INSERT WITH CHECK (auth.uid() = voter_user_id);
CREATE POLICY "Admins can view audit counts" ON public.pool_votes
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    ));

-- =====================================================================
-- 3. ATOMIC CAST VOTE RPC ('cast_pool_vote')
-- =====================================================================
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

    -- 1. Check pool status and time boundaries
    SELECT * INTO v_pool FROM public.event_pools WHERE id = p_pool_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    IF v_pool.status != 'live' OR NOW() < v_pool.start_time OR NOW() > (v_pool.end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Voting is closed or not live';
    END IF;

    -- 2. Verify candidate belongs to pool
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

-- =====================================================================
-- 4. RESULTS & CERTIFICATION RPCS
-- =====================================================================
-- Function to retrieve public or sealed candidates
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
    
    -- Public if pool completed OR target_constraints->'allow_live_tally' is true
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
        ) ORDER BY CASE WHEN v_is_public THEN c.vote_count ELSE 0 END DESC
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

-- Function for Admin to certify winners
CREATE OR REPLACE FUNCTION public.certify_voting_winners(p_pool_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Top candidate gets 1st
    UPDATE public.pool_candidates
    SET is_winner = true, podium_rank = '1st'
    WHERE id = (
        SELECT id FROM public.pool_candidates
        WHERE pool_id = p_pool_id
        ORDER BY vote_count DESC, created_at ASC
        LIMIT 1
    );

    UPDATE public.event_pools
    SET status = 'completed'
    WHERE id = p_pool_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
