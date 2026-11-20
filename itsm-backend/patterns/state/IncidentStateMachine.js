const { STATUS_FLOW } = require('../../constants/itsm');
const AppError = require('../../utils/AppError');

/**
 * State pattern - the incident lifecycle.
 *
 * Encapsulates which transitions are legal so no caller can move an incident
 * into an invalid state (e.g. NEW -> RESOLVED).
 *
 *   NEW -> CLASSIFIED -> ASSIGNED -> ACKNOWLEDGED -> IN_PROGRESS
 *        -> RESOLVED -> VERIFIED -> CLOSED
 *   plus NEW -> CLOSED (reported in error / cancelled)
 */
class IncidentStateMachine {
  static allowedFrom(status) {
    return STATUS_FLOW[status] || [];
  }

  static canTransition(from, to) {
    if (from === to) return false;
    return this.allowedFrom(from).includes(to);
  }

  static assertTransition(from, to) {
    if (!this.canTransition(from, to)) {
      throw AppError.businessRule(
        `Invalid state transition from ${from} to ${to}`,
        'INVALID_STATE_TRANSITION',
        { from, to, allowed: this.allowedFrom(from) }
      );
    }
    return true;
  }

  static isClosed(status) {
    return status === 'CLOSED';
  }

  static isTerminal(status) {
    return this.allowedFrom(status).length === 0;
  }

  /** States in which an incident still counts as "open". */
  static isOpen(status) {
    return !['RESOLVED', 'VERIFIED', 'CLOSED'].includes(status);
  }
}

module.exports = IncidentStateMachine;
