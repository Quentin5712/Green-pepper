'use strict';
// ══════════════════════════════════════════════
// Marketplace Afrique — vitrine
// Tout passe par /api/* · le panier est local · le prix est TOUJOURS recalculé par le serveur au paiement
// ══════════════════════════════════════════════
let TOKEN = localStorage.getItem('gp_token');
let USER  = JSON.parse(localStorage.getItem('gp_user') || 'null');
let PRODUCTS = [], PROMOS = [], CATS = [];
let CART = JSON.parse(localStorage.getItem('gp_cart') || '[]');
let CART_OPEN = false, CUR_CAT = '';

const $ = id => document.getElementById(id);

function toast(msg, type = 'ok') {
  const w = $('toastWrap'); if (!w) return;
  const d = document.createElement('div'); d.className = 'gp-toast' + (type === 'err' ? ' err' : type === 'ok' ? ' ok' : '');
  d.textContent = msg; w.appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .3s'; setTimeout(() => d.remove(), 300); }, 3200);
}
function authHeaders() { const h = { 'Content-Type': 'application/json' }; if (TOKEN) h['Authorization'] = 'Bearer ' + TOKEN; return h; }

// ── Compte ──
function updateAuthUI() {
  const authBtn = $('authBtn'), avatarBtn = $('avatarBtn'); if (!authBtn || !avatarBtn) return;
  if (USER && TOKEN) {
    authBtn.style.display = 'none'; avatarBtn.style.display = 'flex';
    avatarBtn.textContent = ((USER.name || 'U').trim().charAt(0) || 'U').toUpperCase();
    const nm = $('umName'); if (nm) nm.textContent = USER.name || '';
    const sp = $('umSpace');
    if (sp) {
      if (USER.role === 'admin')         { sp.href = '/admin.html';    sp.textContent = 'Espace administrateur'; sp.style.display = 'block'; }
      else if (USER.role === 'merchant') { sp.href = '/merchant.html'; sp.textContent = 'Ma boutique';           sp.style.display = 'block'; }
      else sp.style.display = 'none';
    }
  } else { authBtn.style.display = 'inline-flex'; avatarBtn.style.display = 'none'; const m = $('userMenu'); if (m) m.style.display = 'none'; }
}
function toggleUserMenu() { const m = $('userMenu'); if (m) m.style.display = m.style.display === 'block' ? 'none' : 'block'; }
async function doLogout() {
  try { await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders(), credentials: 'include' }); } catch (e) {}
  localStorage.removeItem('gp_token'); localStorage.removeItem('gp_user'); TOKEN = null; USER = null; updateAuthUI(); toast('Vous êtes déconnecté');
}

// ── Panier ──
function saveCart() { localStorage.setItem('gp_cart', JSON.stringify(CART)); }
const cartTotal = () => CART.reduce((a, c) => a + c.price * c.qty, 0);
const cartCount = () => CART.reduce((a, c) => a + c.qty, 0);
function updateCartBadge() { const n = cartCount(), b = $('cartCount'); if (b) { b.textContent = n; b.style.display = n > 0 ? 'flex' : 'none'; } }
const findProduct = id => [...PRODUCTS, ...PROMOS].find(x => x._id === id);

function addToCart(productId) {
  const p = findProduct(productId); if (!p) { toast('Produit introuvable', 'err'); return; }
  if (p.stock <= 0) { toast('Stock épuisé', 'err'); return; }
  const ex = CART.find(c => c._id === productId);
  if (ex) { if (ex.qty >= Math.min(p.stock, 10)) { toast('Quantité maximum atteinte', 'err'); return; } ex.qty++; }
  else CART.push({ _id: p._id, name: p.name, price: p.finalPrice ?? p.price, originalPrice: p.price, image: p.imageUrl || '', qty: 1, sellerId: p.sellerId, shopName: p.shop ? p.shop.name : '' });
  saveCart(); updateCartBadge(); renderCartItems(); toast(p.name + ' ajouté 🛒'); openCart();
}
function changeQty(id, d) { const i = CART.findIndex(c => c._id === id); if (i < 0) return; CART[i].qty += d; if (CART[i].qty <= 0) CART.splice(i, 1); saveCart(); updateCartBadge(); renderCartItems(); }
function openCart() { CART_OPEN = true; $('cartOverlay').style.display = 'block'; const p = $('cartPanel'); p.style.display = 'flex'; requestAnimationFrame(() => p.classList.add('open')); document.body.style.overflow = 'hidden'; renderCartItems(); }
function closeCart() { CART_OPEN = false; $('cartOverlay').style.display = 'none'; const p = $('cartPanel'); p.classList.remove('open'); p.style.display = 'none'; document.body.style.overflow = ''; }
function toggleCart() { CART_OPEN ? closeCart() : openCart(); }
function goCheckout() { if (!CART.length) return; window.location.href = '/paiement.html'; }

