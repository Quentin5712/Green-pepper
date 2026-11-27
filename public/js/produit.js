'use strict';
// Fiche produit détaillée (façon grande boutique en ligne) : galerie, prix et remise, boutique, livraison,
// points forts, spécifications, description, produits de la même boutique, avis avec photos.
const $ = id => document.getElementById(id);
const PID = new URLSearchParams(location.search).get('id') || '';
let P = null, COUNTRY = {};
const getJson = async u => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch (e) { return null; } };

const stockHtml = p => p.stock <= 0 ? '<div class="pp-stock out">Épuisé</div>' : p.stock <= 5 ? `<div class="pp-stock low">Plus que ${p.stock} en stock</div>` : '<div class="pp-stock">En stock</div>';
const rowsHtml = a => (a || []).map(x => `<div class="pp-hl-row"><b>${esc(x.label)}</b><span>${esc(x.value)}</span></div>`).join('');

function galleryHtml(p) {
  const imgs = [p.imageUrl, ...(p.images || [])].filter(Boolean); if (!imgs.length) imgs.push(PH);
  return `<div class="pp-gal"><div class="pp-slides" id="slides">${imgs.map(u => `<div class="pp-slide"><img src="${esc(u)}" alt="${esc(p.name)}" loading="lazy" onerror="this.onerror=null;this.src=PH" data-zoom="1"></div>`).join('')}</div>
    ${imgs.length > 1 ? `<div class="pp-dots" id="dots">${imgs.map((_, i) => `<i class="pp-dot${i ? '' : ' on'}"></i>`).join('')}</div>` : ''}</div>`;
}
function priceHtml(p, usdt) {
  const promo = !!p.discountActive;
  return `<div class="pp-price-box">
    ${promo ? '<span class="pp-deal">Offre en cours</span>' : ''}
    <div class="pp-price-line">${promo ? `<span class="pp-off">-${p.discountPercent}%</span>` : ''}<span class="pp-price">${fmtN(p.finalPrice ?? p.price)}<small> FCFA</small></span></div>
    ${promo ? `<div class="pp-was">Prix habituel : <s>${fmt(p.price)}</s></div><div class="pp-save">Vous économisez ${fmt(p.savings)}</div><div class="pp-until">⏳ Offre valable jusqu'au ${esc(longDate(p.discountExpiresAt))}</div>` : ''}
    ${usdt ? `<div class="pp-usdt">≈ ${fmtN(usdt)} USDT (taux indicatif)</div>` : ''}
  </div>`;
}
function infoHtml(p, usdt) {
  const shop = shopOf(p), c = COUNTRY[shop.country] || null, physical = p.type !== 'digital', wa = waUrl(p);
  const qty = physical && p.stock > 0 ? `<div class="pp-qty"><label for="ppQty">Quantité :</label><select id="ppQty">${Array.from({ length: Math.min(p.stock, 10) }, (_, i) => `<option>${i + 1}</option>`).join('')}</select></div>` : '';
  return `<div class="pp-info">
    <div class="pp-crumb"><a href="/">Accueil</a> › <a href="/?cat=${encodeURIComponent(p.category || '')}">${esc(p.category || 'Divers')}</a></div>
    <a class="pp-shopline" href="${esc(shopLink(shop))}">${avatarHtml(shop, 'pp-shop-av')}<span>Visiter la boutique <b>${esc(shop.name)}</b></span></a>
    ${p.brand ? `<div class="pp-brand">Marque : <b>${esc(p.brand)}</b></div>` : ''}
    <h1 class="pp-title">${esc(p.name)}</h1>
    <a class="pp-rate" href="#avis">${p.reviewCount ? `<span class="gp-card-stars">${stars(p.rating)}</span> <b>${String(p.rating).replace('.', ',')}</b> <span class="pp-link">(${p.reviewCount} avis)</span>` : '<span class="pp-link">Pas encore d\'avis — soyez le premier</span>'}</a>
    ${p.sold30 ? `<div class="pp-sold"><b>${p.sold30}</b> acheté${p.sold30 > 1 ? 's' : ''} au cours du mois dernier</div>` : ''}
    ${p.type === 'digital' ? '<div class="pp-chip">⚡ Produit digital — accès immédiat après paiement</div>' : ''}
    ${priceHtml(p, usdt)}
    <div class="pp-deliv">
      <div>📦 <b>Livraison :</b> ${p.type === 'digital' ? 'aucune, le lien de téléchargement est disponible dès le paiement confirmé.' : esc(p.deliveryInfo || 'délais et frais communiqués par le vendeur (voir Livraison & retours).')}</div>
      ${physical ? '<div>🔒 <b>Paiement protégé :</b> le vendeur n\'est payé qu\'après votre confirmation de réception avec une photo.</div><div>↩️ <b>Retours :</b> sous 7 jours si le produit est non ouvert et non utilisé. <a href="/legal/livraison-retours.html">Conditions</a></div>' : ''}
    </div>
    ${stockHtml(p)}
    ${qty}
    <button class="pp-btn add" id="ppAdd" ${p.stock <= 0 ? 'disabled' : ''}>Ajouter au panier</button>
    <button class="pp-btn buy" id="ppBuy" ${p.stock <= 0 ? 'disabled' : ''}>Acheter maintenant</button>
    ${wa ? `<a class="pp-btn wa" href="${wa}" target="_blank" rel="noopener noreferrer">${WA_ICON} Contacter le vendeur sur WhatsApp</a>` : ''}
    <div class="pp-seller"><span>Expédié par</span><b>${esc(shop.name)}</b><span>Vendu par</span><a href="${esc(shopLink(shop))}"><b>${esc(shop.name)}</b>${c ? ` <small>${c.flag} ${esc(c.name)}</small>` : ''}</a></div>
  </div>`;
}
function detailsHtml(p) {
  const shop = shopOf(p), c = COUNTRY[shop.country] || null;
  const origin = p.origin ? `<div class="pp-hl-row"><b>Pays d'origine</b><span>${esc(p.origin)}</span></div>` : '';
  return `<section class="pp-sec" id="details"><h2>Détails du produit</h2>
    ${(p.highlights && p.highlights.length) || origin ? `<h3>Principaux points forts</h3><div class="pp-hl">${rowsHtml(p.highlights)}${origin}</div>` : ''}
    ${p.bullets && p.bullets.length ? `<h3>À propos de cet article</h3><ul class="pp-bul">${p.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
    ${p.specs && p.specs.length ? `<details class="pp-acc"><summary>Spécifications du produit</summary><table class="pp-spec">${p.specs.map(x => `<tr><th>${esc(x.label)}</th><td>${esc(x.value)}</td></tr>`).join('')}</table></details>` : ''}
    <details class="pp-acc"><summary>À propos de la boutique</summary><div class="pp-about">${avatarHtml(shop, 'pp-shop-av big')}<div><b>${esc(shop.name)}</b>${c ? `<div>${c.flag} ${esc(c.name)}</div>` : ''}${shop.platform ? '<div>Boutique officielle de la plateforme</div>' : `<a href="${esc(shopLink(shop))}">Voir tous ses produits →</a>`}</div></div></details>
    <details class="pp-acc" open><summary>Description du produit</summary><div class="pp-desc">${esc(p.description || 'Aucune description pour ce produit.')}</div></details>
  </section>`;
}
const carousel = (id, title, list) => list && list.length ? `<section class="pp-sec" id="${id}"><h2>${title}</h2><div class="pp-row">${list.map(cardHtml).join('')}</div></section>` : '';
function reviewsHtml(rv, p) {
  const tot = rv ? rv.total : 0;
  const head = tot ? `<div class="pp-avg"><div class="pp-avg-n">${String(rv.average).replace('.', ',')}</div><div><span class="gp-card-stars">${stars(rv.average)}</span><div class="pp-link">${tot} avis</div></div></div>
    <div class="pp-bars">${[5, 4, 3, 2, 1].map(s => { const n = rv.distribution[s] || 0; return `<div class="pp-bar"><span>${s} ★</span><i><u style="width:${Math.round(n / tot * 100)}%"></u></i><span>${n}</span></div>`; }).join('')}</div>` : '<p class="pp-muted">Aucun avis pour le moment.</p>';
  const photos = (rv ? rv.reviews : []).filter(a => /^\/api\/images\/[a-f0-9]{24}$/.test(a.photoUrl || ''));
  return `<section class="pp-sec" id="avis"><h2>Avis clients</h2>${head}
    ${photos.length ? `<h3>Commentaires avec images</h3><div class="pp-photos">${photos.map(a => `<a href="${esc(a.photoUrl)}" target="_blank" rel="noopener noreferrer"><img src="${esc(a.photoUrl)}" alt="Photo d'un client" loading="lazy"></a>`).join('')}</div>` : ''}
    ${(rv ? rv.reviews : []).map(a => `<article class="pp-rev"><div class="pp-rev-h">${initialHtml(a.firstName, 'pp-rev-av')}<span>${esc(a.firstName)} ${esc(a.lastName)}</span></div>
      <div><span class="gp-card-stars">${stars(a.rating)}</span> <b class="pp-verified">Achat vérifié</b></div>
      <div class="pp-muted">Avis laissé à ${esc(a.location)} le ${esc(longDate(a.createdAt))}</div>
      <p>${esc(a.comment)}</p>
      ${/^\/api\/images\/[a-f0-9]{24}$/.test(a.photoUrl || '') ? `<a href="${esc(a.photoUrl)}" target="_blank" rel="noopener noreferrer"><img class="pp-rev-img" src="${esc(a.photoUrl)}" alt="Photo du client" loading="lazy"></a>` : ''}</article>`).join('')}
    <div class="pp-actions2"><a class="pp-outline" href="/avis.html?productId=${esc(p._id)}">Voir tous les avis</a><a class="pp-outline" href="/avis.html?productId=${esc(p._id)}#donner">Écrire un avis</a></div>
  </section>`;
}

function bindGallery() {
  const sl = $('slides'), dots = [...document.querySelectorAll('#dots .pp-dot')];
  if (sl && dots.length) sl.addEventListener('scroll', () => { const i = Math.round(sl.scrollLeft / sl.clientWidth); dots.forEach((d, k) => d.classList.toggle('on', k === i)); }, { passive: true });
  document.querySelectorAll('.pp-slide img').forEach(im => im.addEventListener('click', () => { $('lbImg').src = im.src; $('lb').style.display = 'flex'; }));
}
function bindTabs() {
  const secs = ['details', 'similaires', 'avis'].map(id => $(id)).filter(Boolean), tabs = [...document.querySelectorAll('#ppTabs a[data-t]')];
  window.addEventListener('scroll', () => { let cur = 'details'; secs.forEach(s => { if (s.getBoundingClientRect().top < 120) cur = s.id; }); tabs.forEach(t => t.classList.toggle('on', t.dataset.t === cur)); }, { passive: true });
}
function addedBar() { const b = $('ppAdded'); b.style.display = 'flex'; clearTimeout(addedBar.t); addedBar.t = setTimeout(() => b.style.display = 'none', 6000); }

async function init() {
  updateCartCount();
  $('hqBtn').addEventListener('click', () => { const q = $('hq').value.trim(); location.href = q ? '/?q=' + encodeURIComponent(q) : '/'; });
  $('hq').addEventListener('keydown', e => { if (e.key === 'Enter') $('hqBtn').click(); });
  $('lbX').addEventListener('click', () => $('lb').style.display = 'none'); $('lb').addEventListener('click', e => { if (e.target.id === 'lb') $('lb').style.display = 'none'; });
  $('ppAddedX').addEventListener('click', () => $('ppAdded').style.display = 'none');
  if (!/^[a-f0-9]{24}$/.test(PID)) return notFound();
  const [p, rel, rv, cfg] = await Promise.all([getJson('/api/products/' + PID), getJson('/api/products/' + PID + '/related'), getJson('/api/avis?productId=' + PID + '&limit=6'), getJson('/api/pay/config')]);
  if (!p) return notFound();
  P = p; LITE.products[p._id] = p; indexProducts(rel ? [...rel.sameShop, ...rel.similar] : []);
  (cfg && cfg.countries || []).forEach(c => { COUNTRY[c.iso] = c; });
  let usdt = null; const q = await getJson('/api/pay/quote?amount=' + (p.finalPrice ?? p.price)); if (q && q.usdt) usdt = q.usdt;
  document.title = p.name + ' — ' + BRAND;
  $('pp').innerHTML = `<div class="pp-top">${galleryHtml(p)}${infoHtml(p, usdt)}</div>${detailsHtml(p)}
    ${carousel('boutique-liste', 'Autres produits de ' + esc(shopOf(p).name), rel && rel.sameShop)}${carousel('similaires', 'Produits similaires', rel && rel.similar)}
    ${reviewsHtml(rv, p)}`;
  bindGallery(); bindTabs();
  const add = $('ppAdd'), buy = $('ppBuy'), qty = () => Number(($('ppQty') || {}).value) || 1;
  if (add) add.addEventListener('click', () => { const r = pushCart(p, qty()); if (r.ok) addedBar(); else toast(r.msg, 'err'); });
  if (buy) buy.addEventListener('click', () => { const r = pushCart(p, qty()); if (r.ok || /maximum/.test(r.msg)) location.href = '/paiement.html'; else toast(r.msg, 'err'); });
  if (location.hash && $(location.hash.slice(1))) $(location.hash.slice(1)).scrollIntoView();
}
function notFound() { $('pp').innerHTML = '<div class="pp-sec" style="text-align:center;padding:60px 16px"><h2>Produit introuvable</h2><p class="pp-muted">Ce produit n\'existe plus ou n\'est plus disponible.</p><a class="pp-outline" href="/">Retour à la boutique</a></div>'; }
document.addEventListener('DOMContentLoaded', init);
