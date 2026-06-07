-- RPC: check_existing_account
-- Returns the original registration provider for an email (primary provider), 'none' if not found, or 'graduated' if graduated.
-- Ensures strict separation: users cannot bypass check by linking accounts or having multiple login providers.

CREATE OR REPLACE FUNCTION public.check_existing_account(email_addr text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_provider text;
  v_status text;
BEGIN
  SELECT au.id INTO v_user_id
  FROM auth.users au
  WHERE lower(au.email) = lower(email_addr)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN 'none';
  END IF;

  SELECT status INTO v_status
  FROM public.users
  WHERE id = v_user_id;

  IF v_status = 'graduated' THEN
    RETURN 'graduated';
  END IF;

  -- Read the primary/original provider. When user signs in with Google,
  -- if they originally registered with email, raw_app_meta_data->>'provider' remains 'email'.
  SELECT COALESCE(raw_app_meta_data->>'provider', 'email') INTO v_provider
  FROM auth.users
  WHERE id = v_user_id;

  RETURN v_provider;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_existing_account(text) TO anon, authenticated;
