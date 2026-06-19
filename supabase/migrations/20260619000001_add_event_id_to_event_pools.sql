-- Step 1: Add event_id to event_pools
ALTER TABLE public.event_pools ADD COLUMN IF NOT EXISTS event_id UUID UNIQUE REFERENCES public.events(id) ON DELETE SET NULL;
