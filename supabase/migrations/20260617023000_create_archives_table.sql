create table public.archives (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  description text,
  file_url text not null,
  file_type text not null check (file_type in ('pdf', 'image', 'video', 'document')),
  file_size text, -- e.g., '2.4 MB'
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Optimize for instantaneous grid loading on mobile feeds
create index idx_archives_created_desc on public.archives (created_at desc);

-- Enable Row Level Security (RLS)
alter table public.archives enable row level security;

-- Create policy to allow authenticated users to view archives
create policy "Archives are viewable by authenticated users"
  on public.archives for select
  to authenticated
  using (true);