function renderCartItems() {
  const el = $('cartItems'), footer = $('cartSummary'), btn = $('checkoutBtn'); if (!el) return;
  if (!CART.length) {
    el.innerHTML = '<div class="gp-cart-empty"><div class="gp-cart-empty-icon">🛒</div><p>Votre panier est vide</p></div>';
    footer.innerHTML = ''; btn.style.display = 'none'; return;
  }
  el.innerHTML = CART.map(c => `
    <div class="gp-cart-item">
      <img src="${esc(c.image || PH)}" class="gp-cart-item-img" alt="${esc(c.name)}" loading="lazy" onerror="this.onerror=null;this.src=PH">
      <div class="gp-cart-item-info">
        <div class="gp-cart-item-name">${esc(c.name)}</div>
        <div class="gp-cart-item-price">${fmt(c.price * c.qty)}</div>
        ${c.price < c.originalPrice ? `<div style="font-size:10px;color:#9ca3af;text-decoration:line-through">${fmt(c.originalPrice * c.qty)}</div>` : ''}
      </div>
      <div class="gp-cart-item-qty"><button class="gp-qty-btn" onclick="changeQty('${esc(c._id)}',-1)">−</button><span class="gp-qty-val">${c.qty}</span><button class="gp-qty-btn" onclick="changeQty('${esc(c._id)}',1)">+</button></div>
    </div>`).join('');
  footer.innerHTML = `<div class="gp-cart-total"><span>Total</span><span class="gp-cart-total-amount">${fmt(cartTotal())}</span></div>`;
  btn.style.display = 'block';
}

