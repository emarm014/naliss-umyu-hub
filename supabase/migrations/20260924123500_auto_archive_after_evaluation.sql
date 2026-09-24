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

    -- Update the pool status to archived instead of completed so it is ready for public exploration
    UPDATE public.event_pools
    SET status = 'archived'
    WHERE id = p_pool_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
