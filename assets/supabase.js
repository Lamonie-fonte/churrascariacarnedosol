(() => {
  const url = "https://pghbhyvhfiwdpyykikff.supabase.co";
  const key = "sb_publishable_jDyNrXrAkQklE0LIcFkJgA_Y15cAEle";
  window.APP_CONFIG = Object.freeze({ supabaseUrl: url, supabaseKey: key, productionUrl: "https://churrascariacarnedosol.vercel.app" });
  window.db = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce" }
  });
  window.requestAuthCodeReliable = async body => {
    let result = { data: null, error: new Error("auth_code_request_failed") };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { result = await window.db.functions.invoke("request-auth-code", { body }); }
      catch (error) { result = { data: null, error }; }
      if (!result.error && result.data?.ok === true) return result;
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 900));
    }
    return result;
  };
  window.money = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
  window.escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" })[char]);
})();
