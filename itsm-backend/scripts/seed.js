/**
 * Seed / bootstrap script.
 *
 *   node scripts/seed.js          -> SLA policies + services + demo accounts
 *   node scripts/seed.js --demo   -> the above plus sample incidents
 *
 * `ensureReferenceData()` and `ensureAdmin()` are also called on every server
 * start, so a fresh clone can log in immediately without running this script.
 */
require('dotenv').config();

const repos = require('../repositories');
const { connectDB, disconnectDB } = require('../config/db');
const { registerObservers } = require('../events/observers');
const { ROLES, SLA_POLICIES } = require('../constants/itsm');

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || 'Passw0rd123';

/* --------------------------------------------------------------- catalogues */

const SERVICES = [
  {
    name: 'Corporate Email',
    code: 'EMAIL',
    category: 'Cloud',
    baseCriticality: 'High',
    ownerTeam: 'Messaging Team',
    description: 'Microsoft 365 hosted mailboxes, calendars and distribution lists.',
    keywords: ['email', 'outlook', 'mailbox', 'exchange', 'smtp', 'calendar'],
  },
  {
    name: 'Corporate VPN',
    code: 'VPN',
    category: 'Network',
    baseCriticality: 'High',
    ownerTeam: 'Network Team',
    description: 'Remote access VPN for staff working outside the office.',
    keywords: ['vpn', 'remote access', 'tunnel', 'anyconnect', 'dns', 'firewall'],
  },
  {
    name: 'Payroll Portal',
    code: 'PAYROLL',
    category: 'Application',
    baseCriticality: 'Critical',
    ownerTeam: 'Finance Systems',
    description: 'Monthly payroll processing and employee payslip portal.',
    keywords: ['payroll', 'payslip', 'salary', 'portal', 'web app'],
  },
  {
    name: 'Customer Portal',
    code: 'PORTAL',
    category: 'Application',
    baseCriticality: 'High',
    ownerTeam: 'Digital Channels',
    description: 'Public self-service website used by customers.',
    keywords: ['portal', 'website', 'customer', 'web app', 'checkout'],
  },
  {
    name: 'Primary Database Cluster',
    code: 'DB-CORE',
    category: 'Database',
    baseCriticality: 'Critical',
    ownerTeam: 'Data Platform',
    description: 'Primary MongoDB/SQL cluster backing the core systems.',
    keywords: ['database', 'sql', 'mongodb', 'replication', 'query', 'deadlock', 'cluster'],
  },
  {
    name: 'Employee Laptops',
    code: 'ENDPOINT',
    category: 'Hardware',
    baseCriticality: 'Medium',
    ownerTeam: 'End User Computing',
    description: 'Managed Windows and macOS laptops issued to staff.',
    keywords: ['laptop', 'desktop', 'keyboard', 'battery', 'boot', 'blue screen', 'printer', 'monitor'],
  },
  {
    name: 'Office Wi-Fi',
    code: 'WIFI',
    category: 'Network',
    baseCriticality: 'Medium',
    ownerTeam: 'Network Team',
    description: 'Wireless network across all office floors.',
    keywords: ['wifi', 'wi-fi', 'wireless', 'internet', 'latency', 'access point'],
  },
  {
    name: 'Identity & Access (SSO)',
    code: 'IAM',
    category: 'Authentication',
    baseCriticality: 'Critical',
    ownerTeam: 'Security Operations',
    description: 'Single sign-on, multi-factor authentication and account lifecycle.',
    keywords: ['sso', 'login', 'sign in', 'password', 'mfa', 'account locked', 'access denied'],
  },
  {
    name: 'Corporate File Storage',
    code: 'STORAGE',
    category: 'Storage',
    baseCriticality: 'Medium',
    ownerTeam: 'Infrastructure',
    description: 'Shared network drives and departmental file shares.',
    keywords: ['storage', 'file share', 'folder', 'quota', 'disk space', 'upload'],
  },
  {
    name: 'Security Monitoring',
    code: 'SOC',
    category: 'Security',
    baseCriticality: 'Critical',
    ownerTeam: 'Security Operations',
    description: 'SIEM, endpoint protection and threat detection.',
    keywords: ['security', 'phishing', 'malware', 'ransomware', 'breach', 'suspicious', 'virus'],
  },
  {
    name: 'CRM Platform',
    code: 'CRM',
    category: 'Application',
    baseCriticality: 'High',
    ownerTeam: 'Sales Operations',
    description: 'Customer relationship management used by sales and support.',
    keywords: ['crm', 'salesforce', 'leads', 'opportunity', 'report'],
  },
  {
    name: 'Backup Service',
    code: 'BACKUP',
    category: 'Storage',
    baseCriticality: 'High',
    ownerTeam: 'Infrastructure',
    description: 'Nightly backup and restore service for critical systems.',
    keywords: ['backup', 'restore', 'snapshot', 'retention', 'archive'],
  },
];

