const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const repos = require('../repositories');
const incidentService = require('../services/incidentService');
const auditService = require('../services/auditService');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/itsm');

const router = express.Router();

router.use(requireAuth);

const idOf = (ref) => (ref ? String(ref._id || ref) : null);

/** An incident is visible to its reporter, its technician, and to admins. */
function assertVisible(incident, actor) {
  if (actor.role === ROLES.ADMIN) return;
  const owns = idOf(incident.reporter) === String(actor._id);
  const works = idOf(incident.assignedTechnician) === String(actor._id);
  if (!owns && !works) throw AppError.forbidden('You do not have access to this incident', 'INCIDENT_FORBIDDEN');
}

/** Only the assigned technician (or an admin) may progress the workflow. */
function assertCanWorkOn(incident, actor) {
  if (actor.role === ROLES.ADMIN) return;
  if (actor.role !== ROLES.TECHNICIAN) {
    throw AppError.forbidden('Only technicians and administrators can progress an incident', 'ROLE_FORBIDDEN');
  }
  if (idOf(incident.assignedTechnician) !== String(actor._id)) {
    throw AppError.forbidden('This incident is assigned to another technician', 'NOT_ASSIGNED_TO_YOU');
  }
}

/* --------------------------------------------------------------- reporting */

/** GET /api/incidents - search & filter (>= 5 criteria, task 14). */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await incidentService.search(req.query, req.user);
    res.json(result);
  })
);

/** GET /api/incidents/meta - reference data used to build the filter UI. */
router.get(
  '/meta',
  asyncHandler(async (_req, res) => {
    const services = await repos.services.findAllActive();
    const technicians = await repos.users.findTechnicians();
    res.json({
      services,
      technicians: technicians.map((t) => ({
        _id: t._id,
        name: t.name,
        skills: t.skills,
        workloadCount: t.workloadCount,
        capacity: t.capacity,
        available: t.available,
      })),
    });
  })
);

/** GET /api/incidents/:id */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const incident = await incidentService.getById(req.params.id);
    assertVisible(incident, req.user);
    res.json({ incident });
  })
);

/** GET /api/incidents/:id/audit - complete, ordered history (task 12). */
router.get(
  '/:id/audit',
  asyncHandler(async (req, res) => {
    const incident = await incidentService.load(req.params.id, { populate: true });
    assertVisible(incident, req.user);
    const trail = await auditService.trail(incident._id);
    res.json({ incidentId: incident.incidentId, entries: trail });
  })
);

/** GET /api/incidents/:id/sla - live SLA position (task 11). */
router.get(
  '/:id/sla',
  asyncHandler(async (req, res) => {
    const incident = await incidentService.load(req.params.id, { populate: true });
    assertVisible(incident, req.user);
    res.json(await incidentService.slaStatus(req.params.id));
  })
);

/** GET /api/incidents/:id/technicians - suitable technicians (task 7). */
router.get(
  '/:id/technicians',
  requireRole(ROLES.ADMIN, ROLES.TECHNICIAN),
  asyncHandler(async (req, res) => {
    const strategy = req.query.strategy ? String(req.query.strategy) : 'composite';
    res.json(await incidentService.candidatesFor(req.params.id, strategy));
  })
);

/* ----------------------------------------------------------------- workflow */

/** POST /api/incidents - report a new incident (tasks 1-9 run automatically). */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const incident = await incidentService.create(req.body, req.user);
    res.status(201).json({ message: `Incident ${incident.incidentId} logged.`, incident });
  })
);

/** POST /api/incidents/:id/classify - re-run or override classification (tasks 2 & 3). */
router.post(
  '/:id/classify',
  requireRole(ROLES.ADMIN, ROLES.TECHNICIAN),
  asyncHandler(async (req, res) => {
    const incident = await incidentService.reclassify(req.params.id, req.body, req.user);
    res.json({ message: 'Classification updated.', incident });
  })
);

/** POST /api/incidents/:id/assign - assign or re-assign (task 8). */
router.post(
  '/:id/assign',
  requireRole(ROLES.ADMIN, ROLES.TECHNICIAN),
  asyncHandler(async (req, res) => {
    const incident = await incidentService.load(req.params.id);
    if (req.user.role === ROLES.TECHNICIAN) {
      // A technician may only claim the incident for themselves.
      const target = req.body.technicianId ? String(req.body.technicianId) : String(req.user._id);
      if (target !== String(req.user._id)) {
        throw AppError.forbidden('Technicians can only claim incidents for themselves', 'CLAIM_ONLY_SELF');
      }
    }
    const updated = await incidentService.assign(incident, {
      technicianId: req.body.technicianId || null,
      strategy: req.body.strategy || 'composite',
      actor: req.user,
    });
    res.json({ message: `Incident assigned to ${updated.assignedTechnician?.name || 'technician'}.`, incident: updated });
  })
);

/** PATCH /api/incidents/:id/status - advance the lifecycle (tasks 10 & 13). */
router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const incident = await incidentService.load(req.params.id);
    const target = String(req.body.status || '').toUpperCase();
    const selfService = target === 'CLOSED' && idOf(incident.reporter) === String(req.user._id);
    if (!selfService) assertCanWorkOn(incident, req.user);

    const updated = await incidentService.changeStatus(req.params.id, req.body, req.user);
    res.json({ message: `Incident moved to ${updated.status}.`, incident: updated });
  })
);

/** PATCH /api/incidents/:id/priority - re-assess impact / priority (task 5). */
router.patch(
  '/:id/priority',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const incident = await incidentService.setPriority(req.params.id, req.body, req.user);
    res.json({ message: `Priority is now ${incident.priority}.`, incident });
  })
);

/** POST /api/incidents/:id/notes - investigation note / comment (task 10). */
router.post(
  '/:id/notes',
  asyncHandler(async (req, res) => {
    const incident = await incidentService.load(req.params.id);
    assertVisible(incident, req.user);
    const updated = await incidentService.addNote(req.params.id, req.body, req.user);
    res.status(201).json({ message: 'Note added.', incident: updated });
  })
);

/** POST /api/incidents/:id/feedback - satisfaction rating. */
router.post(
  '/:id/feedback',
  asyncHandler(async (req, res) => {
    const incident = await incidentService.load(req.params.id);
    assertVisible(incident, req.user);
    const updated = await incidentService.submitFeedback(req.params.id, req.body, req.user);
    res.status(201).json({ message: 'Thank you for your feedback.', incident: updated });
  })
);

module.exports = router;
