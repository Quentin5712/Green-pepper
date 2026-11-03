'use strict';
const jwt  = require('jsonwebtoken');
const User = require('../models/User');

module.exports = function activityTracker(req, res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return next();
    const token = auth.slice(7);
    let payload;
    try { payload = jwt.verify(token, process.env.JWT_SECRET); } catch(e) { return next(); }
    if (!payload?.id) return next();
    User.findOneAndUpdate(
      { _id: payload.id, isDeleted: false, isBanned: false },
      { lastActive: new Date(), isOnline: true, currentIP: req.ip || '' },
      { new: false }
    ).catch(() => {});
  } catch(e) {}
  next();
};
