import { initDb } from './database.js';
import { connectToWhatsApp } from './whatsapp.js';

async function main() {
  try {
    console.log('Initializing SQLite database...');
    await initDb();
    console.log('Database initialized successfully.');

    console.log('Connecting to WhatsApp...');
    await connectToWhatsApp();
  } catch (err) {
    console.error('Fatal error during startup:', err);
    process.exit(1);
  }
}

main();
