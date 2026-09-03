(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const tools = () => window.OrderTools;
  const state = {
    settings: null, categories: [], products: [], cart: loadCart(), selected: null, quantity: 1,
    query: "", promoOnly: false, activeCategory: null, authMode: "login", backend: true,
    session: null, profile: null, addresses: [], orders: [], pendingCheckout: false, lastOrder: null
  };
  const els = {};
  let cepRequest = null;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    Object.assign(els, {
      categories: $("#categoryList"), sections: $("#productSections"), loading: $("#loadingGrid"), empty: $("#emptyState"),
      search: $("#searchInput"), promo: $("#promoFilter"), productDialog: $("#productDialog"), cartDialog: $("#cartDialog"),
      checkoutDialog: $("#checkoutDialog"), authDialog: $("#authDialog"), addressDialog: $("#addressDialog"), successDialog: $("#successDialog"),
      cartCount: $("#cartCount"), cartItems: $("#cartItems"), cartSubtotal: $("#cartSubtotal"), optionGroups: $("#optionGroups"), authMessage: $("#authMessage")
    });
    bindEvents();
    db.auth.onAuthStateChange((_event, session) => {
      state.session = session;
      $("#authButton").textContent = session ? "Minha conta" : "Entrar";
    });
    await Promise.all([loadCatalog(), loadSettings(), refreshSession()]);
    reconcileCart(); renderCatalog(); renderCart(); updateStoreInfo();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  function bindEvents() {
    $("#cartButton").addEventListener("click", () => { renderCart(); els.cartDialog.showModal(); });
    els.search.addEventListener("input", event => { state.query = event.target.value.trim().toLocaleLowerCase("pt-BR"); renderCatalog(); });
    els.promo.addEventListener("click", () => { state.promoOnly = !state.promoOnly; els.promo.classList.toggle("button-primary", state.promoOnly); renderCatalog(); });
    $("#qtyMinus").addEventListener("click", () => setQuantity(state.quantity - 1));
    $("#qtyPlus").addEventListener("click", () => setQuantity(state.quantity + 1));
    $("#addToCart").addEventListener("click", addSelectedToCart);
    $("#checkoutButton").addEventListener("click", openCheckout);
    $("#checkoutForm").addEventListener("submit", placeOrder);
    $("#checkoutCep").addEventListener("input", event => handleCepInput(event, $("#checkoutForm"), $("#cepStatus")));
    $("#checkoutCep").addEventListener("blur", event => lookupCep(event.target, $("#checkoutForm"), $("#cepStatus")));
    $("#addressCep").addEventListener("input", event => handleCepInput(event, $("#addressForm"), $("#addressCepStatus")));
    $("#addressCep").addEventListener("blur", event => lookupCep(event.target, $("#addressForm"), $("#addressCepStatus")));
    $$('[data-close]').forEach(button => button.addEventListener("click", () => document.getElementById(`${button.dataset.close}Dialog`)?.close()));
    $("#checkoutForm").addEventListener("change", event => {
      if (event.target.name === "order_type") { $(".address-fields").classList.toggle("hidden", event.target.value === "pickup"); renderCart(); }
      if (event.target.name === "payment_method") { $(".cash-field").classList.toggle("hidden", event.target.value !== "cash"); $(".card-field").classList.toggle("hidden", event.target.value !== "card"); }
      if (event.target.name === "save_address") syncAddressSaveFields();
    });
    $("#savedAddressSelect").addEventListener("change", selectCheckoutAddress);
    $("#editCheckoutAddress").addEventListener("click", () => $("#checkoutForm [name=street]").focus());
    $("#authButton").addEventListener("click", openAuth);
    $("#authForm").addEventListener("submit", sendAuthCode);
    $("#verifyCodeButton").addEventListener("click", verifyAuthCode);
    $("#resendCodeButton").addEventListener("click", sendAuthCode);
    $("#savePasswordButton").addEventListener("click", savePassword);
    $("#accountSignOut").addEventListener("click", signOut);
    $("#newAddress").addEventListener("click", () => openAddressEditor());
    $("#refreshHistory").addEventListener("click", async () => { await loadAccountData(); toast("Histórico atualizado."); });
    $("#addressForm").addEventListener("submit", saveAddress);
    $("#successWhatsapp").addEventListener("click", () => openWhatsapp(state.lastOrder));
    $("#successPdf").addEventListener("click", () => downloadOrderPdf(state.lastOrder));
    $("#successHistory").addEventListener("click", async () => { els.successDialog.close(); await openAuth(); });
    $$('[data-password-toggle]').forEach(button => button.addEventListener("click", () => togglePassword(button)));
    $$("#authForm [data-auth-mode]").forEach(button => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
    $("#authCode").addEventListener("input", event => event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6));
    $("#accountAddresses").addEventListener("click", accountAddressAction);
    $("#accountOrders").addEventListener("click", accountOrderAction);
    document.addEventListener("click", event => {
      const add = event.target.closest("[data-product-id]"); if (add) openProduct(add.dataset.productId);
      const category = event.target.closest("[data-category-id]"); if (category) selectCategory(category.dataset.categoryId);
      const cartAction = event.target.closest("[data-cart-action]"); if (cartAction) updateCartItem(Number(cartAction.dataset.index), cartAction.dataset.cartAction);
    });
  }

  async function loadCatalog() {
    try {
      const [categories, products, groups, options] = await Promise.all([
        db.from("categories").select("*").order("position"), db.from("products").select("*").order("position"),
        db.from("option_groups").select("*").order("position"), db.from("product_options").select("*").order("position")
      ]);
      for (const result of [categories, products, groups, options]) if (result.error) throw result.error;
      const optionsByGroup = groupBy(options.data, option => option.group_id);
      const groupsByProduct = groupBy(groups.data, group => group.product_id);
      state.products = products.data.map(product => ({
        ...product, name: tools().displayName(product.name), image_url: localImage(product.image_url),
        option_groups: (groupsByProduct[product.id] || []).map(group => ({ ...group, product_options: optionsByGroup[group.id] || [] }))
      }));
      state.categories = categories.data.map(category => ({
        ...category, name: tools().displayName(category.name), products: state.products.filter(product => product.category_id === category.id)
      }));
    } catch (error) {
      console.error(error); state.backend = false;
      const raw = await fetch("/data/catalog.json").then(response => response.json());
      const names = [...new Set(raw.map(product => product.category === "carne no peso m" ? "carnes no peso" : tools().displayName(product.category)))];
      state.categories = names.map((name, index) => ({ id: `fallback-cat-${index}`, name, slug: `cat-${index}`, position: index, products: [] }));
      state.products = raw.map((product, index) => {
        const categoryName = product.category === "carne no peso m" ? "carnes no peso" : tools().displayName(product.category);
        const category = state.categories.find(item => item.name === categoryName);
        const mapped = {
          id: `fallback-${product.source_id}`, name: tools().displayName(product.name), description: product.description, price: product.price,
          old_price: product.old_price, image_url: localImage(product.image_url), featured: product.category.toLocaleLowerCase("pt-BR").includes("promo"), category_id: category.id,
          option_groups: product.option_groups.map((group, groupIndex) => ({
            id: `fg-${index}-${groupIndex}`, name: group.name, min_select: group.min, max_select: group.max, required: group.required,
            selection_type: group.type, product_options: group.options.map((option, optionIndex) => ({ id: `fo-${index}-${groupIndex}-${optionIndex}`, name: option.name, price_delta: option.price, active: true }))
          }))
        };
        category.products.push(mapped); return mapped;
      });
      toast("Cardápio em modo de leitura. Pedidos voltarão após a conexão.");
    } finally { els.loading.classList.add("hidden"); }
  }

  async function loadSettings() {
    const { data, error } = await db.from("store_settings").select("*").eq("id", true).maybeSingle();
    state.settings = !error && data ? data : {
      name: "CHURRASCARIA CARNE DE SOL", whatsapp: "5585986129964", address: "Av. Castelo de Castro, 643 - Jangurussu",
      city: "Fortaleza", state: "CE", delivery_fee: 0, delivery_eta_minutes: 60, maintenance_mode: false,
      opening_hours: { "0":["07:00","15:00"], "1":["07:00","15:00"], "2":["07:00","15:00"], "3":["07:00","15:00"], "4":["07:00","15:00"], "5":["07:00","15:00"], "6":["07:00","15:00"] }, manual_status: "auto"
    };
  }

  function reconcileCart() {
    let changed = false;
    state.cart = state.cart.map(item => {
      const product = state.products.find(candidate => candidate.id === item.product_id);
      if (!product) { changed = true; return null; }
      const allowed = new Set(); const selected = new Set(item.option_ids || []);
      for (const group of product.option_groups || []) {
        const valid = (group.product_options || []).filter(option => option.active !== false && selected.has(option.id)).slice(0, Number(group.max_select));
        valid.forEach(option => allowed.add(option.id));
        if (valid.length !== (group.product_options || []).filter(option => selected.has(option.id)).length) changed = true;
      }
      const optionIds = [...allowed];
      const options = (product.option_groups || []).flatMap(group => (group.product_options || []).filter(option => allowed.has(option.id)).map(option => ({ id: option.id, group: group.name, name: option.name, price: Number(option.price_delta || 0) })));
      const unitPrice = Number(product.price || 0) + options.reduce((sum, option) => sum + option.price, 0);
      if (unitPrice !== Number(item.unit_price) || item.name !== product.name) changed = true;
      return { ...item, name: product.name, image_url: product.image_url, unit_price: unitPrice, option_ids: optionIds, options };
    }).filter(Boolean);
    if (changed) { saveCart(); toast("O carrinho foi corrigido para respeitar uma única opção em cada grupo exclusivo.", 5500); }
  }

  function renderCatalog() {
    const query = state.query; let visibleCount = 0;
    els.categories.innerHTML = state.categories.map(category => `<button type="button" data-category-id="${category.id}" class="${state.activeCategory === category.id ? "active" : ""}">${escapeHtml(category.name)} <small>${category.products.length}</small></button>`).join("");
    els.sections.innerHTML = state.categories.map(category => {
      const products = category.products.filter(product => {
        const haystack = `${product.name} ${product.description || ""}`.toLocaleLowerCase("pt-BR");
        return (!query || haystack.includes(query)) && (!state.promoOnly || product.featured);
      });
      if (!products.length) return "";
      visibleCount += products.length;
      return `<section class="catalog-section" id="category-${category.id}"><div class="section-heading"><h2>${escapeHtml(category.name)}</h2><span>${products.length} ${products.length === 1 ? "item" : "itens"}</span></div><div class="product-grid">${products.map(productCard).join("")}</div></section>`;
    }).join("");
    els.empty.classList.toggle("hidden", visibleCount > 0);
  }

  function productCard(product) {
    const old = Number(product.old_price) > Number(product.price || 0) ? `<span class="old-price">${money(product.old_price)}</span>` : "";
    return `<article class="product-card"><div class="product-image">${product.featured ? '<span class="badge">PROMOÇÃO</span>' : ""}<img src="${escapeHtml(product.image_url || "/assets/favicon.svg")}" alt="${escapeHtml(product.name)}" loading="lazy" onerror="this.src='/assets/favicon.svg'"></div><div class="product-info"><h3>${escapeHtml(product.name)}</h3><p class="product-description">${escapeHtml(product.description || "Escolha suas opções ao adicionar.")}</p><div class="product-footer"><div class="price-wrap">${old}<span class="current-price">${displayPrice(product)}</span></div><button type="button" class="add-button" data-product-id="${product.id}" aria-label="Adicionar ${escapeHtml(product.name)}">+</button></div></div></article>`;
  }

  function displayPrice(product) {
    if (product.price !== null && product.price !== undefined) return money(product.price);
    const required = (product.option_groups || []).filter(group => group.required || Number(group.min_select) > 0).flatMap(group => group.product_options || []).map(option => Number(option.price_delta)).filter(value => value > 0);
    const all = (product.option_groups || []).flatMap(group => group.product_options || []).map(option => Number(option.price_delta)).filter(value => value > 0);
    const min = Math.min(...(required.length ? required : all));
    return Number.isFinite(min) ? `<span class="from-price">A PARTIR DE</span>${money(min)}` : "Escolha as opções";
  }

  function selectCategory(id) {
    state.activeCategory = id; $$(".category-list button").forEach(button => button.classList.toggle("active", button.dataset.categoryId === id));
    $("#category-" + CSS.escape(id))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openProduct(id) {
    const product = state.products.find(item => item.id === id); if (!product) return;
    state.selected = product; state.quantity = 1;
    $("#dialogImage").src = product.image_url || "/assets/favicon.svg"; $("#dialogImage").alt = product.name;
    $("#dialogCategory").textContent = state.categories.find(category => category.id === product.category_id)?.name || "";
    $("#dialogName").textContent = product.name; $("#dialogDescription").textContent = product.description || "Monte do seu jeito."; $("#dialogPrice").innerHTML = displayPrice(product);
    els.optionGroups.innerHTML = (product.option_groups || []).map(group => `<fieldset class="option-group" data-group-id="${group.id}" data-min="${group.min_select}" data-max="${group.max_select}"><legend class="option-heading"><span>${escapeHtml(group.name)}</span><small>${Number(group.min_select) > 0 ? "Obrigatório" : "Opcional"} • até ${group.max_select}</small></legend><div class="option-list">${(group.product_options || []).filter(option => option.active !== false).map(option => `<label class="option-choice"><input type="${Number(group.max_select) === 1 ? "radio" : "checkbox"}" name="group-${group.id}" value="${option.id}" data-price="${option.price_delta || 0}"><span>${escapeHtml(option.name)}</span><strong>${Number(option.price_delta) > 0 ? "+ " + money(option.price_delta) : ""}</strong></label>`).join("")}</div></fieldset>`).join("");
    $$("input", els.optionGroups).forEach(input => input.addEventListener("change", event => { enforceGroup(event.target); updateAddTotal(); }));
    $("#itemNotes").value = ""; setQuantity(1); els.productDialog.showModal();
    requestAnimationFrame(() => { $(".dialog-frame", els.productDialog).scrollTop = 0; $(".dialog-content", els.productDialog).scrollTop = 0; });
  }

  function enforceGroup(input) { const fieldset = input.closest("fieldset"), max = Number(fieldset.dataset.max), checked = $$("input:checked", fieldset); if (checked.length > max) { input.checked = false; toast(`Escolha no máximo ${max} opção(ões).`); } }
  function selectedOptions() { return $$("input:checked", els.optionGroups).map(input => input.value); }
  function currentUnitPrice() { return Number(state.selected?.price || 0) + $$("input:checked", els.optionGroups).reduce((sum, input) => sum + Number(input.dataset.price || 0), 0); }
  function setQuantity(value) { state.quantity = Math.min(20, Math.max(1, value)); $("#qtyValue").textContent = state.quantity; updateAddTotal(); }
  function updateAddTotal() { $("#addTotal").textContent = money(currentUnitPrice() * state.quantity); }
  function validateOptions() {
    for (const fieldset of $$("fieldset", els.optionGroups)) {
      const count = $$("input:checked", fieldset).length, min = Number(fieldset.dataset.min), max = Number(fieldset.dataset.max);
      if (count < min || count > max) { fieldset.scrollIntoView({ behavior: "smooth", block: "center" }); toast(`Revise: ${$("legend span", fieldset).textContent}`); return false; }
    }
    if (currentUnitPrice() <= 0) { toast("Escolha a opção que define o preço."); return false; } return true;
  }
  function addSelectedToCart() {
    if (!validateOptions()) return;
    const optionIds = selectedOptions();
    const options = (state.selected.option_groups || []).flatMap(group => (group.product_options || []).filter(option => optionIds.includes(option.id)).map(option => ({ id: option.id, group: group.name, name: option.name, price: Number(option.price_delta || 0) })));
    state.cart.push({ product_id: state.selected.id, name: state.selected.name, image_url: state.selected.image_url, quantity: state.quantity, unit_price: currentUnitPrice(), option_ids: optionIds, options, notes: $("#itemNotes").value.trim() });
    invalidateOrderRequest(); saveCart(); renderCart(); els.productDialog.close(); toast("Item adicionado ao carrinho.");
  }

  function renderCart() {
    const count = state.cart.reduce((total, item) => total + item.quantity, 0), subtotal = state.cart.reduce((total, item) => total + item.unit_price * item.quantity, 0);
    const delivery = $("#checkoutForm [name=order_type]:checked")?.value === "pickup" ? 0 : Number(state.settings?.delivery_fee || 0);
    els.cartCount.textContent = count; els.cartSubtotal.textContent = money(subtotal); $("#checkoutTotal").textContent = money(subtotal + delivery);
    els.cartItems.innerHTML = state.cart.length ? state.cart.map((item, index) => `<article class="cart-item"><h3>${escapeHtml(item.name)}</h3><strong>${money(item.unit_price * item.quantity)}</strong><p>${escapeHtml(item.options.map(option => tools().displayName(option.name)).join(", ") || "Sem complementos")}${item.notes ? `<br><b>Obs.:</b> ${escapeHtml(item.notes)}` : ""}</p><div class="cart-item-actions"><button type="button" data-index="${index}" data-cart-action="minus">−</button><b>${item.quantity}</b><button type="button" data-index="${index}" data-cart-action="plus">+</button><button type="button" class="remove-link" data-index="${index}" data-cart-action="remove">Remover</button></div></article>`).join("") : `<div class="empty-state"><span>🛒</span><h2>Seu carrinho está vazio</h2><p>Adicione um prato para continuar.</p></div>`;
    $("#checkoutButton").disabled = !state.cart.length || !state.backend || Boolean(state.settings?.maintenance_mode);
    $("#checkoutButton").textContent = state.settings?.maintenance_mode ? "Pedidos temporariamente desligados" : "Continuar pedido";
  }
  function updateCartItem(index, action) { const item = state.cart[index]; if (!item) return; if (action === "plus") item.quantity = Math.min(99, item.quantity + 1); if (action === "minus") item.quantity = Math.max(1, item.quantity - 1); if (action === "remove") state.cart.splice(index, 1); invalidateOrderRequest(); saveCart(); renderCart(); }
  function loadCart() { try { return JSON.parse(localStorage.getItem("carne-sol-cart") || "[]"); } catch { return []; } }
  function saveCart() { localStorage.setItem("carne-sol-cart", JSON.stringify(state.cart)); }
  function invalidateOrderRequest() { localStorage.removeItem("carne-sol-order-request"); }
  function orderRequestId() { let id = localStorage.getItem("carne-sol-order-request"); if (!id) { id = crypto.randomUUID(); localStorage.setItem("carne-sol-order-request", id); } return id; }

  async function openCheckout() {
    if (!state.cart.length) return;
    if (!state.session) { state.pendingCheckout = true; els.cartDialog.close(); await openAuth(); showMessage(els.authMessage, "Entre na sua conta para salvar o endereço e acompanhar o pedido.", "success"); return; }
    if (state.settings?.maintenance_mode) { toast("Os pedidos estão temporariamente desligados."); return; }
    els.cartDialog.close(); await loadAccountData();
    const form = $("#checkoutForm"); form.elements.email.value = state.session.user.email || state.profile?.email || ""; form.elements.customer_name.value = state.profile?.full_name || ""; form.elements.phone.value = state.profile?.phone || "";
    form.elements.order_type.value = "delivery"; $(".address-fields").classList.remove("hidden"); renderCheckoutAddresses(); renderCart(); showMessage($("#checkoutMessage"), ""); els.checkoutDialog.showModal();
  }

  function renderCheckoutAddresses(preferredId) {
    const select = $("#savedAddressSelect"); $("#savedAddressArea").classList.toggle("hidden", !state.addresses.length);
    select.innerHTML = '<option value="new">Usar outro endereço</option>' + state.addresses.map(address => `<option value="${address.id}">${address.is_default ? "★ " : ""}${escapeHtml(address.label)} — ${escapeHtml(address.street)}, ${escapeHtml(address.number)}</option>`).join("");
    const selected = state.addresses.find(address => address.id === preferredId) || state.addresses.find(address => address.is_default) || state.addresses[0]; select.value = selected?.id || "new"; selectCheckoutAddress();
  }
  function selectCheckoutAddress() {
    const selected = state.addresses.find(address => address.id === $("#savedAddressSelect").value), form = $("#checkoutForm");
    if (selected) fillAddressForm(form, selected); else clearAddressForm(form);
    form.elements.save_address.checked = true; form.elements.address_label.value = selected?.label || "Casa"; form.elements.set_default_address.checked = Boolean(selected?.is_default);
    $("#editCheckoutAddress").disabled = !selected; syncAddressSaveFields();
  }
  function syncAddressSaveFields() { const show = $("#checkoutForm [name=save_address]").checked; $$(".address-save-field").forEach(element => element.classList.toggle("hidden", !show)); }

  function cepDigits(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
  function formatCep(value) { const digits = cepDigits(value); return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits; }
  function setCepStatus(element, text, type = "") { element.textContent = text; element.className = `field-status ${type}`; }
  function clearAddressForm(form) { ["postal_code", "street", "number", "complement", "neighborhood", "city", "state", "reference"].forEach(name => { if (form.elements[name]) form.elements[name].value = ""; }); const input = form.elements.postal_code; if (input) delete input.dataset.lastCep; }
  function fillAddressForm(form, address) { ["postal_code", "street", "number", "complement", "neighborhood", "city", "state", "reference"].forEach(name => { if (form.elements[name]) form.elements[name].value = address[name] || ""; }); form.elements.postal_code.dataset.lastCep = cepDigits(address.postal_code); }
  function handleCepInput(event, form, status) { const input = event.target, previous = input.dataset.lastCep || "", digits = cepDigits(input.value); input.value = formatCep(digits); if (previous && digits !== previous) { delete input.dataset.lastCep; ["street", "number", "neighborhood", "city", "state"].forEach(name => form.elements[name].value = ""); } if (digits.length === 8) lookupCep(input, form, status); else { cepRequest?.abort(); setCepStatus(status, "Digite os 8 números do CEP."); } }
  async function lookupCep(input, form, status) {
    const cep = cepDigits(input.value); if (cep.length !== 8 || input.dataset.lastCep === cep) return;
    cepRequest?.abort(); cepRequest = new AbortController(); setCepStatus(status, "Buscando endereço…", "loading");
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: cepRequest.signal }); if (!response.ok) throw new Error("CEP indisponível");
      const address = await response.json(); if (address.erro) throw new Error("CEP não encontrado");
      input.value = formatCep(address.cep || cep); input.dataset.lastCep = cep; form.elements.street.value = address.logradouro || ""; form.elements.neighborhood.value = address.bairro || ""; form.elements.city.value = address.localidade || ""; form.elements.state.value = address.uf || "";
      const missing = !address.logradouro ? "street" : !address.bairro ? "neighborhood" : !address.localidade ? "city" : "number";
      setCepStatus(status, missing === "number" ? "Endereço encontrado. Agora digite o número." : "CEP encontrado. Complete os campos que faltam.", "success"); form.elements[missing].focus();
    } catch (error) { if (error.name === "AbortError") return; delete input.dataset.lastCep; setCepStatus(status, "CEP não encontrado. Preencha o endereço manualmente.", "error"); form.elements.street.focus(); }
  }

  async function placeOrder(event) {
    event.preventDefault(); if (!state.session) { els.checkoutDialog.close(); state.pendingCheckout = true; await openAuth(); return; }
    const form = event.currentTarget, button = $("#placeOrder"), message = $("#checkoutMessage"), data = Object.fromEntries(new FormData(form));
    if (data.order_type === "delivery" && cepDigits(data.postal_code).length !== 8) return showMessage(message, "Digite um CEP válido com 8 números.", "error");
    if (data.order_type === "delivery" && (!data.street || !data.number || !data.neighborhood || !data.city || !data.state)) return showMessage(message, "Complete endereço, número, bairro, cidade e estado.", "error");
    const requestId = orderRequestId();
    const payload = {
      client_request_id: requestId, customer_name: data.customer_name, email: data.email, phone: data.phone, order_type: data.order_type,
      payment_method: data.payment_method, payment_detail: data.payment_method === "card" ? data.payment_detail : null, change_for: data.payment_method === "cash" ? data.change_for : null, notes: data.notes,
      address: data.order_type === "delivery" ? { postal_code: formatCep(data.postal_code), street: data.street, number: data.number, complement: data.complement, neighborhood: data.neighborhood, city: data.city, state: data.state.toUpperCase(), reference: data.reference } : null,
      address_id: $("#savedAddressSelect").value === "new" ? null : $("#savedAddressSelect").value, save_address: data.order_type === "delivery" && Boolean(data.save_address), address_label: data.address_label || "Casa", set_default_address: Boolean(data.set_default_address),
      items: state.cart.map(item => ({ product_id: item.product_id, quantity: item.quantity, option_ids: item.option_ids, notes: item.notes }))
    };
    const cartSnapshot = state.cart.map(item => ({ ...item, options: item.options.map(option => ({ ...option })) })), whatsappWindow = window.open("about:blank", "carne-sol-whatsapp");
    button.disabled = true; button.textContent = "Registrando pedido…"; showMessage(message, "Não feche esta tela. Estamos confirmando seu pedido.");
    let order, error;
    try {
      ({ data: order, error } = await db.rpc("create_order", { payload }));
      if (error) { const recovery = await db.from("orders").select("*,order_items(*)").eq("client_request_id", requestId).maybeSingle(); if (!recovery.error && recovery.data) { order = recovery.data; error = null; } }
    } catch (caught) { error = caught; }
    button.disabled = false; button.textContent = "Enviar pedido";
    if (error || !order) { whatsappWindow?.close(); showMessage(message, friendlyOrderError(error?.message), "error"); return; }
    const receipt = order.order_items ? order : {
      ...order, customer_name: payload.customer_name, email: payload.email, phone: payload.phone, order_type: payload.order_type, payment_method: payload.payment_method, payment_detail: payload.payment_detail,
      change_for: payload.change_for, notes: payload.notes, address: payload.address, status: order.status || "pending", created_at: order.created_at || new Date().toISOString(),
      order_items: cartSnapshot.map(item => ({ product_name: item.name, quantity: item.quantity, unit_price: item.unit_price, line_total: item.unit_price * item.quantity, selections: item.options, notes: item.notes }))
    };
    state.lastOrder = receipt; const whatsappUrl = tools().whatsappUrl(receipt, state.settings.whatsapp); if (whatsappWindow) whatsappWindow.location.href = whatsappUrl;
    state.cart = []; saveCart(); invalidateOrderRequest(); renderCart(); form.reset(); delete $("#checkoutCep").dataset.lastCep; setCepStatus($("#cepStatus"), "Digite o CEP para preencher o endereço."); els.checkoutDialog.close();
    await loadAccountData(); showOrderSuccess(receipt);
  }
  function friendlyOrderError(message = "") { if (/Entre na sua conta|bloqueada|mínimo|indisponível|manutenção|fechada|endereço|seleção|produto/i.test(message)) return message; return "Não foi possível confirmar agora. Seu carrinho foi mantido; toque em Enviar pedido novamente para verificar sem duplicar."; }
  function showOrderSuccess(order) { $("#successTitle").textContent = `Pedido #${order.order_number} confirmado!`; $("#successSummary").textContent = `Total ${money(order.total)} • prazo estimado de ${order.delivery_eta_minutes || 60} minutos. O pedido já está salvo no seu histórico.`; const map = tools().mapUrl(order.address); $("#successMap").classList.toggle("hidden", !map); if (map) $("#successMap").href = map; els.successDialog.showModal(); }
  function openWhatsapp(order) { if (order) window.open(tools().whatsappUrl(order, state.settings.whatsapp), "_blank", "noopener"); }
  async function downloadOrderPdf(order) { if (!order) return; try { await tools().downloadPdf(order, state.settings); } catch (error) { toast(error.message, 5500); } }

  async function refreshSession() { const { data: { session } } = await db.auth.getSession(); state.session = session; $("#authButton").textContent = session ? "Minha conta" : "Entrar"; if (session) await loadAccountData(); }
  async function loadAccountData() {
    if (!state.session) { state.profile = null; state.addresses = []; state.orders = []; return; }
    const [profile, addresses, orders] = await Promise.all([
      db.from("profiles").select("*").eq("id", state.session.user.id).maybeSingle(), db.from("saved_addresses").select("*").order("is_default", { ascending: false }).order("last_used_at", { ascending: false }),
      db.from("orders").select("*,order_items(*)").order("created_at", { ascending: false }).limit(100)
    ]);
    if (!profile.error) state.profile = profile.data; if (!addresses.error) state.addresses = addresses.data || []; if (!orders.error) state.orders = orders.data || []; renderAccount();
  }
  async function openAuth() {
    showMessage(els.authMessage, "");
    if (state.session) { await loadAccountData(); $("#authAccessPanel").classList.add("hidden"); $("#accountPanel").classList.remove("hidden"); renderAccount(); }
    else { $("#accountPanel").classList.add("hidden"); $("#authAccessPanel").classList.remove("hidden"); setAuthMode("login"); $("#authRequestStep").classList.remove("hidden"); $("#authVerifyStep").classList.add("hidden"); $("#passwordStep").classList.add("hidden"); $("#newPassword").value = ""; $("#confirmPassword").value = ""; resetPasswordVisibility(); }
    if (!els.authDialog.open) els.authDialog.showModal();
  }
  function renderAccount() {
    if (!state.session) return;
    $("#accountName").textContent = state.profile?.full_name || "cliente"; $("#accountEmail").textContent = state.session.user.email || state.profile?.email || "";
    $("#accountAddresses").innerHTML = state.addresses.length ? state.addresses.map(address => `<article class="address-card"><div><strong>${address.is_default ? "★ " : ""}${escapeHtml(address.label)}</strong><p>${escapeHtml(tools().fullAddress(address)).replace(/\n/g, "<br>")}</p></div><div class="card-actions"><button class="button button-ghost" type="button" data-address-action="use" data-id="${address.id}">Usar</button><button class="button button-ghost" type="button" data-address-action="edit" data-id="${address.id}">Editar</button><button class="button button-danger" type="button" data-address-action="delete" data-id="${address.id}">Excluir</button></div></article>`).join("") : '<div class="empty-compact"><p>Nenhum endereço salvo ainda.</p></div>';
    $("#accountOrders").innerHTML = state.orders.length ? state.orders.map(customerOrderCard).join("") : '<div class="empty-compact"><p>Seus pedidos aparecerão aqui.</p></div>';
  }
  function customerOrderCard(order) {
    const map = tools().mapUrl(order.address);
    const itemHtml = (order.order_items || []).map(item => `<li><strong>${item.quantity}x ${escapeHtml(tools().displayName(item.product_name))}</strong> — ${money(item.line_total)}${(item.selections || []).length ? `<small>${(item.selections || []).map(selection => escapeHtml(tools().displayName(selection.name))).join(", ")}</small>` : ""}${item.notes ? `<small>Obs.: ${escapeHtml(item.notes)}</small>` : ""}</li>`).join("");
    return `<article class="history-card"><header><div><h3>Pedido #${order.order_number}</h3><p>${tools().dateTime(order.created_at)} • ${tools().statusLabel(order.status)}</p></div><strong>${money(order.total)}</strong></header><details><summary>Ver detalhes</summary><ul>${itemHtml}</ul><p>${escapeHtml(tools().fullAddress(order.address)).replace(/\n/g, "<br>")}</p></details><div class="card-actions"><button class="button button-primary" type="button" data-order-action="whatsapp" data-id="${order.id}">📲 WhatsApp</button><button class="button button-ghost" type="button" data-order-action="pdf" data-id="${order.id}">📄 PDF</button>${map ? `<a class="button button-ghost" href="${map}" target="_blank" rel="noopener">🗺️ Mapa</a>` : ""}</div></article>`;
  }
  async function accountAddressAction(event) {
    const button = event.target.closest("[data-address-action]"); if (!button) return; const address = state.addresses.find(item => item.id === button.dataset.id); if (!address) return;
    if (button.dataset.addressAction === "edit") openAddressEditor(address);
    if (button.dataset.addressAction === "use") { state.pendingCheckout = false; els.authDialog.close(); if (!state.cart.length) return toast("Adicione um item ao carrinho para usar este endereço."); await openCheckout(); renderCheckoutAddresses(address.id); }
    if (button.dataset.addressAction === "delete") { if (!confirm(`Excluir o endereço “${address.label}”?`)) return; const { error } = await db.from("saved_addresses").delete().eq("id", address.id); if (error) return toast("Não foi possível excluir o endereço."); await loadAccountData(); toast("Endereço excluído."); }
  }
  function accountOrderAction(event) { const button = event.target.closest("[data-order-action]"); if (!button) return; const order = state.orders.find(item => item.id === button.dataset.id); if (!order) return; if (button.dataset.orderAction === "whatsapp") openWhatsapp(order); if (button.dataset.orderAction === "pdf") downloadOrderPdf(order); }
  function openAddressEditor(address = null) { const form = $("#addressForm"); form.reset(); clearAddressForm(form); form.elements.id.value = address?.id || ""; form.elements.label.value = address?.label || "Casa"; if (address) { fillAddressForm(form, address); form.elements.is_default.checked = address.is_default; } $("#addressDialogTitle").textContent = address ? "Editar endereço" : "Novo endereço"; showMessage($("#addressMessage"), ""); els.addressDialog.showModal(); }
  async function saveAddress(event) {
    event.preventDefault(); const form = event.currentTarget, data = Object.fromEntries(new FormData(form)); if (cepDigits(data.postal_code).length !== 8) return showMessage($("#addressMessage"), "Digite um CEP válido.", "error");
    const payload = { user_id: state.session.user.id, label: data.label.trim(), postal_code: formatCep(data.postal_code), street: data.street.trim(), number: data.number.trim(), complement: data.complement.trim() || null, neighborhood: data.neighborhood.trim(), city: data.city.trim(), state: data.state.trim().toUpperCase(), reference: data.reference.trim() || null, is_default: Boolean(data.is_default), last_used_at: new Date().toISOString() };
    const result = data.id ? await db.from("saved_addresses").update(payload).eq("id", data.id).select().single() : await db.from("saved_addresses").insert(payload).select().single();
    if (result.error) return showMessage($("#addressMessage"), "Não foi possível salvar o endereço.", "error"); els.addressDialog.close(); await loadAccountData(); toast("Endereço salvo.");
  }
  async function signOut() { await db.auth.signOut(); state.session = null; state.profile = null; state.addresses = []; state.orders = []; els.authDialog.close(); $("#authButton").textContent = "Entrar"; toast("Você saiu da conta."); }

  function setAuthMode(mode) { state.authMode = mode; const signup = mode === "signup"; $(".signup-only").classList.toggle("hidden", !signup); $("#authTitle").textContent = signup ? "Criar cadastro" : mode === "recovery" ? "Recuperar acesso" : "Entrar com código"; $("#authHelp").textContent = mode === "recovery" ? "Enviaremos um código numérico. Depois você poderá criar uma nova senha." : "Digite seu e-mail. Enviaremos um código numérico de acesso."; }
  async function sendAuthCode(event) {
    event?.preventDefault(); const email = $("#authEmail").value.trim().toLowerCase(); if (!email || !email.includes("@")) return showMessage(els.authMessage, "Digite um e-mail válido.", "error");
    const button = $("#sendCodeButton"); button.disabled = true; const { data, error } = await db.functions.invoke("request-auth-code", { body: { email, mode: state.authMode, fullName: state.authMode === "signup" ? $("#authName").value.trim() : "" } }); button.disabled = false;
    if (error || data?.ok === false) return showMessage(els.authMessage, "O serviço de e-mail está temporariamente indisponível. Tente novamente.", "error");
    $("#authRequestStep").classList.add("hidden"); $("#authVerifyStep").classList.remove("hidden"); showMessage(els.authMessage, "Se este e-mail estiver cadastrado, enviaremos um código numérico.", "success"); $("#authCode").focus();
  }
  async function verifyAuthCode() {
    const code = $("#authCode").value.replace(/\D/g, ""); if (!/^\d{6}$/.test(code)) return showMessage(els.authMessage, "Digite os 6 números enviados ao seu e-mail.", "error");
    const button = $("#verifyCodeButton"); button.disabled = true; const email = $("#authEmail").value.trim().toLowerCase(); const { data, error } = await db.functions.invoke("verify-auth-code", { body: { email, code } });
    if (error || !data?.ok || !data?.access_token || !data?.refresh_token) { button.disabled = false; return showMessage(els.authMessage, "Código inválido ou expirado. Solicite um novo código.", "error"); }
    const { data: sessionData, error: sessionError } = await db.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token }); button.disabled = false; if (sessionError) return showMessage(els.authMessage, "Não foi possível concluir o acesso. Solicite um novo código.", "error");
    state.session = sessionData.session; await loadAccountData(); if (state.authMode === "signup" || state.authMode === "recovery") { $("#authVerifyStep").classList.add("hidden"); $("#passwordStep").classList.remove("hidden"); showMessage(els.authMessage, "Código confirmado. Crie uma senha com pelo menos 8 caracteres.", "success"); } else await finishLogin();
  }
  async function savePassword() {
    const password = $("#newPassword").value, confirmation = $("#confirmPassword").value; if (password.length < 8) return showMessage(els.authMessage, "Use pelo menos 8 caracteres.", "error"); if (password !== confirmation) return showMessage(els.authMessage, "As senhas não são iguais. Confira e tente novamente.", "error");
    const button = $("#savePasswordButton"); button.disabled = true; const { error } = await db.auth.updateUser({ password }); button.disabled = false; if (error) return showMessage(els.authMessage, "Não foi possível salvar a senha. Tente novamente.", "error"); await finishLogin();
  }
  async function finishLogin() { $("#authButton").textContent = "Minha conta"; if (state.pendingCheckout) { state.pendingCheckout = false; els.authDialog.close(); await openCheckout(); return; } $("#authAccessPanel").classList.add("hidden"); $("#accountPanel").classList.remove("hidden"); renderAccount(); }
  function togglePassword(button) { const input = $("#" + button.dataset.passwordToggle), show = input.type === "password"; input.type = show ? "text" : "password"; button.setAttribute("aria-pressed", String(show)); button.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha"); button.title = show ? "Ocultar senha" : "Mostrar senha"; input.focus(); }
  function resetPasswordVisibility() { $$('[data-password-toggle]').forEach(button => { const input = $("#" + button.dataset.passwordToggle); input.type = "password"; button.setAttribute("aria-pressed", "false"); button.setAttribute("aria-label", "Mostrar senha"); button.title = "Mostrar senha"; }); }

  function updateStoreInfo() {
    const settings = state.settings; if (!settings) return; $("#bannerTitle").textContent = settings.banner_title || $("#bannerTitle").textContent; $("#bannerText").textContent = settings.banner_text || $("#bannerText").textContent;
    $("#storeAddress").textContent = `${settings.address}, ${settings.city} — ${settings.state}`; $("#whatsappHero").href = `https://wa.me/${settings.whatsapp}`;
    const open = isStoreOpen(settings), dot = $("#statusDot"); dot.className = `status-dot ${open ? "open" : "closed"}`; $("#storeStatus").textContent = settings.maintenance_mode ? "Pedidos temporariamente desligados" : open ? "Aberto agora" : "Fechado agora";
    $("#maintenanceNotice").classList.toggle("hidden", !settings.maintenance_mode); if (settings.maintenance_mode) $("#maintenanceNotice").textContent = "Estamos em manutenção temporária. O cardápio continua disponível para consulta, mas novos pedidos estão desligados."; renderCart();
  }
  function isStoreOpen(settings) { if (settings.manual_status === "open") return true; if (settings.manual_status === "closed") return false; const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Fortaleza", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map(part => [part.type, part.value])); const day = ({ Sun:"0", Mon:"1", Tue:"2", Wed:"3", Thu:"4", Fri:"5", Sat:"6" })[parts.weekday], hours = settings.opening_hours?.[day]; if (!hours) return false; const now = parts.hour.padStart(2, "0") + ":" + parts.minute; return now >= hours[0] && now < hours[1]; }
  function showMessage(element, text, type = "") { element.textContent = text; element.className = `form-message ${type}`; }
  function toast(text, duration = 3300) { const element = document.createElement("div"); element.className = "toast"; element.textContent = text; $("#toastRegion").append(element); setTimeout(() => element.remove(), duration); }
  function groupBy(items, keyFn) { return items.reduce((groups, item) => { const key = keyFn(item); (groups[key] ??= []).push(item); return groups; }, {}); }
  function localImage(value) { if (!value) return "/assets/favicon.svg"; try { const url = new URL(value, location.origin); if (url.hostname === "carnedosol.envoi.com.br" && url.pathname.includes("/midias/")) return "/products/" + url.pathname.split("/").pop(); } catch {} return value; }
})();
