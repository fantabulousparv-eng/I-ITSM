/**
 * Server-Sent Events hub (Observer / push transport).
 *
 * Holds every open `/api/events` connection keyed by user id so the server
 * can push a notification to a single user, a set of users, or everyone.
 * This is the real-time leg of the notification system.
 */
class SseHub {
  constructor() {
    /** @type {Map<string, Set<import('express').Response>>} */
    this.clients = new Map();
  }

  add(userId, res) {
    const key = String(userId);
    if (!this.clients.has(key)) this.clients.set(key, new Set());
    this.clients.get(key).add(res);
    return () => this.remove(key, res);
  }

  remove(userId, res) {
    const key = String(userId);
    const set = this.clients.get(key);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this.clients.delete(key);
  }

  /** Send an event to every connection of one user. */
  sendToUser(userId, event, data) {
    const set = this.clients.get(String(userId));
    if (!set) return 0;
    const payload = format(event, data);
    let sent = 0;
    for (const res of set) {
      try {
        res.write(payload);
        sent += 1;
      } catch (_err) {
        this.remove(userId, res);
      }
    }
    return sent;
  }

  /** Send an event to a list of userIds (deduplicated). */
  sendToUsers(userIds, event, data) {
    return [...new Set(userIds.map(String))].reduce((n, id) => n + this.sendToUser(id, event, data), 0);
  }

  broadcast(event, data) {
    let sent = 0;
    for (const set of this.clients.values()) {
      for (const res of set) {
        try {
          res.write(format(event, data));
          sent += 1;
        } catch (_err) {
          /* connection is gone; cleaned up on close */
        }
      }
    }
    return sent;
  }

  get connectionCount() {
    return [...this.clients.values()].reduce((n, s) => n + s.size, 0);
  }
}

function format(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

module.exports = new SseHub();
