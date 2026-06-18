-- Step 1: Create pool_submissions table
CREATE TABLE public.pool_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id UUID NOT NULL REFERENCES public.event_pools(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    score INTEGER,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pool_id, user_id)
);

-- Step 2: Enable RLS
ALTER TABLE public.pool_submissions ENABLE ROW LEVEL SECURITY;

-- Step 3: RLS Policies
CREATE POLICY "Users can insert their own submissions"
    ON public.pool_submissions FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own submissions"
    ON public.pool_submissions FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
