'use strict';
// Icône de messagerie fixe en bas à droite : renvoie vers la partie « avis clients ».
(function () {
  if (document.getElementById('avisFab') || /\/avis\.html$/.test(location.pathname)) return;
  var a = document.createElement('a');
  a.id = 'avisFab'; a.className = 'fab-avis'; a.href = '/avis.html';
  a.setAttribute('aria-label', 'Donner mon avis'); a.title = 'Avis clients : donner mon avis';
  a.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.3 9 9 0 0 1-3.6-.8L3 20.5l1.6-4.6A8 8 0 0 1 3.5 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z"/><path d="M8 10.5h8M8 14h5" stroke="#c8a95f"/></svg>';
  document.body.appendChild(a);
})();
