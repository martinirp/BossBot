import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('bossbot.db');

db.serialize(() => {
  db.all(`
    SELECT id, boss_name, created_at 
    FROM boss_reports 
    WHERE reported_by_jid = 'TibiaData_API' 
    ORDER BY id DESC LIMIT 10
  `, function(err, rows) {
    if (err) {
      console.error("Error:", err);
    } else {
      console.log(rows);
    }
  });
});

db.close();
