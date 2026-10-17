/* ═══════════════════════════════════════════
   Green Pepper Market — app.js
   Zéro JSONBin. Tout passe par /api/*
═══════════════════════════════════════════ */
'use strict';

// ── État global ──
const CART = JSON.parse(localStorage.getItem('gp_cart') || '[]');
let PRODUCTS  = [];
let SEL_OP    = null;
let POLL_INT  = null;
let CART_OPEN = false;

// ── Utils ──
function $(id) { return document.getElementById(id); }

function toast(msg, type = 'ok') {
  const w = $('toastWrap'); if (!w) return;
  const d = document.createElement('div');
  d.className = `gp-toast ${type}`;
  d.textContent = msg;
  w.appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .3s'; setTimeout(() => d.remove(), 300); }, 3000);
}

function fmt(n) { return Number(n).toLocaleString('fr-FR') + ' FCFA'; }

function stars(rating) {
  const r = Math.round(Number(rating) * 2) / 2;
  let s = '';
  for (let i = 1; i <= 5; i++) {
    s += i <= r ? '★' : (i - 0.5 === r ? '½' : '☆');
  }
  return s;
}

// ── PANIER — persisté en localStorage ──
function saveCart() { localStorage.setItem('gp_cart', JSON.stringify(CART)); }

function cartTotal() { return CART.reduce((a, c) => a + c.price * c.qty, 0); }

function cartCount() { return CART.reduce((a, c) => a + c.qty, 0); }

function updateCartBadge() {
  const n = cartCount();
  const b = $('cartCount');
  if (!b) return;
  b.textContent = n;
  b.style.display = n > 0 ? 'flex' : 'none';
}

function addToCart(productId) {
  const p = PRODUCTS.find(x => x._id === productId);
  if (!p) return;
  if (p.stock <= 0) { toast('Stock épuisé', 'err'); return; }
  const existing = CART.find(c => c._id === productId);
  if (existing) {
    if (existing.qty >= p.stock) { toast('Stock insuffisant', 'err'); return; }
    existing.qty++;
  } else {
    CART.push({ _id: p._id, name: p.name, price: p.price, image: p.image || '', qty: 1, sellerId: p.sellerId });
  }
  saveCart();
  updateCartBadge();
  renderCartItems();
  toast(`${p.name} ajouté ! 🛒`);
}

function changeQty(productId, delta) {
  const idx = CART.findIndex(c => c._id === productId);
  if (idx < 0) return;
  CART[idx].qty += delta;
  if (CART[idx].qty <= 0) CART.splice(idx, 1);
  saveCart();
  updateCartBadge();
  renderCartItems();
}

// ── PANIER UI ──
function toggleCart() {
  CART_OPEN = !CART_OPEN;
  const overlay = $('cartOverlay');
  const panel   = $('cartPanel');
  if (CART_OPEN) {
    overlay.style.display = 'block';
    panel.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderCartItems();
  } else {
    overlay.style.display = 'none';
    panel.classList.remove('open');
    document.body.style.overflow = '';
  }
}

function renderCartItems() {
  const el = $('cartItems');
  const footer = $('cartSummary');
  const btn    = $('checkoutBtn');
  if (!el) return;

  if (!CART.length) {
    el.innerHTML = `<div class="gp-cart-empty"><div class="gp-cart-empty-icon">🛒</div><p>Votre panier est vide</p></div>`;
    if (footer) footer.innerHTML = '';
    if (btn) btn.style.display = 'none';
    return;
  }

  el.innerHTML = CART.map(item => `
    <div class="gp-cart-item">
      <img src="${item.image || 'https://via.placeholder.com/56x56?text=🌶️'}" class="gp-cart-item-img" alt="${item.name}" loading="lazy">
      <div class="gp-cart-item-info">
        <div class="gp-cart-item-name">${item.name}</div>
        <div class="gp-cart-item-price">${fmt(item.price * item.qty)}</div>
      </div>
      <div class="gp-cart-item-qty">
        <button class="gp-qty-btn" onclick="changeQty('${item._id}', -1)">−</button>
        <span class="gp-qty-val">${item.qty}</span>
        <button class="gp-qty-btn" onclick="changeQty('${item._id}', 1)">+</button>
      </div>
    </div>
  `).join('');

  if (footer) {
    footer.innerHTML = `<div class="gp-cart-total"><span>Total</span><span class="gp-cart-total-amount">${fmt(cartTotal())}</span></div>`;
  }
  if (btn) btn.style.display = 'block';
}

