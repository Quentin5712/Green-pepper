'use strict';
// ═══════════════════════════════════════════════════════════════════
// KPay — collecte (encaissement), versement (payout), solde, signature.
// RÈGLES : clé = process.env.KPAY_API_KEY · paiement vérifié par kpayId (jamais externalId)
//          téléphone = 237 + 9 chiffres · mode TEST/LIVE détecté, jamais écrit en dur
// ═══════════════════════════════════════════════════════════════════
const axios  = require('axios');
const crypto = require('crypto');
const logger = require('./logger');

const DEFAULT_BASE = 'https://admin.kpay.site';
const TIMEOUT      = 15000;

class KPayError extends Error {
  constructor(message, code, status, data) {
    super(message); this.name = 'KPayError';
    this.code = code; this.status = status; this.data = data;
    this.ambiguous = code === 'NETWORK' || code === 'SERVER';   // on ne sait pas si KPay a traité la demande
  }
}

// ── Téléphone : 237 + 9 chiffres, sans +, sans espace ──
function formatPhone(phone) {
  let p = String(phone || '').replace(/[\s\-\+\.\(\)]/g, '');
  if (p.startsWith('00237')) p = p.slice(2);
  if (p.startsWith('237') && p.length === 12) return p;
  return '237' + p.slice(-9);
}
const ADMIN_PHONE_RE = /^237[0-9]{9}$/;
// Saisie du numéro admin : on ignore les espaces, mais « + » ou format différent = refusé
function normalizeAdminPhone(input) {
  const s = String(input || '').replace(/\s+/g, '');
  return ADMIN_PHONE_RE.test(s) ? s : null;
}

// Opérateur d'un numéro camerounais (préfixes usuels ; null si doute → l'admin renseigne l'opérateur)
function detectProviderFromPhone(phone) {
  const p = formatPhone(phone);
  if (/^2376(5[0-4]|7\d|8\d)/.test(p)) return 'MTN_MOMO_CMR';
  if (/^2376(5[5-9]|9\d)/.test(p))     return 'ORANGE_CMR';
  return null;
}

// ── Mode TEST / LIVE ──
function detectMode(apiKey) {
  const forced = String(process.env.KPAY_MODE || 'auto').toLowerCase();
  const k = String(apiKey || '').toLowerCase();
  const keyMode = /^(kpay_live_|live_|sk_live|pk_live)/.test(k) ? 'live'
                : /^(kpay_test_|test_|sk_test|pk_test)/.test(k) ? 'test' : null;
  if (forced === 'live' || forced === 'test') {
    if (keyMode && keyMode !== forced) {
      throw new KPayError(`KPAY_MODE=${forced} mais KPAY_API_KEY est une clé ${keyMode.toUpperCase()} : incohérence, paiements bloqués`, 'CONFIG');
    }
    return { mode: forced, source: 'KPAY_MODE' };
  }
  if (keyMode) return { mode: keyMode, source: 'préfixe de la clé' };
  return { mode: process.env.NODE_ENV === 'production' ? 'live' : 'test', source: 'NODE_ENV' };
}

// ── Numéro admin : BDD d'abord, puis .env (repli) ──
let _mn = { at: 0, phone: '', source: 'AUCUN' };
async function resolveMerchantNumber(force = false) {
  if (!force && Date.now() - _mn.at < 30000) return _mn;
  const candidates = [];
  try {
    const s = await require('../models/Settings').getMain();
    if (s) { candidates.push(['BDD', s.adminPhone]); candidates.push(['BDD', s.kpayMerchantNumber]); }
  } catch (e) { logger.warn(`KPay: lecture des Settings impossible (${e.message}) — repli sur le .env`); }
  candidates.push(['ENV', process.env.KPAY_MERCHANT_NUMBER]);
  candidates.push(['ENV', process.env.ADMIN_PHONE]);
  let phone = '', source = 'AUCUN';
  for (const [src, val] of candidates) {
    const n = normalizeAdminPhone(val);
    if (n) { phone = n; source = src; break; }
  }
  _mn = { at: Date.now(), phone, source };
  return _mn;
}
function invalidateConfigCache() { _mn = { at: 0, phone: '', source: 'AUCUN' }; }

