-- Step 1: Create pool_participants table
CREATE TABLE public.pool_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id UUID NOT NULL REFERENCES public.event_pools(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    final_score INTEGER NOT NULL DEFAULT 0,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rank INTEGER,
    UNIQUE(pool_id, user_id)
);

-- Step 2: Performance Index for Leaderboard fetching
CREATE INDEX idx_participants_leaderboard ON public.pool_participants (pool_id, final_score desc, completed_at asc);

-- Step 3: Enable RLS
ALTER TABLE public.pool_participants ENABLE ROW LEVEL SECURITY;

-- Step 4: RLS Policies
CREATE POLICY "Anyone can view pool participants"
    ON public.pool_participants FOR SELECT
    TO authenticated
    USING (true);
