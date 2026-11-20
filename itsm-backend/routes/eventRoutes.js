const express = require('express');
const sseHub = require('../realtime/sseHub');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/events - Server-Sent Events stream (real-time notification leg).
 *
 * The browser's EventSource cannot set headers, so the JWT is accepted as a
 * `?token=` query parameter. The stream is kept alive with a comment ping so
 * proxies do not close an idle connection.
 */
router.get('/', requireAuth, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  res.write(`event: connected\ndata: ${JSON.stringify({ userId: String(req.user._id), name: req.user.name })}\n\n`);

  const remove = sseHub.add(req.user._id, res);

  const keepAlive = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch (_err) {
      clearInterval(keepAlive);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    remove();
  });
});

/** GET /api/events/status - small diagnostic for the SSE hub. */
router.get('/status', requireAuth, (_req, res) => {
  res.json({ connections: sseHub.connectionCount });
});

module.exports = router;