// ── Configuration unique utilisée PARTOUT ──
async function getKpayConfig(force = false) {
  const apiKey = process.env.KPAY_API_KEY || '';
  const { mode, source: modeSource } = detectMode(apiKey);
  const isLive  = mode === 'live';
  const baseUrl = String(isLive ? (process.env.KPAY_BASE_URL || DEFAULT_BASE) : (process.env.KPAY_TEST_BASE_URL || DEFAULT_BASE)).replace(/\/+$/, '');
  const mn = await resolveMerchantNumber(force);
  return { mode, isLive, baseUrl, apiKey, modeSource, merchantNumber: mn.phone, merchantSource: mn.source };
}

// ── Utilitaires ──
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const headers = cfg => ({ 'x-api-key': cfg.apiKey, 'Content-Type': 'application/json' });

function normalizeStatus(raw) {
  const st = String(raw || '').toUpperCase();
  if (['COMPLETED', 'SUCCESS', 'SUCCESSFUL', 'PAID', 'VALIDATED'].includes(st)) return 'SUCCESS';
  if (['FAILED', 'CANCELLED', 'CANCELED', 'EXPIRED', 'REJECTED', 'REFUSED', 'DECLINED'].includes(st)) return 'FAILED';
  return 'PENDING';
}
function normalizePayment(d, raw) {
  return {
    id: d.id || d.paymentId || d.payoutId || null,
    reference: d.reference || '',
    status: normalizeStatus(d.status),
    rawStatus: d.status || '',
    feeAmount: num(d.feeAmount ?? d.fee_amount),
    netAmount: num(d.netAmount ?? d.net_amount),
    isTest: d.isTest,
    raw,
  };
}
function wrapError(e) {
  const status = e.response?.status, data = e.response?.data;
  const text = JSON.stringify(data || '') + ' ' + (e.message || '');
  let code = 'API';
  if (!e.response) code = 'NETWORK';
  else if (status >= 500) code = 'SERVER';
  else if (/insufficient|solde insuffisant|not enough/i.test(text)) code = 'INSUFFICIENT_BALANCE';
  else if (status === 409) code = 'CONFLICT';
  else if (status === 401 || status === 403) code = 'AUTH';
  else if (status === 400 || status === 422) code = 'VALIDATION';
  return new KPayError(data?.message || data?.error || e.message, code, status, data);
}
function logFail(label, cfg, e) {
  const status = e.response?.status, data = JSON.stringify(e.response?.data || null);
  logger.error(`${label}: status=${status} data=${data} message=${e.message} mode=${cfg.mode}`);
}

// ── Encaisser (COLLECT) : le client reçoit la demande sur son téléphone ──
async function initPayment({ amount, provider, phoneNumber, externalId, description, orderNumber }) {
  const cfg = await getKpayConfig();
  if (!cfg.apiKey) throw new KPayError('KPAY_API_KEY manquant', 'NO_KEY');
  const body = {
    amount: Math.round(Number(amount)),
    provider,
    phoneNumber: formatPhone(phoneNumber),
    externalId,
    description: description || 'Paiement marketplace',
  };
  // Bénéficiaire = numéro admin (lu en BDD). Envoyé en « metadata » ; si KPay la refuse on réessaie sans.
  const withMeta = { ...body, metadata: { merchantNumber: cfg.merchantNumber || undefined, orderNumber } };
  const url = `${cfg.baseUrl}/api/v1/payments/init`;
  logger.info(`KPay init: mode=${cfg.mode} ${provider} ${body.phoneNumber} ${body.amount} XAF ${externalId} beneficiaire=${cfg.merchantNumber || 'AUCUN'}`);
  const post = payload => axios.post(url, payload, { headers: headers(cfg), timeout: TIMEOUT });
  let r;
  try {
    try { r = await post(withMeta); }
    catch (e) {
      const st = e.response?.status;
      if (st !== 400 && st !== 422) throw e;
      logger.warn(`KPay init: metadata refusée (status=${st}) — nouvel essai sans metadata mode=${cfg.mode}`);
      r = await post(body);
    }
  } catch (e) { logFail('KPay init failed', cfg, e); throw wrapError(e); }
  const out = normalizePayment(r.data?.data || r.data || {}, r.data);
  if (!out.id) logger.warn(`KPay init: réponse sans id (impossible de vérifier ensuite par kpayId) mode=${cfg.mode}`);
  logger.info(`KPay init OK: id=${out.id} status=${out.rawStatus} fee=${out.feeAmount} net=${out.netAmount} mode=${cfg.mode}`);
  return out;
}

