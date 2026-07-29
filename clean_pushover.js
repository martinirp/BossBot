import { initDb, db } from './database.js';

async function main() {
  await initDb();
  db.run(`DELETE FROM user_pushover WHERE length(pushover_key) != 30`, (err) => {
    if (err) {
      console.error('Error fixing db:', err);
    } else {
      console.log('Successfully removed invalid Pushover keys from the database.');
    }
    process.exit(0);
  });
}

main();
