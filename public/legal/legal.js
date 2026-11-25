'use strict';
// Remplit les champs [data-site] à partir de /js/site-config.js. Champ vide = zone « à renseigner » visible.
(function () {
  var S = window.SITE || {};
  document.querySelectorAll('[data-site]').forEach(function (el) {
    var k = el.getAttribute('data-site'), v = S[k];
    if (!v) { el.className = 'fill-inline'; el.textContent = '[à renseigner]'; return; }
    if (k === 'supportEmail') { var a = document.createElement('a'); a.href = 'mailto:' + v; a.textContent = v; el.textContent = ''; el.appendChild(a); }
    else if (k === 'supportWhatsapp' && /^[1-9][0-9]{7,14}$/.test(v)) { var w = document.createElement('a'); w.href = 'https://wa.me/' + v; w.target = '_blank'; w.rel = 'noopener noreferrer'; w.textContent = '+' + v; el.textContent = ''; el.appendChild(w); }
    else el.textContent = v;
  });
  var y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
})();
