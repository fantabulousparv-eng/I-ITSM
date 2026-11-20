const mongoose = require('mongoose');
const { STATUS_VALUES, CATEGORIES, LEVELS, PRIORITIES } = require('../constants/itsm');

const incidentSchema = new mongoose.Schema(
  {
    incidentId: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },

    /* ---- Classification (tasks 2 & 3) ---- */
    category: { type: String, enum: CATEGORIES, required: true, index: true },
    affectedService: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
    classification: {
      method: { type: String, enum: ['manual', 'keyword', 'service', 'similarity'], default: 'manual' },
      confidence: { type: Number, min: 0, max: 1, default: 1 },
      matchedKeywords: { type: [String], default: [] },
    },

    /* ---- People ---- */
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignedTechnician: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    assignment: {
      strategy: { type: String, default: '' },
      score: { type: Number, default: 0 },
      reasons: { type: [String], default: [] },
      assignedAt: { type: Date, default: null },
    },

    /* ---- Impact assessment & priority (tasks 4 & 5) ---- */
    impact: { type: String, enum: LEVELS, required: true },
    urgency: { type: String, enum: LEVELS, required: true },
    businessCriticality: { type: String, enum: LEVELS, default: 'Medium' },
    affectedUsers: { type: Number, default: 1, min: 0 },
    priority: { type: String, enum: PRIORITIES, default: 'P4', index: true },
    priorityScore: { type: Number, default: 0 },
    priorityStrategy: { type: String, default: 'weighted-score' },

    /* ---- Lifecycle (tasks 10, 13) ---- */
    status: { type: String, enum: STATUS_VALUES, default: 'NEW', index: true },

    /* ---- SLA (tasks 6 & 11) ---- */
    sla: {
      responseTarget: { type: Date, default: null },
      resolutionTarget: { type: Date, default: null },
      responseDueAt: { type: Date, default: null },
      resolutionDueAt: { type: Date, default: null },
      firstResponseAt: { type: Date, default: null },
      resolvedAt: { type: Date, default: null },
      closedAt: { type: Date, default: null },
      responseBreached: { type: Boolean, default: false },
      resolutionBreached: { type: Boolean, default: false },
      violated: { type: Boolean, default: false },
      approachingNotified: { type: Boolean, default: false },
      violationNotified: { type: Boolean, default: false },
    },

    /* ---- Investigation & resolution (task 10) ---- */
    investigation: {
      startedAt: { type: Date, default: null },
      notes: [
        {
          author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          body: { type: String, trim: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
    },
    resolution: {
      summary: { type: String, trim: true, default: '' },
      rootCause: { type: String, trim: true, default: '' },
      actionTaken: { type: String, trim: true, default: '' },
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      resolvedAt: { type: Date, default: null },
    },

    /* ---- Closure (task 13) ---- */
    closure: {
      closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      closedAt: { type: Date, default: null },
      closureCode: { type: String, default: '' },
      notes: { type: String, trim: true, default: '' },
      verificationNote: { type: String, trim: true, default: '' },
    },

    /* ---- Post-resolution feedback (employee) ---- */
    feedback: {
      rating: { type: Number, min: 1, max: 5, default: null },
      comment: { type: String, trim: true, default: '' },
      submittedAt: { type: Date, default: null },
    },

    tags: { type: [String], default: [] },
    /** Incidents flagged as possible duplicates / similar (task 14 intelligence). */
    relatedIncidents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Incident' }],
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

incidentSchema.index({ status: 1, priority: 1, createdAt: -1 });
incidentSchema.index({ title: 'text', description: 'text' });

/** Minutes elapsed between two dates (null when either is missing). */
incidentSchema.methods.minutesBetween = function minutesBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
};

module.exports = mongoose.model('Incident', incidentSchema);
