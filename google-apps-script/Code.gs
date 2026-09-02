/**
 * CHURRASCARIA CARNE DE SOL — notificações administrativas por Gmail.
 * Publique como Web App: executar como você; acesso "Qualquer pessoa".
 * A senha de app do Google NÃO é usada nem armazenada aqui.
 */
const REQUIRED_PROPERTIES = ['WEBHOOK_SECRET', 'DESTINATION_EMAIL', 'SENDER_NAME', 'SITE_URL'];

function doGet() {
  return json_({ ok: true, service: 'carne-de-sol-mailer', time: new Date().toISOString() });
}

function testEmail() {
  validateProperties_();
  GmailApp.sendEmail(
    prop_('DESTINATION_EMAIL'),
    'Teste de e-mail — Churrascaria Carne de Sol',
    buildPlain_('test', {}),
    { htmlBody: buildHtml_('test', {}), name: prop_('SENDER_NAME'), noReply: true }
  );
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return json_({ ok: false, error: 'busy' });
  try {
    validateProperties_();
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!safeEqual_(String(body.secret || ''), prop_('WEBHOOK_SECRET'))) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    if (!['order_created', 'test'].includes(body.event)) {
      return json_({ ok: false, error: 'unsupported_event' });
    }
    enforceRateLimit_();
    const payload = body.payload || {};
    const subject = body.event === 'test'
      ? 'Teste de e-mail — Churrascaria Carne de Sol'
      : 'Novo pedido #' + clean_(payload.order_number || '—');
    const plain = buildPlain_(body.event, payload);
    const html = buildHtml_(body.event, payload);
    GmailApp.sendEmail(prop_('DESTINATION_EMAIL'), subject, plain, {
      htmlBody: html,
      name: prop_('SENDER_NAME'),
      noReply: true
    });
    return json_({ ok: true });
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: 'internal_error' });
  } finally {
    lock.releaseLock();
  }
}

function buildPlain_(eventName, p) {
  if (eventName === 'test') return 'Configuração de e-mail funcionando. Site: ' + prop_('SITE_URL');
  return [
    'Novo pedido #' + clean_(p.order_number || '—'),
    'Cliente: ' + clean_(p.customer_name || '—'),
    'Telefone: ' + clean_(p.phone || '—'),
    'Tipo: ' + clean_(p.order_type || '—'),
    'Total: ' + clean_(p.total || '—'),
    '',
    'Abra o painel: ' + prop_('SITE_URL') + '/admin.html'
  ].join('\n');
}

function buildHtml_(eventName, p) {
  const title = eventName === 'test' ? 'E-mail configurado' : 'Novo pedido #' + esc_(p.order_number || '—');
  const content = eventName === 'test'
    ? '<p>A integração do Gmail está funcionando.</p>'
    : '<p><b>Cliente:</b> ' + esc_(p.customer_name || '—') + '</p>' +
      '<p><b>Telefone:</b> ' + esc_(p.phone || '—') + '</p>' +
      '<p><b>Tipo:</b> ' + esc_(p.order_type || '—') + '</p>' +
      '<p><b>Total:</b> ' + esc_(p.total || '—') + '</p>';
  return '<div style="background:#f5eee7;padding:24px;font-family:Arial,sans-serif;color:#18120f">' +
    '<div style="max-width:560px;margin:auto;background:#fffdfa;border-radius:18px;overflow:hidden">' +
    '<div style="height:8px;background:#ff6b1a"></div><div style="padding:28px">' +
    '<img src="' + esc_(prop_('SITE_URL') + '/assets/logo-carne-de-sol.jpg') + '" width="96" height="96" alt="Churrascaria Carne de Sol" style="display:block;width:96px;height:96px;border-radius:20px"><h1 style="font-size:24px">' + title + '</h1>' + content +
    '<p><a href="' + esc_(prop_('SITE_URL') + '/admin.html') + '" style="display:inline-block;background:#ff6b1a;color:white;padding:14px 18px;border-radius:12px;text-decoration:none;font-weight:bold">Abrir painel</a></p>' +
    '</div></div></div>';
}

function enforceRateLimit_() {
  const cache = CacheService.getScriptCache();
  const minute = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmm');
  const key = 'mail-count-' + minute;
  const count = Number(cache.get(key) || 0);
  if (count >= 30) throw new Error('rate_limit');
  cache.put(key, String(count + 1), 120);
}

function validateProperties_() {
  const missing = REQUIRED_PROPERTIES.filter(function(key) { return !prop_(key); });
  if (missing.length) throw new Error('missing_properties:' + missing.join(','));
}
function prop_(key) { return PropertiesService.getScriptProperties().getProperty(key) || ''; }
function clean_(value) { return String(value).replace(/[\r\n\t]+/g, ' ').slice(0, 500); }
function esc_(value) { return clean_(value).replace(/[&<>"']/g, function(c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
function safeEqual_(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
