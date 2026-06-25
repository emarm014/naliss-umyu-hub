-- ==========================================
-- Admin Email Swap Security
-- ==========================================

-- 1. Create table for email change challenges
CREATE TABLE IF NOT EXISTS public.email_change_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    new_email TEXT NOT NULL,
    otp_code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by user and code
CREATE INDEX IF NOT EXISTS idx_email_change_challenges_user_code ON public.email_change_challenges(user_id, otp_code);

-- Enable RLS
ALTER TABLE public.email_change_challenges ENABLE ROW LEVEL SECURITY;

-- Users can only view/manage their own challenges
CREATE POLICY "Users can manage their own email challenges"
    ON public.email_change_challenges
    FOR ALL
    USING (auth.uid() = user_id);

-- 2. Create RPC to initiate email swap
CREATE OR REPLACE FUNCTION public.initiate_email_swap(p_new_email TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_otp_code VARCHAR(6);
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Basic email validation
    IF p_new_email IS NULL OR p_new_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RAISE EXCEPTION 'Invalid email address format';
    END IF;

    -- Check if email is already taken
    IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_new_email) THEN
        RAISE EXCEPTION 'Email address already in use';
    END IF;

    -- Generate a 6-digit numeric OTP
    v_otp_code := lpad(floor(random() * 1000000)::text, 6, '0');

    -- Clear any existing pending challenges for this user to prevent spam
    DELETE FROM public.email_change_challenges WHERE user_id = v_user_id;

    -- Insert new challenge
    INSERT INTO public.email_change_challenges (user_id, new_email, otp_code, expires_at)
    VALUES (v_user_id, p_new_email, v_otp_code, now() + interval '15 minutes');

    -- In a real production system, an Edge Function/DB Trigger would catch this insert
    -- and dispatch the email to the OLD address (found via auth.users).
    -- For dev purposes, we return the code directly so the frontend can display/log it.
    
    RETURN json_build_object(
        'success', true,
        'message', 'Challenge created',
        'otp_code', v_otp_code, -- returning for dev environment
        'expires_at', now() + interval '15 minutes'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.initiate_email_swap(TEXT) TO authenticated;

-- 3. Create RPC to verify and execute email swap
CREATE OR REPLACE FUNCTION public.verify_and_execute_email_swap(p_otp_code TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id UUID;
    v_challenge RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Find a valid challenge
    SELECT * INTO v_challenge 
    FROM public.email_change_challenges 
    WHERE user_id = v_user_id 
      AND otp_code = p_otp_code
      AND expires_at > now()
    LIMIT 1;

    IF v_challenge IS NULL THEN
        RAISE EXCEPTION 'Invalid or expired verification code';
    END IF;

    -- Update the auth.users table directly (requires SECURITY DEFINER and supabase_admin/postgres privileges)
    -- This assumes this function is created as postgres superuser, giving it rights to update auth.users
    UPDATE auth.users 
    SET email = v_challenge.new_email,
        email_confirmed_at = now(),
        updated_at = now()
    WHERE id = v_user_id;

    -- Update the public.users table to keep it in sync
    UPDATE public.users
    SET email = v_challenge.new_email,
        updated_at = now()
    WHERE id = v_user_id;

    -- Delete the challenge so it can't be reused
    DELETE FROM public.email_change_challenges WHERE id = v_challenge.id;

    RETURN json_build_object(
        'success', true,
        'message', 'Email updated successfully',
        'new_email', v_challenge.new_email
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_and_execute_email_swap(TEXT) TO authenticated;
