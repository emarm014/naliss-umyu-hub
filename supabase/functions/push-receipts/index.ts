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
const PUSH_INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200 });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify shared internal secret
  const callerSecret = req.headers.get("x-internal-secret") ?? "";
  if (!PUSH_INTERNAL_SECRET || !timingSafeEqualStr(callerSecret, PUSH_INTERNAL_SECRET)) {
    return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch pending sent tickets (last 24 hours) including type and push_token
    const timeLimit = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: pendingTelemetry, error: fetchErr } = await supabase
      .from("notification_telemetry")
      .select("id, user_id, notification_id, type, status, expo_ticket_id, push_token")
      .eq("status", "sent")
      .gt("created_at", timeLimit)
      .not("expo_ticket_id", "is", null)
      .limit(200);

    if (fetchErr) throw fetchErr;
    if (!pendingTelemetry || pendingTelemetry.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0, message: "No pending tickets" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const ticketIds = Array.from(
      new Set(pendingTelemetry.map((t: any) => t.expo_ticket_id).filter(Boolean))
    );

    // 2. Fetch receipts from Expo
    const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids: ticketIds }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Expo getReceipts returned HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    const responseJson = await response.json();
    const receipts = responseJson?.data || {};

    const updatesMap = new Map<string, any>();
    const tokensToDelete = new Set<string>();
    const nowIso = new Date().toISOString();

    for (const record of pendingTelemetry) {
      const ticketId = record.expo_ticket_id;
      const receipt = receipts[ticketId];

      if (!receipt) continue;

      let newStatus = record.status || "sent";
      let providerError: string | null = null;
      let deliveredAt: string | null = null;
      let failedAt: string | null = null;

      if (receipt.status === "ok") {
        // Preserve "opened" if user already tapped the notification before receipt check
        newStatus = record.status === "opened" ? "opened" : "delivered";
        deliveredAt = nowIso;
      } else if (receipt.status === "error") {
        newStatus = "failed";
        failedAt = nowIso;
        providerError = receipt.details?.error || receipt.message || "Unknown error";

        // Delete tokens ONLY on DeviceNotRegistered, NEVER on InvalidCredentials
        if (providerError === "DeviceNotRegistered") {
          if (record.push_token) {
            tokensToDelete.add(String(record.push_token));
          }
        } else if (providerError === "InvalidCredentials") {
          const credErr = new Error("[PushReceipts] CRITICAL: Expo reported InvalidCredentials (server FCM/APNs credentials invalid). User push tokens preserved.");
          console.error(credErr.message);
          if (SENTRY_DSN) {
            Sentry.captureException(credErr);
          }
        }
      }

      const pushTokenVal = String(record.push_token || "");
      const key = `${record.user_id}:${record.notification_id}:${pushTokenVal}`;
      updatesMap.set(key, {
        user_id: record.user_id,
        notification_id: record.notification_id,
        type: record.type || "general",
        push_token: pushTokenVal,
        status: newStatus,
        expo_ticket_id: ticketId,
        expo_receipt_id: ticketId,
        provider_status: receipt.status,
        provider_error: providerError,
        delivered_at: deliveredAt,
        failed_at: failedAt,
        updated_at: nowIso,
      });
    }

    // 3. Batch update telemetry per device
    const updates = Array.from(updatesMap.values());
    if (updates.length > 0) {
      const { error: updateErr } = await supabase
        .from("notification_telemetry")
        .upsert(updates, { onConflict: "user_id,notification_id,push_token" });
      if (updateErr) throw updateErr;
    }

    // 4. Cleanup unregistered device tokens via remove_push_token RPC
    let cleanedCount = 0;
    if (tokensToDelete.size > 0) {
      for (const badToken of tokensToDelete) {
        const { error: rmErr } = await supabase.rpc("remove_push_token", { p_token: badToken });
        if (rmErr) {
          console.error("[PushReceipts] remove_push_token error:", rmErr.message);
        } else {
          cleanedCount++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: updates.length,
        cleaned: cleanedCount,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[PushReceipts] Error:", err.message);
    if (SENTRY_DSN) {
      Sentry.captureException(err);
    }
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
