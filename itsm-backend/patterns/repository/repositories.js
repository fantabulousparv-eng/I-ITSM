/**
 * Repository pattern - encapsulates persistence so services never talk to
 * Mongoose directly. Swapping the datastore only touches this layer.
 */
class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  create(data) {
    return this.model.create(data);
  }

  findById(id, projection) {
    return this.model.findById(id, projection);
  }

  findAll(filter = {}, options = {}) {
    return this.model.find(filter, null, options);
  }

  count(filter = {}) {
    return this.model.countDocuments(filter);
  }

  updateById(id, update, options = { returnDocument: 'after' }) {
    return this.model.findByIdAndUpdate(id, update, options);
  }

  deleteById(id) {
    return this.model.findByIdAndDelete(id);
  }
}

class IncidentRepository extends BaseRepository {
  constructor(model) {
    super(model);
  }

  /** Standard population used by the API so responses are UI-ready. */
  populate(query) {
    return query
      .populate('reporter', 'name email role department')
      .populate('assignedTechnician', 'name email role skills workloadCount capacity')
      .populate('affectedService', 'name category baseCriticality');
  }

  findByTicketId(incidentId) {
    return this.populate(this.model.findOne({ incidentId }));
  }

  findByIdPopulated(id) {
    return this.populate(this.model.findById(id));
  }

  findManyPopulated(filter, options = {}) {
    return this.populate(this.model.find(filter, null, options));
  }

  /** Technician workload: count of incidents not yet closed/resolved. */
  countActiveForTechnician(technicianId) {
    return this.model.countDocuments({
      assignedTechnician: technicianId,
      status: { $nin: ['RESOLVED', 'VERIFIED', 'CLOSED'] },
    });
  }

  /** Incidents whose SLA deadline is approaching but not yet breached. */
  findSlaCandidates(now = new Date()) {
    return this.model.find({
      status: { $nin: ['RESOLVED', 'VERIFIED', 'CLOSED'] },
      'sla.resolutionDueAt': { $ne: null, $lte: now },
    });
  }
}

class UserRepository extends BaseRepository {
  constructor(model) {
    super(model);
  }

  findByEmail(email, { withPassword = false } = {}) {
    const query = this.model.findOne({ email: String(email).toLowerCase() });
    return withPassword ? query.select('+password') : query;
  }

  findTechnicians(filter = {}) {
    return this.model.find({ role: 'technician', active: true, ...filter }).sort({ workloadCount: 1 });
  }

  findAdminsAndManagers() {
    return this.model.find({ role: 'admin', active: true });
  }

  findByIds(ids) {
    return this.model.find({ _id: { $in: ids } });
  }
}

class ServiceRepository extends BaseRepository {
  constructor(model) {
    super(model);
  }

  findAllActive() {
    return this.model.find({ active: true }).sort({ name: 1 });
  }

  findByCategory(category) {
    return this.model.find({ category, active: true });
  }
}

class NotificationRepository extends BaseRepository {
  constructor(model) {
    super(model);
  }

  findForUser(userId, { unreadOnly = false, limit = 50 } = {}) {
    const filter = { recipient: userId };
    if (unreadOnly) filter.read = false;
    return this.model
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('incident', 'incidentId title status priority');
  }

  unreadCount(userId) {
    return this.model.countDocuments({ recipient: userId, read: false });
  }
}

module.exports = {
  BaseRepository,
  IncidentRepository,
  UserRepository,
  ServiceRepository,
  NotificationRepository,
};
