const mongoose = require('mongoose');
const { PRIORITIES } = require('../constants/itsm');

/** Configurable SLA policy per priority (seeded from constants). */
const slaPolicySchema = new mongoose.Schema(
  {
    priority: { type: String, enum: PRIORITIES, required: true, unique: true },
    label: { type: String, default: '' },
    responseMinutes: { type: Number, required: true, min: 1 },
    resolutionMinutes: { type: Number, required: true, min: 1 },
    /** Warn when this fraction of the resolution window has elapsed. */
    warnAtFraction: { type: Number, default: 0.75, min: 0.1, max: 0.99 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SlaPolicy', slaPolicySchema);
