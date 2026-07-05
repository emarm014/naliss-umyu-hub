-- Ensure it is completely impossible for a single user to get a double-row entry in a single voting block
ALTER TABLE public.pool_submissions 
ADD CONSTRAINT unique_user_pool_submission UNIQUE (pool_id, user_id);
