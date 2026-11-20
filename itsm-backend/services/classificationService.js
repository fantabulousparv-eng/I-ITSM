const repos = require('../repositories');
const { CATEGORIES } = require('../constants/itsm');

/**
 * Incident classification + service identification (tasks 2 & 3).
 *
 * The classifier is deliberately transparent: it is a keyword/rule engine
 * rather than a black box, so every decision can be explained to the user
 * ("matched keywords: vpn, dns") and to the examiner.
 */

/** Keyword vocabulary per category. Order of words is irrelevant. */
const KEYWORD_MAP = {
  Hardware: [
    'laptop', 'desktop', 'printer', 'monitor', 'keyboard', 'mouse', 'battery', 'hard drive',
    'disk', 'power', 'boot', 'screen', 'ram', 'cpu', 'device', 'scanner', 'headset', 'dock', 'overheating',
  ],
  Software: [
    'application', 'install', 'update', 'patch', 'license', 'licence', 'crash', 'error', 'bug',
    'version', 'freeze', 'office', 'excel', 'word', 'adobe', 'installation', 'uninstall',
  ],
  Network: [
    'network', 'wifi', 'wi-fi', 'internet', 'vpn', 'dns', 'latency', 'packet', 'router',
    'switch', 'firewall', 'connectivity', 'bandwidth', 'proxy', 'offline', 'slow connection',
  ],
  Database: [
    'database', 'sql', 'mongodb', 'query', 'deadlock', 'replication', 'index', 'table',
    'restore', 'timeout', 'schema', 'cluster', 'transaction',
  ],
  Cloud: [
    'cloud', 'aws', 'azure', 'gcp', 'kubernetes', 'container', 'pod', 's3', 'ec2',
    'lambda', 'instance', 'bucket', 'docker', 'autoscaling', 'region',
  ],
  Security: [
    'security', 'breach', 'malware', 'ransomware', 'virus', 'phishing', 'vulnerability',
    'intrusion', 'threat', 'suspicious', 'hacked', 'unauthorised access', 'unauthorized access', 'exploit',
  ],
  Authentication: [
    'login', 'log in', 'sign in', 'signin', 'password', 'sso', 'mfa', '2fa', 'otp',
    'credential', 'account locked', 'access denied', 'authentication', 'token', 'reset password',
  ],
  Application: [
    'portal', 'website', 'web app', 'ui', 'page', 'form', 'workflow', 'dashboard', 'report',
    'api', 'endpoint', 'payroll', 'crm', 'erp', 'internal tool',
  ],
  Storage: [
    'storage', 'disk space', 'quota', 'file share', 'nas', 'san', 'filesystem', 'folder',
    'upload', 'capacity', 'full disk', 'backup',
  ],
};

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word (or whole-phrase) match so "db" does not match "dashboard". */
function containsKeyword(haystack, keyword) {
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`, 'i');
  return pattern.test(haystack);
}

class ClassificationService {
  /** Rank every category by how many of its keywords appear in the text. */
  scoreCategories(text) {
    const results = [];
    for (const category of CATEGORIES) {
      const keywords = KEYWORD_MAP[category] || [];
      const matched = keywords.filter((keyword) => containsKeyword(text, keyword));
      if (matched.length) results.push({ category, matched, score: matched.length });
    }
    return results.sort((a, b) => b.score - a.score || b.matched.length - a.matched.length);
  }

  /** Rank services by how well their name/keywords match the free text. */
  async identifyService(text, category = null) {
    const byCategory = category ? await repos.services.findByCategory(category) : [];
    const pool = byCategory.length ? byCategory : await repos.services.findAllActive();

    return pool
      .map((service) => {
        const matched = (service.keywords || []).filter((keyword) => containsKeyword(text, keyword));
        if (containsKeyword(text, service.name)) matched.push(service.name);
        return { service, score: matched.length, matched };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Full classification pass.
   * @returns { category, method, confidence, matchedKeywords, service, serviceCandidates }
   */
  async classify({ title = '', description = '', service = null, limit = 5 } = {}) {
    const text = `${title}\n${description}`.trim();

    // An explicitly chosen service is authoritative.
    if (service) {
      return {
        category: service.category,
        method: 'service',
        confidence: 0.95,
        matchedKeywords: [],
        service,
        serviceCandidates: [{ service, score: 1, matched: [] }],
      };
    }

    const categoryRanking = this.scoreCategories(text);
    const bestCategory = categoryRanking[0] || null;
    const candidates = await this.identifyService(text, bestCategory?.category);
    const matchedService = candidates[0] && candidates[0].score > 0 ? candidates[0].service : null;

    const category = bestCategory?.category || matchedService?.category || 'Application';
    const method = bestCategory ? 'keyword' : matchedService ? 'service' : 'manual';
    const confidence = bestCategory
      ? Math.min(0.95, 0.5 + bestCategory.score * 0.1)
      : matchedService
        ? 0.6
        : 0.2;

    return {
      category,
      method,
      confidence: Number(confidence.toFixed(2)),
      matchedKeywords: bestCategory?.matched || [],
      service: matchedService,
      serviceCandidates: candidates.slice(0, limit),
    };
  }
}

module.exports = new ClassificationService();
module.exports.KEYWORD_MAP = KEYWORD_MAP;
