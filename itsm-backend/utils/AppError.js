/**
 * Operational (expected) error carrying an HTTP status code.
 * Anything thrown that is NOT an AppError is treated as an unexpected 500.
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, code = 'BAD_REQUEST', details) {
    return new AppError(message, 400, code, details);
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new AppError(message, 401, code);
  }

  static forbidden(message = 'You do not have permission to perform this action', code = 'FORBIDDEN') {
    return new AppError(message, 403, code);
  }

  static notFound(message = 'Resource not found', code = 'NOT_FOUND') {
    return new AppError(message, 404, code);
  }

  static conflict(message, code = 'CONFLICT', details) {
    return new AppError(message, 409, code, details);
  }

  /** Business-rule violation that is not a plain 400 (e.g. invalid state change). */
  static businessRule(message, code = 'BUSINESS_RULE_VIOLATION', details) {
    return new AppError(message, 422, code, details);
  }
}

module.exports = AppError;
