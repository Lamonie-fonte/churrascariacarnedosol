-- The supported bridge above replaces direct writes to auth.one_time_tokens.
drop function if exists public.override_auth_otp(text, text);
