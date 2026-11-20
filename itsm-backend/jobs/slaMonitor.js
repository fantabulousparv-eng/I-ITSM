const repos = require('../repositories');
const slaService = require('../services/slaService');
const eventBus = require('../patterns/observer/EventBus');
const { EVENTS } = require('../constants/itsm');

/**
 * SLA compliance monitor (task 11).
 *
 * A lightweight scheduler sweeps every open incident, refreshes its SLA flags
 * and raises exactly one "approaching" and one "breached" domain event per
 * incident (guarded by the persisted notified flags, so no duplicate alerts).
 */
const OPEN_STATUSES = ['NEW', 'CLASSIFIED', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS'];

async function runOnce(now = new Date()) {
  const incidents = await repos.incidents.findAll({
    status: { $in: OPEN_STATUSES },
    'sla.resolutionDueAt': { $ne: null },
  });

  const summary = { scanned: incidents.length, atRisk: 0, breached: 0 };

  for (const incident of incidents) {
    const evaluation = slaService.evaluate(incident, now);
    const metric = evaluation.response.state === 'BREACHED' && evaluation.resolution.state !== 'BREACHED'
      ? 'response'
      : 'resolution';

    let changed = false;

    if (evaluation.violated && !incident.sla.violationNotified) {
      incident.sla.violationNotified = true;
      changed = true;
      summary.breached += 1;
      await eventBus.publishAsync(EVENTS.SLA_VIOLATED, {
        incident,
        changes: { from: incident.status, to: incident.status },
        record: {
          action: 'SLA_BREACHED',
          category: 'sla',
          description: `The ${metric} SLA for ${incident.incidentId} was breached (priority ${incident.priority}).`,
          meta: { metric, remainingMinutes: evaluation.resolution.remainingMinutes },
        },
        notify: { metric },
      });
    } else if (evaluation.atRisk && !incident.sla.approachingNotified) {
      incident.sla.approachingNotified = true;
      changed = true;
      summary.atRisk += 1;
      await eventBus.publishAsync(EVENTS.SLA_APPROACHING, {
        incident,
        changes: { from: incident.status, to: incident.status },
        record: {
          action: 'SLA_AT_RISK',
          category: 'sla',
          description: `The ${metric} SLA for ${incident.incidentId} is approaching its deadline (${evaluation.resolution.remainingMinutes} min left).`,
          meta: { metric, remainingMinutes: evaluation.resolution.remainingMinutes },
        },
        notify: { metric },
      });
    }

    slaService.refresh(incident, now);
    if (changed || incident.isModified()) await incident.save();
  }

  return summary;
}

/**
 * Start the periodic sweep. Returns a stop function.
 * `unref()` keeps the timer from holding the process open during tests.
 */
function start(intervalMs = Number(process.env.SLA_SWEEP_INTERVAL_MS) || 60000) {
  const timer = setInterval(() => {
    runOnce().catch((err) => console.error('[sla] sweep failed:', err.message));
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

module.exports = { runOnce, start };
