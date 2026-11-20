/**
 * Domain vocabulary shared by the UI.
 * Mirrors itsm-backend/constants/itsm.js so the client and the API agree on
 * statuses, transitions, categories and the priority formula.
 */

export const CATEGORIES = [
  'Hardware',
  'Software',
  'Network',
  'Database',
  'Cloud',
  'Security',
  'Authentication',
  'Application',
  'Storage',
];

export const LEVELS = ['Low', 'Medium', 'High', 'Critical'];

/** Numeric weight used by the priority formula (matches the backend RANK). */
export const LEVEL_RANK = { Low: 1, Medium: 2, High: 3, Critical: 4 };

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
export const PRIORITY_RANK = { P1: 0, P2: 1, P3: 2, P4: 3 };
export const PRIORITY_LABEL = { P1: 'Critical', P2: 'High', P3: 'Medium', P4: 'Low' };

export const STATUSES = [
  'NEW',
  'CLASSIFIED',
  'ASSIGNED',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'RESOLVED',
  'VERIFIED',
  'CLOSED',
];

export const STATUS_LABEL = {
  NEW: 'New',
  CLASSIFIED: 'Classified',
  ASSIGNED: 'Assigned',
  ACKNOWLEDGED: 'Acknowledged',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  VERIFIED: 'Verified',
  CLOSED: 'Closed',
};

export const STATUS_FLOW = {
  NEW: ['CLASSIFIED', 'CLOSED'],
  CLASSIFIED: ['ASSIGNED', 'CLOSED'],
  ASSIGNED: ['ACKNOWLEDGED', 'IN_PROGRESS'],
  ACKNOWLEDGED: ['IN_PROGRESS'],
  IN_PROGRESS: ['RESOLVED'],
  RESOLVED: ['VERIFIED', 'CLOSED'],
  VERIFIED: ['CLOSED'],
  CLOSED: [],
};

/** Which transitions each role is allowed to trigger from the drawer. */
const ROLE_STEPS = {
  admin: ['CLASSIFIED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'CLOSED'],
  technician: ['ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED'],
  employee: ['VERIFIED', 'CLOSED'],
};

export const CLOSED_STATUSES = ['RESOLVED', 'VERIFIED', 'CLOSED'];
export const OPEN_STATUSES = ['NEW', 'CLASSIFIED', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS'];

export const SLA_META = {
  ON_TRACK: { state: 'on-track', label: 'On track' },
  AT_RISK: { state: 'at-risk', label: 'At risk' },
  BREACHED: { state: 'violated', label: 'Breached' },
  MET: { state: 'met', label: 'Met' },
};

/** Priority Score = Impact x Urgency x Business Criticality (spec formula). */
export function priorityScore(impact, urgency, criticality = 'Medium') {
  return (LEVEL_RANK[impact] || 1) * (LEVEL_RANK[urgency] || 1) * (LEVEL_RANK[criticality] || 2);
}

/** Bands: >=40 P1, >=20 P2, >=8 P3, otherwise P4. */
export function scoreToPriority(score) {
  if (score >= 40) return 'P1';
  if (score >= 20) return 'P2';
  if (score >= 8) return 'P3';
  return 'P4';
}

export function predictPriority(impact, urgency, criticality) {
  return scoreToPriority(priorityScore(impact, urgency, criticality));
}

export function nextActions(role, status) {
  const allowed = new Set(ROLE_STEPS[role] || []);
  return (STATUS_FLOW[status] || []).filter((step) => step !== 'ASSIGNED' && allowed.has(step));
}

export function canAssign(role, status) {
  return role === 'admin' && !CLOSED_STATUSES.includes(status) && status !== 'ACKNOWLEDGED';
}

export function isClosed(status) {
  return CLOSED_STATUSES.includes(status);
}

export function refId(ref) {
  if (!ref) return '';
  return String(ref._id || ref);
}

export function formatDuration(ms) {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Fallback computation when the API did not decorate the incident. */
function deriveSlaCode(incident) {
  if (isClosed(incident.status)) return incident.sla?.violated ? 'BREACHED' : 'MET';
  const due = incident.sla?.resolutionDueAt;
  if (!due) return 'ON_TRACK';
  return new Date(due).getTime() < Date.now() ? 'BREACHED' : 'ON_TRACK';
}

/**
 * SLA badge for a ticket row. Open tickets are counted down from the
 * resolution deadline so the label ticks without a round trip; the server's
 * evaluated state is used once the ticket is closed.
 */
export function slaInfo(incident, now = Date.now()) {
  const due = incident.sla?.resolutionDueAt ? new Date(incident.sla.resolutionDueAt).getTime() : null;

  if (!isClosed(incident.status)) {
    if (!due) return { code: 'ON_TRACK', state: 'on-track', label: 'On track', remainingMinutes: null };
    const remainingMinutes = Math.round((due - now) / 60000);
    if (remainingMinutes < 0) {
      return {
        code: 'BREACHED',
        state: 'violated',
        label: `Overdue ${formatDuration(remainingMinutes * 60000)}`,
        remainingMinutes,
      };
    }
    const created = new Date(incident.createdAt || now).getTime();
    const window = Math.max(due - created, 1);
    const atRisk = (now - created) / window >= 0.75; // matches the backend threshold
    return {
      code: atRisk ? 'AT_RISK' : 'ON_TRACK',
      state: atRisk ? 'at-risk' : 'on-track',
      label: `${formatDuration(remainingMinutes * 60000)} left`,
      remainingMinutes,
    };
  }

  const code = incident.slaStatus || deriveSlaCode(incident);
  const meta = SLA_META[code] || { state: 'unknown', label: 'No SLA' };
  const remainingMinutes = incident.slaEvaluation?.resolution?.remainingMinutes ?? null;
  const label = code === 'BREACHED' && remainingMinutes != null
    ? `Overdue ${formatDuration(remainingMinutes * 60000)}`
    : meta.label;
  return { code, state: meta.state, label, remainingMinutes };
}

const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'unable', 'cannot',
  'into', 'your', 'are', 'was', 'not', 'user', 'users', 'after', 'when', 'does',
]);

function tokens(value) {
  return new Set(
    String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3 && !STOP.has(word))
  );
}

/** Lightweight duplicate detection while the reporter is typing. */
export function duplicateMatches(draft, incidents) {
  const words = tokens(draft);
  if (words.size < 2) return [];
  return incidents
    .map((incident) => {
      const known = tokens(`${incident.title} ${incident.description}`);
      let shared = 0;
      words.forEach((word) => {
        if (known.has(word)) shared += 1;
      });
      return { incident, score: shared / words.size };
    })
    .filter((match) => match.score >= 0.5 && !isClosed(match.incident.status))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export function formatWhen(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
