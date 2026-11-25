'use strict';
// Page de paiement : MTN MoMo · Orange Money · Visa/Mastercard · USDT (TRC20) · autres opérateurs.
// Prix = FCFA + équivalent USDT. Anti double-paiement : un seul envoi à la fois + une référence unique par tentative (clientRef).
const $ = id => document.getElementById(id);
const TOKEN = localStorage.getItem('gp_token');
const fmtN = n => Number(n).toLocaleString('fr-FR');
let CART = [], CFG = null, METHOD = null, BUSY = false, POLL = null, TICK = null;

function toast(msg, type = 'ok') {
  const w = $('toastWrap'); const d = document.createElement('div'); d.className = 'gp-toast ' + type; d.textContent = msg; w.appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .3s'; setTimeout(() => d.remove(), 300); }, 3500);
}
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
  kids.flat().forEach(c => { if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return e;
}
const authH = () => { const x = { 'Content-Type': 'application/json' }; if (TOKEN) x.Authorization = 'Bearer ' + TOKEN; return x; };

// ── Une référence par tentative : double clic ou rafraîchissement = MÊME commande, jamais deux ──
function clientRef() {
  let r = sessionStorage.getItem('gp_cref');
  if (!r) { r = 'c' + (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : (Date.now().toString(36) + Math.random().toString(36).slice(2))); sessionStorage.setItem('gp_cref', r); }
  return r.slice(0, 64);
}
const newAttempt = () => sessionStorage.removeItem('gp_cref');

const METHODS = [
  { id: 'mtn',    label: 'MTN MoMo',         sub: 'Cameroun',          logo: 'mtn.svg',    kind: 'momo', provider: 'MTN_MOMO_CMR', need: 'momo' },
  { id: 'orange', label: 'Orange Money',     sub: 'Cameroun',          logo: 'orange.svg', kind: 'momo', provider: 'ORANGE_CMR',   need: 'momo' },
  { id: 'card',   label: 'Visa / Mastercard', sub: 'Carte bancaire',   logo: 'card.svg',   kind: 'gateway', need: 'gateway' },
  { id: 'usdt',   label: 'USDT (TRC20)',     sub: 'Crypto-monnaie',    logo: 'usdt.svg',   kind: 'usdt', need: 'usdt' },
];
const OTHER = { id: 'other', label: 'Autre opérateur Mobile Money', kind: 'gateway', need: 'gateway' };

// ── Panier à jour (prix réels, réductions, stock) ──
async function refreshCart() {
  CART = JSON.parse(localStorage.getItem('gp_cart') || '[]');
  const out = [];
  await Promise.all(CART.map(async c => {
    try {
      const r = await fetch('/api/products/' + encodeURIComponent(c._id)); if (!r.ok) throw new Error();
      const p = await r.json();
      if (p.stock <= 0) { toast(p.name + ' est épuisé : retiré du panier', 'err'); return; }
      out.push({ ...c, name: p.name, price: p.finalPrice ?? p.price, originalPrice: p.price, type: p.type || 'physical', qty: Math.min(c.qty, p.stock, 10) });
    } catch (e) { toast((c.name || 'Un produit') + ' n\'est plus disponible : retiré du panier', 'err'); }
  }));
  CART = CART.map(c => out.find(o => o._id === c._id)).filter(Boolean);
  localStorage.setItem('gp_cart', JSON.stringify(CART));
}
const total = () => CART.reduce((a, c) => a + c.price * c.qty, 0);
const hasPhysical = () => CART.some(c => c.type !== 'digital');

async function renderSummary() {
  const box = $('sumItems'); box.textContent = '';
  CART.forEach(c => box.append(h('div', { class: 'pay-row' }, h('span', {}, c.name + ' ×' + c.qty), h('span', {}, fmtN(c.price * c.qty) + ' FCFA'))));
  $('sumTotal').textContent = fmtN(total()) + ' FCFA';
  $('pAddrBox').style.display = hasPhysical() ? '' : 'none';
  try {
    const q = await (await fetch('/api/pay/quote?amount=' + total())).json();
    $('sumUsdt').textContent = q.usdt ? '≈ ' + fmtN(q.usdt) + ' USDT (taux indicatif, garanti ' + q.validMinutes + ' min au paiement)' : '';
  } catch (e) {}
}

function renderMethods() {
  const grid = $('pmGrid'); grid.textContent = '';
  const mk = (m, el) => { const off = !(CFG && CFG.methods[m.need]); el.classList.toggle('off', off); el.disabled = off; if (off) el.title = 'Bientôt disponible'; el.addEventListener('click', () => select(m)); };
  METHODS.forEach(m => {
    const off = !(CFG && CFG.methods[m.need]);
    const b = h('button', { type: 'button', class: 'pm', 'data-m': m.id }, h('img', { src: '/images/pay/' + m.logo, alt: m.label }), h('b', {}, m.label), h('small', {}, off ? 'Bientôt disponible' : m.sub));
    grid.append(b); mk(m, b);
  });
  mk(OTHER, $('pmOther'));
}
function select(m) {
  if (BUSY) return;
  METHOD = m;
  document.querySelectorAll('.pm, .pm-other').forEach(e => e.classList.remove('sel'));
  const el = m.id === 'other' ? $('pmOther') : document.querySelector('.pm[data-m="' + m.id + '"]'); if (el) el.classList.add('sel');
  refreshBtn();
  $('pPhoneHint').textContent = m.kind === 'momo' ? 'Le numéro ' + m.label + ' (Cameroun) qui va payer. Vous recevrez la demande sur ce téléphone.' : 'Un numéro pour vous joindre (livraison, suivi).';
}

// ── Panneaux d'état ──
function panel(cls, ...kids) { const p = $('payPanel'); p.textContent = ''; if (cls) p.append(h('div', { class: 'pay-panel ' + cls, role: 'status', 'aria-live': 'polite' }, ...kids)); window.scrollTo({ top: 0, behavior: 'smooth' }); }
// Libellé du bouton : toujours cohérent avec le moyen choisi (après un échec, il redevient « Payer … »)
function refreshBtn() {
  const b = $('payBtn');
  if (!METHOD) { b.disabled = true; b.textContent = 'Choisissez un moyen de paiement'; return; }
  b.disabled = false; b.textContent = 'Payer ' + fmtN(total()) + ' FCFA — ' + METHOD.label;
}
function lock(on) { BUSY = on; $('payForm').style.opacity = on ? '.5' : ''; $('payForm').style.pointerEvents = on ? 'none' : ''; if (!on) refreshBtn(); }
function failure(msg) {
  clearInterval(POLL); clearInterval(TICK); lock(false); newAttempt();
  panel('ko', h('h3', {}, '❌ Paiement non abouti'), h('div', {}, msg), h('div', { class: 'pay-actions' },
    h('button', { class: 'pay-btn2 fill', onclick: () => { panel(null); $('payBtn').scrollIntoView({ behavior: 'smooth' }); } }, 'Réessayer'),
    h('button', { class: 'pay-btn2', onclick: () => { panel(null); $('pmGrid').scrollIntoView({ behavior: 'smooth' }); } }, 'Choisir un autre moyen')),
    h('div', { class: 'pay-hint', style: 'margin-top:8px' }, 'Aucun montant n\'est conservé quand un paiement échoue. Si vous avez été débité, il sera confirmé automatiquement ou remboursé : contactez-nous avec votre numéro de commande.'));
}
function success(orderType) {
  clearInterval(POLL); clearInterval(TICK); lock(false); newAttempt();
  CART = []; localStorage.setItem('gp_cart', '[]');
  $('payForm').style.display = 'none'; $('stepPay').className = 'done'; $('stepDone').className = 'on';
  panel('ok', h('h3', {}, '✅ Paiement confirmé'), h('div', {}, orderType === 'digital'
    ? 'Votre achat est confirmé. Votre lien de téléchargement est disponible dans « Suivi de commande ».'
    : 'Merci ! À la réception, prenez le produit en photo et confirmez dans « Suivi de commande » : le vendeur n\'est payé qu\'à ce moment-là.'),
    h('div', { class: 'pay-actions' }, h('a', { class: 'pay-btn2 fill', href: '/suivi.html' }, 'Suivre ma commande'), h('a', { class: 'pay-btn2', href: '/' }, 'Continuer mes achats')));
}
function remember(d, method) {
  try {
    const s = JSON.parse(localStorage.getItem('gp_orders') || '[]').filter(o => o.externalId !== d.externalId);
    s.unshift({ kpayId: d.kpayId, token: d.trackToken, orderNumber: d.orderNumber, orderType: d.orderType, externalId: d.externalId, method, at: Date.now() });
    localStorage.setItem('gp_orders', JSON.stringify(s.slice(0, 30)));
  } catch (e) {}
}
async function status(d) {
  const r = await fetch('/api/kpay/status/' + encodeURIComponent(d.kpayId) + '?token=' + encodeURIComponent(d.trackToken || ''), { headers: TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {} });
  return r.json();
}

// ── Mobile Money direct : le client valide sur son téléphone ──
function waitMomo(d) {
  panel('wait', h('h3', {}, h('span', { class: 'spin-sm' }), 'En attente de votre validation'), h('div', {}, d.message || 'Validez le paiement sur votre téléphone.'),
    h('div', { class: 'pay-hint', style: 'margin-top:8px' }, 'Ne payez pas une deuxième fois : cette page se met à jour toute seule dès que votre paiement est reçu. Commande ' + d.orderNumber));
  lock(true); let n = 0;
  POLL = setInterval(async () => {
    if (++n > 45) { clearInterval(POLL); lock(false); panel('ko', h('h3', {}, '⏱️ Toujours pas de confirmation'), h('div', {}, 'Si vous avez validé le paiement, ne recommencez pas : retrouvez votre commande dans « Suivi » (elle se mettra à jour dès réception).'), h('div', { class: 'pay-actions' }, h('a', { class: 'pay-btn2 fill', href: '/suivi.html' }, 'Voir mon suivi'), h('button', { class: 'pay-btn2', onclick: () => { newAttempt(); panel(null); } }, 'Réessayer'))); return; }
    try { const s = await status(d); if (['VALIDÉ', 'LIVRÉ'].includes(s.status)) success(d.orderType); else if (['REFUSÉ', 'EXPIRED'].includes(s.status)) failure('Le paiement a été refusé ou a expiré. Vérifiez votre solde et le numéro, puis réessayez.'); } catch (e) {}
  }, 4000);
}

// ── USDT TRC20 : adresse + montant exact ──
function copy(text, btn) {
  const done = () => { const o = btn.textContent; btn.textContent = 'Copié ✓'; setTimeout(() => btn.textContent = o, 1500); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => {});
  else { const t = h('textarea', { style: 'position:fixed;opacity:0' }); t.value = text; document.body.append(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) {} t.remove(); }
}
function showUsdt(d, live) {
  const c = d.crypto || {};
  const state = h('div', { class: 'pay-hint', style: 'margin-top:8px' }, '⏳ En attente de votre paiement…');
  const timer = h('span', { class: 'pay-timer' }, '');
  panel('info', h('h3', {}, 'Payez en USDT (réseau TRC20)'),
    h('div', {}, 'Envoyez ', h('b', {}, 'exactement ' + c.amount + ' USDT'), ' sur le réseau ', h('b', {}, 'TRC20 (Tron)'), ' à cette adresse :'),
    h('div', { class: 'usdt-box' }, h('code', {}, c.address || ''), h('div', { class: 'usdt-line' }, h('span', { class: 'pay-hint' }, 'Adresse'), h('button', { class: 'usdt-copy', onclick: e => copy(c.address || '', e.target) }, 'Copier l\'adresse'))),
    h('div', { class: 'usdt-box' }, h('code', {}, c.amount + ' USDT'), h('div', { class: 'usdt-line' }, h('span', { class: 'pay-hint' }, '≈ ' + fmtN(d.priceUsd || 0) + ' $ · commande ' + d.orderNumber), h('button', { class: 'usdt-copy', onclick: e => copy(String(c.amount), e.target) }, 'Copier le montant'))),
    h('div', { class: 'pay-hint' }, '⚠️ Utilisez uniquement le réseau TRC20. Envoyez le montant exact en une seule fois. Une autre crypto ou un autre réseau serait perdu. Expire dans ', timer, '.'), state);
  lock(true);
  const end = c.expiresAt ? new Date(c.expiresAt).getTime() : Date.now() + 3600000;
  const tick = () => { const s = Math.max(0, Math.floor((end - Date.now()) / 1000)); timer.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); if (!s) { clearInterval(TICK); failure('Le délai de paiement USDT est dépassé. Si vous avez déjà envoyé les fonds, ils seront rattachés à votre commande automatiquement : vérifiez « Suivi ».'); } };
  tick(); TICK = setInterval(tick, 1000);
  POLL = setInterval(async () => {
    try {
      const s = await status(d);
      if (['VALIDÉ', 'LIVRÉ'].includes(s.status)) return success(d.orderType);
      if (['REFUSÉ', 'EXPIRED'].includes(s.status)) return failure('Le paiement USDT n\'a pas abouti (expiré ou refusé).');
      const cs = s.crypto && s.crypto.status;
      if (cs === 'confirming' || cs === 'confirmed' || cs === 'sending') state.textContent = '🔄 Paiement détecté, confirmation du réseau en cours…';
      else if (cs === 'partially_paid') state.textContent = '⚠️ Montant incomplet : reçu ' + (s.crypto.actuallyPaid || 0) + ' USDT sur ' + c.amount + '. Envoyez le complément à la MÊME adresse.';
    } catch (e) {}
  }, 6000);
}

