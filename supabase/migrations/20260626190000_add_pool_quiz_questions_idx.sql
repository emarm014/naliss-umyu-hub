-- Migration: 20260626190000_add_pool_quiz_questions_idx.sql
-- Description: Add index on pool_id for pool_quiz_questions to optimize get_safe_quiz_questions rpc.

CREATE INDEX IF NOT EXISTS idx_pool_quiz_questions_pool_id ON public.pool_quiz_questions(pool_id);
