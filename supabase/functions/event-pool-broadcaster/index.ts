// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const EXPO_TOKEN_REGEX = /^Expo(nent)?PushToken\[.+\]$/;

async function generateHash(token: string, type: string, entityId: string): Promise<string> {
  const input = `${token}:${type}:${entityId}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

interface Payload {
  pool_id: string;
  title: string;
  new_status?: 'live' | 'paused' | 'completed' | 'archived';
  is_cron?: boolean;
}

serve(async (req: Request) => {
  try {
    const payload: Payload = await req.json();

    if (!payload.pool_id) {
      return new Response(JSON.stringify({ error: 'Missing pool_id' }), { status: 400 });
    }

    // 1. Fetch Event Pool Details
    const { data: pool, error: poolError } = await supabase
      .from('event_pools')
      .select('id, title, status, participation_rule, target_constraints, start_time')
      .eq('id', payload.pool_id)
      .single();

    if (poolError || !pool) {
      return new Response(JSON.stringify({ error: 'Event Pool not found' }), { status: 404 });
    }

    // 2. Draft Notification Message
    let notifTitle = 'Event Pool Update';
    let notifBody = '';

    if (payload.is_cron) {
      notifTitle = '1-Hour Reminder!';
      notifBody = `The event "${pool.title}" starts in 1 hour. Get ready!`;
    } else if (payload.new_status === 'live') {
      notifTitle = 'Event Pool is Live! 🚀';
      notifBody = `The event "${pool.title}" has just started! Tap to join now.`;
    } else if (payload.new_status === 'completed' || payload.new_status === 'archived') {
      notifTitle = 'Event Results Announced 🏆';
      notifBody = `The event "${pool.title}" has concluded. Tap to view the results and winners!`;
    } else {
      return new Response(JSON.stringify({ message: 'No notification needed for this state.' }), { status: 200 });
    }

    // 3. Batch Fetch Target User Tokens
    const { data: tokens, error: tokenError } = await supabase
      .from('user_push_tokens')
      .select('user_id, push_token, users!inner(notif_enabled, notif_events, status)')
      .eq('users.status', 'active')
      .neq('users.notif_enabled', false)
      .neq('users.notif_events', false);

    if (tokenError) throw tokenError;
    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ message: 'No push tokens found.' }), { status: 200 });
    }

    // Filter valid Expo tokens & deduplicate per device
    const uniqueTokens = [];
    const processedHashes = new Set<string>();
    for (const t of tokens) {
      if (!t.push_token || !EXPO_TOKEN_REGEX.test(String(t.push_token))) continue;
      const hash = await generateHash(t.push_token, 'event', pool.id);
      if (!processedHashes.has(hash)) {
        processedHashes.add(hash);
        uniqueTokens.push(t);
      }
    }

    if (uniqueTokens.length === 0) {
      return new Response(JSON.stringify({ message: 'No valid Expo push tokens found.' }), { status: 200 });
    }

    const notifId = `event_pool_${pool.id}_${Date.now()}`;
    const poolImageUrl =
      typeof pool.cover_image_url === 'string' && pool.cover_image_url.startsWith('http')
        ? pool.cover_image_url
        : null;
    const CHUNK_SIZE = 100;
    const messages = uniqueTokens.map((t) => {
      const isQuizType = pool.participation_rule === 'quiz' || pool.title.toLowerCase().includes('quiz');
      const categoryId = isQuizType ? 'quiz_actions' : 'event_actions';
      const threadId = isQuizType ? 'quizzes' : 'events';
      const collapseKey = isQuizType ? `quiz_${pool.id}` : `event_${pool.id}`;

      return {
        to: t.push_token,
        sound: 'default',
        title: notifTitle,
        body: notifBody,
        data: {
          type: 'event',
          id: pool.id,
          pool_id: pool.id,
          notification_id: notifId,
          ...(poolImageUrl ? { cover_image_url: poolImageUrl } : {}),
        },
        priority: 'high',
        channelId: 'events_v1',
        badge: 1,
        categoryIdentifier: categoryId,
        threadId: threadId,
        collapseKey: collapseKey,
        ...(poolImageUrl
          ? {
              richContent: { image: poolImageUrl },
              attachments: [{ url: poolImageUrl }],
              mutableContent: true,
            }
          : {}),
        contentAvailable: true,
        _displayInForeground: true,
      };
    });

    const telemetryMap = new Map<string, any>();
    const historyMap = new Map<string, any>();
    const tokensToRemove = new Set<string>();
    const nowIso = new Date().toISOString();

    for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
      const batch = messages.slice(i, i + CHUNK_SIZE);
      const batchTokens = uniqueTokens.slice(i, i + CHUNK_SIZE);

      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
      });

      const ok = response.ok;
      const responseJson = await response.json().catch(() => ({}));
      const ticketData = Array.isArray(responseJson?.data) ? responseJson.data : [];

      for (let k = 0; k < batch.length; k++) {
        const msg = batch[k];
        const ticket = ticketData[k] || {};
        const ut = batchTokens[k];
        const isTicketOk = ok && ticket.status === 'ok';
        const errCode = ticket.details?.error || ticket.message || (!ok ? `HTTP ${response.status}` : null);

        if (!isTicketOk && errCode === 'DeviceNotRegistered') {
          tokensToRemove.add(ut.push_token);
        }

        const telKey = `${ut.user_id}:${notifId}:${ut.push_token}`;
        telemetryMap.set(telKey, {
          notification_id: notifId,
          user_id: ut.user_id,
          type: 'event',
          status: isTicketOk ? 'sent' : 'failed',
          platform: 'unknown',
          expo_ticket_id: ticket.id || null,
          provider_status: ticket.status || (ok ? 'unknown' : 'error'),
          provider_error: isTicketOk ? null : errCode,
          push_token: ut.push_token,
          failed_at: isTicketOk ? null : nowIso,
          updated_at: nowIso,
        });

        const histKey = `${ut.user_id}:${notifId}`;
        if (!historyMap.has(histKey)) {
          historyMap.set(histKey, {
            user_id: ut.user_id,
            notification_id: notifId,
            title: msg.title,
            body: msg.body,
            type: 'event',
            data: { type: 'event', id: pool.id, pool_id: pool.id },
            is_read: false,
          });
        }
      }
    }

    if (tokensToRemove.size > 0) {
      for (const badToken of tokensToRemove) {
        const { error: rmErr } = await supabase.rpc('remove_push_token', { p_token: badToken });
        if (rmErr) console.error('[EventPoolBroadcaster] remove_push_token error:', rmErr.message);
      }
    }

    const telemetryRecords = Array.from(telemetryMap.values());
    if (telemetryRecords.length > 0) {
      const { error: telErr } = await supabase
        .from('notification_telemetry')
        .upsert(telemetryRecords, { onConflict: 'user_id,notification_id,push_token' });
      if (telErr) console.error('[EventPoolBroadcaster] telemetry upsert error:', telErr.message);
    }

    const historyRecords = Array.from(historyMap.values());
    if (historyRecords.length > 0) {
      const { error: histErr } = await supabase
        .from('notification_history')
        .upsert(historyRecords, { onConflict: 'user_id,notification_id' });
      if (histErr) console.error('[EventPoolBroadcaster] history upsert error:', histErr.message);
    }

    return new Response(JSON.stringify({ success: true, sent: uniqueTokens.length }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
