CREATE OR REPLACE FUNCTION public.check_quiz_answer(p_question_id UUID)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT correct_option FROM public.pool_quiz_questions WHERE id = p_question_id;
$$;
