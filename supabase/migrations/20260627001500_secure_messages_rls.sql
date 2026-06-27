-- Migration: 20260627001500_secure_messages_rls.sql
-- Description: Drop leaking Student Read Only messages policy to restrict message reading to group members and admins.

DROP POLICY IF EXISTS "Student Read Only messages" ON public.messages;
