const mongoose = require('mongoose');

const incidentSchema = new mongoose.Schema({
  incidentId: { type: String, required: true, unique: true }, // e.g., "INC1024"
  title: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  affectedService: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedTechnician: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  
  // Priority calculation metrics
  impact: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], required: true },
  urgency: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], required: true },
  priority: { type: String, enum: ['P1', 'P2', 'P3', 'P4'], default: 'P4' },
  
  // Lifecycle state machine tracking
  status: { 
    type: String, 
    enum: ['NEW', 'CLASSIFIED', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'CLOSED'], 
    default: 'NEW' 
  },
  
  // SLA Targets
  slaResponseTarget: { type: Date },
  slaResolutionTarget: { type: Date },
  slaViolated: { type: Boolean, default: false },
  
  resolutionDetails: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Incident', incidentSchema);