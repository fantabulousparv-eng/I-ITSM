/**
 * Strategy pattern - interchangeable technician assignment algorithms.
 *
 * Each strategy is given a context:
 *   { incident, technicians[], service }
 * and returns a ranked list of candidates:
 *   [{ technician, score, reasons[] }]  (best first)
 */
class AssignmentStrategy {
  constructor(name) {
    this.name = name;
  }

  // eslint-disable-next-line no-unused-vars
  rank(_context) {
    throw new Error(`AssignmentStrategy.rank() not implemented for ${this.name}`);
  }

  /** Convenience helper: rank then pick the best candidate. */
  select(context) {
    const ranked = this.rank(context).filter((c) => c.score > 0);
    return ranked.length ? ranked[0] : null;
  }

  static available(technicians) {
    return technicians.filter((t) => t.available !== false && !t.isAtCapacity?.());
  }
}

/** Matches the technician's declared skills against incident category/service. */
class SkillBasedAssignmentStrategy extends AssignmentStrategy {
  constructor() {
    super('skill-based');
  }

  rank({ incident, technicians, service }) {
    const wanted = [incident.category, service?.name, ...(service?.keywords || [])].filter(Boolean);
    return technicians
      .map((technician) => {
        const matched = wanted.filter((w) => technician.hasSkill?.(w));
        const score = matched.length * 10 + (technician.experienceYears || 0);
        return {
          technician,
          score,
          reasons: matched.length
            ? [`skills matched: ${matched.join(', ')}`]
            : ['no direct skill match'],
        };
      })
      .sort((a, b) => b.score - a.score);
  }
}

/** Picks the least busy technician relative to their capacity. */
class LoadBasedAssignmentStrategy extends AssignmentStrategy {
  constructor() {
    super('load-based');
  }

  rank({ technicians }) {
    return technicians
      .map((technician) => {
        const free = (technician.capacity || 1) - (technician.workloadCount || 0);
        return {
          technician,
          score: Math.max(0, free) * 5,
          reasons: [`${technician.workloadCount}/${technician.capacity} active incidents`],
        };
      })
      .sort((a, b) => b.score - a.score);
  }
}

/** Even rotation across the available pool (state kept by the service layer). */
class RoundRobinAssignmentStrategy extends AssignmentStrategy {
  constructor() {
    super('round-robin');
  }

  rank({ technicians, cursor = 0 }) {
    if (!technicians.length) return [];
    return technicians.map((technician, idx) => ({
      technician,
      score: 100 - ((idx - cursor + technicians.length) % technicians.length),
      reasons: ['round-robin rotation'],
    })).sort((a, b) => b.score - a.score);
  }
}

/** Favours technicians who previously worked on the affected service. */
class ExperienceBasedAssignmentStrategy extends AssignmentStrategy {
  constructor() {
    super('experience-based');
  }

  rank({ technicians, service }) {
    return technicians
      .map((technician) => {
        const experienced = (technician.serviceExperience || []).some(
          (id) => String(id) === String(service?._id)
        );
        const score = (experienced ? 15 : 0) + (technician.experienceYears || 0) * 2;
        return {
          technician,
          score,
          reasons: [experienced ? `worked on ${service?.name} before` : 'limited service history'],
        };
      })
      .sort((a, b) => b.score - a.score);
  }
}

/**
 * Default composite strategy ("prescriptive"): blends skills, current load,
 * service experience, availability and priority fit into one explainable score.
 */
class CompositeAssignmentStrategy extends AssignmentStrategy {
  constructor() {
    super('composite');
  }

  rank({ incident, technicians, service }) {
    const wanted = [incident.category, service?.name, ...(service?.keywords || [])].filter(Boolean);
    return technicians
      .map((technician) => {
        const reasons = [];
        const matched = wanted.filter((w) => technician.hasSkill?.(w));
        let score = 0;

        score += matched.length * 8;
        if (matched.length) reasons.push(`skill match: ${matched.join(', ')}`);

        const free = (technician.capacity || 1) - (technician.workloadCount || 0);
        score += Math.max(0, free) * 3;
        reasons.push(`load ${technician.workloadCount}/${technician.capacity}`);

        if ((technician.serviceExperience || []).some((id) => String(id) === String(service?._id))) {
          score += 6;
          reasons.push(`previously resolved ${service?.name} incidents`);
        }

        score += Math.min(10, (technician.experienceYears || 0) * 2);
        if (technician.available === false) {
          score -= 25;
          reasons.push('currently unavailable');
        }
        if (technician.isAtCapacity?.()) {
          score -= 15;
          reasons.push('at capacity');
        }
        if (['P1', 'P2'].includes(incident.priority) && (technician.experienceYears || 0) >= 3) {
          score += 5;
          reasons.push('senior technician for high priority incident');
        }

        return { technician, score: Math.round(score), reasons };
      })
      .sort((a, b) => b.score - a.score);
  }
}

const STRATEGIES = {
  'skill-based': SkillBasedAssignmentStrategy,
  'load-based': LoadBasedAssignmentStrategy,
  'round-robin': RoundRobinAssignmentStrategy,
  'experience-based': ExperienceBasedAssignmentStrategy,
  composite: CompositeAssignmentStrategy,
};

class AssignmentContext {
  constructor(strategyName = 'composite') {
    this.setStrategy(strategyName);
  }

  setStrategy(strategyName) {
    const Ctor = STRATEGIES[strategyName] || CompositeAssignmentStrategy;
    this.strategy = new Ctor();
    return this;
  }

  rank(context) {
    return this.strategy.rank(context);
  }

  select(context) {
    return this.strategy.select(context);
  }
}

module.exports = {
  AssignmentStrategy,
  SkillBasedAssignmentStrategy,
  LoadBasedAssignmentStrategy,
  RoundRobinAssignmentStrategy,
  ExperienceBasedAssignmentStrategy,
  CompositeAssignmentStrategy,
  AssignmentContext,
  STRATEGIES,
  STRATEGY_NAMES: Object.keys(STRATEGIES),
};