const TECHNICIANS = [
  {
    name: 'Aisha Khan',
    email: 'aisha.khan@itsm.local',
    department: 'Network Team',
    experienceYears: 6,
    skills: ['Network', 'VPN', 'Corporate VPN', 'Office Wi-Fi', 'Firewall'],
  },
  {
    name: 'Marco Silva',
    email: 'marco.silva@itsm.local',
    department: 'Data Platform',
    experienceYears: 5,
    skills: ['Database', 'Cloud', 'Primary Database Cluster', 'Backup Service', 'Kubernetes'],
  },
  {
    name: 'Priya Nair',
    email: 'priya.nair@itsm.local',
    department: 'End User Computing',
    experienceYears: 3,
    skills: ['Hardware', 'Software', 'Employee Laptops', 'Payroll Portal', 'Application'],
  },
  {
    name: 'Tom Becker',
    email: 'tom.becker@itsm.local',
    department: 'Security Operations',
    experienceYears: 7,
    skills: ['Security', 'Authentication', 'Identity & Access (SSO)', 'Storage', 'Security Monitoring'],
  },
];

const EMPLOYEES = [
  { name: 'Grace Okafor', email: 'grace.okafor@itsm.local', department: 'Finance' },
  { name: 'Liam Chen', email: 'liam.chen@itsm.local', department: 'Sales' },
  { name: 'Sofia Rossi', email: 'sofia.rossi@itsm.local', department: 'Human Resources' },
];

const DEMO_INCIDENTS = [
  {
    title: 'VPN keeps disconnecting every few minutes',
    description:
      'Since this morning the corporate VPN drops every few minutes and I cannot reach the internal wiki. DNS lookups also time out.',
    impact: 'High',
    urgency: 'High',
    affectedUsers: 25,
  },
  {
    title: 'Payroll portal shows a blank page',
    description:
      'The payroll portal opens but the dashboard page stays blank and payslip reports fail to load for everyone in Finance.',
    impact: 'High',
    urgency: 'Medium',
    affectedUsers: 300,
  },
  {
    title: 'Laptop will not boot after last night’s update',
    description:
      'My laptop shows a blue screen immediately after the Windows patch installed overnight. Error code 0x0000007B.',
    impact: 'Medium',
    urgency: 'Medium',
    affectedUsers: 1,
  },
  {
    title: 'Cannot sign in - account locked out',
    description:
      'Single sign-on returns access denied and my account is locked. Resetting the password did not help either.',
    impact: 'Medium',
    urgency: 'Critical',
    affectedUsers: 1,
  },
  {
    title: 'Database query timeouts on the reporting job',
    description:
      'The reporting service returns SQL timeout errors and replication lag on the primary database cluster keeps growing.',
    impact: 'Critical',
    urgency: 'High',
    affectedUsers: 120,
  },
  {
    title: 'Suspicious phishing email received by several staff',
    description:
      'Several colleagues received a suspicious email asking them to log in to a fake page. Possible credential phishing.',
    impact: 'High',
    urgency: 'Critical',
    affectedUsers: 40,
  },
  {
    title: 'Printer on the third floor is offline',
    description: 'The shared printer shows offline and all print jobs stay stuck in the queue.',
    impact: 'Low',
    urgency: 'Low',
    affectedUsers: 12,
  },
  {
    title: 'Corporate file share is almost full',
    description: 'The shared storage folder reports that the disk space quota is nearly exhausted.',
    impact: 'Medium',
    urgency: 'Medium',
    affectedUsers: 60,
  },
];

/* ------------------------------------------------------------------ helpers */

async function ensureSlaPolicies() {
  const existing = await repos.models.SlaPolicy.countDocuments({});
  if (existing) return { created: 0, skipped: existing };

  const docs = Object.values(SLA_POLICIES).map((policy) => ({
    priority: policy.priority,
    label: policy.label,
    responseMinutes: policy.responseMinutes,
    resolutionMinutes: policy.resolutionMinutes,
    warnAtFraction: 0.75,
  }));
  await repos.models.SlaPolicy.insertMany(docs);
  return { created: docs.length };
}