// ── Vérifier un paiement : TOUJOURS avec kpayId ──
async function getStatus(kpayId) {
  const cfg = await getKpayConfig();
  if (!cfg.apiKey) throw new KPayError('KPAY_API_KEY manquant', 'NO_KEY');
  if (!kpayId) throw new KPayError('kpayId manquant', 'NO_ID');
  const path = (process.env.KPAY_STATUS_PATH || '/api/v1/payments/{id}').replace('{id}', encodeURIComponent(kpayId));
  try {
    const r = await axios.get(cfg.baseUrl + path, { headers: { 'x-api-key': cfg.apiKey }, timeout: TIMEOUT });
    return normalizePayment(r.data?.data || r.data || {}, r.data);
  } catch (e) { logFail('KPay getStatus failed', cfg, e); throw wrapError(e); }
}

// ── Solde KPay disponible (XAF) ──
function parseAvailable(body, currency) {
  const pick = w => { for (const k of ['availableBalance', 'available_balance', 'available', 'balance']) { const v = num(w?.[k]); if (v !== null) return v; } return null; };
  const list = [body, body?.data, body?.wallets, body?.balances, body?.data?.wallets, body?.data?.balances].find(Array.isArray);
  if (list) { const w = list.find(x => String(x?.currency || '').toUpperCase() === currency); return w ? pick(w) : null; }
  const o = body?.data && typeof body.data === 'object' ? body.data : body;
  if (o && typeof o === 'object') {
    if (o[currency] !== undefined) return typeof o[currency] === 'object' ? pick(o[currency]) : num(o[currency]);
    if (String(o.currency || '').toUpperCase() === currency) return pick(o);
  }
  return null;
}
async function getBalance(currency = 'XAF') {
  const cfg = await getKpayConfig();
  if (!cfg.apiKey) return { known: false, available: null, currency, error: 'NO_KEY' };
  try {
    const r = await axios.get(cfg.baseUrl + (process.env.KPAY_BALANCE_PATH || '/api/v1/balance'), { headers: { 'x-api-key': cfg.apiKey }, timeout: TIMEOUT });
    const available = parseAvailable(r.data, currency);
    if (available === null) {
      logger.warn(`KPay balance: format de réponse non reconnu mode=${cfg.mode} body=${JSON.stringify(r.data).slice(0, 300)}`);
      return { known: false, available: null, currency, error: 'FORMAT' };
    }
    return { known: true, available, currency };
  } catch (e) { logFail('KPay balance failed', cfg, e); return { known: false, available: null, currency, error: e.response?.status || e.message }; }
}

