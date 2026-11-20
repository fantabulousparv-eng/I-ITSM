const repos = require('../repositories');
const { SLA_POLICIES, SLA_STATE, SLA_AT_RISK_THRESHOLD } = require('../constants/itsm');

const MINUTE = 60 * 1000;

/**
 * SLA management (tasks 6 & 11).
 * Turns a priority into concrete response/resolution deadlines, then tracks
 * whether those deadlines are on track, at risk, met or breached.
 */
class SlaService {
  constructor() {
    this.cache = new Map();
  }

  /** Load the SLA policy for a priority (DB first, constants as fallback). */
  async policy(priority) {
    if (this.cache.has(priority)) return this.cache.get(priority);
    let policy = null;
    try {
      const doc = await repos.models.SlaPolicy.findOne({ priority, active: true }).lean();
      if (doc) {
        policy = {
          priority: doc.priority,
          label: doc.label,
          responseMinutes: doc.responseMinutes,
          resolutionMinutes: doc.resolutionMinutes,
          warnAtFraction: doc.warnAtFraction ?? SLA_AT_RISK_THRESHOLD,
        };
      }
    } catch (_err) {
      policy = null;
    }
    if (!policy) policy = { ...SLA_POLICIES[priority], warnAtFraction: SLA_AT_RISK_THRESHOLD };
    this.cache.set(priority, policy);
    return policy;
  }

  invalidateCache() {
    this.cache.clear();
  }

  /** Compute the response and resolution deadlines for a new incident. */
  async computeDeadlines(priority, from = new Date()) {
    const policy = await this.policy(priority);
    const base = new Date(from).getTime();
    return {
      policy,
      responseTarget: new Date(base + policy.responseMinutes * MINUTE),
      resolutionTarget: new Date(base + policy.resolutionMinutes * MINUTE),
    };
  }

  /**
   * Evaluate an incident's SLA position at a point in time.
   * `state` is the overall status (worst of response/resolution).
   */
  evaluate(incident, now = new Date()) {
    const sla = incident.sla || {};
    const createdAt = incident.createdAt ? new Date(incident.createdAt).getTime() : null;
    const responseDueAt = sla.responseDueAt ? new Date(sla.responseDueAt).getTime() : null;
    const resolutionDueAt = sla.resolutionDueAt ? new Date(sla.resolutionDueAt).getTime() : null;
    const firstResponseAt = sla.firstResponseAt ? new Date(sla.firstResponseAt).getTime() : null;
    const resolvedAt = sla.resolvedAt ? new Date(sla.resolvedAt).getTime() : null;
    const isClosed = ['RESOLVED', 'VERIFIED', 'CLOSED'].includes(incident.status);

    const response = this.#metricState({
      due: responseDueAt,
      completedAt: firstResponseAt,
      startedAt: createdAt,
      done: Boolean(firstResponseAt),
      isFinal: isClosed,
      now,
    });
    const resolution = this.#metricState({
      due: resolutionDueAt,
      completedAt: resolvedAt,
      startedAt: createdAt,
      done: Boolean(resolvedAt),
      isFinal: isClosed,
      now,
    });

    const order = { [SLA_STATE.MET]: 0, [SLA_STATE.ON_TRACK]: 1, [SLA_STATE.AT_RISK]: 2, [SLA_STATE.BREACHED]: 3 };
    const state = order[response.state] >= order[resolution.state] ? response.state : resolution.state;

    return {
      response,
      resolution,
      state,
      violated: response.state === SLA_STATE.BREACHED || resolution.state === SLA_STATE.BREACHED,
      atRisk: response.state === SLA_STATE.AT_RISK || resolution.state === SLA_STATE.AT_RISK,
    };
  }

  #metricState({ due, completedAt, startedAt, done, isFinal, now }) {
    const nowMs = new Date(now).getTime();
    if (due == null) return { state: SLA_STATE.ON_TRACK, remainingMinutes: null, elapsedFraction: 0 };

    const window = due - startedAt;
    if (done) {
      const within = completedAt <= due;
      return {
        state: within ? SLA_STATE.MET : SLA_STATE.BREACHED,
        remainingMinutes: Math.round((due - completedAt) / 60000),
        elapsedFraction: window > 0 ? Math.min(1.5, (completedAt - startedAt) / window) : 0,
        completedAt: new Date(completedAt),
      };
    }

    if (isFinal) {
      // Terminal without the milestone being achieved counts as a breach.
      return { state: SLA_STATE.BREACHED, remainingMinutes: Math.round((due - nowMs) / 60000), elapsedFraction: 1 };
    }

    if (nowMs > due) {
      return {
        state: SLA_STATE.BREACHED,
        remainingMinutes: Math.round((due - nowMs) / 60000),
        elapsedFraction: window > 0 ? (nowMs - startedAt) / window : 1,
      };
    }

    const fraction = window > 0 ? (nowMs - startedAt) / window : 0;
    return {
      state: fraction >= SLA_AT_RISK_THRESHOLD ? SLA_STATE.AT_RISK : SLA_STATE.ON_TRACK,
      remainingMinutes: Math.round((due - nowMs) / 60000),
      elapsedFraction: fraction,
    };
  }

  /**
   * Refresh the persisted breach/at-risk flags for an incident.
   * Returns a summary so callers can raise SLA domain events.
   */
  refresh(incident, now = new Date()) {
    const evaluation = this.evaluate(incident, now);
    incident.sla.responseBreached = evaluation.response.state === SLA_STATE.BREACHED;
    incident.sla.resolutionBreached = evaluation.resolution.state === SLA_STATE.BREACHED;
    incident.sla.violated = evaluation.violated;
    return evaluation;
  }
}

module.exports = new SlaService();
