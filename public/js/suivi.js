'use strict';
// Suivi de commande : statut, lien digital, « J'ai reçu ma commande » (PHOTO OBLIGATOIRE), litige.
// Tout est construit avec createElement/textContent : aucune donnée n'est jamais interprétée comme du HTML.

let TOKEN = localStorage.getItem('gp_token');
const $ = id => document.getElementById(id);

function toast(msg, type = 'ok') {
  const w = $('toastWrap'); if (!w) return;
  const d = document.createElement('div'); d.className = 'gp-toast ' + type; d.textContent = msg; w.appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .3s'; setTimeout(() => d.remove(), 300); }, 3500);
}
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  kids.flat().forEach(c => { if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return e;
}
const fmt = n => Number(n).toLocaleString('fr-FR') + ' FCFA';
const authHdr = () => TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {};

const PILL = {
  PENDING: ['⏳ Paiement en attente', '#fef9c3', '#854d0e'], 'VALIDÉ': ['✅ Payée', '#dcfce7', '#166534'],
  LIVRÉ: ['📸 Livraison validée', '#dcfce7', '#166534'], 'REFUSÉ': ['❌ Paiement refusé', '#fee2e2', '#991b1b'], EXPIRED: ['⌛ Expirée', '#f3f4f6', '#374151'],
};

async function api(url, opts = {}) {
  let r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...authHdr() }, credentials: 'include' });
  if (r.status === 401 && TOKEN) {                           // session expirée : on continue en visiteur avec le jeton de suivi
    localStorage.removeItem('gp_token'); localStorage.removeItem('gp_user'); TOKEN = null;
    r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}) }, credentials: 'include' });
  }
  return r;
}

async function callPost(url, body) {
  const r = await api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Erreur');
  return d;
}

