const repos = require('../repositories');
const slaService = require('./slaService');
const { PRIORITIES, STATUS_VALUES } = require('../constants/itsm');

const OPEN_STATUSES = ['NEW', 'CLASSIFIED', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS'];
const CLOSED_STATUSES = ['RESOLVED', 'VERIFIED', 'CLOSED'];

function toMap(rows) {
  return rows.reduce((acc, row) => {
    acc[row._id] = row.count;
    return acc;
  }, {});
}

/** Fill gaps so the UI always receives every priority/status bucket. */
function zeroFill(keys, map) {
  return keys.map((key) => ({ key, count: map[key] || 0 }));
}

/**
 * Reporting and analytics (task 14).
 *
 * Every incident that is reported flows into these aggregates, so the service
 * desk can answer: how much work is open, where is it concentrated, are we
 * meeting SLA, who is carrying the load, and is volume trending up?
 */
class AnalyticsService {
  async overview({ days = 14 } = {}) {
    const Incident = repos.models.Incident;
    const now = new Date();
    const since = new Date(now.getTime() - days * 86400000);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const [
      statusRows,
      priorityRows,
      categoryRows,
      serviceRows,
      slaRows,
      timingRows,
      technicianRows,
      trendRows,
      totalCount,
      openCount,
      closedCount,
      createdToday,
    ] = await Promise.all([
      Incident.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Incident.aggregate([{ $group: { _id: '$priority', count: { $sum: 1 } } }]),
      Incident.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      Incident.aggregate([
        { $group: { _id: '$affectedService', count: { $sum: 1 } } },
        { $lookup: { from: 'services', localField: '_id', foreignField: '_id', as: 'service' } },
        { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
        { $project: { _id: 0, serviceId: '$_id', name: { $ifNull: ['$service.name', 'Unknown service'] }, count: 1 } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
      Incident.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            breached: { $sum: { $cond: [{ $eq: ['$sla.violated', true] }, 1, 0] } },
            responseBreached: { $sum: { $cond: [{ $eq: ['$sla.responseBreached', true] }, 1, 0] } },
            resolutionBreached: { $sum: { $cond: [{ $eq: ['$sla.resolutionBreached', true] }, 1, 0] } },
            met: {
              $sum: {
                $cond: [
                  { $and: [{ $ne: ['$sla.resolvedAt', null] }, { $ne: ['$sla.violated', true] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      Incident.aggregate([
        { $match: { 'sla.resolvedAt': { $ne: null } } },
        {
          $project: {
            resolutionMinutes: { $divide: [{ $subtract: ['$sla.resolvedAt', '$createdAt'] }, 60000] },
            responseMinutes: {
              $cond: [
                { $ne: ['$sla.firstResponseAt', null] },
                { $divide: [{ $subtract: ['$sla.firstResponseAt', '$createdAt'] }, 60000] },
                null,
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            resolved: { $sum: 1 },
            avgResolutionMinutes: { $avg: '$resolutionMinutes' },
            avgResponseMinutes: { $avg: '$responseMinutes' },
            fastestResolutionMinutes: { $min: '$resolutionMinutes' },
            slowestResolutionMinutes: { $max: '$resolutionMinutes' },
          },
        },
      ]),
      Incident.aggregate([
        { $match: { assignedTechnician: { $ne: null } } },
        {
          $group: {
            _id: '$assignedTechnician',
            assigned: { $sum: 1 },
            resolved: { $sum: { $cond: [{ $in: ['$status', CLOSED_STATUSES] }, 1, 0] } },
            open: { $sum: { $cond: [{ $in: ['$status', OPEN_STATUSES] }, 1, 0] } },
            breached: { $sum: { $cond: [{ $eq: ['$sla.violated', true] }, 1, 0] } },
          },
        },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            technicianId: '$_id',
            name: { $ifNull: ['$user.name', 'Unknown technician'] },
            email: '$user.email',
            assigned: 1,
            resolved: 1,
            open: 1,
            breached: 1,
          },
        },
        { $sort: { resolved: -1, assigned: -1 } },
        { $limit: 25 },
      ]),
      Incident.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            created: { $sum: 1 },
            resolved: { $sum: { $cond: [{ $ne: ['$sla.resolvedAt', null] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Incident.countDocuments({}),
      Incident.countDocuments({ status: { $in: OPEN_STATUSES } }),
      Incident.countDocuments({ status: { $in: CLOSED_STATUSES } }),
      Incident.countDocuments({ createdAt: { $gte: startOfToday } }),
    ]);

    const statusMap = toMap(statusRows);
    const priorityMap = toMap(priorityRows);
    const sla = slaRows[0] || { total: 0, breached: 0, responseBreached: 0, resolutionBreached: 0, met: 0 };
    const timing = timingRows[0] || { resolved: 0 };
    const atRisk = await this.countAtRisk(now);

    const round = (value) => (value == null ? 0 : Math.round(value));
    const completed = sla.met + sla.breached;

    return {
      generatedAt: now,
      windowDays: days,
      totals: {
        all: totalCount,
        open: openCount,
        closed: closedCount,
        createdToday,
        unassigned: await repos.incidents.count({ assignedTechnician: null, status: { $in: OPEN_STATUSES } }),
      },
      byStatus: zeroFill(STATUS_VALUES, statusMap),
      byPriority: zeroFill(PRIORITIES, priorityMap),
      byCategory: categoryRows.map((row) => ({ category: row._id, count: row.count })),
      byService: serviceRows,
      sla: {
        evaluated: sla.total,
        breached: sla.breached,
        responseBreached: sla.responseBreached,
        resolutionBreached: sla.resolutionBreached,
        met: sla.met,
        atRisk,
        complianceRate: completed ? Number(((sla.met / completed) * 100).toFixed(1)) : 100,
      },
      timing: {
        resolved: timing.resolved || 0,
        avgResolutionMinutes: round(timing.avgResolutionMinutes),
        avgResponseMinutes: round(timing.avgResponseMinutes),
        mttrMinutes: round(timing.avgResolutionMinutes),
        fastestResolutionMinutes: round(timing.fastestResolutionMinutes),
        slowestResolutionMinutes: round(timing.slowestResolutionMinutes),
      },
      technicians: technicianRows.map((row) => ({
        ...row,
        slaComplianceRate: row.assigned
          ? Number((((row.assigned - row.breached) / row.assigned) * 100).toFixed(1))
          : 100,
      })),
      trend: trendRows.map((row) => ({ date: row._id, created: row.created, resolved: row.resolved })),
    };
  }

  /** Open incidents whose resolution window is >= 75% consumed. */
  async countAtRisk(now = new Date()) {
    const incidents = await repos.incidents.findAll({
      status: { $in: OPEN_STATUSES },
      'sla.resolutionDueAt': { $ne: null },
    });
    return incidents.filter((incident) => slaService.evaluate(incident, now).atRisk).length;
  }

  /** Watchlist for the SLA dashboard: breached first, then at-risk. */
  async slaWatchlist(limit = 25) {
    const now = new Date();
    const incidents = await repos.incidents.findManyPopulated(
      { status: { $in: OPEN_STATUSES }, 'sla.resolutionDueAt': { $ne: null } },
      { sort: { 'sla.resolutionDueAt': 1 }, limit: 200 }
    );

    const ranked = incidents
      .map((incident) => {
        const evaluation = slaService.evaluate(incident, now);
        return {
          _id: incident._id,
          incidentId: incident.incidentId,
          title: incident.title,
          status: incident.status,
          priority: incident.priority,
          category: incident.category,
          service: incident.affectedService?.name || null,
          technician: incident.assignedTechnician?.name || null,
          resolutionDueAt: incident.sla.resolutionDueAt,
          remainingMinutes: evaluation.resolution.remainingMinutes,
          state: evaluation.state,
          violated: evaluation.violated,
        };
      })
      .sort((a, b) => {
        const order = { BREACHED: 0, AT_RISK: 1, ON_TRACK: 2, MET: 3 };
        return (order[a.state] ?? 9) - (order[b.state] ?? 9) || a.remainingMinutes - b.remainingMinutes;
      });

    return ranked.slice(0, limit);
  }
}

module.exports = new AnalyticsService();
