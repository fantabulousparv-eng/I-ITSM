const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../utils/validate');
const repos = require('../repositories');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/itsm');

const router = express.Router();
router.use(requireAuth);

/** GET /api/services - service catalogue (used by the incident form). */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const services = await repos.services.findAllActive();
    const withCriticality = req.query.withCriticality === 'true';
    res.json({ services, count: services.length, detailed: withCriticality });
  })
);

/** GET /api/services/:id */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const service = await repos.services.findById(validate.objectId(req.params.id, 'service'));
    if (!service) return res.status(404).json({ error: 'Service not found', code: 'SERVICE_NOT_FOUND', status: 404 });
    return res.json({ service });
  })
);

/** POST /api/services - add a service to the catalogue (admin). */
router.post(
  '/',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const service = await repos.services.create({
      name: validate.requiredString(req.body.name, 'Service name', { max: 120 }),
      code: validate.optionalString(req.body.code, 'Code', { max: 30 }).toUpperCase(),
      category: validate.category(req.body.category, 'Category'),
      baseCriticality: req.body.baseCriticality
        ? validate.level(req.body.baseCriticality, 'Base criticality')
        : 'Medium',
      description: validate.optionalString(req.body.description, 'Description', { max: 1000 }),
      ownerTeam: validate.optionalString(req.body.ownerTeam, 'Owner team', { max: 120 }),
      keywords: validate.stringArray(req.body.keywords, 'Keywords', { max: 40 }),
    });
    res.status(201).json({ message: 'Service added to the catalogue.', service });
  })
);

/** PATCH /api/services/:id - update the catalogue entry (admin). */
router.patch(
  '/:id',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const service = await repos.services.findById(validate.objectId(req.params.id, 'service'));
    if (!service) return res.status(404).json({ error: 'Service not found', code: 'SERVICE_NOT_FOUND', status: 404 });

    if (req.body.name !== undefined) service.name = validate.requiredString(req.body.name, 'Service name', { max: 120 });
    if (req.body.category !== undefined) service.category = validate.category(req.body.category, 'Category');
    if (req.body.baseCriticality !== undefined) {
      service.baseCriticality = validate.level(req.body.baseCriticality, 'Base criticality');
    }
    if (req.body.description !== undefined) {
      service.description = validate.optionalString(req.body.description, 'Description', { max: 1000 });
    }
    if (req.body.keywords !== undefined) {
      service.keywords = validate.stringArray(req.body.keywords, 'Keywords', { max: 40 });
    }
    if (req.body.active !== undefined) service.active = Boolean(req.body.active);

    await service.save();
    return res.json({ message: 'Service updated.', service });
  })
);

module.exports = router;
