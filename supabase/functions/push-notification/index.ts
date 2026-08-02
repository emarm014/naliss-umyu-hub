import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore
import * as Sentry from "https://esm.sh/@sentry/deno";

declare const Deno: any;

const SENTRY_DSN = Deno.env.get("SENTRY_DSN") || Deno.env.get("VITE_SENTRY_DSN") || "";
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 1.0,
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret, baggage, sentry-trace",
};

async function generateHash(token: string, type: string, entityId: string): Promise<string> {
  const input = `${token}:${type}:${entityId}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  // Accept either internal secret OR valid Supabase JWT
  const callerSecret = req.headers.get("x-internal-secret");
  const authHeader = req.headers.get("Authorization") ?? "";
  const isInternalCall = INTERNAL_SECRET && callerSecret === INTERNAL_SECRET;
  const hasJwt = authHeader.startsWith("Bearer ");

  if (!isInternalCall && !hasJwt) {
    return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let senderUser: any = null;

  // Verify JWT if not internal call
  if (!isInternalCall && hasJwt) {
    const token = authHeader.replace("Bearer ", "");
    const verifyClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: authData, error } = await verifyClient.auth.getUser(token);
    if (error || !authData?.user) {
      return new Response(JSON.stringify({ success: false, error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    senderUser = authData.user;
  }

  try {
    const { targetUserIds, title, body, data } = await req.json();

    if (!targetUserIds || !Array.isArray(targetUserIds) || targetUserIds.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "Invalid payload: targetUserIds must be a non-empty array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (targetUserIds.length > 500) {
      return new Response(JSON.stringify({ success: false, error: "Payload exceeds maximum target user limit (500)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Authorization & Security Checks for Non-Internal (Authenticated User) Requests
    if (!isInternalCall && senderUser) {
      // 1. Sender Active Status & Role Check
      const { data: senderProfile } = await supabase
        .from("users")
        .select("status, role")
        .eq("id", senderUser.id)
        .single();

      if (!senderProfile || senderProfile.status !== "active") {
        return new Response(JSON.stringify({ success: false, error: "Forbidden: Account is inactive or restricted" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const notifType = data?.type ?? "";

      // 2. Chat Message Authorization: Sender MUST belong to target conversation
      if (notifType === "message" && data?.group_id) {
        const { data: member } = await supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", data.group_id)
          .eq("user_id", senderUser.id)
          .single();

        if (!member) {
          return new Response(JSON.stringify({ success: false, error: "Forbidden: Sender is not a member of this conversation" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // 3. Broadcast Authorization: Announcements and events require elevated privileges
      if (["announcement", "event"].includes(notifType)) {
        const isAdminOrMod = ["super_admin", "system_owner", "moderator"].includes(senderProfile.role);
        if (!isAdminOrMod) {
          return new Response(JSON.stringify({ success: false, error: "Forbidden: Elevated privileges required to broadcast notifications" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // 4. Rate Limiting: Max 30 push calls per 60s per sender
      const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
      const { count: recentCount } = await supabase
        .from("notification_telemetry")
        .select("*", { count: "exact", head: true })
        .eq("user_id", senderUser.id)
        .gte("created_at", oneMinuteAgo);

      if (recentCount && recentCount > 30) {
        return new Response(JSON.stringify({ success: false, error: "Rate limit exceeded: Please wait before sending more notifications" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Fetch push tokens + ALL notification preferences from user_push_tokens + users (optimized join)
    const { data: userTokens, error } = await supabase
      .from("user_push_tokens")
      .select("user_id, push_token, users!inner(status, notif_enabled, notif_messages, notif_announcements, notif_events, notif_materials, notif_quizzes, notif_assignments, notif_security, notif_system, privacy_mode, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, muted_groups)")
      .in("user_id", targetUserIds)
      .eq("users.status", "active");

    if (error) throw error;
    if (!userTokens || userTokens.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No active push tokens found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter by each user's individual notification preferences
    const notifType = data?.type ?? "";
    const targetGroupId = data?.group_id || data?.id || "";

    const filteredTokens = userTokens.filter((ut: any) => {
      const u = ut.users;
      if (!u) return false;

      // 1. Global Notification Toggle
      if (u.notif_enabled === false) return false;

      // 2. Granular Category Controls
      if (notifType === "message" && u.notif_messages === false) return false;
      if (notifType === "announcement" && u.notif_announcements === false) return false;
      if (notifType === "event" && u.notif_events === false) return false;
      if (notifType === "material" && u.notif_materials === false) return false;
      if (notifType === "quiz" && u.notif_quizzes === false) return false;
      if (notifType === "assignment" && u.notif_assignments === false) return false;
      if (notifType === "security" && u.notif_security === false) return false;
      if (notifType === "system" && u.notif_system === false) return false;

      // 3. Conversation & Group Mute Controls
      if (notifType === "message" && targetGroupId && Array.isArray(u.muted_groups)) {
        if (u.muted_groups.includes(String(targetGroupId))) {
          return false;
        }
      }

      return true;
    });

    if (filteredTokens.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "All users opted out" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Duplicate protection using deterministic hash
    const uniqueTokens = [];
    const processedHashes = new Set();
    const entityId = data?.id || data?.group_id || data?.pool_id || "general";

    for (const ut of filteredTokens) {
      const hash = await generateHash(ut.push_token, notifType, entityId);
      if (!processedHashes.has(hash)) {
        processedHashes.add(hash);
        uniqueTokens.push(ut);
      }
    }

    // Map custom priorities to Expo options
    const payloadPriority = data?.priority ?? "high";
    let expoPriority: "default" | "normal" | "high" = "high";
    let expoSound: string | null = "default";
    let expoChannelId = "default_v2";
    let isSilent = false;

    if (payloadPriority === "silent") {
      expoPriority = "normal";
      expoSound = null;
      expoChannelId = "low_priority";
      isSilent = true;
    } else if (payloadPriority === "low") {
      expoPriority = "normal";
      expoSound = null;
      expoChannelId = "low_priority";
    } else if (payloadPriority === "normal") {
      expoPriority = "default";
      expoChannelId = "default_v2";
    }

    // Map custom categories
    let categoryId = data?.categoryIdentifier ?? null;
    if (!categoryId && notifType) {
      if (notifType === "message") categoryId = "chat_actions";
      else if (notifType === "announcement") categoryId = "announcement_actions";
      else if (notifType === "event") categoryId = "event_actions";
      else if (notifType === "quiz") categoryId = "quiz_actions";
      else if (notifType === "material" || notifType === "resource") categoryId = "material_actions";
      else if (notifType === "application") categoryId = "application_actions";
    }

    // Thread ID / Group keys
    let threadId = data?.threadId ?? null;
    if (!threadId && notifType) {
      if (notifType === "message") {
        threadId = `chat_${data.group_id || "general"}`;
      } else {
        threadId = `${notifType}s`;
      }
    }

    // Android Collapse Keys
    let collapseKey = data?.collapseKey ?? null;
    if (!collapseKey && notifType) {
      collapseKey = `${notifType}_${entityId}`;
    }

    // Rich Media (attachments)
    const imageUrl = data?.cover_image_url || data?.file_url || data?.image_url || data?.avatar_url || null;
    const attachments = imageUrl ? [{ url: imageUrl }] : undefined;
    const mutableContent = attachments ? true : undefined;

    // Fetch current unread count per target user from notification_history to calculate dynamic badge
    const userUnreadCounts = new Map<string, number>();
    try {
      const { data: unreadRows } = await supabase
        .from("notification_history")
        .select("user_id")
        .in("user_id", targetUserIds)
        .eq("is_read", false);

      if (unreadRows && Array.isArray(unreadRows)) {
        for (const row of unreadRows) {
          if (row.user_id) {
            userUnreadCounts.set(row.user_id, (userUnreadCounts.get(row.user_id) || 0) + 1);
          }
        }
      }
    } catch {
      // Fallback if query fails
    }

    // Build message objects list (one message per token to support individual Privacy Mode title/body mapping)
    const messages = uniqueTokens.map((ut) => {
      const u = ut.users;
      const usePrivacy = u?.privacy_mode === true;
      const targetTitle = usePrivacy ? "New Notification" : title;
      const targetBody = usePrivacy ? "Open the application to view content." : body;

      const message: any = {
        to: ut.push_token,
        sound: expoSound,
        title: targetTitle,
        body: targetBody,
        data: data ?? {},
        priority: expoPriority,
        channelId: expoChannelId,
      };

      if (!isSilent) {
        // Dynamic badge calculation: existing unread count + 1 for new notification
        const currentUnread = userUnreadCounts.get(ut.user_id) || 0;
        message.badge = currentUnread + 1;
      }
      if (categoryId) {
        message.categoryIdentifier = categoryId;
      }
      if (threadId) {
        message.threadId = threadId;
      }
      if (collapseKey) {
        message.collapseKey = collapseKey;
      }
      if (attachments) {
        message.attachments = attachments;
      }
      if (mutableContent) {
        message.mutableContent = mutableContent;
      }
      
      // ALWAYS force background wake-up and foreground display
      message.contentAvailable = true;
      message._displayInForeground = true;

      return message;
    });

    // Send in batches of 100 concurrently (Expo Push API recommendation)
    const BATCH_SIZE = 100;
    const batchPromises = [];
    const notifId = data?.id || data?.notification_id || `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const batchTokens = uniqueTokens.slice(i, i + BATCH_SIZE);

      batchPromises.push(
        (async () => {
          try {
            const response = await fetch("https://exp.host/--/api/v2/push/send", {
              method: "POST",
              headers: {
                "Accept": "application/json",
                "Accept-encoding": "gzip, deflate",
                "Content-Type": "application/json",
              },
              body: JSON.stringify(batch),
            });
            const responseJson = await response.json();
            return { responseJson, batch, batchTokens };
          } catch (err: any) {
            return { responseJson: { error: err.message }, batch, batchTokens };
          }
        })()
      );
    }

    const batchOutputs = await Promise.all(batchPromises);
    const results = [];
    const telemetryRecords = [];
    const historyRecords = [];

    for (const output of batchOutputs) {
      const { responseJson, batch, batchTokens } = output;
      results.push(responseJson);

      const ticketData = responseJson.data || [];
      for (let k = 0; k < batch.length; k++) {
        const msg = batch[k];
        const ticket = ticketData[k] || {};
        const ut = batchTokens[k];

        telemetryRecords.push({
          notification_id: notifId,
          user_id: ut.user_id,
          type: notifType || 'general',
          status: ticket.status === 'ok' ? 'sent' : 'failed',
          platform: 'unknown',
          expo_ticket_id: ticket.id || null,
          provider_status: ticket.status || null,
          provider_error: ticket.message || (ticket.details?.error) || null,
          push_token: ut.push_token
        });

        // Insert into unified history
        historyRecords.push({
          user_id: ut.user_id,
          notification_id: notifId,
          title: msg.title,
          body: msg.body,
          type: notifType || 'general',
          data: data ?? {},
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

    return new Response(
      JSON.stringify({ success: true, sent: uniqueTokens.length, total: userTokens.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("[Push] Error:", err.message);
    if (SENTRY_DSN) {
      Sentry.captureException(err);
    }
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
