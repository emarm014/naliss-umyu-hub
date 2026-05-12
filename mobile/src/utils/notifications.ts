/**
 * Push Notification Dispatcher
 * Calls the Supabase Edge Function to send push notifications to target users.
 * Uses the current user's JWT — no secret needed in the client.
 */

import { supabase } from '../api/supabase/client';

const PUSH_FUNCTION_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/push-notification`;

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

    // Fire and forget — don't await, don't block the UI
    fetch(PUSH_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    }).catch(() => {}); // silent — push failure never affects core functionality
  } catch {
    // silent
  }
}

/**
 * Send a chat message notification to all group members except the sender.
 */
export async function sendChatMessageNotification(
  groupId: string,
  groupName: string,
  senderName: string,
  messagePreview: string,
  senderId: string
): Promise<void> {
  try {
    // Fetch all group members except the sender
    const { data: members } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .neq('user_id', senderId);

    if (!members || members.length === 0) return;

    const targetUserIds = members.map(m => m.user_id).filter(Boolean) as string[];

    await sendPushNotification({
      targetUserIds,
      title: `${groupName}`,
      body: `${senderName}: ${messagePreview}`,
      data: {
        type: 'message',
        group_id: groupId,
      },
    });
  } catch {
    // silent
  }
}
