const { EVENTS, CHANNELS } = require('../../constants/itsm');

/**
 * Factory pattern - turns a domain event into a concrete notification
 * definition. Centralising the copy + routing means new event types can be
 * added without touching the notifying code.
 *
 * A definition is: { title, message, severity, audience[], channels[] }
 * where audience tokens are resolved to users by the notification service.
 */
const DEFAULT_CHANNELS = [CHANNELS.IN_APP, CHANNELS.SSE];
const IMPORTANT_CHANNELS = [CHANNELS.IN_APP, CHANNELS.SSE, CHANNELS.EMAIL];

class NotificationDefinition {
  constructor({ title, message, severity, audience, channels }) {
    this.title = title;
    this.message = message;
    this.severity = severity;
    this.audience = audience;
    this.channels = channels;
  }
}

class NotificationFactory {
  static create(event, incident, extra = {}) {
    const build = NotificationFactory.templates[event] || NotificationFactory.fallback;
    const def = build(incident, extra);
    return new NotificationDefinition({
      channels: DEFAULT_CHANNELS,
      audience: ['reporter'],
      severity: 'info',
      ...def,
    });
  }
}

NotificationFactory.fallback = (incident, extra) => ({
  title: `Update on ${incident.incidentId}`,
  message: extra.message || `Incident ${incident.incidentId} was updated.`,
  severity: 'info',
  audience: ['reporter', 'technician'],
});

NotificationFactory.templates = {
  [EVENTS.INCIDENT_CREATED]: (incident) => ({
    title: `New incident logged: ${incident.incidentId}`,
    message: `"${incident.title}" was reported and is awaiting triage (priority ${incident.priority}).`,
    severity: 'info',
    audience: ['reporter', 'admins'],
  }),

  [EVENTS.INCIDENT_CLASSIFIED]: (incident, extra) => ({
    title: `Incident ${incident.incidentId} classified`,
    message: `Classified as ${incident.category} affecting ${extra.serviceName || 'the reported service'}.`,
    severity: 'info',
    audience: ['reporter'],
  }),

  [EVENTS.INCIDENT_PRIORITY_CHANGED]: (incident, extra) => ({
    title: `Priority changed on ${incident.incidentId}`,
    message: `Priority is now ${incident.priority} (was ${extra.previous}).`,
    severity: incident.priority === 'P1' ? 'critical' : 'warning',
    audience: ['reporter', 'technician', 'admins'],
    channels: IMPORTANT_CHANNELS,
  }),

  [EVENTS.INCIDENT_ASSIGNED]: (incident, extra) => ({
    title: `Incident ${incident.incidentId} assigned`,
    message: `Assigned to ${extra.technicianName || 'a technician'} using the ${extra.strategy || 'automatic'} strategy.`,
    severity: 'info',
    audience: ['reporter', 'technician', 'admins'],
  }),

  [EVENTS.INCIDENT_ACKNOWLEDGED]: (incident) => ({
    title: `Incident ${incident.incidentId} acknowledged`,
    message: `A technician has acknowledged your incident and will begin work shortly.`,
    severity: 'info',
    audience: ['reporter'],
  }),

  [EVENTS.INCIDENT_IN_PROGRESS]: (incident) => ({
    title: `Investigation started on ${incident.incidentId}`,
    message: `Work has started on your incident.`,
    severity: 'info',
    audience: ['reporter'],
  }),

  [EVENTS.INCIDENT_RESOLVED]: (incident) => ({
    title: `Incident ${incident.incidentId} resolved`,
    message: `Your incident has been resolved. ${incident.resolution?.summary || ''}`.trim(),
    severity: 'success',
    audience: ['reporter', 'admins'],
  }),

  [EVENTS.INCIDENT_CLOSED]: (incident) => ({
    title: `Incident ${incident.incidentId} closed`,
    message: `The incident is now closed. Thank you for using the service desk.`,
    severity: 'success',
    audience: ['reporter', 'technician'],
  }),

  [EVENTS.INCIDENT_COMMENTED]: (incident, extra) => ({
    title: `New update on ${incident.incidentId}`,
    message: extra.message || `A new comment was added to ${incident.incidentId}.`,
    severity: 'info',
    audience: extra.notify || ['reporter', 'technician'],
  }),

  [EVENTS.SLA_APPROACHING]: (incident, extra) => ({
    title: `SLA warning: ${incident.incidentId}`,
    message: `The ${extra.metric || 'resolution'} SLA for ${incident.incidentId} is approaching its deadline.`,
    severity: 'warning',
    audience: ['technician', 'admins'],
    channels: IMPORTANT_CHANNELS,
  }),

  [EVENTS.SLA_VIOLATED]: (incident, extra) => ({
    title: `SLA breached: ${incident.incidentId}`,
    message: `The ${extra.metric || 'resolution'} SLA for ${incident.incidentId} has been breached.`,
    severity: 'critical',
    audience: ['technician', 'admins'],
    channels: IMPORTANT_CHANNELS,
  }),
};

module.exports = { NotificationFactory, NotificationDefinition };
