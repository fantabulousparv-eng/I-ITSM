const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const analyticsService = require('../services/analyticsService');
const auditService = require('../services/auditService');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/itsm');

const router = express.Router();
router.use(requireAuth, requireRole(ROLES.ADMIN, ROLES.TECHNICIAN));

/** GET /api/analytics/overview - task 14 dashboard aggregates. */
router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
    res.json(await analyticsService.overview({ days }));
  })
);

/** GET /api/analytics/sla-watchlist - breached / at-risk open incidents. */
router.get(
  '/sla-watchlist',
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    res.json({ items: await analyticsService.slaWatchlist(limit) });
  })
);

/** GET /api/analytics/activity - most recent activity across all incidents. */
router.get(
  '/activity',
  asyncHandler(async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const entries = await auditService.recent(limit);
    res.json({ entries });
  })
);

module.exports = router;
