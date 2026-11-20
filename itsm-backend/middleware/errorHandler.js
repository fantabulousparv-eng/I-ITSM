const AppError = require('../utils/AppError');

/** 404 for unmatched routes - converted into the standard error envelope. */
function notFound(req, _res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404, 'ROUTE_NOT_FOUND'));
}

/**
 * Centralised error handler. Converts AppError, Mongoose validation/cast
 * errors and duplicate-key errors into a single JSON shape:
 *   { error, code, details, status }
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  let status = err.statusCode || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'Unexpected server error';
  let details = err.details;

  if (err.name === 'ValidationError' && err.errors) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Please correct the highlighted fields';
    details = Object.fromEntries(Object.entries(err.errors).map(([field, e]) => [field, e.message]));
  } else if (err.name === 'CastError') {
    status = 400;
    code = 'INVALID_ID';
    message = `Invalid value for "${err.path}"`;
  } else if (err.code === 11000) {
    status = 409;
    code = 'DUPLICATE_KEY';
    const fields = Object.keys(err.keyValue || {});
    message = fields.length ? `That ${fields.join(', ')} is already in use` : 'Duplicate record';
    details = err.keyValue;
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'MALFORMED_JSON';
    message = 'Request body contains invalid JSON';
  }

  if (status >= 500) console.error('[error]', err);

  res.status(status).json({
    error: message,
    code,
    details: details || undefined,
    status,
  });
}

module.exports = { notFound, errorHandler };
