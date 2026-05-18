-- RPC: check_existing_account
-- Returns the auth provider for an email, or 'none' if not found, or 'graduated' if graduated.
-- Used by the login screen to show the correct error/action before attempting auth.

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

  SELECT
    CASE
      WHEN raw_app_meta_data->>'provider' = 'google' THEN 'google'
      WHEN raw_app_meta_data->'providers' ? 'google' THEN 'google'
      ELSE 'email'
    END INTO v_provider
  FROM auth.users
  WHERE id = v_user_id;

  RETURN COALESCE(v_provider, 'email');
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_existing_account(text) TO anon, authenticated;
