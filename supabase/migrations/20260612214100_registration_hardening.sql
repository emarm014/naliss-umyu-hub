-- 1. Update check_existing_account to enforce complete enrollment state machine
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
    v_level text;
  BEGIN
    SELECT au.id INTO v_user_id
    FROM auth.users au
    WHERE lower(au.email) = lower(email_addr)
    LIMIT 1;
  
    IF v_user_id IS NULL THEN
      RETURN 'none';
    END IF;
  
    SELECT status, level INTO v_status, v_level
    FROM public.users
    WHERE id = v_user_id;
  
    -- NEW ATOMIC LOGIC: If no public record, or level is missing, it's INCOMPLETE
    IF v_status IS NULL OR v_level IS NULL THEN
      RETURN 'incomplete';
    END IF;

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

-- 2. Idempotent Pre-Enrollment Garbage Collection & Upsert Logic
CREATE OR REPLACE FUNCTION public.purge_incomplete_account(email_addr text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, auth
  AS $$
  DECLARE
    v_user_id uuid;
    v_level text;
  BEGIN
    -- 1. Find the auth user by email
    SELECT au.id INTO v_user_id
    FROM auth.users au
    WHERE lower(au.email) = lower(email_addr)
    LIMIT 1;

    IF v_user_id IS NULL THEN
      RETURN; -- Nothing to delete
    END IF;

    -- 2. Check if they have a completed profile
    SELECT level INTO v_level
    FROM public.users
    WHERE id = v_user_id;

    -- 3. If level is NOT NULL, they are fully enrolled. DO NOT PURGE.
    IF v_level IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot purge account: user has already completed registration.';
    END IF;

    -- 4. Safe to purge: Delete public record (if any) and auth record
    DELETE FROM public.users WHERE id = v_user_id;
    DELETE FROM auth.users WHERE id = v_user_id;
  END;
  $$;

GRANT EXECUTE ON FUNCTION public.purge_incomplete_account(text) TO anon, authenticated;