// ── Verser au vendeur (PAYOUT) — jamais sans solde suffisant ──
async function payoutToVendor({ amount, provider, phoneNumber, externalId, description }) {
  const cfg = await getKpayConfig();
  if (!cfg.apiKey) throw new KPayError('KPAY_API_KEY manquant', 'NO_KEY');
  const amt = Math.round(Number(amount));
  if (!(amt > 0)) throw new KPayError('Montant invalide', 'VALIDATION');
  if (!['MTN_MOMO_CMR', 'ORANGE_CMR'].includes(provider)) throw new KPayError('Opérateur invalide', 'VALIDATION');
  const phone = formatPhone(phoneNumber);
  if (!ADMIN_PHONE_RE.test(phone)) throw new KPayError('Numéro du vendeur invalide', 'VALIDATION');
  if (!/^PAYOUT-[A-Za-z0-9]+-\d+$/.test(String(externalId))) throw new KPayError('externalId de versement invalide', 'VALIDATION');

  if (process.env.KPAY_BALANCE_CHECK !== 'off') {
    const bal = await getBalance('XAF');
    if (!bal.known) {
      logger.warn(`PAYOUT bloqué : solde KPay indisponible (impossible de vérifier) externalId=${externalId} mode=${cfg.mode}`);
      throw new KPayError('Solde KPay indisponible', 'BALANCE_UNKNOWN');
    }
    if (bal.available < amt) {
      logger.warn(`PAYOUT bloqué : solde insuffisant (disponible=${bal.available} XAF, requis=${amt} XAF) externalId=${externalId} mode=${cfg.mode}`);
      throw new KPayError(`Solde KPay insuffisant (${bal.available} < ${amt})`, 'INSUFFICIENT_BALANCE');
    }
  }

  const body = { amount: amt, provider, phoneNumber: phone, externalId, description: description || 'Versement vendeur' };
  const withMeta = { ...body, metadata: { senderNumber: cfg.merchantNumber || undefined } };
  const url = cfg.baseUrl + (process.env.KPAY_PAYOUT_PATH || '/api/v1/payouts/init');
  logger.info(`KPay payout: mode=${cfg.mode} ${provider} ${phone} ${amt} XAF ${externalId} expediteur=${cfg.merchantNumber || 'AUCUN'}`);
  const post = payload => axios.post(url, payload, { headers: headers(cfg), timeout: TIMEOUT });
  let r;
  try {
    try { r = await post(withMeta); }
    catch (e) {
      const st = e.response?.status;
      if (st !== 400 && st !== 422) throw e;
      logger.warn(`KPay payout: metadata refusée (status=${st}) — nouvel essai sans metadata mode=${cfg.mode}`);
      r = await post(body);
    }
  } catch (e) { logFail('KPay payout failed', cfg, e); throw wrapError(e); }
  const out = normalizePayment(r.data?.data || r.data || {}, r.data);
  logger.info(`KPay payout OK: id=${out.id} status=${out.rawStatus} externalId=${externalId} mode=${cfg.mode}`);
  return out;
}

// ── Signature des webhooks (HMAC-SHA256) ──
function verifyHmac(rawBody, sigHeader) {
  const secrets = [process.env.KPAY_WEBHOOK_SECRET, process.env.KPAY_GATEWAY_SECRET].filter(Boolean);
  const received = String(sigHeader || '').replace(/^sha256=/i, '').trim();
  if (!secrets.length || !received) return false;
  const raw = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
  return secrets.some(secret => {
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    try { return received.length === expected.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected)); }
    catch (e) { return false; }
  });
}

// ── Pour le tableau de bord (jamais la clé) ──
async function describeConfig() {
  const cfg = await getKpayConfig();
  return { mode: cfg.mode, isLive: cfg.isLive, baseUrl: cfg.baseUrl, modeSource: cfg.modeSource, hasApiKey: !!cfg.apiKey, merchantNumber: cfg.merchantNumber, merchantSource: cfg.merchantSource };
}

// ── Journal de démarrage ──
async function logStartupConfig() {
  try {
    const cfg = await getKpayConfig(true);
    logger.info(`KPay MODE = ${cfg.mode} | isLive = ${cfg.isLive} | baseUrl = ${cfg.baseUrl} | Merchant = ${cfg.merchantNumber || 'AUCUN'}`);
    logger.info(`KPay Admin Merchant Number = ${cfg.merchantNumber || 'AUCUN'} | MODE = ${cfg.mode} | Source = ${cfg.merchantSource}`);
    if (!cfg.apiKey) logger.error('KPAY_API_KEY manquant : les paiements sont désactivés');
    if (!cfg.merchantNumber) logger.error('ADMIN_PHONE manquant (ni en BDD ni en ENV) : renseignez-le dans Admin > Paiement');
  } catch (e) { logger.error(`KPay configuration invalide : ${e.message}`); }
}

module.exports = {
  KPayError, formatPhone, normalizeAdminPhone, detectProviderFromPhone,
  getKpayConfig, invalidateConfigCache, describeConfig, logStartupConfig,
  initPayment, getStatus, getBalance, payoutToVendor, verifyHmac, normalizeStatus,
};
