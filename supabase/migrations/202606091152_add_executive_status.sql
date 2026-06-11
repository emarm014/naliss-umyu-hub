-- Add is_alumni column to executives table
ALTER TABLE public.executives ADD COLUMN is_alumni BOOLEAN DEFAULT FALSE;

-- Create RPC function to archive executive tenure
CREATE OR REPLACE FUNCTION public.archive_executive_tenure(target_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE public.executives
    SET is_alumni = TRUE,
        is_current = FALSE,
        updated_at = NOW()
    WHERE id = target_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution permission to authenticated users
GRANT EXECUTE ON FUNCTION public.archive_executive_tenure(UUID) TO authenticated;
