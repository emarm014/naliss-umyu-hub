/**
 * Push Notification Dispatcher
 * Calls the Supabase Edge Function to send push notifications to target users.
 * Uses the current user's JWT â€” no secret needed in the client.
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
 * Fire-and-forget â€” never throws, never blocks the caller.
 */
export async function sendPushNotification(payload: PushPayload): Promise<void> {
  if (!payload.targetUserIds || payload.targetUserIds.length === 0) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    // Fire and forget â€” don't await, don't block the UI
    fetch(PUSH_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    }).catch((err) => console.error('[Notifications] push send failed:', err));
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
    const { data: members } = await (supabase as any)
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .neq('user_id', senderId);

    if (!members || members.length === 0) return;

    const targetUserIds = members.map((m: any) => m.user_id).filter(Boolean) as string[];

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

/**
 * Reconstruct and upsert a published announcement, event, or material
 * directly into the client's local store when received/synced via push notification.
 * Enables 100% offline access to the full notice content.
 */
export function upsertEntityFromNotification(type: string, data: any) {
  if (!data || !data.id) return;

  try {
    if (type === 'announcement') {
      const { useAnnouncementStore } = require('../stores/announcement.store');
      const newAnn = {
        id: data.id,
        title: data.title || '',
        content: data.content || '',
        cover_image_url: data.cover_image_url || null,
        category: data.category || 'general',
        priority: data.priority || 'normal',
        target_level: data.target_level || null,
        is_published: true,
        is_pinned: data.is_pinned === 'true' || !!data.is_pinned,
        view_count: Number(data.view_count || 0),
        published_at: data.published_at || new Date().toISOString(),
        created_at: data.created_at || new Date().toISOString(),
        updated_at: data.updated_at || new Date().toISOString(),
      };
      
      useAnnouncementStore.setState((state: any) => {
        const exists = state.announcements.some((a: any) => a.id === data.id);
        if (exists) {
          return {
            announcements: state.announcements.map((a: any) => (a.id === data.id ? { ...a, ...newAnn } : a)),
          };
        } else {
          return {
            announcements: [newAnn, ...state.announcements],
          };
        }
      });
    } else if (type === 'event') {
      const { useEventStore } = require('../stores/event.store');
      const newEvent = {
        id: data.id,
        title: data.title || '',
        description: data.description || '',
        cover_image_url: data.cover_image_url || null,
        status: data.status || 'published',
        is_virtual: data.is_virtual === 'true' || !!data.is_virtual,
        virtual_link: data.virtual_link || null,
        venue: data.venue || null,
        start_date: data.start_date || new Date().toISOString(),
        end_date: data.end_date || null,
        start_time: data.start_time || null,
        end_time: data.end_time || null,
        max_attendees: data.max_attendees ? Number(data.max_attendees) : null,
        current_attendees: Number(data.current_attendees || 0),
        is_public: data.is_public === 'true' || data.is_public !== false,
        view_count: Number(data.view_count || 0),
        created_at: data.created_at || new Date().toISOString(),
        published_at: data.published_at || new Date().toISOString(),
        updated_at: data.updated_at || new Date().toISOString(),
      };

      useEventStore.setState((state: any) => {
        const exists = state.events.some((e: any) => e.id === data.id);
        if (exists) {
          return {
            events: state.events.map((e: any) => (e.id === data.id ? { ...e, ...newEvent } : e)),
          };
        } else {
          return {
            events: [newEvent, ...state.events],
          };
        }
      });
    } else if (type === 'material' || type === 'resource') {
      const { useResourceStore } = require('../stores/resource.store');
      const newMaterial = {
        id: data.id,
        title: data.title || '',
        description: data.description || '',
        file_url: data.file_url || '',
        file_name: data.file_name || 'Material',
        file_size: data.file_size ? Number(data.file_size) : null,
        file_mime_type: data.file_mime_type || null,
        level: data.level || null,
        semester: data.semester || null,
        course_id: data.course_id || null,
        download_count: Number(data.download_count || 0),
        view_count: Number(data.view_count || 0),
        is_public: true,
        is_downloadable: data.is_downloadable === 'true' || !!data.is_downloadable,
        is_featured: data.is_featured === 'true' || !!data.is_featured,
        is_active: data.is_active !== false,
        created_at: data.created_at || new Date().toISOString(),
        updated_at: data.updated_at || new Date().toISOString(),
      };

      useResourceStore.setState((state: any) => {
        const exists = state.materials.some((m: any) => m.id === data.id);
        if (exists) {
          return {
            materials: state.materials.map((m: any) => (m.id === data.id ? { ...m, ...newMaterial } : m)),
          };
        } else {
          return {
            materials: [newMaterial, ...state.materials],
          };
        }
      });
    }
  } catch (err) {
    // silent fallback
  }
}

