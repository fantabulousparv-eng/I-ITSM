const repos = require('../repositories');
const { NotificationFactory } = require('../patterns/notification/NotificationFactory');
const { getChannel } = require('../patterns/notification/channels');
const { ROLES } = require('../constants/itsm');

/**
 * Notification system (task 9).
 *
 * Two or more mechanisms are implemented:
 *   1. In-app  - persisted to MongoDB and shown in the notification centre.
 *   2. Realtime - pushed instantly over Server-Sent Events.
 *   3. Email   - simulated outbound adapter that writes to a log file.
 */
class NotificationService {
  /** Resolve audience tokens to a de-duplicated list of user ids. */
  async resolveAudience(tokens, incident) {
    const ids = new Set();
    const reporterId = incident.reporter?._id || incident.reporter;
    const techId = incident.assignedTechnician?._id || incident.assignedTechnician;

    for (const token of tokens) {
      if (token === 'reporter' && reporterId) ids.add(String(reporterId));
      if (token === 'technician' && techId) ids.add(String(techId));
      if (token === 'admins') {
        const admins = await repos.users.findAll({ role: ROLES.ADMIN, active: true });
        admins.forEach((a) => ids.add(String(a._id)));
      }
    }
    return [...ids];
  }

  /**
   * Build, persist and dispatch a notification for a domain event.
   * Never throws - notification failures must not roll back business logic.
   */
  async dispatch(event, incident, extra = {}) {
    try {
      const definition = NotificationFactory.create(event, incident, extra);
      const recipientIds = await this.resolveAudience(definition.audience, incident);
      if (!recipientIds.length) return [];

      const recipients = await repos.users.findByIds(recipientIds);
      const created = [];

      for (const recipient of recipients) {
        const notification = await repos.notifications.create({
          recipient: recipient._id,
          incident: incident._id,
          incidentRef: incident.incidentId,
          event,
          severity: definition.severity,
          title: definition.title,
          message: definition.message,
          channels: definition.channels,
          meta: { ...extra, audience: definition.audience },
        });

        for (const channelName of definition.channels) {
          const channel = getChannel(channelName);
          if (!channel) continue;
          // The in-app record is already persisted above.
          if (channel.name === 'in_app' || channel.name === 'dashboard') continue;
          // eslint-disable-next-line no-await-in-loop
          await channel.deliver(notification, recipient);
        }
        created.push(notification);
      }
      return created;
    } catch (err) {
      console.error('[notifications] dispatch failed:', err.message);
      return [];
    }
  }

  async listForUser(userId, options) {
    return repos.notifications.findForUser(userId, options);
  }

  async unreadCount(userId) {
    return repos.notifications.unreadCount(userId);
  }

  async markRead(userId, notificationId) {
    const notification = await repos.notifications.findById(notificationId);
    if (!notification || String(notification.recipient) !== String(userId)) return null;
    notification.read = true;
    notification.readAt = new Date();
    await notification.save();
    return notification;
  }

  async markAllRead(userId) {
    await repos.models.Notification.updateMany(
      { recipient: userId, read: false },
      { $set: { read: true, readAt: new Date() } }
    );
    return { ok: true };
  }
}

module.exports = new NotificationService();
