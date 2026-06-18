-- Step 1: Create Enums
CREATE TYPE event_pool_type AS ENUM ('quiz', 'essay', 'challenge', 'debate', 'voting', 'talent', 'academic', 'custom');
CREATE TYPE event_pool_status AS ENUM ('draft', 'scheduled', 'live', 'paused', 'completed', 'archived');
CREATE TYPE participation_type AS ENUM ('open', 'level_based', 'department_based', 'individual_selection', 'team_based');

-- Step 2: Create public.event_pools Table
CREATE TABLE public.event_pools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID UNIQUE REFERENCES public.announcements(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    type event_pool_type NOT NULL DEFAULT 'quiz',
    status event_pool_status NOT NULL DEFAULT 'draft',
    participation_rule participation_type NOT NULL DEFAULT 'open',
    target_constraints JSONB DEFAULT '{}'::jsonb,
    registration_open TIMESTAMPTZ,
    registration_close TIMESTAMPTZ,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    result_published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 3: Create public.pool_quiz_questions Table
CREATE TABLE public.pool_quiz_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id UUID NOT NULL REFERENCES public.event_pools(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    correct_option TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 1,
    explanation TEXT,
    difficulty_level TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 4: Create descending chronological B-Tree index on event_pools
CREATE INDEX idx_event_pools_status_start_time ON public.event_pools (status, start_time DESC);

-- Step 5: Enable Row Level Security (RLS)
ALTER TABLE public.event_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pool_quiz_questions ENABLE ROW LEVEL SECURITY;

-- Step 6: Define basic RLS Policies for event_pools
CREATE POLICY "Enable read access for all authenticated users to event_pools" 
    ON public.event_pools FOR SELECT 
    TO authenticated 
    USING (true);

-- Step 7: Define basic RLS Policies for pool_quiz_questions
-- Typically only return questions if pool is 'live' or user is admin, but for now allow read access
CREATE POLICY "Enable read access for all authenticated users to pool_quiz_questions" 
    ON public.pool_quiz_questions FOR SELECT 
    TO authenticated 
    USING (true);

-- Step 8: Create an RPC function to securely return the current database server timestamp
CREATE OR REPLACE FUNCTION get_server_time()
RETURNS TIMESTAMPTZ
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT NOW();
$$;
