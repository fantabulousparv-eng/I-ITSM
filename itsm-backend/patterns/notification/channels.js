const fs = require('fs');
const path = require('path');
const sseHub = require('../../realtime/sseHub');
const { CHANNELS } = require('../../constants/itsm');

/**
 * Adapter pattern - each channel adapts the internal notification shape to a
 * concrete transport. The notification service only knows the Channel
 * interface, so transports can be swapped or extended (SMS, Slack, webhook)
 * without changing business logic.
 */
class NotificationChannel {
  constructor(name) {
    this.name = name;
  }

  // eslint-disable-next-line no-unused-vars
  async deliver(_notification, _recipient) {
    throw new Error(`deliver() not implemented for ${this.name}`);
  }
}

/** Persisted notification already stored by the service; this is a marker. */
class InAppChannel extends NotificationChannel {
  constructor() {
    super(CHANNELS.IN_APP);
  }

  async deliver() {
    return { channel: this.name, delivered: true };
  }
}

/** Pushes the notification live to any open browser tab of the recipient. */
class RealtimeChannel extends NotificationChannel {
  constructor() {
    super(CHANNELS.SSE);
  }

  async deliver(notification) {
    const sent = sseHub.sendToUser(notification.recipient, 'notification', {
      id: notification._id,
      event: notification.event,
      title: notification.title,
      message: notification.message,
      severity: notification.severity,
      incidentRef: notification.incidentRef,
      createdAt: notification.createdAt,
    });
    return { channel: this.name, delivered: sent > 0, connections: sent };
  }
}

/**
 * Simulated outbound e-mail/SMS adapter. Instead of a real SMTP/SMS gateway it
 * appends a rendered message to a log file so the flow is observable and
 * demonstrable without external credentials.
 */
class SimulatedOutboundChannel extends NotificationChannel {
  constructor() {
    super(CHANNELS.EMAIL);
    this.logFile = process.env.NOTIFICATION_LOG_FILE
      || path.join(process.cwd(), 'logs', 'notifications.log');
  }

  async deliver(notification, recipient) {
    const line = [
      `[${new Date().toISOString()}]`,
      `channel=${this.name}`,
      `to=${recipient?.email || 'unknown'} (${recipient?.name || 'unknown'})`,
      `event=${notification.event}`,
      `subject="${notification.title}"`,
      `body="${notification.message}"`,
      `incident=${notification.incidentRef}`,
    ].join(' ');
    try {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      fs.appendFileSync(this.logFile, `${line}\n`, 'utf8');
      return { channel: this.name, delivered: true };
    } catch (err) {
      // Notification delivery must never break the business transaction.
      return { channel: this.name, delivered: false, error: err.message };
    }
  }
}

/** Registry of available channels keyed by the CHANNELS constant. */
const channelRegistry = {
  [CHANNELS.IN_APP]: new InAppChannel(),
  [CHANNELS.SSE]: new RealtimeChannel(),
  [CHANNELS.EMAIL]: new SimulatedOutboundChannel(),
  [CHANNELS.DASHBOARD]: new InAppChannel(),
};

function getChannel(name) {
  return channelRegistry[name] || null;
}

module.exports = {
  NotificationChannel,
  InAppChannel,
  RealtimeChannel,
  SimulatedOutboundChannel,
  channelRegistry,
  getChannel,
};
