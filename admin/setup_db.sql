-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Departments Table
create table if not exists public.departments (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  code text not null unique,
  description text,
  logo_url text,
  office_location text,
  contact_email text,
  contact_phone text,
  is_active boolean default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Insert default NALISS department
insert into public.departments (name, code, description)
values ('Library & Information Science', 'LIS', 'Department of Library and Information Science')
on conflict (code) do nothing;

-- 2. Lecturers Table
create table if not exists public.lecturers (
  id uuid default uuid_generate_v4() primary key,
  department_id uuid references public.departments(id),
  full_name text not null,
  title text,
  email text,
  phone text,
  avatar_url text,
  position text,
  specialization text,
  office_location text,
  office_hours text,
  bio text,
  qualifications text,
  is_active boolean default true,
  display_order integer default 0,
  social_links jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Executives Table
create table if not exists public.executives (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id),
  department_id uuid references public.departments(id),
  full_name text,
  avatar_url text,
  bio text,
  position text not null,
  position_code text,
  email text,
  phone text,
  social_links jsonb default '{}'::jsonb,
  academic_session text not null,
  start_date date,
  end_date date,
  is_current boolean default true,
  display_order integer default 0,
  is_active boolean default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Photos Table (Gallery for Lecturers/Executives)
create table if not exists public.photos (
  id uuid default uuid_generate_v4() primary key,
  entity_type text not null check (entity_type in ('lecturer', 'executive', 'event')),
  entity_id uuid not null,
  url text not null,
  caption text,
  display_order integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Events Table
create table if not exists public.events (
  id uuid default gen_random_uuid() primary key,
  created_by uuid references auth.users(id),
  title text not null,
  description text,
  cover_image_url text,
  start_date date not null,
  end_date date,
  start_time time,
  end_time time,
  venue text,
  is_virtual boolean default false,
  virtual_link text,
  max_attendees integer,
  current_attendees integer default 0,
  target_level text,
  status text default 'draft' check (status in ('draft', 'published', 'ongoing', 'completed', 'cancelled')),
  is_public boolean default true,
  view_count integer default 0,
  published_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Announcements Table
create table if not exists public.announcements (
  id uuid default gen_random_uuid() primary key,
  author_id uuid references auth.users(id),
  title text not null,
  content text not null,
  category text default 'general' check (category in ('general', 'academic', 'social', 'event')),
  cover_image_url text,
  priority text default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  target_level text,
  is_scheduled boolean default false,
  scheduled_for timestamp with time zone,
  is_published boolean default true,
  is_pinned boolean default false,
  view_count integer default 0,
  published_at timestamp with time zone default timezone('utc'::text, now()),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Disable Row Level Security (admin can do everything, app users read)
alter table public.departments disable row level security;
alter table public.lecturers disable row level security;
alter table public.executives disable row level security;
alter table public.photos disable row level security;
alter table public.events disable row level security;
alter table public.announcements disable row level security;

