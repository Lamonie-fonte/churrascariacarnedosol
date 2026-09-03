import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SITE_URL = "https://churrascariacarnedosol.vercel.app";
const ALLOWED_ORIGINS = new Set([SITE_URL]);

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : SITE_URL,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST" || (origin && !ALLOWED_ORIGINS.has(origin))) return response(origin, { ok: false }, 403);

  try {
    const { email: rawEmail, mode: rawMode, fullName: rawName } = await req.json();
    const email = String(rawEmail || "").trim().toLowerCase();
    const mode = ["login", "signup", "recovery"].includes(String(rawMode)) ? String(rawMode) : "login";
    const fullName = String(rawName || "").trim().slice(0, 120);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response(origin, { ok: true });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: reserved, error: reserveError } = await serviceClient.rpc("reserve_auth_email_dispatch", { p_email: email });
    if (reserveError) throw reserveError;
    if (!reserved) return response(origin, { ok: true });

    // Use Supabase Auth itself to create and deliver the OTP. This intentionally
    // routes through Auth > SMTP Settings instead of maintaining a second SMTP
    // password and mutating the private auth.one_time_tokens table.
    const authClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error: otpError } = await authClient.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: mode === "signup",
        data: mode === "signup" ? { full_name: fullName } : undefined,
      },
    });
    if (otpError) {
      const expectedUnknownUser = mode !== "signup" && /signup|user.*not found|no user/i.test(otpError.message);
      if (expectedUnknownUser) return response(origin, { ok: true });
      console.error("request-auth-code", {
        mode,
        status: otpError.status,
        code: otpError.code,
        message: otpError.message,
      });
      throw otpError;
    }

    return response(origin, { ok: true });
  } catch (error) {
    console.error("request-auth-code-unexpected", error);
    return response(origin, { ok: false }, 503);
  }
});
