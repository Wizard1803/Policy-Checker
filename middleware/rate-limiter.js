const quotaService = require('../services/quota.service');

const BURST_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_BURST_LIMIT = 30; // Max requests per minute

// In-memory sliding window cache: key -> Array<number> (timestamps)
const burstCache = new Map();

/**
 * Checks in-memory sliding window burst limit.
 *
 * @param {string} key
 * @param {number} [limit=30]
 * @returns {boolean} True if allowed, false if limit exceeded
 */
function checkBurstAllowed(key, limit = DEFAULT_BURST_LIMIT) {
  // In automated test suites, bypass burst limiting unless explicitly enabled for burst tests
  if (process.env.NODE_ENV === 'test' && !process.env.ENABLE_BURST_LIMIT_TEST) {
    return true;
  }

  const now = Date.now();
  let timestamps = burstCache.get(key);

  if (!timestamps) {
    timestamps = [];
    burstCache.set(key, timestamps);
  }

  // Remove timestamps outside current window
  const windowStart = now - BURST_WINDOW_MS;
  const recent = timestamps.filter((t) => t > windowStart);

  if (recent.length >= limit) {
    burstCache.set(key, recent);
    return false;
  }

  recent.push(now);
  burstCache.set(key, recent);
  return true;
}

/**
 * Clears burst limiter cache (primarily for test teardown).
 */
function clearBurstCache() {
  burstCache.clear();
}

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Sweeps and removes all expired entries from burstCache to prevent memory leaks.
 *
 * @param {number} [now=Date.now()]
 * @returns {number} Count of evicted keys
 */
function pruneExpiredBurstEntries(now = Date.now()) {
  const windowStart = now - BURST_WINDOW_MS;
  let evicted = 0;

  for (const [key, timestamps] of burstCache.entries()) {
    const recent = timestamps.filter((t) => t > windowStart);
    if (recent.length === 0) {
      burstCache.delete(key);
      evicted++;
    } else if (recent.length !== timestamps.length) {
      burstCache.set(key, recent);
    }
  }

  return evicted;
}

if (process.env.NODE_ENV !== 'test') {
  const sweepTimer = setInterval(pruneExpiredBurstEntries, SWEEP_INTERVAL_MS);
  if (sweepTimer && typeof sweepTimer.unref === 'function') {
    sweepTimer.unref();
  }
}

/**
 * Express middleware factory to enforce burst limits and monthly quotas.
 *
 * @param {'upload'|'query'} actionType
 * @returns {Function} Express middleware
 */
function enforceQuota(actionType) {
  return async (req, res, next) => {
    // If user is authenticated, use userId; else fallback to client IP
    const key = req.user ? req.user._id.toString() : req.ip || 'anonymous';
    const tier = req.user?.tier || 'standard';
    const burstLimit = quotaService.TIER_LIMITS[tier]?.burst || DEFAULT_BURST_LIMIT;

    // 1. Burst rate limit check (sliding window)
    if (!checkBurstAllowed(key, burstLimit)) {
      res.setHeader('Retry-After', '60');
      if (req.accepts('html') && !req.accepts('json') && !req.xhr) {
        return res.status(429).send('Too many rapid requests. Please wait a moment before trying again.');
      }
      return res.status(429).json({
        success: false,
        code: 'BURST_LIMIT_EXCEEDED',
        message: 'Too many rapid requests. Please wait a moment before trying again.',
      });
    }

    // 2. Monthly tiered quota check
    if (req.user && req.user._id) {
      try {
        const result = await quotaService.checkAndConsumeQuota(req.user._id, actionType);
        req.userQuota = result;
      } catch (err) {
        if (err.code === 'QUOTA_EXCEEDED' || err.statusCode === 429) {
          if (req.accepts('html') && !req.accepts('json') && !req.xhr) {
            return res.status(429).send(err.message || 'Monthly quota exceeded.');
          }
          return res.status(429).json({
            success: false,
            code: 'QUOTA_EXCEEDED',
            message: err.message || 'Monthly quota exceeded.',
          });
        }
        console.error('Quota check unexpected error:', err);
        return res.status(err.statusCode || 500).json({
          success: false,
          message: err.message || 'Service quota check failed.',
        });
      }
    }

    next();
  };
}

module.exports = {
  enforceQuota,
  checkBurstAllowed,
  clearBurstCache,
  pruneExpiredBurstEntries,
  SWEEP_INTERVAL_MS,
  BURST_WINDOW_MS,
  DEFAULT_BURST_LIMIT,
  burstCache,
};
