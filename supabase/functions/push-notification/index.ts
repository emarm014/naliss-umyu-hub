import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";

const EXPO_TOKEN_REGEX = /^Expo(nent)?PushToken\[.+\]$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret, baggage, sentry-trace",
};

function timingSafeEqualStr(a: string, b: string): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

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
  const callerSecret = req.headers.get("x-internal-secret") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const isInternalCall = Boolean(INTERNAL_SECRET) && timingSafeEqualStr(callerSecret, INTERNAL_SECRET);
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
    const bodyJson = await req.json();
    const { targetUserIds, targetTokens, title, body, data } = bodyJson ?? {};

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

    const normalizedTargetUserIds = Array.from(
      new Set(targetUserIds.map((id: any) => String(id || "").trim()).filter(Boolean))
    );

    if (normalizedTargetUserIds.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "No valid targetUserIds provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const notifType = String(data?.type ?? "").trim();

    // Authorization & Security Checks for Non-Internal (Authenticated User) Requests
    if (!isInternalCall && senderUser) {
      // 1. Sender Active Status & Role Check
      const { data: senderProfile, error: profileErr } = await supabase
        .from("users")
        .select("status, role")
        .eq("id", senderUser.id)
        .single();

      if (profileErr || !senderProfile || senderProfile.status !== "active") {
        return new Response(JSON.stringify({ success: false, error: "Forbidden: Account is inactive or restricted" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const isAdminOrMod = ["super_admin", "system_owner", "moderator"].includes(senderProfile.role);

      // 2. Strict notification type & recipient authorization
      const adminOnlyTypes = new Set([
        "announcement",
        "event",
        "material",
        "resource",
        "quiz",
        "assignment",
        "security",
        "system",
        "featured_student",
        "silent_sync",
        "application",
      ]);

      const studentAllowedTypes = new Set([
        "message",
        "fyb_congratulation",
        "fyb_appreciation",
      ]);

      if (!notifType || (!adminOnlyTypes.has(notifType) && !studentAllowedTypes.has(notifType))) {
        return new Response(JSON.stringify({ success: false, error: "Forbidden: Unsupported or missing notification type" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (adminOnlyTypes.has(notifType) && !isAdminOrMod) {
        return new Response(JSON.stringify({ success: false, error: "Forbidden: Elevated privileges required for this notification type" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (notifType === "message") {
        const groupId = String(data?.group_id || "").trim();
        if (!groupId) {
          return new Response(JSON.stringify({ success: false, error: "Forbidden: group_id is required for message notifications" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: senderMember, error: senderMemberErr } = await supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", groupId)
          .eq("user_id", senderUser.id)
          .maybeSingle();

        if (senderMemberErr || !senderMember) {
          return new Response(JSON.stringify({ success: false, error: "Forbidden: Sender is not a member of this conversation" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Verify all recipients belong to the same conversation
        const { data: groupRecipients, error: groupRecipErr } = await supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", groupId)
          .in("user_id", normalizedTargetUserIds);

        if (groupRecipErr) {
          return new Response(JSON.stringify({ success: false, error: "Failed to verify conversation recipients" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const validMemberSet = new Set((groupRecipients || []).map((r: any) => String(r.user_id)));
        const hasUnauthorizedRecipient = normalizedTargetUserIds.some(uid => !validMemberSet.has(uid));
        if (hasUnauthorizedRecipient) {
          return new Response(JSON.stringify({ success: false, error: "Forbidden: Target users must belong to the conversation" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else if (notifType === "fyb_congratulation" && !isAdminOrMod) {
        const featuredStudentId = String(data?.featured_student_id || "").trim();
        if (normalizedTargetUserIds.length !== 1 || !featuredStudentId) {
          return new Response(JSON.stringify({ success: false, error: "Forbidden: Invalid congratulation notification target" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: featuredRow, error: featuredErr } = await supabase
          .from("featured_students")
          .select("id, user_id")
          .eq("id", featuredStudentId)
          .eq("user_id", normalizedTargetUserIds[0])
          .maybeSingle();

        if (featuredErr || !featuredRow) {
          return new Response(JSON.stringify({ success: false, error: "Forbidden: Target user is not the featured student" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else if (notifType === "fyb_appreciation" && !isAdminOrMod) {
        if (normalizedTargetUserIds.length !== 1) {
          return new Response(JSON.stringify({ success: false, error: "Forbidden: Appreciation can only target one user at a time" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: myFeatured, error: myFeatErr } = await supabase
          .from("featured_students")
          .select("id")
          .eq("user_id", senderUser.id);

        const featuredIds = (myFeatured || []).map((f: any) => f.id);
        if (myFeatErr || featuredIds.length === 0) {
          return new Response(JSON.stringify({ success: false, error: "Forbidden: Only a featured student can send appreciation" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: congratsRow, error: congratsErr } = await supabase
          .from("student_congratulations")
          .select("id")
          .in("featured_student_id", featuredIds)
          .eq("user_id", normalizedTargetUserIds[0])
          .limit(1)
          .maybeSingle();

        if (congratsErr || !congratsRow) {
          return new Response(JSON.stringify({ success: false, error: "Forbidden: Target user has not congratulated you" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // 3. Rate Limiting: Max 30 push calls per 60s per sender (tracked via push_send_audit)
      const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
      const { count: recentCount, error: rateErr } = await supabase
        .from("push_send_audit")
        .select("*", { count: "exact", head: true })
        .eq("sender_id", senderUser.id)
        .gte("created_at", oneMinuteAgo);

      if (rateErr) {
        console.error("[Push] Rate limit check error:", rateErr.message);
      } else if (recentCount !== null && recentCount >= 30) {
        return new Response(JSON.stringify({ success: false, error: "Rate limit exceeded: Please wait before sending more notifications" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: auditInsertErr } = await supabase
        .from("push_send_audit")
        .insert({
          sender_id: senderUser.id,
          notif_type: notifType,
          recipient_count: normalizedTargetUserIds.length,
        });

      if (auditInsertErr) {
        console.error("[Push] Audit insert error:", auditInsertErr.message);
      }
    }

    // Fetch push tokens + ALL notification preferences from user_push_tokens + users
    let tokenQuery = supabase
      .from("user_push_tokens")
      .select("user_id, push_token, users!inner(status, notif_enabled, notif_messages, notif_announcements, notif_events, notif_materials, notif_quizzes, notif_assignments, notif_security, notif_system, privacy_mode, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, muted_groups)")
      .in("user_id", normalizedTargetUserIds)
      .eq("users.status", "active");

    // When retrying from notification-worker, restrict to the failed tokens if specified
    if (isInternalCall && Array.isArray(targetTokens) && targetTokens.length > 0) {
      tokenQuery = tokenQuery.in("push_token", targetTokens);
    }

    const { data: userTokens, error: tokenFetchErr } = await tokenQuery;

    if (tokenFetchErr) throw tokenFetchErr;
    if (!userTokens || userTokens.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, message: "No active push tokens found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter by valid Expo token format & each user's individual notification preferences
    const targetGroupId = data?.group_id || data?.id || "";

    const filteredTokens = userTokens.filter((ut: any) => {
      if (!ut.push_token || !EXPO_TOKEN_REGEX.test(String(ut.push_token))) {
        return false;
      }
      const u = ut.users;
      if (!u) return false;

      // 1. Global Notification Toggle
      if (u.notif_enabled === false) return false;

      // 2. Granular Category Controls
      if (notifType === "message" && u.notif_messages === false) return false;
      if (notifType === "announcement" && u.notif_announcements === false) return false;
      if (notifType === "event" && u.notif_events === false) return false;
      if ((notifType === "material" || notifType === "resource") && u.notif_materials === false) return false;
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
      return new Response(JSON.stringify({ success: true, sent: 0, message: "All users opted out or had no valid Expo tokens" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Duplicate protection using deterministic hash per device token
    const uniqueTokens: any[] = [];
    const processedHashes = new Set<string>();
    const entityId = data?.id || data?.group_id || data?.pool_id || "general";

    for (const ut of filteredTokens) {
      const hash = await generateHash(ut.push_token, notifType, String(entityId));
      if (!processedHashes.has(hash)) {
        processedHashes.add(hash);
        uniqueTokens.push(ut);
      }
    }

    // Keep one ID for the push ticket, history row, and app-side deduplication.
    const notifId = String(
      data?.notification_id ||
      data?.id ||
      `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    );

    // Map custom priorities & high-importance Android channels
    const payloadPriority = data?.priority ?? "high";
    let expoPriority: "default" | "normal" | "high" = "high";
    let expoSound: string | null = "default";

    let expoChannelId = "general";
    if (notifType === "message") {
      expoChannelId = "messages_v2";
    } else if (notifType === "announcement") {
      expoChannelId = "announcements_v2";
    } else if (notifType === "event" || notifType === "quiz" || notifType === "assignment") {
      expoChannelId = "events_v1";
    } else if (notifType === "fyb_congratulation" || notifType === "fyb_appreciation" || notifType === "featured_student") {
      expoChannelId = "featured";
    } else if (notifType === "security") {
      expoChannelId = "critical_security";
    }

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
    } else if (payloadPriority === "normal" && expoChannelId === "general") {
      expoPriority = "default";
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
        threadId = `chat_${data?.group_id || "general"}`;
      } else {
        threadId = `${notifType}s`;
      }
    }

    // Android Collapse Keys
    let collapseKey = data?.collapseKey ?? null;
    if (!collapseKey && notifType) {
      collapseKey = `${notifType}_${entityId}`;
    }

    // Rich Media (Android BigPicture via richContent.image + iOS via attachments)
    const isLikelyImageUrl = (url: unknown): url is string => {
      if (typeof url !== "string" || !url.startsWith("http")) return false;
      const lower = url.split("?")[0].toLowerCase();
      if (lower.endsWith(".pdf") || lower.endsWith(".doc") || lower.endsWith(".docx") || lower.endsWith(".ppt") || lower.endsWith(".pptx") || lower.endsWith(".xls") || lower.endsWith(".xlsx") || lower.endsWith(".zip") || lower.endsWith(".mp3") || lower.endsWith(".m4a") || lower.endsWith(".wav") || lower.endsWith(".mp4") || lower.endsWith(".mov")) {
        return false;
      }
      return true;
    };

    const rawCandidateUrl =
      data?.cover_image_url ||
      data?.image_url ||
      (isLikelyImageUrl(data?.file_url) ? data?.file_url : null) ||
      data?.avatar_url ||
      null;
    const imageUrl = isLikelyImageUrl(rawCandidateUrl) ? rawCandidateUrl : null;
    const attachments = imageUrl ? [{ url: imageUrl }] : undefined;
    const mutableContent = attachments ? true : undefined;

    // Fetch current unread count per target user via aggregated RPC
    const userUnreadCounts = new Map<string, number>();
    const uniqueUserIds = Array.from(new Set(uniqueTokens.map((ut) => String(ut.user_id))));
    try {
      const { data: unreadRows, error: unreadErr } = await supabase.rpc(
        "get_unread_notification_counts",
        { p_user_ids: uniqueUserIds }
      );
      if (unreadErr) {
        console.warn("[Push] get_unread_notification_counts fallback:", unreadErr.message);
      } else if (Array.isArray(unreadRows)) {
        for (const row of unreadRows) {
          if (row.user_id) {
            userUnreadCounts.set(String(row.user_id), Number(row.unread_count) || 0);
          }
        }
      }
    } catch (unreadEx: any) {
      console.warn("[Push] Unread count RPC exception:", unreadEx?.message);
    }

    // Build message objects list (one message per device token)
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
        data: { ...(data ?? {}), notification_id: notifId },
        priority: expoPriority,
        channelId: expoChannelId,
      };

      if (!isSilent) {
        const currentUnread = userUnreadCounts.get(String(ut.user_id)) || 0;
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
      if (!usePrivacy && imageUrl) {
        message.richContent = { image: imageUrl };
      }
      if (!usePrivacy && attachments) {
        message.attachments = attachments;
      }
      if (!usePrivacy && mutableContent) {
        message.mutableContent = mutableContent;
      }

      message.contentAvailable = true;
      message._displayInForeground = true;

      return message;
    });

    // Send in batches of 100 concurrently (Expo Push API recommendation)
    const BATCH_SIZE = 100;
    const batchPromises = [];
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
            const status = response.status;
            const ok = response.ok;
            let responseJson: any = null;
            try {
              responseJson = await response.json();
            } catch {
              responseJson = { error: `Non-JSON response from Expo (HTTP ${status})` };
            }
            return { ok, status, responseJson, batch, batchTokens, networkError: false };
          } catch (err: any) {
            return {
              ok: false,
              status: 0,
              responseJson: { error: err?.message || "Network error" },
              batch,
              batchTokens,
              networkError: true,
            };
          }
        })()
      );
    }

    const batchOutputs = await Promise.all(batchPromises);
    const results = [];
    const telemetryMap = new Map<string, any>();
    const historyMap = new Map<string, any>();
    const retryableFailedTokens: string[] = [];
    const retryableFailedUserIds = new Set<string>();
    const tokensToRemove = new Set<string>();
    let sentCount = 0;
    const nowIso = new Date().toISOString();

    for (const output of batchOutputs) {
      const { ok, status, responseJson, batch, batchTokens, networkError } = output;
      results.push({ status, response: responseJson });

      const ticketData = Array.isArray(responseJson?.data) ? responseJson.data : null;
      const isBatchRetryableHttp = networkError || status === 429 || status >= 500;

      if (!ok || !ticketData) {
        const batchErrMsg =
          responseJson?.errors?.[0]?.message ||
          responseJson?.error ||
          `Expo HTTP ${status}`;

        for (let k = 0; k < batch.length; k++) {
          const ut = batchTokens[k];
          const telKey = `${ut.user_id}:${notifId}:${ut.push_token}`;
          telemetryMap.set(telKey, {
            notification_id: notifId,
            user_id: ut.user_id,
            type: notifType || "general",
            status: "failed",
            platform: "unknown",
            expo_ticket_id: null,
            provider_status: "error",
            provider_error: batchErrMsg,
            push_token: ut.push_token,
            failed_at: nowIso,
            updated_at: nowIso,
          });

          if (isBatchRetryableHttp) {
            retryableFailedTokens.push(ut.push_token);
            retryableFailedUserIds.add(String(ut.user_id));
          }
        }
        continue;
      }

      for (let k = 0; k < batch.length; k++) {
        const ticket = ticketData[k] || {};
        const ut = batchTokens[k];
        const isTicketOk = ticket.status === "ok";
        const errCode = ticket.details?.error || ticket.message || null;

        if (isTicketOk) {
          sentCount++;
        } else {
          if (errCode === "DeviceNotRegistered") {
            tokensToRemove.add(ut.push_token);
          } else if (errCode === "InvalidCredentials") {
            console.error("[Push] CRITICAL: Expo reported InvalidCredentials (FCM/APNs server key issue). Token will NOT be deleted.");
          } else if (
            errCode === "MessageRateExceeded" ||
            errCode === "TooManyRequests" ||
            !ticket.status
          ) {
            retryableFailedTokens.push(ut.push_token);
            retryableFailedUserIds.add(String(ut.user_id));
          }
        }

        const telKey = `${ut.user_id}:${notifId}:${ut.push_token}`;
        telemetryMap.set(telKey, {
          notification_id: notifId,
          user_id: ut.user_id,
          type: notifType || "general",
          status: isTicketOk ? "sent" : "failed",
          platform: "unknown",
          expo_ticket_id: ticket.id || null,
          provider_status: ticket.status || "error",
          provider_error: isTicketOk ? null : (errCode || "TicketError"),
          push_token: ut.push_token,
          failed_at: isTicketOk ? null : nowIso,
          updated_at: nowIso,
        });

        // Insert into unified history ONCE per (user_id, notification_id) (skip chats/messages)
        if (notifType !== "message" && notifType !== "chat") {
          const histKey = `${ut.user_id}:${notifId}`;
          if (!historyMap.has(histKey)) {
            historyMap.set(histKey, {
              user_id: ut.user_id,
              notification_id: notifId,
              title: title || "New Notification",
              body: body || "",
              type: notifType || "general",
              data: data ?? {},
              is_read: false,
            });
          }
        }
      }
    }

    // Remove unregistered device tokens (DeviceNotRegistered only)
    if (tokensToRemove.size > 0) {
      for (const badToken of tokensToRemove) {
        const { error: rmErr } = await supabase.rpc("remove_push_token", { p_token: badToken });
        if (rmErr) {
          console.error("[Push] remove_push_token error:", rmErr.message);
        }
      }
    }

    const telemetryRecords = Array.from(telemetryMap.values());
    if (telemetryRecords.length > 0) {
      const { error: telErr } = await supabase
        .from("notification_telemetry")
        .upsert(telemetryRecords, { onConflict: "user_id,notification_id,push_token" });
      if (telErr) {
        console.error("[Push] notification_telemetry upsert error:", telErr.message);
      }
    }

    const historyRecords = Array.from(historyMap.values());
    if (historyRecords.length > 0) {
      const { error: histErr } = await supabase
        .from("notification_history")
        .upsert(historyRecords, { onConflict: "user_id,notification_id" });
      if (histErr) {
        console.error("[Push] notification_history upsert error:", histErr.message);
      }
    }

    const hasRetryableFailures = retryableFailedTokens.length > 0;
    const responseStatus = sentCount === 0 && hasRetryableFailures ? 503 : 200;

    return new Response(
      JSON.stringify({
        success: !hasRetryableFailures,
        partialFailure: sentCount > 0 && hasRetryableFailures,
        retryable: hasRetryableFailures,
        sent: sentCount,
        total: uniqueTokens.length,
        failedTokens: retryableFailedTokens,
        failedUserIds: Array.from(retryableFailedUserIds),
        cleanedTokens: tokensToRemove.size,
        results,
      }),
      {
        status: responseStatus,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("[Push] Error:", err.message);
    return new Response(JSON.stringify({ success: false, retryable: true, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
