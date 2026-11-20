const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const notificationService = require('../services/notificationService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/** GET /api/notifications - the in-app notification centre. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const unreadOnly = req.query.unread === 'true';
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const [items, unread] = await Promise.all([
      notificationService.listForUser(req.user._id, { unreadOnly, limit }),
      notificationService.unreadCount(req.user._id),
    ]);
    res.json({ notifications: items, unread });
  })
);

/** GET /api/notifications/unread-count - badge polling fallback for SSE. */
router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    res.json({ unread: await notificationService.unreadCount(req.user._id) });
  })
);

/** PATCH /api/notifications/:id/read */
router.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const notification = await notificationService.markRead(req.user._id, req.params.id);
    if (!notification) throw AppError.notFound('Notification not found', 'NOTIFICATION_NOT_FOUND');
    res.json({ message: 'Marked as read.', notification });
  })
);

/** POST /api/notifications/read-all */
router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await notificationService.markAllRead(req.user._id);
    res.json({ message: 'All notifications marked as read.' });
  })
);

module.exports = router;
