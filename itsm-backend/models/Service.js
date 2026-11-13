const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., "Payment Application", "Database"
  category: { 
    type: String, 
    enum: ['Hardware', 'Software', 'Network', 'Database', 'Cloud', 'Security', 'Authentication', 'Application', 'Storage'],
    required: true 
  },
  baseCriticality: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium' }
}, { timestamps: true });

module.exports = mongoose.model('Service', serviceSchema);