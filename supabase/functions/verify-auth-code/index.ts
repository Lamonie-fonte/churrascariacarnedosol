import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SITE_URL = "https://churrascariacarnedosol.vercel.app";
const ALLOWED_ORIGINS = new Set([SITE_URL]);

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : SITE_URL,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

function response(origin: string | null, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST" || (origin && !ALLOWED_ORIGINS.has(origin))) return response(origin, { ok: false }, 403);

  try {
    const { email: rawEmail, code: rawCode } = await req.json();
    const email = String(rawEmail || "").trim().toLowerCase();
    const code = String(rawCode || "").replace(/\D/g, "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
      return response(origin, { ok: false }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: ticket, error: ticketError } = await serviceClient.rpc("consume_auth_email_code", {
      p_email: email,
      p_code: code,
    });
    if (ticketError) throw ticketError;
    if (!ticket?.verification_type) {
      console.warn("auth-code-rejected", { duration_ms: Date.now() - startedAt });
      return response(origin, { ok: false }, 400);
    }

    // A resend invalidates Supabase Auth's previously generated token. Create
    // and immediately exchange a fresh official token only after the branded
    // six-digit code has been validated. This keeps delayed emails usable.
    const recovery = ticket.verification_type === "recovery";
    const { data: freshLink, error: freshLinkError } = await serviceClient.auth.admin.generateLink({
      type: recovery ? "recovery" : "magiclink",
      email,
      options: { redirectTo: SITE_URL },
    });
    if (freshLinkError || !freshLink?.properties?.hashed_token) {
      console.error("fresh-auth-token", { status: freshLinkError?.status, code: freshLinkError?.code });
      return response(origin, { ok: false }, 503);
    }

    const authClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const type = recovery ? "recovery" : "email";
    const { data, error } = await authClient.auth.verifyOtp({
      token_hash: freshLink.properties.hashed_token,
      type,
    });
    if (error || !data.session) {
      console.error("official-auth-token", { status: error?.status, code: error?.code });
      return response(origin, { ok: false }, 400);
    }

    console.log("auth-code-verified", { duration_ms: Date.now() - startedAt, type });
    return response(origin, {
      ok: true,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch (error) {
    console.error("verify-auth-code-unexpected", error);
    return response(origin, { ok: false }, 503);
  }
});
