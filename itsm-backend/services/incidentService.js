const repos = require('../repositories');
const AppError = require('../utils/AppError');
const validate = require('../utils/validate');
const eventBus = require('../patterns/observer/EventBus');
const IncidentStateMachine = require('../patterns/state/IncidentStateMachine');
const { PriorityContext } = require('../patterns/priority/priority');
const slaService = require('./slaService');
const classificationService = require('./classificationService');
const assignmentService = require('./assignmentService');
const { EVENTS, ROLES, STATUS, PRIORITIES, RANK, SLA_POLICIES } = require('../constants/itsm');

/** Maps a lifecycle target state to the domain event that announces it. */
const STATUS_EVENTS = {
  [STATUS.ACKNOWLEDGED]: EVENTS.INCIDENT_ACKNOWLEDGED,
  [STATUS.IN_PROGRESS]: EVENTS.INCIDENT_IN_PROGRESS,
  [STATUS.RESOLVED]: EVENTS.INCIDENT_RESOLVED,
  [STATUS.CLOSED]: EVENTS.INCIDENT_CLOSED,
};

const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  priority: { priority: 1, createdAt: -1 },
  'sla-due': { 'sla.resolutionDueAt': 1 },
  updated: { updatedAt: -1 },
};

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highestLevel(...levels) {
  return levels.filter(Boolean).reduce((acc, level) => (RANK[level] > RANK[acc] ? level : acc), 'Low');
}

/** Task 4 - business impact: the highest of user impact and service criticality. */
function deriveBusinessCriticality({ provided, service, impact, affectedUsers }) {
  if (provided) return provided;
  let criticality = service?.baseCriticality || 'Medium';
  if (affectedUsers >= 100) criticality = highestLevel(criticality, 'Critical');
  else if (affectedUsers >= 20) criticality = highestLevel(criticality, 'High');
  if (impact === 'Critical') criticality = highestLevel(criticality, 'Critical');
  if (impact === 'High') criticality = highestLevel(criticality, 'High');
  return criticality;
}

/**
 * Incident service - orchestrates the full fourteen-step lifecycle:
 *
 *  1  create            -> 8  assign
 *  2  classify          -> 9  notify (domain events -> observers)
 *  3  identify service  -> 10 track investigation & resolution
 *  4  business impact   -> 11 monitor SLA compliance
 *  5  priority          -> 12 audit every activity
 *  6  SLA               -> 13 close
 *  7  find technicians  -> 14 feed analytics
 *
 * Auditing (12) and notification (9) are handled by observers subscribed to
 * the domain event bus, which keeps this class focused on the workflow.
 */
class IncidentService {
  constructor() {
    this.priorityContext = new PriorityContext();
  }

  /* ------------------------------------------------------------------ read */

  async getById(id) {
    const incident = await this.load(id, { populate: true });
    return this.decorate(incident);
  }

