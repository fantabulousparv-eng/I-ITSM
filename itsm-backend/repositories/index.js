const { BaseRepository, IncidentRepository, UserRepository, ServiceRepository, NotificationRepository } = require('../patterns/repository/repositories');

/**
 * Composition root for repositories. Services depend on this module rather
 * than importing models directly (Repository pattern).
 */
const Incident = require('../models/Incident');
const User = require('../models/User');
const Service = require('../models/Service');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const Counter = require('../models/Counter');
const SlaPolicy = require('../models/SlaPolicy');

module.exports = {
  incidents: new IncidentRepository(Incident),
  users: new UserRepository(User),
  services: new ServiceRepository(Service),
  audit: new BaseRepository(AuditLog),
  notifications: new NotificationRepository(Notification),
  models: { Incident, User, Service, AuditLog, Notification, Counter, SlaPolicy },
};
