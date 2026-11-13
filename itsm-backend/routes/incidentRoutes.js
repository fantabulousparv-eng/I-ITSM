const express = require('express');
const router = express.Router();
const Incident = require('../models/Incident');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

// 1. CREATE INCIDENT (Employee reports a new issue)
router.post('/', async (req, res) => {
  try {
    const { title, description, category, affectedService, reporter, impact, urgency } = req.body;

    // Generate a unique ticket ID (e.g., INC-1001)
    const count = await Incident.countDocuments();
    const incidentId = `INC-${1000 + count + 1}`;

    // Simple automated priority calculation matrix
    let priority = 'P4';
    if (impact === 'Critical' || urgency === 'Critical') priority = 'P1';
    else if (impact === 'High' || urgency === 'High') priority = 'P2';
    else if (impact === 'Medium') priority = 'P3';

    // Set SLA response & resolution targets (e.g., 2 hours for response, 24 hours for resolution)
    const now = new Date();
    const slaResponseTarget = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const slaResolutionTarget = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const newIncident = new Incident({
      incidentId,
      title,
      description,
      category,
      affectedService,
      reporter,
      impact,
      urgency,
      priority,
      status: 'NEW',
      slaResponseTarget,
      slaResolutionTarget
    });

    await newIncident.save();

    // Create Audit Log entry
    await AuditLog.create({
      incidentId: newIncident._id,
      user: reporter,
      action: 'CREATED',
      newState: 'NEW',
      description: `Incident ${incidentId} was reported.`
    });

    res.status(201).json({ message: 'Incident created successfully', incident: newIncident });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET ALL INCIDENTS (For dashboards)
router.get('/', async (req, res) => {
  try {
    const incidents = await Incident.find()
      .populate('reporter', 'name email role')
      .populate('assignedTechnician', 'name email role')
      .populate('affectedService', 'name category');
    res.json(incidents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. ASSIGN TECHNICIAN (Strategy Pattern implementation endpoint)
router.patch('/:id/assign', async (req, res) => {
  try {
    const { technicianId, adminId } = req.body; // Admin assigning the tech

    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ message: 'Incident not found' });

    const previousState = incident.status;
    incident.assignedTechnician = technicianId;
    incident.status = 'ASSIGNED';
    await incident.save();

    // Log the assignment
    await AuditLog.create({
      incidentId: incident._id,
      user: adminId,
      action: 'ASSIGNED',
      previousState,
      newState: 'ASSIGNED',
      description: `Assigned technician to incident ${incident.incidentId}`
    });

    res.json({ message: 'Technician assigned successfully', incident });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. UPDATE INCIDENT STATUS (State Machine transition validation)
router.patch('/:id/status', async (req, res) => {
  try {
    const { newStatus, userId, resolutionDetails } = req.body;

    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ message: 'Incident not found' });

    // State Pattern Validation Logic (Strict Lifecycle Rules)
    const validTransitions = {
      'NEW': ['CLASSIFIED', 'ASSIGNED'],
      'CLASSIFIED': ['ASSIGNED'],
      'ASSIGNED': ['ACKNOWLEDGED', 'IN_PROGRESS'],
      'ACKNOWLEDGED': ['IN_PROGRESS'],
      'IN_PROGRESS': ['RESOLVED'],
      'RESOLVED': ['VERIFIED', 'CLOSED'],
      'VERIFIED': ['CLOSED'],
      'CLOSED': []
    };

    if (!validTransitions[incident.status].includes(newStatus)) {
      return res.status(400).json({ 
        message: `Invalid state transition from ${incident.status} to ${newStatus}` 
      });
    }

    const previousState = incident.status;
    incident.status = newStatus;
    if (resolutionDetails) incident.resolutionDetails = resolutionDetails;
    await incident.save();

    // Log state change
    await AuditLog.create({
      incidentId: incident._id,
      user: userId,
      action: `STATUS_CHANGE_TO_${newStatus}`,
      previousState,
      newState: newStatus,
      description: `Status updated from ${previousState} to ${newStatus}`
    });

    res.json({ message: 'Status updated successfully', incident });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;