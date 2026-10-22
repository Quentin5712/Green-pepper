'use strict';
// ══════════════════════════════════════════════
// admin.js — Green Pepper Market
// Polling 10s pour les connectés
// Impersonate marchand
// CRUD produits, réductions, audit
// ══════════════════════════════════════════════

const TOKEN = localStorage.getItem('gp_token');
const USER  = JSON.parse(localStorage.getItem('gp_user') || '{}');

// Vérifier auth admin
if (!TOKEN || USER.role !== 'admin') { window.location.href = '/login.html'; }

let CURRENT_TAB    = 'dashboard';
let ONLINE_INTERVAL = null;
let ORDERS_STATUS  = '';
let USERS_ROLE     = '';
let IMPERSONATE_EMAIL = '';

function api(url, opts = {}) {
  return fetch('/api' + url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN, ...(opts.headers || {}) },
    credentials: 'include',
  });
}

function toast(msg, type = 'ok') {
  const w = document.getElementById('toastWrap'); if (!w) return;
  const d = document.createElement('div');
  d.className = 'gp-toast' + (type === 'err' ? ' err' : type === 'ok' ? ' ok' : '');
  d.textContent = msg; w.appendChild(d);
  setTimeout(() => { d.style.opacity='0'; d.style.transition='opacity .3s'; setTimeout(()=>d.remove(),300); }, 3500);
}

