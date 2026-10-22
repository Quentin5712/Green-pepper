'use strict';
const Notification = require('../models/Notification');

async function getNotifications(req, res) {
  try {
    const notifs = await Notification.find({ userId: req.user.id }).sort({ createdAt:-1 }).limit(50).lean();
    const unread = notifs.filter(n=>!n.isRead).length;
    res.json({ notifications: notifs, unread });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function markRead(req, res) {
  try {
    await Notification.updateMany({ userId: req.user.id, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

module.exports = { getNotifications, markRead };
