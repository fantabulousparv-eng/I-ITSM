const AppError = require('../utils/AppError');

/**
 * Small fixed-window, in-memory rate limiter used to protect the
 * authentication endpoints against credential stuffing / brute force.
 *
 * A single-instance deployment is the target here, so a Map is sufficient.
 * Behind a load balancer the store would move to Redis.
 */
function rateLimit({ windowMs = 15 * 60 * 1000, max = 100, keyPrefix = 'rl', message } = {}) {
  const hits = new Map();
  let lastSweep = Date.now();

  function sweep(now) {
    // Drop expired buckets occasionally so the map cannot grow unbounded.
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  return function limiter(req, _res, next) {
    const now = Date.now();
    sweep(now);

    const key = `${keyPrefix}:${req.ip}`;
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return next(
        new AppError(
          message || 'Too many requests, please try again later',
          429,
          'RATE_LIMITED',
          { retryAfterSeconds: retryAfter }
        )
      );
    }
    return next();
  };
}

module.exports = rateLimit;
