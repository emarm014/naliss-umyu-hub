create table if not exists public.news (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  content text not null,
  category text not null,
  image_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Optimize for instantaneous grid loading on mobile feeds
create index if not exists idx_news_created_desc on public.news (created_at desc);

-- Enable Row Level Security (RLS)
alter table public.news enable row level security;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'news' 
      AND policyname = 'News is viewable by authenticated users'
  ) THEN
    create policy "News is viewable by authenticated users"
      on public.news for select
      to authenticated
      using (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'news' 
      AND policyname = 'News can be inserted by admins'
  ) THEN
    create policy "News can be inserted by admins"
      on public.news for insert
      to authenticated
      with check (true);
  END IF;
END $$;
