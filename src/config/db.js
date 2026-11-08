const mongoose = require('mongoose');
const path = require('path');

let memoryServer = null;

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (uri) {
    try {
      console.log(`Attempting to connect to configured MongoDB: ${uri.replace(/\/\/.*@/, '//<credentials>@')}`);
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
      console.log('Connected to MongoDB');
      return;
    } catch (err) {
      console.warn(`Warning: Could not connect to configured MONGODB_URI (${err.message}).`);
    }
  }

  // Graceful fallback to embedded/in-memory MongoDB
  console.log('Falling back to embedded in-memory MongoDB instance...');
  try {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    process.env.MONGOMS_DOWNLOAD_DIR =
      process.env.MONGOMS_DOWNLOAD_DIR ||
      path.resolve(__dirname, '../../../alert-service-mvm/node_modules/.cache/mongodb-memory-server');
    process.env.MONGOMS_VERSION = process.env.MONGOMS_VERSION || '7.0.24';

    memoryServer = await MongoMemoryServer.create();
    const memUri = memoryServer.getUri();
    await mongoose.connect(memUri);
    console.log(`Connected to embedded MongoDB at ${memUri}`);
  } catch (memErr) {
    console.error('Failed to start embedded MongoDB:', memErr);
    throw memErr;
  }
}

async function disconnectDB() {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
  }
}

module.exports = { connectDB, disconnectDB };
