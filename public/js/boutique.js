'use strict';
// Page d'une boutique : logo, nom, pays, bouton WhatsApp, tous ses produits.
const $ = id => document.getElementById(id);
const SID = new URLSearchParams(location.search).get('id') || '';
const getJson = async u => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch (e) { return null; } };
async function init() {
  updateCartCount();
  if (!/^[a-f0-9]{24}$/.test(SID)) { $('bqBanner').innerHTML = '<h2>Boutique introuvable</h2><a class="pp-outline" href="/">Retour à la boutique</a>'; return; }
  const [d, cfg] = await Promise.all([getJson('/api/products?shopId=' + SID + '&limit=48'), getJson('/api/pay/config')]);
  const list = d ? d.products : [];
  if (!list.length) { $('bqBanner').innerHTML = '<h2>Cette boutique n\'a pas encore de produit</h2><a class="pp-outline" href="/">Retour à la boutique</a>'; return; }
  indexProducts(list);
  const shop = shopOf(list[0]), c = ((cfg && cfg.countries) || []).find(x => x.iso === shop.country);
  const wa = list.map(waUrl).find(Boolean) || '';
  document.title = shop.name + ' — ' + BRAND;
  $('bqBanner').innerHTML = `${avatarHtml(shop, 'pp-shop-av huge')}<div class="bq-info"><h1>${esc(shop.name)}</h1>
    <div class="pp-muted">${c ? c.flag + ' ' + esc(c.name) + ' · ' : ''}${d.total} produit${d.total > 1 ? 's' : ''}</div>
    ${wa ? `<a class="pp-btn wa" style="max-width:300px" href="${wa}" target="_blank" rel="noopener noreferrer">${WA_ICON} Contacter la boutique</a>` : ''}</div>`;
  $('bqGrid').innerHTML = list.map(cardHtml).join('');
}
document.addEventListener('DOMContentLoaded', init);