async function sendPhoto(ref, file, msg, card) {
  const say = (t, color) => { msg.textContent = t; msg.style.color = color || '#6b7280'; };
  try {
    say('⏳ Préparation de la photo…');
    const blob = await compressImage(file);                  // réduit + retire les données GPS (shared.js)
    const fd = new FormData();
    fd.append('image', blob, 'livraison.jpg'); fd.append('kpayId', ref.kpayId); fd.append('token', ref.token || '');
    const r = await api('/api/upload/delivery', { method: 'POST', body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Envoi impossible');
    toast('Photo reçue ✅'); await refreshCard(ref, card);
  } catch (e) { say('❌ ' + e.message, '#dc2626'); }
}

function renderCard(st, ref, card) {
  card.textContent = '';
  const pill = PILL[st.status] || [st.status, '#f3f4f6', '#374151'];
  card.append(h('div', { class: 'sv-head' },
    h('span', { class: 'sv-num' }, st.orderNumber || ref.orderNumber || 'Commande'),
    h('span', { class: 'sv-pill', style: `background:${pill[1]};color:${pill[2]}` }, pill[0])));
  if (!st.orderNumber) { card.append(h('div', { class: 'sv-box warn' }, 'Détails indisponibles sur cet appareil. Connectez-vous avec le compte utilisé pour la commande.')); return; }
  card.append(h('div', { class: 'sv-items' }, (st.items || []).map(i => i.name + ' ×' + i.qty).join(', ')),
              h('div', { class: 'sv-amount' }, fmt(st.finalAmount)));

  if (st.status === 'PENDING') { card.append(h('div', { class: 'sv-box' }, 'Validez le paiement sur votre téléphone (MTN : *126#). Cette page se met à jour toute seule.')); return; }
  if (st.status === 'REFUSÉ' || st.status === 'EXPIRED') { card.append(h('div', { class: 'sv-box warn' }, 'Ce paiement n\'a pas abouti : aucun montant n\'a été conservé. Vous pouvez recommander.')); return; }

  if (st.orderType === 'digital') {
    const links = (st.digitalLinks || []).filter(l => /^https:\/\//.test(l.url));
    card.append(h('div', { class: 'sv-box ok' }, links.length ? 'Paiement confirmé. Vos téléchargements :' : 'Paiement confirmé. Le lien n\'est pas disponible : contactez le vendeur.',
      h('div', {}, links.map(l => h('a', { class: 'sv-dl', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, '⬇ ' + l.name)))));
    return;
  }

  // ── Produit physique ──
  if (st.status === 'LIVRÉ' || st.deliveryStatus === 'VALIDATED') { card.append(h('div', { class: 'sv-box ok' }, '📸 Livraison validée par photo. Merci ! Le versement au vendeur est lancé.')); return; }
  if (st.deliveryStatus === 'DISPUTE')    { card.append(h('div', { class: 'sv-box warn' }, '⚠️ Litige en cours : le vendeur n\'est pas payé tant que l\'équipe n\'a pas tranché.')); return; }
  if (st.deliveryStatus === 'REFUND_DUE') { card.append(h('div', { class: 'sv-box info' }, 'Litige tranché en votre faveur : un remboursement va vous être fait.')); return; }
  if (st.deliveryStatus !== 'AWAITING') return;

  const msg = h('div', { class: 'sv-msg' }, st.photoUploaded ? '✅ Photo reçue. Vous pouvez confirmer la réception.' : 'Aucune photo envoyée.');
  if (st.photoUploaded) msg.style.color = '#16a34a';
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', style: 'display:none', onchange: ev => { const f = ev.target.files[0]; if (f) sendPhoto(ref, f, msg, card); ev.target.value = ''; } });
  const confirmBtn = h('button', { class: 'sv-btn primary', onclick: async ev => {
    if (!confirm('Confirmer que vous avez bien reçu votre commande ? Le vendeur sera payé.')) return;
    ev.target.disabled = true;
    try { const d = await callPost('/api/kpay/confirm-delivery', { kpayId: ref.kpayId, token: ref.token || '' }); toast(d.message || 'Livraison validée ✅'); await refreshCard(ref, card); }
    catch (e) { toast(e.message, 'err'); ev.target.disabled = false; }
  } }, '✅ J\'ai reçu ma commande');
  confirmBtn.disabled = !st.photoUploaded;                   // bouton bloqué tant qu'il n'y a pas de photo
  const disputeBtn = h('button', { class: 'sv-btn ghost', onclick: async () => {
    const reason = prompt('Quel est le problème ? (ex : colis jamais reçu, produit différent…)');
    if (!reason) return;
    try { const d = await callPost('/api/kpay/dispute', { kpayId: ref.kpayId, token: ref.token || '', reason }); toast(d.message || 'Litige enregistré'); await refreshCard(ref, card); }
    catch (e) { toast(e.message, 'err'); }
  } }, '⚠️ Signaler un problème');

  card.append(h('div', { class: 'sv-box' },
    st.shippedAt ? '📦 Le vendeur a expédié votre commande. ' : '',
    'Votre argent est conservé tant que vous n\'avez pas confirmé la réception. À la réception : 1) prenez le produit en photo, 2) confirmez.',
    h('div', { class: 'sv-actions' },
      h('label', { class: 'sv-btn photo', style: 'cursor:pointer' }, '📷 ' + (st.photoUploaded ? 'Changer la photo' : 'Photo du produit reçu'), file),
      confirmBtn, disputeBtn),
    msg));
}

async function refreshCard(ref, card) {
  clearTimeout(card._t);
  try {
    const q = ref.token ? '?token=' + encodeURIComponent(ref.token) : '';
    const r = await api('/api/kpay/status/' + encodeURIComponent(ref.kpayId) + q);
    const st = await r.json();
    if (!r.ok) { card.textContent = ''; card.append(h('div', { class: 'sv-box warn' }, st.error || 'Commande introuvable')); return; }
    renderCard(st, ref, card);
    if (st.status === 'PENDING') card._t = setTimeout(() => refreshCard(ref, card), 8000);
  } catch (e) { card._t = setTimeout(() => refreshCard(ref, card), 12000); }
}

async function init() {
  const list = $('svList'); const refs = new Map();
  try { JSON.parse(localStorage.getItem('gp_orders') || '[]').forEach(o => { if (o && o.kpayId) refs.set(o.kpayId, { kpayId: o.kpayId, token: o.token, orderNumber: o.orderNumber }); }); } catch (e) {}
  if (TOKEN) {                                               // compte connecté : on retrouve aussi ses commandes d'un autre appareil
    try {
      const r = await api('/api/kpay/my-orders'); const d = await r.json();
      (d.orders || []).forEach(o => { if (!refs.has(o.kpayId)) refs.set(o.kpayId, { kpayId: o.kpayId, token: '', orderNumber: o.orderNumber }); });
    } catch (e) {}
  }
  if (!refs.size) { $('svEmpty').style.display = 'block'; return; }
  [...refs.values()].forEach(ref => {
    const card = h('div', { class: 'sv-card' }, h('div', { class: 'sv-sub' }, 'Chargement…'));
    list.append(card); refreshCard(ref, card);
  });
}
document.addEventListener('DOMContentLoaded', init);
