'use strict';
// Neutralise le HTML dans tout texte saisi par un utilisateur : plus de < > ni de guillemets,
// donc impossible d'injecter une balise ou de sortir d'un attribut HTML.
function clean(s, max = 200) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/["`]/g, '”')
    .replace(/'/g, '’')
    .trim()
    .slice(0, max);
}
const EMAIL_RE = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/;
const PHONE_RE = /^[0-9+\s.\-]{8,15}$/;
function safeUrl(u) {
  const s = String(u || '').trim();
  return /^(https?:\/\/|\/uploads\/)[^\s<>"'`]*$/.test(s) ? s.slice(0, 500) : '';
}
module.exports = { clean, EMAIL_RE, PHONE_RE, safeUrl };
