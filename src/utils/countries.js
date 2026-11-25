'use strict';
// Pays où KPay peut VERSER des marchands + opérateurs Mobile Money (codes de la documentation KPay / pawaPay).
// Rwanda volontairement absent : la devise indiquée dans la documentation KPay est incohérente (à confirmer avant ajout).
const COUNTRIES = {
  CMR: { name: 'Cameroun',          cc: '237', currency: 'XAF', flag: '🇨🇲' },
  GAB: { name: 'Gabon',             cc: '241', currency: 'XAF', flag: '🇬🇦' },
  COG: { name: 'Congo-Brazzaville', cc: '242', currency: 'XAF', flag: '🇨🇬' },
  CIV: { name: "Côte d'Ivoire",     cc: '225', currency: 'XOF', flag: '🇨🇮' },
  SEN: { name: 'Sénégal',           cc: '221', currency: 'XOF', flag: '🇸🇳' },
  BEN: { name: 'Bénin',             cc: '229', currency: 'XOF', flag: '🇧🇯' },
  COD: { name: 'RD Congo',          cc: '243', currency: 'CDF', flag: '🇨🇩' },
  KEN: { name: 'Kenya',             cc: '254', currency: 'KES', flag: '🇰🇪' },
  UGA: { name: 'Ouganda',           cc: '256', currency: 'UGX', flag: '🇺🇬' },
  ZMB: { name: 'Zambie',            cc: '260', currency: 'ZMW', flag: '🇿🇲' },
  SLE: { name: 'Sierra Leone',      cc: '232', currency: 'SLE', flag: '🇸🇱' },
};
const PROVIDERS = {
  MTN_MOMO_CMR: ['CMR', 'MTN MoMo'],       ORANGE_CMR: ['CMR', 'Orange Money'],
  AIRTEL_GAB: ['GAB', 'Airtel Money'],
  AIRTEL_COG: ['COG', 'Airtel Money'],     MTN_MOMO_COG: ['COG', 'MTN MoMo'],
  MTN_MOMO_CIV: ['CIV', 'MTN MoMo'],       ORANGE_CIV: ['CIV', 'Orange Money'],
  FREE_SEN: ['SEN', 'Free Money'],         ORANGE_SEN: ['SEN', 'Orange Money'],
  MTN_MOMO_BEN: ['BEN', 'MTN MoMo'],       MOOV_BEN: ['BEN', 'Moov Money'],
  VODACOM_MPESA_COD: ['COD', 'M-Pesa'],    AIRTEL_COD: ['COD', 'Airtel Money'], ORANGE_COD: ['COD', 'Orange Money'],
  MPESA_KEN: ['KEN', 'M-Pesa'],
  AIRTEL_OAPI_UGA: ['UGA', 'Airtel Money'], MTN_MOMO_UGA: ['UGA', 'MTN MoMo'],
  AIRTEL_OAPI_ZMB: ['ZMB', 'Airtel Money'], MTN_MOMO_ZMB: ['ZMB', 'MTN MoMo'], ZAMTEL_ZMB: ['ZMB', 'Zamtel Kwacha'],
  ORANGE_SLE: ['SLE', 'Orange Money'],
};
const FCFA = ['XAF', 'XOF'];                                     // même parité (1 XAF = 1 XOF) : les prix du site sont en FCFA

function providerInfo(code) {
  const p = PROVIDERS[String(code || '')]; if (!p) return null;
  const c = COUNTRIES[p[0]];
  return { code, country: p[0], label: p[1], currency: c.currency, cc: c.cc };
}
const providersOfCountry = iso => Object.keys(PROVIDERS).filter(k => PROVIDERS[k][0] === iso).map(providerInfo);
const isCountry = iso => !!COUNTRIES[String(iso || '')];
const INTL_RE = /^[1-9][0-9]{7,14}$/;                           // numéro international : 8 à 15 chiffres, sans « + »

// Numéro saisi → format international. Accepte « 677123456 », « +237 677 12 34 56 », « 00237677123456 ».
function toIntlPhone(phone, iso = 'CMR') {
  const cc = (COUNTRIES[iso] || COUNTRIES.CMR).cc;
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith(cc) && d.length >= cc.length + 7) return d;
  if (cc === '237' && d.length > 9) d = d.slice(-9);             // comportement historique du Cameroun
  return cc + d;
}
module.exports = { COUNTRIES, PROVIDERS, FCFA, providerInfo, providersOfCountry, isCountry, INTL_RE, toIntlPhone };
