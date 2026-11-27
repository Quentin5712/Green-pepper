'use strict';
// Panier minimal pour les pages « fiche produit » et « boutique » (même stockage que la vitrine : localStorage gp_cart)
const LITE = { products: {} };
function readCart() { try { return JSON.parse(localStorage.getItem('gp_cart') || '[]'); } catch (e) { return []; } }
function updateCartCount() { const n = readCart().reduce((a, c) => a + c.qty, 0), b = document.getElementById('hCount'); if (b) { b.textContent = n; b.style.display = n > 0 ? 'flex' : 'none'; } }
function toast(msg, type = 'ok') {
  const w = document.getElementById('toastWrap'); if (!w) return;
  const d = document.createElement('div'); d.className = 'gp-toast ' + (type === 'err' ? 'err' : 'ok'); d.textContent = msg; w.appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .3s'; setTimeout(() => d.remove(), 300); }, 3200);
}
// Ajoute au panier en respectant le stock (10 par produit au maximum). Le prix est celui AFFICHÉ ; le serveur le recalcule au paiement.
function pushCart(p, qty) {
  if (p.stock <= 0) return { ok: false, msg: 'Stock épuisé' };
  const cart = readCart(), cap = Math.min(p.stock, 10), ex = cart.find(c => c._id === p._id);
  if (ex && ex.qty >= cap) return { ok: false, msg: 'Quantité maximum atteinte' };
  const nq = Math.min((ex ? ex.qty : 0) + qty, cap);
  if (ex) ex.qty = nq; else cart.push({ _id: p._id, name: p.name, price: p.finalPrice ?? p.price, originalPrice: p.price, image: p.imageUrl || '', qty: nq, sellerId: p.sellerId, shopName: (p.shop && p.shop.name) || '', type: p.type });
  localStorage.setItem('gp_cart', JSON.stringify(cart)); updateCartCount();
  return { ok: true };
}
// Appelée par le bouton « + » des cartes produit
function addToCart(id) { const p = LITE.products[id]; if (!p) return; const r = pushCart(p, 1); toast(r.ok ? p.name + ' ajouté 🛒' : r.msg, r.ok ? 'ok' : 'err'); }
function indexProducts(list) { (list || []).forEach(p => { LITE.products[p._id] = p; }); }
