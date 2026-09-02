(() => {
  const url = "https://pghbhyvhfiwdpyykikff.supabase.co";
  const key = "sb_publishable_jDyNrXrAkQklE0LIcFkJgA_Y15cAEle";
  window.APP_CONFIG = Object.freeze({ supabaseUrl: url, supabaseKey: key, productionUrl: "https://churrascariacarnedosol.vercel.app" });
  window.db = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce" }
  });
  window.money = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
  window.escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" })[char]);
})();