async function ensureServices() {
  const existing = await repos.models.Service.countDocuments({});
  if (existing) return { created: 0, skipped: existing };
  await repos.models.Service.insertMany(SERVICES);
  return { created: SERVICES.length };
}

/** Reference data required for the application to function. */
async function ensureReferenceData() {
  const [sla, services] = await Promise.all([ensureSlaPolicies(), ensureServices()]);
  return { slaPolicies: sla, services };
}

/**
 * Create the configured administrator when that exact account is missing.
 * Looking the account up by e-mail (rather than "any admin exists") keeps the
 * bootstrap deterministic even when other administrators were registered later.
 */
async function ensureAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@itsm.local').toLowerCase();
  const existing = await repos.users.findByEmail(email);
  if (existing) return { created: false, email: existing.email };

  const admin = await repos.users.create({
    name: process.env.SEED_ADMIN_NAME || 'Service Desk Administrator',
    email,
    password: process.env.SEED_ADMIN_PASSWORD || 'Admin@1234',
    role: ROLES.ADMIN,
    department: 'IT Service Desk',
  });
  console.log(`[seed] default administrator created: ${admin.email}`);
  return { created: true, email: admin.email };
}

async function upsertUser({ name, email, role, department, skills = [], experienceYears = 0 }) {
  const existing = await repos.users.findByEmail(email);
  if (existing) return { user: existing, created: false };
  const user = await repos.users.create({
    name,
    email,
    password: DEMO_PASSWORD,
    role,
    department,
    skills,
    experienceYears,
  });
  return { user, created: true };
}

async function seedUsers() {
  const result = { technicians: 0, employees: 0 };

  for (const spec of TECHNICIANS) {
    const { created } = await upsertUser({
      ...spec,
      role: ROLES.TECHNICIAN,
      capacity: 8,
      available: true,
    });
    if (created) result.technicians += 1;
  }

  for (const spec of EMPLOYEES) {
    const { created } = await upsertUser({ ...spec, role: ROLES.EMPLOYEE });
    if (created) result.employees += 1;
  }

  return result;
}

/* ------------------------------------------------------------ demo incidents */

