import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PUSH_INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";

Deno.serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const now = new Date().toISOString();

    // 1. Process Scheduled Notifications
    const { data: scheduledAlerts } = await supabase
      .from("scheduled_notifications")
      .select("*")
      .eq("status", "pending")
      .lte("send_at", now)
      .limit(50);

    if (scheduledAlerts && scheduledAlerts.length > 0) {
      for (const alert of scheduledAlerts) {
        // Skip if expired
        if (alert.expires_at && new Date(alert.expires_at) <= new Date()) {
          await supabase
            .from("scheduled_notifications")
            .update({ status: "expired" })
            .eq("id", alert.id);
          continue;
        }

        // Insert into notification_jobs
        await supabase.from("notification_jobs").insert({
          notification_id: alert.id.toString(),
          target_user_ids: alert.target_user_ids,
          title: alert.title,
          body: alert.body,
          data: alert.data,
          status: "pending",
          next_retry_at: now
        });

        // Mark scheduled alert as sent
        await supabase
          .from("scheduled_notifications")
          .update({ status: "sent" })
          .eq("id", alert.id);
      }
    }

    // 2. Process Retry Jobs Queue
    const { data: dueJobs } = await supabase
      .from("notification_jobs")
      .select("*")
      .eq("status", "pending")
      .lte("next_retry_at", now)
      .limit(20);

    let processedCount = 0;

    if (dueJobs && dueJobs.length > 0) {
      const pushFunctionUrl = `${SUPABASE_URL}/functions/v1/push-notification`;

      for (const job of dueJobs) {
        processedCount++;
        try {
          // Update status to processing to prevent concurrent pick-ups
          await supabase
            .from("notification_jobs")
            .update({ status: "processing" })
            .eq("id", job.id);

          // Dispatch payload
          const res = await fetch(pushFunctionUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-secret": PUSH_INTERNAL_SECRET,
            },
            body: JSON.stringify({
              targetUserIds: job.target_user_ids,
              title: job.title,
              body: job.body,
              data: { ...job.data, notification_id: job.notification_id }
            })
          });

          if (!res.ok) {
            throw new Error(`Push function returned status ${res.status}`);
          }

          // Complete job
          await supabase
            .from("notification_jobs")
            .update({ status: "completed" })
            .eq("id", job.id);

        } catch (jobErr: any) {
          const nextRetryCount = job.retry_count + 1;
          const isFailedPermanently = nextRetryCount >= job.max_retry;
          
          // Exponential backoff: 30s * 2^retry_count
          const backoffSeconds = 30 * Math.pow(2, job.retry_count);
          const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

          await supabase
            .from("notification_jobs")
            .update({
              status: isFailedPermanently ? "failed" : "pending",
              retry_count: nextRetryCount,
              next_retry_at: nextRetryAt,
              last_error: jobErr.message,
              updated_at: new Date().toISOString()
            })
            .eq("id", job.id);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, scheduledProcessed: scheduledAlerts?.length || 0, retryProcessed: processedCount }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
