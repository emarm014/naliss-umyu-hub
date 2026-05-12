import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

Deno.serve(async (req) => {
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
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verify JWT if not internal call
  if (!isInternalCall && hasJwt) {
    const token = authHeader.replace("Bearer ", "");
    const verifyClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { error } = await verifyClient.auth.getUser(token);
    if (error) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const { targetUserIds, title, body, data } = await req.json();

    if (!targetUserIds || !Array.isArray(targetUserIds) || targetUserIds.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No targets" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch push tokens + ALL notification preferences
    const { data: users, error } = await supabase
      .from("users")
      .select("id, push_token, notif_messages, notif_announcements, notif_events, notif_materials")
      .in("id", targetUserIds)
      .eq("status", "active")
      .not("push_token", "is", null);

    if (error) throw error;
    if (!users || users.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No valid tokens" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter by each user's individual notification preferences
    // null/undefined = default ON (user hasn't changed it)
    const notifType = data?.type ?? "";
    const filteredUsers = users.filter(u => {
      if (notifType === "message") {
        // notif_messages: null = ON (default), false = OFF
        return u.notif_messages !== false;
      }
      if (notifType === "announcement") {
        return u.notif_announcements !== false;
      }
      if (notifType === "event") {
        // notif_events is its own separate preference
        return u.notif_events !== false;
      }
      if (notifType === "material") {
        return u.notif_materials !== false;
      }
      // Unknown type — send to everyone
      return true;
    });

    if (filteredUsers.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "All users opted out" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expoTokens = filteredUsers.map(u => u.push_token);

    // Send in batches of 100 (Expo Push API limit)
    const BATCH_SIZE = 100;
    const results = [];
    for (let i = 0; i < expoTokens.length; i += BATCH_SIZE) {
      const batch = expoTokens.slice(i, i + BATCH_SIZE);
      const message = {
        to: batch,
        sound: "default",
        title,
        body,
        data: data ?? {},
        priority: "high",
        channelId: "default",
        badge: 1,
      };

      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });

      results.push(await response.json());
    }

    return new Response(
      JSON.stringify({ success: true, sent: filteredUsers.length, total: users.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("[Push] Error:", err.message);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
