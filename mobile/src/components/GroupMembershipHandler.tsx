import React, { useEffect } from 'react';
import { supabase } from '../api/supabase/client';

/**
 * Logic-only component that verifies the current user's profile exists.
 * Group auto-joining is handled entirely by the database trigger (handle_user_group_sync).
 * 
 * Rules:
 * - Every student is auto-joined to the General Hub + their level group on registration
 * - This happens via the DB trigger when the users row is inserted/updated with a level
 * - Students only ever see 2 groups: their level group + the general group
 * - No manual group joining is allowed from the mobile app
 */
export const GroupMembershipHandler: React.FC = () => {
    useEffect(() => {
        const handleAuthChange = async (session: any) => {
            const userId = session?.user?.id;
            if (!userId) return;

            try {
                // Just verify the profile exists — do NOT create it here
                // Profile creation happens in level.tsx during registration
                // Creating it here without a level would waste the auto-join trigger
                const { data: userData } = await ((supabase as any).from('users')
                    .select('id, level, status')
                    .eq('id', userId)
                    .maybeSingle() as any);

                if (userData) {
                    // Profile verified — group membership handled by DB trigger
                } else {
                    // Profile not yet created — registration still in progress
                }
            } catch {
                // silent
            }
        };

        supabase.auth.getSession().then(({ data: { session } }) => {
            handleAuthChange(session);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            handleAuthChange(session);
        });

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    return null;
};
