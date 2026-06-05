-- Allow anonymous users to read system settings (needed for pre-flight registration check)
DROP POLICY IF EXISTS "Public Read Settings" ON public.system_settings;

CREATE POLICY "Public Read Settings" 
  ON public.system_settings FOR SELECT 
  TO authenticated, anon
  USING (true);

GRANT SELECT ON public.system_settings TO anon, authenticated;

-- Create function to check if registration is allowed
CREATE OR REPLACE FUNCTION public.check_registration_allowed()
RETURNS TRIGGER AS $$
DECLARE
  allow_reg TEXT;
BEGIN
  -- Check allow_registration setting from public.system_settings
  SELECT value INTO allow_reg FROM public.system_settings WHERE key = 'allow_registration';
  IF allow_reg = 'false' THEN
    RAISE EXCEPTION 'Registration is currently disabled by the administrator.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS tr_check_registration_allowed ON auth.users;

-- Attach trigger to auth.users BEFORE INSERT
CREATE TRIGGER tr_check_registration_allowed
BEFORE INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.check_registration_allowed();
