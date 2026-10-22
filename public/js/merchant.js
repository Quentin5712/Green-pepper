'use strict';
const TOKEN = localStorage.getItem('gp_token');
const USER  = JSON.parse(localStorage.getItem('gp_user') || '{}');
if (!TOKEN || (USER.role !== 'merchant' && USER.role !== 'admin')) { window.location.href = '/login.html'; }

let NOTIF_INTERVAL = null;
let ORDER_STATUS   = '';

function api(url, opts = {}) {
  return fetch('/api' + url, { ...opts, headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+TOKEN, ...(opts.headers||{}) }, credentials:'include' });
}
function toast(msg, type='ok') {
  const w=document.getElementById('toastWrap');if(!w)return;
  const d=document.createElement('div');d.className='gp-toast'+(type==='err'?' err':type==='ok'?' ok':'');
  d.textContent=msg;w.appendChild(d);
  setTimeout(()=>{d.style.opacity='0';d.style.transition='opacity .3s';setTimeout(()=>d.remove(),300);},3500);
}
function fmt(n){return Number(n).toLocaleString('fr-FR')+' FCFA';}
function fmtDate(d){return d?new Date(d).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';}

// ── Impersonate ──
function checkImpersonate() {
  const isImp = new URLSearchParams(window.location.search).get('impersonated') === 'true' || USER.isImpersonated;
  if (isImp) {
    const banner = document.getElementById('impersonateBanner');
    const nameEl = document.getElementById('impersonateName');
    if (banner) banner.style.display = 'block';
    if (nameEl)  nameEl.textContent  = USER.name || 'Marchand';
  }
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

// ── Stats ──
async function loadStats() {
  try {
    const r = await api('/merchant/stats'); if (!r.ok) return;
    const d = await r.json();
    const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
    set('mstToday',   d.caToday   ? Number(d.caToday).toLocaleString('fr-FR')   : '0');
    set('mstMonth',   d.caMonth   ? Number(d.caMonth).toLocaleString('fr-FR')   : '0');
    set('mstPending', d.ordersPending ?? '0');
    set('mstLowStock',d.lowStock      ?? '0');
    set('mstOnline',  d.onlineClients ?? '0');
  } catch(e) {}
}

// ── Tabs ──
function switchTab(tab) {
  ['products','orders','stock','notifications'].forEach(t => {
    const panel = document.getElementById('panel-'+t);
    const btn   = document.getElementById('tab-'+t);
    if (panel) panel.style.display = t===tab ? 'block' : 'none';
    if (btn)   btn.classList.toggle('active', t===tab);
  });
  clearInterval(NOTIF_INTERVAL);
  if (tab==='products')      loadProducts();
  if (tab==='orders')        loadOrders();
  if (tab==='stock')         loadStock();
  if (tab==='notifications') { loadNotifications(); NOTIF_INTERVAL=setInterval(loadNotifications,10000); }
}

// ── Produits ──
async function loadProducts() {
  const tbody = document.getElementById('productsBody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#9ca3af">Chargement…</td></tr>';
  try {
    const r = await api('/products?limit=200'); const d = await r.json();
    const prods = d.products || [];
    if (!prods.length) { tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:40px;color:#9ca3af">Aucun produit. Ajoutez-en ci-dessus.</td></tr>'; return; }
    tbody.innerHTML = prods.map(p=>`<tr>
      <td><img src="${p.imageUrl||'https://via.placeholder.com/36'}" style="width:36px;height:36px;border-radius:8px;object-fit:cover" onerror="this.src='https://via.placeholder.com/36'" loading="lazy"></td>
      <td style="font-weight:600">${p.name}</td>
      <td><span style="background:#f0f9ff;color:#0369a1;padding:2px 8px;border-radius:100px;font-size:10px;font-weight:700">${p.category||'—'}</span></td>
      <td style="font-weight:700">${Number(p.price).toLocaleString('fr-FR')} FCFA</td>
      <td style="font-weight:700;color:${p.stock<=0?'#ef4444':p.stock<=5?'#f59e0b':'#16a34a'}">${p.stock}</td>
      <td style="display:flex;gap:6px">
        <button onclick="editProduct('${p._id}')" class="action-btn btn-edit">Éditer</button>
        <button onclick="delProduct('${p._id}')" class="action-btn btn-del">✕</button>
      </td>
    </tr>`).join('');
  } catch(e) { tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:40px;color:#ef4444">Erreur</td></tr>'; }
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
    document.getElementById('formTitle').textContent = '✏️ Modifier le produit';
    window.scrollTo({ top:0, behavior:'smooth' });
  } catch(e) { toast('Erreur','err'); }
}

function resetForm() {
  ['pEditId','pName','pPrice','pStock','pCat','pUnit','pImg','pDesc'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  document.getElementById('formTitle').textContent = '➕ Nouveau produit';
}

async function submitProduct() {
  const id    = document.getElementById('pEditId').value;
  const name  = document.getElementById('pName').value.trim();
  const price = document.getElementById('pPrice').value;
  if (!name||!price) { toast('Nom et prix requis','err'); return; }
  const body = { name, price:Number(price), stock:Number(document.getElementById('pStock').value)||0, category:document.getElementById('pCat').value||'Divers', unit:document.getElementById('pUnit').value||'unité', imageUrl:document.getElementById('pImg').value||'', description:document.getElementById('pDesc').value||'', sellerId:USER.id||'merchant' };
  try {
    const r = await api(id?'/products/'+id:'/products', { method:id?'PUT':'POST', body:JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) { toast(d.error||'Erreur','err'); return; }
    toast(id?'Produit mis à jour ✅':'Produit créé ✅'); resetForm(); loadProducts(); loadStats();
  } catch(e) { toast('Erreur réseau','err'); }
}

async function delProduct(id) {
  if (!confirm('Supprimer ce produit ?')) return;
  try { await api('/products/'+id,{method:'DELETE'}); toast('Supprimé'); loadProducts(); }
  catch(e) { toast('Erreur','err'); }
}

// ── Commandes ──
async function loadOrders(status=ORDER_STATUS) {
  ORDER_STATUS = status;
  const tbody = document.getElementById('ordersBody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#9ca3af">Chargement…</td></tr>';
  try {
    const r = await api('/orders?limit=100'+(status?'&status='+encodeURIComponent(status):'')); const d = await r.json();
    const orders = d.orders||[];
    if (!orders.length) { tbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:40px;color:#9ca3af">Aucune commande.</td></tr>'; return; }
    const pillMap = { PENDING:'background:#fef9c3;color:#854d0e', 'VALIDÉ':'background:#dcfce7;color:#166534', 'REFUSÉ':'background:#fee2e2;color:#991b1b', LIVRÉ:'background:#f0fdf4;color:#166534', NEGOCIATED:'background:#fef9c3;color:#854d0e' };
    tbody.innerHTML = orders.map(o=>{
      const prods=(o.items||[]).map(i=>`${i.name}×${i.qty||1}`).join(', ');
      const pill=pillMap[o.status]||'background:#f3f4f6;color:#374151';
      return `<tr>
        <td style="font-family:monospace;font-size:12px">${o.orderNumber||'—'}</td>
        <td style="font-weight:600">${o.customerName||o.guestPhone||'—'}</td>
        <td style="font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${prods}">${prods||'—'}</td>
        <td style="font-weight:700;color:#f97316">${fmt(o.finalAmount||o.amount||0)}</td>
        <td><span style="${pill};padding:3px 10px;border-radius:100px;font-size:11px;font-weight:700">${o.status}</span></td>
        <td style="font-size:11px;color:#9ca3af">${fmtDate(o.createdAt)}</td>
        <td>
          ${o.status==='VALIDÉ'?`<button onclick="markLivre('${o._id}')" style="padding:5px 11px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;border:none;background:#f0fdf4;color:#16a34a;border:1px solid #86efac">📦 Livré</button>`:''}
          <a href="/api/orders/${o._id}/invoice" target="_blank" style="margin-left:4px;color:#f97316;font-size:11px;font-weight:600">📄</a>
        </td>
      </tr>`;
    }).join('');
  } catch(e) { tbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:40px;color:#ef4444">Erreur</td></tr>'; }
}

function filterOrders(status) { loadOrders(status); }

async function markLivre(orderId) {
  try {
    const r = await api('/orders/'+orderId+'/status',{method:'PUT',body:JSON.stringify({status:'LIVRÉ'})});
    const d = await r.json();
    if (!r.ok) { toast(d.error||'Erreur','err'); return; }
    toast('Commande marquée LIVRÉE ✅'); loadOrders();
  } catch(e) { toast('Erreur','err'); }
}

// ── Stocks ──
async function loadStock() {
  const tbody = document.getElementById('stockBody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#9ca3af">Chargement…</td></tr>';
  try {
    const r = await api('/products?limit=200'); const d = await r.json();
    const prods = d.products||[];
    if (!prods.length) { tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:40px;color:#9ca3af">Aucun produit.</td></tr>'; return; }
    tbody.innerHTML = prods.map(p=>{
      const avail = Math.max(0,(p.stock||0)-(p.reserved||0));
      const status = p.stock<=0 ? 'pill-err' : p.stock<=5 ? 'pill-warn' : 'pill-ok';
      const label  = p.stock<=0 ? 'Épuisé' : p.stock<=5 ? 'Faible' : 'OK';
      return `<tr>
        <td style="font-weight:600">${p.name}</td>
        <td style="font-weight:700;color:${p.stock<=0?'#ef4444':p.stock<=5?'#f59e0b':'#16a34a'}">${p.stock||0}</td>
        <td style="color:#9ca3af">${p.reserved||0}</td>
        <td style="font-weight:700;color:#374151">${avail}</td>
        <td><span class="pill ${status}">${label}</span></td>
        <td style="display:flex;gap:6px;align-items:center">
          <input type="number" id="addstock-${p._id}" min="1" max="9999" value="10" style="width:60px;padding:5px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px">
          <button onclick="addStock('${p._id}')" style="padding:5px 12px;background:#f97316;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">+</button>
        </td>
      </tr>`;
    }).join('');
  } catch(e) { tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:40px;color:#ef4444">Erreur</td></tr>'; }
}

async function addStock(productId) {
  const qty = Number(document.getElementById('addstock-'+productId)?.value)||0;
  if (qty<1) { toast('Quantité invalide','err'); return; }
  try {
    const r = await api('/products/'+productId+'/stock/add',{method:'POST',body:JSON.stringify({quantity:qty})});
    const d = await r.json();
    if (!r.ok) { toast(d.error||'Erreur','err'); return; }
    toast(`+${qty} unités ajoutées ✅`); loadStock(); loadStats();
  } catch(e) { toast('Erreur','err'); }
}

// ── Notifications ──
async function loadNotifications() {
  const list = document.getElementById('notifList');
  try {
    const r = await api('/notifications'); const d = await r.json();
    const notifs = d.notifications||[];
    const cnt    = document.getElementById('notifCount');
    if (cnt) cnt.style.display = d.unread > 0 ? 'inline-block' : 'none';
    if (!notifs.length) { list.innerHTML='<div style="padding:40px;text-align:center;color:#9ca3af">Aucune notification.</div>'; return; }
    list.innerHTML = notifs.map(n=>`
      <div class="notif-item${n.isRead?'':' unread'}">
        <span style="font-size:20px">${n.type==='ORDER'?'🛒':n.type==='PAYMENT'?'💰':n.type==='STOCK'?'⚠️':'🔔'}</span>
        <div style="flex:1">
          <p style="font-size:13px;font-weight:${n.isRead?'400':'600'}">${n.message}</p>
          <p style="font-size:11px;color:#9ca3af;margin-top:2px">${fmtDate(n.createdAt)}</p>
        </div>
        ${!n.isRead?'<span style="width:8px;height:8px;background:#ef4444;border-radius:50%;flex-shrink:0;margin-top:4px"></span>':''}
      </div>`).join('');
  } catch(e) {}
}

async function markAllRead() {
  try {
    await api('/notifications/read',{method:'PUT'});
    const cnt=document.getElementById('notifCount'); if(cnt) cnt.style.display='none';
    toast('Notifications lues'); loadNotifications();
  } catch(e) { toast('Erreur','err'); }
}

async function doLogout() {
  try { await api('/auth/logout',{method:'POST'}); } catch(e) {}
  localStorage.removeItem('gp_token'); localStorage.removeItem('gp_user');
  window.location.href='/login.html';
}

document.addEventListener('DOMContentLoaded', () => {
  checkImpersonate();
  loadStats();
  switchTab('products');
  setInterval(loadStats, 30000);
  // Poll notifications toutes les 30s en arrière-plan
  setInterval(async()=>{
    try {
      const r=await api('/notifications'); const d=await r.json();
      const cnt=document.getElementById('notifCount');
      if(cnt) cnt.style.display=d.unread>0?'inline-block':'none';
    } catch(e){}
  }, 30000);
});
