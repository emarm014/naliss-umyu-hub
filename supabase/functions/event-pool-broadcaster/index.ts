import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function generateHash(token: string, type: string, entityId: string): Promise<string> {
  const timeWindow = Math.floor(Date.now() / 60000); // 1-minute window
  const input = `${token}:${type}:${entityId}:${timeWindow}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

interface Payload {
  pool_id: string;
  title: string;
  new_status?: 'live' | 'paused' | 'completed';
  is_cron?: boolean;
}

serve(async (req) => {
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
      notifTitle = 'Event Pool is Live! ðŸš€';
      notifBody = `The event "${pool.title}" has just started! Tap to join now.`;
    } else if (payload.new_status === 'completed') {
      notifTitle = 'Event Completed ðŸ†';
      notifBody = `The event "${pool.title}" has ended. Results are being calculated.`;
    } else {
      return new Response(JSON.stringify({ message: 'No notification needed for this state.' }), { status: 200 });
    }

    // 3. Batch Fetch Target User Tokens (based on participation rule and user preferences)
    // Ensure we join the public.users table (via foreign key) to filter active users who have not opted out of events.
    let tokenQuery = supabase
      .from('user_push_tokens')
      .select('user_id, push_token, users!inner(notif_events, status)')
      .eq('users.status', 'active')
      .neq('users.notif_events', false);
    
    if (pool.participation_rule !== 'open') {
      // Future expansion: filter tokenQuery based on pool.target_constraints
      // e.g., tokenQuery = tokenQuery.in('user_id', targetedUserIds)
    }

    const { data: tokens, error: tokenError } = await tokenQuery;
    
    if (tokenError || !tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ message: 'No push tokens found.' }), { status: 200 });
    }

    // Filter duplicates using deterministic hash
    const uniqueTokens = [];
    const processedHashes = new Set();
    for (const t of tokens) {
      const hash = await generateHash(t.push_token, 'event', pool.id);
      if (!processedHashes.has(hash)) {
        processedHashes.add(hash);
        uniqueTokens.push(t);
      }
    }

    // 4. Chunk tokens in batches of 100 for Expo Push API
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
        data: { type: 'event', id: pool.id, pool_id: pool.id },
        priority: 'high',
        channelId: 'default_v2',
        badge: 1,
        categoryIdentifier: categoryId,
        threadId: threadId,
        collapseKey: collapseKey,
      };
    });

    const chunks = [];
    const telemetryRecords = [];
    const historyRecords = [];
    const notifId = `event_pool_${pool.id}_${Date.now()}`;

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

      const responseJson = await response.json();
      const ticketData = responseJson.data || [];

      for (let k = 0; k < batch.length; k++) {
        const msg = batch[k];
        const ticket = ticketData[k] || {};
        const ut = batchTokens[k];

        telemetryRecords.push({
          notification_id: notifId,
          user_id: ut.user_id,
          type: 'event',
          status: ticket.status === 'ok' ? 'sent' : 'failed',
          platform: 'unknown',
          expo_ticket_id: ticket.id || null,
          provider_status: ticket.status || null,
          provider_error: ticket.message || (ticket.details?.error) || null
        });

        // Insert into unified history
        historyRecords.push({
          user_id: ut.user_id,
          notification_id: notifId,
          title: msg.title,
          body: msg.body,
          type: 'event',
          data: { type: 'event', id: pool.id, pool_id: pool.id },
          is_read: false
        });
      }
    }

    if (telemetryRecords.length > 0) {
      await supabase.from('notification_telemetry').upsert(telemetryRecords, { onConflict: 'user_id,notification_id' }).catch(() => {});
    }
    if (historyRecords.length > 0) {
      await supabase.from('notification_history').upsert(historyRecords, { onConflict: 'user_id,notification_id' }).catch(() => {});
    }

    return new Response(JSON.stringify({ success: true, batchesSent: chunks.length, sent: uniqueTokens.length }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