  /** Task 14 support - the reporting/search entry point (>= 5 criteria). */
  async search(query = {}, actor = null) {
    const filter = {};
    const conditions = this.scopeConditions(actor);

    if (query.status) filter.status = validate.status(String(query.status), 'status');
    if (query.priority) filter.priority = validate.oneOf(String(query.priority), PRIORITIES, 'priority');
    if (query.category) filter.category = validate.category(String(query.category), 'category');
    if (query.service) filter.affectedService = validate.objectId(String(query.service), 'service');
    if (query.reporter) filter.reporter = validate.objectId(String(query.reporter), 'reporter');

    if (query.technician === 'unassigned') {
      filter.assignedTechnician = null;
    } else if (query.technician) {
      filter.assignedTechnician = validate.objectId(String(query.technician), 'technician');
    }

    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) filter.createdAt.$gte = new Date(query.from);
      if (query.to) {
        const to = new Date(query.to);
        // A date-only upper bound should include the whole day.
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.to))) to.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    }

    if (query.q && String(query.q).trim()) {
      const rx = new RegExp(escapeRegExp(String(query.q).trim()), 'i');
      conditions.push({ $or: [{ incidentId: rx }, { title: rx }, { description: rx }, { tags: rx }] });
    }

    if (query.slaStatus) conditions.push(...this.slaConditions(String(query.slaStatus).toUpperCase()));

    if (conditions.length) filter.$and = conditions;

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const sort = SORTS[query.sort] || SORTS.newest;

    const [total, incidents] = await Promise.all([
      repos.incidents.count(filter),
      repos.incidents.findManyPopulated(filter, { sort, skip: (page - 1) * limit, limit }),
    ]);

    return {
      items: incidents.map((incident) => this.decorate(incident)),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      limit,
      appliedFilters: query,
    };
  }

  /* ----------------------------------------------------------------- write */

  /** Tasks 1-8: create, classify, identify service, assess impact, set priority, SLA, assign. */
  async create(input = {}, actor = null) {
    const reporterId = validate.objectId(input.reporter || actor?._id, 'Reporter');
    const reporter = await repos.users.findById(reporterId);
    if (!reporter) throw AppError.notFound('Reporter account not found', 'REPORTER_NOT_FOUND');

    const title = validate.requiredString(input.title, 'Title', { max: 200 });
    const description = validate.requiredString(input.description, 'Description', { max: 5000 });
    const impact = validate.level(input.impact, 'Impact');
    const urgency = validate.level(input.urgency, 'Urgency');
    const affectedUsers = validate.positiveInt(input.affectedUsers, 'Affected users', {
      min: 1,
      max: 1000000,
      fallback: 1,
    });
    const criticalityInput =
      input.businessCriticality === undefined || input.businessCriticality === ''
        ? undefined
        : validate.level(input.businessCriticality, 'Business criticality');

    /* --- tasks 2 & 3: classification and affected service --- */
    let chosenService = null;
    if (input.affectedService) {
      chosenService = await repos.services.findById(validate.objectId(input.affectedService, 'Affected service'));
      if (!chosenService) throw AppError.notFound('Affected service not found', 'SERVICE_NOT_FOUND');
    }
    const classification = await classificationService.classify({
      title,
      description,
      service: chosenService,
    });
    const service = chosenService || classification.service;
    if (!service) {
      throw AppError.badRequest(
        'The affected service could not be identified automatically - please select it from the list.',
        'SERVICE_REQUIRED'
      );
    }

    /* --- task 4: business impact --- */
    const businessCriticality = deriveBusinessCriticality({
      provided: criticalityInput,
      service,
      impact,
      affectedUsers,
    });

    /* --- task 5: priority --- */
    const priorityResult = this.priorityContext
      .setStrategy(input.priorityStrategy || 'weighted-score')
      .calculate({ impact, urgency, businessCriticality, affectedUsers, service });

    /* --- task 6: SLA targets --- */
    const deadlines = await slaService.computeDeadlines(priorityResult.priority);

    /* --- race-free ticket id (atomic counter) --- */
    const sequence = await repos.models.Counter.next('incident', 1000);

    const incident = await repos.incidents.create({
      incidentId: `INC-${sequence}`,
      title,
      description,
      category: classification.category,
      affectedService: service._id,
      classification: {
        method: classification.method,
        confidence: classification.confidence,
        matchedKeywords: classification.matchedKeywords,
      },
      reporter: reporter._id,
      impact,
      urgency,
      businessCriticality,
      affectedUsers,
      priority: priorityResult.priority,
      priorityScore: priorityResult.score,
      priorityStrategy: priorityResult.strategy,
      status: STATUS.NEW,
      sla: {
        responseTarget: deadlines.responseTarget,
        resolutionTarget: deadlines.resolutionTarget,
        responseDueAt: deadlines.responseTarget,
        resolutionDueAt: deadlines.resolutionTarget,
      },
      tags: validate.stringArray(input.tags, 'Tags', { max: 20 }),
    });

    /* --- task 12 (audit) + task 9 (notify) via observers --- */
    await eventBus.publishAsync(EVENTS.INCIDENT_CREATED, {
      incident,
      actor,
      changes: { from: null, to: STATUS.NEW },
      record: {
        action: 'INCIDENT_CREATED',
        category: 'lifecycle',
        description: `${incident.incidentId} reported by ${reporter.name} (impact ${impact}, urgency ${urgency}, priority ${priorityResult.priority}).`,
        meta: { priorityScore: priorityResult.score, priorityStrategy: priorityResult.strategy },
      },
      notify: {},
    });

    incident.status = STATUS.CLASSIFIED;
    await incident.save();

    await eventBus.publishAsync(EVENTS.INCIDENT_CLASSIFIED, {
      incident,
      actor,
      changes: { from: STATUS.NEW, to: STATUS.CLASSIFIED },
      record: {
        action: 'INCIDENT_CLASSIFIED',
        category: 'lifecycle',
        description: `Classified as ${classification.category} (${classification.method}, confidence ${classification.confidence}) affecting "${service.name}".`,
        meta: {
          matchedKeywords: classification.matchedKeywords,
          businessCriticality,
          sla: { response: deadlines.policy.responseMinutes, resolution: deadlines.policy.resolutionMinutes },
        },
      },
      notify: { serviceName: service.name },
    });

    /* --- tasks 7 & 8: identify suitable technicians and assign --- */
    if (input.autoAssign !== false) {
      try {
        await this.assign(incident, { strategy: input.assignmentStrategy || 'composite', actor });
      } catch (err) {
        // A busy desk must never block intake: keep the incident queued for triage.
        incident.status = STATUS.CLASSIFIED;
        await incident.save();
        await eventBus.publishAsync('incident.assignment_failed', {
          incident,
          actor,
          changes: { from: STATUS.CLASSIFIED, to: STATUS.CLASSIFIED },
          record: {
            action: 'ASSIGNMENT_FAILED',
            category: 'assignment',
            description: `Automatic assignment failed: ${err.message}. The incident is queued for manual dispatch.`,
          },
          silent: true,
        });
      }
    }

    return this.getById(incident._id);
  }

  /** Re-run classification, optionally with an explicit category/service. */
  async reclassify(id, payload = {}, actor = null) {
    const incident = await this.load(id);
    const previousCategory = incident.category;

    let service = null;
    if (payload.service || payload.affectedService) {
      service = await repos.services.findById(validate.objectId(payload.service || payload.affectedService, 'service'));
      if (!service) throw AppError.notFound('Affected service not found', 'SERVICE_NOT_FOUND');
    }

    let category = payload.category ? validate.category(payload.category, 'category') : null;
    let method = 'manual';
    let matchedKeywords = [];
    let confidence = 1;

    if (!category) {
      const result = await classificationService.classify({
        title: incident.title,
        description: incident.description,
        service,
      });
      category = result.category;
      method = result.method;
      matchedKeywords = result.matchedKeywords;
      confidence = result.confidence;
      if (!service) service = result.service;
    }

    incident.category = category;
    incident.classification = { method, confidence, matchedKeywords };
    if (service) incident.affectedService = service._id;
    await incident.save();

    await eventBus.publishAsync(EVENTS.INCIDENT_CLASSIFIED, {
      incident,
      actor,
      changes: { from: incident.status, to: incident.status },
      record: {
        action: 'INCIDENT_RECLASSIFIED',
        category: 'lifecycle',
        description: `Category changed from ${previousCategory} to ${category}.`,
        meta: { previousCategory, matchedKeywords },
      },
      notify: { serviceName: service?.name },
    });

    return this.getById(incident._id);
  }

  /** Task 7 - shortlist of suitable technicians (without assigning). */
  async candidatesFor(id, strategyName = 'composite') {
    const incident = await this.load(id, { populate: true });
    const service = await assignmentService.resolveService(incident);
    const ranked = await assignmentService.candidates(incident, service, strategyName);
    return { incident: this.summarise(incident), strategy: strategyName, candidates: ranked };
  }

  /** Task 8 - assign (auto or manual) and announce it. */
  async assign(idOrIncident, { technicianId = null, strategy = 'composite', actor = null } = {}) {
    const incident = idOrIncident && idOrIncident._id && idOrIncident.save
      ? idOrIncident
      : await this.load(idOrIncident);

    if (IncidentStateMachine.isTerminal(incident.status)) {
      throw AppError.businessRule(`An incident in status ${incident.status} can no longer be assigned`, 'INCIDENT_TERMINAL');
    }

    const previousState = incident.status;
    const result = await assignmentService.assign(incident, { technicianId, strategy });

    await eventBus.publishAsync(EVENTS.INCIDENT_ASSIGNED, {
      incident,
      actor,
      changes: { from: previousState, to: STATUS.ASSIGNED },
      record: {
        action: 'INCIDENT_ASSIGNED',
        category: 'assignment',
        description: `Assigned to ${result.technician.name} using the ${result.strategy} strategy${result.score ? ` (fit score ${result.score})` : ''}.`,
        meta: { strategy: result.strategy, score: result.score, reasons: result.reasons },
      },
      notify: { technicianName: result.technician.name, strategy: result.strategy },
    });

    return this.getById(incident._id);
  }

  /** Tasks 10 & 13 - drive the lifecycle state machine. */
  async changeStatus(id, payload = {}, actor = null) {
    const incident = await this.load(id);
    if (!incident) throw AppError.notFound('Incident not found', 'INCIDENT_NOT_FOUND');

    const target = validate.status(payload.status, 'status');
    const previousState = incident.status;
    IncidentStateMachine.assertTransition(previousState, target);

    const now = new Date();
    const note = validate.optionalString(payload.note, 'Note', { max: 2000 });
    let resolutionRecorded = false;

    switch (target) {
      case STATUS.ACKNOWLEDGED:
        if (!incident.sla.firstResponseAt) incident.sla.firstResponseAt = now;
        break;

      case STATUS.IN_PROGRESS:
        if (!incident.sla.firstResponseAt) incident.sla.firstResponseAt = now;
        if (!incident.investigation.startedAt) incident.investigation.startedAt = now;
        break;

      case STATUS.RESOLVED: {
        const resolution = payload.resolution || {};
        incident.resolution = {
          summary: validate.requiredString(resolution.summary || payload.summary, 'Resolution summary', { max: 2000 }),
          rootCause: validate.optionalString(resolution.rootCause || payload.rootCause, 'Root cause', { max: 2000 }),
          actionTaken: validate.optionalString(resolution.actionTaken || payload.actionTaken, 'Action taken', { max: 2000 }),
          resolvedBy: actor?._id || null,
          resolvedAt: now,
        };
        incident.sla.resolvedAt = now;
        if (!incident.sla.firstResponseAt) incident.sla.firstResponseAt = now;
        resolutionRecorded = true;
        break;
      }

      case STATUS.VERIFIED:
        incident.closure.verificationNote = validate.optionalString(
          payload.verificationNote || note,
          'Verification note',
          { max: 2000 }
        );
        break;

      case STATUS.CLOSED:
        incident.closure = {
          closedBy: actor?._id || null,
          closedAt: now,
          closureCode: validate.optionalString(payload.closureCode || 'RESOLVED_CONFIRMED', 'Closure code', { max: 60 }),
          notes: note,
          verificationNote: validate.optionalString(payload.verificationNote || incident.closure?.verificationNote, 'Verification note', { max: 2000 }),
        };
        incident.sla.closedAt = now;
        break;

      default:
        break;
    }

    if (note && target !== STATUS.CLOSED) {
      incident.investigation.notes.push({ author: actor?._id || null, body: note, createdAt: now });
    }

    // Re-evaluate SLA flags against the new state (task 11).
    slaService.refresh(incident, now);
    incident.status = target;
    await incident.save();

    if (resolutionRecorded) {
      await assignmentService.recordResolution(incident);
      await assignmentService.releaseWorkload(incident);
    }

    const eventName = STATUS_EVENTS[target];
    await eventBus.publishAsync(eventName || EVENTS.INCIDENT_STATUS_CHANGED, {
      incident,
      actor,
      changes: { from: previousState, to: target },
      record: {
        action: `STATUS_${target}`,
        category: target === 'CLOSED' ? 'lifecycle' : 'lifecycle',
        description: `${incident.incidentId}: ${previousState} -> ${target}${note ? ` (${note})` : ''}.`,
        meta: {
          previousState,
          newState: target,
          resolution: incident.resolution?.summary || undefined,
          sla: this.slaSnapshot(incident, now),
        },
      },
      notify: {},
    });

    return this.getById(incident._id);
  }

  /** Task 10 - investigation notes (also records the first technician response). */
  async addNote(id, payload = {}, actor = null) {
    const incident = await this.load(id);
    const body = validate.requiredString(payload.body || payload.note, 'Note', { max: 2000 });

    incident.investigation.notes.push({ author: actor?._id || null, body, createdAt: new Date() });
    if (actor?.role === ROLES.TECHNICIAN && !incident.sla.firstResponseAt) {
      incident.sla.firstResponseAt = new Date();
    }
    await incident.save();

    const audience = actor?.role === ROLES.EMPLOYEE ? ['technician', 'admins'] : ['reporter'];

    await eventBus.publishAsync(EVENTS.INCIDENT_COMMENTED, {
      incident,
      actor,
      changes: { from: incident.status, to: incident.status },
      record: {
        action: 'COMMENT_ADDED',
        category: 'comment',
        description: `${actor?.name || 'A user'} added a note: ${body.slice(0, 180)}`,
      },
      notify: { message: body.slice(0, 200), notify: audience },
    });

    return this.getById(incident._id);
  }

  /** Task 5 - re-assess impact/urgency and recompute priority (+ SLA window). */
  async setPriority(id, payload = {}, actor = null) {
    const incident = await this.load(id);

    const impact = payload.impact ? validate.level(payload.impact, 'Impact') : incident.impact;
    const urgency = payload.urgency ? validate.level(payload.urgency, 'Urgency') : incident.urgency;
    const businessCriticality = payload.businessCriticality
      ? validate.level(payload.businessCriticality, 'Business criticality')
      : incident.businessCriticality;
    const affectedUsers = payload.affectedUsers === undefined
      ? incident.affectedUsers
      : validate.positiveInt(payload.affectedUsers, 'Affected users', { min: 1, fallback: incident.affectedUsers });

    const service = await assignmentService.resolveService(incident);
    const result = this.priorityContext
      .setStrategy(payload.strategy || incident.priorityStrategy || 'weighted-score')
      .calculate({ impact, urgency, businessCriticality, affectedUsers, service });

    const previousPriority = incident.priority;
    incident.impact = impact;
    incident.urgency = urgency;
    incident.businessCriticality = businessCriticality;
    incident.affectedUsers = affectedUsers;
    incident.priority = result.priority;
    incident.priorityScore = result.score;
    incident.priorityStrategy = result.strategy;

    if (previousPriority !== result.priority) {
      // Rebase the SLA window on the new priority from the original report time.
      const deadlines = await slaService.computeDeadlines(result.priority, incident.createdAt);
      incident.sla.responseTarget = deadlines.responseTarget;
      incident.sla.resolutionTarget = deadlines.resolutionTarget;
      incident.sla.responseDueAt = deadlines.responseTarget;
      incident.sla.resolutionDueAt = deadlines.resolutionTarget;
      incident.sla.approachingNotified = false;
      incident.sla.violationNotified = false;
    }
    slaService.refresh(incident, new Date());
    await incident.save();

    await eventBus.publishAsync(EVENTS.INCIDENT_PRIORITY_CHANGED, {
      incident,
      actor,
      changes: { from: previousPriority, to: result.priority },
      record: {
        action: previousPriority === result.priority ? 'PRIORITY_REASSESSED' : 'PRIORITY_CHANGED',
        category: 'lifecycle',
        description:
          previousPriority === result.priority
            ? `Priority re-assessed and confirmed as ${result.priority} (score ${result.score}).`
            : `Priority changed from ${previousPriority} to ${result.priority} (score ${result.score}).`,
        meta: { previousPriority, score: result.score, reasons: result.reasons },
      },
      notify: { previous: previousPriority },
      silent: previousPriority === result.priority,
    });

    return this.getById(incident._id);
  }

  /** Post-resolution feedback from the reporter. */
  async submitFeedback(id, payload = {}, actor = null) {
    const incident = await this.load(id);
    if (!['RESOLVED', 'VERIFIED', 'CLOSED'].includes(incident.status)) {
      throw AppError.businessRule('Feedback can only be provided once the incident has been resolved', 'FEEDBACK_NOT_ALLOWED');
    }

    incident.feedback = {
      rating: validate.positiveInt(payload.rating, 'Rating', { min: 1, max: 5 }),
      comment: validate.optionalString(payload.comment, 'Comment', { max: 1000 }),
      submittedAt: new Date(),
    };
    await incident.save();

    await eventBus.publishAsync(EVENTS.INCIDENT_COMMENTED, {
      incident,
      actor,
      changes: { from: incident.status, to: incident.status },
      record: {
        action: 'FEEDBACK_RECEIVED',
        category: 'comment',
        description: `${actor?.name || 'The reporter'} rated the resolution ${incident.feedback.rating}/5.`,
      },
      notify: {
        message: `${incident.incidentId} received a ${incident.feedback.rating}/5 satisfaction rating.`,
        notify: ['technician', 'admins'],
      },
    });

    return this.getById(incident._id);
  }

  /** Task 11 - current SLA position for one incident. */
  async slaStatus(id) {
    const incident = await this.load(id, { populate: true });
    const now = new Date();
    const evaluation = slaService.evaluate(incident, now);
    const policy = await slaService.policy(incident.priority);
    return {
      incident: this.summarise(incident),
      policy,
      evaluation,
      targets: {
        responseDueAt: incident.sla.responseDueAt,
        resolutionDueAt: incident.sla.resolutionDueAt,
        firstResponseAt: incident.sla.firstResponseAt,
        resolvedAt: incident.sla.resolvedAt,
      },
    };
  }

  /* ---------------------------------------------------------------- helpers */

  /**
   * Load by ObjectId or by the human readable ticket id (INC-1001).
   * `populate` should be false for mutations so references stay as ids.
   */
  async load(id, { populate = false } = {}) {
    const value = String(id || '');
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(value);

    const incident = populate
      ? isObjectId
        ? await repos.incidents.findByIdPopulated(value)
        : await repos.incidents.findByTicketId(value)
      : isObjectId
        ? await repos.incidents.findById(value)
        : await repos.models.Incident.findOne({ incidentId: value });

    if (!incident) throw AppError.notFound('Incident not found', 'INCIDENT_NOT_FOUND');
    return incident;
  }

  /** Attach the derived SLA state so the UI does not have to recompute it. */
  decorate(incident, now = new Date()) {
    const evaluation = slaService.evaluate(incident, now);
    const obj = incident.toObject ? incident.toObject() : { ...incident };
    obj.slaStatus = evaluation.state;
    obj.slaEvaluation = evaluation;
    return obj;
  }

  summarise(incident) {
    const obj = incident.toObject ? incident.toObject() : incident;
    return {
      _id: obj._id,
      incidentId: obj.incidentId,
      title: obj.title,
      status: obj.status,
      priority: obj.priority,
      category: obj.category,
      assignedTechnician: obj.assignedTechnician,
    };
  }

  slaSnapshot(incident, now = new Date()) {
    const evaluation = slaService.evaluate(incident, now);
    return {
      state: evaluation.state,
      violated: evaluation.violated,
      atRisk: evaluation.atRisk,
      responseRemainingMinutes: evaluation.response.remainingMinutes,
      resolutionRemainingMinutes: evaluation.resolution.remainingMinutes,
    };
  }

  /** Employees only see their own tickets, technicians their queue. */
  scopeConditions(actor) {
    if (!actor || actor.role === ROLES.ADMIN) return [];
    if (actor.role === ROLES.TECHNICIAN) {
      return [{ $or: [{ assignedTechnician: actor._id }, { reporter: actor._id }] }];
    }
    return [{ reporter: actor._id }];
  }

  /** Translate a requested SLA filter into query conditions. */
  slaConditions(slaStatus) {
    const now = new Date();
    const open = { $nin: ['RESOLVED', 'VERIFIED', 'CLOSED'] };

    if (slaStatus === 'BREACHED') {
      return [
        {
          $or: [
            { 'sla.violated': true },
            { status: open, 'sla.resolutionDueAt': { $ne: null, $lt: now } },
          ],
        },
      ];
    }

    if (slaStatus === 'AT_RISK') {
      // At risk = more than 75% of the resolution window has elapsed.
      const conditions = PRIORITIES.map((priority) => {
        const window = SLA_POLICIES[priority].resolutionMinutes * 60000;
        return {
          priority,
          status: open,
          'sla.resolutionDueAt': { $gt: now, $lte: new Date(now.getTime() + window * 0.25) },
        };
      });
      return [{ $or: conditions }];
    }

    if (slaStatus === 'MET') {
      return [{ 'sla.resolvedAt': { $ne: null }, 'sla.violated': false }];
    }

    if (slaStatus === 'ON_TRACK') {
      return [
        {
          status: open,
          'sla.violated': false,
          $or: PRIORITIES.map((priority) => {
            const window = SLA_POLICIES[priority].resolutionMinutes * 60000;
            return {
              priority,
              'sla.resolutionDueAt': { $gt: new Date(now.getTime() + window * 0.25) },
            };
          }),
        },
      ];
    }

    throw AppError.badRequest(
      `Unknown SLA status "${slaStatus}". Use one of: ON_TRACK, AT_RISK, BREACHED, MET`,
      'VALIDATION_ERROR'
    );
  }
}

module.exports = new IncidentService();
