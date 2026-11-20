const mongoose = require('mongoose');
const { CHANNELS } = require('../constants/itsm');

const CHANNEL_VALUES = Object.values(CHANNELS);

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    incident: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', default: null },
    incidentRef: { type: String, default: '' },
    /** Domain event that produced this notification (see constants.EVENTS). */
    event: { type: String, required: true, index: true },
    severity: { type: String, enum: ['info', 'warning', 'critical', 'success'], default: 'info' },
    title: { type: String, required: true, maxlength: 200 },
    message: { type: String, required: true, maxlength: 1000 },
    /** Channels this notification was dispatched through. */
    channels: [{ type: String, enum: CHANNEL_VALUES }],
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: Date.now },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
