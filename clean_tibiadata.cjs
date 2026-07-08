const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('bossbot.db');

db.serialize(() => {
  db.run(`DELETE FROM boss_reports WHERE reported_by_jid = 'TibiaData_API'`);
  db.run(`DELETE FROM boss_last_seen WHERE confirmed_by = 'TibiaData_API'`);
  console.log('Cleaned up ALL TibiaData_API records.');
  db.close();
});
