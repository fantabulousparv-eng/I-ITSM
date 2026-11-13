const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true },
  previousState: { type: String },
  newState: { type: String },
  description: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('AuditLog', auditLogSchema);