CREATE TABLE IF NOT EXISTS public.deleted_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_user_id UUID NOT NULL,
    email TEXT,
    full_name TEXT,
    username TEXT,
    level TEXT,
    deleted_at TIMESTAMPTZ DEFAULT now(),
    logs JSONB DEFAULT '{}'::jsonb
);

-- RLS Policies
ALTER TABLE public.deleted_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow admins to read deleted accounts"
ON public.deleted_accounts
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = auth.uid()
        AND (users.role = 'admin' OR users.role = 'super_admin' OR users.role = 'moderator')
    )
);
