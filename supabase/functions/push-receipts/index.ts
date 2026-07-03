import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as Sentry from "https://esm.sh/@sentry/deno";

const SENTRY_DSN = Deno.env.get("SENTRY_DSN") || Deno.env.get("VITE_SENTRY_DSN") || "";
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 1.0,
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch pending sent tickets (last 24 hours)
    const timeLimit = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: pendingTelemetry, error: fetchErr } = await supabase
      .from("notification_telemetry")
      .select("user_id, notification_id, expo_ticket_id, push_token")
      .eq("status", "sent")
      .gt("created_at", timeLimit)
      .not("expo_ticket_id", "is", null)
      .limit(200);

    if (fetchErr) throw fetchErr;
    if (!pendingTelemetry || pendingTelemetry.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No pending tickets" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const ticketIds = pendingTelemetry.map(t => t.expo_ticket_id);

    // 2. Fetch receipts from Expo
    const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids: ticketIds }),
    });

    const responseJson = await response.json();
    const receipts = responseJson.data || {};

    const updates = [];
    const tokensToDelete = [];

    for (const record of pendingTelemetry) {
      const ticketId = record.expo_ticket_id;
      const receipt = receipts[ticketId];

      if (!receipt) continue;

      let newStatus = "sent";
      let providerError = null;
      let deliveredAt = null;
      let failedAt = null;

      if (receipt.status === "ok") {
        newStatus = "delivered";
        deliveredAt = new Date().toISOString();
      } else if (receipt.status === "error") {
        newStatus = "failed";
        failedAt = new Date().toISOString();
        providerError = receipt.details?.error || receipt.message || "Unknown error";

        // Auto cleanup invalid tokens
        if (providerError === "DeviceNotRegistered" || providerError === "InvalidCredentials") {
          tokensToDelete.push({ user_id: record.user_id, token: record.push_token });
        }
      }

      updates.push({
        user_id: record.user_id,
        notification_id: record.notification_id,
        status: newStatus,
        expo_receipt_id: ticketId,
        provider_status: receipt.status,
        provider_error: providerError,
        delivered_at: deliveredAt,
        failed_at: failedAt,
        updated_at: new Date().toISOString()
      });
    }

    // 3. Batch update telemetry
    if (updates.length > 0) {
      const { error: updateErr } = await supabase
        .from("notification_telemetry")
        .upsert(updates, { onConflict: "user_id,notification_id" });
      if (updateErr) throw updateErr;
    }

    // 4. Cleanup invalid tokens
    if (tokensToDelete.length > 0) {
      for (const t of tokensToDelete) {
        if (t.token) {
          // Delete only the specific invalid token from device list
          await supabase
            .from("user_push_tokens")
            .delete()
            .eq("push_token", t.token);

          // Check if user has any remaining tokens left
          const { data: remaining } = await supabase
            .from("user_push_tokens")
            .select("push_token")
            .eq("user_id", t.user_id);

          if (!remaining || remaining.length === 0) {
            // Update users table only if no remaining active tokens exist
            await supabase
              .from("users")
              .update({ push_token: null })
              .eq("id", t.user_id);
          }
        } else {
          // Fallback: delete by user_id if token is somehow null (stale telemetry)
          await supabase
            .from("user_push_tokens")
            .delete()
            .eq("user_id", t.user_id);

          await supabase
            .from("users")
            .update({ push_token: null })
            .eq("id", t.user_id);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, processed: updates.length, cleaned: tokensToDelete.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    if (SENTRY_DSN) {
      Sentry.captureException(err);
    }
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
