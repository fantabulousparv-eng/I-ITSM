const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../utils/validate');
const AppError = require('../utils/AppError');
const repos = require('../repositories');
const rateLimit = require('../middleware/rateLimit');
const { signToken, requireAuth } = require('../middleware/auth');
const { ROLES } = require('../constants/itsm');

const router = express.Router();

/** Brute-force protection on the credential endpoints. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyPrefix: 'login',
  message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyPrefix: 'register',
  message: 'Too many sign-up attempts from this address. Please try again later.',
});

/** POST /api/auth/register - open signup for employees and technicians. */
router.post(
  '/register',
  registerLimiter,
  asyncHandler(async (req, res) => {
    const name = validate.requiredString(req.body.name, 'Full name', { max: 120 });
    const email = validate.email(req.body.email);
    const password = validate.password(req.body.password);
    const role = validate.role(req.body.role || ROLES.EMPLOYEE, 'Role');

    if (role === ROLES.ADMIN) {
      throw AppError.forbidden(
        'Administrator accounts are provisioned by the service desk and cannot be self-registered',
        'ADMIN_SIGNUP_BLOCKED'
      );
    }

    const existing = await repos.users.findByEmail(email);
    if (existing) {
      throw AppError.conflict('An account with this email address already exists', 'EMAIL_IN_USE', { field: 'email' });
    }

    const user = await repos.users.create({
      name,
      email,
      password,
      role,
      phone: validate.optionalString(req.body.phone, 'Phone', { max: 30 }),
      department: validate.optionalString(req.body.department, 'Department', { max: 120 }),
      skills: role === ROLES.TECHNICIAN ? validate.stringArray(req.body.skills, 'Skills', { max: 30 }) : [],
      experienceYears: role === ROLES.TECHNICIAN
        ? validate.positiveInt(req.body.experienceYears, 'Experience', { min: 0, max: 60, fallback: 0 })
        : 0,
    });

    const token = signToken(user);
    res.status(201).json({
      message: 'Your account has been created. Welcome aboard!',
      token,
      user,
    });
  })
);

/** POST /api/auth/login */
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const email = validate.email(req.body.email);
    const password = validate.requiredString(req.body.password, 'Password', { max: 200 });

    const user = await repos.users.findByEmail(email, { withPassword: true });
    // Same message for unknown email and wrong password (no account enumeration).
    if (!user) throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    if (user.active === false) {
      throw AppError.forbidden('This account has been deactivated. Please contact the service desk.', 'ACCOUNT_DISABLED');
    }

    const matches = await user.comparePassword(password);
    if (!matches) throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');

    user.lastLoginAt = new Date();
    await user.save();

    res.json({
      message: `Welcome back, ${user.name.split(' ')[0]}!`,
      token: signToken(user),
      user,
    });
  })
);

/** GET /api/auth/me - re-hydrate the session on page load. */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  })
);

/** GET /api/auth/directory - lightweight people picker (auth required). */
router.get(
  '/directory',
  requireAuth,
  asyncHandler(async (req, res) => {
    const role = req.query.role ? validate.role(String(req.query.role), 'Role') : undefined;
    const users = await repos.users.findAll(
      role ? { role, active: true } : { active: true },
      { sort: { name: 1 } }
    );
    res.json({
      users: users.map((user) => ({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        skills: user.skills,
      })),
    });
  })
);

module.exports = router;
