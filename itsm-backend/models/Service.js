const mongoose = require('mongoose');
const { CATEGORIES, LEVELS } = require('../constants/itsm');

const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    code: { type: String, trim: true, uppercase: true, default: '' },
    category: { type: String, enum: CATEGORIES, required: true, index: true },
    /** Drives the "business criticality" term of the priority formula. */
    baseCriticality: { type: String, enum: LEVELS, default: 'Medium' },
    description: { type: String, trim: true, default: '' },
    ownerTeam: { type: String, trim: true, default: '' },
    /** Keywords used by the text-classification helper to infer a category. */
    keywords: { type: [String], default: [] },
    /** Upstream services this one depends on (service dependency graph). */
    dependencies: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

serviceSchema.index({ name: 'text', description: 'text', keywords: 'text' });

module.exports = mongoose.model('Service', serviceSchema);
