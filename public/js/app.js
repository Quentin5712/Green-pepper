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
  const authBtn  = $('authBtn');
  const avatarBtn= $('avatarBtn');
  const userMenu = $('userMenuLinks');
  if (!authBtn||!avatarBtn) return;

  if (USER && TOKEN) {
    authBtn.style.display   = 'none';
    avatarBtn.style.display = 'flex';
    avatarBtn.textContent   = (USER.name||'U')[0].toUpperCase();
    if (userMenu) {
      const adminLink = userMenu.querySelector('.admin-link');
      const merchLink = userMenu.querySelector('.merch-link');
      if (adminLink) adminLink.style.display = USER.role==='admin'   ? 'block' : 'none';
      if (merchLink) merchLink.style.display = USER.role==='merchant' ? 'block' : 'none';
    }
  } else {
    authBtn.style.display   = 'flex';
    avatarBtn.style.display = 'none';
  }
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

// ── PRODUITS ──
async function loadProducts(category='',search='') {
  CUR_CAT=category;
  const loader=$('productsLoader');const grid=$('productsGrid');const empty=$('productsEmpty');
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
            <button class="gp-add-btn" onclick="addToCart('${p._id}')" ${out?'disabled':''} title="Ajouter au panier">+</button>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    if(loader)loader.style.display='none';
    if(grid)grid.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:#6b7280">Erreur de chargement. <button onclick="loadProducts()" style="color:#f97316;background:none;border:none;cursor:pointer;text-decoration:underline;font-size:14px">Réessayer</button></div>`;
  }
}

function filterCat(cat) {
  document.querySelectorAll('.gp-cat-btn').forEach(b=>b.classList.toggle('active',b.dataset.cat===cat));
  loadProducts(cat);
}

function doSearch() {
  const q=$('searchInput')?.value?.trim();
  if(!q){loadProducts();return;}
  loadProducts('',q);
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
  const phone   =$('ckPhone')?.value?.trim();
  const name    =$('ckName')?.value?.trim();
  const location=$('ckLocation')?.value?.trim();
  const payBtn  =$('payBtn');const payMsg=$('payMsg');

  if(!phone){toast('Entrez votre numéro Mobile Money','err');return;}
  if(!location){toast('Entrez votre localisation','err');return;}
  if(!SEL_OP){toast('Choisissez un opérateur','err');return;}
  if(!CART.length){toast('Panier vide','err');return;}

  payBtn.disabled=true;payBtn.textContent='⏳ Traitement…';
  payMsg.style.display='none';

  try {
    const body={
      phone,
      provider:SEL_OP,
      customerName:name||'Client anonyme',
      address:location,
      items:CART.map(c=>({productId:c._id,qty:c.qty})),
    };
    const r=await fetch('/api/payment/pay',{
      method:'POST',
      headers:authHeaders(),
      credentials:'include',
      body:JSON.stringify(body),
    });
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||data.detail||'Erreur paiement');

    payMsg.style.display='block';
    payMsg.className='gp-pay-msg pending';
    payMsg.textContent=data.message||'Validez le paiement sur votre téléphone…';
    payBtn.textContent='⏳ En attente de confirmation…';

    const extId=data.externalId;
    let attempts=0;
    POLL_INT=setInterval(async()=>{
      attempts++;
      if(attempts>36){clearInterval(POLL_INT);payBtn.disabled=false;payBtn.textContent='Réessayer';payMsg.className='gp-pay-msg error';payMsg.textContent='Délai dépassé. Vérifiez votre téléphone et réessayez.';return;}
      try{
        const sr=await fetch('/api/payment/status/'+extId);const sd=await sr.json();
        if(sd.status==='VALIDÉ'){
          clearInterval(POLL_INT);
          payMsg.className='gp-pay-msg success';
          payMsg.textContent='✅ Paiement confirmé ! Votre commande est en cours de préparation.';
          payBtn.textContent='Commande validée ✅';
          CART.length=0;saveCart();updateCartBadge();
          toast('Commande validée 🎉','ok');
        } else if(sd.status==='REFUSÉ'){
          clearInterval(POLL_INT);
          payMsg.className='gp-pay-msg error';
          payMsg.textContent='❌ Paiement refusé. Vérifiez votre solde et réessayez.';
          payBtn.disabled=false;payBtn.textContent='Réessayer';
          toast('Paiement refusé','err');
        }
      }catch(e){}
    },5000);

  }catch(e){
    payBtn.disabled=false;payBtn.textContent='Réessayer';
    payMsg.style.display='block';payMsg.className='gp-pay-msg error';
    payMsg.textContent='❌ '+e.message;
    toast(e.message,'err');
  }
}

// ── INIT ──
document.addEventListener('DOMContentLoaded',()=>{
  updateAuthUI();
  updateCartBadge();
  renderCartItems();
  loadProducts();

  // Fermer le panier sur ESC
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeCart();closeCheckout();}});

  // Recherche sur Enter
  $('searchInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')doSearch();});

  // Seed auto si aucun produit
  fetch('/api/products?limit=1').then(r=>r.json()).then(d=>{
    if(d.total===0){fetch('/api/products/seed').then(r=>r.json()).then(seed=>{if(seed.count>0)loadProducts();});}
  }).catch(()=>{});
});
