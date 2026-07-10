import { supabase } from '../api/supabase/client';
import { useSignupStore } from '../stores/signup.store';
import { useGroupStore } from '../stores/group.store';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Cleans up everything when a user quits mid-signup or times out.
 *
 * NEW ATOMIC FLOW:
 * - Steps 1-4: No Supabase auth record exists yet — cleanup is purely local
 * - Step 5 (level): If profile creation fails AFTER signUp(), we delete the auth record
 *
 * This function handles both cases safely.
 */
export async function cleanupIncompleteSignup(): Promise<void> {
    const email = useSignupStore.getState().email;

    // Only attempt Supabase cleanup if a session exists
    // (meaning signUp() was called at step 5 and something failed after)
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            // A session exists — delete the incomplete auth record
            await (supabase as any).rpc('delete_incomplete_signup');
            await supabase.auth.signOut();
        }
        // No session = steps 1-4 abandoned = nothing to delete from Supabase
    } catch {
        // silent — best effort
    }

    // Always clear local state
    useSignupStore.getState().reset();
    // NOTE: Do NOT clear message cache here. Messages are permanent and belong
    // to the user's account — they must survive signup cleanup, app restarts,
    // and any other lifecycle event. Only clear on explicit user sign-out.
    // useMessageStore.getState().clearCache(); ← intentionally removed
    useGroupStore.getState().clearGroups();

    // Clear OTP resend counters for this email
    if (email) {
        try {
            await Promise.all([
                AsyncStorage.removeItem(`otp_resend_count_${email}`),
                AsyncStorage.removeItem(`otp_resend_lock_${email}`),
            ]);
        } catch {
            // silent
        }
    }
}
