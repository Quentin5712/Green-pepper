'use strict';
const Joi = require('joi');

const schema = Joi.object({
  NODE_ENV:            Joi.string().valid('development','production','test').default('development'),
  PORT:                Joi.number().default(3000),
  MONGO_URI:           Joi.string().uri().required(),
  JWT_SECRET:          Joi.string().min(32).required(),
  JWT_REFRESH_SECRET:  Joi.string().min(32).required(),
  KPAY_API_KEY:        Joi.string().pattern(/^kpay_/).required(),
  KPAY_BASE_URL:       Joi.string().uri().default('https://admin.kpay.site'),
  KPAY_GATEWAY_SECRET: Joi.string().min(16).required(),
  ADMIN_USER:          Joi.string().required(),
  ADMIN_PASS_HASH:     Joi.string().required(),
  ALLOWED_ORIGINS:     Joi.string().default('https://green-pepper.onrender.com,http://localhost:3000'),
}).unknown(true);

const { error, value } = schema.validate(process.env);
if (error) {
  console.error('❌ Configuration invalide:', error.message);
  process.exit(1);
}

module.exports = value;
