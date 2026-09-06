CREATE TABLE IF NOT EXISTS public.featured_student_dismissals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    featured_student_id UUID NOT NULL REFERENCES public.featured_students(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(featured_student_id, user_id)
);

ALTER TABLE public.featured_student_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own dismissals"
  ON public.featured_student_dismissals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own dismissals"
  ON public.featured_student_dismissals FOR SELECT
  USING (auth.uid() = user_id);

GRANT ALL ON public.featured_student_dismissals TO authenticated;
GRANT ALL ON public.featured_student_dismissals TO service_role;
