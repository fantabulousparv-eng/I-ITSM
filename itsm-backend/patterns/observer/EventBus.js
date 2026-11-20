const { EventEmitter } = require('events');

/**
 * Domain event bus (Observer pattern - subject).
 *
 * Services publish semantic events ("an incident was resolved") without
 * knowing who reacts. Observers (AuditObserver, NotificationObserver,
 * SLAObserver) subscribe to `domain-event` and act independently.
 */
class DomainEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  /**
   * @param {string} name    event name from constants.EVENTS
   * @param {object} payload { incident, actor, changes, extra, ip }
   */
  publish(name, payload = {}) {
    const envelope = { name, payload, at: new Date() };
    this.emit(name, envelope);
    this.emit('domain-event', envelope);
    return envelope;
  }

  /**
   * Like publish() but waits for every observer to settle before resolving.
   * Used by the incident service so the audit trail and notifications are
   * written before the HTTP response is returned, while observers stay
   * completely decoupled from the publisher.
   */
  async publishAsync(name, payload = {}) {
    const envelope = { name, payload, at: new Date() };
    const handlers = [...this.listeners(name), ...this.listeners('domain-event')];
    const results = await Promise.allSettled(handlers.map((handler) => handler(envelope)));
    results
      .filter((r) => r.status === 'rejected')
      .forEach((r) => console.error(`[events] observer failed for ${name}:`, r.reason?.message));
    return envelope;
  }
}

module.exports = new DomainEventBus();