function fmt(n) { return Number(n).toLocaleString('fr-FR') + ' FCFA'; }
function fmtDate(d) { return d ? new Date(d).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'; }

function maskPhone(p) {
  if (!p) return '—';
  const s = String(p).replace(/\s/g,'');
  return s.slice(0,5) + '** **' + ' ' + s.slice(-2);
}

// ── TABS ──
function switchTab(tab) {
  CURRENT_TAB = tab;
  document.querySelectorAll('[id^="tab-"]').forEach(el => el.style.display = 'none');
  const panel = document.getElementById('tab-' + tab);
  if (panel) panel.style.display = 'block';

  clearInterval(ONLINE_INTERVAL);
  if (tab === 'dashboard') loadStats();
  if (tab === 'online')    { loadOnlineUsers(); ONLINE_INTERVAL = setInterval(loadOnlineUsers, 10000); }
  if (tab === 'users')     loadUsers();
  if (tab === 'shops')     loadShops();
  if (tab === 'products')  loadProducts();
  if (tab === 'orders')    loadOrders();
  if (tab === 'audit')     loadAudit();
}

// ── STATS ──
async function loadStats() {
  try {
    const r = await api('/admin/stats'); const d = await r.json();
    const set = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
    set('stUsers',     d.users     ?? '—');
    set('stMerchants', d.merchants ?? '—');
    set('stOnline',    d.online    ?? '—');
    set('stProducts',  d.products  ?? '—');
    set('stPending',   d.pending   ?? '—');
    set('stValide',    d.valide    ?? '—');
    set('stRevenue',   d.revenue   ? Number(d.revenue).toLocaleString('fr-FR') : '—');
    const badge = document.getElementById('onlineBadge');
    if (badge) badge.textContent = d.online ?? 0;
  } catch(e) { console.error('loadStats:', e); }
}

// ── CONNECTÉS ──
async function loadOnlineUsers() {
  const tbody = document.getElementById('onlineTable');
  try {
    const r = await api('/admin/users/online'); const d = await r.json();
    const users = d.users || [];
    const badge = document.getElementById('onlineBadge'); if(badge) badge.textContent = users.length;
    const cnt   = document.getElementById('onlineCount'); if(cnt)   cnt.textContent   = users.length;
    if (!users.length) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:#9ca3af">Aucun utilisateur connecté</td></tr>'; return; }
    tbody.innerHTML = users.map(u => {
      const cartInfo    = (u.cart || []).map(c => c.productId?.name + ' ×' + c.qty).join(', ') || '—';
      const orderInfo   = u.currentOrder ? (u.currentOrder.orderNumber + ' · ' + u.currentOrder.status) : '—';
      const ago         = u.lastActive ? Math.round((Date.now() - new Date(u.lastActive)) / 60000) + ' min' : '—';
      const rolePill    = u.role === 'merchant' ? '<span style="background:#fef9c3;color:#854d0e;padding:2px 8px;border-radius:100px;font-size:10px;font-weight:700">Marchand</span>' : '<span style="background:#f0f9ff;color:#0369a1;padding:2px 8px;border-radius:100px;font-size:10px;font-weight:700">Client</span>';
      return `<tr>
        <td><span class="online-dot dot-green"></span><span class="pill pill-online">En ligne</span></td>
        <td style="font-weight:600">${u.name}</td>
        <td>${rolePill}</td>
        <td style="font-size:12px;color:#6b7280">${maskPhone(u.phone)} <button onclick="revealPhone('${u._id}',this)" style="font-size:10px;color:#f97316;background:none;border:none;cursor:pointer">Voir</button></td>
        <td style="font-family:monospace;font-size:11px;color:#6b7280">${u.currentIP || '—'}</td>
        <td style="font-size:12px;color:#6b7280">${ago}</td>
        <td style="font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${cartInfo}">${cartInfo}</td>
        <td style="font-size:11px;color:${u.currentOrder?.status==='PENDING'?'#f59e0b':'#6b7280'}">${orderInfo}</td>
        <td style="display:flex;gap:6px">
          ${u.role==='merchant' ? `<button onclick="openImpersonate('${u.email}')" class="action-btn btn-enter">Entrer</button>` : ''}
          <button onclick="banUser('${u._id}',${!u.isBanned})" class="action-btn btn-ban">${u.isBanned?'Débannir':'Bannir'}</button>
        </td>
      </tr>`;
    }).join('');
  } catch(e) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:#ef4444">Erreur chargement</td></tr>'; }
}

async function revealPhone(userId, btn) {
  try {
    const r = await api('/admin/users/' + userId + '/phone'); const d = await r.json();
    if (d.phone) { btn.parentElement.textContent = d.phone; }
  } catch(e) { toast('Erreur', 'err'); }
}

// ── UTILISATEURS ──
async function loadUsers(role = USERS_ROLE) {
  USERS_ROLE = role;
  const tbody = document.getElementById('usersTable');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#9ca3af">Chargement…</td></tr>';
  try {
    const r = await api('/admin/users' + (role ? '?role='+role : '')); const d = await r.json();
    const users = d.users || [];
    if (!users.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#9ca3af">Aucun utilisateur.</td></tr>'; return; }
    tbody.innerHTML = users.map(u => `<tr>
      <td style="font-weight:600">${u.name}</td>
      <td style="font-size:12px">${u.email}</td>
      <td style="font-size:12px;color:#6b7280">${maskPhone(u.phone)}</td>
      <td>${u.role === 'merchant' ? '<span style="background:#fef9c3;color:#854d0e;padding:2px 8px;border-radius:100px;font-size:10px;font-weight:700">Marchand</span>' : '<span style="background:#f0f9ff;color:#0369a1;padding:2px 8px;border-radius:100px;font-size:10px;font-weight:700">Client</span>'}</td>
      <td>${u.isBanned ? '<span class="pill pill-banned">Banni</span>' : u.isOnline ? '<span class="pill pill-online">En ligne</span>' : '<span class="pill pill-offline">Hors ligne</span>'}</td>
      <td style="font-size:11px;color:#9ca3af">${fmtDate(u.createdAt)}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        ${u.role==='merchant' ? `<button onclick="openImpersonate('${u.email}')" class="action-btn btn-enter">Entrer</button>` : ''}
        <button onclick="banUser('${u._id}',${!u.isBanned})" class="action-btn btn-ban">${u.isBanned?'Débannir':'Bannir'}</button>
        <button onclick="deleteUser('${u._id}')" class="action-btn btn-del">Suppr.</button>
      </td>
    </tr>`).join('');
  } catch(e) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#ef4444">Erreur</td></tr>'; }
}

function filterUsers(role) {
  document.querySelectorAll('.filter-btn[data-r]').forEach(b => b.classList.toggle('active', b.dataset.r === role));
  loadUsers(role);
}

async function banUser(userId, isBanned) {
  const reason = isBanned ? (prompt('Raison du ban (optionnel):') || '') : '';
  try {
    const r = await api('/admin/users/'+userId+'/ban', { method:'PUT', body:JSON.stringify({ isBanned, banReason:reason }) });
    const d = await r.json();
    if (!r.ok) { toast(d.error||'Erreur', 'err'); return; }
    toast(isBanned ? 'Utilisateur banni' : 'Utilisateur débanni');
    if (CURRENT_TAB === 'online') loadOnlineUsers();
    else loadUsers();
  } catch(e) { toast('Erreur réseau', 'err'); }
}

async function deleteUser(userId) {
  if (!confirm('Supprimer définitivement cet utilisateur ?')) return;
  try {
    await api('/admin/users/'+userId, { method:'DELETE' });
    toast('Utilisateur supprimé'); loadUsers();
  } catch(e) { toast('Erreur', 'err'); }
}

// ── BOUTIQUES ──
async function loadShops() {
  const tbody = document.getElementById('shopsTable');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#9ca3af">Chargement…</td></tr>';
  try {
    const r = await api('/admin/shops'); const d = await r.json();
    const shops = d.shops || [];
    if (!shops.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#9ca3af">Aucune boutique.</td></tr>'; return; }
    tbody.innerHTML = shops.map(s => `<tr>
      <td style="font-weight:600">${s.name}</td>
      <td style="font-size:12px">${s.ownerId?.name || '—'}<br><span style="color:#9ca3af;font-size:11px">${s.ownerId?.email||''}</span></td>
      <td><span style="background:#f0f9ff;color:#0369a1;padding:2px 8px;border-radius:100px;font-size:10px;font-weight:700">${s.category||'—'}</span></td>
      <td><span class="${s.kycStatus==='VERIFIED'?'pill pill-valide':'pill pill-pending'}">${s.kycStatus}</span></td>
      <td><span class="${s.isActive?'pill pill-valide':'pill pill-offline'}">${s.isActive?'Active':'Inactive'}</span></td>
      <td style="display:flex;gap:6px">
        ${s.kycStatus!=='VERIFIED' ? `<button onclick="verifyKyc('${s._id}')" class="action-btn btn-kyc">Vérifier KYC</button>` : ''}
        <button onclick="deleteShop('${s._id}')" class="action-btn btn-del">Suppr.</button>
      </td>
    </tr>`).join('');
  } catch(e) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#ef4444">Erreur</td></tr>'; }
}

async function verifyKyc(shopId) {
  try { await api('/admin/shops/'+shopId+'/kyc', { method:'PUT' }); toast('KYC vérifié ✅'); loadShops(); }
  catch(e) { toast('Erreur', 'err'); }
}

async function deleteShop(shopId) {
  if (!confirm('Supprimer cette boutique ?')) return;
  try { await api('/admin/shops/'+shopId, { method:'DELETE' }); toast('Boutique supprimée'); loadShops(); }
  catch(e) { toast('Erreur', 'err'); }
}

// ── PRODUITS ──
async function loadProducts() {
  const tbody = document.getElementById('productsTable');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#9ca3af">Chargement…</td></tr>';
  try {
    const r = await api('/products?limit=200'); const d = await r.json();
    const prods = d.products || [];
    if (!prods.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#9ca3af">Aucun produit. Cliquez "Seed".</td></tr>'; return; }
    tbody.innerHTML = prods.map(p => {
      const hasDisc = p.discount > 0 && p.discountExpiresAt && new Date(p.discountExpiresAt) > new Date();
      const fp      = hasDisc ? Math.round(p.price * (1 - p.discount/100)) : p.price;
      return `<tr>
        <td><img src="${p.imageUrl||'https://via.placeholder.com/36'}" style="width:36px;height:36px;border-radius:8px;object-fit:cover" onerror="this.src='https://via.placeholder.com/36'" loading="lazy"></td>
        <td style="font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</td>
        <td><span style="background:#f0f9ff;color:#0369a1;padding:2px 8px;border-radius:100px;font-size:10px;font-weight:700">${p.category||'—'}</span></td>
        <td style="font-weight:700">${p.price.toLocaleString('fr-FR')} FCFA${hasDisc?`<br><span style="color:#f97316;font-size:11px">→ ${fp.toLocaleString('fr-FR')} (-${p.discount}%)</span>`:''}</td>
        <td style="font-weight:700;color:${p.stock<=0?'#ef4444':p.stock<=5?'#f59e0b':'#16a34a'}">${p.stock}</td>
        <td>${hasDisc?`<span class="pill" style="background:#fff7ed;color:#c2410c">${p.discount}% jusqu'au ${new Date(p.discountExpiresAt).toLocaleDateString('fr-FR')}</span>`:'—'}</td>
        <td style="display:flex;gap:6px">
          <button onclick="editProduct('${p._id}')" class="action-btn btn-kyc">Éditer</button>
          <button onclick="openDiscountModal('${p._id}')" class="action-btn btn-disc">Remise</button>
          <button onclick="delProduct('${p._id}')" class="action-btn btn-del">✕</button>
        </td>
      </tr>`;
    }).join('');
  } catch(e) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#ef4444">Erreur</td></tr>'; }
}

async function editProduct(id) {
  try {
    const r = await fetch('/api/products/'+id); const p = await r.json();
    document.getElementById('pEditId').value = p._id;
    document.getElementById('pName').value   = p.name;
    document.getElementById('pPrice').value  = p.price;
    document.getElementById('pStock').value  = p.stock;
    document.getElementById('pCat').value    = p.category||'';
    document.getElementById('pUnit').value   = p.unit||'';
    document.getElementById('pImg').value    = p.imageUrl||'';
    document.getElementById('pDesc').value   = p.description||'';
    document.querySelector('.form-card p').textContent = '✏️ Modifier le produit';
    window.scrollTo({ top:0, behavior:'smooth' });
  } catch(e) { toast('Erreur', 'err'); }
}

function resetProductForm() {
  ['pEditId','pName','pPrice','pStock','pCat','pUnit','pImg','pDesc'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
  document.querySelector('.form-card p').textContent = '➕ Nouveau produit';
}

async function submitProduct() {
  const id    = document.getElementById('pEditId').value;
  const name  = document.getElementById('pName').value.trim();
  const price = document.getElementById('pPrice').value;
  if (!name || !price) { toast('Nom et prix requis', 'err'); return; }
  const body = { name, price:Number(price), stock:Number(document.getElementById('pStock').value)||0, category:document.getElementById('pCat').value||'Divers', unit:document.getElementById('pUnit').value||'unité', imageUrl:document.getElementById('pImg').value||'', description:document.getElementById('pDesc').value||'', sellerId:'admin' };
  try {
    const r = await api(id?'/products/'+id:'/products', { method:id?'PUT':'POST', body:JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) { toast(d.error||'Erreur','err'); return; }
    toast(id?'Produit mis à jour ✅':'Produit créé ✅'); resetProductForm(); loadProducts();
  } catch(e) { toast('Erreur réseau','err'); }
}

async function delProduct(id) {
  if (!confirm('Supprimer ce produit ?')) return;
  try { await api('/products/'+id, { method:'DELETE' }); toast('Supprimé'); loadProducts(); }
  catch(e) { toast('Erreur','err'); }
}

async function seedProds() {
  try { const r=await fetch('/api/products/seed'); const d=await r.json(); toast(d.message||'OK'); loadProducts(); }
  catch(e) { toast('Erreur','err'); }
}

// ── RÉDUCTIONS ──
function openDiscountModal(productId) {
  document.getElementById('discProductId').value = productId;
  document.getElementById('discPercent').value = '';
  const minDate = new Date(Date.now() + 60000).toISOString().slice(0,16);
  document.getElementById('discExpiry').min = minDate;
  document.getElementById('discExpiry').value = '';
  document.getElementById('discountModal').style.display = 'flex';
}

function closeDiscountModal() { document.getElementById('discountModal').style.display = 'none'; }

async function submitDiscount() {
  const id      = document.getElementById('discProductId').value;
  const percent = Number(document.getElementById('discPercent').value);
  const expiry  = document.getElementById('discExpiry').value;
  if (!percent || !expiry) { toast('Remplissez tous les champs','err'); return; }
  if (percent < 0 || percent > 90) { toast('Réduction entre 0 et 90%','err'); return; }
  if (new Date(expiry) <= new Date()) { toast('La date doit être dans le futur','err'); return; }
  try {
    const r = await api('/admin/products/'+id+'/discount', { method:'PUT', body:JSON.stringify({ percent, expiresAt:new Date(expiry).toISOString() }) });
    const d = await r.json();
    if (!r.ok) { toast(d.error||'Erreur','err'); return; }
    toast(`Réduction ${percent}% appliquée ✅`); closeDiscountModal(); loadProducts();
  } catch(e) { toast('Erreur réseau','err'); }
}

// ── COMMANDES ──
async function loadOrders(status = ORDERS_STATUS) {
  ORDERS_STATUS = status;
  const tbody = document.getElementById('ordersTable');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#9ca3af">Chargement…</td></tr>';
  try {
    const r = await api('/orders?limit=100'+(status?'&status='+encodeURIComponent(status):'')); const d = await r.json();
    const orders = d.orders || [];
    if (!orders.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#9ca3af">Aucune commande.</td></tr>'; return; }
    const statusColors = { PENDING:'pill-pending', 'VALIDÉ':'pill-valide', 'REFUSÉ':'pill-refuse', LIVRÉ:'pill-valide', NEGOCIATED:'pill-pending' };
    tbody.innerHTML = orders.map(o => {
      const prods = (o.items||[]).map(i=>`${i.name}×${i.qty||1}`).join(', ');
      return `<tr>
        <td style="font-family:monospace;font-size:12px">${o.orderNumber||'—'}</td>
        <td style="font-weight:600">${o.customerName||o.guestPhone||'—'}</td>
        <td style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${prods}">${prods||'—'}</td>
        <td style="font-weight:700;color:#f97316">${fmt(o.finalAmount||o.amount||0)}</td>
        <td style="font-size:12px">${o.provider==='MTN_MOMO_CMR'?'🟡 MTN':'🟠 Orange'}</td>
        <td><span class="pill ${statusColors[o.status]||'pill-offline'}">${o.status}</span></td>
        <td style="font-size:11px;color:#9ca3af">${fmtDate(o.createdAt)}</td>
        <td><a href="/api/orders/${o._id}/invoice" target="_blank" style="color:#f97316;font-size:12px;font-weight:600">📄 PDF</a></td>
      </tr>`;
    }).join('');
  } catch(e) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#ef4444">Erreur</td></tr>'; }
}

function filterOrders(status) {
  document.querySelectorAll('.filter-btn[data-s]').forEach(b => b.classList.toggle('active', b.dataset.s === status));
  loadOrders(status);
}

// ── AUDIT ──
async function loadAudit() {
  const tbody = document.getElementById('auditTable');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#9ca3af">Chargement…</td></tr>';
  try {
    const r = await api('/admin/audit?limit=100'); const d = await r.json();
    const logs = d.logs || [];
    if (!logs.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#9ca3af">Aucun log.</td></tr>'; return; }
    tbody.innerHTML = logs.map(l => `<tr>
      <td style="font-size:11px;color:#9ca3af;white-space:nowrap">${fmtDate(l.date)}</td>
      <td style="font-weight:600;color:#f97316">${l.adminId}</td>
      <td><span style="background:#f0f9ff;color:#0369a1;padding:2px 8px;border-radius:100px;font-size:11px;font-weight:700">${l.action}</span></td>
      <td style="font-size:11px;font-family:monospace">${l.targetId||'—'}</td>
      <td style="font-family:monospace;font-size:11px;color:#6b7280">${l.ip||'—'}</td>
      <td style="font-size:11px;color:#6b7280">${l.details ? JSON.stringify(l.details).slice(0,80) : '—'}</td>
    </tr>`).join('');
  } catch(e) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#ef4444">Erreur</td></tr>'; }
}

// ── IMPERSONATE ──
function openImpersonate(email) {
  IMPERSONATE_EMAIL = email;
  const el = document.getElementById('impersEmail'); if(el) el.textContent = 'Marchand : ' + email;
  document.getElementById('impLogin').value    = '';
  document.getElementById('impPassword').value = '';
  const err = document.getElementById('impErr'); if(err) err.style.display='none';
  document.getElementById('impersonateModal').style.display = 'flex';
}

function closeImpersonateModal() { document.getElementById('impersonateModal').style.display = 'none'; }

async function submitImpersonate() {
  const adminLogin    = document.getElementById('impLogin').value.trim();
  const adminPassword = document.getElementById('impPassword').value;
  const err           = document.getElementById('impErr');
  err.style.display   = 'none';

  if (!adminLogin || !adminPassword) { err.textContent='Login et mot de passe requis'; err.style.display='block'; return; }

  try {
    const r = await fetch('/api/admin/login-as-shop', {
      method:  'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+TOKEN },
      body:    JSON.stringify({ adminLogin, adminPassword, merchantEmail: IMPERSONATE_EMAIL }),
    });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error||'Erreur'; err.style.display='block'; return; }

    // Sauvegarder token admin avant impersonate
    localStorage.setItem('gp_token_admin', TOKEN);
    localStorage.setItem('gp_user_admin',  JSON.stringify(USER));
    // Appliquer token impersonate
    localStorage.setItem('gp_token', d.token);
    localStorage.setItem('gp_user',  JSON.stringify({ name: d.merchantName, role:'merchant', isImpersonated:true }));

    closeImpersonateModal();
    toast('Connecté comme ' + d.merchantName);
    window.location.href = '/merchant.html?impersonated=true';
  } catch(e) { err.textContent='Erreur réseau'; err.style.display='block'; }
}

function exitImpersonate() {
  const adminToken = localStorage.getItem('gp_token_admin');
  const adminUser  = localStorage.getItem('gp_user_admin');
  if (adminToken) {
    localStorage.setItem('gp_token', adminToken);
    localStorage.setItem('gp_user',  adminUser || '{}');
    localStorage.removeItem('gp_token_admin');
    localStorage.removeItem('gp_user_admin');
  }
  window.location.href = '/admin.html';
}

async function doLogout() {
  try { await api('/auth/logout', { method:'POST' }); } catch(e) {}
  localStorage.removeItem('gp_token'); localStorage.removeItem('gp_user');
  window.location.href = '/login.html';
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  // Vérifier si impersonate actif
  const isImp = new URLSearchParams(window.location.search).get('impersonated');
  if (isImp === 'true') {
    const banner = document.getElementById('impersonateBanner');
    const user   = JSON.parse(localStorage.getItem('gp_user')||'{}');
    const nameEl = document.getElementById('impersonateName');
    if (banner) banner.style.display = 'block';
    if (nameEl)  nameEl.textContent  = user.name || 'Marchand';
  }
  switchTab('dashboard');
  setInterval(loadStats, 30000);
});
