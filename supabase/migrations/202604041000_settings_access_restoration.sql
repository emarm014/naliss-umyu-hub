-- NALISS Security Restoration: Administrative Settings Access
-- This migration restores the "Admin Full Control" policies for the system_settings table,
-- which were likely dropped during the universal reset in 202604022051.

DO $$ 
BEGIN
  -- 1. Ensure RLS is enabled
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'system_settings') THEN
    ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

    -- 2. Clean up existing settings policies to prevent conflicts
    DROP POLICY IF EXISTS "Admin Full Control system_settings" ON public.system_settings;
    DROP POLICY IF EXISTS "Admin Select system_settings" ON public.system_settings;
    DROP POLICY IF EXISTS "Admin Insert system_settings" ON public.system_settings;
    DROP POLICY IF EXISTS "Admin Update system_settings" ON public.system_settings;
    DROP POLICY IF EXISTS "Admin Delete system_settings" ON public.system_settings;
    DROP POLICY IF EXISTS "Public Read Settings" ON public.system_settings;

    -- 3. Re-implement Public Read (needed for maintnenance mode check in Mobile)
    -- All authenticated users (students) can read these settings
    CREATE POLICY "Public Read Settings" 
      ON public.system_settings FOR SELECT 
      TO authenticated 
      USING (true);

    -- 4. Implement Robust Admin Access using the is_admin_or_moderator function
    -- For UPDATE and INSERT (needed for upsert)
    CREATE POLICY "Admin Insert system_settings" 
      ON public.system_settings FOR INSERT 
      TO authenticated 
      WITH CHECK (public.is_admin_or_moderator());

    CREATE POLICY "Admin Update system_settings" 
      ON public.system_settings FOR UPDATE 
      TO authenticated 
      USING (public.is_admin_or_moderator()) 
      WITH CHECK (public.is_admin_or_moderator());

    CREATE POLICY "Admin Delete system_settings" 
      ON public.system_settings FOR DELETE 
      TO authenticated 
      USING (public.is_admin_or_moderator());

    -- 5. Seed all required keys to ensure fetch don't return empty
    INSERT INTO public.system_settings (key, value, value_type, category, is_public)
    VALUES 
      ('maintenance_mode', 'false', 'boolean', 'system', true),
      ('maintenance_message', 'The system is currently undergoing scheduled maintenance. Please check back later.', 'string', 'system', true),
      ('maintenance_estimated_end', '', 'string', 'system', true),
      ('read_only_mode', 'false', 'boolean', 'system', true),
      ('allow_registration', 'true', 'boolean', 'system', true),
      ('current_academic_year', '2025/2026', 'string', 'system', true)
    ON CONFLICT (key) DO NOTHING;

    RAISE NOTICE 'System settings policies and keys restored successfully.';
  ELSE
    RAISE WARNING 'Table system_settings does not exist. Skipping restoration.';
  END IF;
END $$;
