const mongoose = require('mongoose');

/**
 * Immutable audit record. Every meaningful activity is appended here so a
 * complete, timestamped history of an incident can be reproduced.
 * Fields mirror the specification: Timestamp, User, Action, Incident ID,
 * Previous state, New state, Description.
 */
const auditLogSchema = new mongoose.Schema(
  {
    incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', required: true, index: true },
    /** Human readable ticket id (INC-1001) to keep the trail readable. */
    incidentRef: { type: String, default: '' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: 'system' },
    actorRole: { type: String, default: 'system' },
    action: { type: String, required: true },
    category: {
      type: String,
      enum: ['lifecycle', 'assignment', 'sla', 'notification', 'comment', 'system'],
      default: 'system',
    },
    previousState: { type: String, default: null },
    newState: { type: String, default: null },
    description: { type: String, default: '', maxlength: 2000 },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

auditLogSchema.index({ incidentId: 1, createdAt: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
