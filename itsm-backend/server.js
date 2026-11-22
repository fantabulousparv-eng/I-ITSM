require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const { connectDB, disconnectDB } = require('./config/db');
const { registerObservers } = require('./events/observers');
const seed = require('./scripts/seed');
const slaMonitor = require('./jobs/slaMonitor');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const chatRoutes = require('./routes/chatRoutes');
const incidentRoutes = require('./routes/incidentRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const userRoutes = require('./routes/userRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const eventRoutes = require('./routes/eventRoutes');

const PORT = Number(process.env.PORT) || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/itsm_db';

/** Allow the Vite dev server (and any extra origins listed in CORS_ORIGIN). */
function corsOptions() {
  const configured = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const defaults = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://localhost:3000',
  ];
  const allowlist = [...new Set([...configured, ...defaults])];

  /**
   * During local development Vite may fall back to 5174, 5175, … when 5173 is
   * taken. Rather than force a port restart, accept any localhost Vite port so
   * the dev experience stays friction-free.
   */
  const localhostVite = /^https?:\/\/(localhost|127\.0\.0\.1):(51[3-9]\d|52\d\d|4173)$/;

  return {
    origin(origin, callback) {
      // Requests without an Origin (curl, server-to-server) are always allowed.
      if (!origin || allowlist.includes(origin) || localhostVite.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  };
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors(corsOptions()));
  app.use(express.json({ limit: '1mb' }));

  /** Liveness probe - also reports the database state. */
  app.get('/api/health', (_req, res) => {
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    res.json({
      status: 'ok',
      service: 'itsm-backend',
      database: states[mongoose.connection.readyState] || 'unknown',
      time: new Date().toISOString(),
    });
  });

  app.get('/', (_req, res) => {
    res.json({ service: 'Intelligent ITSM & Incident Resolution System API', docs: '/api/health' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/incidents', incidentRoutes);
  app.use('/api/services', serviceRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/events', eventRoutes);

  // Order matters: unmatched routes -> 404, then the single error handler.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

async function start() {
  registerObservers({ verbose: process.env.NODE_ENV !== 'test' });

  await connectDB(MONGO_URI);
  await seed.ensureReferenceData();
  await seed.ensureAdmin();

  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`[server] ITSM API listening on http://localhost:${PORT}`);
    console.log(`[server] health: http://localhost:${PORT}/api/health`);
  });

  const stopSlaMonitor = slaMonitor.start();

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[server] ${signal} received - shutting down gracefully...`);

    stopSlaMonitor();
    server.close(async () => {
      try {
        await disconnectDB();
      } catch (err) {
        console.error('[server] error while closing the database connection:', err.message);
      }
      process.exit(0);
    });

    // Fail-safe so a hung connection cannot keep the process alive forever.
    setTimeout(() => process.exit(0), 5000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandled rejection:', reason);
  });

  return { app, server };
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
  });
}

module.exports = { createApp, start };
