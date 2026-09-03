(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const tools = () => window.OrderTools;
  const icon = name => `<svg class="ui-icon" aria-hidden="true"><use href="/assets/icons.svg#icon-${name}"></use></svg>`;
  const state = { profile: null, categories: [], products: [], groups: [], options: [], orders: [], customers: [], promotions: [], settings: null, editor: null };
  const titles = { dashboard:"Visão geral", products:"Produtos", categories:"Categorias", options:"Complementos", orders:"Pedidos", customers:"Clientes", promotions:"Promoções", store:"Loja e entrega", appearance:"Aparência", auth:"E-mail e acesso" };
  const statuses = [["pending","Pendente"],["confirmed","Confirmado"],["preparing","Preparando"],["ready","Pronto"],["out_for_delivery","Saiu para entrega"],["completed","Concluído"],["cancelled","Cancelado"]];
  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bind(); db.auth.onAuthStateChange((_event, session) => { if (!session) showGate(); });
    const { data: { session } } = await db.auth.getSession(); if (session) await enterAdmin(session.user); else showGate();
  }
  function bind() {
    $("#adminPasswordLogin").addEventListener("click", loginWithPassword); $("#adminPasswordToggle").addEventListener("click", toggleAdminPassword);
    $("#adminPassword").addEventListener("keydown", event => { if (event.key === "Enter") loginWithPassword(); });
    $("#adminSendCode").addEventListener("click", sendCode); $("#adminVerifyCode").addEventListener("click", verifyCode);
    $("#adminCode").addEventListener("input", event => event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6));
    $("#adminSignOut").addEventListener("click", async () => { await db.auth.signOut(); showGate(); });
    $("#adminNav").addEventListener("click", event => { const button = event.target.closest("[data-view]"); if (button) showView(button.dataset.view); });
    document.addEventListener("click", globalAction);
    $("#adminMenu").addEventListener("click", () => $(".admin-sidebar").classList.toggle("open"));
    $("#newProduct").addEventListener("click", () => editProduct()); $("#newCategory").addEventListener("click", () => editCategory());
    $("#productSearch").addEventListener("input", renderProducts); $("#productCategoryFilter").addEventListener("change", renderProducts);
    $("#optionProductSelect").addEventListener("change", renderOptionGroups); $("#orderStatusFilter").addEventListener("change", renderOrders);
    $("#customerSearch").addEventListener("input", renderCustomers); $("#refreshCustomers").addEventListener("click", loadCustomers);
    $("#newPromotion").addEventListener("click", () => editPromotion()); $("#adminPromotions").addEventListener("click", promotionAction);
    $("#refreshOrders").addEventListener("click", loadOrders); $("#toggleOrders").addEventListener("click", toggleOrders);
    $("#adminProducts").addEventListener("click", productAction); $("#adminCategories").addEventListener("click", categoryAction); $("#adminOptionGroups").addEventListener("click", optionAction);
    $("#adminOrders").addEventListener("change", orderStatusAction); $("#recentOrders").addEventListener("change", orderStatusAction);
    $("#closeEditor").addEventListener("click", () => $("#adminEditor").close()); $("#editorForm").addEventListener("submit", saveEditor);
  }
  function globalAction(event) {
    const go = event.target.closest("[data-go]"); if (go) showView(go.dataset.go);
    const order = event.target.closest("[data-order-action]"); if (order) orderAction(order);
    const customer = event.target.closest("[data-customer-action]"); if (customer) customerAction(customer);
  }
  function showGate() { $("#adminGate").classList.remove("hidden"); $("#adminApp").classList.add("hidden"); }
  async function loginWithPassword() {
    const email = $("#adminEmail").value.trim().toLowerCase(), password = $("#adminPassword").value, button = $("#adminPasswordLogin");
    if (!email.includes("@")) return msg($("#adminLoginMessage"), "Digite um e-mail válido.", "error");
    if (password.length < 8) return msg($("#adminLoginMessage"), "Digite sua senha com pelo menos 8 caracteres.", "error");
    const label = button.textContent; button.disabled = true; button.textContent = "Entrando…"; msg($("#adminLoginMessage"), "Validando acesso…");
    const { data, error } = await db.auth.signInWithPassword({ email, password }); button.disabled = false; button.textContent = label;
    if (error || !data?.user) return msg($("#adminLoginMessage"), "E-mail ou senha incorretos.", "error");
    $("#adminPassword").value = ""; await enterAdmin(data.user);
  }
  function toggleAdminPassword() {
    const input = $("#adminPassword"), button = $("#adminPasswordToggle"), show = input.type === "password";
    input.type = show ? "text" : "password"; button.setAttribute("aria-pressed", String(show)); button.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha"); button.title = show ? "Ocultar senha" : "Mostrar senha";
    button.querySelector("use")?.setAttribute("href", `/assets/icons.svg#icon-${show ? "eye-off" : "eye"}`); input.focus();
  }
  async function sendCode() {
    const email = $("#adminEmail").value.trim().toLowerCase(), button = $("#adminSendCode"); if (!email.includes("@")) return msg($("#adminLoginMessage"), "Digite um e-mail válido.", "error");
    const label = button.textContent; button.disabled = true; button.textContent = "Enviando código…"; msg($("#adminLoginMessage"), "Conectando com segurança…");
    const { data, error } = await window.requestAuthCodeReliable({ email, mode:"login" }); button.disabled = false; button.textContent = label;
    if (error || data?.ok !== true) return msg($("#adminLoginMessage"), "Não foi possível conectar ao e-mail. Confira sua internet e tente novamente.", "error");
    $("#adminCodeArea").classList.remove("hidden"); msg($("#adminLoginMessage"), "Se este e-mail estiver autorizado, enviaremos um código numérico.", "success");
  }
  async function verifyCode() {
    const code = $("#adminCode").value; if (!/^\d{6}$/.test(code)) return msg($("#adminLoginMessage"), "Digite os 6 números enviados ao e-mail.", "error");
    const button = $("#adminVerifyCode"); button.disabled = true; const email = $("#adminEmail").value.trim().toLowerCase();
    const { data, error } = await db.functions.invoke("verify-auth-code", { body: { email, code } });
    if (error || !data?.ok || !data?.access_token || !data?.refresh_token) { button.disabled = false; return msg($("#adminLoginMessage"), "Código inválido ou expirado.", "error"); }
    const { data: sessionData, error: sessionError } = await db.auth.setSession({ access_token:data.access_token, refresh_token:data.refresh_token }); button.disabled = false;
    if (sessionError || !sessionData?.user) return msg($("#adminLoginMessage"), "Não foi possível concluir o acesso. Solicite um novo código.", "error"); await enterAdmin(sessionData.user);
  }
  async function enterAdmin(user) {
    const { data, error } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (error || data?.role !== "admin") { await db.auth.signOut(); showGate(); msg($("#adminLoginMessage"), "Este e-mail não possui acesso administrativo.", "error"); return; }
    state.profile = data; $("#adminGate").classList.add("hidden"); $("#adminApp").classList.remove("hidden");
    try { await loadAll(); showView("dashboard"); } catch (loadError) { console.error(loadError); toast("Não foi possível carregar todos os dados do painel."); }
  }
  async function loadAll() {
    const [categories, products, groups, options, settings, promotions] = await Promise.all([
      db.from("categories").select("*").order("position"), db.from("products").select("*").order("position"), db.from("option_groups").select("*").order("position"),
      db.from("product_options").select("*").order("position"), db.from("store_settings").select("*").eq("id", true).single(), db.from("promotions").select("*").order("position")
    ]);
    for (const result of [categories, products, groups, options, settings, promotions]) if (result.error) throw result.error;
    Object.assign(state, {
      categories: categories.data.map(category => ({ ...category, name: tools().displayName(category.name) })),
      products: products.data.map(product => ({ ...product, name: tools().displayName(product.name), image_url:localImage(product.image_url) })),
      groups: groups.data, options: options.data, settings: settings.data, promotions: promotions.data || []
    });
    await Promise.all([loadOrders(), loadCustomers()]); populateFilters(); renderProducts(); renderCategories(); renderOptionProductSelect(); renderPromotions(); renderSettings(); renderAuthChecklist(); renderDashboard();
  }
  async function loadOrders() {
    const { data, error } = await db.from("orders").select("*,order_items(*)").order("created_at", { ascending:false }).limit(500);
    if (error) return toast("Não foi possível atualizar os pedidos."); state.orders = data || []; renderOrders(); renderDashboard();
  }
  async function loadCustomers() {
    const { data, error } = await db.from("profiles").select("*").eq("role", "customer").order("created_at", { ascending:false });
    if (error) return toast("Não foi possível atualizar os clientes."); state.customers = data || []; renderCustomers(); renderDashboard();
  }
  function showView(view) { $$(".admin-view").forEach(element => element.classList.toggle("active", element.id === "view-" + view)); $$("#adminNav button").forEach(button => button.classList.toggle("active", button.dataset.view === view)); $("#viewTitle").textContent = titles[view]; $(".admin-sidebar").classList.remove("open"); }
  function populateFilters() { $("#productCategoryFilter").innerHTML = '<option value="">Todas as categorias</option>' + state.categories.map(category => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join(""); }
  function renderDashboard() {
    if (!state.settings) return;
    const today = new Date().toLocaleDateString("pt-BR", { timeZone:"America/Fortaleza" }), todayOrders = state.orders.filter(order => new Date(order.created_at).toLocaleDateString("pt-BR", { timeZone:"America/Fortaleza" }) === today);
    const revenue = todayOrders.filter(order => order.status !== "cancelled").reduce((total, order) => total + Number(order.total), 0);
    const metrics = [["Produtos ativos",state.products.filter(product => product.active).length],["Clientes",state.customers.length],["Pedidos hoje",todayOrders.length],["Vendas hoje",money(revenue)]];
    $("#metricGrid").innerHTML = metrics.map(([label, value]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong></article>`).join("");
    $("#recentOrders").innerHTML = state.orders.slice(0, 6).map(orderCard).join("") || "<p>Nenhum pedido ainda.</p>"; renderOperationBar();
  }
  function renderOperationBar() {
    const accepting = !state.settings.maintenance_mode; $("#operationBar").classList.toggle("off", !accepting); $("#operationTitle").textContent = accepting ? "Pedidos ligados" : "Pedidos desligados";
    $("#operationText").textContent = accepting ? "Clientes podem concluir novos pedidos agora." : "O cardápio está visível, mas ninguém pode enviar pedido.";
    $("#toggleOrders").textContent = accepting ? "Desligar novos pedidos" : "Ligar novos pedidos"; $("#toggleOrders").classList.toggle("button-danger", accepting); $("#toggleOrders").classList.toggle("button-primary", !accepting);
  }
  async function toggleOrders() {
    const button = $("#toggleOrders"); button.disabled = true; const { data, error } = await db.from("store_settings").update({ maintenance_mode:!state.settings.maintenance_mode }).eq("id", true).select().single(); button.disabled = false;
    if (error) return toast("Não foi possível alterar o funcionamento."); state.settings = data; renderOperationBar(); renderSettings(); toast(state.settings.maintenance_mode ? "Novos pedidos foram desligados." : "Novos pedidos foram ligados.");
  }

  function renderProducts() {
    const query = $("#productSearch").value.trim().toLocaleLowerCase("pt-BR"), category = $("#productCategoryFilter").value;
    const products = state.products.filter(product => (!query || `${product.name} ${product.description || ""}`.toLocaleLowerCase("pt-BR").includes(query)) && (!category || product.category_id === category));
    $("#adminProducts").innerHTML = products.map(product => `<article class="admin-row"><img src="${escapeHtml(product.image_url || "/assets/favicon.svg")}" alt=""><div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(state.categories.find(category => category.id === product.category_id)?.name || "")}</p></div><div class="admin-secondary"><strong>${product.price == null ? "Preço por opção" : money(product.price)}</strong><br><span class="status-pill ${product.active ? "active" : ""}">${product.active ? "Ativo" : "Oculto"}</span></div><div class="admin-row-actions"><button data-action="toggle" data-id="${product.id}" title="Ativar/ocultar" aria-label="${product.active ? "Ocultar" : "Ativar"} ${escapeHtml(product.name)}">${icon(product.active ? "eye" : "eye-off")}</button><button data-action="edit" data-id="${product.id}" title="Editar" aria-label="Editar ${escapeHtml(product.name)}">${icon("edit")}</button></div></article>`).join("");
  }
  async function productAction(event) {
    const button = event.target.closest("[data-action]"); if (!button) return; const product = state.products.find(item => item.id === button.dataset.id);
    if (button.dataset.action === "edit") editProduct(product);
    if (button.dataset.action === "toggle") { const { error } = await db.from("products").update({ active:!product.active }).eq("id", product.id); if (!error) { product.active = !product.active; renderProducts(); toast("Disponibilidade atualizada."); } }
  }
  function editProduct(product = null) {
    state.editor = { type:"product", record:product }; openEditor(product ? "Editar produto" : "Novo produto", `<div class="form-grid"><label class="field wide"><span>Nome *</span><input name="name" required value="${escapeHtml(product?.name || "")}"></label><label class="field wide"><span>Descrição</span><textarea name="description">${escapeHtml(product?.description || "")}</textarea></label><label class="field"><span>Categoria *</span><select name="category_id" required>${state.categories.map(category => `<option value="${category.id}" ${product?.category_id === category.id ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("")}</select></label><label class="field"><span>Ordem</span><input name="position" type="number" value="${product?.position ?? state.products.length * 10 + 10}"></label><label class="field"><span>Preço atual</span><input name="price" inputmode="decimal" value="${product?.price ?? ""}" placeholder="Vazio se vier da opção"></label><label class="field"><span>Preço antigo riscado</span><input name="old_price" inputmode="decimal" value="${product?.old_price ?? ""}"></label><label class="field wide"><span>URL da imagem</span><input name="image_url" value="${escapeHtml(product?.image_url || "")}"></label><label class="field wide"><span>Ou enviar nova imagem (máx. 5 MB)</span><input name="image_file" type="file" accept="image/jpeg,image/png,image/webp,image/avif"></label><label class="option-choice"><input name="active" type="checkbox" ${product?.active !== false ? "checked" : ""}><span>Produto ativo</span></label><label class="option-choice"><input name="featured" type="checkbox" ${product?.featured ? "checked" : ""}><span>Destacar promoção</span></label></div>`);
  }
  async function saveProduct(form, product) {
    const data = new FormData(form); let image = data.get("image_url").trim(), file = data.get("image_file");
    if (file?.size) { if (file.size > 5242880) throw new Error("A imagem deve ter no máximo 5 MB."); const extension = file.name.split(".").pop().toLowerCase(), path = `products/${crypto.randomUUID()}.${extension}`, upload = await db.storage.from("product-images").upload(path, file, { cacheControl:"31536000", upsert:false }); if (upload.error) throw upload.error; image = db.storage.from("product-images").getPublicUrl(path).data.publicUrl; }
    const name = data.get("name").trim().toLocaleLowerCase("pt-BR"), payload = { name, description:data.get("description").trim() || null, category_id:data.get("category_id"), position:Number(data.get("position") || 0), price:numOrNull(data.get("price")), old_price:numOrNull(data.get("old_price")), image_url:image || null, active:data.has("active"), featured:data.has("featured"), slug:product?.slug || slug(name) + "-" + Date.now().toString(36) };
    const result = product ? await db.from("products").update(payload).eq("id", product.id).select().single() : await db.from("products").insert(payload).select().single(); if (result.error) throw result.error;
    if (product) Object.assign(product, result.data, { name:tools().displayName(result.data.name) }); else state.products.push({ ...result.data, name:tools().displayName(result.data.name) }); renderProducts(); renderOptionProductSelect(); toast("Produto salvo.");
  }

  function renderCategories() { $("#adminCategories").innerHTML = state.categories.map(category => `<article class="admin-row"><div class="brand-mark">${icon("list")}</div><div><h3>${escapeHtml(category.name)}</h3><p>${state.products.filter(product => product.category_id === category.id).length} produtos • posição ${category.position}</p></div><div class="admin-secondary"><span class="status-pill ${category.active ? "active" : ""}">${category.active ? "Ativa" : "Oculta"}</span></div><div class="admin-row-actions"><button data-category-action="edit" data-id="${category.id}" aria-label="Editar ${escapeHtml(category.name)}">${icon("edit")}</button></div></article>`).join(""); }
  function categoryAction(event) { const button = event.target.closest("[data-category-action]"); if (button) editCategory(state.categories.find(category => category.id === button.dataset.id)); }
  function editCategory(category = null) { state.editor = { type:"category", record:category }; openEditor(category ? "Editar categoria" : "Nova categoria", `<label class="field"><span>Nome *</span><input name="name" required value="${escapeHtml(category?.name || "")}"></label><label class="field"><span>Descrição</span><textarea name="description">${escapeHtml(category?.description || "")}</textarea></label><label class="field"><span>Ordem</span><input name="position" type="number" value="${category?.position ?? state.categories.length * 10 + 10}"></label><label class="option-choice"><input name="active" type="checkbox" ${category?.active !== false ? "checked" : ""}><span>Categoria ativa</span></label>`); }
  async function saveCategory(form, category) { const data = new FormData(form), name = data.get("name").trim().toLocaleLowerCase("pt-BR"), payload = { name, source_name:category?.source_name || name, slug:category?.slug || slug(name) + "-" + Date.now().toString(36), description:data.get("description").trim() || null, position:Number(data.get("position") || 0), active:data.has("active") }; const result = category ? await db.from("categories").update(payload).eq("id", category.id).select().single() : await db.from("categories").insert(payload).select().single(); if (result.error) throw result.error; if (category) Object.assign(category, result.data, { name:tools().displayName(result.data.name) }); else state.categories.push({ ...result.data, name:tools().displayName(result.data.name) }); populateFilters(); renderCategories(); renderProducts(); toast("Categoria salva."); }

  function renderOptionProductSelect() { $("#optionProductSelect").innerHTML = '<option value="">Selecione…</option>' + state.products.map(product => `<option value="${product.id}">${escapeHtml(product.name)}</option>`).join(""); }
  function renderOptionGroups() {
    const productId = $("#optionProductSelect").value, groups = state.groups.filter(group => group.product_id === productId);
    $("#adminOptionGroups").innerHTML = productId ? groups.map(group => `<article class="option-admin-group"><header><div><h3>${escapeHtml(group.name)}</h3><p>${group.min_select > 0 ? "Obrigatório" : "Opcional"} • mínimo ${group.min_select}, máximo ${group.max_select}</p></div><div class="admin-row-actions"><button data-option-action="edit-group" data-id="${group.id}">${icon("edit")}Editar</button><button data-option-action="new-option" data-id="${group.id}">${icon("plus")}Opção</button></div></header><div class="option-admin-list">${state.options.filter(option => option.group_id === group.id).map(option => `<div class="option-admin-item"><span>${escapeHtml(option.name)} ${Number(option.price_delta) > 0 ? "• +" + money(option.price_delta) : ""}</span><button data-option-action="edit-option" data-id="${option.id}">${icon("edit")}Editar</button></div>`).join("")}</div></article>`).join("") + `<button class="button button-primary" data-option-action="new-group" data-id="${productId}">${icon("plus")}Novo grupo</button>` : "<p>Selecione um produto para editar suas opções.</p>";
  }
  function optionAction(event) { const button = event.target.closest("[data-option-action]"); if (!button) return; const action = button.dataset.optionAction; if (action === "new-group") editGroup(null, button.dataset.id); if (action === "edit-group") editGroup(state.groups.find(group => group.id === button.dataset.id)); if (action === "new-option") editOption(null, button.dataset.id); if (action === "edit-option") editOption(state.options.find(option => option.id === button.dataset.id)); }
  function editGroup(group, productId) { state.editor = { type:"group", record:group, productId:productId || group.product_id }; openEditor(group ? "Editar grupo" : "Novo grupo", `<label class="field"><span>Nome *</span><input name="name" required value="${escapeHtml(group?.name || "")}"></label><div class="form-grid"><label class="field"><span>Mínimo</span><input name="min_select" type="number" min="0" value="${group?.min_select ?? 0}"></label><label class="field"><span>Máximo</span><input name="max_select" type="number" min="1" value="${group?.max_select ?? 1}"></label></div><label class="field"><span>Ordem</span><input name="position" type="number" value="${group?.position ?? state.groups.length * 10 + 10}"></label>`); }
  async function saveGroup(form, group, productId) { const data = new FormData(form), min = Number(data.get("min_select") || 0), max = Number(data.get("max_select") || 1); if (max < Math.max(1, min)) throw new Error("O máximo deve ser maior ou igual ao mínimo."); const payload = { product_id:productId, name:data.get("name").trim(), source_group_id:group?.source_group_id || "admin-" + Date.now(), min_select:min, max_select:max, required:min > 0, selection_type:max === 1 ? "single" : "multiple", position:Number(data.get("position") || 0) }; const result = group ? await db.from("option_groups").update(payload).eq("id", group.id).select().single() : await db.from("option_groups").insert(payload).select().single(); if (result.error) throw result.error; if (group) Object.assign(group, result.data); else state.groups.push(result.data); renderOptionGroups(); toast("Grupo salvo."); }
  function editOption(option, groupId) { state.editor = { type:"option", record:option, groupId:groupId || option.group_id }; openEditor(option ? "Editar opção" : "Nova opção", `<label class="field"><span>Nome *</span><input name="name" required value="${escapeHtml(option?.name || "")}"></label><label class="field"><span>Valor adicional</span><input name="price_delta" inputmode="decimal" value="${option?.price_delta ?? 0}"></label><label class="field"><span>Ordem</span><input name="position" type="number" value="${option?.position ?? state.options.length * 10 + 10}"></label><label class="option-choice"><input name="active" type="checkbox" ${option?.active !== false ? "checked" : ""}><span>Opção ativa</span></label>`); }
  async function saveOption(form, option, groupId) { const data = new FormData(form), payload = { group_id:groupId, name:data.get("name").trim(), source_option_id:option?.source_option_id || "admin-" + Date.now(), price_delta:Number(String(data.get("price_delta") || 0).replace(",", ".")), position:Number(data.get("position") || 0), active:data.has("active") }; const result = option ? await db.from("product_options").update(payload).eq("id", option.id).select().single() : await db.from("product_options").insert(payload).select().single(); if (result.error) throw result.error; if (option) Object.assign(option, result.data); else state.options.push(result.data); renderOptionGroups(); toast("Opção salva."); }

  function renderOrders() { const status = $("#orderStatusFilter").value, orders = state.orders.filter(order => !status || order.status === status); $("#adminOrders").innerHTML = orders.map(orderCard).join("") || "<p>Nenhum pedido encontrado.</p>"; }
  function orderCard(order) {
    const address = order.order_type === "delivery" && order.address ? tools().fullAddress(order.address) : "Retirada no estabelecimento";
    const items = (order.order_items || []).map(item => `<li><strong>${item.quantity}x ${escapeHtml(tools().displayName(item.product_name))}</strong> — ${money(item.line_total)}${(item.selections || []).length ? `<small>${item.selections.map(selection => `${escapeHtml(tools().displayName(selection.group))}: ${escapeHtml(tools().displayName(selection.name))}`).join(" • ")}</small>` : ""}${item.notes ? `<small>Obs.: ${escapeHtml(item.notes)}</small>` : ""}</li>`).join("");
    const map = tools().mapUrl(order.address);
    return `<article class="order-card detailed"><header><div><h3>Pedido #${order.order_number} • ${escapeHtml(order.customer_name)}</h3><p>${tools().dateTime(order.created_at)} • ${tools().phone(order.phone)} • ${order.order_type === "delivery" ? "Entrega" : "Retirada"}</p></div><strong>${money(order.total)}</strong></header><details><summary>Ver pedido completo</summary><ul class="order-item-list">${items}</ul><p>${escapeHtml(address).replace(/\n/g, "<br>")}</p><p><b>Pagamento:</b> ${escapeHtml(tools().paymentLabel(order))} • <b>Prazo:</b> ${order.delivery_eta_minutes || 60} min</p>${order.notes ? `<p><b>Obs. geral:</b> ${escapeHtml(order.notes)}</p>` : ""}</details><div class="order-controls"><select data-order-id="${order.id}">${statuses.map(([value, label]) => `<option value="${value}" ${order.status === value ? "selected" : ""}>${label}</option>`).join("")}</select><div class="card-actions"><button class="button button-primary" data-order-action="whatsapp" data-id="${order.id}">${icon("chat-phone")}WhatsApp</button><button class="button button-ghost" data-order-action="pdf" data-id="${order.id}">${icon("file-text")}PDF</button>${map ? `<a class="button button-ghost" href="${map}" target="_blank" rel="noopener">${icon("map-pin")}Mapa</a>` : ""}<button class="button button-ghost" data-order-action="edit" data-id="${order.id}">${icon("edit")}Editar</button><button class="button button-danger" data-order-action="delete" data-id="${order.id}">${icon("trash")}Excluir</button></div></div></article>`;
  }
  async function orderStatusAction(event) { const select = event.target.closest("[data-order-id]"); if (!select) return; const { error } = await db.from("orders").update({ status:select.value }).eq("id", select.dataset.orderId); if (error) return toast("Falha ao atualizar."); const order = state.orders.find(item => item.id === select.dataset.orderId); order.status = select.value; renderDashboard(); toast("Status atualizado."); }
  async function orderAction(button) {
    const order = state.orders.find(item => item.id === button.dataset.id); if (!order) return; const action = button.dataset.orderAction;
    if (action === "whatsapp") window.open(tools().whatsappUrl(order, state.settings.whatsapp), "_blank", "noopener");
    if (action === "pdf") { try { await tools().downloadPdf(order, state.settings); } catch (error) { toast(error.message); } }
    if (action === "edit") editOrder(order);
    if (action === "delete") { if (!confirm(`Excluir definitivamente o pedido #${order.order_number}?`)) return; const { error } = await db.from("orders").delete().eq("id", order.id); if (error) return toast("Não foi possível excluir o pedido."); state.orders = state.orders.filter(item => item.id !== order.id); renderOrders(); renderDashboard(); toast("Pedido excluído."); }
  }
  function editOrder(order) {
    const address = order.address || {}; state.editor = { type:"order", record:order };
    openEditor(`Editar pedido #${order.order_number}`, `<div class="form-grid"><label class="field"><span>Cliente *</span><input name="customer_name" required value="${escapeHtml(order.customer_name)}"></label><label class="field"><span>WhatsApp *</span><input name="phone" required value="${escapeHtml(order.phone)}"></label><label class="field wide"><span>E-mail</span><input name="email" type="email" value="${escapeHtml(order.email || "")}"></label><label class="field"><span>Status</span><select name="status">${statuses.map(([value, label]) => `<option value="${value}" ${order.status === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="field"><span>Tipo</span><select name="order_type"><option value="delivery" ${order.order_type === "delivery" ? "selected" : ""}>Entrega</option><option value="pickup" ${order.order_type === "pickup" ? "selected" : ""}>Retirada</option></select></label><label class="field"><span>Pagamento</span><select name="payment_method"><option value="pix" ${order.payment_method === "pix" ? "selected" : ""}>Pix</option><option value="card" ${order.payment_method === "card" ? "selected" : ""}>Cartão</option><option value="cash" ${order.payment_method === "cash" ? "selected" : ""}>Dinheiro</option></select></label><label class="field"><span>Detalhe do cartão</span><select name="payment_detail"><option value="">—</option><option value="debit" ${order.payment_detail === "debit" ? "selected" : ""}>Débito</option><option value="credit" ${order.payment_detail === "credit" ? "selected" : ""}>Crédito</option></select></label><label class="field"><span>Prazo em minutos</span><input name="delivery_eta_minutes" type="number" min="10" max="240" value="${order.delivery_eta_minutes || 60}"></label><label class="field"><span>Taxa de entrega</span><input name="delivery_fee" inputmode="decimal" value="${order.delivery_fee}"></label><label class="field"><span>Desconto</span><input name="discount" inputmode="decimal" value="${order.discount}"></label><label class="field wide"><span>Rua</span><input name="street" value="${escapeHtml(address.street || "")}"></label><label class="field"><span>Número</span><input name="number" value="${escapeHtml(address.number || "")}"></label><label class="field"><span>Complemento</span><input name="complement" value="${escapeHtml(address.complement || "")}"></label><label class="field"><span>Bairro</span><input name="neighborhood" value="${escapeHtml(address.neighborhood || "")}"></label><label class="field"><span>CEP</span><input name="postal_code" value="${escapeHtml(address.postal_code || "")}"></label><label class="field"><span>Cidade</span><input name="city" value="${escapeHtml(address.city || "")}"></label><label class="field"><span>Estado</span><input name="state" maxlength="2" value="${escapeHtml(address.state || "")}"></label><label class="field wide"><span>Referência</span><input name="reference" value="${escapeHtml(address.reference || "")}"></label><label class="field wide"><span>Observações gerais</span><textarea name="notes">${escapeHtml(order.notes || "")}</textarea></label></div>`);
  }
  async function saveOrder(form, order) {
    const data = new FormData(form), type = data.get("order_type"), deliveryFee = type === "delivery" ? Number(String(data.get("delivery_fee") || 0).replace(",", ".")) : 0, discount = Number(String(data.get("discount") || 0).replace(",", "."));
    const address = type === "delivery" ? { street:data.get("street").trim(), number:data.get("number").trim(), complement:data.get("complement").trim(), neighborhood:data.get("neighborhood").trim(), postal_code:data.get("postal_code").trim(), city:data.get("city").trim(), state:data.get("state").trim().toUpperCase(), reference:data.get("reference").trim() } : null;
    const payload = { customer_name:data.get("customer_name").trim(), phone:data.get("phone").replace(/\D/g, ""), email:data.get("email").trim() || null, status:data.get("status"), order_type:type, payment_method:data.get("payment_method"), payment_detail:data.get("payment_method") === "card" ? data.get("payment_detail") || null : null, delivery_eta_minutes:Number(data.get("delivery_eta_minutes") || 60), delivery_fee:deliveryFee, discount, total:Number(order.subtotal) - discount + deliveryFee, address, notes:data.get("notes").trim() || null };
    const { data:updated, error } = await db.from("orders").update(payload).eq("id", order.id).select().single(); if (error) throw error; Object.assign(order, updated); renderOrders(); renderDashboard(); toast("Pedido atualizado.");
  }

  function renderCustomers() {
    const query = $("#customerSearch").value.trim().toLocaleLowerCase("pt-BR");
    const customers = state.customers.filter(customer => !query || `${customer.full_name || ""} ${customer.email || ""} ${customer.phone || ""}`.toLocaleLowerCase("pt-BR").includes(query));
    $("#adminCustomers").innerHTML = customers.map(customer => { const count = state.orders.filter(order => order.customer_id === customer.id).length, initial = escapeHtml((customer.full_name || customer.email || "C").charAt(0).toUpperCase()), avatar = `<div class="customer-avatar"><span>${initial}</span>${customer.avatar_url ? `<img class="customer-avatar-image" src="${escapeHtml(customer.avatar_url)}" alt="Foto de ${escapeHtml(customer.full_name || "cliente")}" onerror="this.remove()">` : ""}</div>`; return `<article class="admin-row customer-row">${avatar}<div><h3>${escapeHtml(customer.full_name || "Cliente sem nome")}</h3><p>${escapeHtml(customer.email || "")} • ${escapeHtml(tools().phone(customer.phone))}</p>${customer.blocked_reason ? `<p>Motivo: ${escapeHtml(customer.blocked_reason)}</p>` : ""}</div><div class="admin-secondary"><strong>${count} pedido${count === 1 ? "" : "s"}</strong><br><span class="status-pill ${customer.is_blocked ? "cancelled" : "active"}">${customer.is_blocked ? "Bloqueado" : "Liberado"}</span></div><div class="admin-row-actions"><button class="button ${customer.is_blocked ? "button-primary" : "button-danger"}" data-customer-action="${customer.is_blocked ? "unblock" : "block"}" data-id="${customer.id}">${customer.is_blocked ? "Desbloquear" : "Bloquear"}</button></div></article>`; }).join("") || "<p>Nenhum cliente encontrado.</p>";
  }
  async function customerAction(button) {
    const customer = state.customers.find(item => item.id === button.dataset.id); if (!customer) return; const blocked = button.dataset.customerAction === "block";
    const reason = blocked ? prompt(`Motivo do bloqueio de ${customer.full_name || customer.email} (opcional):`, "") : null; if (blocked && reason === null) return;
    const { data, error } = await db.rpc("set_customer_block", { customer_uuid:customer.id, blocked, reason }); if (error) return toast("Não foi possível alterar o cliente."); Object.assign(customer, data); renderCustomers(); toast(blocked ? "Cliente bloqueado para novos pedidos." : "Cliente desbloqueado.");
  }

  function renderPromotions() {
    $("#adminPromotions").innerHTML = state.promotions.map(promotion => {
      const product = state.products.find(item => item.id === promotion.product_id);
      const period = promotion.starts_at ? new Date(promotion.starts_at).toLocaleDateString("pt-BR") : "Início imediato";
      const end = promotion.ends_at ? " até " + new Date(promotion.ends_at).toLocaleDateString("pt-BR") : "";
      return '<article class="admin-row"><img src="' + escapeHtml(localImage(promotion.image_url || product?.image_url) || "/assets/favicon.svg") + '" alt=""><div><h3>' + escapeHtml(promotion.title) + '</h3><p>' + escapeHtml(product?.name || "Produto removido") + ' • ' + escapeHtml(promotion.badge_text || "OFERTA") + '</p></div><div class="admin-secondary"><span class="status-pill ' + (promotion.active ? "active" : "") + '">' + (promotion.active ? "Ativa" : "Oculta") + '</span><br><small>' + period + end + '</small></div><div class="admin-row-actions"><button data-promotion-action="toggle" data-id="' + promotion.id + '" aria-label="Alternar promoção">' + icon(promotion.active ? "eye" : "eye-off") + '</button><button data-promotion-action="edit" data-id="' + promotion.id + '" aria-label="Editar promoção">' + icon("edit") + '</button><button data-promotion-action="delete" data-id="' + promotion.id + '" aria-label="Excluir promoção">' + icon("trash") + '</button></div></article>';
    }).join("") || "<p>Nenhuma campanha criada.</p>";
  }
  function promotionAction(event) {
    const button = event.target.closest("[data-promotion-action]"); if (!button) return;
    const promotion = state.promotions.find(item => item.id === button.dataset.id); if (!promotion) return;
    if (button.dataset.promotionAction === "edit") editPromotion(promotion);
    if (button.dataset.promotionAction === "toggle") togglePromotion(promotion);
    if (button.dataset.promotionAction === "delete") deletePromotion(promotion);
  }
  function editPromotion(promotion = null) {
    state.editor = { type:"promotion", record:promotion };
    const localDate = value => value ? new Date(value).toISOString().slice(0, 16) : "";
    const products = state.products.filter(product => product.active).map(product => '<option value="' + product.id + '" ' + (promotion?.product_id === product.id ? "selected" : "") + '>' + escapeHtml(product.name) + (product.price == null ? " — preço por opção" : " — " + money(product.price)) + '</option>').join("");
    const fields = '<div class="form-grid"><label class="field wide"><span>Produto *</span><select name="product_id" required>' + products + '</select></label><label class="field wide"><span>Título *</span><input name="title" required maxlength="100" value="' + escapeHtml(promotion?.title || "") + '"></label><label class="field wide"><span>Descrição</span><textarea name="description" maxlength="240">' + escapeHtml(promotion?.description || "") + '</textarea></label><label class="field"><span>Selo</span><input name="badge_text" maxlength="30" value="' + escapeHtml(promotion?.badge_text || "PROMOÇÃO") + '"></label><label class="field"><span>Ordem</span><input name="position" type="number" value="' + (promotion?.position ?? state.promotions.length * 10 + 10) + '"></label><label class="field wide"><span>URL da imagem (opcional)</span><input name="image_url" value="' + escapeHtml(promotion?.image_url || "") + '" placeholder="Se ficar vazio, usa a foto do produto"></label><label class="field"><span>Início</span><input name="starts_at" type="datetime-local" value="' + localDate(promotion?.starts_at) + '"></label><label class="field"><span>Encerramento</span><input name="ends_at" type="datetime-local" value="' + localDate(promotion?.ends_at) + '"></label><label class="option-choice wide"><input name="active" type="checkbox" ' + (promotion?.active !== false ? "checked" : "") + '><span>Promoção ativa</span></label></div>';
    openEditor(promotion ? "Editar promoção" : "Nova promoção", fields);
  }
  async function savePromotion(form, promotion) {
    const data = new FormData(form), starts = data.get("starts_at"), ends = data.get("ends_at");
    if (starts && ends && new Date(ends) <= new Date(starts)) throw new Error("O encerramento deve ser posterior ao início.");
    const payload = { product_id:data.get("product_id"), title:data.get("title").trim(), description:data.get("description").trim() || null, badge_text:data.get("badge_text").trim() || "OFERTA", image_url:data.get("image_url").trim() || null, position:Number(data.get("position") || 0), active:data.has("active"), starts_at:starts ? new Date(starts).toISOString() : null, ends_at:ends ? new Date(ends).toISOString() : null };
    const result = promotion ? await db.from("promotions").update(payload).eq("id", promotion.id).select().single() : await db.from("promotions").insert(payload).select().single(); if (result.error) throw result.error;
    if (promotion) Object.assign(promotion, result.data); else state.promotions.push(result.data);
    state.promotions.sort((a,b) => a.position - b.position); renderPromotions(); toast("Promoção salva.");
  }
  async function togglePromotion(promotion) {
    const { error } = await db.from("promotions").update({ active:!promotion.active }).eq("id", promotion.id); if (error) return toast("Não foi possível alterar a promoção.");
    promotion.active = !promotion.active; renderPromotions(); toast("Promoção atualizada.");
  }
  async function deletePromotion(promotion) {
    if (!confirm('Excluir a promoção “' + promotion.title + '”?')) return;
    const { error } = await db.from("promotions").delete().eq("id", promotion.id); if (error) return toast("Não foi possível excluir a promoção.");
    state.promotions = state.promotions.filter(item => item.id !== promotion.id); renderPromotions(); toast("Promoção excluída.");
  }

  function renderSettings() {
    const settings = state.settings;
    $("#storeForm").innerHTML = `<label class="wide">Nome da loja<input name="name" value="${escapeHtml(settings.name)}"></label><label>E-mail de atendimento<input name="support_email" type="email" value="${escapeHtml(settings.support_email)}"></label><label>WhatsApp<input name="whatsapp" value="${escapeHtml(settings.whatsapp)}"></label><label class="wide">Endereço<input name="address" value="${escapeHtml(settings.address)}"></label><label>Cidade<input name="city" value="${escapeHtml(settings.city)}"></label><label>Estado<input name="state" value="${escapeHtml(settings.state)}"></label><label>CEP<input name="zip_code" value="${escapeHtml(settings.zip_code)}"></label><label>Status do horário<select name="manual_status"><option value="auto" ${settings.manual_status === "auto" ? "selected" : ""}>Automático pelo horário</option><option value="open" ${settings.manual_status === "open" ? "selected" : ""}>Forçar aberta</option><option value="closed" ${settings.manual_status === "closed" ? "selected" : ""}>Forçar fechada</option></select></label><label>Pedido mínimo<input name="minimum_order" inputmode="decimal" value="${settings.minimum_order}"></label><label>Taxa de entrega<input name="delivery_fee" inputmode="decimal" value="${settings.delivery_fee}"></label><label>Prazo padrão (minutos)<input name="delivery_eta_minutes" type="number" min="10" max="240" value="${settings.delivery_eta_minutes || 60}"></label><label class="option-choice"><input name="delivery_enabled" type="checkbox" ${settings.delivery_enabled ? "checked" : ""}><span>Entrega ativa</span></label><label class="option-choice"><input name="pickup_enabled" type="checkbox" ${settings.pickup_enabled ? "checked" : ""}><span>Retirada ativa</span></label><label class="option-choice wide accepting-choice"><input name="accepting_orders" type="checkbox" ${!settings.maintenance_mode ? "checked" : ""}><span>Receber novos pedidos</span></label><button class="button button-primary button-large" type="submit">Salvar loja</button>`;
    $("#storeForm").onsubmit = event => saveSettings(event, "store");
    const defaults = [
      { title:"Carne na brasa", alt:"Carne assando sobre a brasa", image_url:"/assets/hero/carne-na-brasa.webp", active:true },
      { title:"Galeto assado", alt:"Galeto dourado assando na churrasqueira", image_url:"/assets/hero/galeto-na-brasa.webp", active:true },
      { title:"Churrasco na grelha", alt:"Carnes grelhadas sobre carvão em brasa", image_url:"/assets/hero/churrasco-na-grelha.webp", active:true }
    ];
    const slides = defaults.map((fallback, index) => ({ ...fallback, ...(settings.hero_slides?.[index] || {}) }));
    const slideFields = slides.map((slide, index) => `<fieldset class="admin-slide-editor wide"><legend>Imagem ${index + 1}</legend><label>Título da imagem<input name="slide_${index}_title" value="${escapeHtml(slide.title || "")}"></label><label>Descrição acessível<input name="slide_${index}_alt" value="${escapeHtml(slide.alt || "")}"></label><label class="wide">URL ou caminho da imagem<input name="slide_${index}_url" value="${escapeHtml(slide.image_url || "")}"></label><label class="option-choice wide"><input name="slide_${index}_active" type="checkbox" ${slide.active !== false ? "checked" : ""}><span>Imagem ativa no carrossel</span></label></fieldset>`).join("");
    $("#appearanceForm").innerHTML = `<label class="wide">Texto acima do título<input name="banner_eyebrow" value="${escapeHtml(settings.banner_eyebrow || "CHURRASCARIA CARNE DE SOL")}"></label><label class="wide">Título principal<input name="banner_title" value="${escapeHtml(settings.banner_title)}"></label><label class="wide">Texto principal<textarea name="banner_text">${escapeHtml(settings.banner_text)}</textarea></label><label>Botão do cardápio<input name="banner_primary_label" value="${escapeHtml(settings.banner_primary_label || "Ver cardápio")}"></label><label>Botão do WhatsApp<input name="banner_secondary_label" value="${escapeHtml(settings.banner_secondary_label || "Falar no WhatsApp")}"></label><label>Troca das imagens (segundos)<input name="hero_interval_seconds" type="number" min="3" max="20" value="${settings.hero_interval_seconds || 6}"></label><label class="wide">URL do logotipo<input name="logo_url" value="${escapeHtml(settings.logo_url || "")}"></label>${slideFields}<fieldset class="admin-slide-editor wide"><legend>Janela de promoções</legend><label>Título<input name="promotion_popup_title" value="${escapeHtml(settings.promotion_popup_title || "Promoções de hoje")}"></label><label>Texto<input name="promotion_popup_text" value="${escapeHtml(settings.promotion_popup_text || "Escolha uma oferta e adicione à sua sacola.")}"></label><label class="option-choice wide"><input name="promotion_popup_enabled" type="checkbox" ${settings.promotion_popup_enabled !== false ? "checked" : ""}><span>Mostrar promoções ao abrir o site</span></label></fieldset><label>Cor brasa<input name="ember" type="color" value="${escapeHtml(settings.theme?.ember || "#ff6b1a")}"></label><label>Cor carvão<input name="coal" type="color" value="${escapeHtml(settings.theme?.coal || "#18120f")}"></label><button class="button button-primary button-large" type="submit">Salvar aparência</button>`;
    $("#appearanceForm").onsubmit = event => saveSettings(event, "appearance");
  }
  async function saveSettings(event, type) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const heroSlides = type === "appearance" ? [0,1,2].map(index => ({ title:data.get(`slide_${index}_title`).trim(), alt:data.get(`slide_${index}_alt`).trim(), image_url:data.get(`slide_${index}_url`).trim(), active:data.has(`slide_${index}_active`) })) : null;
    const payload = type === "store" ? { name:data.get("name"), support_email:data.get("support_email"), whatsapp:data.get("whatsapp").replace(/\D/g, ""), address:data.get("address"), city:data.get("city"), state:data.get("state"), zip_code:data.get("zip_code"), manual_status:data.get("manual_status"), minimum_order:numOrNull(data.get("minimum_order")) || 0, delivery_fee:numOrNull(data.get("delivery_fee")) || 0, delivery_eta_minutes:Number(data.get("delivery_eta_minutes") || 60), delivery_enabled:data.has("delivery_enabled"), pickup_enabled:data.has("pickup_enabled"), maintenance_mode:!data.has("accepting_orders") } : { banner_eyebrow:data.get("banner_eyebrow"), banner_title:data.get("banner_title"), banner_text:data.get("banner_text"), banner_primary_label:data.get("banner_primary_label"), banner_secondary_label:data.get("banner_secondary_label"), hero_interval_seconds:Number(data.get("hero_interval_seconds") || 6), hero_slides:heroSlides, promotion_popup_enabled:data.has("promotion_popup_enabled"), promotion_popup_title:data.get("promotion_popup_title"), promotion_popup_text:data.get("promotion_popup_text"), logo_url:data.get("logo_url") || null, theme:{ ...state.settings.theme, ember:data.get("ember"), coal:data.get("coal") } };
    const { data:updated, error } = await db.from("store_settings").update(payload).eq("id", true).select().single(); if (error) return toast("Não foi possível salvar."); state.settings = updated; renderOperationBar(); toast("Configuração salva.");
  }
  function renderAuthChecklist() { $("#authChecklist").innerHTML = [["ok","Conta e histórico individuais","Cada cliente acessa apenas os próprios endereços e pedidos."],["ok","Pedido sem duplicação","Uma tentativa repetida recupera o pedido já criado em vez de cadastrar outro."],["ok","Bloqueio administrativo","O painel bloqueia novos pedidos sem apagar o histórico do cliente."],["ok","Comprovante completo","WhatsApp, PDF e mapa usam os dados gravados no pedido."],["ok","Seleções validadas","Grupos de peso único são conferidos no site e novamente no banco."],["warn","Entrega do provedor","A entrega dos códigos depende do provedor de e-mail e deve ser acompanhada nos logs."]].map(([kind, title, text]) => `<article class="check-card ${kind}"><strong>${title}</strong><p>${text}</p></article>`).join(""); }

  function openEditor(title, fields) { $("#editorTitle").textContent = title; $("#editorFields").innerHTML = fields; msg($("#editorMessage"), ""); $("#adminEditor").showModal(); }
  async function saveEditor(event) { event.preventDefault(); const button = event.submitter; button.disabled = true; try { const { type, record, productId, groupId } = state.editor; if (type === "product") await saveProduct(event.currentTarget, record); if (type === "category") await saveCategory(event.currentTarget, record); if (type === "group") await saveGroup(event.currentTarget, record, productId); if (type === "option") await saveOption(event.currentTarget, record, groupId); if (type === "order") await saveOrder(event.currentTarget, record); if (type === "promotion") await savePromotion(event.currentTarget, record); $("#adminEditor").close(); } catch (error) { console.error(error); msg($("#editorMessage"), error.message || "Não foi possível salvar.", "error"); } finally { button.disabled = false; } }
  function slug(value) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "item"; }
  function numOrNull(value) { if (value === null || String(value).trim() === "") return null; const number = Number(String(value).replace(",", ".")); return Number.isFinite(number) ? number : null; }
  function msg(element, text, type = "") { element.textContent = text; element.className = `form-message ${type}`; }
  function toast(text) { const element = document.createElement("div"); element.className = "toast"; element.textContent = text; $("#toastRegion").append(element); setTimeout(() => element.remove(), 3800); }
  function localImage(value) { if (!value) return "/assets/favicon.svg"; try { const url = new URL(value, location.origin); if (url.hostname === "carnedosol.envoi.com.br" && url.pathname.includes("/midias/")) return "/products/" + url.pathname.split("/").pop(); } catch {} return value; }
})();
