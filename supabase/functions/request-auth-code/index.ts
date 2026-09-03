import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import nodemailer from "npm:nodemailer@7.0.6";

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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] || char);
}

function emailHtml(code: string, mode: string) {
  const title = mode === "signup" ? "Confirme seu cadastro" : mode === "recovery" ? "Recuperação de acesso" : "Seu código de acesso";
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f5eee7;font-family:Arial,sans-serif;color:#18120f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" style="max-width:560px;background:#fffdfa;border-radius:20px;border:1px solid #eaded2"><tr><td style="height:8px;background:#ff6b1a"></td></tr><tr><td align="center" style="padding:34px 26px"><img src="${SITE_URL}/assets/logo-carne-de-sol.jpg" width="112" height="112" alt="Churrascaria Carne de Sol" style="display:block;width:112px;height:112px;border:0;border-radius:22px"><h1 style="font-size:24px">${title}</h1><p>Digite no site este código numérico:</p><div style="display:inline-block;padding:18px 24px;border-radius:14px;background:#18120f;color:#fff;font-size:34px;font-weight:bold;letter-spacing:10px">${escapeHtml(code)}</div><p style="color:#766b65;font-size:13px">O código tem exatamente 6 dígitos, expira por segurança e só pode ser usado uma vez.</p><p style="color:#766b65;font-size:13px">Se você não solicitou este código, ignore esta mensagem.</p></td></tr></table></td></tr></table></body></html>`;
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

    // generateLink creates the official Auth token without sending Supabase's
    // default link email. Delivery is handled below by the branded OTP email.
    // bcrypt only accepts passwords up to 72 bytes. One UUID keeps the
    // technical password random while remaining safely below that limit.
    const generatedPassword = `Cs1!${crypto.randomUUID()}`;
    const linkRequest = mode === "signup"
      ? {
          type: "signup" as const,
          email,
          password: generatedPassword,
          options: { data: { full_name: fullName }, redirectTo: SITE_URL },
        }
      : mode === "recovery"
        ? { type: "recovery" as const, email, options: { redirectTo: SITE_URL } }
        : { type: "magiclink" as const, email, options: { redirectTo: SITE_URL } };
    let { data: link, error: linkError } = await serviceClient.auth.admin.generateLink(linkRequest);
    let verificationType = mode === "recovery" ? "recovery" : "email";
    if (mode === "signup" && (linkError || !link?.properties?.hashed_token)) {
      // A previous failed signup can leave the address registered but not
      // confirmed. In that case, issue a magic-link token and send its OTP
      // instead of making the customer delete the half-created account.
      const fallback = await serviceClient.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: SITE_URL },
      });
      link = fallback.data;
      linkError = fallback.error;
      verificationType = "email";
    }
    if (linkError || !link?.properties?.hashed_token) {
      console.error("auth-link-generation", { mode, status: linkError?.status, code: linkError?.code });
      return response(origin, { ok: true });
    }

    const { data: mailConfig, error: configError } = await serviceClient.rpc("get_auth_mail_config");
    if (configError || !mailConfig?.[0]?.smtp_user || !mailConfig?.[0]?.smtp_password) throw configError || new Error("mail_config_missing");

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: mailConfig[0].smtp_user, pass: mailConfig[0].smtp_password },
    });
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const code = String(random[0] % 1_000_000).padStart(6, "0");
    const { data: stored, error: storeError } = await serviceClient.rpc("store_auth_email_code", {
      p_email: email,
      p_code: code,
      p_token_hash: link.properties.hashed_token,
      p_verification_type: verificationType,
    });
    if (storeError || !stored) throw storeError || new Error("otp_store_failed");

    const subject = mode === "signup" ? "Confirme seu cadastro — Churrascaria Carne de Sol" : mode === "recovery" ? "Recupere seu acesso — Churrascaria Carne de Sol" : "Seu código de acesso — Churrascaria Carne de Sol";
    await transporter.sendMail({
      from: `"CHURRASCARIA CARNE DE SOL" <${mailConfig[0].smtp_user}>`,
      to: email,
      subject,
      text: `${subject}\n\nCódigo: ${code}\n\nO código tem exatamente 6 dígitos e só pode ser usado uma vez.`,
      html: emailHtml(code, mode),
    });

    return response(origin, { ok: true, verificationType });
  } catch (error) {
    console.error("request-auth-code-unexpected", error);
    return response(origin, { ok: false }, 503);
  }
});
