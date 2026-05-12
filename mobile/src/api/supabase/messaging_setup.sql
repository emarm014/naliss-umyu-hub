-- NALISS UMYU HUB - Messaging Database Setup (Authenticated Users Only)
-- This file documents the current database state for reference.
-- Migrations have been applied via Supabase MCP.

-- ============ TABLES ============

-- public.users (id, registration_number, full_name, username, email, avatar_url, level, role, status, motivation, hobbies, biography, created_at, updated_at)
-- public.groups (id, name, description, group_type, level, avatar_url, is_active, moderator_id, created_at, updated_at)
-- public.group_members (id, group_id FK->groups, user_id FK->users, role, created_at)
-- public.messages (id, group_id FK->groups, user_id FK->users, content, content_type, message_type, attachment_url, reply_to_id FK->messages, is_edited, is_deleted, created_at, updated_at)

-- ============ RLS POLICIES ============

-- groups:
--   SELECT: "Anyone can view active groups" - (is_active = true)
--   INSERT: "Authenticated users can create groups" - authenticated WITH CHECK (true)
--   UPDATE: "Authenticated users can update groups" - authenticated USING (true)

-- group_members:
--   SELECT: "Users can view group members" - user must be in the group to see that group's members
--   INSERT: "Users can join groups" - (auth.uid() = user_id)

-- messages:
--   SELECT: "Users can view messages in their groups" - group_id IN user's memberships
--   INSERT: "Users can send messages to their groups" - user_id = auth.uid() AND group_id IN user's memberships
--   UPDATE: "Users can update their own messages" - auth.uid() = user_id
--   DELETE: "Users can delete their own messages" - auth.uid() = user_id

-- users:
--   SELECT: "Authenticated users can view all profiles" - true (for chat message display)
--   INSERT: "Users can insert their own profile" - auth.uid() = id
--   UPDATE: "Users can update their own profile" - auth.uid() = id

-- ============ CORE GROUPS (Seeded) ============

-- "NALISS FAMILY UMYUK" (type: department) - All members auto-join
-- "Level 100" (type: level, level: 100)
-- "Level 200" (type: level, level: 200)
-- "Level 300" (type: level, level: 300)
-- "Level 400" (type: level, level: 400)

-- ============ REALTIME ============
-- Tables `messages` and `group_members` are added to supabase_realtime publication.

-- ============ STORAGE ============
-- Bucket: "message-attachments" (public)
