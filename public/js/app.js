'use strict';
// ══════════════════════════════════════════════
// app.js — Green Pepper Market (vitrine publique)
// Zéro JSONBin — tout via /api/*
// Commande sans compte obligatoire
// Auth optionnelle
// ══════════════════════════════════════════════

// ── État ──
let TOKEN    = localStorage.getItem('gp_token');
let USER     = JSON.parse(localStorage.getItem('gp_user') || 'null');
let PRODUCTS = [];
let CART     = JSON.parse(localStorage.getItem('gp_cart') || '[]');
let SEL_OP   = null;
let POLL_INT = null;
let CART_OPEN = false;
let CUR_CAT   = '';

// ── Utils ──
function $(id) { return document.getElementById(id); }
function fmt(n) { return Number(n).toLocaleString('fr-FR') + ' FCFA'; }
function toast(msg, type='ok') {
  const w=$('toastWrap');if(!w)return;
  const d=document.createElement('div');
  d.className='gp-toast'+(type==='err'?' err':type==='ok'?' ok':'');
  d.textContent=msg;w.appendChild(d);
  setTimeout(()=>{d.style.opacity='0';d.style.transition='opacity .3s';setTimeout(()=>d.remove(),300);},3500);
}
function stars(r) {
  const n=Math.round(Number(r)*2)/2,s=[];
  for(let i=1;i<=5;i++) s.push(i<=n?'★':(i-.5===n?'⭐':'☆'));
  return s.join('');
}

// ── Auth header ──
function authHeaders() {
  const h={'Content-Type':'application/json'};
  if(TOKEN) h['Authorization']='Bearer '+TOKEN;
  return h;
}

// ── UI AUTH ──
function updateAuthUI() {
  const authBtn = $('authBtn'), avatarBtn = $('avatarBtn');
  if (!authBtn || !avatarBtn) return;
  if (USER && TOKEN) {
    authBtn.style.display = 'none';
    avatarBtn.style.display = 'flex';
    avatarBtn.textContent = ((USER.name || 'U').trim().charAt(0) || 'U').toUpperCase();
    const nm = $('umName'); if (nm) nm.textContent = USER.name || '';
    const sp = $('umSpace');
    if (sp) {
      if (USER.role === 'admin')         { sp.href = '/admin.html';    sp.textContent = 'Espace administrateur'; sp.style.display = 'block'; }
      else if (USER.role === 'merchant') { sp.href = '/merchant.html'; sp.textContent = 'Ma boutique';           sp.style.display = 'block'; }
      else sp.style.display = 'none';
    }
  } else {
    authBtn.style.display = 'inline-flex';
    avatarBtn.style.display = 'none';
    const m = $('userMenu'); if (m) m.style.display = 'none';
  }
}

function toggleUserMenu() {
  const m = $('userMenu');
  if (m) m.style.display = m.style.display === 'block' ? 'none' : 'block';
}

async function doLogout() {
  try { await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders(), credentials: 'include' }); } catch(e) {}
  localStorage.removeItem('gp_token'); localStorage.removeItem('gp_user');
  TOKEN = null; USER = null;
  updateAuthUI();
  toast('Vous êtes déconnecté');
}

// ── PANIER ──
function saveCart() { localStorage.setItem('gp_cart', JSON.stringify(CART)); }
function cartTotal() { return CART.reduce((a,c)=>a+c.price*c.qty,0); }
function cartCount() { return CART.reduce((a,c)=>a+c.qty,0); }

function updateCartBadge() {
  const n=cartCount();
  const b=$('cartCount');
  if(b){b.textContent=n;b.style.display=n>0?'flex':'none';}
}

function addToCart(productId) {
  const p=PRODUCTS.find(x=>x._id===productId);
  if(!p){toast('Produit introuvable','err');return;}
  if(p.stock<=0){toast('Stock épuisé','err');return;}
  const ex=CART.find(c=>c._id===productId);
  if(ex){
    const maxQty=Math.min(p.stock,10);
    if(ex.qty>=maxQty){toast('Quantité maximum atteinte','err');return;}
    ex.qty++;
  } else {
    const fp=p.finalPrice||p.price;
    CART.push({_id:p._id,name:p.name,price:fp,originalPrice:p.price,image:p.imageUrl||'',qty:1,sellerId:p.sellerId});
  }
  saveCart();updateCartBadge();renderCartItems();
  toast(`${p.name} ajouté 🛒`);
  openCart();
}

