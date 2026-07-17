-- ============================================================================
-- Migration: Featured Students, Event Winners & Student Congratulations
-- Description: Creates the infrastructure for "Student of the Week" (FYB),
--              "Legend of the Month", event winners, and the congratulations
--              reaction system.
-- ============================================================================

-- Step 1: Create Enum for featured student types
DO $$ BEGIN
  CREATE TYPE featured_student_type AS ENUM (
    'event_winner',       -- Winner declared from an event pool
    'student_of_the_week', -- FYB — admin picks any student
    'legend_of_the_month'  -- Monthly recognition
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 2: Create Enum for featured student scope
DO $$ BEGIN
  CREATE TYPE featured_student_scope AS ENUM (
    'department',   -- Department-level recognition
    'faculty',      -- Faculty-level recognition
    'university'    -- University-wide recognition
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 3: Create the featured_students table
CREATE TABLE IF NOT EXISTS public.featured_students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Who is featured
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- What type of feature
  type featured_student_type NOT NULL DEFAULT 'student_of_the_week',
  scope featured_student_scope NOT NULL DEFAULT 'department',
  
  -- Display metadata (admin-editable)
  title TEXT NOT NULL DEFAULT 'Student of the Week',
  subtitle TEXT,                              -- e.g. "Computer Science — 300 Level"
  description TEXT,                           -- Optional short write-up
  custom_image_url TEXT,                      -- Cloudinary flyer / custom photo
  
  -- Link to source event (only for event_winner type)
  pool_id UUID REFERENCES public.event_pools(id) ON DELETE SET NULL,
  
  -- Visibility & lifecycle
  is_active BOOLEAN NOT NULL DEFAULT true,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,                     -- Auto-deactivate after this time
  
  -- Engagement
  total_congratulations INTEGER NOT NULL DEFAULT 0,
  
  -- Admin who posted it
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step 4: Create the student_congratulations table (one-per-user guard)
CREATE TABLE IF NOT EXISTS public.student_congratulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  featured_student_id UUID NOT NULL REFERENCES public.featured_students(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Each user can only congratulate once per featured student
  UNIQUE(featured_student_id, user_id)
);

-- Step 5: Add winner_position to pool_participants (for event winners)
ALTER TABLE public.pool_participants
  ADD COLUMN IF NOT EXISTS winner_position INTEGER DEFAULT NULL;

COMMENT ON COLUMN public.pool_participants.winner_position IS
  '1 = Winner, 2 = First Runner-Up, 3 = Second Runner-Up. NULL = regular participant.';

-- Step 6: Indexes for performance
CREATE INDEX IF NOT EXISTS idx_featured_students_active 
  ON public.featured_students (is_active, published_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_featured_students_type 
  ON public.featured_students (type, is_active);

CREATE INDEX IF NOT EXISTS idx_student_congratulations_featured 
  ON public.student_congratulations (featured_student_id);

CREATE INDEX IF NOT EXISTS idx_pool_participants_winner 
  ON public.pool_participants (pool_id, winner_position)
  WHERE winner_position IS NOT NULL;

-- Step 7: Enable Row Level Security
ALTER TABLE public.featured_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_congratulations ENABLE ROW LEVEL SECURITY;

-- Step 8: RLS Policies — featured_students
-- All authenticated users can view featured students
CREATE POLICY "Anyone can view featured students"
  ON public.featured_students FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can insert/update/delete
CREATE POLICY "Admins can insert featured_students"
  ON public.featured_students FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_moderator());

CREATE POLICY "Admins can update featured_students"
  ON public.featured_students FOR UPDATE
  TO authenticated
  USING (public.is_admin_or_moderator())
  WITH CHECK (public.is_admin_or_moderator());

CREATE POLICY "Admins can delete featured_students"
  ON public.featured_students FOR DELETE
  TO authenticated
  USING (public.is_admin_or_moderator());

-- Step 9: RLS Policies — student_congratulations
-- Users can view all congratulations (to see count)
CREATE POLICY "Anyone can view congratulations"
  ON public.student_congratulations FOR SELECT
  TO authenticated
  USING (true);

-- Users can insert their own congratulation
CREATE POLICY "Users can insert their own congratulations"
  ON public.student_congratulations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Step 10: Secure RPC to congratulate a featured student
-- Atomically inserts a congratulation record and increments the counter
CREATE OR REPLACE FUNCTION public.congratulate_student(p_featured_student_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_new_count INTEGER;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Insert the congratulation (will fail on duplicate due to UNIQUE constraint)
  INSERT INTO public.student_congratulations (featured_student_id, user_id)
  VALUES (p_featured_student_id, v_user_id);
  
  -- Increment the counter atomically
  UPDATE public.featured_students
  SET total_congratulations = total_congratulations + 1,
      updated_at = NOW()
  WHERE id = p_featured_student_id
  RETURNING total_congratulations INTO v_new_count;
  
  RETURN jsonb_build_object(
    'success', true,
    'total_congratulations', v_new_count
  );
  
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'already_congratulated'
    );
END;
$$;

-- Step 11: Grant execute on the RPC to authenticated users
GRANT EXECUTE ON FUNCTION public.congratulate_student(UUID) TO authenticated;

-- Step 12: Grant table access to authenticated and service_role
GRANT SELECT ON public.featured_students TO authenticated;
GRANT ALL ON public.featured_students TO service_role;

GRANT SELECT, INSERT ON public.student_congratulations TO authenticated;
GRANT ALL ON public.student_congratulations TO service_role;