// ── Liste des produits ──
async function loadProducts(category = '', search = '') {
  CUR_CAT = category;
  const loader = $('productsLoader'), grid = $('productsGrid'), empty = $('productsEmpty'), cg = $('catsGrid'), br = $('backRow'), ps = $('promoSection');
  if (cg) cg.style.display = 'none'; if (br) br.style.display = 'block'; if (ps) ps.style.display = 'none';
  grid.style.display = ''; loader.style.display = 'block'; grid.innerHTML = ''; empty.style.display = 'none';
  try {
    let url = '/api/products?limit=48';
    if (category) url += '&category=' + encodeURIComponent(category);
    if (search) url += '&q=' + encodeURIComponent(search);
    const d = await (await fetch(url)).json(); PRODUCTS = d.products || [];
    loader.style.display = 'none';
    $('productsCount').textContent = (d.total || 0) + ' produit' + ((d.total || 0) !== 1 ? 's' : '');
    $('productsTitle').textContent = category || (search ? 'Résultats pour « ' + search + ' »' : 'Nos produits');
    if (!PRODUCTS.length) { empty.style.display = 'block'; return; }
    grid.innerHTML = PRODUCTS.map(cardHtml).join('');
  } catch (e) { loader.style.display = 'none'; grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:#6b7280">Erreur de chargement. <button onclick="loadProducts()" style="color:#f97316;background:none;border:none;cursor:pointer;text-decoration:underline">Réessayer</button></div>'; }
}
async function loadPromos() {
  try {
    const d = await (await fetch('/api/products?promo=1&limit=12')).json(); PROMOS = d.products || [];
    const row = $('promoRow'); row.innerHTML = PROMOS.map(cardHtml).join('');
    if (!VIEW_PRODUCTS) $('promoSection').style.display = PROMOS.length ? '' : 'none';
  } catch (e) {}
}
let VIEW_PRODUCTS = false;

// ── Catégories : chaque catégorie est un cadre ; un appui ouvre ses produits ──
function catIcon(name) {
  const n = String(name).toLowerCase();
  if (n.includes('boisson') || n.includes('jus')) return '🥤'; if (n.includes('fruit')) return '🍍'; if (n.includes('légume') || n.includes('legume')) return '🥬';
  if (n.includes('épice') || n.includes('epice')) return '🌶️'; if (n.includes('cosm') || n.includes('beaut')) return '💄'; if (n.includes('céréale') || n.includes('cereale')) return '🌾';
  if (n.includes('mode') || n.includes('vêt') || n.includes('vet')) return '👗'; if (n.includes('num') || n.includes('digit')) return '⚡';
  return '🛍️';
}
function buildCatsBar(active) {
  const bar = $('catsBar'); if (!bar) return; bar.textContent = '';
  const mk = (label, cat) => { const b = document.createElement('button'); b.className = 'gp-cat-btn' + (cat === active ? ' active' : ''); b.textContent = label; b.addEventListener('click', () => cat ? openCategory(cat) : showCategories()); bar.appendChild(b); };
  mk('Tout', ''); CATS.forEach(c => mk(c.name, c.name));
}
function renderCatCards() {
  const grid = $('catsGrid'); if (!grid) return; grid.textContent = '';
  CATS.forEach(c => {
    const all = c.images || [], imgs = all.slice(0, all.length >= 4 ? 4 : (all.length >= 2 ? 2 : all.length));
    const card = document.createElement('button'); card.type = 'button'; card.className = 'gp-cat-card';
    const mosaic = document.createElement('div'); mosaic.className = 'gp-cat-mosaic ' + (imgs.length >= 4 ? 'four' : imgs.length >= 2 ? 'two' : imgs.length === 1 ? 'one' : 'gp-cat-ph');
    if (!imgs.length) mosaic.textContent = catIcon(c.name);
    imgs.forEach(u => { const im = document.createElement('img'); im.loading = 'lazy'; im.alt = ''; im.src = u; im.addEventListener('error', () => im.remove()); mosaic.appendChild(im); });
    const nm = document.createElement('div'); nm.className = 'gp-cat-name'; nm.textContent = c.name;
    const ct = document.createElement('div'); ct.className = 'gp-cat-count'; ct.textContent = c.count + ' produit' + (c.count > 1 ? 's' : '');
    card.append(mosaic, nm, ct); card.addEventListener('click', () => openCategory(c.name)); grid.appendChild(card);
  });
}
async function showCategories() {
  CUR_CAT = ''; VIEW_PRODUCTS = false;
  const grid = $('productsGrid'), cg = $('catsGrid'), br = $('backRow'), loader = $('productsLoader'), empty = $('productsEmpty');
  grid.innerHTML = ''; grid.style.display = 'none'; br.style.display = 'none'; empty.style.display = 'none'; cg.style.display = ''; loader.style.display = 'block';
  $('promoSection').style.display = PROMOS.length ? '' : 'none'; $('productsTitle').textContent = 'Catégories';
  try {
    const d = await (await fetch('/api/categories')).json(); CATS = d.categories || []; loader.style.display = 'none';
    const total = CATS.reduce((a, c) => a + c.count, 0);
    $('productsCount').textContent = CATS.length + ' catégorie' + (CATS.length > 1 ? 's' : '') + ' · ' + total + ' produit' + (total > 1 ? 's' : '');
    buildCatsBar('');
    if (!CATS.length) { cg.textContent = ''; empty.style.display = 'block'; return; }
    renderCatCards();
  } catch (e) { loader.style.display = 'none'; toast('Erreur de chargement des catégories', 'err'); }
}
function openCategory(name) { VIEW_PRODUCTS = true; buildCatsBar(name); loadProducts(name); $('products').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function filterCat(cat) { cat ? openCategory(cat) : showCategories(); }
function doSearch() { const q = $('searchInput')?.value?.trim(); if (!q) { showCategories(); return; } VIEW_PRODUCTS = true; buildCatsBar(''); loadProducts('', q); }

// ── Démarrage ──
document.addEventListener('DOMContentLoaded', () => {
  updateAuthUI(); updateCartBadge(); renderCartItems(); loadPromos();
  const qs = new URLSearchParams(location.search);
  if (qs.get('cat')) { VIEW_PRODUCTS = true; fetch('/api/categories').then(r => r.json()).then(d => { CATS = d.categories || []; openCategory(qs.get('cat')); }).catch(showCategories); }
  else if (qs.get('q')) { const si = $('searchInput'); if (si) si.value = qs.get('q'); showCategories().then(doSearch); }
  else showCategories();
  const y = $('ftYear'); if (y) y.textContent = new Date().getFullYear();
  const sup = $('ftSupport');
  if (sup) {
    if (SITE.supportEmail) { const a = document.createElement('a'); a.href = 'mailto:' + SITE.supportEmail; a.textContent = SITE.supportEmail; sup.appendChild(a); }
    if (/^[1-9][0-9]{7,14}$/.test(SITE.supportWhatsapp || '')) { const a = document.createElement('a'); a.href = 'https://wa.me/' + SITE.supportWhatsapp; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Support WhatsApp'; sup.appendChild(a); }
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeCart(); } });
  document.addEventListener('click', e => { const m = $('userMenu'); if (m && m.style.display === 'block' && !e.target.closest('#userMenu') && !e.target.closest('#avatarBtn')) m.style.display = 'none'; });
  $('searchInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
});