// ── PRODUITS ──
async function loadProducts(category = '', search = '') {
  const loader = $('productsLoader');
  const grid   = $('productsGrid');
  const empty  = $('productsEmpty');
  const title  = $('productsTitle');
  const count  = $('productsCount');

  if (loader) loader.style.display = 'block';
  if (grid)   grid.innerHTML = '';
  if (empty)  empty.style.display = 'none';

  try {
    let url = '/api/products?limit=48';
    if (category) url += '&category=' + encodeURIComponent(category);
    if (search)   url += '&search='   + encodeURIComponent(search);

    const r    = await fetch(url);
    const data = await r.json();

    PRODUCTS = data.products || [];

    if (loader) loader.style.display = 'none';

    if (!PRODUCTS.length) {
      if (empty) empty.style.display = 'block';
      if (count) count.textContent = '0 produit';
      return;
    }

    if (title) title.textContent = category || (search ? `Résultats pour "${search}"` : 'Nos produits');
    if (count) count.textContent = `${data.total} produit${data.total > 1 ? 's' : ''}`;

    if (grid) {
      grid.innerHTML = PRODUCTS.map(p => {
        const outOfStock = p.stock <= 0;
        const lowStock   = !outOfStock && p.stock <= 5;
        return `
        <div class="gp-card" onclick="void(0)">
          <img src="${p.image || 'https://via.placeholder.com/300x160?text=🌶️'}" class="gp-card-img" alt="${p.name}" loading="lazy"
               onerror="this.src='https://via.placeholder.com/300x160?text=🌶️'">
          <div class="gp-card-body">
            <div class="gp-card-cat">${p.category || ''}</div>
            <div class="gp-card-name">${p.name}</div>
            <div class="gp-card-unit">${p.unit || ''}</div>
            <div class="gp-card-rating">
              <span class="gp-card-stars">${stars(p.rating || 4.5)}</span>
              <span class="gp-card-rc">(${p.reviewCount || 0})</span>
            </div>
            <div class="gp-card-footer">
              <div>
                <div class="gp-card-price">${Number(p.price).toLocaleString('fr-FR')} <span class="gp-card-price-fcfa">FCFA</span></div>
                ${lowStock ? `<div class="gp-card-stock-low">⚠️ Plus que ${p.stock}</div>` : ''}
                ${outOfStock ? `<div class="gp-card-stock-low">Épuisé</div>` : ''}
              </div>
              <button class="gp-add-btn" onclick="event.stopPropagation();addToCart('${p._id}')" ${outOfStock ? 'disabled' : ''} title="Ajouter au panier">+</button>
            </div>
          </div>
        </div>`;
      }).join('');
    }
  } catch(e) {
    if (loader) loader.style.display = 'none';
    if (grid)   grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:#6b7280">Erreur de chargement. <button onclick="loadProducts()" style="color:#f97316;text-decoration:underline">Réessayer</button></div>`;
    console.error('loadProducts:', e);
  }
}

// ── FILTRES ──
function filterCat(cat) {
  document.querySelectorAll('.gp-cat-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === cat);
  });
  loadProducts(cat);
}

function doSearch() {
  const q = $('searchInput')?.value?.trim();
  if (!q) { loadProducts(); return; }
  loadProducts('', q);
}

// ── CHECKOUT ──
function openCheckout() {
  if (!CART.length) return;
  // Fermer le panier
  $('cartOverlay').style.display = 'none';
  $('cartPanel').classList.remove('open');
  document.body.style.overflow = '';
  CART_OPEN = false;

  // Remplir le récap
  const recap = $('checkoutRecap');
  if (recap) {
    recap.innerHTML = CART.map(i => `
      <div class="gp-checkout-recap-item">
        <span>${i.name} ×${i.qty}</span>
        <span>${fmt(i.price * i.qty)}</span>
      </div>
    `).join('') + `<div class="gp-checkout-total"><span>Total</span><span>${fmt(cartTotal())}</span></div>`;
  }

  // Reset état paiement
  SEL_OP = null;
  document.querySelectorAll('.gp-op-btn').forEach(b => b.classList.remove('selected'));
  const payBtn = $('payBtn'); if (payBtn) { payBtn.disabled = true; payBtn.textContent = 'Payer via Mobile Money'; }
  const payMsg = $('payMsg'); if (payMsg) { payMsg.style.display = 'none'; payMsg.className = 'gp-pay-msg'; }

  $('checkoutOverlay').style.display = 'block';
  $('checkoutModal').style.display   = 'block';
  document.body.style.overflow = 'hidden';
}

