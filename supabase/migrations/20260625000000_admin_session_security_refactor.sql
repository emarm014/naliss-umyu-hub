-- ==========================================
-- Admin Session Security Refactor
-- ==========================================

-- 1. Add is_device_blocked to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS is_device_blocked BOOLEAN DEFAULT FALSE;

-- 2. Create RPC to toggle device block
CREATE OR REPLACE FUNCTION public.toggle_device_block(p_user_id UUID, p_status BOOLEAN)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only allow super_admin or moderator to execute this
  IF NOT EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = auth.uid() AND role IN ('super_admin', 'moderator')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only admins and moderators can block devices.';
  END IF;

  UPDATE public.users 
  SET is_device_blocked = p_status 
  WHERE id = p_user_id;

  -- If blocking, also terminate all active sessions for this user
  IF p_status = true THEN
    UPDATE public.user_sessions
    SET is_active = false
    WHERE user_id = p_user_id AND is_active = true;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_device_block(UUID, BOOLEAN) TO authenticated;

-- 3. Update check_existing_account to block token issuance if device is blocked
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
    v_is_blocked boolean;
  BEGIN
    SELECT au.id INTO v_user_id
    FROM auth.users au
    WHERE lower(au.email) = lower(email_addr)
    LIMIT 1;
  
    IF v_user_id IS NULL THEN
      RETURN 'none';
    END IF;
  
    SELECT status, level, COALESCE(is_device_blocked, false) INTO v_status, v_level, v_is_blocked
    FROM public.users
    WHERE id = v_user_id;

    -- Block token issuance if device is permanently locked
    IF v_is_blocked = true THEN
      RETURN 'blocked';
    END IF;
  
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
