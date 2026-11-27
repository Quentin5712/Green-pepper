'use strict';
// Éléments communs à la vitrine, à la fiche produit et à la page boutique :
// cartes produit, logo + nom de la boutique, bouton WhatsApp. Chargé AVANT app.js / produit.js / boutique.js.
const SITE  = window.SITE || { name: 'Marketplace Afrique' };
const BRAND = SITE.name || 'Marketplace Afrique';
const fmtN  = n => Number(n).toLocaleString('fr-FR');
const fmt   = n => fmtN(n) + ' FCFA';
const esc   = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PH    = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><rect width='300' height='300' fill='%23f7f4ed'/><text x='150' y='170' font-size='60' text-anchor='middle'>🛍️</text></svg>";
function stars(r) { const n = Math.round(Number(r) * 2) / 2, s = []; for (let i = 1; i <= 5; i++) s.push(i <= n ? '★' : (i - .5 === n ? '⯨' : '☆')); return s.join(''); }
const shortDate = d => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const longDate  = d => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

// ── Boutique : TOUT produit affiche le logo + le nom de sa boutique (la plateforme pour ses propres produits) ──
const PLATFORM_SHOP = { id: '', name: BRAND, logoUrl: '/images/logo-mark-96.png', country: '', platform: true };
const shopOf = p => p.shop || PLATFORM_SHOP;
const shopLink = s => s && s.id ? '/boutique.html?id=' + encodeURIComponent(s.id) : '/';
const AV_COLORS = ['#0b4a40', '#b45309', '#1d4ed8', '#7c3aed', '#be123c', '#0f766e'];
function initialHtml(name, cls) { const n = String(name || '?').trim(); return `<span class="${esc(cls)} av-init" style="background:${AV_COLORS[(n.charCodeAt(0) || 0) % AV_COLORS.length]}">${esc(n.charAt(0).toUpperCase() || '?')}</span>`; }
// Logo de la boutique ; si la boutique n'a pas de logo (ou s'il ne charge pas) : pastille avec son initiale — jamais de trou
function avatarHtml(shop, cls) { return shop.logoUrl ? `<img class="${esc(cls)}" src="${esc(shop.logoUrl)}" alt="" loading="lazy" data-n="${esc(shop.name)}" onerror="avatarFallback(this)">` : initialHtml(shop.name, cls); }
function avatarFallback(img) { const t = document.createElement('template'); t.innerHTML = initialHtml(img.dataset.n, img.className.replace(/\bav-init\b/, '')); img.replaceWith(t.content.firstChild); }

// ── WhatsApp : le numéro du marchand ; pour les produits de la plateforme, celui du support ──
const WA_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';
function waNumber(p) { const n = String(p.sellerWhatsapp || (p.shop ? '' : SITE.supportWhatsapp) || ''); return /^[1-9][0-9]{7,14}$/.test(n) ? n : ''; }
function waUrl(p) { const n = waNumber(p); return n ? 'https://wa.me/' + n + '?text=' + encodeURIComponent('Bonjour, je suis intéressé par votre produit ' + p.name + ' sur ' + BRAND) : ''; }
function waLink(p) { const u = waUrl(p); return u ? `<a class="gp-wa" href="${u}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" title="Écrire au vendeur sur WhatsApp" aria-label="Écrire au vendeur sur WhatsApp">${WA_ICON}</a>` : ''; }

// ── Carte produit ──
function cardHtml(p) {
  const out = p.stock <= 0, low = !out && p.stock <= 5, promo = !!p.discountActive, shop = shopOf(p);
  const price = promo
    ? `<div class="gp-price-row"><span class="gp-card-price gp-price-now promo">${fmtN(p.finalPrice)} <span class="gp-card-price-fcfa">FCFA</span></span><span class="gp-price-old">${fmtN(p.price)}</span></div><div class="gp-promo-end">Jusqu'au ${esc(shortDate(p.discountExpiresAt))}</div>`
    : `<div class="gp-card-price">${fmtN(p.price)} <span class="gp-card-price-fcfa">FCFA</span></div>`;
  return `<div class="gp-card" onclick="openProduct('${esc(p._id)}')">
    <div style="position:relative">
      <img src="${esc(p.imageUrl || PH)}" class="gp-card-img" alt="${esc(p.name)}" loading="lazy" onerror="this.onerror=null;this.src=PH">
      ${promo ? `<span class="gp-badge-off">-${p.discountPercent}%</span>` : ''}
      ${p.type === 'digital' ? '<span class="gp-dig">⚡ Digital</span>' : ''}
      ${out ? '<div style="position:absolute;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center"><span style="background:#fff;color:#ef4444;font-size:11px;font-weight:700;padding:4px 12px;border-radius:100px">Épuisé</span></div>' : ''}
    </div>
    <div class="gp-card-body">
      <div class="gp-shop-chip">${avatarHtml(shop, 'gp-shop-av')}<span>${esc(shop.name)}</span></div>
      <div class="gp-card-cat">${esc(p.category || '')}</div>
      <div class="gp-card-name">${esc(p.name)}</div>
      <div class="gp-card-unit">${esc(p.unit || '')}</div>
      ${p.reviewCount ? `<div class="gp-card-rating"><span class="gp-card-stars">${stars(p.rating)}</span><span class="gp-card-rc">(${p.reviewCount})</span></div>` : '<div class="gp-card-rating"><span class="gp-card-rc">Nouveau</span></div>'}
      <div class="gp-card-footer">
        <div>${price}${low ? `<div class="gp-card-stock-low">⚠️ Plus que ${p.stock}</div>` : ''}</div>
        <div style="display:flex;gap:6px;align-items:center">${waLink(p)}<button class="gp-add-btn" onclick="event.stopPropagation();addToCart('${esc(p._id)}')" ${out ? 'disabled' : ''} title="Ajouter au panier">+</button></div>
      </div>
    </div>
  </div>`;
}
function openProduct(id) { window.location.href = '/produit.html?id=' + encodeURIComponent(id); }
