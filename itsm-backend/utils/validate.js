const AppError = require('./AppError');
const { LEVELS, CATEGORIES, STATUS_VALUES, ROLE_VALUES } = require('../constants/itsm');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(message, code = 'VALIDATION_ERROR', details) {
  throw AppError.badRequest(message, code, details);
}

function requiredString(value, field, { min = 1, max = 2000 } = {}) {
  if (typeof value !== 'string' || value.trim().length < min) {
    fail(`${field} is required`, 'VALIDATION_ERROR', { field });
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    fail(`${field} must be at most ${max} characters`, 'VALIDATION_ERROR', { field });
  }
  return trimmed;
}

function optionalString(value, field, { max = 5000 } = {}) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') fail(`${field} must be a string`, 'VALIDATION_ERROR', { field });
  const trimmed = value.trim();
  if (trimmed.length > max) fail(`${field} must be at most ${max} characters`, 'VALIDATION_ERROR', { field });
  return trimmed;
}

function email(value) {
  const v = requiredString(value, 'Email', { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(v)) fail('Please provide a valid email address', 'VALIDATION_ERROR', { field: 'email' });
  return v;
}

/**
 * Password policy: >= 8 chars, at least one letter and one number.
 * Returns a strength score 0-4 for UI feedback.
 */
function password(value) {
  if (typeof value !== 'string' || value.length < 8) {
    fail('Password must be at least 8 characters long', 'WEAK_PASSWORD', { field: 'password' });
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    fail('Password must contain at least one letter and one number', 'WEAK_PASSWORD', { field: 'password' });
  }
  return value;
}

function oneOf(value, allowed, field, { required: isRequired = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (isRequired) fail(`${field} is required`, 'VALIDATION_ERROR', { field });
    return undefined;
  }
  if (!allowed.includes(value)) {
    fail(`${field} must be one of: ${allowed.join(', ')}`, 'VALIDATION_ERROR', { field, allowed });
  }
  return value;
}

const level = (value, field = 'level', opts) => oneOf(value, LEVELS, field, opts);
const category = (value, field = 'category') => oneOf(value, CATEGORIES, field);
const status = (value, field = 'status') => oneOf(value, STATUS_VALUES, field);
const role = (value, field = 'role', opts) => oneOf(value, ROLE_VALUES, field, opts);

function positiveInt(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    fail(`${field} is required`, 'VALIDATION_ERROR', { field });
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    fail(`${field} must be an integer between ${min} and ${max}`, 'VALIDATION_ERROR', { field });
  }
  return n;
}

function stringArray(value, field, { max = 50 } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${field} must be an array`, 'VALIDATION_ERROR', { field });
  return value
    .map((v) => String(v).trim())
    .filter(Boolean)
    .slice(0, max);
}

function objectId(value, field, { required: isRequired = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (isRequired) fail(`${field} is required`, 'VALIDATION_ERROR', { field });
    return undefined;
  }
  const v = String(value);
  if (!/^[0-9a-fA-F]{24}$/.test(v)) fail(`${field} is not a valid id`, 'VALIDATION_ERROR', { field });
  return v;
}

module.exports = {
  fail,
  requiredString,
  optionalString,
  email,
  password,
  oneOf,
  level,
  category,
  status,
  role,
  positiveInt,
  stringArray,
  objectId,
};
