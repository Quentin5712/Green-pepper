'use strict';
// Avis clients : liste publique + formulaire réservé aux clients qui ont REÇU leur commande. Photo facultative.
const $ = id => document.getElementById(id);
let TOKEN = localStorage.getItem('gp_token');
const params = new URLSearchParams(location.search);
const PRODUCT = /^[a-f0-9]{24}$/.test(params.get('productId') || '') ? params.get('productId') : '';
let PAGE = 1, RATING = 0, ELIG = [], PHOTO = null;

function toast(msg, type = 'ok') { const w = $('toastWrap'); const d = document.createElement('div'); d.className = 'gp-toast ' + type; d.textContent = msg; w.appendChild(d); setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .3s'; setTimeout(() => d.remove(), 300); }, 3500); }
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
  kids.flat().forEach(c => { if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return e;
}
const stars = r => '★'.repeat(r) + '☆'.repeat(5 - r);
const authH = () => TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {};

// ── Liste publique ──
async function loadReviews(reset) {
  if (reset) { PAGE = 1; $('avList').textContent = ''; }
  const r = await fetch('/api/avis?page=' + PAGE + '&limit=8' + (PRODUCT ? '&productId=' + PRODUCT : '')); const d = await r.json();
  if (reset) {
    $('avSum').style.display = d.total ? '' : 'none';
    $('avAvg').textContent = String(d.average).replace('.', ',');
    $('avStars').textContent = stars(Math.round(d.average)); $('avCount').textContent = d.total + ' avis';
    const bars = $('avBars'); bars.textContent = '';
    for (let s = 5; s >= 1; s--) { const n = d.distribution[s] || 0; bars.append(h('div', { class: 'av-bar' }, h('span', { style: 'width:14px' }, s + '★'), h('i', { style: 'width:' + (d.total ? Math.round(n / d.total * 100) : 0) + '%;min-width:' + (n ? '4px' : '0') }), h('span', {}, String(n)))); }
    $('avEmpty').style.display = d.total ? 'none' : 'block';
    if (PRODUCT) { const f = $('avFilter'); f.style.display = ''; f.textContent = ''; f.append('Avis sur un produit · ', h('a', { href: '/avis.html', style: 'color:#0b4a40;font-weight:700' }, 'voir tous les avis')); }
  }
  (d.reviews || []).forEach(a => $('avList').append(h('div', { class: 'av-card' },
    h('div', { class: 'av-head' }, h('div', {}, h('span', { class: 'av-name' }, a.firstName + ' ' + a.lastName), ' ', h('span', { class: 'av-loc' }, '· ' + a.location)), h('span', { class: 'gp-card-stars' }, stars(a.rating))),
    a.productName ? h('div', { class: 'av-prod' }, a.productName + (a.shopName ? ' · ' + a.shopName : '')) : null,
    h('div', { class: 'av-text' }, a.comment),
    /^\/api\/images\/[a-f0-9]{24}$/.test(a.photoUrl || '') ? h('a', { class: 'av-photo', href: a.photoUrl, target: '_blank', rel: 'noopener noreferrer' }, h('img', { src: a.photoUrl, alt: 'Photo du client', loading: 'lazy' })) : null,
    h('div', { class: 'pay-hint', style: 'margin-top:6px' }, new Date(a.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })))));
  $('avMore').style.display = d.page * 8 < d.total ? '' : 'none';
}

// ── Mes commandes éligibles (reçues) ──
async function loadEligible() {
  let refs = []; try { refs = JSON.parse(localStorage.getItem('gp_orders') || '[]').filter(o => o && o.kpayId); } catch (e) {}
  if (TOKEN) { try { const d = await (await fetch('/api/kpay/my-orders', { headers: authH() })).json(); (d.orders || []).forEach(o => { if (!refs.find(x => x.kpayId === o.kpayId)) refs.push({ kpayId: o.kpayId, token: '' }); }); } catch (e) {} }
  const res = await Promise.all(refs.slice(0, 20).map(async o => { try {
    const r = await fetch('/api/avis/eligible?kpayId=' + encodeURIComponent(o.kpayId) + '&token=' + encodeURIComponent(o.token || ''), { headers: authH() }); if (!r.ok) return null;
    const d = await r.json(); return d.eligible ? { ref: o, orderNumber: d.orderNumber, products: d.products.filter(p => !p.reviewed) } : null; } catch (e) { return null; } }));
  ELIG = res.filter(Boolean);
  const want = params.get('ref'); if (want) ELIG.sort((a, b) => (b.ref.kpayId === want) - (a.ref.kpayId === want));
  if (!ELIG.length) { $('avNoOrder').style.display = ''; return; }
  $('avForm').style.display = '';
  const so = $('avOrder'); ELIG.forEach((e, i) => so.append(h('option', { value: String(i) }, e.orderNumber)));
  so.addEventListener('change', fillProducts); fillProducts();
}
function fillProducts() {
  const e = ELIG[Number($('avOrder').value)] || ELIG[0]; const sp = $('avProduct'); sp.textContent = '';
  e.products.forEach(p => sp.append(h('option', { value: p.id }, p.name)));
  if (PRODUCT && e.products.find(p => p.id === PRODUCT)) sp.value = PRODUCT;
}

// ── Étoiles, photo, envoi ──
function buildStars() {
  const box = $('avStarsIn');
  for (let i = 1; i <= 5; i++) box.append(h('button', { type: 'button', class: 'av-star', role: 'radio', 'aria-label': i + ' sur 5', onclick: () => { RATING = i; [...box.children].forEach((b, k) => b.classList.toggle('on', k < i)); } }, '★'));
}
$('avPhoto').addEventListener('change', async ev => {
  const f = ev.target.files[0]; if (!f) return;
  try { PHOTO = await compressImage(f); const u = URL.createObjectURL(PHOTO); $('avPrev').src = u; $('avPrev').style.display = ''; $('avPhotoClear').style.display = ''; }
  catch (e) { PHOTO = null; toast(e.message, 'err'); }
  ev.target.value = '';
});
$('avPhotoClear').addEventListener('click', () => { PHOTO = null; $('avPrev').style.display = 'none'; $('avPhotoClear').style.display = 'none'; });
$('avSend').addEventListener('click', async () => {
  const msg = $('avMsg'); const say = (t, ok) => { msg.textContent = t; msg.style.color = ok ? '#16a34a' : '#dc2626'; };
  const e = ELIG[Number($('avOrder').value)] || ELIG[0];
  const first = $('avFirst').value.trim(), last = $('avLast').value.trim(), loc = $('avLoc').value.trim(), text = $('avText').value.trim();
  if (!RATING) return say('Choisissez une note de 1 à 5 étoiles.');
  if (first.length < 2 || last.length < 2) return say('Prénom et nom requis.');
  if (loc.length < 2) return say('Indiquez votre localisation (ville, pays).');
  if (text.length < 10) return say('Votre avis doit faire au moins 10 caractères.');
  if (!$('avConsent').checked) return say('Cochez la case pour accepter la publication.');
  const fd = new FormData();
  fd.append('kpayId', e.ref.kpayId); fd.append('token', e.ref.token || ''); fd.append('productId', $('avProduct').value); fd.append('rating', String(RATING));
  fd.append('firstName', first); fd.append('lastName', last); fd.append('location', loc); fd.append('comment', text); fd.append('consent', '1');
  if (PHOTO) fd.append('image', PHOTO, 'avis.jpg');
  $('avSend').disabled = true; say('⏳ Envoi…', true); msg.style.color = '#6b7280';
  try {
    const r = await fetch('/api/avis', { method: 'POST', headers: authH(), body: fd }); const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Envoi impossible');
    toast('Merci ! Votre avis est publié ✅'); say(d.message || 'Avis publié.', true);
    ['avFirst', 'avLast', 'avLoc', 'avText'].forEach(id => $(id).value = ''); RATING = 0; PHOTO = null; $('avPrev').style.display = 'none'; $('avPhotoClear').style.display = 'none'; $('avConsent').checked = false;
    [...$('avStarsIn').children].forEach(b => b.classList.remove('on'));
    await loadReviews(true); await loadEligible_reset();
  } catch (err) { say(err.message, false); }
  finally { $('avSend').disabled = false; }
});
async function loadEligible_reset() { $('avOrder').textContent = ''; $('avForm').style.display = 'none'; $('avNoOrder').style.display = 'none'; await loadEligible(); }
$('avMore').addEventListener('click', () => { PAGE++; loadReviews(false); });

document.addEventListener('DOMContentLoaded', async () => { buildStars(); await loadReviews(true); await loadEligible(); if (location.hash === '#donner' || params.get('ref')) { const f = $('avForm'); if (f.style.display !== 'none') f.scrollIntoView({ behavior: 'smooth' }); } });