function closeCheckout() {
  $('checkoutOverlay').style.display = 'none';
  $('checkoutModal').style.display   = 'none';
  document.body.style.overflow = '';
  clearInterval(POLL_INT);
}

function selectOp(op) {
  SEL_OP = op;
  document.querySelectorAll('.gp-op-btn').forEach(b => b.classList.remove('selected'));
  const btn = op === 'MTN_MOMO_CMR' ? $('opMTN') : $('opORANGE');
  if (btn) btn.classList.add('selected');
  const payBtn = $('payBtn');
  if (payBtn) {
    payBtn.disabled = false;
    payBtn.textContent = `Payer avec ${op === 'MTN_MOMO_CMR' ? 'MTN MoMo 🟡' : 'Orange Money 🟠'}`;
  }
}

// ── PAIEMENT ──
async function submitPayment() {
  const phone    = $('ckPhone')?.value?.trim();
  const name     = $('ckName')?.value?.trim();
  const location = $('ckLocation')?.value?.trim();
  const payBtn   = $('payBtn');
  const payMsg   = $('payMsg');

  if (!phone) { toast('Entrez votre numéro Mobile Money', 'err'); return; }
  if (!location) { toast('Entrez votre localisation', 'err'); return; }
  if (!SEL_OP) { toast('Choisissez un opérateur', 'err'); return; }
  if (!CART.length) { toast('Panier vide', 'err'); return; }

  // Désactiver le bouton
  payBtn.disabled = true;
  payBtn.textContent = '⏳ Traitement…';
  payMsg.style.display = 'none';

  try {
    const body = {
      phone,
      operator:    SEL_OP,
      customerName: name || 'Client anonyme',
      location,
      deliveryFee: 0,
      items: CART.map(c => ({
        productId: c._id,
        name:      c.name,
        price:     c.price,
        quantity:  c.qty,
      })),
    };

    const r    = await fetch('/api/payment/pay', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await r.json();

    if (!r.ok) {
      throw new Error(data.error || data.detail || 'Erreur paiement');
    }

    // PENDING → afficher le message et poller
    payMsg.style.display = 'block';
    payMsg.className = 'gp-pay-msg pending';
    payMsg.textContent = data.message || 'Composez *126# et validez le paiement…';
    payBtn.textContent = '⏳ En attente de confirmation…';

    const externalId = data.externalId;

    // Polling du statut toutes les 5s pendant 3min max
    let attempts = 0;
    POLL_INT = setInterval(async () => {
      attempts++;
      if (attempts > 36) { // 3min
        clearInterval(POLL_INT);
        payBtn.disabled = false;
        payBtn.textContent = 'Réessayer';
        payMsg.className = 'gp-pay-msg error';
        payMsg.textContent = 'Délai dépassé. Vérifiez votre téléphone et réessayez.';
        return;
      }

      try {
        const sr    = await fetch(`/api/payment/status/${externalId}`);
        const sdata = await sr.json();

        if (sdata.status === 'VALIDÉ') {
          clearInterval(POLL_INT);
          // Succès 🎉
          payMsg.className = 'gp-pay-msg success';
          payMsg.textContent = '✅ Paiement confirmé ! Votre commande est en cours de préparation.';
          payBtn.textContent = 'Commande validée ✅';
          // Vider le panier
          CART.length = 0;
          saveCart();
          updateCartBadge();
          toast('Commande validée ! 🎉', 'ok');

        } else if (sdata.status === 'REFUSÉ') {
          clearInterval(POLL_INT);
          payMsg.className = 'gp-pay-msg error';
          payMsg.textContent = '❌ Paiement refusé. Vérifiez votre solde et réessayez.';
          payBtn.disabled = false;
          payBtn.textContent = 'Réessayer';
          toast('Paiement refusé', 'err');
        }
      } catch(e) { /* ignore erreurs réseau polling */ }
    }, 5000);

  } catch(e) {
    payBtn.disabled = false;
    payBtn.textContent = 'Réessayer';
    payMsg.style.display = 'block';
    payMsg.className = 'gp-pay-msg error';
    payMsg.textContent = `❌ ${e.message}`;
    toast(e.message, 'err');
  }
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();
  renderCartItems();
  loadProducts();

  // Recherche sur Enter
  const searchInput = $('searchInput');
  if (searchInput) {
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') doSearch();
    });
  }

  // Seed auto si aucun produit (mode démo)
  fetch('/api/products?limit=1').then(r => r.json()).then(data => {
    if (data.total === 0) {
      fetch('/api/products/seed').then(r => r.json()).then(d => {
        if (d.count > 0) loadProducts();
      });
    }
  }).catch(() => {});
});
