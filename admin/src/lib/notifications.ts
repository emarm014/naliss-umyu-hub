/**
 * Push Notification Dispatcher — Admin Panel
 * Calls the Supabase Edge Function to send push notifications.
 * Uses the current admin's JWT session.
 */

import { supabase } from './supabase';

const PUSH_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/push-notification`;

interface PushPayload {
  targetUserIds: string[];
  title: string;
  body: string;
  data?: Record<string, any>;
}

/**
 * Send a push notification to a list of users.
 * Fire-and-forget — never throws, never blocks the caller.
 */
export async function sendPushNotification(payload: PushPayload): Promise<void> {
  if (!payload.targetUserIds || payload.targetUserIds.length === 0) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    for (let i = 0; i < payload.targetUserIds.length; i += 500) {
      const batchPayload = { ...payload, targetUserIds: payload.targetUserIds.slice(i, i + 500) };
      fetch(PUSH_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(batchPayload),
      }).catch((err) => console.error('[Admin Notifications] push send failed:', err));
    }
  } catch {
    // silent
  }
}

/**
 * Fetch all active user IDs for a given level (or all levels).
 * Used to target announcement/material notifications.
 */
export async function getUserIdsForLevel(
  level: string | null
): Promise<string[]> {
  try {
    let query = supabase
      .from('users')
      .select('id')
      .eq('status', 'active')
      .not('push_token', 'is', null);

    if (level && level !== 'all') {
      query = query.eq('level', level);
    }

    const { data } = await query;
    return (data || []).map((u: any) => u.id);
  } catch {
    return [];
  }
}
