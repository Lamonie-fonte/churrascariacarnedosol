import { readFile, readdir, stat } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("data/catalog.json", root), "utf8"));
const styles = await readFile(new URL("assets/styles.css", root), "utf8");
const app = await readFile(new URL("assets/app.js", root), "utf8");
const admin = await readFile(new URL("assets/admin.js", root), "utf8");
const receipts = await readFile(new URL("assets/receipts.js", root), "utf8");
const storeHtml = await readFile(new URL("index.html", root), "utf8");
const adminHtml = await readFile(new URL("admin.html", root), "utf8");
const iconSprite = await readFile(new URL("assets/icons.svg", root), "utf8");
const authFunction = await readFile(new URL("supabase/functions/request-auth-code/index.ts", root), "utf8");
const verifyAuthFunction = await readFile(new URL("supabase/functions/verify-auth-code/index.ts", root), "utf8");
const keepAliveWorkflow = await readFile(new URL(".github/workflows/manter-supabase-ativo.yml", root), "utf8");
const productFiles = await readdir(new URL("products/", root));
const expected = new Set(catalog.map(item => item.image_url.split("/").pop()));
const missing = [...expected].filter(name => !productFiles.includes(name));
const empty = [];
for (const name of productFiles) if ((await stat(new URL(`products/${name}`, root))).size === 0) empty.push(name);

if (catalog.length !== 88) throw new Error(`Esperados 88 produtos; encontrados ${catalog.length}.`);
if (expected.size !== 83) throw new Error(`Esperadas 83 imagens únicas; encontradas ${expected.size}.`);
if (missing.length) throw new Error(`Imagens ausentes: ${missing.join(", ")}`);
if (empty.length) throw new Error(`Imagens vazias: ${empty.join(", ")}`);

