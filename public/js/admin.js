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
  }).then(r => {
    if (r.status === 401) { localStorage.removeItem('gp_token'); localStorage.removeItem('gp_user'); window.location.href = '/login.html'; }
    return r;
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
  if (tab === 'payment')   loadPaymentTab();
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
        ${u.role==='merchant' ? `<button onclick="openImpersonate('${u.email}')" class="action-btn btn-enter">Entrer</button> <button onclick="editPayout(\'${u._id}\')" class="action-btn btn-kyc">Versement</button>` : ''}
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
    const rowHtml = p => {
      const hasDisc = p.discount > 0 && p.discountExpiresAt && new Date(p.discountExpiresAt) > new Date();
      const fp      = hasDisc ? Math.round(p.price * (1 - p.discount/100)) : p.price;
      return `<tr>
        <td><img src="${esc(p.imageUrl||PLACEHOLDER)}" style="width:36px;height:36px;border-radius:8px;object-fit:cover" onerror="this.onerror=null;this.src=PLACEHOLDER" loading="lazy"></td>
        <td style="font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</td>
        <td><span style="background:#f0f9ff;color:#0369a1;padding:2px 8px;border-radius:100px;font-size:10px;font-weight:700">${esc(p.category||'—')}</span></td>
        <td style="font-weight:700">${p.price.toLocaleString('fr-FR')} FCFA${hasDisc?`<br><span style="color:#f97316;font-size:11px">→ ${fp.toLocaleString('fr-FR')} (-${p.discount}%)</span>`:''}</td>
        <td style="font-weight:700;color:${p.stock<=0?'#ef4444':p.stock<=5?'#f59e0b':'#16a34a'}">${p.stock}</td>
        <td>${hasDisc?`<span class="pill" style="background:#fff7ed;color:#c2410c">${p.discount}% jusqu'au ${new Date(p.discountExpiresAt).toLocaleDateString('fr-FR')}</span>`:'—'}</td>
        <td style="display:flex;gap:6px">
          <button onclick="editProduct('${p._id}')" class="action-btn btn-kyc">Éditer</button>
          <button onclick="openDiscountModal('${p._id}')" class="action-btn btn-disc">Remise</button>
          <button onclick="delProduct('${p._id}')" class="action-btn btn-del">✕</button>
        </td>
      </tr>`;
    };
    renderGrouped(tbody, prods, rowHtml, 7);
    fillCatList();
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
    setImgPreview(p.imageUrl||'');
    { const tt=document.getElementById('pType'); if(tt){ tt.value=p.type||'physical'; onTypeChange(); } const dg=document.getElementById('pDigital'); if(dg) dg.value=''; }
    document.getElementById('pDesc').value   = p.description||'';
    document.querySelector('.form-card p').textContent = '✏️ Modifier le produit';
    window.scrollTo({ top:0, behavior:'smooth' });
  } catch(e) { toast('Erreur', 'err'); }
}

function resetProductForm() {
  ['pEditId','pName','pPrice','pStock','pCat','pUnit','pImg','pDesc'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
  clearImage();
  { const tt=document.getElementById('pType'); if(tt){ tt.value='physical'; onTypeChange(); } const dg=document.getElementById('pDigital'); if(dg) dg.value=''; }
  document.querySelector('.form-card p').textContent = '➕ Nouveau produit';
}

async function submitProduct() {
  const id    = document.getElementById('pEditId').value;
  const name  = document.getElementById('pName').value.trim();
  const price = document.getElementById('pPrice').value;
  if (!name || !price) { toast('Nom et prix requis', 'err'); return; }
  const body = { name, price:Number(price), stock:Number(document.getElementById('pStock').value)||0, category:document.getElementById('pCat').value||'Divers', unit:document.getElementById('pUnit').value||'unité', imageUrl:document.getElementById('pImg').value||'', description:document.getElementById('pDesc').value||'', sellerId:'admin', type:document.getElementById('pType').value, digitalUrl:(document.getElementById('pDigital').value||'').trim() };
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
        <td><button onclick="downloadFile('/api/orders/${o._id}/invoice','facture-${o.orderNumber||o._id}.pdf')" style="color:#f97316;font-size:12px;font-weight:600;background:none;border:none;cursor:pointer">📄 PDF</button></td>
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
    localStorage.setItem('gp_user',  JSON.stringify({ id: d.merchantId, name: d.merchantName, role:'merchant', isImpersonated:true }));

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

async function downloadFile(url, filename) {
  try {
    const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + TOKEN }, credentials: 'include' });
    if (!r.ok) { const e = await r.json().catch(() => ({})); toast(e.error || 'Téléchargement impossible', 'err'); return; }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch(e) { toast('Erreur réseau', 'err'); }
}

async function createMerchant() {
  const val = id => (document.getElementById(id)?.value || '').trim();
  const body = { name: val('mName'), email: val('mEmail'), phone: val('mPhone'), whatsapp: val('mWhatsapp'), payoutProvider: document.getElementById('mProvider')?.value || '', password: document.getElementById('mPassword')?.value || '', storeName: val('mStore'), days: Number(val('mDays')) || 0 };
  if (!body.name || !body.email || !body.password || !body.storeName) { toast('Nom, boutique, e-mail et mot de passe requis', 'err'); return; }
  try {
    const r = await api('/admin/merchants', { method: 'POST', body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'Erreur', 'err'); return; }
    ['mName','mEmail','mPhone','mPassword','mStore','mDays','mWhatsapp','mProvider'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    toast('Marchand créé ✅ — donnez-lui son e-mail et son mot de passe');
    loadShops();
  } catch(e) { toast('Erreur réseau', 'err'); }
}

// ═══════════ PAIEMENT : numéro de réception, mode TEST/LIVE, versements ═══════════
function paintBadge(el, d) {
  if (!el) return;
  el.style.display = 'inline-block';
  if (d.configError || d.mode === 'invalide') { el.className = 'mode-badge mode-err'; el.textContent = 'CONFIG KPAY INVALIDE'; }
  else if (d.isLive) { el.className = 'mode-badge mode-live'; el.textContent = 'MODE LIVE'; }
  else { el.className = 'mode-badge mode-test'; el.textContent = 'MODE TEST'; }
}
async function loadModeBadge() {
  try { const r = await api('/admin/settings'); if (r.ok) paintBadge(document.getElementById('modeBadge'), await r.json()); } catch(e) {}
}
async function loadPaymentTab() {
  try {
    const r = await api('/admin/settings'); const d = await r.json();
    if (!r.ok) { toast(d.error || 'Erreur', 'err'); return; }
    const set = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
    paintBadge(document.getElementById('payModeBadge'), d); paintBadge(document.getElementById('modeBadge'), d);
    set('payBigPhone', d.adminPhone || 'AUCUN NUMÉRO');
    set('paySource', d.adminPhone ? 'Source : ' + (d.source === 'BDD' ? 'base de données (modifiable ici)' : 'fichier .env (repli) — enregistrez-le ici pour le fixer en base') : 'ADMIN_PHONE manquant : renseignez-le ci-dessous, les paiements sont bloqués sans numéro');
    const ce = document.getElementById('payConfigErr'); if (ce) { ce.style.display = d.configError ? 'block' : 'none'; ce.textContent = d.configError || ''; }
    set('kMode', d.isLive ? 'LIVE' : (d.mode || '—').toUpperCase()); set('kBase', d.baseUrl || '—');
    set('kKey', d.hasApiKey ? 'configurée ✓' : 'MANQUANTE ✗'); set('kRate', Math.round((d.commissionRate || 0) * 100) + ' % (fixée par le serveur)');
    set('payLastChange', d.updatedAt ? 'Dernier changement : ' + fmtDate(d.updatedAt) + (d.updatedBy ? ' par ' + d.updatedBy : '') : '');
    const hist = document.getElementById('payHistory');
    if (hist) { hist.textContent = ''; (d.history || []).forEach(x => { const row = document.createElement('div'); row.textContent = fmtDate(x.date) + ' — ' + (x.old || 'aucun') + ' → ' + x.new + ' (' + x.by + ')'; hist.appendChild(row); }); }
  } catch(e) { toast('Erreur réseau', 'err'); }
  loadPayouts();
}
async function saveAdminPhone() {
  const inp = document.getElementById('newAdminPhone'), msg = document.getElementById('payFormMsg');
  const v = (inp.value || '').replace(/\s+/g, '');
  const say = (t, ok) => { msg.textContent = t; msg.style.color = ok ? '#16a34a' : '#dc2626'; };
  if (!/^237[0-9]{9}$/.test(v)) { say('Numéro invalide, mets 237XXXXXXXXX', false); return; }
  try {
    const r = await api('/admin/settings', { method: 'PUT', body: JSON.stringify({ adminPhone: v }) });
    const d = await r.json();
    if (!r.ok) { say(d.error || 'Erreur', false); return; }
    say(d.message, true); inp.value = ''; toast('Numéro admin enregistré ✅');
    loadPaymentTab();
  } catch(e) { say('Erreur réseau', false); }
}
async function loadKpayBalance() {
  const el = document.getElementById('kBalance'); el.style.color = '#6b7280'; el.textContent = '…';
  try {
    const r = await api('/admin/kpay-balance'); const d = await r.json();
    if (d.known) { el.style.color = '#16a34a'; el.textContent = fmt(d.available) + ' disponibles'; }
    else { el.style.color = '#dc2626'; el.textContent = 'Solde illisible (' + (d.error || 'réponse inattendue') + ') — les versements restent bloqués par sécurité'; }
  } catch(e) { el.textContent = 'Erreur réseau'; }
}
const PAYOUT_LABEL = { BLOCKED: ['🔒 Bloqué (attend la photo)', '#fef9c3', '#854d0e'], READY: ['Prêt', '#dbeafe', '#1e40af'], PROCESSING: ['⏳ En cours', '#dbeafe', '#1e40af'], PAID: ['✅ Versé', '#dcfce7', '#166534'], FAILED: ['❌ Échec', '#fee2e2', '#991b1b'], WAITING_FUNDS: ['💤 Attend le solde KPay', '#ffedd5', '#9a3412'], UNCERTAIN: ['❓ À vérifier chez KPay', '#fee2e2', '#991b1b'], BLOCKED_DISPUTE: ['⚠️ Litige', '#fee2e2', '#991b1b'] };
async function loadPayouts() {
  const tb = document.getElementById('payoutsTable'); if (!tb) return;
  try {
    const r = await api('/admin/payouts'); const d = await r.json(); const rows = d.payouts || [];
    if (!rows.length) { tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#9ca3af">Aucun versement pour l\'instant.</td></tr>'; return; }
    tb.innerHTML = rows.map(o => {
      const pl = PAYOUT_LABEL[o.payoutStatus] || [o.payoutStatus, '#f3f4f6', '#374151'];
      let act = '';
      if (['WAITING_FUNDS', 'FAILED'].includes(o.payoutStatus)) act += `<button class="action-btn btn-kyc" onclick="retryPayout('${esc(o.id)}')">Relancer</button>`;
      if (o.payoutStatus === 'UNCERTAIN') act += `<button class="action-btn btn-kyc" onclick="resolveUncertain('${esc(o.id)}','paid')">Versé ✓</button> <button class="action-btn btn-del" onclick="resolveUncertain('${esc(o.id)}','failed')">Non versé</button>`;
      if (o.deliveryStatus === 'DISPUTE') act += `<button class="action-btn btn-kyc" onclick="resolveDispute('${esc(o.id)}','release')">Payer le vendeur</button> <button class="action-btn btn-del" onclick="resolveDispute('${esc(o.id)}','refund')">Rembourser le client</button>`;
      if (o.photo) act += ` <button class="action-btn btn-enter" onclick="viewDeliveryPhoto('${esc(o.id)}')">📷 Photo</button>`;
      const err = o.payoutLastError ? `<div style="font-size:11px;color:#991b1b;margin-top:3px">${esc(o.payoutLastError)}</div>` : '';
      const dsp = o.disputeReason ? `<div style="font-size:11px;color:#991b1b;margin-top:3px">« ${esc(o.disputeReason)} »</div>` : '';
      return `<tr><td style="font-family:monospace;font-size:12px">${esc(o.orderNumber)}</td><td>${esc(o.vendorName)}</td><td>${o.orderType === 'digital' ? '⚡ digital' : '📦 physique'}</td>
        <td style="font-weight:700">${fmt(o.montant_vendeur)}</td><td>${fmt(o.commission)}</td><td style="font-size:12px">${esc(o.deliveryStatus)}${dsp}</td>
        <td><span class="pill" style="background:${pl[1]};color:${pl[2]}">${esc(pl[0])}</span>${err}</td><td style="white-space:nowrap">${act || '—'}</td></tr>`;
    }).join('');
  } catch(e) { tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#ef4444">Erreur</td></tr>'; }
}
async function retryPayout(id) {
  try { const r = await api('/admin/payouts/' + id + '/retry', { method: 'POST' }); const d = await r.json();
    toast(d.ok ? 'Versement relancé ✅' : 'Non relancé : ' + (d.error || d.reason || 'voir le statut'), d.ok ? 'ok' : 'err'); loadPayouts(); } catch(e) { toast('Erreur réseau', 'err'); }
}
async function resolveUncertain(id, outcome) {
  if (!confirm(outcome === 'paid' ? 'Confirmez-vous avoir VÉRIFIÉ chez KPay que ce versement est bien parti ?' : 'Confirmez-vous que ce versement n\'est PAS parti ? (il pourra être relancé)')) return;
  try { const r = await api('/admin/payouts/' + id + '/resolve-uncertain', { method: 'POST', body: JSON.stringify({ outcome }) }); const d = await r.json();
    toast(r.ok ? 'Enregistré ✅' : (d.error || 'Erreur'), r.ok ? 'ok' : 'err'); loadPayouts(); } catch(e) { toast('Erreur réseau', 'err'); }
}
async function resolveDispute(id, resolution) {
  if (!confirm(resolution === 'release' ? 'Payer le vendeur ? (la photo de livraison existe)' : 'Rembourser le client ? Le vendeur ne sera pas payé (remboursement à faire à la main).')) return;
  try { const r = await api('/admin/orders/' + id + '/dispute-resolve', { method: 'POST', body: JSON.stringify({ resolution }) }); const d = await r.json();
    toast(r.ok ? (d.message || 'Litige tranché') : (d.error || 'Erreur'), r.ok ? 'ok' : 'err'); loadPayouts(); } catch(e) { toast('Erreur réseau', 'err'); }
}
async function viewDeliveryPhoto(orderId) {
  try {
    const r = await fetch('/api/upload/delivery-photo/' + orderId, { headers: { 'Authorization': 'Bearer ' + TOKEN } });
    if (!r.ok) { toast('Photo introuvable', 'err'); return; }
    const url = URL.createObjectURL(await r.blob()); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch(e) { toast('Erreur réseau', 'err'); }
}

async function editPayout(id) {
  const phone = prompt('Numéro Mobile Money où ce marchand reçoit ses ventes (237 + 9 chiffres, sans espace ni +) :');
  if (phone === null) return;
  const v = phone.replace(/\s+/g, '');
  if (!/^237[0-9]{9}$/.test(v)) { toast('Numéro invalide, mets 237XXXXXXXXX', 'err'); return; }
  const op = (prompt('Opérateur : tapez MTN, ORANGE, ou laissez vide pour détection automatique') || '').trim().toUpperCase();
  const provider = op.startsWith('MTN') ? 'MTN_MOMO_CMR' : op.startsWith('OR') ? 'ORANGE_CMR' : '';
  if (!confirm('Les prochains versements de ce marchand iront sur ' + v + ' (' + (provider || 'opérateur détecté') + '). Confirmer ?')) return;
  try {
    const r = await api('/admin/merchants/' + id + '/payout', { method: 'PUT', body: JSON.stringify({ phone: v, payoutProvider: provider }) });
    const d = await r.json();
    toast(r.ok ? 'Numéro de versement enregistré ✅' : (d.error || 'Erreur'), r.ok ? 'ok' : 'err');
  } catch(e) { toast('Erreur réseau', 'err'); }
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
  loadModeBadge();
  switchTab('dashboard');
  setInterval(loadStats, 30000);
});
