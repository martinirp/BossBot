import { initDb } from './database.js';
import { connectToWhatsApp } from './whatsapp.js';
import { startSyncCron } from './syncTibiaData.js';
import { startWebServer } from './webServer.js';

async function main() {
  try {
    console.log('Initializing SQLite database...');
    await initDb();
    console.log('Database initialized successfully.');

    console.log('Starting Web Dashboard Server...');
    startWebServer();

    console.log('Connecting to WhatsApp...');
    await connectToWhatsApp();

    console.log('Starting TibiaData Sync Cron Job...');
    startSyncCron();
  } catch (err) {
    console.error('Fatal error during startup:', err);
    process.exit(1);
  }
}

main();
