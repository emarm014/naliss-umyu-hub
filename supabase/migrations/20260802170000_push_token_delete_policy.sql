-- Migration: Add DELETE RLS policy for user_push_tokens
-- Required for per-device logout: allows a user to delete only their own push token
-- without cascade-deleting tokens from all their other devices.
--
-- Context: The signOut flow now deletes from user_push_tokens directly
-- (scoped by user_id + push_token) instead of blanking users.push_token
-- which previously triggered sync_push_token_from_users() and wiped all device tokens.

CREATE POLICY "Users can delete their own push token"
    ON public.user_push_tokens FOR DELETE
    USING (auth.uid() = user_id);
