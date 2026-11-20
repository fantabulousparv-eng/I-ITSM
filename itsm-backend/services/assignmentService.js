const repos = require('../repositories');
const AppError = require('../utils/AppError');
const { AssignmentContext } = require('../patterns/assignment/assignment');
const { ROLES } = require('../constants/itsm');

/**
 * Technician identification and assignment (tasks 7 & 8).
 *
 * Wraps the pluggable assignment strategies and owns the side effects of an
 * assignment: the technician's workload counter and post-resolution stats.
 */
class AssignmentService {
  /** Ranked, explainable shortlist of technicians for an incident. */
  async candidates(incident, service, strategyName = 'composite') {
    const technicians = await repos.users.findTechnicians();
    if (!technicians.length) return [];
    const context = new AssignmentContext(strategyName);
    return context
      .rank({ incident, technicians, service })
      .map((entry) => ({ technician: entry.technician, score: entry.score, reasons: entry.reasons }));
  }

  /**
   * Assign an incident either to a named technician (dispatcher override) or
   * to the best candidate produced by the chosen strategy.
   */
  async assign(incident, { technicianId = null, strategy = 'composite' } = {}) {
    const service = await this.resolveService(incident);
    const previousTechnician = incident.assignedTechnician
      ? String(incident.assignedTechnician._id || incident.assignedTechnician)
      : null;

    let technician;
    let score = 0;
    let reasons;
    let strategyName = strategy;

    if (technicianId) {
      technician = await repos.users.findById(technicianId);
      if (!technician) throw AppError.notFound('Technician not found', 'TECHNICIAN_NOT_FOUND');
      if (technician.role !== ROLES.TECHNICIAN) throw AppError.badRequest('The selected user is not a technician', 'NOT_A_TECHNICIAN');
      if (technician.active === false) throw AppError.badRequest('The selected technician is not active', 'TECHNICIAN_INACTIVE');
      strategyName = 'manual';
      reasons = ['manually selected by the service desk'];
    } else {
      const ranked = await this.candidates(incident, service, strategy);
      const best = ranked.find((entry) => entry.score > 0) || ranked[0];
      if (!best) {
        throw AppError.businessRule(
          'No technician is currently available for this incident',
          'NO_TECHNICIAN_AVAILABLE'
        );
      }
      technician = best.technician;
      score = best.score;
      reasons = best.reasons;
    }

    incident.assignedTechnician = technician._id;
    incident.assignment = { strategy: strategyName, score, reasons, assignedAt: new Date() };
    incident.status = 'ASSIGNED';
    await incident.save();

    if (previousTechnician !== String(technician._id)) {
      if (previousTechnician) await this.adjustWorkload(previousTechnician, -1);
      await this.adjustWorkload(technician._id, 1);
    }

    return { incident, technician, strategy: strategyName, score, reasons };
  }

  /** Free a technician slot once the incident leaves the active queue. */
  async releaseWorkload(incident) {
    const id = incident.assignedTechnician?._id || incident.assignedTechnician;
    if (!id) return;
    await this.adjustWorkload(id, -1);
  }

  /** Roll the resolution into the technician's performance statistics. */
  async recordResolution(incident) {
    const id = incident.assignedTechnician?._id || incident.assignedTechnician;
    if (!id) return;

    const minutes = incident.minutesBetween(incident.createdAt, incident.resolution?.resolvedAt || new Date()) || 0;
    const serviceId = incident.affectedService?._id || incident.affectedService;

    const update = {
      $inc: { 'stats.resolvedCount': 1, 'stats.totalResolutionMinutes': minutes },
    };
    if (serviceId) update.$addToSet = { serviceExperience: serviceId };

    await repos.models.User.updateOne({ _id: id }, update);
  }

  async adjustWorkload(technicianId, delta) {
    await repos.models.User.updateOne({ _id: technicianId }, { $inc: { workloadCount: delta } });
    if (delta < 0) {
      // Never let a double-release push the counter below zero.
      await repos.models.User.updateOne(
        { _id: technicianId, workloadCount: { $lt: 0 } },
        { $set: { workloadCount: 0 } }
      );
    }
  }

  /** The affected service is sometimes an ObjectId, sometimes populated. */
  async resolveService(incident) {
    const ref = incident.affectedService;
    if (!ref) return null;
    if (typeof ref === 'object' && ref.name) return ref;
    return repos.services.findById(ref);
  }
}

module.exports = new AssignmentService();
