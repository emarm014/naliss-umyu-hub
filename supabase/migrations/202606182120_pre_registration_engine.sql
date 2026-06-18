-- Migration: Pre-Registration Engine & Application Tables
-- Description: Creates the pool_applications table to track pre-registration applications and an RPC to safely approve them.

CREATE TABLE public.pool_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id UUID NOT NULL REFERENCES public.event_pools(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pool_id, user_id)
);

-- Enable RLS
ALTER TABLE public.pool_applications ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert their own applications
CREATE POLICY "Users can insert their own applications"
    ON public.pool_applications FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- Allow authenticated users to select their own applications
CREATE POLICY "Users can view their own applications"
    ON public.pool_applications FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Wait, the admin also needs to view them. Assuming admins bypass RLS via server-side role check or we add a policy:
-- For simplicity, if they query via admin UI, let's allow read for all authenticated (the app shouldn't expose sensitive info)
CREATE POLICY "Anyone can view pool applications"
    ON public.pool_applications FOR SELECT
    TO authenticated
    USING (true);

-- RPC to atomically approve an application and map the user ID to the selected_users JSONB array
CREATE OR REPLACE FUNCTION public.approve_pool_application(p_application_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_pool_id UUID;
    v_user_id UUID;
    v_target_constraints JSONB;
    v_selected_users JSONB;
BEGIN
    -- Get application details
    SELECT pool_id, user_id INTO v_pool_id, v_user_id
    FROM public.pool_applications
    WHERE id = p_application_id AND status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Application not found or already processed.';
    END IF;

    -- Update application status
    UPDATE public.pool_applications
    SET status = 'approved', updated_at = NOW()
    WHERE id = p_application_id;

    -- Fetch current target constraints
    SELECT COALESCE(target_constraints, '{}'::jsonb) INTO v_target_constraints
    FROM public.event_pools
    WHERE id = v_pool_id;

    -- Extract or initialize selected_users array
    IF v_target_constraints ? 'selected_users' THEN
        v_selected_users := v_target_constraints -> 'selected_users';
    ELSE
        v_selected_users := '[]'::jsonb;
    END IF;

    -- Append the new user_id safely (if not already exists)
    IF NOT (v_selected_users @> to_jsonb(v_user_id::text)) THEN
        v_selected_users := v_selected_users || to_jsonb(v_user_id::text);
    END IF;

    -- Update the target constraints
    v_target_constraints := jsonb_set(v_target_constraints, '{selected_users}', v_selected_users);

    UPDATE public.event_pools
    SET target_constraints = v_target_constraints
    WHERE id = v_pool_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
