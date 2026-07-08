const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('bossbot.db');

db.serialize(() => {
  db.run(`DELETE FROM boss_reports WHERE boss_name IN ('Dreadmaw', 'The Voice Of Ruin', 'Flamecaller Zazrak', 'Hirintror', 'Battlemaster Zunzu', 'Fleabringer', 'Albino Dragon')`);
  db.run(`DELETE FROM boss_last_seen WHERE boss_name IN ('Dreadmaw', 'The Voice Of Ruin', 'Flamecaller Zazrak', 'Hirintror', 'Battlemaster Zunzu', 'Fleabringer', 'Albino Dragon')`);
  console.log('Cleaned up generic records.');
  db.close();
});
