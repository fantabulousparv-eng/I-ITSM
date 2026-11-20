const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const repos = require('../repositories');

/**
 * Authentication middleware.
 *
 * Every protected request must present a bearer token that is verified
 * server-side. The role in the token is never trusted on its own: the user is
 * re-loaded from the database so deactivated or re-roled accounts are honoured
 * immediately.
 */
const secret = () => process.env.JWT_SECRET || 'itsm_dev_secret_change_me';
const expiresIn = () => process.env.JWT_EXPIRES_IN || '1d';

function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, email: user.email, name: user.name },
    secret(),
    { expiresIn: expiresIn() }
  );
}

/** Accepts `Authorization: Bearer <token>` or `?token=` (needed by SSE). */
function readToken(req) {
  const header = req.headers.authorization || '';
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  if (req.query && req.query.token) return String(req.query.token);
  return null;
}

async function resolveUser(token) {
  let decoded;
  try {
    decoded = jwt.verify(token, secret());
  } catch (err) {
    throw AppError.unauthorized(
      err.name === 'TokenExpiredError' ? 'Your session has expired, please sign in again' : 'Invalid authentication token',
      'INVALID_TOKEN'
    );
  }
  const user = await repos.users.findById(decoded.sub);
  if (!user || user.active === false) throw AppError.unauthorized('This account is no longer available', 'ACCOUNT_UNAVAILABLE');
  return user;
}

const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = readToken(req);
  if (!token) throw AppError.unauthorized('Authentication required');
  req.user = await resolveUser(token);
  return next();
});

/** Role guard. Usage: `requireAuth, requireRole('admin', 'technician')`. */
function requireRole(...roles) {
  return function roleGuard(req, _res, next) {
    if (!req.user) return next(AppError.unauthorized());
    if (roles.length && !roles.includes(req.user.role)) {
      return next(AppError.forbidden(`This action requires one of these roles: ${roles.join(', ')}`));
    }
    return next();
  };
}

/** Attaches req.user when a token is present but never rejects. */
const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = readToken(req);
  if (token) {
    try {
      req.user = await resolveUser(token);
    } catch (_err) {
      req.user = null;
    }
  }
  return next();
});

module.exports = { signToken, requireAuth, requireRole, optionalAuth, readToken };
