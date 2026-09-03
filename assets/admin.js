(() => {
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const state={profile:null,categories:[],products:[],groups:[],options:[],orders:[],settings:null,editor:null};
  const titles={dashboard:"Visão geral",products:"Produtos",categories:"Categorias",options:"Complementos",orders:"Pedidos",store:"Loja e entrega",appearance:"Aparência",auth:"E-mail e acesso"};
  document.addEventListener("DOMContentLoaded",init);

  async function init(){
    bind();
    db.auth.onAuthStateChange((_event,session)=>{if(!session)showGate();});
    const {data:{session}}=await db.auth.getSession();
    if(session) await enterAdmin(session.user); else showGate();
  }
  function bind(){
    $("#adminSendCode").addEventListener("click",sendCode);$("#adminVerifyCode").addEventListener("click",verifyCode);
    $("#adminCode").addEventListener("input",e=>e.target.value=e.target.value.replace(/\D/g,"").slice(0,6));
    $("#adminSignOut").addEventListener("click",async()=>{await db.auth.signOut();showGate();});
    $("#adminNav").addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(b)showView(b.dataset.view);});
    document.addEventListener("click",e=>{const go=e.target.closest("[data-go]");if(go)showView(go.dataset.go);});
    $("#adminMenu").addEventListener("click",()=>$(".admin-sidebar").classList.toggle("open"));
    $("#newProduct").addEventListener("click",()=>editProduct());$("#newCategory").addEventListener("click",()=>editCategory());
    $("#productSearch").addEventListener("input",renderProducts);$("#productCategoryFilter").addEventListener("change",renderProducts);
    $("#optionProductSelect").addEventListener("change",renderOptionGroups);$("#orderStatusFilter").addEventListener("change",renderOrders);$("#refreshOrders").addEventListener("click",loadOrders);
    $("#adminProducts").addEventListener("click",productAction);$("#adminCategories").addEventListener("click",categoryAction);$("#adminOptionGroups").addEventListener("click",optionAction);$("#adminOrders").addEventListener("change",orderAction);
    $("#closeEditor").addEventListener("click",()=>$("#adminEditor").close());$("#editorForm").addEventListener("submit",saveEditor);
  }
  function showGate(){$("#adminGate").classList.remove("hidden");$("#adminApp").classList.add("hidden");}
  async function sendCode(){
    const email=$("#adminEmail").value.trim().toLowerCase(),button=$("#adminSendCode");if(!email.includes("@"))return msg($("#adminLoginMessage"),"Digite um e-mail válido.","error");
    button.disabled=true;const {data,error}=await db.functions.invoke("request-auth-code",{body:{email,mode:"login"}});button.disabled=false;
    if(error||data?.ok===false)return msg($("#adminLoginMessage"),"O serviço de e-mail está temporariamente indisponível. Tente novamente.","error");
    $("#adminCodeArea").classList.remove("hidden");msg($("#adminLoginMessage"),"Se este e-mail estiver autorizado, enviaremos um código numérico.","success");
  }
  async function verifyCode(){
    const code=$("#adminCode").value;if(!/^\d{6}$/.test(code))return msg($("#adminLoginMessage"),"Digite os 6 números enviados ao e-mail.","error");
    const button=$("#adminVerifyCode");button.disabled=true;
    const email=$("#adminEmail").value.trim().toLowerCase();
    const {data,error}=await db.functions.invoke("verify-auth-code",{body:{email,code}});
    if(error||!data?.ok||!data?.access_token||!data?.refresh_token){button.disabled=false;return msg($("#adminLoginMessage"),"Código inválido ou expirado.","error");}
    const {data:sessionData,error:sessionError}=await db.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});button.disabled=false;
    if(sessionError||!sessionData?.user)return msg($("#adminLoginMessage"),"Não foi possível concluir o acesso. Solicite um novo código.","error");await enterAdmin(sessionData.user);
  }
  async function enterAdmin(user){
    const {data,error}=await db.from("profiles").select("*").eq("id",user.id).maybeSingle();
    if(error||data?.role!=="admin"){await db.auth.signOut();showGate();msg($("#adminLoginMessage"),"Este e-mail não possui acesso administrativo.","error");return;}
    state.profile=data;$("#adminGate").classList.add("hidden");$("#adminApp").classList.remove("hidden");await loadAll();showView("dashboard");
  }
  async function loadAll(){
    const [cats,products,groups,options,settings]=await Promise.all([
      db.from("categories").select("*").order("position"),db.from("products").select("*").order("position"),
      db.from("option_groups").select("*").order("position"),db.from("product_options").select("*").order("position"),
      db.from("store_settings").select("*").eq("id",true).single()
    ]);
    for(const r of [cats,products,groups,options,settings])if(r.error)throw r.error;
    Object.assign(state,{categories:cats.data,products:products.data.map(p=>({...p,image_url:localImage(p.image_url)})),groups:groups.data,options:options.data,settings:settings.data});
    await loadOrders();populateFilters();renderProducts();renderCategories();renderOptionProductSelect();renderSettings();renderAuthChecklist();renderDashboard();
  }
  async function loadOrders(){const {data,error}=await db.from("orders").select("*,order_items(*)").order("created_at",{ascending:false}).limit(200);if(!error){state.orders=data;renderOrders();renderDashboard();}}
  function showView(view){
    $$(".admin-view").forEach(v=>v.classList.toggle("active",v.id==="view-"+view));$$("#adminNav button").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
    $("#viewTitle").textContent=titles[view];$(".admin-sidebar").classList.remove("open");
  }
  function populateFilters(){
    $("#productCategoryFilter").innerHTML='<option value="">Todas as categorias</option>'+state.categories.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  }
  function renderDashboard(){
    const today=new Date().toLocaleDateString("pt-BR",{timeZone:"America/Fortaleza"}),todayOrders=state.orders.filter(o=>new Date(o.created_at).toLocaleDateString("pt-BR",{timeZone:"America/Fortaleza"})===today);
    const revenue=todayOrders.filter(o=>o.status!=="cancelled").reduce((n,o)=>n+Number(o.total),0);
    const metrics=[["Produtos ativos",state.products.filter(p=>p.active).length],["Promoções",state.products.filter(p=>p.featured&&p.active).length],["Pedidos hoje",todayOrders.length],["Vendas hoje",money(revenue)]];
    $("#metricGrid").innerHTML=metrics.map(([label,value])=>`<article class="metric-card"><span>${label}</span><strong>${value}</strong></article>`).join("");
    $("#recentOrders").innerHTML=state.orders.slice(0,6).map(orderCard).join("")||"<p>Nenhum pedido ainda.</p>";
  }
  function renderProducts(){
    const q=$("#productSearch").value.trim().toLocaleLowerCase("pt-BR"),cat=$("#productCategoryFilter").value;
    const items=state.products.filter(p=>(!q||(`${p.name} ${p.description||""}`).toLocaleLowerCase("pt-BR").includes(q))&&(!cat||p.category_id===cat));
    $("#adminProducts").innerHTML=items.map(p=>`<article class="admin-row"><img src="${escapeHtml(p.image_url||"/assets/favicon.svg")}" alt=""><div><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(state.categories.find(c=>c.id===p.category_id)?.name||"")}</p></div><div class="admin-secondary"><strong>${p.price==null?"Preço por opção":money(p.price)}</strong><br><span class="status-pill ${p.active?"active":""}">${p.active?"Ativo":"Oculto"}</span></div><div class="admin-row-actions"><button data-action="toggle" data-id="${p.id}" title="Ativar/ocultar">${p.active?"◉":"○"}</button><button data-action="edit" data-id="${p.id}" title="Editar">✎</button></div></article>`).join("");
  }
  async function productAction(e){
    const b=e.target.closest("[data-action]");if(!b)return;const p=state.products.find(x=>x.id===b.dataset.id);if(b.dataset.action==="edit")editProduct(p);
    if(b.dataset.action==="toggle"){const {error}=await db.from("products").update({active:!p.active}).eq("id",p.id);if(!error){p.active=!p.active;renderProducts();toast("Disponibilidade atualizada.");}}
  }
  function editProduct(p=null){
    state.editor={type:"product",record:p};openEditor(p?"Editar produto":"Novo produto",`
      <div class="form-grid"><label class="field wide"><span>Nome *</span><input name="name" required value="${escapeHtml(p?.name||"")}"></label>
      <label class="field wide"><span>Descrição</span><textarea name="description">${escapeHtml(p?.description||"")}</textarea></label>
      <label class="field"><span>Categoria *</span><select name="category_id" required>${state.categories.map(c=>`<option value="${c.id}" ${p?.category_id===c.id?"selected":""}>${escapeHtml(c.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Ordem</span><input name="position" type="number" value="${p?.position??state.products.length*10+10}"></label>
      <label class="field"><span>Preço atual</span><input name="price" inputmode="decimal" value="${p?.price??""}" placeholder="Deixe vazio se o preço vier da opção"></label>
      <label class="field"><span>Preço antigo riscado</span><input name="old_price" inputmode="decimal" value="${p?.old_price??""}" placeholder="Opcional"></label>
      <label class="field wide"><span>URL da imagem</span><input name="image_url" value="${escapeHtml(p?.image_url||"")}"></label>
      <label class="field wide"><span>Ou enviar nova imagem (máx. 5 MB)</span><input name="image_file" type="file" accept="image/jpeg,image/png,image/webp,image/avif"></label>
      <label class="option-choice"><input name="active" type="checkbox" ${p?.active!==false?"checked":""}><span>Produto ativo</span></label>
      <label class="option-choice"><input name="featured" type="checkbox" ${p?.featured?"checked":""}><span>Destacar como promoção</span></label></div>`);
  }
  async function saveProduct(form,p){
    const data=new FormData(form);let image=data.get("image_url").trim(),file=data.get("image_file");
    if(file?.size){if(file.size>5242880)throw new Error("A imagem deve ter no máximo 5 MB.");const ext=file.name.split(".").pop().toLowerCase();const path=`products/${crypto.randomUUID()}.${ext}`;const up=await db.storage.from("product-images").upload(path,file,{cacheControl:"31536000",upsert:false});if(up.error)throw up.error;image=db.storage.from("product-images").getPublicUrl(path).data.publicUrl;}
    const categoryId=data.get("category_id"),category=state.categories.find(c=>c.id===categoryId),name=data.get("name").trim();
    const payload={name,description:data.get("description").trim()||null,category_id:categoryId,position:Number(data.get("position")||0),price:numOrNull(data.get("price")),old_price:numOrNull(data.get("old_price")),image_url:image||null,active:data.has("active"),featured:data.has("featured"),slug:p?.slug||slug(name)+"-"+Date.now().toString(36)};
    const result=p?await db.from("products").update(payload).eq("id",p.id).select().single():await db.from("products").insert(payload).select().single();if(result.error)throw result.error;
    if(p)Object.assign(p,result.data);else state.products.push(result.data);renderProducts();renderOptionProductSelect();toast("Produto salvo.");
  }
  function renderCategories(){
    $("#adminCategories").innerHTML=state.categories.map(c=>`<article class="admin-row"><div class="brand-mark">☷</div><div><h3>${escapeHtml(c.name)}</h3><p>${state.products.filter(p=>p.category_id===c.id).length} produtos • posição ${c.position}</p></div><div class="admin-secondary"><span class="status-pill ${c.active?"active":""}">${c.active?"Ativa":"Oculta"}</span></div><div class="admin-row-actions"><button data-category-action="edit" data-id="${c.id}">✎</button></div></article>`).join("");
  }
  function categoryAction(e){const b=e.target.closest("[data-category-action]");if(b)editCategory(state.categories.find(c=>c.id===b.dataset.id));}
  function editCategory(c=null){state.editor={type:"category",record:c};openEditor(c?"Editar categoria":"Nova categoria",`<label class="field"><span>Nome *</span><input name="name" required value="${escapeHtml(c?.name||"")}"></label><label class="field"><span>Descrição</span><textarea name="description">${escapeHtml(c?.description||"")}</textarea></label><label class="field"><span>Ordem</span><input name="position" type="number" value="${c?.position??state.categories.length*10+10}"></label><label class="option-choice"><input name="active" type="checkbox" ${c?.active!==false?"checked":""}><span>Categoria ativa</span></label>`);}
  async function saveCategory(form,c){const fd=new FormData(form),name=fd.get("name").trim(),payload={name,source_name:c?.source_name||name,slug:c?.slug||slug(name)+"-"+Date.now().toString(36),description:fd.get("description").trim()||null,position:Number(fd.get("position")||0),active:fd.has("active")};const r=c?await db.from("categories").update(payload).eq("id",c.id).select().single():await db.from("categories").insert(payload).select().single();if(r.error)throw r.error;if(c)Object.assign(c,r.data);else state.categories.push({...r.data});populateFilters();renderCategories();renderProducts();toast("Categoria salva.");}

  function renderOptionProductSelect(){$("#optionProductSelect").innerHTML='<option value="">Selecione…</option>'+state.products.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");}
  function renderOptionGroups(){
    const pid=$("#optionProductSelect").value,groups=state.groups.filter(g=>g.product_id===pid);
    $("#adminOptionGroups").innerHTML=pid?(groups.map(g=>`<article class="option-admin-group"><header><div><h3>${escapeHtml(g.name)}</h3><p>${g.min_select>0?"Obrigatório":"Opcional"} • mínimo ${g.min_select}, máximo ${g.max_select}</p></div><div class="admin-row-actions"><button data-option-action="edit-group" data-id="${g.id}">Editar</button><button data-option-action="new-option" data-id="${g.id}">+ Opção</button></div></header><div class="option-admin-list">${state.options.filter(o=>o.group_id===g.id).map(o=>`<div class="option-admin-item"><span>${escapeHtml(o.name)} ${Number(o.price_delta)>0?"• +"+money(o.price_delta):""}</span><button data-option-action="edit-option" data-id="${o.id}">Editar</button></div>`).join("")}</div></article>`).join("")+`<button class="button button-primary" data-option-action="new-group" data-id="${pid}">+ Novo grupo</button>`):"<p>Selecione um produto para editar suas opções.</p>";
  }
  function optionAction(e){const b=e.target.closest("[data-option-action]");if(!b)return;const a=b.dataset.optionAction;if(a==="new-group")editGroup(null,b.dataset.id);if(a==="edit-group")editGroup(state.groups.find(g=>g.id===b.dataset.id));if(a==="new-option")editOption(null,b.dataset.id);if(a==="edit-option")editOption(state.options.find(o=>o.id===b.dataset.id));}
  function editGroup(g,pid){state.editor={type:"group",record:g,productId:pid||g.product_id};openEditor(g?"Editar grupo":"Novo grupo",`<label class="field"><span>Nome *</span><input name="name" required value="${escapeHtml(g?.name||"")}"></label><div class="form-grid"><label class="field"><span>Mínimo</span><input name="min_select" type="number" min="0" value="${g?.min_select??0}"></label><label class="field"><span>Máximo</span><input name="max_select" type="number" min="1" value="${g?.max_select??1}"></label></div><label class="field"><span>Ordem</span><input name="position" type="number" value="${g?.position??state.groups.length*10+10}"></label>`);}
  async function saveGroup(form,g,pid){const fd=new FormData(form),min=Number(fd.get("min_select")||0),max=Number(fd.get("max_select")||1);if(max<Math.max(1,min))throw new Error("O máximo deve ser maior ou igual ao mínimo.");const payload={product_id:pid,name:fd.get("name").trim(),source_group_id:g?.source_group_id||"admin-"+Date.now(),min_select:min,max_select:max,required:min>0,selection_type:max===1?"single":"multiple",position:Number(fd.get("position")||0)};const r=g?await db.from("option_groups").update(payload).eq("id",g.id).select().single():await db.from("option_groups").insert(payload).select().single();if(r.error)throw r.error;if(g)Object.assign(g,r.data);else state.groups.push(r.data);renderOptionGroups();toast("Grupo salvo.");}
  function editOption(o,gid){state.editor={type:"option",record:o,groupId:gid||o.group_id};openEditor(o?"Editar opção":"Nova opção",`<label class="field"><span>Nome *</span><input name="name" required value="${escapeHtml(o?.name||"")}"></label><label class="field"><span>Valor adicional</span><input name="price_delta" inputmode="decimal" value="${o?.price_delta??0}"></label><label class="field"><span>Ordem</span><input name="position" type="number" value="${o?.position??state.options.length*10+10}"></label><label class="option-choice"><input name="active" type="checkbox" ${o?.active!==false?"checked":""}><span>Opção ativa</span></label>`);}
  async function saveOption(form,o,gid){const fd=new FormData(form),payload={group_id:gid,name:fd.get("name").trim(),source_option_id:o?.source_option_id||"admin-"+Date.now(),price_delta:Number(String(fd.get("price_delta")||0).replace(",",".")),position:Number(fd.get("position")||0),active:fd.has("active")};const r=o?await db.from("product_options").update(payload).eq("id",o.id).select().single():await db.from("product_options").insert(payload).select().single();if(r.error)throw r.error;if(o)Object.assign(o,r.data);else state.options.push(r.data);renderOptionGroups();toast("Opção salva.");}

  function renderOrders(){const status=$("#orderStatusFilter").value,items=state.orders.filter(o=>!status||o.status===status);$("#adminOrders").innerHTML=items.map(orderCard).join("")||"<p>Nenhum pedido encontrado.</p>";}
  function orderCard(o){const a=o.address,deliveryAddress=o.order_type==="delivery"&&a?`<p>${escapeHtml(`${a.street||""}, ${a.number||""}${a.complement?` - ${a.complement}`:""} - ${a.neighborhood||""}, ${a.city||""}/${a.state||""} - CEP ${a.postal_code||""}`)}</p>`:"";return `<article class="order-card"><div><h3>Pedido #${o.order_number} • ${escapeHtml(o.customer_name)}</h3><p>${new Date(o.created_at).toLocaleString("pt-BR")} • ${escapeHtml(o.phone)} • ${o.order_type==="delivery"?"Entrega":"Retirada"}</p>${deliveryAddress}<strong>${money(o.total)}</strong></div><select data-order-id="${o.id}">${[["pending","Pendente"],["confirmed","Confirmado"],["preparing","Preparando"],["ready","Pronto"],["out_for_delivery","Saiu para entrega"],["completed","Concluído"],["cancelled","Cancelado"]].map(([v,n])=>`<option value="${v}" ${o.status===v?"selected":""}>${n}</option>`).join("")}</select></article>`;}
  async function orderAction(e){const select=e.target.closest("[data-order-id]");if(!select)return;const {error}=await db.from("orders").update({status:select.value}).eq("id",select.dataset.orderId);if(error)return toast("Falha ao atualizar.");const o=state.orders.find(x=>x.id===select.dataset.orderId);o.status=select.value;renderDashboard();toast("Status atualizado.");}

  function renderSettings(){
    const s=state.settings;$("#storeForm").innerHTML=`<label class="wide">Nome da loja<input name="name" value="${escapeHtml(s.name)}"></label><label>E-mail de atendimento<input name="support_email" type="email" value="${escapeHtml(s.support_email)}"></label><label>WhatsApp<input name="whatsapp" value="${escapeHtml(s.whatsapp)}"></label><label class="wide">Endereço<input name="address" value="${escapeHtml(s.address)}"></label><label>Cidade<input name="city" value="${escapeHtml(s.city)}"></label><label>Estado<input name="state" value="${escapeHtml(s.state)}"></label><label>CEP<input name="zip_code" value="${escapeHtml(s.zip_code)}"></label><label>Status manual<select name="manual_status"><option value="auto" ${s.manual_status==="auto"?"selected":""}>Automático pelo horário</option><option value="open" ${s.manual_status==="open"?"selected":""}>Forçar aberta</option><option value="closed" ${s.manual_status==="closed"?"selected":""}>Forçar fechada</option></select></label><label>Pedido mínimo<input name="minimum_order" inputmode="decimal" value="${s.minimum_order}"></label><label>Taxa de entrega<input name="delivery_fee" inputmode="decimal" value="${s.delivery_fee}"></label><label class="option-choice"><input name="delivery_enabled" type="checkbox" ${s.delivery_enabled?"checked":""}><span>Entrega ativa</span></label><label class="option-choice"><input name="pickup_enabled" type="checkbox" ${s.pickup_enabled?"checked":""}><span>Retirada ativa</span></label><label class="option-choice wide"><input name="maintenance_mode" type="checkbox" ${s.maintenance_mode?"checked":""}><span>Modo manutenção</span></label><button class="button button-primary button-large" type="submit">Salvar loja</button>`;
    $("#storeForm").onsubmit=e=>saveSettings(e,"store");
    $("#appearanceForm").innerHTML=`<label class="wide">Título principal<input name="banner_title" value="${escapeHtml(s.banner_title)}"></label><label class="wide">Texto principal<textarea name="banner_text">${escapeHtml(s.banner_text)}</textarea></label><label class="wide">URL do logotipo<input name="logo_url" value="${escapeHtml(s.logo_url||"")}"></label><label>Cor brasa<input name="ember" type="color" value="${escapeHtml(s.theme?.ember||"#ff6b1a")}"></label><label>Cor carvão<input name="coal" type="color" value="${escapeHtml(s.theme?.coal||"#18120f")}"></label><button class="button button-primary button-large" type="submit">Salvar aparência</button>`;$("#appearanceForm").onsubmit=e=>saveSettings(e,"appearance");
  }
  async function saveSettings(e,type){e.preventDefault();const fd=new FormData(e.currentTarget),payload=type==="store"?{name:fd.get("name"),support_email:fd.get("support_email"),whatsapp:fd.get("whatsapp").replace(/\D/g,""),address:fd.get("address"),city:fd.get("city"),state:fd.get("state"),zip_code:fd.get("zip_code"),manual_status:fd.get("manual_status"),minimum_order:numOrNull(fd.get("minimum_order"))||0,delivery_fee:numOrNull(fd.get("delivery_fee"))||0,delivery_enabled:fd.has("delivery_enabled"),pickup_enabled:fd.has("pickup_enabled"),maintenance_mode:fd.has("maintenance_mode")}:{banner_title:fd.get("banner_title"),banner_text:fd.get("banner_text"),logo_url:fd.get("logo_url")||null,theme:{...state.settings.theme,ember:fd.get("ember"),coal:fd.get("coal")}};const {data,error}=await db.from("store_settings").update(payload).eq("id",true).select().single();if(error)return toast("Não foi possível salvar.");state.settings=data;toast("Configuração salva.");}
  function renderAuthChecklist(){
    $("#authChecklist").innerHTML=[
      ["ok","Código numérico compatível","Cadastro, login, recuperação e painel aceitam o OTP oficial configurado no Supabase."],
      ["ok","Sem redirecionamento localhost","O aplicativo usa fluxo OTP digitado; não depende de clique em link para autenticar."],
      ["ok","Antienumeração","A resposta não revela se um e-mail existe ou não existe."],
      ["ok","Conta administrativa","Apenas churrascariacarnedosolgold@gmail.com recebe papel de administrador."],
      ["warn","Entrega do provedor","HTTP 200 significa solicitação aceita; entrega real deve ser acompanhada nos logs de Auth/SMTP."],
      ["warn","Modelos versionados","Os HTMLs oficiais ficam em supabase/email-templates para manter a configuração auditável."]
    ].map(([c,t,p])=>`<article class="check-card ${c}"><strong>${t}</strong><p>${p}</p></article>`).join("");
  }

  function openEditor(title,fields){$("#editorTitle").textContent=title;$("#editorFields").innerHTML=fields;msg($("#editorMessage"),"");$("#adminEditor").showModal();}
  async function saveEditor(e){e.preventDefault();const button=e.submitter;button.disabled=true;try{const {type,record,productId,groupId}=state.editor;if(type==="product")await saveProduct(e.currentTarget,record);if(type==="category")await saveCategory(e.currentTarget,record);if(type==="group")await saveGroup(e.currentTarget,record,productId);if(type==="option")await saveOption(e.currentTarget,record,groupId);$("#adminEditor").close();}catch(error){console.error(error);msg($("#editorMessage"),error.message||"Não foi possível salvar.","error");}finally{button.disabled=false;}}
  function slug(s){return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"")||"item";}
  function numOrNull(v){if(v===null||String(v).trim()==="")return null;const n=Number(String(v).replace(",", "."));return Number.isFinite(n)?n:null;}
  function msg(el,text,type=""){el.textContent=text;el.className=`form-message ${type}`;}
  function toast(text){const e=document.createElement("div");e.className="toast";e.textContent=text;$("#toastRegion").append(e);setTimeout(()=>e.remove(),3300);}
  function localImage(value){
    if(!value)return "/assets/favicon.svg";
    try{const url=new URL(value,location.origin);if(url.hostname==="carnedosol.envoi.com.br"&&url.pathname.includes("/midias/"))return "/products/"+url.pathname.split("/").pop();}catch{}
    return value;
  }
})();
