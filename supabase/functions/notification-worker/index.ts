import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

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

    // 1. Atomically promote due scheduled_notifications into notification_jobs
    const { data: promotedCount, error: promoteErr } = await supabase.rpc(
      "promote_due_scheduled_notifications",
      { p_limit: 50 }
    );
    if (promoteErr) {
      console.error("[Worker] promote_due_scheduled_notifications error:", promoteErr.message);
    }

    // 2. Atomically claim due or lease-expired jobs with FOR UPDATE SKIP LOCKED
    const { data: claimedJobs, error: claimErr } = await supabase.rpc(
      "claim_notification_jobs",
      { p_limit: 20, p_lease_seconds: 120 }
    );
    if (claimErr) {
      throw claimErr;
    }

    let processedCount = 0;
    let completedCount = 0;
    let retriedCount = 0;

    if (Array.isArray(claimedJobs) && claimedJobs.length > 0) {
      const pushFunctionUrl = `${SUPABASE_URL}/functions/v1/push-notification`;

      for (const job of claimedJobs) {
        processedCount++;
        const allTargetUsers: string[] = Array.isArray(job.target_user_ids)
          ? job.target_user_ids.map((id: any) => String(id)).filter(Boolean)
          : [];
        const existingRetryTokens: string[] | null =
          Array.isArray(job.retry_tokens) && job.retry_tokens.length > 0
            ? job.retry_tokens
            : null;

        if (allTargetUsers.length === 0) {
          const { error: emptyCompleteErr } = await supabase
            .from("notification_jobs")
            .update({
              status: "completed",
              retry_tokens: null,
              lease_token: null,
              lease_expires_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id)
            .eq("lease_token", job.lease_token);
          if (emptyCompleteErr) {
            console.error("[Worker] Failed marking empty job completed:", emptyCompleteErr.message);
          }
          completedCount++;
          continue;
        }

        const failedUserIdsSet = new Set<string>();
        const failedTokensSet = new Set<string>();
        const errorMessages: string[] = [];

        // Dispatch in chunks of 500 user IDs (matching push-notification's 500-user limit)
        const USER_CHUNK_SIZE = 500;
        for (let i = 0; i < allTargetUsers.length; i += USER_CHUNK_SIZE) {
          const userChunk = allTargetUsers.slice(i, i + USER_CHUNK_SIZE);

          try {
            const res = await fetch(pushFunctionUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-internal-secret": PUSH_INTERNAL_SECRET,
              },
              body: JSON.stringify({
                targetUserIds: userChunk,
                targetTokens: existingRetryTokens ?? undefined,
                title: job.title,
                body: job.body,
                data: { ...(job.data ?? {}), notification_id: job.notification_id },
              }),
            });

            let resJson: any = null;
            try {
              resJson = await res.json();
            } catch {
              resJson = null;
            }

            if (res.ok && resJson?.success === true && !resJson?.retryable) {
              continue;
            }

            const isRetryable =
              resJson?.retryable === true ||
              res.status === 429 ||
              res.status >= 500;

            if (isRetryable) {
              if (Array.isArray(resJson?.failedUserIds) && resJson.failedUserIds.length > 0) {
                for (const uid of resJson.failedUserIds) {
                  failedUserIdsSet.add(String(uid));
                }
              } else {
                for (const uid of userChunk) {
                  failedUserIdsSet.add(String(uid));
                }
              }

              if (Array.isArray(resJson?.failedTokens) && resJson.failedTokens.length > 0) {
                for (const tok of resJson.failedTokens) {
                  failedTokensSet.add(String(tok));
                }
              }

              errorMessages.push(
                resJson?.error || `Retryable push failure (HTTP ${res.status})`
              );
            } else if (!res.ok) {
              // Non-retryable 4xx error — log but do not retry endlessly
              console.error(
                `[Worker] Non-retryable push error for job ${job.id} (HTTP ${res.status}):`,
                resJson?.error || res.statusText
              );
            }
          } catch (fetchErr: any) {
            for (const uid of userChunk) {
              failedUserIdsSet.add(String(uid));
            }
            if (existingRetryTokens) {
              for (const tok of existingRetryTokens) {
                failedTokensSet.add(String(tok));
              }
            }
            errorMessages.push(fetchErr?.message || "Network error calling push-notification");
          }
        }

        if (failedUserIdsSet.size === 0 && failedTokensSet.size === 0) {
          const { error: completeErr } = await supabase
            .from("notification_jobs")
            .update({
              status: "completed",
              retry_tokens: null,
              lease_token: null,
              lease_expires_at: null,
              last_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id)
            .eq("lease_token", job.lease_token);

          if (completeErr) {
            console.error(`[Worker] Failed completing job ${job.id}:`, completeErr.message);
          } else {
            completedCount++;
          }
        } else {
          // Retry ONLY the failed recipients / device tokens
          const nextRetryCount = (Number(job.retry_count) || 0) + 1;
          const maxRetry = Number(job.max_retry) || 5;
          const isFailedPermanently = nextRetryCount >= maxRetry;
          const backoffSeconds = 30 * Math.pow(2, Number(job.retry_count) || 0);
          const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

          const remainingUserIds = Array.from(failedUserIdsSet);
          const remainingTokens = Array.from(failedTokensSet);

          const { error: retryUpdateErr } = await supabase
            .from("notification_jobs")
            .update({
              status: isFailedPermanently ? "failed" : "pending",
              target_user_ids: remainingUserIds.length > 0 ? remainingUserIds : allTargetUsers,
              retry_tokens: remainingTokens.length > 0 ? remainingTokens : null,
              retry_count: nextRetryCount,
              next_retry_at: nextRetryAt,
              last_error: errorMessages.join("; ").slice(0, 500),
              lease_token: null,
              lease_expires_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id)
            .eq("lease_token", job.lease_token);

          if (retryUpdateErr) {
            console.error(`[Worker] Failed updating retry state for job ${job.id}:`, retryUpdateErr.message);
          } else {
            retriedCount++;
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        scheduledPromoted: promotedCount || 0,
        jobsClaimed: processedCount,
        jobsCompleted: completedCount,
        jobsRetried: retriedCount,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[Worker] Unhandled error:", err.message);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
