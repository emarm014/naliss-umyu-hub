-- Add UNIQUE constraint on (user_id, asset_id) to prevent duplicate download records
-- This ensures the upsert on recordDownload works correctly instead of creating duplicates
ALTER TABLE public.user_downloads ADD CONSTRAINT uq_user_downloads_user_asset UNIQUE (user_id, asset_id);

-- Grant UPDATE permission so upsert (INSERT ... ON CONFLICT UPDATE) works
GRANT UPDATE ON public.user_downloads TO authenticated;

-- Add UPDATE RLS policy so upsert can update existing rows
CREATE POLICY user_downloads_update ON public.user_downloads
    FOR UPDATE USING (auth.uid() = user_id);