const options = catalog.flatMap(item => item.option_groups.flatMap(group => group.options));
if (options.length !== 304) throw new Error(`Esperadas 304 opções; encontradas ${options.length}.`);
if (!styles.includes("height:calc(100dvh - 16px)")) throw new Error("O modal móvel não acompanha a altura visível da tela.");
if (!styles.includes("overflow-y:auto;overscroll-behavior:contain")) throw new Error("A rolagem do modal móvel não está ativa.");
if (!styles.includes("object-fit:contain")) throw new Error("As imagens dos produtos podem ser recortadas.");
if (!styles.includes(".quantity-row{position:sticky;bottom:0")) throw new Error("A barra de adicionar não está presa à base do modal.");
if (!app.includes("requestAnimationFrame") || !/scrollTop\s*=\s*0/.test(app)) throw new Error("O modal não volta ao início ao abrir outro produto.");
if (!authFunction.includes("auth.admin.generateLink") || !authFunction.includes("password: generatedPassword")) throw new Error("O cadastro não gera o OTP oficial com uma senha técnica válida.");
if (!authFunction.includes('import("npm:nodemailer@7.0.6")') || !authFunction.includes('rpc("store_auth_email_code"')) throw new Error("O envio personalizado de seis dígitos não está ativo.");
if (authFunction.includes("auth.signInWithOtp")) throw new Error("O envio ainda pode usar o template padrão com link.");
if (!authFunction.includes('verificationType = mode === "recovery" ? "recovery" : "email"') || !authFunction.includes('type: "magiclink"')) throw new Error("O cadastro incompleto não recebe um novo OTP.");
if (!verifyAuthFunction.includes('rpc("consume_auth_email_code"') || !verifyAuthFunction.includes("auth.verifyOtp") || !verifyAuthFunction.includes("access_token")) throw new Error("A troca segura do código pela sessão oficial não está ativa.");
if (!app.includes('db.functions.invoke("verify-auth-code"') || !admin.includes('db.functions.invoke("verify-auth-code"')) throw new Error("Loja e painel não usam o verificador de seis dígitos.");
if (!app.includes("db.auth.setSession") || !admin.includes("db.auth.setSession")) throw new Error("A sessão oficial não é persistida após validar o código.");
if (!app.includes("/^\\d{6}$/") || !admin.includes("/^\\d{6}$/")) throw new Error("As telas não exigem exatamente seis dígitos.");
if (!storeHtml.includes('pattern="[0-9]{6}" minlength="6" maxlength="6"') || !adminHtml.includes('minlength="6" maxlength="6" pattern="[0-9]{6}"')) throw new Error("Os campos de OTP não estão limitados a seis dígitos.");
if (!storeHtml.includes('id="checkoutCep"') || !app.includes("https://viacep.com.br/ws/")) throw new Error("A busca automática de endereço pelo CEP não está ativa.");
if (!/postal_code:\s*formatCep/.test(app) || !/city:\s*data\.city/.test(app) || !/state:\s*data\.state\.toUpperCase\(\)/.test(app) || !admin.includes("fullAddress")) throw new Error("O endereço completo não está sendo enviado e exibido no pedido.");
if ((storeHtml.match(/data-password-toggle=/g)||[]).length !== 2 || !storeHtml.includes('id="confirmPassword"')) throw new Error("Os campos de senha não têm confirmação e botão de visualização.");
if (!/password\s*!==\s*confirmation/.test(app) || !/input\.type\s*=\s*show\s*\?\s*"text"\s*:\s*"password"/.test(app)) throw new Error("A confirmação ou visualização de senha não está funcionando.");
if (!keepAliveWorkflow.includes('cron: "17 9 * * *"') || !keepAliveWorkflow.includes("workflow_dispatch:")) throw new Error("O robô diário do Supabase não está agendado corretamente.");
if (!keepAliveWorkflow.includes("/rest/v1/store_settings") || !keepAliveWorkflow.includes("--retry 3")) throw new Error("O robô diário não valida o banco com repetição segura.");
if (/service[_-]?role/i.test(keepAliveWorkflow)) throw new Error("O robô diário não pode usar a chave administrativa.");
if (!app.includes('client_request_id: requestId') || !app.includes('.eq("client_request_id", requestId)')) throw new Error("O pedido não possui recuperação idempotente.");
if (!storeHtml.includes('id="savedAddressSelect"') || !storeHtml.includes('id="accountOrders"') || !app.includes('from("saved_addresses")')) throw new Error("Endereços salvos ou histórico individual não estão ativos.");
if (!storeHtml.includes('id="placeOrder">Finalizar pedido</button>') || !storeHtml.includes('class="checkout-action-bar"') || !styles.includes('.checkout-action-bar{position:sticky')) throw new Error("O botão Finalizar pedido não está preso à última etapa.");
if (!storeHtml.includes('id="profileCameraInput"') || !storeHtml.includes('id="profileFileInput"') || !app.includes('storage.from("avatars").upload') || !app.includes('profileJpeg(file)')) throw new Error("A foto de perfil por câmera, galeria ou arquivo não está completa.");
if (!app.includes('Ver escolhas (') || !styles.includes('grid-template-columns:88px minmax(0,1fr)')) throw new Error("O carrinho profissional não está ativo.");
if (!authFunction.includes("EdgeRuntime.waitUntil") || !authFunction.includes("pool: true") || !authFunction.includes("mailerPromise")) throw new Error("O envio rápido de códigos em segundo plano não está ativo.");
if (!receipts.includes("whatsappText") || !receipts.includes("downloadPdf") || !receipts.includes("maps.google.com")) throw new Error("WhatsApp detalhado, PDF ou mapa estão incompletos.");
if (!adminHtml.includes('data-view="customers"') || !admin.includes('rpc("set_customer_block"') || !admin.includes('data-order-action="delete"')) throw new Error("Controles administrativos de clientes e pedidos estão incompletos.");
if (!admin.includes("maintenance_mode:!data.has") || !adminHtml.includes('id="toggleOrders"')) throw new Error("O botão de ligar/desligar pedidos não está ativo.");
const buttonEmoji = /[📷🖼📲📄🗺🧾🛵🏪👥🔥✉👁]/u;
for (const [name, source] of [["loja", storeHtml], ["painel", adminHtml], ["ações da loja", app], ["ações do painel", admin]]) {
  if (buttonEmoji.test(source)) throw new Error(`Ainda existe emoji de controle em ${name}.`);
}
for (const id of ["camera", "image", "chat-phone", "file-text", "map-pin", "receipt", "edit", "refresh"]) {
  if (!iconSprite.includes(`id="icon-${id}"`)) throw new Error(`O ícone SVG ${id} está ausente.`);
}
if (!styles.includes("@media (max-width:560px)") || !styles.includes("overflow-x:hidden")) throw new Error("A conta ainda pode ultrapassar a largura da tela móvel.");
if (!receipts.includes("🔥 *NOVO PEDIDO") || !receipts.includes("✅ Pedido registrado")) throw new Error("Os emojis da mensagem do WhatsApp devem ser preservados.");
console.log(`OK: ${catalog.length} produtos, ${expected.size} imagens, ${options.length} opções, carrinho profissional, finalização fixa, foto de perfil, e-mail rápido, histórico, WhatsApp, PDF, mapa e painel administrativo.`);
