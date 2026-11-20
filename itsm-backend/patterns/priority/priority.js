const { rankOf, scoreToPriority, PRIORITY_BANDS } = require('../../constants/itsm');

/**
 * Strategy pattern - interchangeable priority algorithms.
 *
 * Every strategy receives an assessment context:
 *   { impact, urgency, businessCriticality, affectedUsers, service, historical }
 * and returns { priority, score, reasons[], strategy }.
 */
class PriorityStrategy {
  constructor(name) {
    this.name = name;
  }

  // eslint-disable-next-line no-unused-vars
  calculate(_context) {
    throw new Error(`PriorityStrategy.calculate() not implemented for ${this.name}`);
  }
}

/** Rule based escalation, mirroring the worked example in the specification. */
class RuleBasedPriorityStrategy extends PriorityStrategy {
  constructor() {
    super('rule-based');
  }

  calculate({ impact, urgency, businessCriticality }) {
    const reasons = [`rule evaluation for impact=${impact}, urgency=${urgency}, criticality=${businessCriticality}`];
    let priority;
    if (impact === 'Critical' || urgency === 'Critical') priority = 'P1';
    else if (impact === 'High' || urgency === 'High') priority = 'P2';
    else if (impact === 'Medium' || urgency === 'Medium') priority = 'P3';
    else priority = 'P4';

    if (businessCriticality === 'Critical' && priority !== 'P1') {
      priority = shiftUp(priority);
      reasons.push('business criticality is Critical -> escalated one band');
    }
    reasons.push(`resolved priority ${priority}`);
    return { priority, score: scoreOf(impact, urgency, businessCriticality), reasons, strategy: this.name };
  }
}

/**
 * Weighted scoring strategy (default).
 * Priority Score = Impact x Urgency x Business Criticality, with a bounded
 * adjustment based on the number of affected users so that widespread
 * outages are not under-rated.
 */
class WeightedScorePriorityStrategy extends PriorityStrategy {
  constructor() {
    super('weighted-score');
  }

  calculate({ impact, urgency, businessCriticality, affectedUsers = 1 }) {
    const i = rankOf(impact);
    const u = rankOf(urgency);
    const c = rankOf(businessCriticality);
    const reasons = [
      `impact(${impact})=${i}`,
      `urgency(${urgency})=${u}`,
      `businessCriticality(${businessCriticality})=${c}`,
      `base score = ${i} x ${u} x ${c} = ${i * u * c}`,
    ];

    let score = i * u * c;
    if (affectedUsers >= 100) {
      score = Math.round(score * 1.2);
      reasons.push(`affectedUsers=${affectedUsers} (>=100) -> +20%`);
    } else if (affectedUsers >= 20) {
      score = Math.round(score * 1.1);
      reasons.push(`affectedUsers=${affectedUsers} (>=20) -> +10%`);
    }

    const priority = scoreToPriority(score);
    reasons.push(`final score ${score} -> ${priority}`);
    return { priority, score, reasons, strategy: this.name };
  }
}

/**
 * Historical-data strategy: falls back to the weighted score but nudges the
 * priority using the average resolution time of comparable past incidents.
 * (A lightweight, explainable stand-in for the ML-assisted variant.)
 */
class HistoricalPriorityStrategy extends PriorityStrategy {
  constructor() {
    super('historical');
    this.fallback = new WeightedScorePriorityStrategy();
  }

  calculate(context) {
    const base = this.fallback.calculate(context);
    const reasons = [...base.reasons];
    const history = context.historical || {};
    let priority = base.priority;
    let score = base.score;

    if (history.similarCount >= 3 && history.averageResolutionMinutes > 0) {
      const p = context.priorityHint;
      if (p) {
        priority = p;
        reasons.push(`similar incidents average ${history.averageResolutionMinutes} min -> priority hint ${p}`);
      }
    }
    return { priority, score, reasons, strategy: this.name };
  }
}

/** Registry + simple factory for the strategies. */
const STRATEGIES = {
  'rule-based': RuleBasedPriorityStrategy,
  'weighted-score': WeightedScorePriorityStrategy,
  historical: HistoricalPriorityStrategy,
};

class PriorityContext {
  constructor(strategyName = 'weighted-score') {
    this.setStrategy(strategyName);
  }

  setStrategy(strategyName) {
    const Ctor = STRATEGIES[strategyName] || WeightedScorePriorityStrategy;
    this.strategy = new Ctor();
    return this;
  }

  calculate(context) {
    return this.strategy.calculate(context);
  }
}

function shiftUp(priority) {
  const order = PRIORITY_BANDS.map((b) => b.priority);
  const idx = order.indexOf(priority);
  return order[Math.max(0, idx - 1)];
}

function scoreOf(impact, urgency, businessCriticality) {
  return rankOf(impact) * rankOf(urgency) * rankOf(businessCriticality);
}

module.exports = {
  PriorityStrategy,
  RuleBasedPriorityStrategy,
  WeightedScorePriorityStrategy,
  HistoricalPriorityStrategy,
  PriorityContext,
  STRATEGIES,
};

module.exports.STRATEGY_NAMES = Object.keys(STRATEGIES);