function changeQty(productId,delta) {
  const idx=CART.findIndex(c=>c._id===productId);if(idx<0)return;
  CART[idx].qty+=delta;
  if(CART[idx].qty<=0) CART.splice(idx,1);
  saveCart();updateCartBadge();renderCartItems();
}

function openCart() {
  CART_OPEN=true;
  const overlay=$('cartOverlay');const panel=$('cartPanel');
  if(overlay)overlay.style.display='block';
  if(panel){panel.style.display='flex';requestAnimationFrame(()=>panel.classList.add('open'));}
  document.body.style.overflow='hidden';
  renderCartItems();
}

function closeCart() {
  CART_OPEN=false;
  const overlay=$('cartOverlay');const panel=$('cartPanel');
  if(overlay)overlay.style.display='none';
  if(panel){panel.classList.remove('open');panel.style.display='none';}
  document.body.style.overflow='';
}

function toggleCart() { CART_OPEN ? closeCart() : openCart(); }

function renderCartItems() {
  const el=$('cartItems');const footer=$('cartSummary');const btn=$('checkoutBtn');
  if(!el)return;
  if(!CART.length){
    el.innerHTML=`<div class="gp-cart-empty"><div class="gp-cart-empty-icon">🛒</div><p>Votre panier est vide</p><p style="font-size:12px;color:#9ca3af;margin-top:6px">Parcourez nos produits ci-dessous</p></div>`;
    if(footer)footer.innerHTML='';
    if(btn)btn.style.display='none';
    return;
  }
  el.innerHTML=CART.map(c=>`
    <div class="gp-cart-item">
      <img src="${c.image||'https://via.placeholder.com/56'}" class="gp-cart-item-img" alt="${c.name}" loading="lazy" onerror="this.src='https://via.placeholder.com/56'">
      <div class="gp-cart-item-info">
        <div class="gp-cart-item-name">${c.name}</div>
        <div class="gp-cart-item-price">${fmt(c.price*c.qty)}</div>
        ${c.price<c.originalPrice?`<div style="font-size:10px;color:#9ca3af;text-decoration:line-through">${fmt(c.originalPrice*c.qty)}</div>`:''}
      </div>
      <div class="gp-cart-item-qty">
        <button class="gp-qty-btn" onclick="changeQty('${c._id}',-1)">−</button>
        <span class="gp-qty-val">${c.qty}</span>
        <button class="gp-qty-btn" onclick="changeQty('${c._id}',1)">+</button>
      </div>
    </div>`).join('');
  const sub=cartTotal();
  if(footer)footer.innerHTML=`<div class="gp-cart-total"><span>Total</span><span class="gp-cart-total-amount">${fmt(sub)}</span></div>`;
  if(btn)btn.style.display='block';
}

// ── WhatsApp du vendeur : icône verte sur chaque carte, cachée si le vendeur n'a pas de numéro ──
const BRAND = 'InvestPro';
const WA_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';
function waLink(p) {
  const n = String(p.sellerWhatsapp || '');
  if (!/^237[0-9]{9}$/.test(n)) return '';
  const msg = 'Bonjour, je suis intéressé par votre produit ' + p.name + ' sur ' + BRAND;
  return '<a class="gp-wa" href="https://wa.me/' + n + '?text=' + encodeURIComponent(msg) + '" target="_blank" rel="noopener noreferrer" title="Écrire au vendeur sur WhatsApp" aria-label="Écrire au vendeur sur WhatsApp">' + WA_ICON + '</a>';
}

