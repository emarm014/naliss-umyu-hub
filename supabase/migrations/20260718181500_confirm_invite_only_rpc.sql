-- Create RPC to confirm invite-only participants, bypassing RLS to avoid permission issues
CREATE OR REPLACE FUNCTION public.confirm_invite_only_participants(p_pool_id UUID, p_user_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_target_constraints JSONB;
    v_selected_users JSONB;
BEGIN
    -- Upsert applications as approved
    FOREACH v_user_id IN ARRAY p_user_ids
    LOOP
        INSERT INTO public.pool_applications (pool_id, user_id, status)
        VALUES (p_pool_id, v_user_id, 'approved')
        ON CONFLICT (pool_id, user_id) 
        DO UPDATE SET status = 'approved', updated_at = NOW();
    END LOOP;

    -- Lock the event pool to prevent concurrent modifications
    SELECT COALESCE(target_constraints, '{}'::jsonb) INTO v_target_constraints
    FROM public.event_pools
    WHERE id = p_pool_id
    FOR UPDATE;

    IF v_target_constraints ? 'selected_users' THEN
        v_selected_users := v_target_constraints -> 'selected_users';
    ELSE
        v_selected_users := '[]'::jsonb;
    END IF;

    -- Add the user_ids to the JSON array if not present
    FOREACH v_user_id IN ARRAY p_user_ids
    LOOP
        IF NOT (v_selected_users @> to_jsonb(v_user_id::text)) THEN
            v_selected_users := v_selected_users || to_jsonb(v_user_id::text);
        END IF;
    END LOOP;

    -- Update the target constraints
    v_target_constraints := jsonb_set(v_target_constraints, '{selected_users}', v_selected_users);

    UPDATE public.event_pools
    SET target_constraints = v_target_constraints
    WHERE id = p_pool_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- Grant access
GRANT EXECUTE ON FUNCTION public.confirm_invite_only_participants(UUID, UUID[]) TO authenticated;