// ── Envoi ──
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: authH(), credentials: 'include', body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Erreur de paiement'); return d;
}
async function submit() {
  if (BUSY) return;                                                   // anti double clic
  const name = $('pName').value.trim(), phone = $('pPhone').value.trim(), addr = $('pAddr').value.trim();
  if (!CART.length) return toast('Panier vide', 'err');
  if (name.length < 2) return toast('Entrez votre nom', 'err');
  if (!METHOD) return toast('Choisissez un moyen de paiement', 'err');
  if (hasPhysical() && addr.length < 5) return toast('Entrez votre adresse de livraison', 'err');
  const phoneOk = /^[0-9+\s.\-]{8,15}$/.test(phone);
  if (METHOD.kind === 'momo' && !phoneOk) return toast('Entrez le numéro Mobile Money qui va payer', 'err');
  if (phone && !phoneOk) return toast('Numéro de téléphone invalide', 'err');
  lock(true); $('payBtn').textContent = '⏳ Traitement…';
  const body = { items: CART.map(c => ({ productId: c._id, qty: c.qty })), customerName: name, phone, address: addr, clientRef: clientRef() };
  try {
    if (METHOD.kind === 'momo') { const d = await post('/api/kpay/pay', { ...body, provider: METHOD.provider }); remember(d, METHOD.id); if (!d.kpayId) { lock(false); return panel('wait', h('h3', {}, 'Paiement lancé'), h('div', {}, 'Gardez votre numéro de commande : ' + d.orderNumber), h('a', { class: 'pay-btn2 fill', href: '/suivi.html' }, 'Suivi')); } waitMomo(d); }
    else if (METHOD.kind === 'gateway') { const d = await post('/api/pay/gateway', body); remember(d, METHOD.id); if (d.existing && !d.redirectUrl) { lock(false); return panel('wait', h('h3', {}, 'Paiement déjà ouvert'), h('div', {}, 'Une page de paiement a déjà été ouverte pour cette commande. Retrouvez-la dans « Suivi » ou réessayez dans quelques minutes.'), h('a', { class: 'pay-btn2 fill', href: '/suivi.html' }, 'Suivi')); } panel('wait', h('h3', {}, h('span', { class: 'spin-sm' }), 'Redirection vers la page de paiement sécurisée…')); location.href = d.redirectUrl; }
    else { const d = await post('/api/pay/usdt', body); remember(d, 'usdt'); showUsdt(d); }
  } catch (e) { failure(e.message); }
}

async function init() {
  const params = new URLSearchParams(location.search);
  if (params.get('cancel')) { newAttempt(); toast('Paiement annulé : votre panier est conservé.', 'err'); }
  CART = JSON.parse(localStorage.getItem('gp_cart') || '[]');
  if (!CART.length) { $('payGrid').style.display = 'none'; $('payEmpty').style.display = 'block'; return; }
  try { CFG = await (await fetch('/api/pay/config')).json(); } catch (e) { CFG = { methods: {} }; }
  renderMethods();
  await refreshCart();
  if (!CART.length) { $('payGrid').style.display = 'none'; $('payEmpty').style.display = 'block'; return; }
  await renderSummary();
  $('payBtn').addEventListener('click', submit);
  $('pmOther').addEventListener('click', () => {});
  try { const u = JSON.parse(localStorage.getItem('gp_user') || 'null'); if (u && u.name) $('pName').value = u.name; } catch (e) {}
}
document.addEventListener('DOMContentLoaded', init);
