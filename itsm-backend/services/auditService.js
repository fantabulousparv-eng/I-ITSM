const repos = require('../repositories');

/**
 * Writes the immutable incident audit trail (task 12).
 * Every domain event is turned into a row: timestamp, user, action,
 * incident id, previous state, new state, description.
 */
class AuditService {
  async record({
    incident,
    actor = null,
    actorName,
    actorRole,
    action,
    category = 'system',
    previousState = null,
    newState = null,
    description = '',
    meta = {},
  }) {
    return repos.audit.create({
      incidentId: incident._id,
      incidentRef: incident.incidentId,
      user: actor?._id || actor || null,
      actorName: actorName || actor?.name || 'system',
      actorRole: actorRole || actor?.role || 'system',
      action,
      category,
      previousState,
      newState,
      description,
      meta,
    });
  }

  async trail(incidentObjectId) {
    return repos.audit.findAll({ incidentId: incidentObjectId }, { sort: { createdAt: 1 } });
  }

  /** Most recent activity across all incidents (for admin oversight). */
  async recent(limit = 50) {
    return repos.audit.findAll({}, { sort: { createdAt: -1 }, limit });
  }
}

module.exports = new AuditService();
