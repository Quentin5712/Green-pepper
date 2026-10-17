'use strict';

let CUR_TAB    = 'orders';
let CUR_STATUS = '';

function $(id) { return document.getElementById(id); }

function toast(msg, type = 'ok') {
  const w = $('toastWrap'); if (!w) return;
  const d = document.createElement('div');
  d.className = `gp-toast ${type}`;
  d.textContent = msg;
  w.appendChild(d);
  setTimeout(() => { d.style.opacity='0'; d.style.transition='opacity .3s'; setTimeout(()=>d.remove(),300); }, 3000);
}

function fmt(n) { return Number(n).toLocaleString('fr-FR') + ' FCFA'; }

// ── TABS ──
function loadTab(tab) {
  CUR_TAB = tab;
  ['orders','products'].forEach(t => {
    $(`tab-${t}`)?.classList.toggle('active', t === tab);
    $(`panel-${t}`).style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'orders')   loadOrders();
  if (tab === 'products') loadProducts();
}

// ── STATS ──
async function loadStats() {
  try {
    const [pr, or] = await Promise.all([
      fetch('/api/products').then(r=>r.json()),
      fetch('/api/orders').then(r=>r.json()),
    ]);
    const { stats = {}, total = 0 } = or;
    const productCount = pr.total || 0;

    if ($('stProducts')) $('stProducts').textContent = productCount;
    if ($('stTotal'))    $('stTotal').textContent    = total;
    if ($('stPending'))  $('stPending').textContent  = stats.pending || 0;
    if ($('stValide'))   $('stValide').textContent   = stats.valide  || 0;
    if ($('stRefuse'))   $('stRefuse').textContent   = stats.refuse  || 0;

    // Calculer le revenu des commandes VALIDÉES
    const valides = (or.orders || []).filter(o => o.status === 'VALIDÉ');
    const rev = valides.reduce((a, o) => a + (o.total || 0), 0);
    if ($('stRevenue')) $('stRevenue').textContent = rev > 9999
      ? Math.round(rev/1000) + 'k'
      : rev.toLocaleString('fr-FR');
  } catch(e) { console.error('loadStats:', e); }
}

// ── COMMANDES ──
async function loadOrders(status = CUR_STATUS) {
  CUR_STATUS = status;
  const tbody = $('ordersBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#9ca3af">Chargement…</td></tr>';

  try {
    let url = '/api/orders?limit=100';
    if (status) url += '&status=' + encodeURIComponent(status);
    const data = await fetch(url).then(r => r.json());
    const orders = data.orders || [];

    if (!orders.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#9ca3af">Aucune commande.</td></tr>';
      return;
    }

    tbody.innerHTML = orders.map(o => {
      const prods = (o.products || []).map(p => `${p.name}×${p.quantity||1}`).join(', ');
      const date  = new Date(o.createdAt).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const op    = o.provider === 'MTN_MOMO_CMR' ? '🟡 MTN' : '🟠 Orange';
      return `
        <tr>
          <td style="font-family:monospace;font-size:11px;color:#6b7280">${(o.externalId||'').slice(0,16)}…</td>
          <td style="font-weight:600">${o.customerName || '—'}</td>
          <td>${o.customerPhone || '—'}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${prods}">${prods || '—'}</td>
          <td style="font-weight:700;color:#f97316">${fmt(o.total)}</td>
          <td>${op}</td>
          <td><span class="status-pill status-${o.status}">${o.status}</span></td>
          <td style="font-size:11px;color:#9ca3af">${date}</td>
        </tr>`;
    }).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:#ef4444">Erreur: ${e.message}</td></tr>`;
  }
}

function filterOrders(status) {
  document.querySelectorAll('.adm-filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.s === status);
  });
  loadOrders(status);
}

// ── PRODUITS ──
async function loadProducts() {
  const tbody = $('productsBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#9ca3af">Chargement…</td></tr>';

  try {
    const data = await fetch('/api/products?limit=200').then(r => r.json());
    const products = data.products || [];

    if (!products.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#9ca3af">Aucun produit. Cliquez "Seed 6 produits".</td></tr>';
      return;
    }

    tbody.innerHTML = products.map(p => `
      <tr>
        <td><img src="${p.image || 'https://via.placeholder.com/40'}" style="width:40px;height:40px;border-radius:8px;object-fit:cover" onerror="this.src='https://via.placeholder.com/40'" loading="lazy"></td>
        <td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</td>
        <td><span style="background:#f0fdf4;color:#16a34a;padding:2px 8px;border-radius:100px;font-size:11px;font-weight:600">${p.category||'—'}</span></td>
        <td style="font-weight:700">${Number(p.price).toLocaleString('fr-FR')} FCFA</td>
        <td style="font-weight:700;color:${p.stock<=0?'#ef4444':p.stock<=5?'#f59e0b':'#16a34a'}">${p.stock}</td>
        <td style="font-size:12px;color:#6b7280">${p.unit||'—'}</td>
        <td>${p.isActive ? '<span style="color:#16a34a">✓</span>' : '<span style="color:#ef4444">✗</span>'}</td>
        <td style="display:flex;gap:6px">
          <button onclick="editProduct('${p._id}')" class="adm-btn adm-btn-edit">Éditer</button>
          <button onclick="deleteProduct('${p._id}')" class="adm-btn adm-btn-del">Suppr.</button>
        </td>
      </tr>
    `).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:#ef4444">Erreur: ${e.message}</td></tr>`;
  }
}

// ── FORMULAIRE PRODUIT ──
function resetForm() {
  $('editId').value = '';
  $('formTitle').textContent = '➕ Nouveau produit';
  ['fName','fPrice','fStock','fCategory','fUnit','fImage','fDesc'].forEach(id => {
    if ($(id)) $(id).value = '';
  });
}

async function editProduct(id) {
  try {
    const p = await fetch(`/api/products/${id}`).then(r => r.json());
    $('editId').value   = p._id;
    $('fName').value    = p.name        || '';
    $('fPrice').value   = p.price       || '';
    $('fStock').value   = p.stock       || '';
    $('fCategory').value = p.category   || '';
    $('fUnit').value    = p.unit        || '';
    $('fImage').value   = p.image       || '';
    $('fDesc').value    = p.description || '';
    $('formTitle').textContent = '✏️ Modifier le produit';
    $('fName')?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch(e) { toast('Erreur: ' + e.message, 'err'); }
}

async function submitProduct() {
  const id    = $('editId').value;
  const name  = $('fName')?.value?.trim();
  const price = $('fPrice')?.value;
  const stock = $('fStock')?.value;

  if (!name)  { toast('Le nom est requis', 'err'); return; }
  if (!price) { toast('Le prix est requis', 'err'); return; }

  const body = {
    name,
    price:       Number(price),
    stock:       Number(stock) || 0,
    category:    $('fCategory')?.value?.trim() || 'Divers',
    unit:        $('fUnit')?.value?.trim()     || 'unité',
    image:       $('fImage')?.value?.trim()    || '',
    description: $('fDesc')?.value?.trim()     || '',
    sellerId:    'admin',
  };

  try {
    const method = id ? 'PUT' : 'POST';
    const url    = id ? `/api/products/${id}` : '/api/products';
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erreur');
    toast(id ? 'Produit mis à jour ✅' : 'Produit créé ✅');
    resetForm();
    loadProducts();
    loadStats();
  } catch(e) { toast('Erreur: ' + e.message, 'err'); }
}

async function deleteProduct(id) {
  if (!confirm('Supprimer ce produit ?')) return;
  try {
    const r = await fetch(`/api/products/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Erreur');
    toast('Produit supprimé');
    loadProducts();
    loadStats();
  } catch(e) { toast('Erreur: ' + e.message, 'err'); }
}

async function seedProducts() {
  try {
    const r = await fetch('/api/products/seed');
    const d = await r.json();
    toast(d.message || '6 produits insérés ✅');
    loadProducts();
    loadStats();
  } catch(e) { toast('Erreur: ' + e.message, 'err'); }
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadTab('orders');
  // Auto-refresh des stats toutes les 30s
  setInterval(loadStats, 30000);
});
