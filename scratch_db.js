import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('bossbot.db');

db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS global_settings (key TEXT PRIMARY KEY, value TEXT)');
  db.run('INSERT OR REPLACE INTO global_settings (key, value) VALUES ("global_alert_level", "2")');
  db.all('SELECT * FROM global_settings', (err, rows) => {
    console.log("ROWS:", rows);
  });
});
