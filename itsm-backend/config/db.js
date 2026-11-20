const mongoose = require('mongoose');

/**
 * Connect to MongoDB. Retries a few times so that starting the server
 * and the database close together does not crash the process.
 */
async function connectDB(uri, { retries = 5, delayMs = 2000 } = {}) {
  mongoose.set('strictQuery', true);

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
      });
      console.log(`[db] MongoDB connected -> ${mongoose.connection.name}`);
      return mongoose.connection;
    } catch (err) {
      console.error(`[db] connection attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.connection.close();
}

module.exports = { connectDB, disconnectDB };
