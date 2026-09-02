(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { settings:null, categories:[], products:[], cart:loadCart(), selected:null, quantity:1, query:"", promoOnly:false, activeCategory:null, authMode:"login", backend:true };
  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    Object.assign(els, {
      categories:$("#categoryList"), sections:$("#productSections"), loading:$("#loadingGrid"), empty:$("#emptyState"),
      search:$("#searchInput"), promo:$("#promoFilter"), productDialog:$("#productDialog"), cartDialog:$("#cartDialog"),
      checkoutDialog:$("#checkoutDialog"), authDialog:$("#authDialog"), cartCount:$("#cartCount"), cartItems:$("#cartItems"),
      cartSubtotal:$("#cartSubtotal"), optionGroups:$("#optionGroups"), authMessage:$("#authMessage")
    });
    bindEvents();
    await Promise.all([loadCatalog(), loadSettings(), refreshSession()]);
    renderCatalog(); renderCart(); updateStoreInfo();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  function bindEvents() {
    $("#cartButton").addEventListener("click", () => { renderCart(); els.cartDialog.showModal(); });
    els.search.addEventListener("input", e => { state.query=e.target.value.trim().toLocaleLowerCase("pt-BR"); renderCatalog(); });
    els.promo.addEventListener("click", () => { state.promoOnly=!state.promoOnly; els.promo.classList.toggle("button-primary",state.promoOnly); renderCatalog(); });
    $("#qtyMinus").addEventListener("click", () => setQuantity(state.quantity-1));
    $("#qtyPlus").addEventListener("click", () => setQuantity(state.quantity+1));
    $("#addToCart").addEventListener("click", addSelectedToCart);
    $("#checkoutButton").addEventListener("click", openCheckout);
    $("#checkoutForm").addEventListener("submit", placeOrder);
    $$("[data-close]").forEach(b => b.addEventListener("click", () => b.dataset.close==="auth" ? els.authDialog.close() : els.checkoutDialog.close()));
    $("#checkoutForm").addEventListener("change", e => {
      if(e.target.name==="order_type") $(".address-fields").classList.toggle("hidden",e.target.value==="pickup");
      if(e.target.name==="payment_method") $(".cash-field").classList.toggle("hidden",e.target.value!=="cash");
    });
    $("#authButton").addEventListener("click", openAuth);
    $("#authForm").addEventListener("submit", sendAuthCode);
    $("#verifyCodeButton").addEventListener("click", verifyAuthCode);
    $("#resendCodeButton").addEventListener("click", sendAuthCode);
    $("#savePasswordButton").addEventListener("click", savePassword);
    $$("#authForm [data-auth-mode]").forEach(b => b.addEventListener("click", () => setAuthMode(b.dataset.authMode)));
    $("#authCode").addEventListener("input", e => e.target.value=e.target.value.replace(/\D/g,"").slice(0,6));
    document.addEventListener("click", e => {
      const add=e.target.closest("[data-product-id]"); if(add) openProduct(add.dataset.productId);
      const cat=e.target.closest("[data-category-id]"); if(cat) selectCategory(cat.dataset.categoryId);
      const cartAction=e.target.closest("[data-cart-action]"); if(cartAction) updateCartItem(Number(cartAction.dataset.index),cartAction.dataset.cartAction);
    });
  }

  async function loadCatalog() {
    try {
      const [catsRes, productsRes, groupsRes, optionsRes] = await Promise.all([
        db.from("categories").select("*").order("position"),
        db.from("products").select("*").order("position"),
        db.from("option_groups").select("*").order("position"),
        db.from("product_options").select("*").order("position")
      ]);
      for (const r of [catsRes,productsRes,groupsRes,optionsRes]) if(r.error) throw r.error;
      const optionsByGroup=groupBy(optionsRes.data, o=>o.group_id);
      const groupsByProduct=groupBy(groupsRes.data, g=>g.product_id);
      state.products=productsRes.data.map(p=>({...p,image_url:localImage(p.image_url),option_groups:(groupsByProduct[p.id]||[]).map(g=>({...g,product_options:optionsByGroup[g.id]||[]}))}));
      state.categories=catsRes.data.map(c=>({...c,products:state.products.filter(p=>p.category_id===c.id)}));
    } catch(error) {
      console.error(error); state.backend=false;
      const raw=await fetch("/data/catalog.json").then(r=>r.json());
      const names=[...new Set(raw.map(p=>p.category==="carne no peso m"?"carnes no peso":p.category))];
      state.categories=names.map((name,i)=>({id:"fallback-cat-"+i,name,slug:"cat-"+i,position:i,products:[]}));
      state.products=raw.map((p,i)=>{
        const catName=p.category==="carne no peso m"?"carnes no peso":p.category; const cat=state.categories.find(c=>c.name===catName);
        const mapped={id:"fallback-"+p.source_id,name:p.name,description:p.description,price:p.price,old_price:p.old_price,image_url:localImage(p.image_url),featured:p.category.toLowerCase().includes("promo"),category_id:cat.id,
          option_groups:p.option_groups.map((g,gi)=>({id:`fg-${i}-${gi}`,name:g.name,min_select:g.min,max_select:g.max,required:g.required,selection_type:g.type,product_options:g.options.map((o,oi)=>({id:`fo-${i}-${gi}-${oi}`,name:o.name,price_delta:o.price,active:true}))}))};
        cat.products.push(mapped); return mapped;
      });
      toast("Cardápio em modo de leitura. Pedidos voltarão após a conexão.");
    } finally { els.loading.classList.add("hidden"); }
  }

  async function loadSettings() {
    const {data,error}=await db.from("store_settings").select("*").eq("id",true).maybeSingle();
    state.settings=!error&&data?data:{name:"CHURRASCARIA CARNE DE SOL",whatsapp:"5585986129964",address:"Av. Castelo de Castro, 643 - Jangurussu",city:"Fortaleza",state:"CE",opening_hours:{"0":["07:00","15:00"],"1":["07:00","15:00"],"2":["07:00","15:00"],"3":["07:00","15:00"],"4":["07:00","15:00"],"5":["07:00","15:00"],"6":["07:00","15:00"]},manual_status:"auto"};
  }

  function renderCatalog() {
    const query=state.query; let visibleCount=0;
    els.categories.innerHTML=state.categories.map(c=>`<button type="button" data-category-id="${c.id}" class="${state.activeCategory===c.id?"active":""}">${escapeHtml(c.name)} <small>${c.products.length}</small></button>`).join("");
    els.sections.innerHTML=state.categories.map(category=>{
      let products=category.products.filter(p=>{
        const hay=`${p.name} ${p.description||""}`.toLocaleLowerCase("pt-BR");
        return (!query||hay.includes(query))&&(!state.promoOnly||p.featured);
      });
      if(!products.length) return ""; visibleCount+=products.length;
      return `<section class="catalog-section" id="category-${category.id}">
        <div class="section-heading"><h2>${escapeHtml(category.name)}</h2><span>${products.length} ${products.length===1?"item":"itens"}</span></div>
        <div class="product-grid">${products.map(productCard).join("")}</div></section>`;
    }).join("");
    els.empty.classList.toggle("hidden",visibleCount>0);
  }

  function productCard(p) {
    const old=Number(p.old_price)>Number(p.price||0)?`<span class="old-price">${money(p.old_price)}</span>`:"";
    const price=displayPrice(p);
    return `<article class="product-card">
      <div class="product-image">${p.featured?'<span class="badge">PROMOÇÃO</span>':""}<img src="${escapeHtml(p.image_url||"/assets/favicon.svg")}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.src='/assets/favicon.svg'"></div>
      <div class="product-info"><h3>${escapeHtml(p.name)}</h3><p class="product-description">${escapeHtml(p.description||"Escolha suas opções ao adicionar.")}</p>
        <div class="product-footer"><div class="price-wrap">${old}<span class="current-price">${price}</span></div>
        <button type="button" class="add-button" data-product-id="${p.id}" aria-label="Adicionar ${escapeHtml(p.name)}">+</button></div>
      </div></article>`;
  }

  function displayPrice(p) {
    if(p.price!==null&&p.price!==undefined) return money(p.price);
    const required=(p.option_groups||[]).filter(g=>g.required||Number(g.min_select)>0).flatMap(g=>g.product_options||[]).map(o=>Number(o.price_delta)).filter(n=>n>0);
    const all=(p.option_groups||[]).flatMap(g=>g.product_options||[]).map(o=>Number(o.price_delta)).filter(n=>n>0);
    const min=Math.min(...(required.length?required:all));
    return Number.isFinite(min)?`<span class="from-price">A PARTIR DE</span>${money(min)}`:"Escolha as opções";
  }

  function selectCategory(id) {
    state.activeCategory=id; $$(".category-list button").forEach(b=>b.classList.toggle("active",b.dataset.categoryId===id));
    $("#category-"+CSS.escape(id))?.scrollIntoView({behavior:"smooth",block:"start"});
  }

  function openProduct(id) {
    const p=state.products.find(item=>item.id===id); if(!p) return;
    state.selected=p; state.quantity=1;
    $("#dialogImage").src=p.image_url||"/assets/favicon.svg"; $("#dialogImage").alt=p.name;
    $("#dialogCategory").textContent=state.categories.find(c=>c.id===p.category_id)?.name||"";
    $("#dialogName").textContent=p.name; $("#dialogDescription").textContent=p.description||"Monte do seu jeito.";
    $("#dialogPrice").innerHTML=displayPrice(p);
    els.optionGroups.innerHTML=(p.option_groups||[]).map(group=>`<fieldset class="option-group" data-group-id="${group.id}" data-min="${group.min_select}" data-max="${group.max_select}">
      <legend class="option-heading"><span>${escapeHtml(group.name)}</span><small>${Number(group.min_select)>0?"Obrigatório":"Opcional"} • até ${group.max_select}</small></legend>
      <div class="option-list">${(group.product_options||[]).filter(o=>o.active!==false).map(option=>`<label class="option-choice"><input type="${Number(group.max_select)===1?"radio":"checkbox"}" name="group-${group.id}" value="${option.id}" data-price="${option.price_delta||0}"><span>${escapeHtml(option.name)}</span><strong>${Number(option.price_delta)>0?"+ "+money(option.price_delta):""}</strong></label>`).join("")}</div>
    </fieldset>`).join("");
    $$("input",els.optionGroups).forEach(input=>input.addEventListener("change",e=>{ enforceGroup(e.target); updateAddTotal(); }));
    $("#itemNotes").value=""; setQuantity(1); els.productDialog.showModal();
  }

  function enforceGroup(input) {
    const fieldset=input.closest("fieldset"); const max=Number(fieldset.dataset.max); const checked=$$("input:checked",fieldset);
    if(checked.length>max){input.checked=false;toast(`Escolha no máximo ${max} opção(ões).`);}
  }
  function selectedOptions(){return $$("input:checked",els.optionGroups).map(i=>i.value);}
  function unitPrice() { return Number(state.selected?.price||0)+$$("input:checked",els.optionGroups).reduce((sum,i)=>sum+Number(i.dataset.price||0),0); }
  function setQuantity(value){state.quantity=Math.min(20,Math.max(1,value));$("#qtyValue").textContent=state.quantity;updateAddTotal();}
  function updateAddTotal(){$("#addTotal").textContent=money(unitPrice()*state.quantity);}
  function validateOptions(){
    for(const fieldset of $$("fieldset",els.optionGroups)){const count=$$("input:checked",fieldset).length,min=Number(fieldset.dataset.min),max=Number(fieldset.dataset.max);if(count<min||count>max){fieldset.scrollIntoView({behavior:"smooth",block:"center"});toast(`Revise: ${$("legend span",fieldset).textContent}`);return false;}}
    if(unitPrice()<=0){toast("Escolha a opção que define o preço.");return false;} return true;
  }
  function addSelectedToCart(){
    if(!validateOptions()) return;
    const optionIds=selectedOptions(), options=(state.selected.option_groups||[]).flatMap(g=>(g.product_options||[]).filter(o=>optionIds.includes(o.id)).map(o=>({id:o.id,group:g.name,name:o.name,price:Number(o.price_delta||0)})));
    state.cart.push({product_id:state.selected.id,name:state.selected.name,image_url:state.selected.image_url,quantity:state.quantity,unit_price:unitPrice(),option_ids:optionIds,options,notes:$("#itemNotes").value.trim()});
    saveCart();renderCart();els.productDialog.close();toast("Item adicionado ao carrinho.");
  }

  function renderCart(){
    const count=state.cart.reduce((n,i)=>n+i.quantity,0),subtotal=state.cart.reduce((n,i)=>n+i.unit_price*i.quantity,0);
    els.cartCount.textContent=count;els.cartSubtotal.textContent=money(subtotal);$("#checkoutTotal").textContent=money(subtotal+Number(state.settings?.delivery_fee||0));
    els.cartItems.innerHTML=state.cart.length?state.cart.map((item,index)=>`<article class="cart-item"><h3>${escapeHtml(item.name)}</h3><strong>${money(item.unit_price*item.quantity)}</strong><p>${escapeHtml(item.options.map(o=>o.name).join(", ")||"Sem complementos")}</p><div class="cart-item-actions"><button type="button" data-index="${index}" data-cart-action="minus">−</button><b>${item.quantity}</b><button type="button" data-index="${index}" data-cart-action="plus">+</button><button type="button" class="remove-link" data-index="${index}" data-cart-action="remove">Remover</button></div></article>`).join(""):`<div class="empty-state"><span>🛒</span><h2>Seu carrinho está vazio</h2><p>Adicione um prato para continuar.</p></div>`;
    $("#checkoutButton").disabled=!state.cart.length||!state.backend;
  }
  function updateCartItem(index,action){const item=state.cart[index];if(!item)return;if(action==="plus")item.quantity=Math.min(99,item.quantity+1);if(action==="minus")item.quantity=Math.max(1,item.quantity-1);if(action==="remove")state.cart.splice(index,1);saveCart();renderCart();}
  function loadCart(){try{return JSON.parse(localStorage.getItem("carne-sol-cart")||"[]")}catch{return[]}}
  function saveCart(){localStorage.setItem("carne-sol-cart",JSON.stringify(state.cart));}

  async function openCheckout(){
    if(!state.cart.length)return;els.cartDialog.close();const {data:{session}}=await db.auth.getSession();if(session){$("#checkoutForm [name=email]").value=session.user.email||"";}
    $(".address-fields").classList.remove("hidden");renderCart();els.checkoutDialog.showModal();
  }
  async function placeOrder(event){
    event.preventDefault();const form=event.currentTarget,button=$("#placeOrder"),message=$("#checkoutMessage");const data=Object.fromEntries(new FormData(form));
    if(data.order_type==="delivery"&&(!data.street||!data.number||!data.neighborhood)){showMessage(message,"Preencha endereço, número e bairro.","error");return;}
    const payload={customer_name:data.customer_name,email:data.email,phone:data.phone,order_type:data.order_type,payment_method:data.payment_method,change_for:data.payment_method==="cash"?data.change_for:null,notes:data.notes,address:data.order_type==="delivery"?{street:data.street,number:data.number,complement:data.complement,neighborhood:data.neighborhood,reference:data.reference}:null,items:state.cart.map(i=>({product_id:i.product_id,quantity:i.quantity,option_ids:i.option_ids,notes:i.notes}))};
    button.disabled=true;button.textContent="Enviando…";const {data:order,error}=await db.rpc("create_order",{payload});
    button.disabled=false;button.textContent="Enviar pedido";
    if(error){showMessage(message,friendlyOrderError(error.message),"error");return;}
    const summary=state.cart.map(i=>`${i.quantity}x ${i.name}`).join("\n");state.cart=[];saveCart();renderCart();form.reset();els.checkoutDialog.close();
    const text=encodeURIComponent(`Olá! Pedido #${order.order_number}\n${summary}\nTotal: ${money(order.total)}`);
    toast(`Pedido #${order.order_number} criado com sucesso!`,6000);window.open(`https://wa.me/${state.settings.whatsapp}?text=${text}`,"_blank","noopener");
  }
  function friendlyOrderError(msg){if(/mínimo/i.test(msg))return msg;if(/indisponível|manutenção/i.test(msg))return msg;return "Não foi possível concluir. Revise os dados e tente novamente.";}

  function updateStoreInfo(){
    const s=state.settings;if(!s)return;$("#bannerTitle").textContent=s.banner_title||$("#bannerTitle").textContent;$("#bannerText").textContent=s.banner_text||$("#bannerText").textContent;
    $("#storeAddress").textContent=`${s.address}, ${s.city} — ${s.state}`;$("#whatsappHero").href=`https://wa.me/${s.whatsapp}`;
    const open=isStoreOpen(s),dot=$("#statusDot");dot.className=`status-dot ${open?"open":"closed"}`;$("#storeStatus").textContent=open?"Aberto agora":"Fechado agora";
    if(s.maintenance_mode){$("#maintenanceNotice").textContent="Estamos em manutenção temporária. O cardápio continua disponível para consulta.";$("#maintenanceNotice").classList.remove("hidden");}
  }
  function isStoreOpen(s){
    if(s.manual_status==="open")return true;if(s.manual_status==="closed")return false;
    const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/Fortaleza",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date()).map(p=>[p.type,p.value]));
    const day={Sun:"0",Mon:"1",Tue:"2",Wed:"3",Thu:"4",Fri:"5",Sat:"6"}[parts.weekday],hours=s.opening_hours?.[day];if(!hours)return false;const now=parts.hour.padStart(2,"0")+":"+parts.minute;return now>=hours[0]&&now<hours[1];
  }

  async function refreshSession(){const {data:{session}}=await db.auth.getSession();$("#authButton").textContent=session?"Minha conta":"Entrar";}
  function openAuth(){setAuthMode("login");$("#authRequestStep").classList.remove("hidden");$("#authVerifyStep").classList.add("hidden");$("#passwordStep").classList.add("hidden");showMessage(els.authMessage,"");els.authDialog.showModal();}
  function setAuthMode(mode){state.authMode=mode;const signup=mode==="signup";$(".signup-only").classList.toggle("hidden",!signup);$("#authTitle").textContent=signup?"Criar cadastro":mode==="recovery"?"Recuperar acesso":"Entrar com código";$("#authHelp").textContent=mode==="recovery"?"Enviaremos um código de 6 dígitos. Depois você poderá criar uma nova senha.":"Digite seu e-mail. Enviaremos um código numérico de 6 dígitos.";}
  async function sendAuthCode(event){
    event?.preventDefault();const email=$("#authEmail").value.trim().toLowerCase();if(!email||!email.includes("@")){showMessage(els.authMessage,"Digite um e-mail válido.","error");return;}
    const button=$("#sendCodeButton");button.disabled=true;const options={shouldCreateUser:state.authMode==="signup"};if(state.authMode==="signup")options.data={full_name:$("#authName").value.trim()};
    await db.auth.signInWithOtp({email,options});button.disabled=false;
    $("#authRequestStep").classList.add("hidden");$("#authVerifyStep").classList.remove("hidden");showMessage(els.authMessage,"Se este e-mail estiver cadastrado, enviaremos um código de 6 dígitos.","success");$("#authCode").focus();
  }
  async function verifyAuthCode(){
    const token=$("#authCode").value.replace(/\D/g,"");if(token.length!==6){showMessage(els.authMessage,"O código precisa ter exatamente 6 dígitos.","error");return;}
    const button=$("#verifyCodeButton");button.disabled=true;const {error}=await db.auth.verifyOtp({email:$("#authEmail").value.trim().toLowerCase(),token,type:"email"});button.disabled=false;
    if(error){showMessage(els.authMessage,"Código inválido ou expirado. Solicite um novo código.","error");return;}
    if(state.authMode==="signup"||state.authMode==="recovery"){$("#authVerifyStep").classList.add("hidden");$("#passwordStep").classList.remove("hidden");showMessage(els.authMessage,"Código confirmado. Crie uma senha com pelo menos 8 caracteres.","success");}
    else{showMessage(els.authMessage,"Acesso confirmado.","success");setTimeout(()=>els.authDialog.close(),700);refreshSession();}
  }
  async function savePassword(){const password=$("#newPassword").value;if(password.length<8){showMessage(els.authMessage,"Use pelo menos 8 caracteres.","error");return;}const {error}=await db.auth.updateUser({password});if(error){showMessage(els.authMessage,"Não foi possível salvar a senha. Tente novamente.","error");return;}showMessage(els.authMessage,"Senha salva com sucesso.","success");setTimeout(()=>els.authDialog.close(),800);refreshSession();}
  function showMessage(el,text,type=""){el.textContent=text;el.className=`form-message ${type}`;}
  function toast(text,duration=3300){const el=document.createElement("div");el.className="toast";el.textContent=text;$("#toastRegion").append(el);setTimeout(()=>el.remove(),duration);}
  function groupBy(items,keyFn){return items.reduce((groups,item)=>{const key=keyFn(item);(groups[key]??=[]).push(item);return groups;},{});}
  function localImage(value){
    if(!value)return "/assets/favicon.svg";
    try{const url=new URL(value,location.origin);if(url.hostname==="carnedosol.envoi.com.br"&&url.pathname.includes("/midias/item/"))return "/products/"+url.pathname.split("/").pop();}catch{}
    return value;
  }
})();
