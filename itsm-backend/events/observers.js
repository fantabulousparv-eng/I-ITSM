const eventBus = require('../patterns/observer/EventBus');
const auditService = require('../services/auditService');
const notificationService = require('../services/notificationService');
const { EVENTS } = require('../constants/itsm');

/**
 * Observer pattern - concrete observers (task 9 notifications, task 12 audit).
 *
 * Nothing in the workflow code knows these exist: the incident service only
 * publishes semantic domain events, and every observer reacts independently.
 * Adding a new "reaction" (e.g. Slack, analytics warehouse) is a one-liner.
 */

/** Which audit action/category each domain event maps to by default. */
const AUDIT_HINTS = {
  [EVENTS.INCIDENT_CREATED]: { action: 'INCIDENT_CREATED', category: 'lifecycle' },
  [EVENTS.INCIDENT_CLASSIFIED]: { action: 'INCIDENT_CLASSIFIED', category: 'lifecycle' },
  [EVENTS.INCIDENT_PRIORITY_CHANGED]: { action: 'PRIORITY_CHANGED', category: 'lifecycle' },
  [EVENTS.INCIDENT_ASSIGNED]: { action: 'INCIDENT_ASSIGNED', category: 'assignment' },
  [EVENTS.INCIDENT_ACKNOWLEDGED]: { action: 'STATUS_ACKNOWLEDGED', category: 'lifecycle' },
  [EVENTS.INCIDENT_IN_PROGRESS]: { action: 'STATUS_IN_PROGRESS', category: 'lifecycle' },
  [EVENTS.INCIDENT_RESOLVED]: { action: 'STATUS_RESOLVED', category: 'lifecycle' },
  [EVENTS.INCIDENT_CLOSED]: { action: 'STATUS_CLOSED', category: 'lifecycle' },
  [EVENTS.INCIDENT_STATUS_CHANGED]: { action: 'STATUS_CHANGED', category: 'lifecycle' },
  [EVENTS.INCIDENT_COMMENTED]: { action: 'COMMENT_ADDED', category: 'comment' },
  [EVENTS.SLA_APPROACHING]: { action: 'SLA_AT_RISK', category: 'sla' },
  [EVENTS.SLA_VIOLATED]: { action: 'SLA_BREACHED', category: 'sla' },
};

function fallbackAction(eventName) {
  return String(eventName).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function defaultDescription(name, payload) {
  const ref = payload.incident?.incidentId || 'incident';
  const from = payload.changes?.from;
  const to = payload.changes?.to;
  if (from && to && from !== to) return `${ref}: ${from} -> ${to}`;
  return `${ref}: ${name}`;
}

/** Writes one immutable audit row per domain event (complete history). */
async function auditObserver(envelope) {
  const { name, payload } = envelope;
  const { incident, actor, changes, record } = payload;
  if (!incident) return;

  const hint = AUDIT_HINTS[name] || { action: fallbackAction(name), category: 'system' };

  await auditService.record({
    incident,
    actor,
    action: record?.action || hint.action,
    category: record?.category || hint.category,
    previousState: changes?.from ?? null,
    newState: changes?.to ?? null,
    description: record?.description || defaultDescription(name, payload),
    meta: record?.meta || {},
  });
}

/** Fans the event out to every configured notification channel. */
async function notificationObserver(envelope) {
  const { name, payload } = envelope;
  if (!payload.incident || payload.silent === true) return;
  await notificationService.dispatch(name, payload.incident, payload.notify || {});
}

/** Optional console trace, useful when demonstrating the observer chain. */
function logObserver(envelope) {
  const { name, payload } = envelope;
  const ref = payload.incident?.incidentId || '-';
  console.log(`[event] ${name} (${ref})`);
}

let registered = false;

/** Subscribe every observer. Safe to call more than once. */
function registerObservers({ verbose = false } = {}) {
  if (registered) return;
  registered = true;
  eventBus.on('domain-event', auditObserver);
  eventBus.on('domain-event', notificationObserver);
  if (verbose) eventBus.on('domain-event', logObserver);
}

module.exports = { registerObservers, auditObserver, notificationObserver };
