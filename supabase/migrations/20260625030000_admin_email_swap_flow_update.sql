-- ==========================================
-- Admin Email Swap Flow Update
-- ==========================================

-- 1. Modify the challenge table to make new_email nullable and add is_verified flag
ALTER TABLE public.email_change_challenges
ALTER COLUMN new_email DROP NOT NULL;

ALTER TABLE public.email_change_challenges
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Drop the old RPCs
DROP FUNCTION IF EXISTS public.initiate_email_swap(TEXT);
DROP FUNCTION IF EXISTS public.verify_and_execute_email_swap(TEXT);

-- 3. Create RPC: initiate_email_swap_auth()
-- Generates OTP and stores challenge without a new email yet
CREATE OR REPLACE FUNCTION public.initiate_email_swap_auth()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_otp_code VARCHAR(6);
    v_challenge_id UUID;
BEGIN
    -- Get the current authenticated user
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Generate a secure 6-digit OTP (e.g. 100000 to 999999)
    v_otp_code := lpad(floor(random() * 900000 + 100000)::text, 6, '0');

    -- Insert the challenge into the vault (valid for 15 minutes)
    INSERT INTO public.email_change_challenges (user_id, otp_code, expires_at)
    VALUES (v_user_id, v_otp_code, now() + interval '15 minutes')
    RETURNING id INTO v_challenge_id;

    -- Return the challenge ID and OTP (for dev testing)
    RETURN json_build_object(
        'challenge_id', v_challenge_id,
        'otp_code', v_otp_code
    );
END;
$$;

-- 4. Create RPC: verify_email_swap_otp(p_otp_code)
-- Verifies the OTP and marks the challenge as verified
CREATE OR REPLACE FUNCTION public.verify_email_swap_otp(p_otp_code TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_challenge_id UUID;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Find a valid, unexpired challenge for this user and OTP
    SELECT id INTO v_challenge_id
    FROM public.email_change_challenges
    WHERE user_id = v_user_id
      AND otp_code = p_otp_code
      AND expires_at > now()
      AND is_verified = FALSE
    LIMIT 1;

    IF v_challenge_id IS NULL THEN
        RAISE EXCEPTION 'Invalid or expired OTP code';
    END IF;

    -- Mark as verified
    UPDATE public.email_change_challenges
    SET is_verified = TRUE
    WHERE id = v_challenge_id;

    RETURN json_build_object(
        'success', true,
        'challenge_id', v_challenge_id
    );
END;
$$;

-- 5. Create RPC: execute_email_swap(p_challenge_id, p_new_email)
-- Completes the process by updating the email if the challenge is verified
CREATE OR REPLACE FUNCTION public.execute_email_swap(p_challenge_id UUID, p_new_email TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_is_verified BOOLEAN;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Validate the challenge
    SELECT is_verified INTO v_is_verified
    FROM public.email_change_challenges
    WHERE id = p_challenge_id
      AND user_id = v_user_id
      AND expires_at > now()
    LIMIT 1;

    IF v_is_verified IS NULL OR v_is_verified = FALSE THEN
        RAISE EXCEPTION 'Invalid, expired, or unverified challenge';
    END IF;

    -- Update the identity in auth.users
    UPDATE auth.users
    SET email = p_new_email,
        updated_at = now()
    WHERE id = v_user_id;

    -- Update the custom profile in public.users
    UPDATE public.users
    SET email = p_new_email,
        updated_at = now()
    WHERE id = v_user_id;

    -- Destroy the challenge to prevent replay attacks
    DELETE FROM public.email_change_challenges
    WHERE id = p_challenge_id;

    RETURN json_build_object('success', true);
END;
$$;