// ── PRODUITS ──
async function loadProducts(category='',search='') {
  CUR_CAT=category;
  const loader=$('productsLoader');const grid=$('productsGrid');const empty=$('productsEmpty');
  const cg=$('catsGrid'), br=$('backRow');
  if(cg)cg.style.display='none';
  if(br)br.style.display='block';
  if(grid)grid.style.display='';
  if(loader)loader.style.display='block';
  if(grid)grid.innerHTML='';
  if(empty)empty.style.display='none';
  try {
    let url='/api/products?limit=48';
    if(category) url+='&category='+encodeURIComponent(category);
    if(search)   url+='&q='+encodeURIComponent(search);
    const r=await fetch(url);const data=await r.json();
    PRODUCTS=data.products||[];
    if(loader)loader.style.display='none';
    const count=$('productsCount');
    if(count)count.textContent=`${data.total||0} produit${(data.total||0)!==1?'s':''}`;
    const title=$('productsTitle');
    if(title)title.textContent=category?`${category}`:(search?`Résultats pour "${search}"`:'Nos produits');
    if(!PRODUCTS.length){if(empty)empty.style.display='block';return;}
    if(grid)grid.innerHTML=PRODUCTS.map(p=>{
      const fp=p.finalPrice||p.price;
      const hasDisc=p.discount>0&&fp<p.price;
      const out=p.stock<=0;const low=!out&&p.stock<=5;
      return `<div class="gp-card">
        <div style="position:relative">
          <img src="${p.imageUrl||'https://via.placeholder.com/300x180?text=🌶️'}" class="gp-card-img" alt="${p.name}" loading="lazy" onerror="this.src='https://via.placeholder.com/300x180?text=🌶️'">
          ${hasDisc?`<span style="position:absolute;top:8px;left:8px;background:#ef4444;color:#fff;padding:3px 8px;border-radius:100px;font-size:10px;font-weight:700">-${p.discount}%</span>`:''}
          ${p.type==='digital'?`<span class="gp-dig">⚡ Digital</span>`:''}
          ${out?`<div style="position:absolute;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center"><span style="background:#fff;color:#ef4444;font-size:11px;font-weight:700;padding:4px 12px;border-radius:100px">Épuisé</span></div>`:''}
        </div>
        <div class="gp-card-body">
          <div class="gp-card-cat">${p.category||''}</div>
          <div class="gp-card-name">${p.name}</div>
          <div class="gp-card-unit">${p.unit||''}</div>
          <div class="gp-card-rating">
            <span class="gp-card-stars">${stars(p.rating||4.5)}</span>
            <span class="gp-card-rc">(${p.reviewCount||0})</span>
          </div>
          <div class="gp-card-footer">
            <div>
              <div style="display:flex;align-items:baseline;gap:6px">
                <span class="gp-card-price">${Number(fp).toLocaleString('fr-FR')} <span class="gp-card-price-fcfa">FCFA</span></span>
                ${hasDisc?`<span style="font-size:11px;color:#9ca3af;text-decoration:line-through">${Number(p.price).toLocaleString('fr-FR')}</span>`:''}
              </div>
              ${low?`<div class="gp-card-stock-low">⚠️ Plus que ${p.stock}</div>`:''}
            </div>
            <div style="display:flex;gap:6px;align-items:center">${waLink(p)}<button class="gp-add-btn" onclick="addToCart('${p._id}')" ${out?'disabled':''} title="Ajouter au panier">+</button></div>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    if(loader)loader.style.display='none';
    if(grid)grid.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:#6b7280">Erreur de chargement. <button onclick="loadProducts()" style="color:#f97316;background:none;border:none;cursor:pointer;text-decoration:underline;font-size:14px">Réessayer</button></div>`;
  }
}

// ── CATÉGORIES : chaque catégorie est un cadre ; un appui ouvre ses produits ──
let CATS = [];

function catIcon(name) {
  const n = String(name).toLowerCase();
  if (n.includes('boisson') || n.includes('jus')) return '🥤';
  if (n.includes('fruit')) return '🍍';
  if (n.includes('légume') || n.includes('legume')) return '🥬';
  if (n.includes('épice') || n.includes('epice')) return '🌶️';
  if (n.includes('cosm') || n.includes('beaut')) return '💄';
  if (n.includes('céréale') || n.includes('cereale')) return '🌾';
  return '🛍️';
}

function buildCatsBar(active) {
  const bar = $('catsBar'); if (!bar) return;
  bar.textContent = '';
  const mk = (label, cat) => {
    const b = document.createElement('button');
    b.className = 'gp-cat-btn' + (cat === active ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => cat ? openCategory(cat) : showCategories());
    bar.appendChild(b);
  };
  mk('Tout', '');
  CATS.forEach(c => mk(c.name, c.name));
}

function renderCatCards() {
  const grid = $('catsGrid'); if (!grid) return;
  grid.textContent = '';
  CATS.forEach(c => {
    const all = c.images || [];
    const imgs = all.slice(0, all.length >= 4 ? 4 : (all.length >= 2 ? 2 : all.length));
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'gp-cat-card';
    const mosaic = document.createElement('div');
    mosaic.className = 'gp-cat-mosaic ' + (imgs.length >= 4 ? 'four' : imgs.length >= 2 ? 'two' : imgs.length === 1 ? 'one' : 'gp-cat-ph');
    if (!imgs.length) mosaic.textContent = catIcon(c.name);
    imgs.forEach(u => { const im = document.createElement('img'); im.loading = 'lazy'; im.alt = ''; im.src = u; im.addEventListener('error', () => im.remove()); mosaic.appendChild(im); });
    const nm = document.createElement('div'); nm.className = 'gp-cat-name'; nm.textContent = c.name;
    const ct = document.createElement('div'); ct.className = 'gp-cat-count'; ct.textContent = c.count + ' produit' + (c.count > 1 ? 's' : '');
    card.append(mosaic, nm, ct);
    card.addEventListener('click', () => openCategory(c.name));
    grid.appendChild(card);
  });
}

async function showCategories() {
  CUR_CAT = '';
  const grid = $('productsGrid'), cg = $('catsGrid'), br = $('backRow'), loader = $('productsLoader'), empty = $('productsEmpty');
  if (grid) { grid.innerHTML = ''; grid.style.display = 'none'; }
  if (br) br.style.display = 'none';
  if (empty) empty.style.display = 'none';
  if (cg) cg.style.display = '';
  if (loader) loader.style.display = 'block';
  const title = $('productsTitle'); if (title) title.textContent = 'Catégories';
  try {
    const r = await fetch('/api/categories'); const d = await r.json();
    CATS = d.categories || [];
    if (loader) loader.style.display = 'none';
    const total = CATS.reduce((a, c) => a + c.count, 0);
    const count = $('productsCount'); if (count) count.textContent = CATS.length + ' catégorie' + (CATS.length > 1 ? 's' : '') + ' · ' + total + ' produit' + (total > 1 ? 's' : '');
    buildCatsBar('');
    if (!CATS.length) { if (cg) cg.textContent = ''; if (empty) empty.style.display = 'block'; return; }
    renderCatCards();
  } catch(e) { if (loader) loader.style.display = 'none'; toast('Erreur de chargement des catégories', 'err'); }
}

function openCategory(name) {
  buildCatsBar(name);
  loadProducts(name);
  const m = $('products'); if (m) m.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function filterCat(cat) { cat ? openCategory(cat) : showCategories(); }

function doSearch() {
  const q = $('searchInput')?.value?.trim();
  if (!q) { showCategories(); return; }
  buildCatsBar('');
  loadProducts('', q);
}

// ── CHECKOUT ──
function openCheckout() {
  if(!CART.length)return;
  closeCart();
  const recap=$('checkoutRecap');
  if(recap){
    recap.innerHTML=CART.map(c=>`
      <div class="gp-checkout-recap-item">
        <span>${c.name} ×${c.qty}</span>
        <span>${fmt(c.price*c.qty)}</span>
      </div>`).join('')+
      `<div class="gp-checkout-total"><span>Total</span><span>${fmt(cartTotal())}</span></div>`;
  }
  SEL_OP=null;
  document.querySelectorAll('.gp-op-btn').forEach(b=>b.classList.remove('selected'));
  const payBtn=$('payBtn');if(payBtn){payBtn.disabled=true;payBtn.textContent='Payer via Mobile Money';}
  const payMsg=$('payMsg');if(payMsg){payMsg.style.display='none';payMsg.className='gp-pay-msg';}
  // Pré-remplir si connecté
  const nameInp=$('ckName');if(nameInp&&USER?.name)nameInp.value=USER.name;
  $('checkoutOverlay').style.display='block';
  $('checkoutModal').style.display='block';
  document.body.style.overflow='hidden';
}

function closeCheckout() {
  $('checkoutOverlay').style.display='none';
  $('checkoutModal').style.display='none';
  document.body.style.overflow='';
  clearInterval(POLL_INT);
}

function selectOp(op) {
  SEL_OP=op;
  document.querySelectorAll('.gp-op-btn').forEach(b=>b.classList.remove('selected'));
  const btn=op==='MTN_MOMO_CMR'?$('opMTN'):$('opORANGE');
  if(btn)btn.classList.add('selected');
  const payBtn=$('payBtn');
  if(payBtn){
    payBtn.disabled=false;
    payBtn.textContent=`Payer avec ${op==='MTN_MOMO_CMR'?'MTN MoMo 🟡':'Orange Money 🟠'}`;
    payBtn.style.background=op==='MTN_MOMO_CMR'?'#fbbf24':'#fb923c';
    payBtn.style.color='#111';
  }
}

async function submitPayment() {
  const phone   = $('ckPhone')?.value?.trim();
  const name    = $('ckName')?.value?.trim();
  const location= $('ckLocation')?.value?.trim();
  const payBtn  = $('payBtn'); const payMsg = $('payMsg');

  if (!phone)    { toast('Entrez votre numéro Mobile Money', 'err'); return; }
  if (!location) { toast('Entrez votre localisation', 'err'); return; }
  if (!SEL_OP)   { toast('Choisissez un opérateur', 'err'); return; }
  if (!CART.length) { toast('Panier vide', 'err'); return; }

  clearInterval(POLL_INT);
  payBtn.disabled = true; payBtn.textContent = '⏳ Traitement…';
  payMsg.style.display = 'none';
  const show = (cls, text, link) => {
    payMsg.style.display = 'block'; payMsg.className = 'gp-pay-msg ' + cls; payMsg.textContent = text;
    if (link) { const a = document.createElement('a'); a.href = '/suivi.html'; a.textContent = 'Suivre ma commande →'; a.style.cssText = 'display:block;margin-top:8px;font-weight:700;text-decoration:underline'; payMsg.appendChild(a); }
  };

  try {
    const r = await fetch('/api/kpay/pay', {
      method: 'POST', headers: authHeaders(), credentials: 'include',
      body: JSON.stringify({
        phone, provider: SEL_OP, customerName: name || '', address: location,
        items: CART.map(c => ({ productId: c._id, qty: c.qty })),     // le prix n'est JAMAIS envoyé : le serveur le relit en base
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erreur paiement');

    show('pending', data.message || 'Validez le paiement sur votre téléphone…');
    payBtn.textContent = '⏳ En attente de confirmation…';
    if (!data.kpayId) {                                   // pas d'identifiant KPay : on ne peut pas suivre automatiquement
      show('pending', 'Paiement lancé. Gardez votre numéro de commande : ' + data.orderNumber);
      payBtn.textContent = 'Paiement lancé';
      return;
    }

    // mémorise la commande sur cet appareil (suivi sans compte)
    try {
      const saved = JSON.parse(localStorage.getItem('gp_orders') || '[]').filter(o => o.kpayId !== data.kpayId);
      saved.unshift({ kpayId: data.kpayId, token: data.trackToken, orderNumber: data.orderNumber, orderType: data.orderType, at: Date.now() });
      localStorage.setItem('gp_orders', JSON.stringify(saved.slice(0, 30)));
    } catch(e) {}

    let attempts = 0;
    POLL_INT = setInterval(async () => {
      attempts++;
      if (attempts > 36) {
        clearInterval(POLL_INT); payBtn.disabled = false; payBtn.textContent = 'Réessayer';
        show('error', 'Délai dépassé. Si vous avez payé, retrouvez votre commande dans « Suivi ».', true);
        return;
      }
      try {
        const sr = await fetch('/api/kpay/status/' + encodeURIComponent(data.kpayId) + '?token=' + encodeURIComponent(data.trackToken));
        const sd = await sr.json();
        if (sd.status === 'VALIDÉ' || sd.status === 'LIVRÉ') {
          clearInterval(POLL_INT);
          CART.length = 0; saveCart(); updateCartBadge();
          payBtn.textContent = 'Commande validée ✅';
          show('success', data.orderType === 'digital'
            ? '✅ Paiement confirmé ! Votre lien de téléchargement est disponible dans « Suivi de commande ».'
            : '✅ Paiement confirmé ! À la réception, confirmez avec une photo du produit dans « Suivi de commande » : le vendeur n\'est payé qu\'après.', true);
          toast('Commande validée 🎉', 'ok');
        } else if (sd.status === 'REFUSÉ' || sd.status === 'EXPIRED') {
          clearInterval(POLL_INT);
          payBtn.disabled = false; payBtn.textContent = 'Réessayer';
          show('error', '❌ Paiement refusé ou expiré. Vérifiez votre solde et réessayez.');
          toast('Paiement non abouti', 'err');
        }
      } catch(e) { /* réseau : on réessaie au prochain tour */ }
    }, 5000);

  } catch(e) {
    payBtn.disabled = false; payBtn.textContent = 'Réessayer';
    show('error', '❌ ' + e.message);
    toast(e.message, 'err');
  }
}

// ── INIT ──
document.addEventListener('DOMContentLoaded',()=>{
  updateAuthUI();
  updateCartBadge();
  renderCartItems();
  showCategories();

  // Fermer le panier sur ESC
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeCart();closeCheckout();}});
  document.addEventListener('click',e=>{
    const m=$('userMenu');
    if(m&&m.style.display==='block'&&!e.target.closest('#userMenu')&&!e.target.closest('#avatarBtn')) m.style.display='none';
  });

  // Recherche sur Enter
  $('searchInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')doSearch();});

  // Seed auto si aucun produit
  fetch('/api/products?limit=1').then(r=>r.json()).then(d=>{
    if(d.total===0){fetch('/api/products/seed').then(r=>r.json()).then(seed=>{if(seed.count>0)showCategories();});}
  }).catch(()=>{});
});
