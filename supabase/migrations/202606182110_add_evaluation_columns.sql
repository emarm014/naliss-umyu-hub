-- Migration: Add manual evaluation tracking columns to pool_submissions
-- Description: Adds columns to track grading, feedback, and podium assignment for manual grading workflows (essays, challenges).

ALTER TABLE public.pool_submissions
ADD COLUMN grading_status TEXT DEFAULT 'pending',
ADD COLUMN grading_score INTEGER,
ADD COLUMN grading_feedback TEXT,
ADD COLUMN podium_status TEXT;
