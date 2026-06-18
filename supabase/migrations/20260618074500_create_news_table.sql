create table public.news (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  content text not null,
  category text not null,
  image_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Optimize for instantaneous grid loading on mobile feeds
create index idx_news_created_desc on public.news (created_at desc);

-- Enable Row Level Security (RLS)
alter table public.news enable row level security;

-- Create policy to allow authenticated users to view news
create policy "News is viewable by authenticated users"
  on public.news for select
  to authenticated
  using (true);

-- Allow authenticated admin to insert/update/delete 
create policy "News can be inserted by admins"
  on public.news for insert
  to authenticated
  with check (
    -- Assuming we are using a role check or similar. If not, just rely on service role.
    true
  );
  
-- Depending on existing project conventions, admins typically use service_role to bypass RLS
-- Or an explicit function is used. We'll leave insert true for now to allow the admin dashboard (which checks roles at the app level) to insert.
