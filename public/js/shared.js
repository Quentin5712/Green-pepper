'use strict';
// Fonctions communes à l'admin et au marchand : photos, groupes par catégorie

const PLACEHOLDER = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' rx='8' fill='%23e5e7eb'/></svg>";

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── PHOTO : choisie sur le téléphone, réduite puis envoyée ; le serveur renvoie le lien ──
function loadBitmap(file) {
  if (window.createImageBitmap) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload  = () => { URL.revokeObjectURL(url); resolve(im); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Photo illisible')); };
    im.src = url;
  });
}

// Réduit à 1000 px et ré-encode en JPEG : léger (≈150 Ko) et sans les données GPS de la photo
async function compressImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Format non autorisé (JPG, PNG ou WebP)');
  if (file.size > 15 * 1024 * 1024) throw new Error('Photo trop lourde (15 Mo maximum)');
  const bmp = await loadBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  for (const q of [0.82, 0.7, 0.55]) {
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', q));
    if (blob && blob.size <= 1.4 * 1024 * 1024) return blob;
  }
  throw new Error('Photo trop lourde, choisissez-en une plus petite');
}

async function uploadImage(file) {
  const blob = await compressImage(file);
  const fd = new FormData(); fd.append('image', blob, 'photo.jpg');
  const r = await fetch('/api/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('gp_token') || '') }, body: fd, credentials: 'include' });
  let d = {}; try { d = await r.json(); } catch(e) {}
  if (r.status === 401) { localStorage.removeItem('gp_token'); localStorage.removeItem('gp_user'); window.location.href = '/login.html'; }
  if (!r.ok) throw new Error(d.error || 'Envoi impossible');
  return d.url;
}

function setImgPreview(url) {
  const im = document.getElementById('pImgPreview'), clr = document.getElementById('pImgClear');
  if (!im) return;
  im.onerror = () => { im.style.display = 'none'; };
  if (url) { im.src = url; im.style.display = 'block'; } else { im.removeAttribute('src'); im.style.display = 'none'; }
  if (clr) clr.style.display = url ? 'inline-block' : 'none';
}

function clearImage() {
  const f = document.getElementById('pImg'); if (f) f.value = '';
  setImgPreview('');
  const st = document.getElementById('pImgStatus'); if (st) st.textContent = '';
}

async function onPickImage(input) {
  const file = input.files && input.files[0]; if (!file) return;
  const st = document.getElementById('pImgStatus');
  const say = (t, ok) => { if (st) { st.textContent = t; st.style.color = ok === false ? '#dc2626' : ok ? '#16a34a' : '#6b7280'; } };
  say('⏳ Préparation et envoi de la photo…');
  try {
    const url = await uploadImage(file);
    const f = document.getElementById('pImg'); if (f) f.value = url;
    setImgPreview(url);
    say('✅ Photo ajoutée. Cliquez sur « Enregistrer » pour finir.', true);
  } catch(e) { say('❌ ' + e.message, false); }
  finally { input.value = ''; }
}

// ── LISTE GROUPÉE PAR CATÉGORIE : un appui sur le cadre ouvre ou ferme ses produits ──
function renderGrouped(tbody, prods, rowHtml, cols) {
  const groups = new Map();
  prods.forEach(p => {
    const name = String(p.category || 'Divers').trim() || 'Divers';
    const k = name.toLowerCase();
    if (!groups.has(k)) groups.set(k, { name, items: [] });
    groups.get(k).items.push(p);
  });
  const list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  tbody.innerHTML = list.map(g =>
    `<tr class="cat-head" onclick="toggleCat(this)"><td colspan="${cols}">🗂️ <b>${esc(g.name)}</b> · ${g.items.length} produit${g.items.length > 1 ? 's' : ''}<span class="cat-arrow">▾</span></td></tr>` +
    g.items.map(rowHtml).join('')
  ).join('');
  if (list.length > 1) tbody.querySelectorAll('tr.cat-head').forEach(h => setGroupVisible(h, false));
}
function setGroupVisible(head, show) {
  head.classList.toggle('closed', !show);
  let n = head.nextElementSibling;
  while (n && !n.classList.contains('cat-head')) { n.style.display = show ? '' : 'none'; n = n.nextElementSibling; }
}
function toggleCat(head) { setGroupVisible(head, head.classList.contains('closed')); }

// ── Suggestions de catégories existantes (évite « boisson » / « Boissons » en double) ──
async function fillCatList() {
  const dl = document.getElementById('catList'); if (!dl) return;
  try {
    const r = await fetch('/api/categories'); const d = await r.json();
    dl.textContent = '';
    (d.categories || []).forEach(c => { const o = document.createElement('option'); o.value = c.name; dl.appendChild(o); });
  } catch(e) {}
}
document.addEventListener('DOMContentLoaded', fillCatList);
