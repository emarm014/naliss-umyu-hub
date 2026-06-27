import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
      notifTitle = 'Event Pool is Live! 🚀';
      notifBody = `The event "${pool.title}" has just started! Tap to join now.`;
    } else if (payload.new_status === 'completed') {
      notifTitle = 'Event Completed 🏆';
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

    // 4. Chunk tokens in batches of 100 for Expo Push API
    const CHUNK_SIZE = 100;
    const messages = tokens.map((t) => {
      const isQuizType = pool.participation_rule === 'quiz' || pool.title.toLowerCase().includes('quiz');
      const categoryId = isQuizType ? 'quiz_actions' : 'event_actions';
      const threadId = isQuizType ? 'quizzes' : 'events';

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
      };
    });

    const chunks = [];
    for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
      chunks.push(messages.slice(i, i + CHUNK_SIZE));
    }

    // 5. Blast to Expo
    for (const chunk of chunks) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
    }

    // Telemetry tracking - log sent records
    const notifId = `event_pool_${pool.id}_${Date.now()}`;
    const telemetryRecords = tokens.map(t => ({
      notification_id: notifId,
      user_id: t.user_id,
      type: 'event',
      status: 'sent',
      platform: 'unknown'
    }));

    if (telemetryRecords.length > 0) {
      await supabase.from('notification_telemetry').upsert(telemetryRecords, { onConflict: 'user_id,notification_id' }).catch(() => {});
    }

    return new Response(JSON.stringify({ success: true, batchesSent: chunks.length }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