async function seedDemoIncidents() {
  // Lazy import so the observer chain is registered before anything is logged.
  const incidentService = require('../services/incidentService');
  const slaMonitor = require('../jobs/slaMonitor');

  // Keep the script idempotent: never duplicate demo tickets on a re-run.
  const alreadySeeded = await repos.models.Incident.countDocuments({});
  if (alreadySeeded) {
    console.log(`[seed] demo incidents skipped: ${alreadySeeded} incidents already exist`);
    return { created: 0, skipped: alreadySeeded };
  }

  const employees = await repos.users.findAll({ role: ROLES.EMPLOYEE });
  const technicians = await repos.users.findAll({ role: ROLES.TECHNICIAN });
  if (!employees.length || !technicians.length) {
    console.warn('[seed] demo incidents skipped: no employees or technicians found');
    return { created: 0 };
  }

  const created = [];
  for (let i = 0; i < DEMO_INCIDENTS.length; i += 1) {
    const spec = DEMO_INCIDENTS[i];
    const reporter = employees[i % employees.length];
    try {
      // eslint-disable-next-line no-await-in-loop
      const incident = await incidentService.create({ ...spec, reporter: reporter._id }, reporter);
      created.push(incident);
    } catch (err) {
      console.warn(`[seed] could not create demo incident "${spec.title}": ${err.message}`);
    }
  }

  const actor = technicians[0];
  const other = technicians[1] || technicians[0];

  /** Walk an incident through the lifecycle so the history is realistic. */
  const advance = async (incident, status, payload = {}, who = actor) =>
    incidentService.changeStatus(incident._id, { status, ...payload }, who);

  const safe = async (label, fn) => {
    try {
      await fn();
    } catch (err) {
      console.warn(`[seed] ${label} failed: ${err.message}`);
    }
  };

  if (created[0]) {
    await safe('resolve VPN incident', async () => {
      const incident = await incidentService.load(created[0]._id);
      const who = incident.assignedTechnician
        ? await repos.users.findById(incident.assignedTechnician)
        : actor;
      await advance(incident, 'ACKNOWLEDGED', {}, who);
      await advance(incident, 'IN_PROGRESS', { note: 'Captured VPN client logs and reproduced the DNS timeout.' }, who);
      await advance(
        incident,
        'RESOLVED',
        {
          resolution: {
            summary: 'Corrected the DNS forwarder configuration on the remote access gateway.',
            rootCause: 'A stale DNS forwarder entry after the weekend network change.',
            actionTaken: 'Pointed the VPN concentrator at the healthy DNS pair and flushed the cache.',
          },
        },
        who
      );
      await advance(incident, 'VERIFIED', { verificationNote: 'Confirmed stable for 24 hours with the reporter.' }, actor);
      await advance(incident, 'CLOSED', { closureCode: 'RESOLVED_CONFIRMED' }, actor);
    });
  }

  if (created[1]) {
    await safe('progress payroll incident', async () => {
      const incident = await incidentService.load(created[1]._id);
      const who = incident.assignedTechnician
        ? await repos.users.findById(incident.assignedTechnician)
        : other;
      await advance(incident, 'ACKNOWLEDGED', {}, who);
      await advance(incident, 'IN_PROGRESS', { note: 'Reviewing application logs; probable cache corruption after deploy.' }, who);
      await advance(
        incident,
        'RESOLVED',
        {
          resolution: {
            summary: 'Cleared the corrupted application cache and redeployed the reporting module.',
            rootCause: 'Failed deployment left a partially written cache file.',
            actionTaken: 'Flushed the cache, redeployed and validated payslip rendering.',
          },
        },
        who
      );
    });
  }

  if (created[4]) {
    await safe('progress database incident', async () => {
      const incident = await incidentService.load(created[4]._id);
      const who = incident.assignedTechnician
        ? await repos.users.findById(incident.assignedTechnician)
        : other;
      await advance(incident, 'ACKNOWLEDGED', {}, who);
      await advance(incident, 'IN_PROGRESS', { note: 'Rebuilding the reporting index and monitoring replication lag.' }, who);
    });
  }

  /* Backdate two incidents so the SLA monitor has something to report on. */
  await safe('backdate SLA scenarios', async () => {
    const backdate = async (incidentId, createdDaysAgo, dueMinutesFromNow) => {
      const now = Date.now();
      const createdAt = new Date(now - createdDaysAgo * 86400000);
      const due = new Date(now + dueMinutesFromNow * 60000);
      await repos.models.Incident.collection.updateOne(
        { incidentId },
        {
          $set: {
            createdAt,
            updatedAt: new Date(),
            'sla.responseTarget': new Date(createdAt.getTime() + 15 * 60000),
            'sla.resolutionTarget': due,
            'sla.resolutionDueAt': due,
            'sla.approachingNotified': false,
            'sla.violationNotified': false,
          },
        }
      );
    };

    if (created[2]) await backdate(created[2].incidentId, 3, -120); // breached
    if (created[3]) await backdate(created[3].incidentId, 3, 8); // at risk

    const summary = await slaMonitor.runOnce();
    console.log(
      `[seed] SLA sweep: scanned ${summary.scanned}, at risk ${summary.atRisk}, breached ${summary.breached}`
    );
  });

  return { created: created.length };
}

/* --------------------------------------------------------------------- main */

async function runCli() {
  const withDemo = process.argv.includes('--demo') || process.argv.includes('--all');
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/itsm_db';

  registerObservers();
  await connectDB(uri);

  const reference = await ensureReferenceData();
  const admin = await ensureAdmin();
  const users = await seedUsers();

  console.log('[seed] SLA policies:', reference.slaPolicies);
  console.log('[seed] services:', reference.services);
  console.log(`[seed] administrator ready: ${admin.email} (created: ${admin.created})`);
  console.log(`[seed] technicians created: ${users.technicians}, employees created: ${users.employees}`);

  if (withDemo) {
    const demo = await seedDemoIncidents();
    console.log(`[seed] demo incidents created: ${demo.created}`);
  }

  console.log(`\nDemo accounts use the password: ${DEMO_PASSWORD}`);
  console.log(`Administrator: ${admin.email} / ${process.env.SEED_ADMIN_PASSWORD || 'Admin@1234'}`);
  console.log('Technicians:', TECHNICIANS.map((t) => t.email).join(', '));
  console.log('Employees  :', EMPLOYEES.map((e) => e.email).join(', '));

  await disconnectDB();
}

if (require.main === module) {
  runCli()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed] failed:', err);
      process.exit(1);
    });
}

module.exports = {
  ensureReferenceData,
  ensureAdmin,
  seedUsers,
  seedDemoIncidents,
  DEMO_PASSWORD,
  SERVICES,
  TECHNICIANS,
  EMPLOYEES,
};
