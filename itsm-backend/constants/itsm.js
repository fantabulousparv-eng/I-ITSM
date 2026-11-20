/**
 * Central domain constants for the ITSM system.
 * Keeping them in one place makes the business rules reusable by the
 * front-end (mirrored in itsm-frontend/src/lib/incident.js) and testable.
 */

const ROLES = Object.freeze({
  EMPLOYEE: 'employee',
  TECHNICIAN: 'technician',
  ADMIN: 'admin',
});

const ROLE_VALUES = Object.values(ROLES);

/** Numeric weight used by the priority scoring formula. */
const RANK = Object.freeze({ Low: 1, Medium: 2, High: 3, Critical: 4 });
const LEVELS = Object.freeze(['Low', 'Medium', 'High', 'Critical']);

const CATEGORIES = Object.freeze([
  'Hardware',
  'Software',
  'Network',
  'Database',
  'Cloud',
  'Security',
  'Authentication',
  'Application',
  'Storage',
]);

const STATUS = Object.freeze({
  NEW: 'NEW',
  CLASSIFIED: 'CLASSIFIED',
  ASSIGNED: 'ASSIGNED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  VERIFIED: 'VERIFIED',
  CLOSED: 'CLOSED',
});

const STATUS_VALUES = Object.values(STATUS);

/** Allowed lifecycle transitions (State pattern source of truth). */
const STATUS_FLOW = Object.freeze({
  NEW: ['CLASSIFIED', 'CLOSED'],
  CLASSIFIED: ['ASSIGNED', 'CLOSED'],
  ASSIGNED: ['ACKNOWLEDGED', 'IN_PROGRESS'],
  ACKNOWLEDGED: ['IN_PROGRESS'],
  IN_PROGRESS: ['RESOLVED'],
  RESOLVED: ['VERIFIED', 'CLOSED'],
  VERIFIED: ['CLOSED'],
  CLOSED: [],
});

const PRIORITIES = Object.freeze(['P1', 'P2', 'P3', 'P4']);

/** SLA targets in minutes (from the project specification). */
const SLA_POLICIES = Object.freeze({
  P1: { priority: 'P1', label: 'Critical', responseMinutes: 5, resolutionMinutes: 30 },
  P2: { priority: 'P2', label: 'High', responseMinutes: 15, resolutionMinutes: 120 },
  P3: { priority: 'P3', label: 'Medium', responseMinutes: 60, resolutionMinutes: 480 },
  P4: { priority: 'P4', label: 'Low', responseMinutes: 240, resolutionMinutes: 1440 },
});

/**
 * Priority bands applied to score = impact * urgency * businessCriticality
 * score ranges from 1 (1*1*1) to 64 (4*4*4).
 */
const PRIORITY_BANDS = Object.freeze([
  { min: 40, priority: 'P1' },
  { min: 20, priority: 'P2' },
  { min: 8, priority: 'P3' },
  { min: 0, priority: 'P4' },
]);

/** Domain events emitted onto the observer bus. */
const EVENTS = Object.freeze({
  INCIDENT_CREATED: 'incident.created',
  INCIDENT_CLASSIFIED: 'incident.classified',
  INCIDENT_PRIORITY_CHANGED: 'incident.priority_changed',
  INCIDENT_ASSIGNED: 'incident.assigned',
  INCIDENT_ACKNOWLEDGED: 'incident.acknowledged',
  INCIDENT_IN_PROGRESS: 'incident.in_progress',
  INCIDENT_RESOLVED: 'incident.resolved',
  INCIDENT_CLOSED: 'incident.closed',
  INCIDENT_STATUS_CHANGED: 'incident.status_changed',
  INCIDENT_COMMENTED: 'incident.commented',
  SLA_APPROACHING: 'sla.approaching',
  SLA_VIOLATED: 'sla.violated',
});

/** Notification channels (at least two are implemented). */
const CHANNELS = Object.freeze({
  IN_APP: 'in_app', // persisted to the DB, shown in the UI bell
  SSE: 'realtime', // pushed live over Server-Sent Events
  EMAIL: 'email', // simulated: rendered to a log file
  DASHBOARD: 'dashboard',
});

const SLA_STATE = Object.freeze({
  MET: 'MET',
  ON_TRACK: 'ON_TRACK',
  AT_RISK: 'AT_RISK',
  BREACHED: 'BREACHED',
});

/** Fraction of the SLA window elapsed when a ticket becomes "at risk". */
const SLA_AT_RISK_THRESHOLD = 0.75;

function rankOf(level) {
  return RANK[level] || 0;
}

/** Map a raw score to a priority band. */
function scoreToPriority(score) {
  const band = PRIORITY_BANDS.find((b) => score >= b.min);
  return band ? band.priority : 'P4';
}

module.exports = {
  ROLES,
  ROLE_VALUES,
  RANK,
  LEVELS,
  CATEGORIES,
  STATUS,
  STATUS_VALUES,
  STATUS_FLOW,
  PRIORITIES,
  SLA_POLICIES,
  PRIORITY_BANDS,
  EVENTS,
  CHANNELS,
  SLA_STATE,
  SLA_AT_RISK_THRESHOLD,
  rankOf,
  scoreToPriority,
};
