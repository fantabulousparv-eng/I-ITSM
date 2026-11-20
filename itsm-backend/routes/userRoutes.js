const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../utils/validate');
const AppError = require('../utils/AppError');
const repos = require('../repositories');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/itsm');

const router = express.Router();
router.use(requireAuth);

/** GET /api/users/technicians - technician roster with live workload. */
router.get(
  '/technicians',
  asyncHandler(async (_req, res) => {
    const technicians = await repos.users.findTechnicians();
    res.json({
      technicians: technicians.map((t) => ({
        _id: t._id,
        name: t.name,
        email: t.email,
        skills: t.skills,
        available: t.available,
        workloadCount: t.workloadCount,
        capacity: t.capacity,
        experienceYears: t.experienceYears,
        utilization: t.utilization,
        avgResolutionMinutes: t.avgResolutionMinutes,
        resolvedCount: t.stats?.resolvedCount || 0,
      })),
    });
  })
);

/** GET /api/users - directory (admin). */
router.get(
  '/',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.role) filter.role = validate.role(String(req.query.role), 'Role');
    if (req.query.active !== undefined) filter.active = req.query.active === 'true';

    const users = await repos.users.findAll(filter, { sort: { role: 1, name: 1 } });
    res.json({ users, count: users.length });
  })
);

/** PATCH /api/users/me - self-service profile update. */
router.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const user = await repos.users.findById(req.user._id);
    if (req.body.name !== undefined) user.name = validate.requiredString(req.body.name, 'Full name', { max: 120 });
    if (req.body.phone !== undefined) user.phone = validate.optionalString(req.body.phone, 'Phone', { max: 30 });
    if (req.body.department !== undefined) {
      user.department = validate.optionalString(req.body.department, 'Department', { max: 120 });
    }
    if (req.body.skills !== undefined && user.role === ROLES.TECHNICIAN) {
      user.skills = validate.stringArray(req.body.skills, 'Skills', { max: 30 });
    }
    if (req.body.available !== undefined && user.role === ROLES.TECHNICIAN) {
      user.available = Boolean(req.body.available);
    }
    await user.save();
    res.json({ message: 'Profile updated.', user });
  })
);

/** PATCH /api/users/:id - administrative update (admin). */
router.patch(
  '/:id',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const user = await repos.users.findById(validate.objectId(req.params.id, 'user'));
    if (!user) throw AppError.notFound('User not found', 'USER_NOT_FOUND');

    if (req.body.role !== undefined) user.role = validate.role(req.body.role, 'Role');
    if (req.body.department !== undefined) {
      user.department = validate.optionalString(req.body.department, 'Department', { max: 120 });
    }
    if (req.body.skills !== undefined) user.skills = validate.stringArray(req.body.skills, 'Skills', { max: 30 });
    if (req.body.available !== undefined) user.available = Boolean(req.body.available);
    if (req.body.active !== undefined) user.active = Boolean(req.body.active);
    if (req.body.capacity !== undefined) {
      user.capacity = validate.positiveInt(req.body.capacity, 'Capacity', { min: 1, max: 100 });
    }
    if (req.body.experienceYears !== undefined) {
      user.experienceYears = validate.positiveInt(req.body.experienceYears, 'Experience', { min: 0, max: 60 });
    }

    await user.save();
    res.json({ message: 'User updated.', user });
  })
);

module.exports = router;
